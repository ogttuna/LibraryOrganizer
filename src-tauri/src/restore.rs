use crate::{
    error::{Error, Result},
    library::{id, Library},
    models::Attachment,
    trash::managed_relative,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{
    migrate::Migrate, sqlite::SqliteConnectOptions, Connection, Executor, SqliteConnection,
};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

const MAX_ENTRIES: usize = 200_002;
const MAX_FILE: u64 = 8 * 1024 * 1024 * 1024;
const MAX_DATABASE: u64 = 2 * 1024 * 1024 * 1024;
const MAX_MANIFEST: u64 = 64 * 1024 * 1024;
const MAX_TOTAL: u64 = 256 * 1024 * 1024 * 1024;
static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePreview {
    pub id: String,
    pub created_at: String,
    pub item_count: u64,
    pub attachment_count: u64,
    pub total_bytes: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format_version: u32,
    schema_version: u32,
    created_at: String,
    database_sha256: String,
    attachments: Vec<serde_json::Value>,
}

#[derive(Serialize, Deserialize)]
struct Marker {
    target: PathBuf,
    preview: RestorePreview,
}

#[derive(Serialize, Deserialize)]
struct Journal {
    id: String,
}

fn invalid(message: &str) -> Error {
    Error::Validation(message.into())
}

fn stage_path(root: &Path, restore_id: &str) -> Result<PathBuf> {
    uuid::Uuid::parse_str(restore_id).map_err(|_| invalid("Geri yükleme kimliği geçersiz."))?;
    Ok(root
        .parent()
        .ok_or_else(|| invalid("Kütüphane konumu geçersiz."))?
        .join(format!(".folio-restore-{restore_id}")))
}

fn journal_path(root: &Path) -> Result<PathBuf> {
    let name = root
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| invalid("Kütüphane konumu geçersiz."))?;
    Ok(root.with_file_name(format!(".folio-{name}-restore.json")))
}

fn previous_path(root: &Path, restore_id: &str) -> PathBuf {
    root.with_file_name(format!("Folio-onceki-kutuphane-{restore_id}"))
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path, maximum: u64) -> Result<T> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > maximum {
        return Err(invalid("Geri yükleme bilgisi geçersiz veya çok büyük."));
    }
    Ok(serde_json::from_reader(
        File::open(path)?.take(maximum + 1),
    )?)
}

fn write_json_new(path: &Path, value: &impl Serialize) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| invalid("Dosya konumu geçersiz."))?;
    let mut pending = tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer(&mut pending, value)?;
    pending.as_file().sync_all()?;
    pending
        .persist_noclobber(path)
        .map_err(|e| Error::Io(e.error))?;
    sync_directory(parent)
}

fn sync_directory(path: &Path) -> Result<()> {
    #[cfg(unix)]
    File::open(path)?.sync_all()?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn regular_file(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(invalid("Yedekte yalnızca normal dosyalar bulunabilir."));
    }
    Ok(())
}

fn hash_file(path: &Path, maximum: u64) -> Result<(String, u64)> {
    regular_file(path)?;
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut size = 0u64;
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        size += read as u64;
        if size > maximum {
            return Err(invalid("Yedek dosya boyutu sınırını aşıyor."));
        }
        digest.update(&buffer[..read]);
    }
    Ok((format!("{:x}", digest.finalize()), size))
}

/// No path is extracted until every ZIP member has passed structural and size checks.
fn extract_archive(source: &Path, stage: &Path) -> Result<()> {
    regular_file(source)?;
    let (central_offset, declared_count) = inspect_zip_directory(source)?;
    let mut archive = zip::ZipArchive::new(File::open(source)?)?;
    if archive.len() != declared_count
        || archive.central_directory_start() != central_offset
        || archive.offset() != 0
    {
        return Err(invalid(
            "Yedekte yinelenen dosya veya geçersiz ZIP dizini var.",
        ));
    }
    if archive.len() < 2 || archive.len() > MAX_ENTRIES {
        return Err(invalid("Yedekteki dosya sayısı geçersiz."));
    }
    let mut names = HashSet::new();
    let mut total = 0u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index)?;
        let name = entry.name();
        if name.contains('\\')
            || name.contains('\0')
            || name.contains(':')
            || name.len() > 250
            || !names.insert(name.to_owned())
            || entry.is_dir()
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 != 0 && mode & 0o170000 != 0o100000)
        {
            return Err(invalid(
                "Yedekte güvensiz veya yinelenen bir dosya yolu var.",
            ));
        }
        let maximum = match name {
            "library.sqlite" => MAX_DATABASE,
            "manifest.json" => MAX_MANIFEST,
            _ => {
                let parts: Vec<_> = name.split('/').collect();
                if parts.len() != 3 {
                    return Err(invalid("Yedekte beklenmeyen bir dosya var."));
                }
                managed_relative(name, parts[1])?;
                MAX_FILE
            }
        };
        total = total
            .checked_add(entry.size())
            .ok_or_else(|| invalid("Yedek boyutu geçersiz."))?;
        if entry.size() > maximum || total > MAX_TOTAL {
            return Err(invalid(
                "Yedek boyut sınırını aşıyor (dosya 8 GB, toplam 256 GB).",
            ));
        }
    }
    if !names.contains("library.sqlite") || !names.contains("manifest.json") {
        return Err(invalid("Yedekte veritabanı veya doğrulama bilgisi eksik."));
    }
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let destination = stage.join(entry.name());
        fs::create_dir_all(
            destination
                .parent()
                .ok_or_else(|| invalid("Yedek yolu geçersiz."))?,
        )?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)?;
        let expected = entry.size();
        let mut copied = 0u64;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let count = entry.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            copied += count as u64;
            if copied > expected {
                return Err(invalid("Yedekteki dosya boyutu eşleşmiyor."));
            }
            output.write_all(&buffer[..count])?;
        }
        if copied != expected {
            return Err(invalid("Yedek dosyası eksik."));
        }
        output.sync_all()?;
        sync_directory(destination.parent().unwrap())?;
    }
    fs::create_dir_all(stage.join("files"))?;
    fs::create_dir_all(stage.join(".staging"))?;
    sync_directory(&stage.join("files"))?;
    sync_directory(stage)?;
    let manifest: Manifest = read_json(&stage.join("manifest.json"), MAX_MANIFEST)?;
    let mut expected = HashSet::from(["library.sqlite".to_owned(), "manifest.json".to_owned()]);
    for value in &manifest.attachments {
        let relative = value
            .get("relativePath")
            .and_then(|v| v.as_str())
            .ok_or_else(|| invalid("Yedek eki bilgisi geçersiz."))?;
        if !expected.insert(relative.to_owned()) {
            return Err(invalid("Yedekte yinelenen ek var."));
        }
    }
    if expected != names {
        return Err(invalid(
            "Yedekteki dosyalar doğrulama listesiyle eşleşmiyor.",
        ));
    }
    Ok(())
}

// ZipArchive internally indexes members by name, so duplicate names can disappear from len().
// Bound the advertised count before allocating it, and verify every raw central-directory name.
fn inspect_zip_directory(source: &Path) -> Result<(u64, usize)> {
    let mut file = File::open(source)?;
    let length = file.metadata()?.len();
    let tail_length = length.min(65_557);
    file.seek(SeekFrom::Start(length - tail_length))?;
    let mut tail = vec![0u8; tail_length as usize];
    file.read_exact(&mut tail)?;
    let position = (0..tail.len().saturating_sub(21))
        .rev()
        .find(|&i| {
            tail[i..].starts_with(b"PK\x05\x06")
                && i + 22 + u16::from_le_bytes([tail[i + 20], tail[i + 21]]) as usize == tail.len()
        })
        .ok_or_else(|| invalid("Yedek ZIP bitiş kaydı geçersiz."))?;
    let end = &tail[position..];
    if end[4..8] != [0, 0, 0, 0] {
        return Err(invalid("Çok parçalı yedekler desteklenmiyor."));
    }
    let mut count = u16::from_le_bytes([end[10], end[11]]) as u64;
    let mut offset = u32::from_le_bytes(end[16..20].try_into().unwrap()) as u64;
    if count == u16::MAX as u64 || offset == u32::MAX as u64 || end[12..16] == [255; 4] {
        let end_offset = length - tail_length + position as u64;
        if end_offset < 20 {
            return Err(invalid("ZIP64 yedek kaydı eksik."));
        }
        file.seek(SeekFrom::Start(end_offset - 20))?;
        let mut locator = [0u8; 20];
        file.read_exact(&mut locator)?;
        if &locator[..4] != b"PK\x06\x07"
            || locator[4..8] != [0; 4]
            || locator[16..20] != [1, 0, 0, 0]
        {
            return Err(invalid("ZIP64 yedek kaydı geçersiz."));
        }
        let zip64_offset = u64::from_le_bytes(locator[8..16].try_into().unwrap());
        if zip64_offset > end_offset.saturating_sub(76) {
            return Err(invalid("ZIP64 yedek konumu geçersiz."));
        }
        file.seek(SeekFrom::Start(zip64_offset))?;
        let mut header = [0u8; 56];
        file.read_exact(&mut header)?;
        if &header[..4] != b"PK\x06\x06" || header[16..24] != [0; 8] {
            return Err(invalid("ZIP64 yedek başlığı geçersiz."));
        }
        count = u64::from_le_bytes(header[32..40].try_into().unwrap());
        offset = u64::from_le_bytes(header[48..56].try_into().unwrap());
    }
    if count < 2 || count > MAX_ENTRIES as u64 || offset >= length {
        return Err(invalid("Yedekteki dosya sayısı veya ZIP konumu geçersiz."));
    }
    file.seek(SeekFrom::Start(offset))?;
    let mut names = HashSet::new();
    for _ in 0..count {
        let mut header = [0u8; 46];
        file.read_exact(&mut header)?;
        if &header[..4] != b"PK\x01\x02" {
            return Err(invalid("Yedek ZIP dosya dizini geçersiz."));
        }
        let name_length = u16::from_le_bytes([header[28], header[29]]) as usize;
        let extra_length = u16::from_le_bytes([header[30], header[31]]) as u64;
        let comment_length = u16::from_le_bytes([header[32], header[33]]) as u64;
        if name_length == 0 || name_length > 250 {
            return Err(invalid("Yedek dosya adı geçersiz."));
        }
        let mut name = vec![0u8; name_length];
        file.read_exact(&mut name)?;
        if !names.insert(name) {
            return Err(invalid("Yedekte yinelenen dosya adları var."));
        }
        file.seek(SeekFrom::Current((extra_length + comment_length) as i64))?;
    }
    let mut next = [0u8; 4];
    file.read_exact(&mut next)?;
    if &next != b"PK\x05\x06" && &next != b"PK\x06\x06" {
        return Err(invalid("Yedek ZIP dizin boyutu eşleşmiyor."));
    }
    Ok((offset, count as usize))
}

async fn schema(connection: &mut SqliteConnection) -> Result<Vec<(String, String, String)>> {
    let definitions: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name",
    )
    .fetch_all(connection)
    .await?;
    // Rebuilding derived FTS may change formatting without changing its schema.
    Ok(definitions
        .into_iter()
        .map(|(kind, name, sql)| {
            let mut quote = None;
            let normalized: String = sql
                .chars()
                .filter(|character| {
                    if let Some(active) = quote {
                        if *character == active {
                            quote = None;
                        }
                        true
                    } else if ['\'', '"', '`'].contains(character) {
                        quote = Some(*character);
                        true
                    } else {
                        !character.is_whitespace()
                    }
                })
                .collect();
            (kind, name, normalized)
        })
        .collect())
}

async fn validate_database(path: &Path, manifest: &Manifest) -> Result<(u64, Vec<Attachment>)> {
    let mut database = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(path)
            .read_only(true)
            .foreign_keys(true),
    )
    .await?;
    sqlx::query("PRAGMA trusted_schema=OFF")
        .execute(&mut database)
        .await?;
    let mut expected = SqliteConnection::connect("sqlite::memory:").await?;
    expected.ensure_migrations_table().await?;
    let migrations: Vec<_> = MIGRATOR
        .iter()
        .filter(|m| m.version <= manifest.schema_version as i64)
        .collect();
    if migrations.len() != manifest.schema_version as usize {
        return Err(invalid("Bu yedeğin veritabanı sürümü desteklenmiyor."));
    }
    for migration in &migrations {
        expected.execute(migration.sql.as_ref()).await?;
    }
    if schema(&mut database).await? != schema(&mut expected).await? {
        return Err(invalid("Yedeğin veritabanı şeması Folio ile eşleşmiyor."));
    }
    let versions: Vec<(i64, bool, Vec<u8>)> =
        sqlx::query_as("SELECT version,success,checksum FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&mut database)
            .await?;
    if versions.len() != migrations.len()
        || versions.iter().zip(migrations.iter()).any(
            |((version, success, checksum), migration)| {
                !success
                    || *version != migration.version
                    || checksum.as_slice() != migration.checksum.as_ref()
            },
        )
    {
        return Err(invalid("Yedeğin şema geçişleri doğrulanamadı."));
    }
    let integrity: Vec<String> = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_all(&mut database)
        .await?;
    if integrity != ["ok"] {
        return Err(invalid("Yedek veritabanının bütünlük denetimi başarısız."));
    }
    if !sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(&mut database)
        .await?
        .is_empty()
    {
        return Err(invalid("Yedekte eksik veya bozuk kayıt ilişkileri var."));
    }
    // Detect category cycles without recursive SQL against an untrusted graph.
    let parents: BTreeMap<String, Option<String>> =
        sqlx::query_as::<_, (String, Option<String>)>("SELECT id,parent_id FROM categories")
            .fetch_all(&mut database)
            .await?
            .into_iter()
            .collect();
    let mut completed = HashSet::new();
    for id in parents.keys() {
        let mut cursor = Some(id.as_str());
        let mut visited = HashSet::new();
        while let Some(current) = cursor {
            if completed.contains(current) {
                break;
            }
            if !visited.insert(current) {
                return Err(invalid("Yedekte kategori döngüsü var."));
            }
            cursor = parents.get(current).and_then(|p| p.as_deref());
        }
        completed.extend(visited);
    }
    let authors: Vec<String> = sqlx::query_scalar("SELECT authors_json FROM items")
        .fetch_all(&mut database)
        .await?;
    for authors in authors {
        let _: Vec<String> = serde_json::from_str(&authors)?;
    }
    let unfinished: i64 =
        sqlx::query_scalar("SELECT count(*) FROM import_jobs WHERE status='copying'")
            .fetch_one(&mut database)
            .await?;
    if unfinished > 0 {
        return Err(invalid("Yedekte yarım kalmış içe aktarma işlemi var."));
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM items")
        .fetch_one(&mut database)
        .await?;
    let attachments = sqlx::query_as::<_, Attachment>("SELECT * FROM attachments ORDER BY id")
        .fetch_all(&mut database)
        .await?;
    database.close().await?;
    expected.close().await?;
    Ok((count as u64, attachments))
}

async fn validate_stage(stage: &Path, restore_id: &str) -> Result<RestorePreview> {
    let metadata = fs::symlink_metadata(stage)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(invalid("Geri yükleme klasörü geçersiz."));
    }
    let manifest: Manifest = read_json(&stage.join("manifest.json"), MAX_MANIFEST)?;
    chrono::DateTime::parse_from_rfc3339(&manifest.created_at)
        .map_err(|_| invalid("Yedeğin oluşturulma tarihi geçersiz."))?;
    if manifest.format_version != 1 || !(1..=2).contains(&manifest.schema_version) {
        return Err(invalid(
            "Bu yedek sürümü desteklenmiyor. Folio'yu güncelleyin.",
        ));
    }
    validate_stage_entries(stage, &manifest)?;
    let database_path = stage.join("library.sqlite");
    let database_hash =
        tokio::task::spawn_blocking(move || hash_file(&database_path, MAX_DATABASE)).await??;
    if database_hash.0 != manifest.database_sha256 {
        return Err(invalid(
            "Yedek veritabanının SHA-256 doğrulaması başarısız.",
        ));
    }
    let (item_count, attachments) =
        validate_database(&stage.join("library.sqlite"), &manifest).await?;
    let actual: Vec<_> = attachments
        .iter()
        .map(serde_json::to_value)
        .collect::<std::result::Result<_, _>>()?;
    let mut declared = manifest.attachments;
    declared.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    if actual != declared {
        return Err(invalid(
            "Yedek manifesti veritabanındaki dosyalarla eşleşmiyor.",
        ));
    }
    let stage = stage.to_path_buf();
    let attachment_count = attachments.len() as u64;
    let total_bytes = tokio::task::spawn_blocking(move || -> Result<u64> {
        let mut total = database_hash.1;
        for attachment in attachments {
            let relative = managed_relative(&attachment.relative_path, &attachment.id)?;
            let parent = stage.join("files").join(&attachment.id);
            for directory in [stage.join("files"), parent] {
                let metadata = fs::symlink_metadata(directory)?;
                if !metadata.is_dir() || metadata.file_type().is_symlink() {
                    return Err(invalid("Yedekte güvensiz klasör bağlantısı var."));
                }
            }
            let (hash, size) = hash_file(&stage.join(relative), MAX_FILE)?;
            if hash != attachment.sha256 || size != attachment.size_bytes as u64 {
                return Err(invalid(
                    "Yedekteki bir belgenin SHA-256 veya boyut doğrulaması başarısız.",
                ));
            }
            total += size;
            if total > MAX_TOTAL {
                return Err(invalid("Yedek toplam boyut sınırını aşıyor."));
            }
        }
        Ok(total)
    })
    .await??;
    Ok(RestorePreview {
        id: restore_id.into(),
        created_at: manifest.created_at,
        item_count,
        attachment_count,
        total_bytes,
    })
}

impl Library {
    pub async fn prepare_restore(&self, source: &Path) -> Result<RestorePreview> {
        let _guard = self.write_gate.lock().await;
        if journal_path(&self.root)?.exists() {
            return Err(invalid("Bir geri yükleme yeniden başlatılmayı bekliyor."));
        }
        let restore_id = id();
        let stage = stage_path(&self.root, &restore_id)?;
        tokio::fs::create_dir(&stage).await?;
        let result = async {
            write_json_new(&stage.join(".restore-owner.json"), &self.root)?;
            let source = source.to_path_buf();
            let directory = stage.clone();
            tokio::task::spawn_blocking(move || extract_archive(&source, &directory)).await??;
            let preview = validate_stage(&stage, &restore_id).await?;
            write_json_new(
                &stage.join(".restore-preview.json"),
                &Marker {
                    target: self.root.clone(),
                    preview: preview.clone(),
                },
            )?;
            Ok(preview)
        }
        .await;
        if result.is_err() {
            let _ = tokio::fs::remove_dir_all(stage).await;
        }
        result
    }

    pub async fn cancel_restore(&self, restore_id: &str) -> Result<()> {
        let _guard = self.write_gate.lock().await;
        if journal_path(&self.root)?.exists() {
            return Err(invalid(
                "Planlanan geri yükleme iptal edilemez; uygulamayı yeniden başlatın.",
            ));
        }
        let stage = stage_path(&self.root, restore_id)?;
        if !stage.exists() {
            return Ok(());
        }
        let marker: Marker = read_json(&stage.join(".restore-preview.json"), 4096)?;
        if marker.target != self.root || marker.preview.id != restore_id {
            return Err(invalid("Geri yükleme bu kütüphaneye ait değil."));
        }
        tokio::fs::remove_dir_all(stage).await?;
        Ok(())
    }

    /// Only writes durable intent; no open database is renamed. The caller restarts the application.
    pub async fn schedule_restore(&self, restore_id: &str) -> Result<String> {
        let _guard = self.write_gate.lock().await;
        let stage = stage_path(&self.root, restore_id)?;
        let marker: Marker = read_json(&stage.join(".restore-preview.json"), 4096)?;
        if marker.target != self.root || marker.preview.id != restore_id {
            return Err(invalid("Geri yükleme bu kütüphaneye ait değil."));
        }
        // Staging may have changed while the user read the confirmation; revalidate all bytes.
        validate_stage(&stage, restore_id).await?;
        write_json_new(
            &journal_path(&self.root)?,
            &Journal {
                id: restore_id.into(),
            },
        )?;
        Ok(previous_path(&self.root, restore_id)
            .to_string_lossy()
            .into_owned())
    }
}

/// Replay the two directory renames before opening SQLite. The old archive is always retained.
pub(crate) async fn recover_restore(root: &Path) -> Result<()> {
    let absolute = std::path::absolute(root)?;
    let parent = absolute
        .parent()
        .ok_or_else(|| invalid("Kütüphane konumu geçersiz."))?;
    tokio::fs::create_dir_all(parent).await?;
    let root = tokio::fs::canonicalize(parent).await?.join(
        absolute
            .file_name()
            .ok_or_else(|| invalid("Kütüphane konumu geçersiz."))?,
    );
    let journal_path = journal_path(&root)?;
    if !journal_path.exists() {
        clean_abandoned_stages(&root)?;
        return Ok(());
    }
    let journal: Journal = read_json(&journal_path, 1024)?;
    let stage = stage_path(&root, &journal.id)?;
    let previous = previous_path(&root, &journal.id);
    if stage.exists() {
        let marker: Marker = read_json(&stage.join(".restore-preview.json"), 4096)?;
        if marker.target != root || marker.preview.id != journal.id {
            return Err(invalid("Geri yükleme hedefi geçersiz."));
        }
        if let Err(error) = validate_stage(&stage, &journal.id).await {
            // If power failed after archiving the current library, first make it usable again.
            if !root.exists() && previous.exists() {
                tokio::fs::rename(&previous, &root).await?;
                sync_directory(root.parent().unwrap())?;
            }
            tokio::fs::remove_file(&journal_path).await?;
            sync_directory(root.parent().unwrap())?;
            return Err(error);
        }
        if root.exists() && !previous.exists() {
            tokio::fs::rename(&root, &previous).await?;
            sync_directory(root.parent().unwrap())?;
        }
        if !root.exists() && previous.exists() {
            if let Err(error) = tokio::fs::rename(&stage, &root).await {
                tokio::fs::rename(&previous, &root).await?;
                sync_directory(root.parent().unwrap())?;
                tokio::fs::remove_file(&journal_path).await?;
                sync_directory(root.parent().unwrap())?;
                return Err(error.into());
            }
            sync_directory(root.parent().unwrap())?;
        } else {
            return Err(invalid(
                "Geri yükleme klasörleri beklenen durumda değil; önceki kütüphane korunuyor.",
            ));
        }
    } else if !root.exists() && previous.exists() {
        tokio::fs::rename(&previous, &root).await?;
        sync_directory(root.parent().unwrap())?;
    } else if !root.exists() || !previous.exists() {
        return Err(invalid(
            "Geri yükleme dosyaları bulunamadı; kütüphane değiştirilmedi.",
        ));
    }
    tokio::fs::remove_file(&journal_path).await?;
    sync_directory(root.parent().unwrap())?;
    let _ = tokio::fs::remove_file(root.join(".restore-preview.json")).await;
    let _ = tokio::fs::remove_file(root.join(".restore-owner.json")).await;
    clean_abandoned_stages(&root)?;
    Ok(())
}

fn validate_stage_entries(stage: &Path, manifest: &Manifest) -> Result<()> {
    let mut expected_files = HashSet::from([
        "library.sqlite".to_owned(),
        "manifest.json".to_owned(),
        ".restore-preview.json".to_owned(),
        ".restore-owner.json".to_owned(),
    ]);
    let mut expected_directories = HashSet::from(["files".to_owned(), ".staging".to_owned()]);
    for attachment in &manifest.attachments {
        let id = attachment["id"]
            .as_str()
            .ok_or_else(|| invalid("Yedek eki kimliği geçersiz."))?;
        let relative = attachment["relativePath"]
            .as_str()
            .ok_or_else(|| invalid("Yedek eki yolu geçersiz."))?;
        managed_relative(relative, id)?;
        expected_files.insert(relative.to_owned());
        expected_directories.insert(format!("files/{id}"));
    }
    let mut directories = vec![stage.to_path_buf()];
    while let Some(directory) = directories.pop() {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let relative = entry
                .path()
                .strip_prefix(stage)
                .map_err(|_| invalid("Yedek yolu geçersiz."))?
                .to_string_lossy()
                .replace('\\', "/");
            let kind = entry.file_type()?;
            if kind.is_dir() && expected_directories.contains(&relative) {
                directories.push(entry.path());
            } else if !kind.is_file() || !expected_files.contains(&relative) {
                return Err(invalid(
                    "Geri yükleme klasöründe beklenmeyen dosya veya bağlantı var.",
                ));
            }
        }
    }
    Ok(())
}

fn clean_abandoned_stages(root: &Path) -> Result<()> {
    let Some(parent) = root.parent() else {
        return Ok(());
    };
    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(restore_id) = name.strip_prefix(".folio-restore-") else {
            continue;
        };
        if uuid::Uuid::parse_str(restore_id).is_err() || !entry.file_type()?.is_dir() {
            continue;
        }
        let Ok(owner) = read_json::<PathBuf>(&entry.path().join(".restore-owner.json"), 4096)
        else {
            continue;
        };
        if owner == root {
            // No pending journal owns this stage. Failure should not prevent access to the library.
            let _ = fs::remove_dir_all(entry.path());
        }
    }
    Ok(())
}

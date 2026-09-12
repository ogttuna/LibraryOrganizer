use crate::{
    error::{Error, Result},
    library::{add_categories, id, now, Library},
    models::ImportResult,
    repository,
};
use sha2::{Digest, Sha256};
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub const FORMATS: &[(&str, &str)] = &[
    ("pdf", "application/pdf"),
    ("epub", "application/epub+zip"),
    ("txt", "text/plain"),
    ("md", "text/markdown"),
    ("doc", "application/msword"),
    (
        "docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    ("odt", "application/vnd.oasis.opendocument.text"),
    ("rtf", "application/rtf"),
    ("djvu", "image/vnd.djvu"),
];

impl Library {
    pub async fn import_file(
        &self,
        source: &Path,
        item_id: Option<&str>,
        category_ids: &[String],
    ) -> Result<ImportResult> {
        let _guard = self.write_gate.lock().await;
        if let Some(item_id) = item_id {
            if self.get_item(item_id).await?.deleted_at.is_some() {
                return Err(Error::Validation(
                    "Önce kaynağı çöpten geri getirin.".into(),
                ));
            }
        }
        let filename = source
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or_else(|| Error::Validation("Dosya adı okunamıyor.".into()))?
            .to_owned();
        let format = source
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_lowercase();
        let mime = FORMATS
            .iter()
            .find(|(ext, _)| *ext == format)
            .map(|(_, mime)| *mime)
            .ok_or_else(|| {
                Error::Validation(
                    "Bu dosya biçimi desteklenmiyor. PDF, EPUB veya bir metin belgesi seçin."
                        .into(),
                )
            })?;
        let canonical = tokio::fs::canonicalize(source).await?;
        let metadata = tokio::fs::metadata(&canonical).await?;
        if !metadata.is_file() || metadata.len() == 0 {
            return Err(Error::Validation(
                "Boş veya normal dosya olmayan bir belge eklenemez.".into(),
            ));
        }
        if metadata.len() > 8 * 1024 * 1024 * 1024 {
            return Err(Error::Validation(
                "Bir dosya en fazla 8 GB olabilir.".into(),
            ));
        }
        let job_id = id();
        let relative = format!("files/{job_id}/original.{format}");
        sqlx::query("INSERT INTO import_jobs(id,original_filename,relative_path,status,created_at) VALUES (?,?,?,'copying',?)")
            .bind(&job_id).bind(&filename).bind(&relative).bind(now()).execute(&self.pool).await?;
        let result = self
            .copy_and_commit(
                &canonical,
                &job_id,
                &filename,
                &relative,
                &format,
                mime,
                item_id,
                category_ids,
            )
            .await;
        if let Err(error) = &result {
            // If a commit had succeeded, never remove a referenced file.
            self.clean_incomplete_job(&job_id).await?;
            sqlx::query(
                "UPDATE import_jobs SET status='failed',error=? WHERE id=? AND status='copying'",
            )
            .bind(error.to_string())
            .bind(&job_id)
            .execute(&self.pool)
            .await?;
        }
        result
    }

    #[allow(clippy::too_many_arguments)]
    async fn copy_and_commit(
        &self,
        source: &Path,
        job_id: &str,
        filename: &str,
        relative: &str,
        format: &str,
        mime: &str,
        target_item: Option<&str>,
        categories: &[String],
    ) -> Result<ImportResult> {
        let staging = self.root.join(".staging").join(job_id);
        let mut input = tokio::fs::File::open(source).await?;
        let before = input.metadata().await?;
        if !before.is_file() {
            return Err(Error::Validation(
                "Yalnızca normal dosyalar eklenebilir.".into(),
            ));
        }
        let mut output = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staging)
            .await?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0_u8; 64 * 1024];
        let mut size = 0_i64;
        loop {
            let read = input.read(&mut buf).await?;
            if read == 0 {
                break;
            }
            size += read as i64;
            if size > 8 * 1024 * 1024 * 1024 {
                return Err(Error::Validation("Dosya 8 GB sınırını aştı.".into()));
            }
            hasher.update(&buf[..read]);
            output.write_all(&buf[..read]).await?;
        }
        output.sync_all().await?;
        drop(output);
        let after = input.metadata().await?;
        if size == 0
            || size as u64 != before.len()
            || after.len() != before.len()
            || before.modified()? != after.modified()?
        {
            return Err(Error::Validation(
                "Kaynak dosya kopyalanırken değişti. Yeniden ekleyin.".into(),
            ));
        }
        let hash = format!("{:x}", hasher.finalize());
        let duplicate: Option<String> =
            sqlx::query_scalar("SELECT item_id FROM attachments WHERE sha256=?")
                .bind(&hash)
                .fetch_optional(&self.pool)
                .await?;
        if let Some(existing_id) = duplicate {
            let mut tx = self.pool.begin().await?;
            // A duplicate imported to a category adds membership; it never silently restores trash.
            if target_item.is_none() || target_item == Some(existing_id.as_str()) {
                add_categories(&mut tx, &existing_id, categories).await?;
                repository::reindex(&mut tx, &existing_id).await?;
            }
            sqlx::query("UPDATE import_jobs SET status='duplicate' WHERE id=?")
                .bind(job_id)
                .execute(&mut *tx)
                .await?;
            // Cleanup precedes commit so startup recovery still sees interrupted jobs.
            tokio::fs::remove_file(&staging).await?;
            tx.commit().await?;
            return Ok(ImportResult {
                filename: filename.into(),
                status: "duplicate".into(),
                item_id: Some(existing_id),
                error: None,
            });
        }
        let directory = self.root.join("files").join(job_id);
        tokio::fs::create_dir(&directory).await?;
        tokio::fs::rename(&staging, self.root.join(relative)).await?;
        #[cfg(unix)]
        {
            tokio::fs::File::open(&directory).await?.sync_all().await?;
            tokio::fs::File::open(self.root.join("files"))
                .await?
                .sync_all()
                .await?;
        }
        let item_id = target_item.map(str::to_owned).unwrap_or_else(id);
        let mut tx = self.pool.begin().await?;
        if target_item.is_none() {
            let title = Path::new(filename)
                .file_stem()
                .and_then(|v| v.to_str())
                .unwrap_or(filename)
                .replace(['_', '-'], " ");
            let title: String = title.trim().chars().take(500).collect();
            let title = if title.is_empty() {
                "Adsız kaynak"
            } else {
                &title
            };
            sqlx::query("INSERT INTO items(id,title,created_at,updated_at) VALUES (?,?,?,?)")
                .bind(&item_id)
                .bind(title)
                .bind(now())
                .bind(now())
                .execute(&mut *tx)
                .await?;
        }
        sqlx::query("INSERT INTO attachments(id,item_id,original_filename,relative_path,mime_type,format,size_bytes,sha256,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
            .bind(job_id).bind(&item_id).bind(filename).bind(relative).bind(mime).bind(format).bind(size).bind(&hash).bind(now()).execute(&mut *tx).await?;
        add_categories(&mut tx, &item_id, categories).await?;
        repository::reindex(&mut tx, &item_id).await?;
        sqlx::query("UPDATE import_jobs SET status='ready' WHERE id=?")
            .bind(job_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(ImportResult {
            filename: filename.into(),
            status: "imported".into(),
            item_id: Some(item_id),
            error: None,
        })
    }

    async fn clean_incomplete_job(&self, job_id: &str) -> Result<()> {
        uuid::Uuid::parse_str(job_id)
            .map_err(|_| Error::Validation("İçe aktarma iş kimliği geçersiz.".into()))?;
        let staging = self.root.join(".staging").join(job_id);
        if tokio::fs::try_exists(&staging).await? {
            tokio::fs::remove_file(staging).await?;
        }
        let referenced: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM attachments WHERE id=?)")
                .bind(job_id)
                .fetch_one(&self.pool)
                .await?;
        let directory = self.root.join("files").join(job_id);
        if !referenced && tokio::fs::try_exists(&directory).await? {
            tokio::fs::remove_dir_all(directory).await?;
        }
        Ok(())
    }

    pub(crate) async fn recover_imports(&self) -> Result<()> {
        let _guard = self.write_gate.lock().await;
        let jobs: Vec<String> =
            sqlx::query_scalar("SELECT id FROM import_jobs WHERE status='copying'")
                .fetch_all(&self.pool)
                .await?;
        for job in jobs {
            self.clean_incomplete_job(&job).await?;
            sqlx::query("UPDATE import_jobs SET status='failed',error='İçe aktarma uygulama kapanırken yarım kaldı. Dosyayı yeniden ekleyin.' WHERE id=?")
                .bind(job).execute(&self.pool).await?;
        }
        Ok(())
    }
}

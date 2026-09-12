use crate::{
    error::{Error, Result},
    library::{id, now, Library},
    models::Attachment,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
};
use zip::{write::SimpleFileOptions, ZipWriter};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format_version: u32,
    schema_version: u32,
    app_version: &'static str,
    created_at: String,
    database_sha256: String,
    attachments: Vec<Attachment>,
}

impl Library {
    pub async fn create_backup(&self, destination: &Path) -> Result<String> {
        let _guard = self.write_gate.lock().await;
        if destination.extension().and_then(|v| v.to_str()) != Some("folio") {
            return Err(Error::Validation(
                "Yedek dosyasının uzantısı .folio olmalı.".into(),
            ));
        }
        let parent = tokio::fs::canonicalize(
            destination
                .parent()
                .ok_or_else(|| Error::Validation("Yedek konumu geçersiz.".into()))?,
        )
        .await?;
        if parent.starts_with(&self.root) {
            return Err(Error::Validation(
                "Yedeği kütüphane klasörünün dışında kaydedin.".into(),
            ));
        }
        if tokio::fs::try_exists(destination).await? {
            return Err(Error::Validation(
                "Bu dosya zaten var. Yeni bir yedek adı seçin.".into(),
            ));
        }
        let directory = self.root.join(".staging").join(format!("backup-{}", id()));
        tokio::fs::create_dir(&directory).await?;
        let snapshot = directory.join("library.sqlite");
        let result = async {
            sqlx::query("VACUUM INTO ?")
                .bind(snapshot.to_string_lossy().as_ref())
                .execute(&self.pool)
                .await?;
            let attachments =
                sqlx::query_as::<_, Attachment>("SELECT * FROM attachments ORDER BY id")
                    .fetch_all(&self.pool)
                    .await?;
            let mut paths = Vec::with_capacity(attachments.len());
            for attachment in &attachments {
                paths.push(self.checked_file(&attachment.relative_path).await?);
            }
            let dest = destination.to_path_buf();
            let saved_path = dest.to_string_lossy().into_owned();
            tokio::task::spawn_blocking(move || -> Result<()> {
                let mut pending = tempfile::NamedTempFile::new_in(parent)?;
                {
                    let mut zip = ZipWriter::new(pending.as_file_mut());
                    let options = SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Stored)
                        .large_file(true);
                    zip.start_file("library.sqlite", options)?;
                    let database_sha256 = copy_hashed(&snapshot, &mut zip)?;
                    for (attachment, path) in attachments.iter().zip(paths.iter()) {
                        zip.start_file(&attachment.relative_path, options)?;
                        let hash = copy_hashed(path, &mut zip)?;
                        if hash != attachment.sha256 {
                            return Err(Error::Validation(format!(
                                "{} dosyası arşivde değişmiş; yedek tamamlanmadı.",
                                attachment.original_filename
                            )));
                        }
                    }
                    let manifest = Manifest {
                        format_version: 1,
                        schema_version: 2,
                        app_version: env!("CARGO_PKG_VERSION"),
                        created_at: now(),
                        database_sha256,
                        attachments,
                    };
                    zip.start_file("manifest.json", options)?;
                    zip.write_all(&serde_json::to_vec_pretty(&manifest)?)?;
                    zip.finish()?;
                }
                pending.as_file().sync_all()?;
                pending
                    .persist_noclobber(&dest)
                    .map_err(|e| Error::Io(e.error))?;
                Ok(())
            })
            .await??;
            Ok::<_, Error>(saved_path)
        }
        .await;
        let cleanup = tokio::fs::remove_dir_all(&directory).await;
        match result {
            Ok(path) => {
                cleanup?;
                Ok(path)
            }
            Err(error) => Err(error),
        }
    }
}

fn copy_hashed(path: &Path, output: &mut impl Write) -> Result<String> {
    let mut input = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0_u8; 64 * 1024];
    loop {
        let read = input.read(&mut buf)?;
        if read == 0 {
            break;
        }
        output.write_all(&buf[..read])?;
        hasher.update(&buf[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

use crate::{
    error::{Error, Result},
    library::{now, Library},
};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashResult {
    pub deleted_count: u64,
    pub pending_file_count: u64,
}

/// Files managed by Folio always have this layout. Never interpret stored paths as arbitrary paths.
pub(crate) fn managed_relative(relative: &str, attachment_id: &str) -> Result<PathBuf> {
    let parsed = uuid::Uuid::parse_str(attachment_id)
        .map_err(|_| Error::Validation("Arşiv dosya kimliği geçersiz.".into()))?;
    if parsed.to_string() != attachment_id {
        return Err(Error::Validation(
            "Arşiv dosya kimliği standart UUID biçiminde olmalı.".into(),
        ));
    }
    let parts: Vec<_> = relative.split('/').collect();
    if parts.len() != 3
        || parts[0] != "files"
        || parts[1] != attachment_id
        || !parts[2].starts_with("original.")
        || !crate::importer::FORMATS
            .iter()
            .any(|(format, _)| parts[2] == format!("original.{format}"))
    {
        return Err(Error::Validation("Arşiv dosya yolu geçersiz.".into()));
    }
    Ok(PathBuf::from(relative))
}

async fn safe_managed_path(root: &Path, relative: &str, attachment_id: &str) -> Result<PathBuf> {
    let relative = managed_relative(relative, attachment_id)?;
    let files = root.join("files");
    let parent = files.join(attachment_id);
    for path in [&files, &parent] {
        match tokio::fs::symlink_metadata(path).await {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            _ => {
                return Err(Error::Validation(
                    "Arşiv klasörü güvenli bir klasör değil.".into(),
                ))
            }
        }
    }
    let path = root.join(relative);
    match tokio::fs::symlink_metadata(&path).await {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => (),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        _ => {
            return Err(Error::Validation(
                "Arşiv eki normal bir dosya değil.".into(),
            ))
        }
    }
    Ok(path)
}

impl Library {
    pub async fn empty_trash(&self) -> Result<TrashResult> {
        let _guard = self.write_gate.lock().await;
        let attachments: Vec<(String, String)> = sqlx::query_as(
            "SELECT a.id,a.relative_path FROM attachments a JOIN items i ON i.id=a.item_id WHERE i.deleted_at IS NOT NULL",
        ).fetch_all(&self.pool).await?;
        // Validate before committing the destructive database operation.
        for (id, relative) in &attachments {
            safe_managed_path(&self.root, relative, id).await?;
        }
        let mut tx = self.pool.begin().await?;
        for (id, relative) in attachments {
            sqlx::query("INSERT INTO deletion_jobs(attachment_id,relative_path,created_at) VALUES (?,?,?) ON CONFLICT DO NOTHING")
                .bind(id).bind(relative).bind(now()).execute(&mut *tx).await?;
        }
        sqlx::query("DELETE FROM item_search WHERE item_id IN (SELECT id FROM items WHERE deleted_at IS NOT NULL)")
            .execute(&mut *tx).await?;
        let deleted_count = sqlx::query("DELETE FROM items WHERE deleted_at IS NOT NULL")
            .execute(&mut *tx)
            .await?
            .rows_affected();
        tx.commit().await?;
        // A locked file (particularly on Windows) stays journaled for a later retry.
        self.cleanup_deletions().await?;
        let pending_file_count: i64 = sqlx::query_scalar("SELECT count(*) FROM deletion_jobs")
            .fetch_one(&self.pool)
            .await?;
        Ok(TrashResult {
            deleted_count,
            pending_file_count: pending_file_count as u64,
        })
    }

    pub(crate) async fn recover_deletions(&self) -> Result<()> {
        let _guard = self.write_gate.lock().await;
        self.cleanup_deletions().await
    }

    async fn cleanup_deletions(&self) -> Result<()> {
        let jobs: Vec<(String, String)> =
            sqlx::query_as("SELECT attachment_id,relative_path FROM deletion_jobs")
                .fetch_all(&self.pool)
                .await?;
        for (id, relative) in jobs {
            let referenced: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM attachments WHERE id=? OR relative_path=?)",
            )
            .bind(&id)
            .bind(&relative)
            .fetch_one(&self.pool)
            .await?;
            if referenced {
                // An inconsistent journal must never delete a file referenced by a live record.
                continue;
            }
            let Ok(path) = safe_managed_path(&self.root, &relative, &id).await else {
                continue;
            };
            match tokio::fs::remove_file(&path).await {
                Ok(()) => (),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                Err(_) => continue,
            }
            if let Some(parent) = path.parent() {
                #[cfg(unix)]
                if parent.exists()
                    && tokio::fs::File::open(parent)
                        .await?
                        .sync_all()
                        .await
                        .is_err()
                {
                    continue;
                }
                // Only remove an empty attachment directory; never recursively remove user files.
                let _ = tokio::fs::remove_dir(parent).await;
            }
            #[cfg(unix)]
            tokio::fs::File::open(self.root.join("files"))
                .await?
                .sync_all()
                .await?;
            sqlx::query("DELETE FROM deletion_jobs WHERE attachment_id=?")
                .bind(id)
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }
}

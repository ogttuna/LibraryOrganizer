use crate::{
    error::{validate_text, Error, Result},
    models::*,
    repository,
};
use chrono::Utc;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    SqliteConnection, SqlitePool,
};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::sync::Mutex;
use uuid::Uuid;

pub struct Library {
    pub(crate) pool: SqlitePool,
    pub(crate) root: PathBuf,
    /// Every mutation shares this gate with import, recovery and backup snapshots.
    pub(crate) write_gate: Mutex<()>,
}

pub(crate) fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, true)
}
pub(crate) fn id() -> String {
    Uuid::new_v4().to_string()
}

impl Library {
    pub async fn open(root: impl AsRef<Path>) -> Result<Self> {
        crate::restore::recover_restore(root.as_ref()).await?;
        tokio::fs::create_dir_all(root.as_ref().join("files")).await?;
        tokio::fs::create_dir_all(root.as_ref().join(".staging")).await?;
        let root = tokio::fs::canonicalize(root).await?;
        let options = SqliteConnectOptions::new()
            .filename(root.join("library.sqlite"))
            .create_if_missing(true)
            .collation("TURKISH", crate::search::compare_turkish)
            .pragma("cache_size", "-16384")
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Full)
            .busy_timeout(Duration::from_secs(10));
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;
        sqlx::migrate!("./migrations").run(&pool).await?;
        let library = Self {
            pool,
            root,
            write_gate: Mutex::new(()),
        };
        library.recover_imports().await?;
        library.recover_deletions().await?;
        Ok(library)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
    pub async fn close(&self) {
        self.pool.close().await;
    }
    pub async fn get_item(&self, id: &str) -> Result<Item> {
        repository::get_item(&self.pool, id).await
    }
    pub async fn query(&self, query: LibraryQuery) -> Result<LibraryPage> {
        repository::query_library(&self.pool, query).await
    }
    pub async fn catalog(&self) -> Result<Catalog> {
        repository::catalog(&self.pool).await
    }

    pub async fn create_item(&self, title: &str, kind: &str) -> Result<Item> {
        validate_text(title, "Başlık", 500, true)?;
        validate_kind(kind)?;
        let _guard = self.write_gate.lock().await;
        let id = id();
        let mut tx = self.pool.begin().await?;
        sqlx::query("INSERT INTO items(id,title,kind,created_at,updated_at) VALUES (?,?,?,?,?)")
            .bind(&id)
            .bind(title.trim())
            .bind(kind)
            .bind(now())
            .bind(now())
            .execute(&mut *tx)
            .await?;
        repository::reindex(&mut tx, &id).await?;
        tx.commit().await?;
        self.get_item(&id).await
    }

    pub async fn update_item(&self, id: &str, patch: ItemPatch) -> Result<Item> {
        let _guard = self.write_gate.lock().await;
        let mut item = self.get_item(id).await?;
        if let Some(title) = patch.title {
            validate_text(&title, "Başlık", 500, true)?;
            item.title = title.trim().to_owned();
        }
        if let Some(kind) = patch.kind {
            validate_kind(&kind)?;
            item.kind = kind;
        }
        if let Some(authors) = patch.authors {
            if authors.len() > 100 {
                return Err(Error::Validation("En fazla 100 yazar eklenebilir.".into()));
            }
            for name in &authors {
                validate_text(name, "Yazar", 200, true)?;
            }
            item.authors = authors.into_iter().map(|s| s.trim().to_owned()).collect();
        }
        if let Some(year) = patch.year {
            if year.is_some_and(|y| !(1..=9999).contains(&y)) {
                return Err(Error::Validation("Yıl 1–9999 arasında olmalı.".into()));
            }
            item.year = year;
        }
        if let Some(language) = patch.language {
            validate_text(&language, "Dil", 80, false)?;
            item.language = language;
        }
        if let Some(description) = patch.description {
            validate_text(&description, "Açıklama", 1_000_000, false)?;
            item.description = description;
        }
        if let Some(summary) = patch.summary {
            validate_text(&summary, "Özet", 1_000_000, false)?;
            item.summary = summary;
        }
        if let Some(notes) = patch.notes {
            validate_text(&notes, "Notlar", 1_000_000, false)?;
            item.notes = notes;
        }
        if let Some(status) = patch.reading_status {
            validate_status(&status)?;
            item.reading_status = status;
        }
        if let Some(favorite) = patch.is_favorite {
            item.is_favorite = favorite;
        }
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE items SET title=?,kind=?,authors_json=?,year=?,language=?,description=?,summary=?,notes=?,reading_status=?,is_favorite=?,updated_at=? WHERE id=?")
            .bind(&item.title).bind(&item.kind).bind(serde_json::to_string(&item.authors)?).bind(item.year)
            .bind(&item.language).bind(&item.description).bind(&item.summary).bind(&item.notes)
            .bind(&item.reading_status).bind(item.is_favorite).bind(now()).bind(id).execute(&mut *tx).await?;
        if let Some(categories) = patch.category_ids {
            sqlx::query("DELETE FROM item_categories WHERE item_id=?")
                .bind(id)
                .execute(&mut *tx)
                .await?;
            add_categories(&mut tx, id, &categories).await?;
        }
        if let Some(tags) = patch.tag_names {
            sqlx::query("DELETE FROM item_tags WHERE item_id=?")
                .bind(id)
                .execute(&mut *tx)
                .await?;
            add_tags(&mut tx, id, &tags).await?;
        }
        repository::reindex(&mut tx, id).await?;
        tx.commit().await?;
        self.get_item(id).await
    }

    pub async fn bulk_update(&self, change: BulkChange) -> Result<()> {
        if change.item_ids.is_empty() || change.item_ids.len() > 1000 {
            return Err(Error::Validation("1–1000 kaynak seçin.".into()));
        }
        if let Some(status) = &change.reading_status {
            validate_status(status)?;
        }
        let _guard = self.write_gate.lock().await;
        let mut tx = self.pool.begin().await?;
        for item_id in &change.item_ids {
            let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM items WHERE id=?)")
                .bind(item_id)
                .fetch_one(&mut *tx)
                .await?;
            if !exists {
                return Err(Error::NotFound);
            }
            if let Some(categories) = &change.category_ids {
                add_categories(&mut tx, item_id, categories).await?;
            }
            if let Some(tags) = &change.tag_names {
                add_tags(&mut tx, item_id, tags).await?;
            }
            if let Some(status) = &change.reading_status {
                sqlx::query("UPDATE items SET reading_status=? WHERE id=?")
                    .bind(status)
                    .bind(item_id)
                    .execute(&mut *tx)
                    .await?;
            }
            if let Some(trashed) = change.trashed {
                sqlx::query("UPDATE items SET deleted_at=? WHERE id=?")
                    .bind(trashed.then(now))
                    .bind(item_id)
                    .execute(&mut *tx)
                    .await?;
            }
            sqlx::query("UPDATE items SET updated_at=? WHERE id=?")
                .bind(now())
                .bind(item_id)
                .execute(&mut *tx)
                .await?;
            repository::reindex(&mut tx, item_id).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn attachment_path(&self, attachment_id: &str) -> Result<PathBuf> {
        let relative: String =
            sqlx::query_scalar("SELECT relative_path FROM attachments WHERE id=?")
                .bind(attachment_id)
                .fetch_optional(&self.pool)
                .await?
                .ok_or(Error::NotFound)?;
        self.checked_file(&relative).await
    }

    pub(crate) async fn checked_file(&self, relative: &str) -> Result<PathBuf> {
        let rel = Path::new(relative);
        if rel.is_absolute()
            || !rel
                .components()
                .all(|c| matches!(c, std::path::Component::Normal(_)))
        {
            return Err(Error::Validation("Arşiv dosya yolu geçersiz.".into()));
        }
        let path = tokio::fs::canonicalize(self.root.join(rel)).await?;
        let files = tokio::fs::canonicalize(self.root.join("files")).await?;
        if !path.starts_with(files) || !tokio::fs::metadata(&path).await?.is_file() {
            return Err(Error::Validation("Dosya kütüphane kapsamı dışında.".into()));
        }
        Ok(path)
    }

    pub async fn set_last_page(&self, attachment_id: &str, page: i64) -> Result<()> {
        if !(1..=1_000_000).contains(&page) {
            return Err(Error::Validation("Sayfa numarası geçersiz.".into()));
        }
        let _guard = self.write_gate.lock().await;
        let result = sqlx::query("UPDATE attachments SET last_page=? WHERE id=?")
            .bind(page)
            .bind(attachment_id)
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    pub async fn rebuild_search(&self) -> Result<()> {
        let _guard = self.write_gate.lock().await;
        let mut tx = self.pool.begin().await?;
        sqlx::query("CREATE VIRTUAL TABLE IF NOT EXISTS item_search USING fts5(item_id UNINDEXED, title, authors, body, taxonomy, filenames, tokenize = 'unicode61 remove_diacritics 2')")
            .execute(&mut *tx).await?;
        sqlx::query("DELETE FROM item_search")
            .execute(&mut *tx)
            .await?;
        let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM items")
            .fetch_all(&mut *tx)
            .await?;
        for id in ids {
            repository::reindex(&mut tx, &id).await?;
        }
        tx.commit().await?;
        Ok(())
    }
}

pub(crate) async fn add_categories(
    conn: &mut SqliteConnection,
    item_id: &str,
    categories: &[String],
) -> Result<()> {
    if categories.len() > 100 {
        return Err(Error::Validation(
            "En fazla 100 kategori eklenebilir.".into(),
        ));
    }
    for category in categories {
        sqlx::query(
            "INSERT INTO item_categories(item_id,category_id) VALUES (?,?) ON CONFLICT DO NOTHING",
        )
        .bind(item_id)
        .bind(category)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

pub(crate) async fn add_tags(
    conn: &mut SqliteConnection,
    item_id: &str,
    tags: &[String],
) -> Result<()> {
    if tags.len() > 100 {
        return Err(Error::Validation("En fazla 100 etiket eklenebilir.".into()));
    }
    for tag in tags {
        validate_text(tag, "Etiket", 80, true)?;
        sqlx::query("INSERT INTO tags(id,name) VALUES (?,?) ON CONFLICT(name) DO NOTHING")
            .bind(id())
            .bind(tag.trim())
            .execute(&mut *conn)
            .await?;
        sqlx::query("INSERT INTO item_tags(item_id,tag_id) SELECT ?,id FROM tags WHERE name=? ON CONFLICT DO NOTHING")
            .bind(item_id).bind(tag.trim()).execute(&mut *conn).await?;
    }
    Ok(())
}

fn validate_kind(kind: &str) -> Result<()> {
    if !["book", "article", "other"].contains(&kind) {
        return Err(Error::Validation("Kaynak türü geçersiz.".into()));
    }
    Ok(())
}
fn validate_status(status: &str) -> Result<()> {
    if !["unread", "reading", "read"].contains(&status) {
        return Err(Error::Validation("Okuma durumu geçersiz.".into()));
    }
    Ok(())
}

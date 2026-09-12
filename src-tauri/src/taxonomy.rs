use crate::{
    error::{validate_text, Error, Result},
    library::{id, now, Library},
    models::CategoryInput,
    repository,
};

impl Library {
    pub async fn save_category(&self, input: CategoryInput) -> Result<String> {
        validate_text(&input.name, "Kategori", 80, true)?;
        let _guard = self.write_gate.lock().await;
        let mut tx = self.pool.begin().await?;
        if let Some(existing_id) = &input.id {
            let exists: bool =
                sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM categories WHERE id=?)")
                    .bind(existing_id)
                    .fetch_one(&mut *tx)
                    .await?;
            if !exists {
                return Err(Error::NotFound);
            }
        }
        let id = input.id.unwrap_or_else(id);
        if let Some(parent) = &input.parent_id {
            let parents: Vec<String> = sqlx::query_scalar("WITH RECURSIVE ancestors(id,parent_id) AS (SELECT id,parent_id FROM categories WHERE id=? UNION SELECT c.id,c.parent_id FROM categories c JOIN ancestors a ON a.parent_id=c.id) SELECT id FROM ancestors")
                .bind(parent).fetch_all(&mut *tx).await?;
            if parent == &id || parents.contains(&id) {
                return Err(Error::Validation(
                    "Kategori kendi altına veya alt kategorisine taşınamaz.".into(),
                ));
            }
            if parents.is_empty() {
                return Err(Error::Validation("Üst kategori bulunamadı.".into()));
            }
        }
        let collision: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM categories WHERE parent_id IS ? AND name=? AND id<>?)",
        )
        .bind(&input.parent_id)
        .bind(input.name.trim())
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
        if collision {
            return Err(Error::Validation("Bu üst kategoride aynı adlı bir kategori var. Başka bir ad veya üst kategori seçin.".into()));
        }
        sqlx::query("INSERT INTO categories(id,name,parent_id) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,parent_id=excluded.parent_id")
            .bind(&id).bind(input.name.trim()).bind(&input.parent_id).execute(&mut *tx).await?;
        let affected: Vec<String> =
            sqlx::query_scalar("SELECT item_id FROM item_categories WHERE category_id=?")
                .bind(&id)
                .fetch_all(&mut *tx)
                .await?;
        for item_id in affected {
            sqlx::query("UPDATE items SET updated_at=? WHERE id=?")
                .bind(now())
                .bind(&item_id)
                .execute(&mut *tx)
                .await?;
            repository::reindex(&mut tx, &item_id).await?;
        }
        tx.commit().await?;
        Ok(id)
    }

    /// Remove only this category's memberships; keep children at its previous level.
    /// Reject conflicting child names instead of merging categories or losing memberships.
    pub async fn delete_category(&self, id: &str) -> Result<()> {
        let _guard = self.write_gate.lock().await;
        let mut tx = self.pool.begin().await?;
        let parent: Option<String> =
            sqlx::query_scalar("SELECT parent_id FROM categories WHERE id=?")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or(Error::NotFound)?;
        let conflict: Option<String> = sqlx::query_scalar("SELECT child.name FROM categories child JOIN categories sibling ON sibling.name=child.name AND sibling.parent_id IS ? AND sibling.id<>? WHERE child.parent_id=? LIMIT 1")
            .bind(&parent).bind(id).bind(id).fetch_optional(&mut *tx).await?;
        if let Some(name) = conflict {
            return Err(Error::Validation(format!("“{name}” adlı alt kategori üst düzeyde zaten var. Silmeden önce alt kategoriyi yeniden adlandırın veya taşıyın.")));
        }
        let affected: Vec<String> =
            sqlx::query_scalar("SELECT item_id FROM item_categories WHERE category_id=?")
                .bind(id)
                .fetch_all(&mut *tx)
                .await?;
        // A child may share the removed category's name. Free its unique sibling-name
        // key within this transaction before relocating children.
        sqlx::query("UPDATE categories SET name=? WHERE id=?")
            .bind(format!("__folio_{}", uuid::Uuid::new_v4()))
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE categories SET parent_id=? WHERE parent_id=?")
            .bind(&parent)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM categories WHERE id=?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        for item_id in affected {
            sqlx::query("UPDATE items SET updated_at=? WHERE id=?")
                .bind(now())
                .bind(&item_id)
                .execute(&mut *tx)
                .await?;
            repository::reindex(&mut tx, &item_id).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn save_tag(&self, existing_id: Option<String>, name: &str) -> Result<String> {
        validate_text(name, "Etiket", 80, true)?;
        let _guard = self.write_gate.lock().await;
        let mut tx = self.pool.begin().await?;
        if let Some(existing_id) = &existing_id {
            let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tags WHERE id=?)")
                .bind(existing_id)
                .fetch_one(&mut *tx)
                .await?;
            if !exists {
                return Err(Error::NotFound);
            }
        }
        let id = existing_id.unwrap_or_else(id);
        let collision: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tags WHERE name=? AND id<>?)")
                .bind(name.trim())
                .bind(&id)
                .fetch_one(&mut *tx)
                .await?;
        if collision {
            return Err(Error::Validation(
                "Bu adda bir etiket zaten var. Başka bir ad kullanın.".into(),
            ));
        }
        sqlx::query("INSERT INTO tags(id,name) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name")
            .bind(&id).bind(name.trim()).execute(&mut *tx).await?;
        let affected: Vec<String> =
            sqlx::query_scalar("SELECT item_id FROM item_tags WHERE tag_id=?")
                .bind(&id)
                .fetch_all(&mut *tx)
                .await?;
        for item_id in affected {
            sqlx::query("UPDATE items SET updated_at=? WHERE id=?")
                .bind(now())
                .bind(&item_id)
                .execute(&mut *tx)
                .await?;
            repository::reindex(&mut tx, &item_id).await?;
        }
        tx.commit().await?;
        Ok(id)
    }

    pub async fn delete_tag(&self, id: &str) -> Result<()> {
        let _guard = self.write_gate.lock().await;
        let mut tx = self.pool.begin().await?;
        let affected: Vec<String> =
            sqlx::query_scalar("SELECT item_id FROM item_tags WHERE tag_id=?")
                .bind(id)
                .fetch_all(&mut *tx)
                .await?;
        if sqlx::query("DELETE FROM tags WHERE id=?")
            .bind(id)
            .execute(&mut *tx)
            .await?
            .rows_affected()
            == 0
        {
            return Err(Error::NotFound);
        }
        for item_id in affected {
            sqlx::query("UPDATE items SET updated_at=? WHERE id=?")
                .bind(now())
                .bind(&item_id)
                .execute(&mut *tx)
                .await?;
            repository::reindex(&mut tx, &item_id).await?;
        }
        tx.commit().await?;
        Ok(())
    }
}

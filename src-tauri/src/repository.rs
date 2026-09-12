use crate::{
    error::{Error, Result},
    models::*,
    search,
};
use sqlx::{QueryBuilder, Sqlite, SqliteConnection, SqlitePool};
use std::collections::HashMap;

pub async fn load_items(pool: &SqlitePool, ids: &[String]) -> Result<Vec<Item>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let json = serde_json::to_string(ids)?;
    let rows = sqlx::query_as::<_, ItemRow>(
        "SELECT * FROM items WHERE id IN (SELECT value FROM json_each(?))",
    )
    .bind(&json)
    .fetch_all(pool)
    .await?;
    let mut items: HashMap<String, Item> = HashMap::new();
    for row in rows {
        let item = Item::try_from(row)?;
        items.insert(item.id.clone(), item);
    }
    for (item_id, cat_id) in sqlx::query_as::<_, (String, String)>("SELECT item_id, category_id FROM item_categories WHERE item_id IN (SELECT value FROM json_each(?))")
        .bind(&json).fetch_all(pool).await? {
        if let Some(item) = items.get_mut(&item_id) { item.category_ids.push(cat_id); }
    }
    for (item_id, tag_id) in sqlx::query_as::<_, (String, String)>(
        "SELECT item_id, tag_id FROM item_tags WHERE item_id IN (SELECT value FROM json_each(?))",
    )
    .bind(&json)
    .fetch_all(pool)
    .await?
    {
        if let Some(item) = items.get_mut(&item_id) {
            item.tag_ids.push(tag_id);
        }
    }
    for attachment in sqlx::query_as::<_, Attachment>("SELECT * FROM attachments WHERE item_id IN (SELECT value FROM json_each(?)) ORDER BY created_at, id")
        .bind(&json).fetch_all(pool).await? {
        if let Some(item) = items.get_mut(&attachment.item_id) { item.attachments.push(attachment); }
    }
    Ok(ids.iter().filter_map(|id| items.remove(id)).collect())
}

pub async fn get_item(pool: &SqlitePool, id: &str) -> Result<Item> {
    load_items(pool, &[id.to_owned()])
        .await?
        .pop()
        .ok_or(Error::NotFound)
}

pub async fn reindex(conn: &mut SqliteConnection, id: &str) -> Result<()> {
    sqlx::query("DELETE FROM item_search WHERE item_id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    let row = sqlx::query_as::<_, ItemRow>("SELECT * FROM items WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut *conn)
        .await?;
    if let Some(row) = row {
        let labels: Vec<String> = sqlx::query_scalar("SELECT c.name FROM categories c JOIN item_categories ic ON ic.category_id=c.id WHERE ic.item_id=? UNION ALL SELECT t.name FROM tags t JOIN item_tags it ON it.tag_id=t.id WHERE it.item_id=?")
            .bind(id).bind(id).fetch_all(&mut *conn).await?;
        let names: Vec<String> =
            sqlx::query_scalar("SELECT original_filename FROM attachments WHERE item_id=?")
                .bind(id)
                .fetch_all(&mut *conn)
                .await?;
        let authors: Vec<String> = serde_json::from_str(&row.authors_json)?;
        sqlx::query("INSERT INTO item_search(item_id,title,authors,body,taxonomy,filenames) VALUES (?,?,?,?,?,?)")
            .bind(id).bind(search::normalize(&row.title)).bind(search::normalize(&authors.join(" ")))
            .bind(search::normalize(&format!("{} {} {}", row.description, row.summary, row.notes)))
            .bind(search::normalize(&labels.join(" "))).bind(search::normalize(&names.join(" ")))
            .execute(&mut *conn).await?;
    }
    Ok(())
}

fn filters<'a>(
    b: &mut QueryBuilder<'a, Sqlite>,
    q: &'a LibraryQuery,
    terms: &'a Option<String>,
    categories: &'a str,
    tags: &'a str,
) {
    b.push(" FROM items i");
    if terms.is_some() {
        b.push(" JOIN item_search ON item_search.item_id=i.id");
    }
    b.push(if q.view == "trash" {
        " WHERE i.deleted_at IS NOT NULL"
    } else {
        " WHERE i.deleted_at IS NULL"
    });
    match q.view.as_str() {
        "favorites" => {
            b.push(" AND i.is_favorite=1");
        }
        "reading-list" => {
            b.push(" AND i.reading_status != 'read'");
        }
        "uncategorized" => {
            b.push(" AND NOT EXISTS(SELECT 1 FROM item_categories ic WHERE ic.item_id=i.id)");
        }
        "recent" => {
            b.push(" AND julianday(i.created_at) >= julianday('now', '-30 days')");
        }
        _ => {}
    }
    if let Some(terms) = terms {
        b.push(" AND item_search MATCH ").push_bind(terms);
    }
    if !q.category_ids.is_empty() {
        // Resolve selected memberships once using the reverse index, then match item ids.
        b.push(" AND i.id IN (SELECT ic.item_id FROM item_categories ic WHERE ic.category_id IN (SELECT value FROM json_each(")
            .push_bind(categories).push(")))");
    }
    if !q.tag_ids.is_empty() {
        b.push(" AND i.id IN (SELECT it.item_id FROM item_tags it WHERE it.tag_id IN (SELECT value FROM json_each(")
            .push_bind(tags).push("))");
        if q.tag_mode != "any" {
            b.push(" GROUP BY it.item_id HAVING COUNT(*) = ")
                .push_bind(q.tag_ids.len() as i64);
        }
        b.push(")");
    }
    if !q.kind.is_empty() {
        b.push(" AND i.kind=").push_bind(&q.kind);
    }
    if !q.reading_status.is_empty() {
        b.push(" AND i.reading_status=")
            .push_bind(&q.reading_status);
    }
    if !q.format.is_empty() {
        b.push(" AND EXISTS(SELECT 1 FROM attachments a WHERE a.item_id=i.id AND a.format=")
            .push_bind(&q.format)
            .push(")");
    }
}

pub async fn query_library(pool: &SqlitePool, mut q: LibraryQuery) -> Result<LibraryPage> {
    crate::error::validate_text(&q.q, "Arama", 1000, false)?;
    q.tag_ids.sort();
    q.tag_ids.dedup();
    q.category_ids.sort();
    q.category_ids.dedup();
    if q.tag_ids.len() > 100 || q.category_ids.len() > 100 {
        return Err(Error::Validation(
            "En fazla 100 filtre seçebilirsiniz.".into(),
        ));
    }
    let terms = search::fts_query(&q.q);
    let mut cats = q.category_ids.clone();
    if q.include_descendants && !cats.is_empty() {
        cats = sqlx::query_scalar("WITH RECURSIVE descendants(id) AS (SELECT value FROM json_each(?) UNION SELECT c.id FROM categories c JOIN descendants d ON c.parent_id=d.id) SELECT id FROM descendants")
            .bind(serde_json::to_string(&cats)?).fetch_all(pool).await?;
    }
    let cats_json = serde_json::to_string(&cats)?;
    let tags_json = serde_json::to_string(&q.tag_ids)?;
    let mut count = QueryBuilder::new("SELECT COUNT(*)");
    filters(&mut count, &q, &terms, &cats_json, &tags_json);
    let total = count.build_query_scalar::<i64>().fetch_one(pool).await?;
    let mut b = QueryBuilder::new("SELECT i.id");
    filters(&mut b, &q, &terms, &cats_json, &tags_json);
    b.push(match q.sort.as_str() {
        "title" => " ORDER BY i.title COLLATE TURKISH ASC, i.id ASC",
        "year" => " ORDER BY i.year DESC NULLS LAST, i.id ASC",
        _ if terms.is_some() => {
            " ORDER BY bm25(item_search, 0, 8, 4, 1, 3, 2), i.created_at DESC, i.id ASC"
        }
        _ => " ORDER BY i.created_at DESC, i.id ASC",
    });
    b.push(" LIMIT ")
        .push_bind(q.limit.clamp(1, 100))
        .push(" OFFSET ")
        .push_bind(q.offset.max(0));
    let ids = b.build_query_scalar::<String>().fetch_all(pool).await?;
    Ok(LibraryPage {
        items: load_items(pool, &ids).await?,
        total,
    })
}

pub async fn catalog(pool: &SqlitePool) -> Result<Catalog> {
    let categories = sqlx::query_as::<_, Category>("SELECT c.*, COALESCE(counts.count, 0) AS count FROM categories c LEFT JOIN (SELECT category_id, COUNT(*) AS count FROM item_categories WHERE item_id IN (SELECT id FROM items WHERE deleted_at IS NULL) GROUP BY category_id) counts ON counts.category_id=c.id ORDER BY c.sort_order, c.name")
        .fetch_all(pool).await?;
    let tags = sqlx::query_as::<_, Tag>("SELECT t.*, COALESCE(counts.count, 0) AS count FROM tags t LEFT JOIN (SELECT tag_id, COUNT(*) AS count FROM item_tags WHERE item_id IN (SELECT id FROM items WHERE deleted_at IS NULL) GROUP BY tag_id) counts ON counts.tag_id=t.id ORDER BY t.name")
        .fetch_all(pool).await?;
    let stats = sqlx::query_as::<_, Stats>("SELECT COUNT(CASE WHEN deleted_at IS NULL THEN 1 END) AS total, COUNT(CASE WHEN deleted_at IS NULL AND is_favorite=1 THEN 1 END) AS favorites, COUNT(CASE WHEN deleted_at IS NULL AND reading_status='unread' THEN 1 END) AS unread, COUNT(CASE WHEN deleted_at IS NULL AND reading_status='reading' THEN 1 END) AS reading, COUNT(CASE WHEN deleted_at IS NULL AND reading_status='read' THEN 1 END) AS read, COUNT(CASE WHEN deleted_at IS NOT NULL THEN 1 END) AS trash, COUNT(CASE WHEN deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM item_categories ic WHERE ic.item_id=items.id) THEN 1 END) AS uncategorized, COUNT(CASE WHEN deleted_at IS NULL AND julianday(created_at)>=julianday('now','-30 days') THEN 1 END) AS recent FROM items")
        .fetch_one(pool).await?;
    Ok(Catalog {
        categories,
        tags,
        stats,
    })
}

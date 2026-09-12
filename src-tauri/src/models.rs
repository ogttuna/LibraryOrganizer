use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub item_id: String,
    pub original_filename: String,
    pub relative_path: String,
    pub mime_type: String,
    pub format: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub last_page: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub authors: Vec<String>,
    pub year: Option<i64>,
    pub language: String,
    pub description: String,
    pub summary: String,
    pub notes: String,
    pub reading_status: String,
    pub is_favorite: bool,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub category_ids: Vec<String>,
    pub tag_ids: Vec<String>,
    pub attachments: Vec<Attachment>,
}

#[derive(sqlx::FromRow)]
pub(crate) struct ItemRow {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub authors_json: String,
    pub year: Option<i64>,
    pub language: String,
    pub description: String,
    pub summary: String,
    pub notes: String,
    pub reading_status: String,
    pub is_favorite: bool,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

impl TryFrom<ItemRow> for Item {
    type Error = serde_json::Error;
    fn try_from(row: ItemRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: row.id,
            title: row.title,
            kind: row.kind,
            authors: serde_json::from_str(&row.authors_json)?,
            year: row.year,
            language: row.language,
            description: row.description,
            summary: row.summary,
            notes: row.notes,
            reading_status: row.reading_status,
            is_favorite: row.is_favorite,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
            category_ids: vec![],
            tag_ids: vec![],
            attachments: vec![],
        })
    }
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub total: i64,
    pub favorites: i64,
    pub unread: i64,
    pub reading: i64,
    pub read: i64,
    pub trash: i64,
    pub uncategorized: i64,
    pub recent: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub categories: Vec<Category>,
    pub tags: Vec<Tag>,
    pub stats: Stats,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ItemPatch {
    pub title: Option<String>,
    pub kind: Option<String>,
    pub authors: Option<Vec<String>>,
    // JSON null clears the year, absence leaves it unchanged.
    #[serde(deserialize_with = "deserialize_optional_year")]
    pub year: Option<Option<i64>>,
    pub language: Option<String>,
    pub description: Option<String>,
    pub summary: Option<String>,
    pub notes: Option<String>,
    pub reading_status: Option<String>,
    pub is_favorite: Option<bool>,
    pub category_ids: Option<Vec<String>>,
    pub tag_names: Option<Vec<String>>,
}

fn deserialize_optional_year<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Option<i64>>, D::Error> {
    Option::<i64>::deserialize(d).map(Some)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LibraryQuery {
    pub view: String,
    pub q: String,
    pub category_ids: Vec<String>,
    pub include_descendants: bool,
    pub tag_ids: Vec<String>,
    pub tag_mode: String,
    pub kind: String,
    pub format: String,
    pub reading_status: String,
    pub sort: String,
    pub limit: i64,
    pub offset: i64,
}

impl Default for LibraryQuery {
    fn default() -> Self {
        Self {
            view: "all".into(),
            q: String::new(),
            category_ids: vec![],
            include_descendants: true,
            tag_ids: vec![],
            tag_mode: "all".into(),
            kind: String::new(),
            format: String::new(),
            reading_status: String::new(),
            sort: "recent".into(),
            limit: 100,
            offset: 0,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPage {
    pub items: Vec<Item>,
    pub total: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub filename: String,
    pub status: String,
    pub item_id: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryInput {
    pub id: Option<String>,
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkChange {
    pub item_ids: Vec<String>,
    pub category_ids: Option<Vec<String>>,
    pub tag_names: Option<Vec<String>>,
    pub reading_status: Option<String>,
    pub trashed: Option<bool>,
}

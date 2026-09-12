CREATE TABLE items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500),
    kind TEXT NOT NULL DEFAULT 'book' CHECK(kind IN ('book','article','other')),
    authors_json TEXT NOT NULL DEFAULT '[]',
    year INTEGER CHECK(year BETWEEN 1 AND 9999),
    language TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    reading_status TEXT NOT NULL DEFAULT 'unread' CHECK(reading_status IN ('unread','reading','read')),
    is_favorite INTEGER NOT NULL DEFAULT 0 CHECK(is_favorite IN (0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);
CREATE INDEX items_live_updated ON items(deleted_at, updated_at DESC);
CREATE INDEX items_reading ON items(reading_status, deleted_at);
CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    original_filename TEXT NOT NULL,
    relative_path TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    format TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
    sha256 TEXT NOT NULL UNIQUE,
    last_page INTEGER NOT NULL DEFAULT 1 CHECK(last_page >= 1),
    created_at TEXT NOT NULL
);
CREATE INDEX attachments_item ON attachments(item_id);
CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
    parent_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    CHECK(parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX categories_sibling_name ON categories(COALESCE(parent_id, ''), name);
CREATE TABLE item_categories (
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY(item_id, category_id)
);
CREATE INDEX item_categories_reverse ON item_categories(category_id, item_id);
CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE CHECK(length(trim(name)) BETWEEN 1 AND 80)
);
CREATE TABLE item_tags (
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY(item_id, tag_id)
);
CREATE INDEX item_tags_reverse ON item_tags(tag_id, item_id);
CREATE VIRTUAL TABLE item_search USING fts5(
    item_id UNINDEXED, title, authors, body, taxonomy, filenames,
    tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TABLE import_jobs (
    id TEXT PRIMARY KEY,
    original_filename TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('copying','ready','failed','duplicate')),
    error TEXT,
    created_at TEXT NOT NULL
);

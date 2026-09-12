use folio_lib::{
    library::Library,
    models::{BulkChange, LibraryQuery},
};
use std::fs;

#[tokio::test]
async fn empty_trash_removes_only_trashed_managed_copies_and_retains_originals() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("library");
    let library = Library::open(&root).await.unwrap();
    let source = temp.path().join("source.pdf");
    fs::write(&source, b"%PDF archived copy").unwrap();
    let id = library
        .import_file(&source, None, &[])
        .await
        .unwrap()
        .item_id
        .unwrap();
    let attachment = library.get_item(&id).await.unwrap().attachments.remove(0);
    let live = library
        .create_item("Korunan kayıt", "article")
        .await
        .unwrap();
    library
        .bulk_update(BulkChange {
            item_ids: vec![id.clone()],
            trashed: Some(true),
            ..Default::default()
        })
        .await
        .unwrap();
    let result = library.empty_trash().await.unwrap();
    assert_eq!(result.deleted_count, 1);
    assert_eq!(result.pending_file_count, 0);
    assert!(!root.join(attachment.relative_path).exists());
    assert_eq!(fs::read(&source).unwrap(), b"%PDF archived copy");
    assert!(library.get_item(&live.id).await.is_ok());
    assert!(library.get_item(&id).await.is_err());
    assert_eq!(
        library
            .query(LibraryQuery {
                view: "trash".into(),
                ..Default::default()
            })
            .await
            .unwrap()
            .total,
        0
    );
    assert_eq!(library.empty_trash().await.unwrap().deleted_count, 0);
    // Hash uniqueness was released; the original can be imported as a new record.
    assert_eq!(
        library
            .import_file(&source, None, &[])
            .await
            .unwrap()
            .status,
        "imported"
    );
    library.close().await;
}

#[tokio::test]
async fn startup_replays_cleanup_and_never_deletes_still_referenced_attachments() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("library");
    let library = Library::open(&root).await.unwrap();
    let source = temp.path().join("source.pdf");
    fs::write(&source, b"%PDF live copy").unwrap();
    let id = library
        .import_file(&source, None, &[])
        .await
        .unwrap()
        .item_id
        .unwrap();
    let live = library.get_item(&id).await.unwrap().attachments.remove(0);
    library.close().await;
    let orphan = uuid::Uuid::new_v4().to_string();
    let relative = format!("files/{orphan}/original.pdf");
    fs::create_dir(root.join("files").join(&orphan)).unwrap();
    fs::write(
        root.join(&relative),
        b"committed deletion, interrupted cleanup",
    )
    .unwrap();
    let pool = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new().filename(root.join("library.sqlite")),
    )
    .await
    .unwrap();
    for (id, path) in [(&orphan, &relative), (&live.id, &live.relative_path)] {
        sqlx::query("INSERT INTO deletion_jobs(attachment_id,relative_path,created_at) VALUES (?,?,'2026-09-12')").bind(id).bind(path).execute(&pool).await.unwrap();
    }
    pool.close().await;
    let recovered = Library::open(&root).await.unwrap();
    assert!(!root.join(relative).exists());
    assert!(root.join(live.relative_path).exists());
    assert_eq!(recovered.empty_trash().await.unwrap().pending_file_count, 1);
    recovered.close().await;
}

#[tokio::test]
async fn invalid_stored_path_rejects_entire_deletion_before_any_item_is_removed() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("library");
    let library = Library::open(&root).await.unwrap();
    let source = temp.path().join("source.pdf");
    fs::write(&source, b"%PDF protected original").unwrap();
    let id = library
        .import_file(&source, None, &[])
        .await
        .unwrap()
        .item_id
        .unwrap();
    library
        .bulk_update(BulkChange {
            item_ids: vec![id.clone()],
            trashed: Some(true),
            ..Default::default()
        })
        .await
        .unwrap();
    let pool = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new().filename(root.join("library.sqlite")),
    )
    .await
    .unwrap();
    sqlx::query("UPDATE attachments SET relative_path='../source.pdf'")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
    assert!(library.empty_trash().await.is_err());
    assert!(library.get_item(&id).await.is_ok());
    assert!(source.exists());
    library.close().await;
}

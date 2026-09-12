use folio_lib::{
    library::Library,
    models::{BulkChange, CategoryInput, ItemPatch, LibraryQuery},
};
use serde_json::json;
use std::{fs, io::Read};
use tempfile::TempDir;

fn patch(value: serde_json::Value) -> ItemPatch {
    serde_json::from_value(value).unwrap()
}
async fn fixture() -> (TempDir, Library) {
    let temp = tempfile::tempdir().unwrap();
    let library = Library::open(temp.path().join("library")).await.unwrap();
    (temp, library)
}
async fn category(library: &Library, name: &str, parent: Option<&str>) -> String {
    library
        .save_category(CategoryInput {
            id: None,
            name: name.into(),
            parent_id: parent.map(str::to_owned),
        })
        .await
        .unwrap()
}

#[tokio::test]
async fn files_are_copied_deduplicated_and_multiple_formats_share_one_item() {
    let (temp, library) = fixture().await;
    let source = temp.path().join("Öğrenme_notları.pdf");
    fs::write(&source, b"%PDF-1.7\nfixture document").unwrap();
    let result = library.import_file(&source, None, &[]).await.unwrap();
    let id = result.item_id.unwrap();
    let renamed = temp.path().join("baska-ad.pdf");
    fs::copy(&source, &renamed).unwrap();
    let duplicate = library.import_file(&renamed, None, &[]).await.unwrap();
    assert_eq!(duplicate.status, "duplicate");
    assert_eq!(duplicate.item_id.as_deref(), Some(id.as_str()));
    let epub = temp.path().join("kitap.epub");
    fs::write(&epub, b"PK-test-epub-file").unwrap();
    library.import_file(&epub, Some(&id), &[]).await.unwrap();
    let item = library
        .update_item(
            &id,
            patch(json!({"notes":"Tek kaynak, ortak notlar", "readingStatus":"read"})),
        )
        .await
        .unwrap();
    assert_eq!(item.attachments.len(), 2);
    assert_eq!(library.catalog().await.unwrap().stats.total, 1);
    assert_eq!(fs::read(&source).unwrap(), b"%PDF-1.7\nfixture document");
    assert!(!std::path::Path::new(&item.attachments[0].relative_path).is_absolute());
    assert_eq!(
        fs::read_dir(temp.path().join("library/files"))
            .unwrap()
            .count(),
        2
    );
    assert_eq!(
        fs::read_dir(temp.path().join("library/.staging"))
            .unwrap()
            .count(),
        0
    );
    library.close().await;
    let reopened = Library::open(temp.path().join("library")).await.unwrap();
    let restored = reopened.get_item(&id).await.unwrap();
    assert_eq!(restored.notes, "Tek kaynak, ortak notlar");
    assert_eq!(restored.reading_status, "read");
    assert_eq!(restored.attachments.len(), 2);
}

#[tokio::test]
async fn many_categories_remove_only_membership_and_bulk_adds_without_replacing() {
    let (_temp, library) = fixture().await;
    let item = library.create_item("Kaynak", "book").await.unwrap();
    let a = category(&library, "A", None).await;
    let b = category(&library, "B", None).await;
    let c = category(&library, "C", None).await;
    library
        .update_item(
            &item.id,
            patch(
                json!({"categoryIds":[a,b,c], "tagNames":["Özgün", "Ozgun"], "notes":"Korunacak"}),
            ),
        )
        .await
        .unwrap();
    let updated = library
        .update_item(&item.id, patch(json!({"categoryIds":[a,c]})))
        .await
        .unwrap();
    assert_eq!(updated.category_ids.len(), 2);
    assert_eq!(updated.notes, "Korunacak");
    assert_eq!(updated.tag_ids.len(), 2);
    library
        .bulk_update(BulkChange {
            item_ids: vec![item.id.clone()],
            category_ids: Some(vec![b.clone(), b.clone()]),
            tag_names: Some(vec!["ek".into()]),
            ..Default::default()
        })
        .await
        .unwrap();
    let updated = library.get_item(&item.id).await.unwrap();
    assert_eq!(updated.category_ids.len(), 3);
    assert_eq!(updated.tag_ids.len(), 3);
}

#[tokio::test]
async fn category_cycles_and_invalid_updates_are_atomic() {
    let (_temp, library) = fixture().await;
    let a = category(&library, "Üst", None).await;
    let b = category(&library, "Alt", Some(&a)).await;
    let c = category(&library, "Torun", Some(&b)).await;
    assert!(library
        .save_category(CategoryInput {
            id: Some(a.clone()),
            name: "Üst".into(),
            parent_id: Some(c)
        })
        .await
        .is_err());
    assert!(library
        .save_category(CategoryInput {
            id: Some(b.clone()),
            name: "Alt".into(),
            parent_id: Some(b)
        })
        .await
        .is_err());
    let item = library
        .create_item("Özgün başlık", "article")
        .await
        .unwrap();
    assert!(library
        .update_item(
            &item.id,
            patch(json!({"title":"Değişmesin","categoryIds":["olmayan-kategori"]}))
        )
        .await
        .is_err());
    assert_eq!(
        library.get_item(&item.id).await.unwrap().title,
        "Özgün başlık"
    );
    assert_eq!(
        library
            .query(LibraryQuery {
                q: "ozgun".into(),
                ..Default::default()
            })
            .await
            .unwrap()
            .total,
        1
    );
}

#[tokio::test]
async fn turkish_search_taxonomy_rename_filters_and_rebuild() {
    let (temp, library) = fixture().await;
    let root = category(&library, "Bilim", None).await;
    let child = category(&library, "Psikoloji", Some(&root)).await;
    let source = temp.path().join("orneklem-dosyasi.pdf");
    fs::write(&source, b"%PDF-1.7 test").unwrap();
    let id = library
        .import_file(&source, None, std::slice::from_ref(&child))
        .await
        .unwrap()
        .item_id
        .unwrap();
    library.update_item(&id, patch(json!({"title":"Öğrenme IŞIK İstanbul", "notes":"Örneklem seçimi", "tagNames":["metodoloji","referans"], "readingStatus":"reading"}))).await.unwrap();
    for text in [
        "ogrenme isik istanbul",
        "örneklem",
        "psikoloji",
        "orneklem dosyasi",
        "metodoloji",
    ] {
        assert_eq!(
            library
                .query(LibraryQuery {
                    q: text.into(),
                    ..Default::default()
                })
                .await
                .unwrap()
                .total,
            1,
            "{text}"
        );
    }
    assert_eq!(
        library
            .query(LibraryQuery {
                category_ids: vec![root.clone()],
                include_descendants: true,
                format: "pdf".into(),
                reading_status: "reading".into(),
                ..Default::default()
            })
            .await
            .unwrap()
            .total,
        1
    );
    assert_eq!(
        library
            .query(LibraryQuery {
                category_ids: vec![root],
                include_descendants: false,
                ..Default::default()
            })
            .await
            .unwrap()
            .total,
        0
    );
    let tags: Vec<_> = library
        .catalog()
        .await
        .unwrap()
        .tags
        .into_iter()
        .map(|t| t.id)
        .collect();
    assert_eq!(
        library
            .query(LibraryQuery {
                tag_ids: tags.clone(),
                ..Default::default()
            })
            .await
            .unwrap()
            .total,
        1
    );
    let mut missing = tags;
    missing.push("missing".into());
    assert_eq!(
        library
            .query(LibraryQuery {
                tag_ids: missing.clone(),
                tag_mode: "all".into(),
                ..Default::default()
            })
            .await
            .unwrap()
            .total,
        0
    );
    assert_eq!(
        library
            .query(LibraryQuery {
                tag_ids: missing,
                tag_mode: "any".into(),
                ..Default::default()
            })
            .await
            .unwrap()
            .total,
        1
    );
    library
        .save_category(CategoryInput {
            id: Some(child),
            name: "Davranış".into(),
            parent_id: None,
        })
        .await
        .unwrap();
    assert_eq!(
        library
            .query(LibraryQuery {
                q: "psikoloji".into(),
                ..Default::default()
            })
            .await
            .unwrap()
            .total,
        0
    );
    assert_eq!(
        library
            .query(LibraryQuery {
                q: "davranis".into(),
                ..Default::default()
            })
            .await
            .unwrap()
            .total,
        1
    );
    let pool = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new()
            .filename(temp.path().join("library/library.sqlite")),
    )
    .await
    .unwrap();
    sqlx::query("DROP TABLE item_search")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
    library.rebuild_search().await.unwrap();
    assert_eq!(
        library.get_item(&id).await.unwrap().notes,
        "Örneklem seçimi"
    );
    assert_eq!(
        library
            .query(LibraryQuery {
                q: "ogrenme".into(),
                ..Default::default()
            })
            .await
            .unwrap()
            .total,
        1
    );
    assert_eq!(
        library
            .query(LibraryQuery {
                q: "\" OR 1=1; DROP TABLE items; --".into(),
                ..Default::default()
            })
            .await
            .unwrap()
            .total,
        0
    );
}

#[tokio::test]
async fn trash_restore_preserves_metadata_and_year_can_be_cleared() {
    let (_temp, library) = fixture().await;
    let item = library.create_item("Kitap", "book").await.unwrap();
    library
        .update_item(
            &item.id,
            patch(
                json!({"year":2024,"isFavorite":true,"notes":"Kişisel not","readingStatus":"read"}),
            ),
        )
        .await
        .unwrap();
    library
        .update_item(&item.id, patch(json!({"summary":"Özet"})))
        .await
        .unwrap();
    assert_eq!(library.get_item(&item.id).await.unwrap().year, Some(2024));
    library
        .update_item(&item.id, patch(json!({"year":null})))
        .await
        .unwrap();
    assert_eq!(library.get_item(&item.id).await.unwrap().year, None);
    library
        .bulk_update(BulkChange {
            item_ids: vec![item.id.clone()],
            trashed: Some(true),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(
        library.query(LibraryQuery::default()).await.unwrap().total,
        0
    );
    assert_eq!(
        library
            .query(LibraryQuery {
                view: "trash".into(),
                ..Default::default()
            })
            .await
            .unwrap()
            .total,
        1
    );
    library
        .bulk_update(BulkChange {
            item_ids: vec![item.id.clone()],
            trashed: Some(false),
            ..Default::default()
        })
        .await
        .unwrap();
    let restored = library.get_item(&item.id).await.unwrap();
    assert_eq!(restored.notes, "Kişisel not");
    assert!(restored.is_favorite);
    assert_eq!(restored.reading_status, "read");
}

#[tokio::test]
async fn failed_import_cleans_up_and_does_not_poison_the_next_import() {
    let (temp, library) = fixture().await;
    let source = temp.path().join("sample.pdf");
    fs::write(&source, b"%PDF sample").unwrap();
    assert!(library
        .import_file(&source, None, &["missing-category".into()])
        .await
        .is_err());
    assert_eq!(library.catalog().await.unwrap().stats.total, 0);
    assert_eq!(
        fs::read_dir(temp.path().join("library/files"))
            .unwrap()
            .count(),
        0
    );
    assert_eq!(
        fs::read_dir(temp.path().join("library/.staging"))
            .unwrap()
            .count(),
        0
    );
    assert!(library.import_file(&source, None, &[]).await.is_ok());
    let empty = temp.path().join("empty.pdf");
    fs::write(&empty, b"").unwrap();
    assert!(library.import_file(&empty, None, &[]).await.is_err());
    let exec = temp.path().join("bad.exe");
    fs::write(&exec, b"MZ").unwrap();
    assert!(library.import_file(&exec, None, &[]).await.is_err());
}

#[tokio::test]
async fn startup_recovers_abandoned_staging_and_orphaned_final_file() {
    let (temp, library) = fixture().await;
    let item = library.create_item("Korunan kayıt", "book").await.unwrap();
    library.close().await;
    let job = uuid::Uuid::new_v4().to_string();
    let root = temp.path().join("library");
    let conn = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new().filename(root.join("library.sqlite")),
    )
    .await
    .unwrap();
    sqlx::query("INSERT INTO import_jobs(id,original_filename,relative_path,status,created_at) VALUES (?, 'half.pdf', ?, 'copying', '2026-09-12')").bind(&job).bind(format!("files/{job}/original.pdf")).execute(&conn).await.unwrap();
    conn.close().await;
    fs::write(root.join(".staging").join(&job), b"partial").unwrap();
    fs::create_dir(root.join("files").join(&job)).unwrap();
    fs::write(
        root.join("files").join(&job).join("original.pdf"),
        b"orphan",
    )
    .unwrap();
    let reopened = Library::open(&root).await.unwrap();
    assert!(!root.join(".staging").join(&job).exists());
    assert!(!root.join("files").join(&job).exists());
    assert_eq!(
        reopened.get_item(&item.id).await.unwrap().title,
        "Korunan kayıt"
    );
}

#[tokio::test]
async fn backup_contains_a_consistent_portable_library_and_never_overwrites() {
    let (temp, library) = fixture().await;
    let source = temp.path().join("kitap.pdf");
    fs::write(&source, b"%PDF backup fixture").unwrap();
    let id = library
        .import_file(&source, None, &[])
        .await
        .unwrap()
        .item_id
        .unwrap();
    library
        .update_item(
            &id,
            patch(json!({"notes":"Yedeklenen not", "tagNames":["koru"]})),
        )
        .await
        .unwrap();
    let destination = temp.path().join("test.folio");
    library.create_backup(&destination).await.unwrap();
    assert!(library.create_backup(&destination).await.is_err());
    assert!(library
        .create_backup(&temp.path().join("library/inside.folio"))
        .await
        .is_err());
    let mut archive = zip::ZipArchive::new(fs::File::open(&destination).unwrap()).unwrap();
    let mut manifest = String::new();
    archive
        .by_name("manifest.json")
        .unwrap()
        .read_to_string(&mut manifest)
        .unwrap();
    let manifest: serde_json::Value = serde_json::from_str(&manifest).unwrap();
    assert_eq!(manifest["formatVersion"], 1);
    let restored_root = temp.path().join("restored");
    archive.extract(&restored_root).unwrap();
    let restored = Library::open(&restored_root).await.unwrap();
    let item = restored.get_item(&id).await.unwrap();
    assert_eq!(item.notes, "Yedeklenen not");
    assert_eq!(item.tag_ids.len(), 1);
    assert_eq!(
        fs::read(
            restored
                .attachment_path(&item.attachments[0].id)
                .await
                .unwrap()
        )
        .unwrap(),
        b"%PDF backup fixture"
    );
    fs::write(
        library
            .attachment_path(&item.attachments[0].id)
            .await
            .unwrap(),
        b"tampered",
    )
    .unwrap();
    let rejected = temp.path().join("rejected.folio");
    assert!(library.create_backup(&rejected).await.is_err());
    assert!(!rejected.exists());
}

#[tokio::test]
async fn attachment_access_rejects_database_path_escape() {
    let (temp, library) = fixture().await;
    let source = temp.path().join("private.pdf");
    fs::write(&source, b"%PDF private").unwrap();
    let id = library
        .import_file(&source, None, &[])
        .await
        .unwrap()
        .item_id
        .unwrap();
    let attachment = library.get_item(&id).await.unwrap().attachments.remove(0);
    let pool = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new()
            .filename(temp.path().join("library/library.sqlite")),
    )
    .await
    .unwrap();
    sqlx::query("UPDATE attachments SET relative_path='../private.pdf' WHERE id=?")
        .bind(&attachment.id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(library.attachment_path(&attachment.id).await.is_err());
    pool.close().await;
}

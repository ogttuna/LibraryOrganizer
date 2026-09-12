use folio_lib::{
    library::Library,
    models::{BulkChange, ItemPatch, LibraryQuery},
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

async fn fixture() -> (tempfile::TempDir, Library, String, std::path::PathBuf) {
    let directory = tempfile::tempdir().unwrap();
    let library = Library::open(directory.path().join("library"))
        .await
        .unwrap();
    let source = directory.path().join("Özgün.pdf");
    fs::write(&source, b"%PDF retained original restore fixture").unwrap();
    let id = library
        .import_file(&source, None, &[])
        .await
        .unwrap()
        .item_id
        .unwrap();
    library
        .update_item(
            &id,
            serde_json::from_value::<ItemPatch>(
                json!({"notes":"Yedekteki not", "tagNames":["Öğrenme"], "readingStatus":"read"}),
            )
            .unwrap(),
        )
        .await
        .unwrap();
    let archive = directory.path().join("backup.folio");
    library.create_backup(&archive).await.unwrap();
    (directory, library, id, archive)
}

fn entries(path: &Path) -> Vec<(String, Vec<u8>)> {
    let mut zip = ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
    (0..zip.len())
        .map(|index| {
            let mut entry = zip.by_index(index).unwrap();
            let name = entry.name().to_owned();
            let mut content = Vec::new();
            entry.read_to_end(&mut content).unwrap();
            (name, content)
        })
        .collect()
}

fn write_archive(path: &Path, entries: &[(String, Vec<u8>)]) {
    let mut writer = ZipWriter::new(fs::File::create(path).unwrap());
    for (name, content) in entries {
        writer
            .start_file(name, SimpleFileOptions::default())
            .unwrap();
        writer.write_all(content).unwrap();
    }
    writer.finish().unwrap();
}

async fn change_database(
    source: &Path,
    destination: &Path,
    sql: &str,
    schema_version: Option<u32>,
) {
    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("snapshot.sqlite");
    let mut content = entries(source);
    fs::write(
        &database,
        &content
            .iter()
            .find(|(name, _)| name == "library.sqlite")
            .unwrap()
            .1,
    )
    .unwrap();
    let pool = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&database)
            .foreign_keys(false)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Delete),
    )
    .await
    .unwrap();
    sqlx::raw_sql(sql).execute(&pool).await.unwrap();
    pool.close().await;
    let bytes = fs::read(database).unwrap();
    let hash = format!("{:x}", Sha256::digest(&bytes));
    content
        .iter_mut()
        .find(|(name, _)| name == "library.sqlite")
        .unwrap()
        .1 = bytes;
    let manifest_bytes = &mut content
        .iter_mut()
        .find(|(name, _)| name == "manifest.json")
        .unwrap()
        .1;
    let mut manifest: Value = serde_json::from_slice(manifest_bytes).unwrap();
    manifest["databaseSha256"] = json!(hash);
    if let Some(version) = schema_version {
        manifest["schemaVersion"] = json!(version);
    }
    *manifest_bytes = serde_json::to_vec(&manifest).unwrap();
    write_archive(destination, &content);
}

#[tokio::test]
async fn restore_is_reviewable_and_preserves_the_previous_library() {
    let (temp, library, id, archive) = fixture().await;
    library
        .update_item(
            &id,
            serde_json::from_value(json!({"notes":"En son not, önceki arşivde korunacak"}))
                .unwrap(),
        )
        .await
        .unwrap();
    let added = library
        .create_item("Yedek sonrası kayıt", "article")
        .await
        .unwrap();
    let preview = library.prepare_restore(&archive).await.unwrap();
    assert_eq!(preview.item_count, 1);
    assert_eq!(preview.attachment_count, 1);
    assert!(library.get_item(&added.id).await.is_ok());
    let previous = library.schedule_restore(&preview.id).await.unwrap();
    assert!(library.get_item(&added.id).await.is_ok());
    library.close().await;
    let restored = Library::open(temp.path().join("library")).await.unwrap();
    assert!(restored.get_item(&added.id).await.is_err());
    let item = restored.get_item(&id).await.unwrap();
    assert_eq!(item.notes, "Yedekteki not");
    assert_eq!(item.reading_status, "read");
    assert_eq!(item.tag_ids.len(), 1);
    assert_eq!(
        restored
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
        fs::read(
            restored
                .attachment_path(&item.attachments[0].id)
                .await
                .unwrap()
        )
        .unwrap(),
        fs::read(temp.path().join("Özgün.pdf")).unwrap()
    );
    let previous = Library::open(previous).await.unwrap();
    assert_eq!(
        previous.get_item(&id).await.unwrap().notes,
        "En son not, önceki arşivde korunacak"
    );
    assert!(previous.get_item(&added.id).await.is_ok());
    restored.close().await;
    previous.close().await;
}

#[tokio::test]
async fn cancel_restore_and_reject_cross_library_or_modified_staging() {
    let (temp, library, id, archive) = fixture().await;
    let preview = library.prepare_restore(&archive).await.unwrap();
    let other = Library::open(temp.path().join("other")).await.unwrap();
    assert!(other.schedule_restore(&preview.id).await.is_err());
    assert!(other.cancel_restore(&preview.id).await.is_err());
    let stage = temp.path().join(format!(".folio-restore-{}", preview.id));
    let attachment = library.get_item(&id).await.unwrap().attachments.remove(0);
    fs::write(stage.join(attachment.relative_path), b"tampered").unwrap();
    assert!(library.schedule_restore(&preview.id).await.is_err());
    assert!(library.get_item(&id).await.is_ok());
    library.cancel_restore(&preview.id).await.unwrap();
    assert!(!stage.exists());
    assert!(library.cancel_restore("../../library").await.is_err());
    library.close().await;
    other.close().await;
}

#[tokio::test]
async fn unsafe_members_corrupt_files_and_wrong_manifests_never_change_the_library() {
    let (temp, library, id, archive) = fixture().await;
    for name in [
        "../outside.txt",
        "files\\escape\\original.pdf",
        "C:/outside.txt",
        "/absolute.txt",
        "unexpected.txt",
    ] {
        let mut content = entries(&archive);
        content.push((name.into(), b"unsafe".to_vec()));
        let invalid = temp.path().join("invalid.folio");
        write_archive(&invalid, &content);
        assert!(library.prepare_restore(&invalid).await.is_err(), "{name}");
    }
    let invalid = temp.path().join("invalid.folio");
    let mut content = entries(&archive);
    content
        .iter_mut()
        .find(|(name, _)| name.starts_with("files/"))
        .unwrap()
        .1
        .push(0);
    write_archive(&invalid, &content);
    assert!(library.prepare_restore(&invalid).await.is_err());
    let mut content = entries(&archive);
    let bytes = &mut content
        .iter_mut()
        .find(|(name, _)| name == "manifest.json")
        .unwrap()
        .1;
    let mut manifest: Value = serde_json::from_slice(bytes).unwrap();
    manifest["attachments"][0]["originalFilename"] = json!("forged.pdf");
    *bytes = serde_json::to_vec(&manifest).unwrap();
    write_archive(&invalid, &content);
    assert!(library.prepare_restore(&invalid).await.is_err());
    let symlink = temp.path().join("symlink.folio");
    let mut zip = ZipWriter::new(fs::File::create(&symlink).unwrap());
    zip.add_symlink("library.sqlite", "../outside", SimpleFileOptions::default())
        .unwrap();
    zip.start_file("manifest.json", SimpleFileOptions::default())
        .unwrap();
    zip.write_all(b"{}").unwrap();
    zip.finish().unwrap();
    assert!(library.prepare_restore(&symlink).await.is_err());
    let mut content = entries(&archive);
    let manifest = content
        .iter()
        .find(|(name, _)| name == "manifest.json")
        .unwrap()
        .1
        .clone();
    content.push(("manifest.jsoN".into(), manifest));
    write_archive(&invalid, &content);
    let mut bytes = fs::read(&invalid).unwrap();
    for index in 0..bytes.len().saturating_sub(12) {
        if &bytes[index..index + 13] == b"manifest.jsoN" {
            bytes[index + 12] = b'n';
        }
    }
    fs::write(&invalid, bytes).unwrap();
    assert!(
        library.prepare_restore(&invalid).await.is_err(),
        "duplicate ZIP member names must not be silently collapsed"
    );
    assert_eq!(library.get_item(&id).await.unwrap().notes, "Yedekteki not");
    assert!(!temp.path().join("outside.txt").exists());
    assert_eq!(
        fs::read_dir(temp.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with(".folio-restore-"))
            .count(),
        0
    );
    library.close().await;
}

#[tokio::test]
async fn rebuilt_search_schema_can_be_backed_up_and_prepared_staging_is_recovered() {
    let (temp, library, id, _archive) = fixture().await;
    let root = temp.path().join("library");
    let pool = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new().filename(root.join("library.sqlite")),
    )
    .await
    .unwrap();
    sqlx::query("DROP TABLE item_search")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
    library.rebuild_search().await.unwrap();
    let archive = temp.path().join("rebuilt.folio");
    library.create_backup(&archive).await.unwrap();
    let preview = library.prepare_restore(&archive).await.unwrap();
    let stage = temp.path().join(format!(".folio-restore-{}", preview.id));
    assert!(stage.exists());
    library.close().await;
    let reopened = Library::open(root).await.unwrap();
    assert!(
        !stage.exists(),
        "a reviewed but unconfirmed restore must not leak its staged copies after restart"
    );
    assert_eq!(reopened.get_item(&id).await.unwrap().notes, "Yedekteki not");
    reopened.close().await;
}

#[tokio::test]
async fn corrupt_staging_after_interrupted_swap_rolls_the_previous_library_back() {
    let (temp, library, id, archive) = fixture().await;
    let preview = library.prepare_restore(&archive).await.unwrap();
    let previous = library.schedule_restore(&preview.id).await.unwrap();
    library.close().await;
    let root = temp.path().join("library");
    fs::rename(&root, previous).unwrap();
    let stage = temp.path().join(format!(".folio-restore-{}", preview.id));
    fs::write(stage.join("library.sqlite"), b"corrupt after power failure").unwrap();
    assert!(Library::open(&root).await.is_err());
    assert!(root.join("library.sqlite").exists());
    let reopened = Library::open(&root).await.unwrap();
    assert_eq!(reopened.get_item(&id).await.unwrap().notes, "Yedekteki not");
    assert!(!stage.exists());
    reopened.close().await;
}

#[tokio::test]
async fn extra_staged_database_sidecars_are_rejected_before_restore() {
    let (temp, library, _id, archive) = fixture().await;
    let preview = library.prepare_restore(&archive).await.unwrap();
    let stage = temp.path().join(format!(".folio-restore-{}", preview.id));
    fs::write(stage.join("library.sqlite-wal"), b"unverified sidecar").unwrap();
    assert!(library.schedule_restore(&preview.id).await.is_err());
    library.cancel_restore(&preview.id).await.unwrap();
    library.close().await;
}

#[tokio::test]
async fn database_schema_relations_cycles_and_author_types_are_validated() {
    let (temp, library, _id, archive) = fixture().await;
    for sql in [
        "CREATE TABLE surprise(value TEXT)",
        "UPDATE attachments SET item_id='missing-parent'",
        "INSERT INTO categories(id,name,parent_id) VALUES('a','A','b'),('b','B','a')",
        "UPDATE items SET authors_json='{}'",
        "UPDATE _sqlx_migrations SET checksum=x'00' WHERE version=1",
    ] {
        let invalid = temp.path().join("invalid.folio");
        change_database(&archive, &invalid, sql, None).await;
        assert!(library.prepare_restore(&invalid).await.is_err(), "{sql}");
    }
    library.close().await;
}

#[tokio::test]
async fn initial_schema_backups_upgrade_after_restore() {
    let (temp, library, id, archive) = fixture().await;
    let legacy = temp.path().join("legacy.folio");
    change_database(
        &archive,
        &legacy,
        "DROP TABLE deletion_jobs; DELETE FROM _sqlx_migrations WHERE version=2;",
        Some(1),
    )
    .await;
    let preview = library.prepare_restore(&legacy).await.unwrap();
    library.schedule_restore(&preview.id).await.unwrap();
    library.close().await;
    let reopened = Library::open(temp.path().join("library")).await.unwrap();
    reopened
        .bulk_update(BulkChange {
            item_ids: vec![id],
            trashed: Some(true),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(reopened.empty_trash().await.unwrap().deleted_count, 1);
    reopened.close().await;
}

#[tokio::test]
async fn startup_replays_interruption_between_both_directory_renames() {
    for after_second_rename in [false, true] {
        let (temp, library, id, archive) = fixture().await;
        let preview = library.prepare_restore(&archive).await.unwrap();
        let previous = library.schedule_restore(&preview.id).await.unwrap();
        library.close().await;
        let root = temp.path().join("library");
        fs::rename(&root, &previous).unwrap();
        if after_second_rename {
            fs::rename(
                temp.path().join(format!(".folio-restore-{}", preview.id)),
                &root,
            )
            .unwrap();
        }
        let recovered = Library::open(&root).await.unwrap();
        assert_eq!(
            recovered.get_item(&id).await.unwrap().notes,
            "Yedekteki not"
        );
        assert!(Path::new(&previous).join("library.sqlite").exists());
        assert!(!temp.path().join(".folio-library-restore.json").exists());
        recovered.close().await;
    }
}

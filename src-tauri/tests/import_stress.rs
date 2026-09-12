use folio_lib::{library::Library, models::LibraryQuery};
use sha2::{Digest, Sha256};
use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
    process::{Command, Stdio},
    sync::Arc,
    time::{Duration, Instant},
};

const LARGE_BYTES: u64 = 128 * 1024 * 1024;
fn sparse_document(path: &Path) {
    let mut file = fs::File::create(path).unwrap();
    file.write_all(b"Folio import interruption source\n")
        .unwrap();
    file.set_len(LARGE_BYTES).unwrap();
}
fn hash_file(path: &Path) -> String {
    let mut file = fs::File::open(path).unwrap();
    let mut hash = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let bytes = file.read(&mut buf).unwrap();
        if bytes == 0 {
            break;
        }
        hash.update(&buf[..bytes]);
    }
    format!("{:x}", hash.finalize())
}
async fn connection(root: &Path) -> SqliteConnection {
    SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(root.join("library.sqlite"))
            .busy_timeout(Duration::from_secs(5)),
    )
    .await
    .unwrap()
}
async fn verify_archive(library: &Library, expected: usize) {
    let page = library.query(LibraryQuery::default()).await.unwrap();
    assert_eq!(page.total, expected as i64);
    let mut attachments = 0;
    for item in &page.items {
        for attachment in &item.attachments {
            let path = library.attachment_path(&attachment.id).await.unwrap();
            assert_eq!(
                fs::metadata(&path).unwrap().len(),
                attachment.size_bytes as u64
            );
            assert_eq!(hash_file(&path), attachment.sha256);
            attachments += 1;
        }
    }
    assert_eq!(attachments, expected);
    assert_eq!(
        fs::read_dir(library.root().join("files")).unwrap().count(),
        expected
    );
    assert_eq!(
        fs::read_dir(library.root().join(".staging"))
            .unwrap()
            .count(),
        0
    );
    let mut conn = connection(library.root()).await;
    let copying: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM import_jobs WHERE status='copying'")
            .fetch_one(&mut conn)
            .await
            .unwrap();
    assert_eq!(copying, 0);
    let violations = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(&mut conn)
        .await
        .unwrap();
    assert!(violations.is_empty());
    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(&mut conn)
        .await
        .unwrap();
    assert_eq!(integrity, "ok");
}

/// Launched only by the parent test in a separate OS process, then force-killed.
#[test]
#[ignore = "internal subprocess worker; run by interrupted_hundred_file_import_recovers_and_retries"]
fn import_child_worker() {
    let root = std::path::PathBuf::from(
        std::env::var("FOLIO_STRESS_ROOT").expect("Parent test root required"),
    );
    assert!(
        root.join(".folio-stress-fixture").is_file(),
        "Refusing a non-fixture directory"
    );
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let library = Library::open(root.join("library")).await.unwrap();
        for index in 0..100 {
            library
                .import_file(&root.join(format!("sources/{index:03}.txt")), None, &[])
                .await
                .unwrap();
        }
    });
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn interrupted_hundred_file_import_recovers_and_retries() {
    let temp = tempfile::tempdir().unwrap();
    fs::write(
        temp.path().join(".folio-stress-fixture"),
        b"isolated test data",
    )
    .unwrap();
    let sources = temp.path().join("sources");
    fs::create_dir(&sources).unwrap();
    for index in 0..100 {
        let path = sources.join(format!("{index:03}.txt"));
        if index == 49 {
            sparse_document(&path);
        } else {
            fs::write(
                path,
                format!("Belge {index}: Özgün kaynak dosyası, değişmeden korunmalı.\n").repeat(40),
            )
            .unwrap();
        }
    }
    let root = temp.path().join("library");
    let initialized = Library::open(&root).await.unwrap();
    initialized.close().await;
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "import_child_worker", "--ignored", "--nocapture"])
        .env("FOLIO_STRESS_ROOT", temp.path())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut conn = connection(&root).await;
    let deadline = Instant::now() + Duration::from_secs(30);
    let interrupted_job = loop {
        if let Some(status) = child.try_wait().unwrap() {
            panic!("Worker exited before observed partial copy: {status}");
        }
        let job: Option<String> = sqlx::query_scalar(
            "SELECT id FROM import_jobs WHERE original_filename='049.txt' AND status='copying'",
        )
        .fetch_optional(&mut conn)
        .await
        .unwrap();
        if let Some(job) = job {
            let len = fs::metadata(root.join(".staging").join(&job))
                .map(|m| m.len())
                .unwrap_or(0);
            if len > 0 && len < LARGE_BYTES {
                break (job, len);
            }
        }
        if Instant::now() >= deadline {
            child.kill().unwrap();
            child.wait().unwrap();
            panic!("Partial staging copy not observed");
        }
        tokio::time::sleep(Duration::from_millis(1)).await;
    };
    child.kill().unwrap();
    let status = child.wait().unwrap();
    assert!(!status.success());
    conn.close().await.unwrap();
    let reopened = Library::open(&root).await.unwrap();
    verify_archive(&reopened, 49).await;
    let mut conn = connection(&root).await;
    let status: String = sqlx::query_scalar("SELECT status FROM import_jobs WHERE id=?")
        .bind(&interrupted_job.0)
        .fetch_one(&mut conn)
        .await
        .unwrap();
    assert_eq!(status, "failed");
    for index in 0..100 {
        let imported = reopened
            .import_file(&sources.join(format!("{index:03}.txt")), None, &[])
            .await
            .unwrap();
        assert_eq!(
            imported.status,
            if index < 49 { "duplicate" } else { "imported" }
        );
    }
    verify_archive(&reopened, 100).await;
    assert_eq!(
        fs::metadata(sources.join("049.txt")).unwrap().len(),
        LARGE_BYTES
    );
    let output = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("output/benchmarks");
    fs::create_dir_all(&output).unwrap();
    fs::write(output.join("import-100-recovery.json"), serde_json::to_vec_pretty(&serde_json::json!({
        "os":std::env::consts::OS,"timestamp":chrono::Utc::now().to_rfc3339(),"sources":100,
        "completedBeforeKill":49,"observedPartialStagingBytes":interrupted_job.1,
        "largeSourceBytes":LARGE_BYTES,"termination":"OS child.kill: SIGKILL on Unix, TerminateProcess on Windows",
        "afterRecovery":"49 ready files with matching SHA256; no staging, orphan directories, pending jobs or FK/integrity errors",
        "afterRetry":"100 ready files with matching SHA256; first 49 deduplicated; original source preserved",
        "storage":"Temporary directory; no user library accessed"
    })).unwrap()).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn source_mutated_during_observed_copy_is_rejected_then_retry_succeeds() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("changing.txt");
    sparse_document(&source);
    let library = Arc::new(Library::open(temp.path().join("library")).await.unwrap());
    let worker_library = Arc::clone(&library);
    let worker_source = source.clone();
    let worker =
        tokio::spawn(async move { worker_library.import_file(&worker_source, None, &[]).await });
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let in_progress = fs::read_dir(library.root().join(".staging"))
            .unwrap()
            .any(|entry| {
                entry
                    .unwrap()
                    .metadata()
                    .map(|m| m.len() > 0 && m.len() < LARGE_BYTES)
                    .unwrap_or(false)
            });
        if in_progress {
            break;
        }
        assert!(
            !worker.is_finished(),
            "Copy completed before mutation could be injected"
        );
        assert!(
            Instant::now() < deadline,
            "No partial staging copy observed"
        );
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    let mut changed = fs::OpenOptions::new().append(true).open(&source).unwrap();
    changed
        .write_all(b"\nSource changed after copy began.")
        .unwrap();
    changed.sync_all().unwrap();
    let error = worker.await.unwrap().unwrap_err();
    assert!(
        error.to_string().contains("kopyalanırken değişti"),
        "{error}"
    );
    verify_archive(&library, 0).await;
    fs::write(&source, "Kararlı, düzeltilmiş kaynak.").unwrap();
    library.import_file(&source, None, &[]).await.unwrap();
    verify_archive(&library, 1).await;
}

#[cfg(unix)]
#[tokio::test]
async fn source_without_read_permission_leaves_no_partial_item() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("unreadable.txt");
    fs::write(&source, b"Private source fixture").unwrap();
    fs::set_permissions(&source, fs::Permissions::from_mode(0o000)).unwrap();
    // A root process bypasses Unix mode bits; explicitly report that rather than inventing an error.
    if fs::File::open(&source).is_ok() {
        fs::set_permissions(&source, fs::Permissions::from_mode(0o600)).unwrap();
        eprintln!("Permission scenario skipped: process can bypass Unix file mode bits.");
        return;
    }
    let library = Library::open(temp.path().join("library")).await.unwrap();
    let result = library.import_file(&source, None, &[]).await;
    fs::set_permissions(&source, fs::Permissions::from_mode(0o600)).unwrap();
    assert!(result.is_err());
    verify_archive(&library, 0).await;
    library.import_file(&source, None, &[]).await.unwrap();
    verify_archive(&library, 1).await;
}

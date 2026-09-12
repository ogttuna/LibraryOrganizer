//! Temporary SQLite/FTS fixture and actual Library::query + JSON serialization benchmark.
//! cargo run --release --manifest-path src-tauri/Cargo.toml --no-default-features --example benchmark --locked
use folio_lib::{library::Library, models::LibraryQuery, search::normalize};
use serde_json::{json, Value};
use sqlx::{sqlite::SqliteConnectOptions, Connection, QueryBuilder, Sqlite, SqliteConnection};
use std::{path::Path, time::Instant};
use uuid::Uuid;

const RECORDS: usize = 10_000;
const RUNS: usize = 30;
const WARMUPS: usize = 3;
const TOPICS: [&str; 10] = [
    "Öğrenme psikolojisi",
    "Işık ve optik",
    "İstanbul kent tarihi",
    "Bilimsel araştırma",
    "Tasarım yöntemleri",
    "Doğa ve ekoloji",
    "İstatistik uygulamaları",
    "Türkçe edebiyat",
    "Yazılım mimarisi",
    "Sanat tarihi",
];
fn item_id(i: usize) -> String {
    Uuid::from_u128(i as u128 + 1).to_string()
}
fn cat_id(i: usize) -> String {
    Uuid::from_u128(i as u128 + 100_001).to_string()
}
fn tag_id(i: usize) -> String {
    Uuid::from_u128(i as u128 + 200_001).to_string()
}
fn attachment_id(i: usize) -> String {
    Uuid::from_u128(i as u128 + 300_001).to_string()
}

async fn seed(path: &Path) -> Result<usize, Box<dyn std::error::Error>> {
    let mut conn = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(path)
            .foreign_keys(true),
    )
    .await?;
    let mut tx = conn.begin().await?;
    for i in 0..40 {
        sqlx::query("INSERT INTO categories(id,name,parent_id) VALUES (?,?,?)")
            .bind(cat_id(i))
            .bind(format!("Arşiv {i:02}"))
            .bind((i >= 20).then(|| cat_id(i - 20)))
            .execute(&mut *tx)
            .await?;
    }
    for i in 0..30 {
        sqlx::query("INSERT INTO tags(id,name) VALUES (?,?)")
            .bind(tag_id(i))
            .bind(format!("konu{i:02}"))
            .execute(&mut *tx)
            .await?;
    }
    let notes = "Örneklem seçimi ve araştırma tasarımı üzerine kişisel not: Bulgular farklı yöntemlerle karşılaştırılmalı, kaynakların sınırlamaları ayrı değerlendirilmelidir. ".repeat(12);
    assert!(notes.len() >= 1024);
    for start in (0..RECORDS).step_by(100) {
        let end = (start + 100).min(RECORDS);
        let mut items = QueryBuilder::<Sqlite>::new("INSERT INTO items(id,title,kind,authors_json,year,language,description,summary,notes,reading_status,is_favorite,created_at,updated_at) ");
        items.push_values(start..end, |mut row, i| {
            row.push_bind(item_id(i))
                .push_bind(format!("{} — Kayıt {i:05}", TOPICS[i % TOPICS.len()]))
                .push_bind(if i.is_multiple_of(2) {
                    "book"
                } else {
                    "article"
                })
                .push_bind(format!(r#"["Ayşe Yılmaz","Araştırmacı {}"]"#, i % 50))
                .push_bind(1990 + (i % 36) as i64)
                .push_bind("Türkçe")
                .push_bind(format!(
                    "{} alanında yöntem ve uygulama çalışması.",
                    TOPICS[i % TOPICS.len()]
                ))
                .push_bind("Çalışmanın sonuçları, kavramsal çerçeve ve değerlendirme özeti.")
                .push_bind(notes.clone())
                .push_bind(["unread", "reading", "read"][i % 3])
                .push_bind(i.is_multiple_of(7))
                .push_bind(format!(
                    "2026-09-{:02}T12:{:02}:{:02}Z",
                    1 + i % 12,
                    i % 60,
                    (i / 60) % 60
                ))
                .push_bind("2026-09-12T12:00:00Z");
        });
        items.build().execute(&mut *tx).await?;
        let mut cats =
            QueryBuilder::<Sqlite>::new("INSERT INTO item_categories(item_id,category_id) ");
        cats.push_values(
            (start..end).flat_map(|i| [(i, i % 20), (i, 20 + (i + 7) % 20)]),
            |mut row, (i, c)| {
                row.push_bind(item_id(i)).push_bind(cat_id(c));
            },
        );
        cats.build().execute(&mut *tx).await?;
        let mut tags = QueryBuilder::<Sqlite>::new("INSERT INTO item_tags(item_id,tag_id) ");
        tags.push_values(
            (start..end).flat_map(|i| (0..3).map(move |offset| (i, (i + offset) % 30))),
            |mut row, (i, tag)| {
                row.push_bind(item_id(i)).push_bind(tag_id(tag));
            },
        );
        tags.build().execute(&mut *tx).await?;
        let mut attachments = QueryBuilder::<Sqlite>::new("INSERT INTO attachments(id,item_id,original_filename,relative_path,mime_type,format,size_bytes,sha256,created_at) ");
        attachments.push_values(start..end, |mut row, i| {
            let format = if i.is_multiple_of(2) { "pdf" } else { "epub" };
            row.push_bind(attachment_id(i))
                .push_bind(item_id(i))
                .push_bind(format!("belge{i:05}.{format}"))
                .push_bind(format!("files/{}/original.{format}", attachment_id(i)))
                .push_bind(if format == "pdf" {
                    "application/pdf"
                } else {
                    "application/epub+zip"
                })
                .push_bind(format)
                .push_bind((2_000_000 + i * 1024) as i64)
                .push_bind(format!("{i:064x}"))
                .push_bind("2026-09-12T12:00:00Z");
        });
        attachments.build().execute(&mut *tx).await?;
    }
    // Use the same derived normalization as production; fixture construction is not timed.
    let rows: Vec<(String, String, String, String, String, String)> =
        sqlx::query_as("SELECT id,title,authors_json,description,summary,notes FROM items")
            .fetch_all(&mut *tx)
            .await?;
    for chunk in rows.chunks(100) {
        let mut index = QueryBuilder::<Sqlite>::new(
            "INSERT INTO item_search(item_id,title,authors,body,taxonomy,filenames) ",
        );
        index.push_values(
            chunk,
            |mut row, (id, title, authors, description, summary, notes)| {
                let i = Uuid::parse_str(id).unwrap().as_u128() as usize - 1;
                let authors: Vec<String> = serde_json::from_str(authors).unwrap();
                let labels = format!(
                    "Arşiv {:02} Arşiv {:02} konu{:02} konu{:02} konu{:02}",
                    i % 20,
                    20 + (i + 7) % 20,
                    i % 30,
                    (i + 1) % 30,
                    (i + 2) % 30
                );
                row.push_bind(id)
                    .push_bind(normalize(title))
                    .push_bind(normalize(&authors.join(" ")))
                    .push_bind(normalize(&format!("{description} {summary} {notes}")))
                    .push_bind(normalize(&labels))
                    .push_bind(format!(
                        "belge{i:05}.{}",
                        if i.is_multiple_of(2) { "pdf" } else { "epub" }
                    ));
            },
        );
        index.build().execute(&mut *tx).await?;
    }
    tx.commit().await?;
    conn.close().await?;
    Ok(notes.len())
}

fn scenario(index: usize) -> (&'static str, LibraryQuery) {
    let mut q = LibraryQuery::default();
    let name = match index {
        0 => "first_page_100",
        1 => {
            q.offset = 9_900;
            "last_page_100"
        }
        2 => {
            q.q = "kayit 04242".into();
            "specific_title"
        }
        3 => {
            q.q = "isik".into();
            "turkish_folded_title"
        }
        4 => {
            q.q = "orneklem".into();
            "broad_notes_search"
        }
        5 => {
            q.q = "belge04242".into();
            "original_filename"
        }
        6 => {
            q.q = "orneklem".into();
            q.category_ids = vec![cat_id(0)];
            q.tag_ids = vec![tag_id(0), tag_id(1)];
            q.format = "pdf".into();
            q.reading_status = "unread".into();
            "category_descendants_all_tags_pdf_unread_notes"
        }
        7 => {
            q.tag_ids = vec![tag_id(0), tag_id(5)];
            q.tag_mode = "any".into();
            "any_selected_tags"
        }
        8 => {
            q.sort = "title".into();
            "turkish_title_sort"
        }
        _ => unreachable!(),
    };
    (name, q)
}
fn percentile(samples: &[f64], fraction: f64) -> f64 {
    samples[((samples.len() as f64 * fraction).ceil() as usize).saturating_sub(1)]
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let output = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("output/benchmarks");
    std::fs::create_dir_all(&output)?;
    let temp = tempfile::tempdir()?;
    let library = Library::open(temp.path().join("library")).await?;
    let seed_start = Instant::now();
    let notes_bytes = seed(&library.root().join("library.sqlite")).await?;
    let seed_ms = seed_start.elapsed().as_secs_f64() * 1000.0;
    assert_eq!(library.catalog().await?.stats.total, RECORDS as i64);
    let mut results: Vec<Value> = vec![];
    for index in 0..9 {
        let mut samples = Vec::with_capacity(RUNS);
        let mut first_observed_ms = 0.0;
        let mut total = 0;
        let mut row_count = 0;
        let mut payload_bytes = 0;
        for iteration in 0..RUNS + WARMUPS {
            let (_, query) = scenario(index);
            let start = Instant::now();
            let page = library.query(query).await?;
            let encoded = serde_json::to_vec(&page)?;
            let ms = start.elapsed().as_secs_f64() * 1000.0;
            assert!(page.total > 0 && !page.items.is_empty());
            assert!(page.items.iter().all(|item| item.notes.len() >= 1024
                && item.category_ids.len() == 2
                && item.tag_ids.len() == 3
                && item.attachments.len() == 1));
            if iteration == 0 {
                first_observed_ms = ms;
            }
            if iteration >= WARMUPS {
                samples.push(ms);
            }
            total = page.total;
            row_count = page.items.len();
            payload_bytes = encoded.len();
        }
        samples.sort_by(f64::total_cmp);
        let (name, query) = scenario(index);
        let result = json!({"scenario":name,"matches":total,"returnedItems":row_count,"serializedBytes":payload_bytes,
            "p50Ms":percentile(&samples,0.5),"p95Ms":percentile(&samples,0.95),"maxMs":samples.last(),
            "p95Under150Ms":percentile(&samples,0.95)<150.0,"firstObservedMs":first_observed_ms,"query":format!("{query:?}")});
        println!(
            "{name}: p50 {:.2} ms / p95 {:.2} ms / {total} matches",
            percentile(&samples, 0.5),
            percentile(&samples, 0.95)
        );
        results.push(result);
    }
    let catalog_start = Instant::now();
    let catalog = library.catalog().await?;
    let catalog_ms = catalog_start.elapsed().as_secs_f64() * 1000.0;
    let report = json!({
        "timestamp":chrono::Utc::now().to_rfc3339(),"os":std::env::consts::OS,"arch":std::env::consts::ARCH,
        "debugAssertions":cfg!(debug_assertions),"parallelism":std::thread::available_parallelism()?.get(),
        "records":RECORDS,"categories":catalog.categories.len(),"tags":catalog.tags.len(),
        "notesBytesPerRecord":notes_bytes,"categoriesPerRecord":2,"tagsPerRecord":3,"attachmentMetadataPerRecord":1,
        "measuredIterations":RUNS,"warmupIterations":WARMUPS,"seedMs":seed_ms,"singleCatalogMs":catalog_ms,
        "measures":"Library::query count, ordering, hydration of metadata/relations/attachments and serde JSON serialization; warm OS/SQLite caches",
        "excludes":"Native IPC transport, frontend rendering/scrolling, cold disk cache, PDF content and binary file IO. Attachment fixture is metadata only.",
        "storage":"Temporary local directory removed at process exit; no user library accessed", "results":results
    });
    std::fs::write(
        output.join("library-10000.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    library.close().await;
    println!("Report: {}", output.join("library-10000.json").display());
    Ok(())
}

use folio_lib::{
    library::Library,
    models::{CategoryInput, ItemPatch, LibraryQuery},
};
use serde_json::json;
use tempfile::TempDir;

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
fn patch(value: serde_json::Value) -> ItemPatch {
    serde_json::from_value(value).unwrap()
}
async fn count(library: &Library, q: &str) -> i64 {
    library
        .query(LibraryQuery {
            q: q.into(),
            ..Default::default()
        })
        .await
        .unwrap()
        .total
}

#[tokio::test]
async fn tag_rename_delete_updates_all_indexes_without_changing_item_data() {
    let (_temp, library) = fixture().await;
    let first = library.create_item("Birinci kitap", "book").await.unwrap();
    let second = library
        .create_item("İkinci makale", "article")
        .await
        .unwrap();
    for item in [&first, &second] {
        library.update_item(&item.id, patch(json!({"description":"Açıklama", "summary":"Özet", "notes":"Kişisel not", "tagNames":["eski etiket", "korunan"]}))).await.unwrap();
    }
    let tag = library
        .catalog()
        .await
        .unwrap()
        .tags
        .into_iter()
        .find(|tag| tag.name == "eski etiket")
        .unwrap();
    assert_eq!(count(&library, "eski etiket").await, 2);
    library
        .save_tag(Some(tag.id.clone()), " Öğrenme ")
        .await
        .unwrap();
    assert_eq!(count(&library, "eski etiket").await, 0);
    assert_eq!(count(&library, "ogrenme").await, 2);
    assert!(library
        .get_item(&first.id)
        .await
        .unwrap()
        .tag_ids
        .contains(&tag.id));
    library.delete_tag(&tag.id).await.unwrap();
    assert_eq!(count(&library, "ogrenme").await, 0);
    for item in [first, second] {
        let kept = library.get_item(&item.id).await.unwrap();
        assert_eq!(kept.description, "Açıklama");
        assert_eq!(kept.summary, "Özet");
        assert_eq!(kept.notes, "Kişisel not");
        assert_eq!(kept.tag_ids.len(), 1);
        assert!(kept.deleted_at.is_none());
    }
}

#[tokio::test]
async fn category_delete_reparents_children_and_preserves_records() {
    let (_temp, library) = fixture().await;
    let root = category(&library, "Bilim", None).await;
    let middle = category(&library, "Silinecek", Some(&root)).await;
    let child = category(&library, "Alt kategori", Some(&middle)).await;
    let sibling = category(&library, "Korunan", Some(&root)).await;
    let first = library.create_item("Kaynak", "book").await.unwrap();
    library
        .update_item(
            &first.id,
            patch(json!({"categoryIds":[middle, child, sibling], "notes":"Korunan not"})),
        )
        .await
        .unwrap();
    assert_eq!(count(&library, "silinecek").await, 1);
    library.delete_category(&middle).await.unwrap();
    let catalog = library.catalog().await.unwrap();
    assert!(!catalog
        .categories
        .iter()
        .any(|category| category.id == middle));
    assert_eq!(
        catalog
            .categories
            .iter()
            .find(|category| category.id == child)
            .unwrap()
            .parent_id,
        Some(root)
    );
    let kept = library.get_item(&first.id).await.unwrap();
    assert_eq!(kept.notes, "Korunan not");
    assert_eq!(kept.category_ids.len(), 2);
    assert!(kept.category_ids.contains(&child) && kept.category_ids.contains(&sibling));
    assert_eq!(count(&library, "silinecek").await, 0);
    assert_eq!(count(&library, "alt kategori").await, 1);
    assert!(kept.deleted_at.is_none());
}

#[tokio::test]
async fn taxonomy_collisions_and_missing_ids_reject_atomically() {
    let (_temp, library) = fixture().await;
    let root = category(&library, "Üst", None).await;
    let first = category(&library, "Aynı", Some(&root)).await;
    let second = category(&library, "Diğer", Some(&root)).await;
    let item = library.create_item("Korunur", "book").await.unwrap();
    library
        .update_item(
            &item.id,
            patch(json!({"categoryIds":[second], "tagNames":["aynı", "başka"]})),
        )
        .await
        .unwrap();
    let error = library
        .save_category(CategoryInput {
            id: Some(second.clone()),
            name: " Aynı ".into(),
            parent_id: Some(root.clone()),
        })
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("aynı adlı"));
    assert_eq!(count(&library, "diger").await, 1);
    assert!(library
        .save_category(CategoryInput {
            id: Some("missing".into()),
            name: "Hayalet".into(),
            parent_id: None
        })
        .await
        .is_err());
    assert!(library
        .save_category(CategoryInput {
            id: None,
            name: "Hayalet".into(),
            parent_id: Some("missing".into())
        })
        .await
        .is_err());
    assert!(library.delete_category("missing").await.is_err());
    let tags = library.catalog().await.unwrap().tags;
    let renamed = tags.iter().find(|tag| tag.name == "başka").unwrap();
    assert!(library
        .save_tag(Some(renamed.id.clone()), "aynı")
        .await
        .unwrap_err()
        .to_string()
        .contains("zaten var"));
    assert!(library
        .save_tag(Some("missing".into()), "yeni")
        .await
        .is_err());
    assert!(library.delete_tag("missing").await.is_err());
    assert!(library.save_tag(None, " ").await.is_err());
    // Search folds accents; taxonomy identity intentionally does not.
    library.save_tag(None, "isik").await.unwrap();
    library.save_tag(None, "ışık").await.unwrap();
    assert_eq!(library.catalog().await.unwrap().tags.len(), 4);
    assert!(library
        .get_item(&item.id)
        .await
        .unwrap()
        .category_ids
        .contains(&second));
    assert_eq!(library.catalog().await.unwrap().categories.len(), 3);
    assert!(!first.is_empty());
}

#[tokio::test]
async fn category_delete_conflicts_keep_entire_tree_and_same_name_child_is_supported() {
    let (_temp, library) = fixture().await;
    let root = category(&library, "Silinecek", None).await;
    let child = category(&library, "Çakışan", Some(&root)).await;
    let conflict = category(&library, "Çakışan", None).await;
    let item = library.create_item("Kitap", "book").await.unwrap();
    library
        .update_item(&item.id, patch(json!({"categoryIds":[root,child]})))
        .await
        .unwrap();
    assert!(library
        .delete_category(&root)
        .await
        .unwrap_err()
        .to_string()
        .contains("yeniden adlandırın"));
    assert_eq!(library.catalog().await.unwrap().categories.len(), 3);
    assert_eq!(
        library.get_item(&item.id).await.unwrap().category_ids.len(),
        2
    );
    assert_eq!(count(&library, "silinecek").await, 1);
    library.delete_category(&conflict).await.unwrap();
    library
        .save_category(CategoryInput {
            id: Some(child.clone()),
            name: "Silinecek".into(),
            parent_id: Some(root.clone()),
        })
        .await
        .unwrap();
    library.delete_category(&root).await.unwrap();
    let catalog = library.catalog().await.unwrap();
    assert_eq!(catalog.categories.len(), 1);
    assert_eq!(catalog.categories[0].id, child);
    assert_eq!(catalog.categories[0].name, "Silinecek");
    assert!(catalog.categories[0].parent_id.is_none());
    assert_eq!(
        library.get_item(&item.id).await.unwrap().category_ids.len(),
        1
    );
}

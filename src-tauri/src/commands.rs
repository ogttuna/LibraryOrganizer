use crate::{
    error::{Error, Result},
    library::Library,
    models::*,
};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub async fn query_library(
    library: State<'_, Library>,
    query: LibraryQuery,
) -> Result<LibraryPage> {
    library.query(query).await
}
#[tauri::command]
pub async fn get_catalog(library: State<'_, Library>) -> Result<Catalog> {
    library.catalog().await
}
#[tauri::command]
pub async fn get_item(library: State<'_, Library>, id: String) -> Result<Item> {
    library.get_item(&id).await
}
#[tauri::command]
pub async fn create_item(library: State<'_, Library>, title: String, kind: String) -> Result<Item> {
    library.create_item(&title, &kind).await
}
#[tauri::command]
pub async fn update_item(
    library: State<'_, Library>,
    id: String,
    patch: ItemPatch,
) -> Result<Item> {
    library.update_item(&id, patch).await
}
#[tauri::command]
pub async fn save_category(library: State<'_, Library>, input: CategoryInput) -> Result<String> {
    library.save_category(input).await
}
#[tauri::command]
pub async fn bulk_update(library: State<'_, Library>, change: BulkChange) -> Result<()> {
    library.bulk_update(change).await
}
#[tauri::command]
pub async fn import_file(
    library: State<'_, Library>,
    path: String,
    item_id: Option<String>,
    category_ids: Vec<String>,
) -> Result<ImportResult> {
    library
        .import_file(
            std::path::Path::new(&path),
            item_id.as_deref(),
            &category_ids,
        )
        .await
}
#[tauri::command]
pub async fn get_attachment_path(library: State<'_, Library>, id: String) -> Result<String> {
    Ok(library
        .attachment_path(&id)
        .await?
        .to_string_lossy()
        .into_owned())
}
#[tauri::command]
pub async fn open_attachment(
    app: AppHandle,
    library: State<'_, Library>,
    id: String,
) -> Result<()> {
    let path = library.attachment_path(&id).await?;
    app.opener()
        .open_path(path.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| Error::Validation(format!("Dosya açılamadı: {e}")))
}
#[tauri::command]
pub async fn set_last_page(library: State<'_, Library>, id: String, page: i64) -> Result<()> {
    library.set_last_page(&id, page).await
}
#[tauri::command]
pub async fn create_backup(library: State<'_, Library>, destination: String) -> Result<String> {
    library
        .create_backup(std::path::Path::new(&destination))
        .await
}
#[tauri::command]
pub async fn get_library_path(library: State<'_, Library>) -> Result<String> {
    Ok(library.root().to_string_lossy().into_owned())
}
#[tauri::command]
pub async fn rebuild_search(library: State<'_, Library>) -> Result<()> {
    library.rebuild_search().await
}

#[tauri::command]
pub async fn delete_category(library: State<'_, Library>, id: String) -> Result<()> {
    library.delete_category(&id).await
}
#[tauri::command]
pub async fn save_tag(
    library: State<'_, Library>,
    id: Option<String>,
    name: String,
) -> Result<String> {
    library.save_tag(id, &name).await
}
#[tauri::command]
pub async fn delete_tag(library: State<'_, Library>, id: String) -> Result<()> {
    library.delete_tag(&id).await
}
#[tauri::command]
pub async fn prepare_restore(
    library: State<'_, Library>,
    source: String,
) -> Result<crate::restore::RestorePreview> {
    library.prepare_restore(std::path::Path::new(&source)).await
}
#[tauri::command]
pub async fn cancel_restore(library: State<'_, Library>, id: String) -> Result<()> {
    library.cancel_restore(&id).await
}
#[tauri::command]
pub async fn apply_restore(app: AppHandle, library: State<'_, Library>, id: String) -> Result<()> {
    use tauri::Manager;
    library.schedule_restore(&id).await?;
    app.state::<crate::ExitControl>()
        .0
        .store(true, std::sync::atomic::Ordering::SeqCst);
    app.restart();
}
#[tauri::command]
pub async fn empty_trash(library: State<'_, Library>) -> Result<crate::trash::TrashResult> {
    library.empty_trash().await
}
#[tauri::command]
pub fn exit_application(app: AppHandle) {
    use tauri::Manager;
    app.state::<crate::ExitControl>()
        .0
        .store(true, std::sync::atomic::Ordering::SeqCst);
    app.exit(0);
}

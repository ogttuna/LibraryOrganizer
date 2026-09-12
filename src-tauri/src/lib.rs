mod backup;
#[cfg(feature = "desktop")]
mod commands;
pub mod error;
mod importer;
pub mod library;
pub mod models;
mod repository;
pub mod restore;
pub mod search;
mod taxonomy;
pub mod trash;

#[cfg(feature = "desktop")]
#[derive(Default)]
pub(crate) struct ExitControl(pub std::sync::atomic::AtomicBool);

#[cfg(feature = "desktop")]
pub fn run() {
    use tauri::{Emitter, Manager};
    tauri::Builder::default()
        .manage(ExitControl::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let root = app.path().app_local_data_dir()?.join("library");
            let library = tauri::async_runtime::block_on(library::Library::open(root))?;
            app.manage(library);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::query_library,
            commands::get_catalog,
            commands::get_item,
            commands::create_item,
            commands::update_item,
            commands::save_category,
            commands::delete_category,
            commands::save_tag,
            commands::delete_tag,
            commands::bulk_update,
            commands::import_file,
            commands::get_attachment_path,
            commands::open_attachment,
            commands::set_last_page,
            commands::create_backup,
            commands::prepare_restore,
            commands::cancel_restore,
            commands::apply_restore,
            commands::empty_trash,
            commands::exit_application,
            commands::get_library_path,
            commands::rebuild_search,
        ])
        .build(tauri::generate_context!())
        .expect("Folio başlatılamadı")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !app
                    .state::<ExitControl>()
                    .0
                    .load(std::sync::atomic::Ordering::SeqCst)
                {
                    api.prevent_exit();
                    let _ = app.emit("folio-close-requested", ());
                }
            }
        });
}

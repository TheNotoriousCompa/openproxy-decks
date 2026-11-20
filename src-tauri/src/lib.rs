// OpenProxy & Decks backend — moduli nativi (filesystem, SQLite, immagini, cache, job, PDF, upscale).
pub mod cache;
pub mod commands;
pub mod database;
pub mod export;
pub mod image;
pub mod jobs;
pub mod pdf;
pub mod processing;
pub mod storage;
pub mod upscale;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                if let Err(e) = database::init(&handle).await {
                    eprintln!("[proxxied] database init failed: {e:#}");
                }
                if let Err(e) = storage::ensure_layout(&handle).await {
                    eprintln!("[proxxied] storage layout failed: {e:#}");
                }
                jobs::init(&handle);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::projects::list_projects,
            commands::projects::list_project_summaries,
            commands::projects::create_project,
            commands::projects::rename_project,
            commands::projects::duplicate_project,
            commands::projects::delete_project,
            commands::projects::get_project,
            commands::projects::save_project_manifest,
            commands::projects::export_project,
            commands::projects::import_project,
            commands::assets::import_assets,
            commands::assets::import_asset_bytes,
            commands::assets::fetch_artwork,
            commands::assets::artwork_status,
            commands::assets::thumb_for,
            commands::assets::thumb_data_url,
            commands::assets::list_assets,
            commands::assets::delete_asset,
            commands::assets::project_folders,
            commands::assets::project_storage_info,
            commands::assets::clear_project_assets,
            commands::image::analyze_image,
            commands::image::process_image,
            commands::layout::compute_layout,
            commands::mpc::mpc_proxy,
            commands::deckimport::fetch_moxfield_deck,
            commands::deckimport::fetch_moxfield_user_decks,
            commands::deckimport::fetch_archidekt_deck,
            commands::upscale::upscale_status,
            commands::upscale::upscale_image,
            commands::pdf::export_pdf,
            commands::pdf::verify_pdf_file,
            commands::export::export_images,
            commands::export::export_dir,
            commands::jobs::job_list,
            commands::jobs::job_cancel,
            commands::jobs::clear_caches,
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::settings::reset_app,
            commands::settings::list_print_presets,
            commands::settings::save_print_preset,
            commands::settings::delete_print_preset,
            commands::storage::storage_usage,
            commands::storage::clear_tmp,
            commands::favorites::list_favorites,
            commands::favorites::add_favorite,
            commands::favorites::remove_favorite,
            commands::collection::collection_list,
            commands::collection::collection_add,
            commands::collection::collection_set_qty,
            commands::collection::collection_remove,
            commands::collection::collection_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

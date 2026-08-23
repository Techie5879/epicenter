mod entry;
mod mirror;
mod watch;

use entry::{read_entry, write_entry};
use mirror::{drop_mirror_table, query_mirror, reset_mirror, write_mirror};
use watch::{unwatch_folder, unwatch_vault, watch_folder, watch_vault, WatcherStore};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(WatcherStore::default())
        .invoke_handler(tauri::generate_handler![
            watch_folder,
            unwatch_folder,
            watch_vault,
            unwatch_vault,
            read_entry,
            write_entry,
            write_mirror,
            query_mirror,
            reset_mirror,
            drop_mirror_table
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

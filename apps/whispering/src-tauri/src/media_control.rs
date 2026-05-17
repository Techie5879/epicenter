use enigo::{Direction, Enigo, Key, Keyboard, Settings};

#[tauri::command]
pub fn macos_toggle_system_media_play_pause() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        enigo
            .key(Key::MediaPlayPause, Direction::Click)
            .map_err(|e| e.to_string())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

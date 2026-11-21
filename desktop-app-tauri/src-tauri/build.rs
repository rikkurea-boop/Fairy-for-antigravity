fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "set_ignore_mouse",
                "update_interactive_rects",
                "set_shape",
                "set_window_rect",
                "get_display_bounds",
                "set_focusable",
                "set_phase",
                "get_state",
                "set_tts_enabled",
                "set_auto_mute",
                "speak_text",
                "notify_ready",
                "get_startup",
                "set_startup",
                "trigger_voice",
                "hybrid_action",
                "butler_action",
                "set_butler_prefs",
                "quit_app",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}

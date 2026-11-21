mod engine;
mod server;
mod startup;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use engine::EngineHandle;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct LogicalRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct WindowRectReq {
    pub fullscreen: Option<bool>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DisplayBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub struct AppState {
    pub engine: Arc<EngineHandle>,
    pub smoke_test: bool,
    pub overlay_phase: StdMutex<String>,
    pub ignore_mouse: AtomicBool,
    pub interactive_rects: StdMutex<Vec<LogicalRect>>,
    pub pending_control_cmd: StdMutex<Option<String>>,
    pub last_rect_key: StdMutex<String>,
    pub boot_topmost_stop: StdMutex<Option<Arc<AtomicBool>>>,
}

fn find_repo_root() -> PathBuf {
    if let Ok(env_root) = std::env::var("FAIRY_REPO_ROOT") {
        let p = PathBuf::from(env_root.trim());
        if p.join("desktop-app").join("renderer").join("index.html").exists() {
            return p;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut cur: Option<&Path> = exe.parent();
        for _ in 0..8 {
            if let Some(dir) = cur {
                if dir.join("desktop-app").join("renderer").join("index.html").exists() {
                    return dir.to_path_buf();
                }
                cur = dir.parent();
            } else {
                break;
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let mut cur: Option<&Path> = Some(&cwd);
        for _ in 0..5 {
            if let Some(dir) = cur {
                if dir.join("desktop-app").join("renderer").join("index.html").exists() {
                    return dir.to_path_buf();
                }
                cur = dir.parent();
            } else {
                break;
            }
        }
    }
    PathBuf::from(".")
}

fn read_native_clipboard() -> String {
    arboard::Clipboard::new()
        .and_then(|mut cb| cb.get_text())
        .unwrap_or_default()
}

fn find_protocol_arg(args: &[String]) -> Option<String> {
    args.iter()
        .find(|a| a.trim().to_ascii_lowercase().starts_with("fairy://"))
        .map(|s| s.trim().to_string())
}

#[cfg(windows)]
fn win_set_topmost_noactivate(win: &WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };
    if let Ok(hwnd) = win.hwnd() {
        unsafe {
            SetWindowPos(
                hwnd.0 as _,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }
}

#[cfg(windows)]
fn win_set_noactivate_style(win: &WebviewWindow, noactivate: bool) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
    };
    if let Ok(hwnd) = win.hwnd() {
        unsafe {
            let cur = GetWindowLongPtrW(hwnd.0 as _, GWL_EXSTYLE);
            let next = if noactivate {
                cur | (WS_EX_NOACTIVATE as isize)
            } else {
                cur & !(WS_EX_NOACTIVATE as isize)
            };
            if next != cur {
                SetWindowLongPtrW(hwnd.0 as _, GWL_EXSTYLE, next);
            }
        }
    }
}

pub fn show_overlay_window(app: &AppHandle, focus_window: bool) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let _ = win.show();
    #[cfg(windows)]
    win_set_topmost_noactivate(&win);
    if focus_window {
        let _ = win.set_focus();
    }
}

fn primary_display_bounds(win: &WebviewWindow) -> DisplayBounds {
    if let Ok(Some(mon)) = win.primary_monitor() {
        let scale = mon.scale_factor().max(0.5);
        let pos = mon.position();
        let size = mon.size();
        return DisplayBounds {
            x: (pos.x as f64 / scale).round(),
            y: (pos.y as f64 / scale).round(),
            width: (size.width as f64 / scale).round(),
            height: (size.height as f64 / scale).round(),
        };
    }
    DisplayBounds {
        x: 0.0,
        y: 0.0,
        width: 1920.0,
        height: 1080.0,
    }
}

fn stop_boot_topmost_loop(state: &AppState) {
    if let Ok(mut guard) = state.boot_topmost_stop.lock() {
        if let Some(flag) = guard.take() {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

fn start_boot_topmost_loop(app: &AppHandle, state: &AppState) {
    stop_boot_topmost_loop(state);
    #[cfg(windows)]
    {
        let stop_flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut guard) = state.boot_topmost_stop.lock() {
            *guard = Some(Arc::clone(&stop_flag));
        }
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            while !stop_flag.load(Ordering::Relaxed) {
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                if stop_flag.load(Ordering::Relaxed) {
                    break;
                }
                if let Some(win) = app_clone.get_webview_window("main") {
                    win_set_topmost_noactivate(&win);
                } else {
                    break;
                }
            }
        });
    }
    #[cfg(not(windows))]
    {
        let _ = app;
    }
}

fn dispatch_control_command(app: &AppHandle, cmd: &str) {
    let clean = cmd.trim();
    if clean.is_empty() || clean == "ping" {
        return;
    }
    let state = app.state::<AppState>();
    if clean == "read-clipboard" {
        let clip = read_native_clipboard();
        state.engine.call_detached(
            "localCmd",
            json!({ "cmd": "read-clipboard", "clipboardText": clip }),
        );
        return;
    }
    show_overlay_window(app, false);
    let _ = app.emit("fairy:cmd", clean.to_string());
}

#[tauri::command]
fn set_ignore_mouse(
    app: AppHandle,
    state: tauri::State<AppState>,
    ignore: bool,
    rects: Option<Vec<LogicalRect>>,
) {
    if let Some(r) = rects {
        if let Ok(mut g) = state.interactive_rects.lock() {
            *g = r;
        }
    }
    state.ignore_mouse.store(ignore, Ordering::Relaxed);
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_ignore_cursor_events(ignore);
    }
}

#[tauri::command]
fn update_interactive_rects(state: tauri::State<AppState>, rects: Vec<LogicalRect>) {
    if let Ok(mut g) = state.interactive_rects.lock() {
        *g = rects;
    }
}

#[tauri::command]
fn set_shape(_rects: Option<Value>) {}

#[tauri::command]
fn set_window_rect(
    app: AppHandle,
    state: tauri::State<AppState>,
    rect: Option<WindowRectReq>,
) {
    if state.smoke_test {
        return;
    }
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let disp = primary_display_bounds(&win);
    let is_full = rect.as_ref().and_then(|r| r.fullscreen).unwrap_or(false) || rect.is_none();

    let (x, y, w, h, key) = if is_full {
        (
            disp.x,
            disp.y,
            disp.width,
            disp.height,
            format!("full:{},{},{},{}", disp.x, disp.y, disp.width, disp.height),
        )
    } else {
        let r = rect.unwrap();
        let w = r.width.unwrap_or(260.0).clamp(80.0, disp.width).round();
        let h = r.height.unwrap_or(260.0).clamp(80.0, disp.height).round();
        let max_x = disp.x + (disp.width - w).max(0.0);
        let max_y = disp.y + (disp.height - h).max(0.0);
        let x = r.x.unwrap_or(disp.x).clamp(disp.x, max_x).round();
        let y = r.y.unwrap_or(disp.y).clamp(disp.y, max_y).round();
        (x, y, w, h, format!("{x},{y},{w},{h}"))
    };

    if let Ok(mut last_key) = state.last_rect_key.lock() {
        if *last_key == key {
            return;
        }
        *last_key = key;
    }

    let _ = win.set_position(tauri::LogicalPosition::new(x, y));
    let _ = win.set_size(tauri::LogicalSize::new(w, h));
    if is_full {
        let _ = win.set_always_on_top(true);
        #[cfg(windows)]
        win_set_topmost_noactivate(&win);
    }
}

#[tauri::command]
fn get_display_bounds(app: AppHandle) -> DisplayBounds {
    if let Some(win) = app.get_webview_window("main") {
        return primary_display_bounds(&win);
    }
    DisplayBounds {
        x: 0.0,
        y: 0.0,
        width: 1920.0,
        height: 1080.0,
    }
}

#[tauri::command]
fn set_focusable(app: AppHandle, state: tauri::State<AppState>, focusable: bool) {
    if state.smoke_test {
        return;
    }
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_focusable(focusable);
        #[cfg(windows)]
        win_set_noactivate_style(&win, !focusable);
        if focusable {
            let _ = win.set_focus();
        }
    }
}

#[tauri::command]
fn set_phase(app: AppHandle, state: tauri::State<AppState>, phase: String) {
    let next = match phase.as_str() {
        "boot" | "greet" => phase,
        _ => "dock".to_string(),
    };
    if let Ok(mut g) = state.overlay_phase.lock() {
        *g = next.clone();
    }
    if !state.smoke_test {
        if next == "boot" || next == "greet" {
            start_boot_topmost_loop(&app, &state);
        } else {
            stop_boot_topmost_loop(&state);
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_always_on_top(true);
            }
        }
    }
    state
        .engine
        .call_detached("uiPhase", json!({ "phase": next }));
}

#[tauri::command]
async fn get_state(state: tauri::State<'_, AppState>) -> Result<Value, String> {
    state.engine.call("getState", json!({})).await
}

#[tauri::command]
fn set_tts_enabled(state: tauri::State<AppState>, enabled: bool) {
    state
        .engine
        .call_detached("setTtsEnabled", json!({ "enabled": enabled }));
}

#[tauri::command]
fn set_auto_mute(state: tauri::State<AppState>, enabled: bool) {
    state
        .engine
        .call_detached("setAutoMute", json!({ "enabled": enabled }));
}

#[tauri::command]
async fn speak_text(state: tauri::State<'_, AppState>, text: String) -> Result<Value, String> {
    state
        .engine
        .call("speakText", json!({ "text": text }))
        .await
}

#[tauri::command]
fn notify_ready(app: AppHandle, state: tauri::State<AppState>) {
    if state.smoke_test {
        use std::io::Write;
        println!("FAIRY_DESKTOP_READY_OK");
        let _ = std::io::stdout().flush();
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
            app_clone.exit(0);
        });
        return;
    }

    show_overlay_window(&app, false);
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        show_overlay_window(&app_clone, false);
    });

    if let Ok(mut pending) = state.pending_control_cmd.lock() {
        if let Some(cmd) = pending.take() {
            if cmd != "replay-boot" {
                let app_cmd = app.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                    dispatch_control_command(&app_cmd, &cmd);
                });
            }
        }
    }
}

#[tauri::command]
fn get_startup() -> bool {
    startup::get_startup_enabled()
}

#[tauri::command]
fn set_startup(enabled: bool) -> bool {
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("fairy-desktop.exe"));
    startup::set_startup_enabled(enabled, &exe)
}

#[tauri::command]
async fn trigger_voice(state: tauri::State<'_, AppState>, payload: Value) -> Result<Value, String> {
    state.engine.call("triggerVoice", payload).await
}

#[tauri::command]
async fn hybrid_action(state: tauri::State<'_, AppState>, req: Value) -> Result<Value, String> {
    state.engine.call("hybridAction", req).await
}

#[tauri::command]
async fn butler_action(state: tauri::State<'_, AppState>, mut req: Value) -> Result<Value, String> {
    let action = req
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if matches!(
        action.as_str(),
        "read-clipboard" | "toggle-clipboard-watch" | "run-command-text"
    ) {
        let clip = read_native_clipboard();
        if let Some(obj) = req.as_object_mut() {
            obj.insert("clipboardText".to_string(), Value::String(clip));
        }
    }
    state.engine.call("butlerAction", req).await
}

#[tauri::command]
async fn set_butler_prefs(
    state: tauri::State<'_, AppState>,
    mut patch: Value,
) -> Result<Value, String> {
    if let Some(cw) = patch.get("clipboardWatch").and_then(|v| v.as_bool()) {
        state.engine.clipboard_watch.store(cw, Ordering::Relaxed);
        if cw {
            let clip = read_native_clipboard();
            if let Some(obj) = patch.as_object_mut() {
                obj.insert("clipboardText".to_string(), Value::String(clip));
            }
        }
    }
    state.engine.call("setButlerPrefs", patch).await
}

#[tauri::command]
async fn quit_app(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    stop_boot_topmost_loop(&state);
    let _ = tokio::time::timeout(
        std::time::Duration::from_millis(600),
        state.engine.call("shutdown", json!({})),
    )
    .await;
    if !state.smoke_test {
        server::remove_desktop_endpoint_file_if_owned();
    }
    app.exit(0);
    Ok(())
}

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let i_boot = MenuItem::with_id(app, "replay-boot", "▶ Phát lại Boot + Âm thanh", true, None::<&str>)?;
    let i_greet = MenuItem::with_id(app, "replay-greet", "◈ Hiện lời chào H.D.D", true, None::<&str>)?;
    let i_bubble = MenuItem::with_id(app, "toggle-bubble", "💬 Bật / Tắt bong bóng (Alt+Shift+F)", true, None::<&str>)?;
    let i_instant = MenuItem::with_id(app, "open-instant", "⚡ Mở Trợ lý Tức thì (Alt+Shift+A)", true, None::<&str>)?;
    let i_brief = MenuItem::with_id(app, "briefing-now", "📋 Báo cáo H.D.D ngay", true, None::<&str>)?;
    let i_clip = MenuItem::with_id(app, "read-clipboard", "🔊 Đọc Clipboard ngay (Alt+Shift+R)", true, None::<&str>)?;
    let i_pomo = MenuItem::with_id(app, "pomodoro-25", "⏱ Pomodoro 25 phút", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let i_set = MenuItem::with_id(app, "open-settings", "⚙ Cài đặt H.D.D & Biểu cảm", true, None::<&str>)?;
    let i_reset = MenuItem::with_id(app, "reset-pos", "↺ Đặt lại vị trí mắt (25vw / 52vh)", true, None::<&str>)?;
    let i_eye = MenuItem::with_id(app, "toggle-eye", "👁 Hiện / Ẩn mắt Fairy", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let i_quit = MenuItem::with_id(app, "quit", "✕ Thoát Fairy Overlay", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &i_boot, &i_greet, &i_bubble, &i_instant, &i_brief, &i_clip, &i_pomo,
            &sep1,
            &i_set, &i_reset, &i_eye,
            &sep2,
            &i_quit,
        ],
    )?;

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?;

    TrayIconBuilder::with_id("fairy-tray")
        .icon(icon)
        .tooltip("Fairy III · H.D.D Terminal (Antigravity)")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                dispatch_control_command(tray.app_handle(), "toggle-bubble");
            }
        })
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            if id == "quit" {
                let app_clone = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app_clone.state::<AppState>();
                    stop_boot_topmost_loop(&state);
                    let _ = tokio::time::timeout(
                        std::time::Duration::from_millis(600),
                        state.engine.call("shutdown", json!({})),
                    )
                    .await;
                    if !state.smoke_test {
                        server::remove_desktop_endpoint_file_if_owned();
                    }
                    app_clone.exit(0);
                });
                return;
            }
            if id == "pomodoro-25" {
                let app_clone = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app_clone.state::<AppState>();
                    if let Ok(res) = state
                        .engine
                        .call("butlerAction", json!({ "action": "pomodoro-start", "minutes": 25 }))
                        .await
                    {
                        if res.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                            let _ = app_clone.emit("fairy:butler-event", res);
                        }
                    }
                });
                return;
            }
            dispatch_control_command(app, id);
        })
        .build(app)?;

    Ok(())
}

fn setup_shortcuts(app: &AppHandle) {
    let sc_alt_f = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyF);
    let sc_ctrl_f = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyF);
    let sc_alt_a = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyA);
    let sc_alt_r = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyR);

    let plugin = tauri_plugin_global_shortcut::Builder::new()
        .with_handler(move |app_handle, shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            if *shortcut == sc_alt_f || *shortcut == sc_ctrl_f {
                dispatch_control_command(app_handle, "toggle-bubble");
            } else if *shortcut == sc_alt_a {
                dispatch_control_command(app_handle, "open-instant");
            } else if *shortcut == sc_alt_r {
                dispatch_control_command(app_handle, "read-clipboard");
            }
        })
        .build();

    if app.plugin(plugin).is_ok() {
        let gs = app.global_shortcut();
        let _ = gs.register(sc_alt_f);
        let _ = gs.register(sc_ctrl_f);
        let _ = gs.register(sc_alt_a);
        let _ = gs.register(sc_alt_r);
    }
}

fn start_hover_recovery_loop(app: AppHandle) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::POINT;
        use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(33)).await;
                let state = app.state::<AppState>();
                if !state.ignore_mouse.load(Ordering::Relaxed) {
                    continue;
                }
                let in_dock = state
                    .overlay_phase
                    .lock()
                    .map(|p| *p == "dock")
                    .unwrap_or(false);
                if !in_dock {
                    continue;
                }
                let Some(win) = app.get_webview_window("main") else {
                    continue;
                };
                let Ok(win_pos) = win.outer_position() else {
                    continue;
                };
                let scale = win.scale_factor().unwrap_or(1.0).max(0.5);
                let mut pt = POINT { x: 0, y: 0 };
                let got_pos = unsafe { GetCursorPos(&mut pt) != 0 };
                if !got_pos {
                    continue;
                }
                let lx = (pt.x as f64 - win_pos.x as f64) / scale;
                let ly = (pt.y as f64 - win_pos.y as f64) / scale;
                let hit = state
                    .interactive_rects
                    .lock()
                    .map(|rects| {
                        rects.iter().any(|r| {
                            lx >= r.x - 2.0
                                && lx <= r.x + r.width + 2.0
                                && ly >= r.y - 2.0
                                && ly <= r.y + r.height + 2.0
                        })
                    })
                    .unwrap_or(false);
                if hit {
                    state.ignore_mouse.store(false, Ordering::Relaxed);
                    let _ = win.set_ignore_cursor_events(false);
                }
            }
        });
    }
    #[cfg(not(windows))]
    {
        let _ = app;
    }
}

fn start_clipboard_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_seen = read_native_clipboard();
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(650)).await;
            let state = app.state::<AppState>();
            if !state.engine.clipboard_watch.load(Ordering::Relaxed) {
                continue;
            }
            let current = read_native_clipboard();
            if !current.is_empty() && current != last_seen {
                last_seen = current.clone();
                state
                    .engine
                    .call_detached("clipboardUpdate", json!({ "text": current }));
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let smoke_test = std::env::var("FAIRY_SMOKE_TEST").as_deref() == Ok("1");
    let args: Vec<String> = std::env::args().collect();
    let force_boot = args.iter().any(|a| a == "--force-boot")
        || std::env::var("FAIRY_FORCE_BOOT").as_deref() == Ok("1");
    let proto_cmd = find_protocol_arg(&args)
        .and_then(|u| server::protocol_url_to_control_cmd(&u).map(|c| c.to_string()));
    let initial_pending = if force_boot || proto_cmd.as_deref() == Some("replay-boot") {
        Some("replay-boot".to_string())
    } else {
        proto_cmd
    };

    let mut builder = tauri::Builder::default();
    if !smoke_test {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(proto) = find_protocol_arg(&argv) {
                if let Some(cmd) = server::protocol_url_to_control_cmd(&proto) {
                    dispatch_control_command(app, cmd);
                    return;
                }
            }
            show_overlay_window(app, true);
            let _ = app.emit("fairy:cmd", "replay-boot".to_string());
        }));
    }

    builder
        .setup(move |app| {
            let repo_root = find_repo_root();
            if !smoke_test {
                if let Ok(exe) = std::env::current_exe() {
                    startup::register_protocol_handler(&exe);
                }
            }

            let engine = EngineHandle::spawn(app.handle().clone(), &repo_root, smoke_test);
            let port = server::start_local_server(
                app.handle().clone(),
                Arc::clone(&engine),
                repo_root,
                smoke_test,
            )?;

            app.manage(AppState {
                engine,
                smoke_test,
                overlay_phase: StdMutex::new("boot".to_string()),
                ignore_mouse: AtomicBool::new(false),
                interactive_rects: StdMutex::new(Vec::new()),
                pending_control_cmd: StdMutex::new(initial_pending.clone()),
                last_rect_key: StdMutex::new(String::new()),
                boot_topmost_stop: StdMutex::new(None),
            });

            let start_query = if initial_pending.as_deref() == Some("replay-boot") {
                "?boot=1"
            } else {
                ""
            };
            let url_str = format!("http://127.0.0.1:{port}/{start_query}");
            let parsed_url: tauri::Url = url_str.parse()?;

            let mut disp = DisplayBounds {
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1080.0,
            };
            if let Ok(Some(mon)) = app.primary_monitor() {
                let scale = mon.scale_factor().max(0.5);
                let pos = mon.position();
                let size = mon.size();
                disp = DisplayBounds {
                    x: (pos.x as f64 / scale).round(),
                    y: (pos.y as f64 / scale).round(),
                    width: (size.width as f64 / scale).round(),
                    height: (size.height as f64 / scale).round(),
                };
            }

            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed_url))
                .title("Fairy III · H.D.D Overlay")
                .position(disp.x, disp.y)
                .inner_size(disp.width, disp.height)
                .transparent(true)
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .shadow(false)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .visible(false)
                .focusable(!cfg!(windows))
                .additional_browser_args("--autoplay-policy=no-user-gesture-required")
                .initialization_script(include_str!("tauri-bridge.js"))
                .build()?;

            #[cfg(windows)]
            {
                win_set_noactivate_style(&win, true);
                win_set_topmost_noactivate(&win);
            }

            if !smoke_test {
                let _ = setup_tray(app.handle());
                setup_shortcuts(app.handle());
                start_hover_recovery_loop(app.handle().clone());
                start_clipboard_watcher(app.handle().clone());
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_ignore_mouse,
            update_interactive_rects,
            set_shape,
            set_window_rect,
            get_display_bounds,
            set_focusable,
            set_phase,
            get_state,
            set_tts_enabled,
            set_auto_mute,
            speak_text,
            notify_ready,
            get_startup,
            set_startup,
            trigger_voice,
            hybrid_action,
            butler_action,
            set_butler_prefs,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Fairy III desktop overlay");
}

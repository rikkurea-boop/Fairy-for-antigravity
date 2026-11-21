use axum::body::Body;
use axum::extract::{Path as AxumPath, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::net::TcpListener;

use crate::engine::EngineHandle;

#[derive(Clone)]
pub struct ServerState {
    pub app: AppHandle,
    pub engine: Arc<EngineHandle>,
    pub repo_root: PathBuf,
    pub renderer_dir: PathBuf,
    pub plugin_root: PathBuf,
    pub assets_dir: PathBuf,
}

fn mime_for_ext(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" => "application/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "wav" => "audio/wav",
        "webm" => "video/webm",
        "mp4" => "video/mp4",
        _ => "application/octet-stream",
    }
}

fn is_valid_voice_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if !lower.ends_with(".wav") || name.len() <= 4 {
        return false;
    }
    name[..name.len() - 4]
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

async fn serve_media_with_range(
    method: Method,
    headers: HeaderMap,
    file_path: PathBuf,
    content_type: &'static str,
) -> Response {
    let Ok(meta) = tokio::fs::metadata(&file_path).await else {
        return (StatusCode::NOT_FOUND, "Not found").into_response();
    };
    let total = meta.len();
    if total == 0 {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CACHE_CONTROL, "no-cache")
            .header(header::CONTENT_LENGTH, "0")
            .body(Body::empty())
            .unwrap();
    }

    if let Some(range_val) = headers.get(header::RANGE).and_then(|v| v.to_str().ok()) {
        if let Some(spec_raw) = range_val
            .strip_prefix("bytes=")
            .or_else(|| range_val.strip_prefix("BYTES="))
        {
            let spec = spec_raw.split(',').next().unwrap_or("").trim();
            let mut parts = spec.splitn(2, '-');
            let p0 = parts.next().unwrap_or("").trim();
            let p1 = parts.next().unwrap_or("").trim();

            let parsed_range: Option<(u64, u64)> = if p0.is_empty() {
                p1.parse::<u64>().ok().and_then(|suffix| {
                    if suffix == 0 {
                        None
                    } else {
                        let start = total.saturating_sub(suffix);
                        Some((start, total - 1))
                    }
                })
            } else {
                p0.parse::<u64>().ok().and_then(|start| {
                    let end = if p1.is_empty() {
                        total - 1
                    } else {
                        p1.parse::<u64>().ok()?.min(total - 1)
                    };
                    if start <= end && start < total {
                        Some((start, end))
                    } else {
                        None
                    }
                })
            };

            let Some((start, end)) = parsed_range else {
                return Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_TYPE, content_type)
                    .header(header::ACCEPT_RANGES, "bytes")
                    .header(header::CONTENT_RANGE, format!("bytes */{total}"))
                    .body(Body::empty())
                    .unwrap();
            };

            let len = end - start + 1;
            if method == Method::HEAD {
                return Response::builder()
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header(header::CONTENT_TYPE, content_type)
                    .header(header::ACCEPT_RANGES, "bytes")
                    .header(header::CACHE_CONTROL, "no-cache")
                    .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
                    .header(header::CONTENT_LENGTH, len.to_string())
                    .body(Body::empty())
                    .unwrap();
            }

            let Ok(mut f) = tokio::fs::File::open(&file_path).await else {
                return (StatusCode::NOT_FOUND, "Not found").into_response();
            };
            if f.seek(std::io::SeekFrom::Start(start)).await.is_err() {
                return (StatusCode::INTERNAL_SERVER_ERROR, "Seek error").into_response();
            }
            let mut buf = Vec::with_capacity(len.min(8 * 1024 * 1024) as usize);
            if f.take(len).read_to_end(&mut buf).await.is_err() {
                return (StatusCode::INTERNAL_SERVER_ERROR, "Read error").into_response();
            }

            return Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CACHE_CONTROL, "no-cache")
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
                .header(header::CONTENT_LENGTH, buf.len().to_string())
                .body(Body::from(buf))
                .unwrap();
        }
    }

    if method == Method::HEAD {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CACHE_CONTROL, "no-cache")
            .header(header::CONTENT_LENGTH, total.to_string())
            .body(Body::empty())
            .unwrap();
    }

    match tokio::fs::read(&file_path).await {
        Ok(buf) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CACHE_CONTROL, "no-cache")
            .header(header::CONTENT_LENGTH, buf.len().to_string())
            .body(Body::from(buf))
            .unwrap(),
        Err(_) => (StatusCode::NOT_FOUND, "Not found").into_response(),
    }
}

async fn handle_hook_push(
    State(state): State<ServerState>,
    body: axum::body::Bytes,
) -> Response {
    if body.len() > 131_072 {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            [(header::CONTENT_TYPE, "application/json")],
            r#"{"ok":false,"error":"payload_too_large"}"#,
        )
            .into_response();
    }
    let Ok(parsed) = serde_json::from_slice::<Value>(if body.is_empty() { b"{}" } else { &body }) else {
        return (
            StatusCode::BAD_REQUEST,
            [(header::CONTENT_TYPE, "application/json")],
            r#"{"ok":false,"error":"invalid_json"}"#,
        )
            .into_response();
    };
    state.engine.call_detached("hookPush", parsed);
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        r#"{"ok":true}"#,
    )
        .into_response()
}

pub fn protocol_url_to_control_cmd(raw_url: &str) -> Option<&'static str> {
    let trimmed = raw_url.trim();
    let rest = trimmed
        .strip_prefix("fairy://")
        .or_else(|| trimmed.strip_prefix("FAIRY://"))?;
    let route = rest
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_matches('/')
        .to_ascii_lowercase();
    match route.as_str() {
        "" | "boot" | "start" => Some("replay-boot"),
        "greet" => Some("replay-greet"),
        "briefing" | "report" => Some("briefing-now"),
        "instant" | "butler" => Some("open-instant"),
        "toggle" | "bubble" => Some("toggle-bubble"),
        "read-clipboard" | "clipboard" => Some("read-clipboard"),
        "settings" => Some("open-settings"),
        _ => None,
    }
}

async fn handle_local_cmd(
    State(state): State<ServerState>,
    body: axum::body::Bytes,
) -> Response {
    if body.len() > 8_192 {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            [(header::CONTENT_TYPE, "application/json")],
            r#"{"ok":false,"error":"payload_too_large"}"#,
        )
            .into_response();
    }
    let Ok(mut parsed) = serde_json::from_slice::<Value>(if body.is_empty() { b"{}" } else { &body }) else {
        return (
            StatusCode::BAD_REQUEST,
            [(header::CONTENT_TYPE, "application/json")],
            r#"{"ok":false,"error":"invalid_json"}"#,
        )
            .into_response();
    };

    let cmd_str = if let Some(u) = parsed.get("url").and_then(|v| v.as_str()) {
        match protocol_url_to_control_cmd(u) {
            Some(c) => c.to_string(),
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    [(header::CONTENT_TYPE, "application/json")],
                    r#"{"ok":false,"error":"unknown_protocol_route"}"#,
                )
                    .into_response();
            }
        }
    } else {
        parsed
            .get("cmd")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    };

    if cmd_str.is_empty() || cmd_str == "ping" {
        let out = json!({ "ok": true, "pong": true, "pid": std::process::id() }).to_string();
        return (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/json")],
            out,
        )
            .into_response();
    }

    if cmd_str == "read-clipboard" {
        if let Ok(mut cb) = arboard::Clipboard::new() {
            if let Ok(txt) = cb.get_text() {
                if let Some(obj) = parsed.as_object_mut() {
                    obj.insert("clipboardText".to_string(), Value::String(txt));
                }
            }
        }
        state.engine.call_detached("localCmd", parsed);
        return (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/json")],
            r#"{"ok":true,"executed":"read-clipboard"}"#,
        )
            .into_response();
    }

    let is_allowed_ui = matches!(
        cmd_str.as_str(),
        "replay-boot"
            | "replay-greet"
            | "toggle-bubble"
            | "open-instant"
            | "open-settings"
            | "briefing-now"
            | "reset-pos"
            | "toggle-eye"
    );
    if !is_allowed_ui {
        return (
            StatusCode::BAD_REQUEST,
            [(header::CONTENT_TYPE, "application/json")],
            r#"{"ok":false,"error":"unknown_cmd"}"#,
        )
            .into_response();
    }

    crate::show_overlay_window(&state.app, false);
    let _ = state.app.emit("fairy:cmd", cmd_str.clone());
    let out = json!({ "ok": true, "dispatched": cmd_str }).to_string();
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        out,
    )
        .into_response()
}

async fn handle_asset(
    State(state): State<ServerState>,
    method: Method,
    headers: HeaderMap,
    AxumPath(name): AxumPath<String>,
) -> Response {
    let (file_path, ctype) = match name.as_str() {
        "boot.webm" => (state.assets_dir.join("boot.webm"), "video/webm"),
        "boot.mp4" => (state.assets_dir.join("boot.mp4"), "video/mp4"),
        "hero.png" => (state.assets_dir.join("hero.png"), "image/png"),
        "poster.jpg" => (state.assets_dir.join("poster.jpg"), "image/jpeg"),
        "icon-180.png" => (state.assets_dir.join("icon-180.png"), "image/png"),
        "icon.svg" => (state.plugin_root.join("icon.svg"), "image/svg+xml; charset=utf-8"),
        _ => return (StatusCode::NOT_FOUND, "Not found").into_response(),
    };
    serve_media_with_range(method, headers, file_path, ctype).await
}

async fn handle_voice_asset(
    State(state): State<ServerState>,
    method: Method,
    headers: HeaderMap,
    AxumPath(name): AxumPath<String>,
) -> Response {
    if !is_valid_voice_name(&name) {
        return (StatusCode::NOT_FOUND, "Not found").into_response();
    }
    let plugin_voice = state.assets_dir.join("voice").join(&name);
    let repo_voice = state.repo_root.join("assets").join("voice").join(&name);
    let target = if plugin_voice.exists() { plugin_voice } else { repo_voice };
    serve_media_with_range(method, headers, target, "audio/wav").await
}

async fn serve_renderer_rel(state: &ServerState, rel: &str) -> Response {
    if rel.contains("..") || rel.contains('\\') || rel.is_empty() {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }
    let target = state.renderer_dir.join(rel);
    match tokio::fs::read(&target).await {
        Ok(buf) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime_for_ext(&target))
            .header(header::CONTENT_LENGTH, buf.len().to_string())
            .header(header::CACHE_CONTROL, "no-cache")
            .body(Body::from(buf))
            .unwrap(),
        Err(_) => (StatusCode::NOT_FOUND, "Not found").into_response(),
    }
}

async fn handle_root(State(state): State<ServerState>) -> Response {
    serve_renderer_rel(&state, "index.html").await
}

async fn handle_renderer_file(
    State(state): State<ServerState>,
    AxumPath(path): AxumPath<String>,
) -> Response {
    let rel = path.trim_start_matches('/');
    if rel.is_empty() {
        return serve_renderer_rel(&state, "index.html").await;
    }
    serve_renderer_rel(&state, rel).await
}

pub fn desktop_endpoint_file() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(
        PathBuf::from(home)
            .join(".gemini")
            .join("antigravity")
            .join("plugin_data")
            .join("fairy-zzz")
            .join("desktop-endpoint.json"),
    )
}

pub fn write_desktop_endpoint_file(port: u16) {
    let Some(path) = desktop_endpoint_file() else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let payload = json!({
        "port": port,
        "pid": std::process::id(),
        "updatedAt": now_ms
    });
    let _ = std::fs::write(path, payload.to_string());
}

pub fn remove_desktop_endpoint_file_if_owned() {
    let Some(path) = desktop_endpoint_file() else {
        return;
    };
    if let Ok(raw) = std::fs::read_to_string(&path) {
        if let Ok(parsed) = serde_json::from_str::<Value>(&raw) {
            if parsed.get("pid").and_then(|v| v.as_u64()) == Some(std::process::id() as u64) {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

pub fn start_local_server(
    app: AppHandle,
    engine: Arc<EngineHandle>,
    repo_root: PathBuf,
    smoke_test: bool,
) -> Result<u16, String> {
    let std_listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    std_listener
        .set_nonblocking(true)
        .map_err(|e| e.to_string())?;
    let port = std_listener.local_addr().map_err(|e| e.to_string())?.port();

    if !smoke_test {
        write_desktop_endpoint_file(port);
    }

    let plugin_root = repo_root.join("antigravity-plugin");
    let state = ServerState {
        app,
        engine,
        renderer_dir: repo_root.join("desktop-app").join("renderer"),
        assets_dir: plugin_root.join("assets"),
        plugin_root,
        repo_root,
    };

    let router = Router::new()
        .route("/api/hook-push", post(handle_hook_push))
        .route("/api/cmd", post(handle_local_cmd))
        .route("/assets/voice/{name}", get(handle_voice_asset).head(handle_voice_asset))
        .route("/assets/{name}", get(handle_asset).head(handle_asset))
        .route("/", get(handle_root))
        .route("/{*path}", get(handle_renderer_file))
        .with_state(state);

    tauri::async_runtime::spawn(async move {
        if let Ok(listener) = TcpListener::from_std(std_listener) {
            let _ = axum::serve(listener, router).await;
        }
    });

    Ok(port)
}

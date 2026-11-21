use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::ChildStdin;
use tokio::sync::{oneshot, Mutex};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn resolve_node_exe() -> PathBuf {
    if let Ok(env_node) = std::env::var("FAIRY_NODE_EXE") {
        let p = PathBuf::from(env_node.trim());
        if p.exists() {
            return p;
        }
    }
    #[cfg(windows)]
    {
        let std_path = PathBuf::from(r"C:\Program Files\nodejs\node.exe");
        if std_path.exists() {
            return std_path;
        }
        if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
            let p = PathBuf::from(local_app).join("Programs").join("nodejs").join("node.exe");
            if p.exists() {
                return p;
            }
        }
    }
    PathBuf::from("node")
}

type PendingRpcMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

pub struct EngineHandle {
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    pending: PendingRpcMap,
    next_id: AtomicU64,
    pub clipboard_watch: Arc<AtomicBool>,
}

impl EngineHandle {
    pub fn spawn(app: AppHandle, repo_root: &Path, smoke_test: bool) -> Arc<Self> {
        let engine_script = repo_root.join("desktop-app").join("fairy-engine.cjs");
        let node_exe = resolve_node_exe();

        let mut cmd = tokio::process::Command::new(&node_exe);
        cmd.arg(&engine_script)
            .current_dir(repo_root.join("desktop-app"))
            .env("FAIRY_RUST_CLIPBOARD", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        if smoke_test {
            cmd.env("FAIRY_SMOKE_TEST", "1");
        }

        #[cfg(windows)]
        {
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let handle = Arc::new(Self {
            stdin: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
            clipboard_watch: Arc::new(AtomicBool::new(false)),
        });

        match cmd.spawn() {
            Ok(mut child) => {
                let child_stdin = child.stdin.take();
                let child_stdout = child.stdout.take();

                let handle_clone = Arc::clone(&handle);
                if let Some(si) = child_stdin {
                    if let Ok(mut guard) = handle.stdin.try_lock() {
                        *guard = Some(si);
                    } else {
                        let stdin_arc = Arc::clone(&handle.stdin);
                        tauri::async_runtime::spawn(async move {
                            let mut guard = stdin_arc.lock().await;
                            *guard = Some(si);
                        });
                    }
                }

                if let Some(so) = child_stdout {
                    let pending_map = Arc::clone(&handle_clone.pending);
                    let clip_flag = Arc::clone(&handle_clone.clipboard_watch);
                    let app_clone = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let mut lines = BufReader::new(so).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            let trimmed = line.trim();
                            if trimmed.is_empty() {
                                continue;
                            }
                            let Ok(val) = serde_json::from_str::<Value>(trimmed) else {
                                continue;
                            };

                            if let Some(id) = val.get("id").and_then(|v| v.as_u64()) {
                                let tx = {
                                    let mut map = pending_map.lock().await;
                                    map.remove(&id)
                                };
                                if let Some(sender) = tx {
                                    let ok = val.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
                                    if ok {
                                        let _ = sender.send(Ok(val.get("result").cloned().unwrap_or(Value::Null)));
                                    } else {
                                        let err = val
                                            .get("error")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("engine_error")
                                            .to_string();
                                        let _ = sender.send(Err(err));
                                    }
                                }
                                continue;
                            }

                            if let Some(ev) = val.get("event").and_then(|v| v.as_str()) {
                                let payload = val.get("payload").cloned().unwrap_or(Value::Null);
                                if ev == "fairy:state" {
                                    if let Some(cw) = payload
                                        .pointer("/butler/preferences/clipboardWatch")
                                        .and_then(|v| v.as_bool())
                                    {
                                        clip_flag.store(cw, Ordering::Relaxed);
                                    }
                                }
                                if ev != "engine:ready" {
                                    let _ = app_clone.emit(ev, payload);
                                }
                            }
                        }

                        // Engine exited: fail any remaining waiters.
                        let mut map = pending_map.lock().await;
                        for (_, sender) in map.drain() {
                            let _ = sender.send(Err("engine_exited".to_string()));
                        }
                    });
                }

                // Reap child process when it exits.
                tauri::async_runtime::spawn(async move {
                    let _ = child.wait().await;
                });
            }
            Err(_) => {
                // Failed to spawn node; RPC calls will return engine_unavailable.
            }
        }

        handle
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        {
            let mut map = self.pending.lock().await;
            map.insert(id, tx);
        }

        let msg = format!("{}\n", json!({ "id": id, "method": method, "params": params }));
        let write_res = {
            let mut guard = self.stdin.lock().await;
            if let Some(si) = guard.as_mut() {
                if let Err(e) = si.write_all(msg.as_bytes()).await {
                    Err(e.to_string())
                } else {
                    si.flush().await.map_err(|e| e.to_string())
                }
            } else {
                Err("engine_unavailable".to_string())
            }
        };

        if let Err(err) = write_res {
            let mut map = self.pending.lock().await;
            map.remove(&id);
            return Err(err);
        }

        match tokio::time::timeout(std::time::Duration::from_secs(65), rx).await {
            Ok(Ok(res)) => res,
            Ok(Err(_)) => Err("engine_channel_closed".to_string()),
            Err(_) => {
                let mut map = self.pending.lock().await;
                map.remove(&id);
                Err("engine_timeout".to_string())
            }
        }
    }

    pub fn call_detached(&self, method: &'static str, params: Value) {
        let stdin = Arc::clone(&self.stdin);
        let msg = format!("{}\n", json!({ "method": method, "params": params }));
        tauri::async_runtime::spawn(async move {
            let mut guard = stdin.lock().await;
            if let Some(si) = guard.as_mut() {
                let _ = si.write_all(msg.as_bytes()).await;
                let _ = si.flush().await;
            }
        });
    }
}

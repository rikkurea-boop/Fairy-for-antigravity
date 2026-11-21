//! JS bindings for `desktop-app/butler-pure.mjs`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use napi_derive::napi;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;
pub mod utf16;

fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".into())
}

#[allow(dead_code)]
fn run<T>(f: impl FnOnce() -> Result<T, String>) -> napi::Result<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(result) => result.map_err(napi::Error::from_reason),
        Err(payload) => Err(napi::Error::from_reason(format!(
            "Rust panic: {}",
            panic_message(&*payload)
        ))),
    }
}

/// `pickQuip`.
#[napi(js_name = "pickQuip")]
pub fn pick_quip(category: String, seed: Option<f64>) -> napi::Result<String> {
    run(move || {
        let category = crate::js::from_json(&category)?;
        let out = port::pick_quip(category, seed)?;
        crate::js::to_json(&out)
    })
}

/// `formatCompactTokens`.
#[napi(js_name = "formatCompactTokens")]
pub fn format_compact_tokens(num: String) -> napi::Result<String> {
    run(move || {
        let num = crate::js::from_json(&num)?;
        let out = port::format_compact_tokens(num)?;
        crate::js::to_json(&out)
    })
}

/// `formatModelLabel`.
#[napi(js_name = "formatModelLabel")]
pub fn format_model_label(raw_model: String) -> napi::Result<String> {
    run(move || {
        let raw_model = crate::js::from_json(&raw_model)?;
        let out = port::format_model_label(raw_model)?;
        crate::js::to_json(&out)
    })
}

/// `normalizeWorkspacePath`.
#[napi(js_name = "normalizeWorkspacePath")]
pub fn normalize_workspace_path(raw: String) -> napi::Result<String> {
    run(move || {
        let raw = crate::js::from_json(&raw)?;
        let out = port::normalize_workspace_path(raw)?;
        crate::js::to_json(&out)
    })
}

/// `classifyForegroundApp`.
#[napi(js_name = "classifyForegroundApp")]
pub fn classify_foreground_app(process_name: String, window_title: String) -> napi::Result<String> {
    run(move || {
        let process_name = crate::js::from_json(&process_name)?;
        let window_title = crate::js::from_json(&window_title)?;
        let out = port::classify_foreground_app(process_name, window_title)?;
        crate::js::to_json(&out)
    })
}

/// `extractFirstUrl`.
#[napi(js_name = "extractFirstUrl")]
pub fn extract_first_url(text: String) -> napi::Result<String> {
    run(move || {
        let text = crate::js::from_json(&text)?;
        let out = port::extract_first_url(text)?;
        crate::js::to_json(&out)
    })
}

/// `parseButlerCommand`.
#[napi(js_name = "parseButlerCommand")]
pub fn parse_butler_command(raw_text: String) -> napi::Result<String> {
    run(move || {
        let raw_text = crate::js::from_json(&raw_text)?;
        let out = port::parse_butler_command(raw_text)?;
        crate::js::to_json(&out)
    })
}

// ---- the binary wire ------------------------------------------------------------------------

type WireBuffers = (
    napi::bindgen_prelude::Uint8Array,
    napi::bindgen_prelude::Uint8Array,
    napi::bindgen_prelude::Uint32Array,
);

thread_local! {
    static WIRE: std::cell::RefCell<Option<WireBuffers>> = const { std::cell::RefCell::new(None) };
    static PENDING: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
    static SCRATCH: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// Registers the argument, result and argument-length buffers `index.cjs` uses.
#[napi(js_name = "rustAnythingWireInit")]
pub fn rust_anything_wire_init(
    input: napi::bindgen_prelude::Uint8Array,
    output: napi::bindgen_prelude::Uint8Array,
    len: napi::bindgen_prelude::Uint32Array,
) {
    WIRE.with(|w| *w.borrow_mut() = Some((input, output, len)));
}

/// Copies a result that did not fit into the (now larger) result buffer.
#[napi(js_name = "rustAnythingWireFlush")]
pub fn rust_anything_wire_flush() -> f64 {
    let bytes = PENDING.with(|p| std::mem::take(&mut *p.borrow_mut()));
    WIRE.with(|w| {
        let mut w = w.borrow_mut();
        let Some((_, output, _)) = w.as_mut() else {
            return -1.0;
        };
        // SAFETY: the call is synchronous; JS does not touch `output` until it returns.
        let out = unsafe { output.as_mut() };
        let n = bytes.len().min(out.len());
        out[..n].copy_from_slice(&bytes[..n]);
        n as f64
    })
}

/// Reads the argument bytes (`wLen[0]` of them), runs `f`, and writes its result; a negative
/// return is the size of a result that did not fit, kept for `rustAnythingWireFlush`.
fn wire_io(
    f: impl FnOnce(&mut wire::Reader, &mut wire::Writer) -> Result<(), String>,
) -> napi::Result<f64> {
    WIRE.with(|cell| {
        let mut guard = cell.borrow_mut();
        let Some((input, output, len)) = guard.as_mut() else {
            return Err(napi::Error::from_reason(
                "rust-anything: the wire buffers are not registered",
            ));
        };
        let len = (len.first().copied().unwrap_or(0) as usize).min(input.len());
        let mut w = wire::Writer(SCRATCH.with(|s| std::mem::take(&mut *s.borrow_mut())));
        w.0.clear();
        let result = run(|| f(&mut wire::Reader::new(&input[..len]), &mut w));
        let keep = |w: wire::Writer| SCRATCH.with(|s| *s.borrow_mut() = w.0);
        match result {
            // A result of another shape than the TS type: JS runs the call through JSON.
            Err(e) if e.reason.starts_with(wire::MISMATCH) => {
                keep(w);
                return Ok(f64::NAN);
            }
            Err(e) => {
                keep(w);
                let mut m = wire::Writer::default();
                m.string16(&e.reason);
                // SAFETY: the call is synchronous; JS does not touch `output` until it returns.
                let out = unsafe { output.as_mut() };
                if m.0.len() > out.len() {
                    return Err(e);
                }
                out[..m.0.len()].copy_from_slice(&m.0);
                return Ok(f64::INFINITY);
            }
            Ok(()) => {}
        }
        // SAFETY: the call is synchronous; JS does not touch `output` until it returns.
        let out = unsafe { output.as_mut() };
        let n = w.0.len();
        if n > out.len() {
            PENDING.with(|p| *p.borrow_mut() = w.0);
            return Ok(-(n as f64));
        }
        out[..n].copy_from_slice(&w.0);
        keep(w);
        Ok(n as f64)
    })
}

static S_PICK_QUIP_0: wire::Schema = wire::Schema::Dyn;
static S_PICK_QUIP_OUT: wire::Schema = wire::Schema::Dyn;

/// `pickQuip` over the binary wire.
#[napi(js_name = "pickQuipWire")]
pub fn pick_quip_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let category: serde_json::Value = wire::read_value(r, &S_PICK_QUIP_0)?;
        let seed: Option<f64> = r.opt_js(|r| r.f64())?;
        let out = &port::pick_quip(category, seed)?;
        wire::write_value(w, out, &S_PICK_QUIP_OUT)?;
        Ok(())
    })
}

static S_FORMAT_COMPACT_TOKENS_0: wire::Schema = wire::Schema::Dyn;
static S_FORMAT_COMPACT_TOKENS_OUT: wire::Schema = wire::Schema::Dyn;

/// `formatCompactTokens` over the binary wire.
#[napi(js_name = "formatCompactTokensWire")]
pub fn format_compact_tokens_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let num: serde_json::Value = wire::read_value(r, &S_FORMAT_COMPACT_TOKENS_0)?;
        let out = &port::format_compact_tokens(num)?;
        wire::write_value(w, out, &S_FORMAT_COMPACT_TOKENS_OUT)?;
        Ok(())
    })
}

static S_FORMAT_MODEL_LABEL_0: wire::Schema = wire::Schema::Dyn;
static S_FORMAT_MODEL_LABEL_OUT: wire::Schema = wire::Schema::Dyn;

/// `formatModelLabel` over the binary wire.
#[napi(js_name = "formatModelLabelWire")]
pub fn format_model_label_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let raw_model: serde_json::Value = wire::read_value(r, &S_FORMAT_MODEL_LABEL_0)?;
        let out = &port::format_model_label(raw_model)?;
        wire::write_value(w, out, &S_FORMAT_MODEL_LABEL_OUT)?;
        Ok(())
    })
}

static S_NORMALIZE_WORKSPACE_PATH_0: wire::Schema = wire::Schema::Dyn;
static S_NORMALIZE_WORKSPACE_PATH_OUT: wire::Schema = wire::Schema::Dyn;

/// `normalizeWorkspacePath` over the binary wire.
#[napi(js_name = "normalizeWorkspacePathWire")]
pub fn normalize_workspace_path_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let raw: serde_json::Value = wire::read_value(r, &S_NORMALIZE_WORKSPACE_PATH_0)?;
        let out = &port::normalize_workspace_path(raw)?;
        wire::write_value(w, out, &S_NORMALIZE_WORKSPACE_PATH_OUT)?;
        Ok(())
    })
}

static S_CLASSIFY_FOREGROUND_APP_0: wire::Schema = wire::Schema::Dyn;
static S_CLASSIFY_FOREGROUND_APP_1: wire::Schema = wire::Schema::Dyn;
static S_CLASSIFY_FOREGROUND_APP_OUT: wire::Schema = wire::Schema::Dyn;

/// `classifyForegroundApp` over the binary wire.
#[napi(js_name = "classifyForegroundAppWire")]
pub fn classify_foreground_app_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let process_name: serde_json::Value = wire::read_value(r, &S_CLASSIFY_FOREGROUND_APP_0)?;
        let window_title: serde_json::Value = wire::read_value(r, &S_CLASSIFY_FOREGROUND_APP_1)?;
        let out = &port::classify_foreground_app(process_name, window_title)?;
        wire::write_value(w, out, &S_CLASSIFY_FOREGROUND_APP_OUT)?;
        Ok(())
    })
}

static S_EXTRACT_FIRST_URL_0: wire::Schema = wire::Schema::Dyn;
static S_EXTRACT_FIRST_URL_OUT: wire::Schema = wire::Schema::Dyn;

/// `extractFirstUrl` over the binary wire.
#[napi(js_name = "extractFirstUrlWire")]
pub fn extract_first_url_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let text: serde_json::Value = wire::read_value(r, &S_EXTRACT_FIRST_URL_0)?;
        let out = &port::extract_first_url(text)?;
        wire::write_value(w, out, &S_EXTRACT_FIRST_URL_OUT)?;
        Ok(())
    })
}

static S_PARSE_BUTLER_COMMAND_0: wire::Schema = wire::Schema::Dyn;
static S_PARSE_BUTLER_COMMAND_OUT: wire::Schema = wire::Schema::Dyn;

/// `parseButlerCommand` over the binary wire.
#[napi(js_name = "parseButlerCommandWire")]
pub fn parse_butler_command_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let raw_text: serde_json::Value = wire::read_value(r, &S_PARSE_BUTLER_COMMAND_0)?;
        let out = &port::parse_butler_command(raw_text)?;
        wire::write_value(w, out, &S_PARSE_BUTLER_COMMAND_OUT)?;
        Ok(())
    })
}

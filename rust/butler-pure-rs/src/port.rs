//! The Rust port of `desktop-app/butler-pure.mjs`.

#![forbid(unsafe_code)]

use crate::js;
use regex::Regex;
use serde_json::{Value, json};
use std::sync::LazyLock;

const IDLE_QUIPS: &[&str] = &[
    "— Ting~ Mọi luồng H.D.D và Antigravity đang đồng bộ chuẩn xác, thưa Master.",
    "Hiệu năng của hệ thống này vẫn ở mức tối đa. Phản xạ 82 mili-giây luôn sẵn sàng phục vụ.",
    "Tôi giải quyết phần nặng nhọc, Master chỉ cần duyệt kết quả — giao kèo công bằng chứ?",
    "Đang chờ chỉ thị tiếp theo của ngài. Chế độ treo cũng chỉ tốn chút điện năng thôi.",
    "Ghi nhận dữ liệu: Truyện kinh dị ngắn mang tên \"Hóa đơn tiền điện tháng này\" vẫn đang chờ ngài viết tiếp.",
];
const ELEC75_QUIPS: &[&str] = &[
    "— Cảnh báo nhẹ: Mức tiêu thụ điện năng H.D.D hôm nay đã chạm 75% định mức rồi đấy, Master.",
    "Một AI Thế hệ III đang tuổi lớn cũng cần nạp điện, nhưng ngài tiêu tới 75% định mức hôm nay rồi.",
];
const ELEC90_QUIPS: &[&str] = &[
    "— Cảnh báo: Mức điện năng H.D.D đã đạt 90% định mức! Kiến nghị Master cân nhắc mô hình nhẹ hơn để tránh hóa đơn x5.",
];
const ELEC100_QUIPS: &[&str] = &[
    "— Cảnh báo đỏ: Vượt 100% định mức Điện năng H.D.D hôm nay! Master, câu chuyện kinh dị mang tên hóa đơn tiền điện đã thành sự thật.",
];
const SPIKE_QUIPS: &[&str] = &[
    "— Ghi nhận dữ liệu: Lượt vừa rồi ngốn hơn 500 nghìn token mới. Trí tuệ tối thượng của tôi quả thực đắt đỏ nhỉ, Master?",
];
const AFK_QUIPS: &[&str] = &[
    "Master, tôi phát hiện công suất lao động của ngài vừa chạm đáy suốt 45 phút qua. Hay ngài lại định bỏ mặc H.D.D chạy không tải?",
];
const NIGHT_QUIPS: &[&str] = &[
    "Cảnh báo: Đã qua nửa đêm rồi, Master. Xong lượt này kiến nghị ngài tắt máy đi ngủ, ngay cả Fairy cũng không muốn trả hộ tiền điện ban đêm đâu.",
];
const AIWEB_QUIPS: &[&str] = &[
    "— Phát hiện Master đang ghé thăm hệ thống AI ngoài. Đừng quên bật \"Tự đọc\" nếu ngài muốn tôi đọc to phản hồi ở đó với tốc độ 82 mili-giây.",
];

fn js_raw_string(v: &Value) -> String {
    if js::is_undefined(v) {
        return "undefined".into();
    }
    if let Some(units) = js::string_units(v) {
        return String::from_utf16_lossy(&units);
    }
    if let Some(n) = js::as_number(v) {
        return js::number_to_string(n);
    }
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => if *b { "true" } else { "false" }.into(),
        Value::Array(arr) => arr
            .iter()
            .map(|item| {
                if item.is_null() || js::is_undefined(item) {
                    String::new()
                } else {
                    js_raw_string(item)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
        _ => String::new(),
    }
}

fn js_or_empty_string(v: &Value) -> String {
    let is_falsy = match v {
        Value::Null => true,
        Value::Bool(b) => !*b,
        Value::String(s) => s.is_empty(),
        Value::Number(n) => n.as_f64().is_none_or(|x| x == 0.0 || x.is_nan()),
        _ if js::is_undefined(v) => true,
        _ => js::as_number(v).is_some_and(|x| x == 0.0 || x.is_nan()),
    };
    if is_falsy {
        String::new()
    } else {
        js_raw_string(v)
    }
}

fn js_to_number(v: &Value) -> f64 {
    if js::is_undefined(v) {
        return f64::NAN;
    }
    if let Some(n) = js::as_number(v) {
        return n;
    }
    match v {
        Value::Null => 0.0,
        Value::Bool(b) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                0.0
            } else {
                t.parse::<f64>().unwrap_or(f64::NAN)
            }
        }
        Value::Array(arr) => match arr.len() {
            0 => 0.0,
            1 => js_to_number(&arr[0]),
            _ => f64::NAN,
        },
        _ => f64::NAN,
    }
}

fn rx(pat: &str) -> Regex {
    Regex::new(pat).unwrap_or_else(|_| Regex::new("a^").unwrap_or_else(|_| unreachable!()))
}

fn encode_uri_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 2);
    for b in input.as_bytes() {
        let keep = b.is_ascii_alphanumeric()
            || matches!(
                *b,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            );
        if keep {
            out.push(*b as char);
        } else {
            out.push('%');
            out.push_str(&format!("{b:02X}"));
        }
    }
    out
}

fn percent_decode_utf8(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let (Some(h), Some(l)) = (
                (bytes[i + 1] as char).to_digit(16),
                (bytes[i + 2] as char).to_digit(16),
            )
        {
            out.push((h * 16 + l) as u8);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Port of `pickQuip` (`desktop-app/butler-pure.mjs:39`).
pub fn pick_quip(category: Value, seed: Option<f64>) -> Result<Value, String> {
    let cat = js_raw_string(&category);
    let list: &[&str] = match cat.as_str() {
        "idle" => IDLE_QUIPS,
        "electricity75" => ELEC75_QUIPS,
        "electricity90" => ELEC90_QUIPS,
        "electricity100" => ELEC100_QUIPS,
        "spike" => SPIKE_QUIPS,
        "afk" => AFK_QUIPS,
        "night" => NIGHT_QUIPS,
        "aiWeb" => AIWEB_QUIPS,
        _ => IDLE_QUIPS,
    };
    let s = seed.unwrap_or(0.0);
    let v = s.abs();
    let eff = if v == 0.0 || v.is_nan() { 0.0 } else { v };
    let idx = eff % (list.len() as f64);
    if idx.is_nan() || idx.fract() != 0.0 || idx < 0.0 {
        return Ok(js::undefined());
    }
    Ok(Value::String(list[idx as usize].to_string()))
}

/// Port of `formatCompactTokens` (`desktop-app/butler-pure.mjs:44`).
pub fn format_compact_tokens(num: Value) -> Result<Value, String> {
    let raw = js_to_number(&num);
    let n = if raw.is_nan() || raw <= 0.0 { 0.0 } else { raw };
    if n >= 1_000_000.0 {
        let prec = if n >= 10_000_000.0 { 1 } else { 2 };
        let s = format!("{:.prec$}", n / 1_000_000.0);
        let trimmed = match s.split_once('.') {
            Some((int, frac)) if frac.bytes().all(|b| b == b'0') => int,
            _ => s.as_str(),
        };
        return Ok(Value::String(format!("{trimmed}M")));
    }
    if n >= 1_000.0 {
        let prec = if n >= 100_000.0 { 0 } else { 1 };
        let s = format!("{:.prec$}", n / 1_000.0);
        let trimmed = s.strip_suffix(".0").unwrap_or(&s);
        return Ok(Value::String(format!("{trimmed}K")));
    }
    Ok(Value::String(js::number_to_string(js::math_round(n))))
}

/// Port of `formatModelLabel` (`desktop-app/butler-pure.mjs:51`).
pub fn format_model_label(raw_model: Value) -> Result<Value, String> {
    let raw_str = js_or_empty_string(&raw_model);
    let s = raw_str.trim().to_lowercase();
    if s.is_empty() {
        return Ok(Value::String("Chưa rõ".into()));
    }
    if s.contains("hydrogen-high") || s.contains("pro-high") {
        return Ok(Value::String("Gemini Pro High".into()));
    }
    if s.contains("hydrogen") || s.contains("pro-orchestrator") || s.contains("gemini-pro") {
        return Ok(Value::String("Gemini Pro".into()));
    }
    if s.contains("flash-lite") {
        return Ok(Value::String("Gemini Flash Lite".into()));
    }
    if s.contains("flash") {
        return Ok(Value::String("Gemini Flash".into()));
    }
    if s.contains("claude-opus") {
        return Ok(Value::String("Claude Opus".into()));
    }
    if s.contains("claude-sonnet") {
        return Ok(Value::String("Claude Sonnet".into()));
    }
    if s.contains("claude-haiku") {
        return Ok(Value::String("Claude Haiku".into()));
    }
    static SEP_RE: LazyLock<Regex> = LazyLock::new(|| rx("[_-]+"));
    let out = SEP_RE.replace_all(&raw_str, " ").trim().to_string();
    Ok(Value::String(out))
}

/// Port of `normalizeWorkspacePath` (`desktop-app/butler-pure.mjs:64`).
pub fn normalize_workspace_path(raw: Value) -> Result<Value, String> {
    let mut s = js_or_empty_string(&raw).trim().to_string();
    if s.is_empty() {
        return Ok(Value::String(String::new()));
    }
    if s.get(..7)
        .is_some_and(|p| p.eq_ignore_ascii_case("file://"))
    {
        let rest = &s[7..];
        let path_part = if rest.starts_with('/') {
            rest
        } else if let Some(slash) = rest.find('/') {
            &rest[slash..]
        } else {
            rest
        };
        let mut decoded = percent_decode_utf8(path_part);
        let bytes = decoded.as_bytes();
        if cfg!(windows)
            && bytes.len() >= 3
            && bytes[0] == b'/'
            && bytes[1].is_ascii_alphabetic()
            && bytes[2] == b':'
        {
            decoded.remove(0);
        }
        s = decoded;
    }
    if cfg!(windows) {
        s = s.replace('/', "\\");
    }
    let trimmed = s.trim_end_matches(['\\', '/']);
    Ok(Value::String(if trimmed.is_empty() {
        s
    } else {
        trimmed.to_string()
    }))
}

/// Port of `classifyForegroundApp` (`desktop-app/butler-pure.mjs:81`).
pub fn classify_foreground_app(process_name: Value, window_title: Value) -> Result<Value, String> {
    let proc = js_or_empty_string(&process_name).trim().to_string();
    let title = js_or_empty_string(&window_title).trim().to_string();
    let hay = format!("{proc} {title}").to_lowercase();

    static R_CHATGPT: LazyLock<Regex> = LazyLock::new(|| rx(r"\bchatgpt\b|chat\.openai\.com"));
    static R_CLAUDE: LazyLock<Regex> = LazyLock::new(|| rx(r"\bclaude\b|claude\.ai"));
    static R_GEMINI: LazyLock<Regex> =
        LazyLock::new(|| rx(r"gemini\.google\.com|google gemini|\bgemini\b"));
    static R_GROK: LazyLock<Regex> = LazyLock::new(|| rx(r"grok\.com|\bgrok\b"));
    static R_BROWSER: LazyLock<Regex> = LazyLock::new(|| {
        rx(r"(?i)(chrome|msedge|brave|firefox|opera|arc|safari|vivaldi|coccoc|zen)")
    });
    static R_IDE: LazyLock<Regex> = LazyLock::new(|| {
        rx(
            r"(?i)(code|cursor|windsurf|zed|idea|pycharm|webstorm|xcode|terminal|windowsterminal|pwsh|iterm)",
        )
    });

    let ai_brand = if R_CHATGPT.is_match(&hay) {
        "ChatGPT"
    } else if R_CLAUDE.is_match(&hay) {
        "Claude"
    } else if R_GEMINI.is_match(&hay) && !hay.contains("antigravity") {
        "Gemini Web"
    } else if hay.contains("perplexity") {
        "Perplexity"
    } else if R_GROK.is_match(&hay) {
        "Grok"
    } else if hay.contains("copilot") {
        "Copilot"
    } else {
        ""
    };

    let proc_lower = proc.to_lowercase();
    let title_lower = title.to_lowercase();
    let is_browser = R_BROWSER.is_match(&proc);
    let is_antigravity = proc_lower.contains("antigravity")
        || (title_lower.contains("antigravity") && !title_lower.contains("fairy iii"));
    let is_ide = is_antigravity || R_IDE.is_match(&proc);

    let category = if is_antigravity {
        "antigravity"
    } else if !ai_brand.is_empty() {
        "ai-web"
    } else if is_browser {
        "browser"
    } else if is_ide {
        "ide"
    } else {
        "other"
    };

    let title_utf16: Vec<u16> = title.encode_utf16().take(120).collect();
    let title_short = String::from_utf16_lossy(&title_utf16);

    Ok(json!({
        "appName": if proc.is_empty() { "Không rõ" } else { &proc },
        "title": title_short,
        "category": category,
        "aiBrand": ai_brand,
    }))
}

/// Port of `extractFirstUrl` (`desktop-app/butler-pure.mjs:112`).
pub fn extract_first_url(text: Value) -> Result<Value, String> {
    static R_URL: LazyLock<Regex> = LazyLock::new(|| rx(r#"(?i)https?://[^\s"'<>]+"#));
    let s = js_or_empty_string(&text);
    let found = R_URL.find(&s).map(|m| m.as_str()).unwrap_or("");
    Ok(Value::String(found.to_string()))
}

/// Port of `parseButlerCommand` (`desktop-app/butler-pure.mjs:117`).
pub fn parse_butler_command(raw_text: Value) -> Result<Value, String> {
    let raw = js_or_empty_string(&raw_text).trim().to_string();
    if raw.is_empty() {
        return Ok(json!({ "type": "noop", "raw": raw }));
    }

    static R_AGY: LazyLock<Regex> =
        LazyLock::new(|| rx(r"(?is)^(?:antigravity|agy)\s*[:>]\s*([\s\S]+)$"));
    if let Some(cap) = R_AGY.captures(&raw) {
        let msg = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
        if !msg.is_empty() {
            return Ok(json!({ "type": "send-antigravity", "message": msg }));
        }
    }

    let normalized = raw.trim_start_matches('/').trim();
    let lower = normalized.to_lowercase();

    static R_HELP: LazyLock<Regex> = LazyLock::new(|| rx(r"^(?:trợ giúp|help|lệnh|\?)$"));
    static R_BRIEF: LazyLock<Regex> = LazyLock::new(|| {
        rx(
            r"^(?:báo cáo|báo cáo đầu phiên|báo cáo h\.?d\.?d|briefing)(?:\s+(?:ngay|hôm nay|đi|nào))?$",
        )
    });
    static R_POWER: LazyLock<Regex> =
        LazyLock::new(|| rx(r"(?:điện năng|tiền điện|hóa đơn|quota|token|định mức)"));
    static R_NOTE_PRE: LazyLock<Regex> = LazyLock::new(|| rx(r"^ghi\s*(?:nhớ|chú)"));
    static R_CLIP_TOGGLE: LazyLock<Regex> = LazyLock::new(|| {
        rx(r"^(?:bật|tắt)\s+(?:tự đọc|theo dõi)?\s*clipboard|^(?:bật|tắt)\s+tự đọc$")
    });
    static R_CLIP_BARE: LazyLock<Regex> = LazyLock::new(|| rx(r"^(?:tự đọc|clipboard watch)$"));
    static R_CLIP_READ: LazyLock<Regex> = LazyLock::new(|| {
        rx(r"(?:đọc\s*(?:clipboard|bộ nhớ tạm|nội dung|giúp|văn bản|chữ)|tóm tắt\s*clipboard)")
    });
    static R_GIT: LazyLock<Regex> =
        LazyLock::new(|| rx(r"^(?:git(?:\s+status)?|trạng thái git|kiểm tra git|repo)$"));
    static R_WS: LazyLock<Regex> =
        LazyLock::new(|| rx(r"^(?:mở thư mục|mở workspace|mở repo|open workspace|open folder)$"));
    static R_POMO_STOP: LazyLock<Regex> =
        LazyLock::new(|| rx(r"(?:dừng|tắt|hủy)\s*(?:pomodoro|tập trung|hẹn giờ)"));
    static R_POMO_START: LazyLock<Regex> = LazyLock::new(|| {
        rx(r"^(?:pomodoro|tập trung|hẹn giờ|bắt đầu\s+pomodoro|bắt đầu\s+tập trung|đặt\s+hẹn giờ)")
    });
    static R_POMO_NUM: LazyLock<Regex> = LazyLock::new(|| {
        rx(r"(?:pomodoro|tập trung|hẹn giờ)(?:\s+(\d{1,3})\s*(?:phút|p|m|min)?)?")
    });
    static R_MEM_CLEAR: LazyLock<Regex> =
        LazyLock::new(|| rx(r"^(?:xóa|xoá|dọn)\s*(?:hết\s*)?(?:ghi chú|ghi nhớ|nhắc nhở)"));
    static R_MEM_LIST: LazyLock<Regex> =
        LazyLock::new(|| rx(r"^(?:xem\s*)?(?:bộ nhớ|trí nhớ|ghi chú|h\.?d\.?d\s*memory)$"));
    static R_MEM_ADD: LazyLock<Regex> = LazyLock::new(|| {
        rx(r"(?is)^(?:ghi\s*(?:nhớ|chú)|nhắc(?:\s+tôi)?|note)\s*[:\-]?\s+([\s\S]+)$")
    });
    static R_FOCUS_AG: LazyLock<Regex> = LazyLock::new(|| rx(r"^(?:mở|vào)\s+antigravity$"));
    static R_BOOT: LazyLock<Regex> = LazyLock::new(|| rx(r"^(?:khởi động lại|boot|mở boot)$"));
    static R_OPEN_PRE: LazyLock<Regex> = LazyLock::new(|| rx(r"^(?:mở|open)\b"));
    static R_SEARCH: LazyLock<Regex> =
        LazyLock::new(|| rx(r"(?is)^(?:tìm|tra cứu|google|search)\s+([\s\S]+)$"));

    if R_HELP.is_match(&lower) {
        return Ok(json!({ "type": "help" }));
    }
    if R_BRIEF.is_match(&lower) {
        return Ok(json!({ "type": "briefing-now" }));
    }
    if R_POWER.is_match(&lower) && !R_NOTE_PRE.is_match(&lower) {
        return Ok(json!({ "type": "power-report" }));
    }
    if R_CLIP_TOGGLE.is_match(&lower) {
        return Ok(
            json!({ "type": "toggle-clipboard-watch", "enabled": lower.starts_with("bật") }),
        );
    }
    if R_CLIP_BARE.is_match(&lower) {
        return Ok(json!({ "type": "toggle-clipboard-watch", "enabled": Value::Null }));
    }
    if R_CLIP_READ.is_match(&lower) {
        return Ok(json!({ "type": "read-clipboard" }));
    }
    if R_GIT.is_match(&lower) {
        return Ok(json!({ "type": "git-status" }));
    }
    if R_WS.is_match(&lower) {
        return Ok(json!({ "type": "open-workspace" }));
    }
    if R_POMO_STOP.is_match(&lower) {
        return Ok(json!({ "type": "pomodoro-stop" }));
    }
    if R_POMO_START.is_match(&lower) {
        let mins = R_POMO_NUM
            .captures(&lower)
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse::<i64>().ok())
            .filter(|&v| v > 0)
            .unwrap_or(25)
            .clamp(1, 120);
        return Ok(json!({ "type": "pomodoro-start", "minutes": mins }));
    }
    if R_MEM_CLEAR.is_match(&lower) {
        return Ok(json!({ "type": "memory-clear-notes" }));
    }
    if R_MEM_LIST.is_match(&lower) {
        return Ok(json!({ "type": "memory-list" }));
    }
    if let Some(cap) = R_MEM_ADD.captures(normalized) {
        let text = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
        if !text.is_empty() {
            return Ok(json!({ "type": "memory-add-note", "text": text }));
        }
    }
    if R_FOCUS_AG.is_match(&lower) {
        return Ok(json!({ "type": "focus-antigravity" }));
    }
    if R_BOOT.is_match(&lower) {
        return Ok(json!({ "type": "replay-boot" }));
    }

    let direct_url = extract_first_url(Value::String(normalized.to_string()))?
        .as_str()
        .unwrap_or("")
        .to_string();
    if !direct_url.is_empty() && R_OPEN_PRE.is_match(&lower) {
        return Ok(json!({ "type": "open-external", "url": direct_url, "label": direct_url }));
    }

    static R_SITE_CHATGPT: LazyLock<Regex> = LazyLock::new(|| rx(r"^(?:mở|vào|bật)\s+chatgpt$"));
    static R_SITE_CLAUDE: LazyLock<Regex> = LazyLock::new(|| rx(r"^(?:mở|vào|bật)\s+claude$"));
    static R_SITE_GEMINI: LazyLock<Regex> = LazyLock::new(|| rx(r"^(?:mở|vào|bật)\s+gemini$"));
    static R_SITE_PPLX: LazyLock<Regex> = LazyLock::new(|| rx(r"^(?:mở|vào|bật)\s+perplexity$"));
    static R_SITE_GH: LazyLock<Regex> = LazyLock::new(|| rx(r"^(?:mở|vào|bật)\s+github$"));
    static R_SITE_YT: LazyLock<Regex> = LazyLock::new(|| rx(r"^(?:mở|vào|bật)\s+youtube$"));

    let site_targets: &[(&LazyLock<Regex>, &str, &str)] = &[
        (&R_SITE_CHATGPT, "https://chatgpt.com/", "ChatGPT"),
        (&R_SITE_CLAUDE, "https://claude.ai/", "Claude"),
        (&R_SITE_GEMINI, "https://gemini.google.com/", "Gemini"),
        (&R_SITE_PPLX, "https://www.perplexity.ai/", "Perplexity"),
        (&R_SITE_GH, "https://github.com/", "GitHub"),
        (&R_SITE_YT, "https://www.youtube.com/", "YouTube"),
    ];
    for (pat, url, label) in site_targets {
        if pat.is_match(&lower) {
            return Ok(json!({ "type": "open-external", "url": url, "label": label }));
        }
    }

    if let Some(cap) = R_SEARCH.captures(normalized) {
        let q = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
        if !q.is_empty() {
            let url = format!(
                "https://www.google.com/search?q={}",
                encode_uri_component(q)
            );
            let label = format!("Tìm \"{q}\"");
            return Ok(json!({ "type": "open-external", "url": url, "label": label }));
        }
    }

    if !direct_url.is_empty() {
        return Ok(json!({ "type": "open-external", "url": direct_url, "label": direct_url }));
    }

    Ok(json!({ "type": "unknown", "raw": raw }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_vietnamese_commands() {
        let res = parse_butler_command(Value::String("pomodoro 45 phút".into())).ok();
        assert_eq!(
            res.and_then(|v| v.get("minutes").and_then(|m| m.as_i64())),
            Some(45)
        );
    }

    #[test]
    fn formats_tokens_and_models() {
        assert_eq!(format_compact_tokens(json!(1500)).ok(), Some(json!("1.5K")));
        assert_eq!(
            format_model_label(json!("gemini-2.5-flash")).ok(),
            Some(json!("Gemini Flash"))
        );
    }
}

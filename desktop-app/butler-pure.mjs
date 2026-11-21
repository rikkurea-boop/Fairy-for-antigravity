/**
 * Pure deterministic helper functions extracted from butler-core.cjs
 * for rust-anything analysis, recording, napi-rs bridging, and verification.
 */
import { fileURLToPath } from 'node:url';

const FAIRY_QUIPS = {
  idle: [
    '— Ting~ Mọi luồng H.D.D và Antigravity đang đồng bộ chuẩn xác, thưa Master.',
    'Hiệu năng của hệ thống này vẫn ở mức tối đa. Phản xạ 82 mili-giây luôn sẵn sàng phục vụ.',
    'Tôi giải quyết phần nặng nhọc, Master chỉ cần duyệt kết quả — giao kèo công bằng chứ?',
    'Đang chờ chỉ thị tiếp theo của ngài. Chế độ treo cũng chỉ tốn chút điện năng thôi.',
    'Ghi nhận dữ liệu: Truyện kinh dị ngắn mang tên "Hóa đơn tiền điện tháng này" vẫn đang chờ ngài viết tiếp.',
  ],
  electricity75: [
    '— Cảnh báo nhẹ: Mức tiêu thụ điện năng H.D.D hôm nay đã chạm 75% định mức rồi đấy, Master.',
    'Một AI Thế hệ III đang tuổi lớn cũng cần nạp điện, nhưng ngài tiêu tới 75% định mức hôm nay rồi.',
  ],
  electricity90: [
    '— Cảnh báo: Mức điện năng H.D.D đã đạt 90% định mức! Kiến nghị Master cân nhắc mô hình nhẹ hơn để tránh hóa đơn x5.',
  ],
  electricity100: [
    '— Cảnh báo đỏ: Vượt 100% định mức Điện năng H.D.D hôm nay! Master, câu chuyện kinh dị mang tên hóa đơn tiền điện đã thành sự thật.',
  ],
  spike: [
    '— Ghi nhận dữ liệu: Lượt vừa rồi ngốn hơn 500 nghìn token mới. Trí tuệ tối thượng của tôi quả thực đắt đỏ nhỉ, Master?',
  ],
  afk: [
    'Master, tôi phát hiện công suất lao động của ngài vừa chạm đáy suốt 45 phút qua. Hay ngài lại định bỏ mặc H.D.D chạy không tải?',
  ],
  night: [
    'Cảnh báo: Đã qua nửa đêm rồi, Master. Xong lượt này kiến nghị ngài tắt máy đi ngủ, ngay cả Fairy cũng không muốn trả hộ tiền điện ban đêm đâu.',
  ],
  aiWeb: [
    '— Phát hiện Master đang ghé thăm hệ thống AI ngoài. Đừng quên bật "Tự đọc" nếu ngài muốn tôi đọc to phản hồi ở đó với tốc độ 82 mili-giây.',
  ],
};

export function pickQuip(category, seed = 0) {
  const list = FAIRY_QUIPS[category] || FAIRY_QUIPS.idle;
  return list[Math.abs(Number(seed) || 0) % list.length];
}

export function formatCompactTokens(num) {
  const n = Math.max(0, Number(num) || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2).replace(/\.0+$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
}

export function formatModelLabel(rawModel) {
  const s = String(rawModel || '').trim().toLowerCase();
  if (!s) return 'Chưa rõ';
  if (s.includes('hydrogen-high') || s.includes('pro-high')) return 'Gemini Pro High';
  if (s.includes('hydrogen') || s.includes('pro-orchestrator') || s.includes('gemini-pro')) return 'Gemini Pro';
  if (s.includes('flash-lite')) return 'Gemini Flash Lite';
  if (s.includes('flash')) return 'Gemini Flash';
  if (s.includes('claude-opus')) return 'Claude Opus';
  if (s.includes('claude-sonnet')) return 'Claude Sonnet';
  if (s.includes('claude-haiku')) return 'Claude Haiku';
  return String(rawModel).replace(/[_-]+/g, ' ').trim();
}

export function normalizeWorkspacePath(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (/^file:\/\//i.test(s)) {
    try {
      s = fileURLToPath(s);
    } catch {
      s = decodeURIComponent(s.replace(/^file:\/\//i, ''));
      if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(s)) s = s.slice(1);
    }
  }
  if (process.platform === 'win32') {
    s = s.replace(/\//g, '\\');
  }
  return s.replace(/[\\/]+$/, '') || s;
}

export function classifyForegroundApp(processName, windowTitle) {
  const proc = String(processName || '').trim();
  const title = String(windowTitle || '').trim();
  const hay = `${proc} ${title}`.toLowerCase();

  let aiBrand = '';
  if (/\bchatgpt\b|chat\.openai\.com/.test(hay)) aiBrand = 'ChatGPT';
  else if (/\bclaude\b|claude\.ai/.test(hay)) aiBrand = 'Claude';
  else if (/gemini\.google\.com|google gemini|\bgemini\b/.test(hay) && !/antigravity/.test(hay)) aiBrand = 'Gemini Web';
  else if (/perplexity/.test(hay)) aiBrand = 'Perplexity';
  else if (/grok\.com|\bgrok\b/.test(hay)) aiBrand = 'Grok';
  else if (/copilot/.test(hay)) aiBrand = 'Copilot';

  const isBrowser = /(chrome|msedge|brave|firefox|opera|arc|safari|vivaldi|coccoc|zen)/i.test(proc);
  const isAntigravity = /antigravity/i.test(proc) || (/antigravity/i.test(title) && !/fairy iii/i.test(title));
  const isIde = isAntigravity || /(code|cursor|windsurf|zed|idea|pycharm|webstorm|xcode|terminal|windowsterminal|pwsh|iterm)/i.test(proc);

  let category = 'other';
  if (isAntigravity) category = 'antigravity';
  else if (aiBrand) category = 'ai-web';
  else if (isBrowser) category = 'browser';
  else if (isIde) category = 'ide';

  return {
    appName: proc || 'Không rõ',
    title: title.slice(0, 120),
    category,
    aiBrand,
  };
}

export function extractFirstUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0] : '';
}

export function parseButlerCommand(rawText) {
  const raw = String(rawText || '').trim();
  if (!raw) return { type: 'noop', raw };

  const agyDirect = raw.match(/^(?:antigravity|agy)\s*[:>]\s*([\s\S]+)$/i);
  if (agyDirect && agyDirect[1].trim()) {
    return { type: 'send-antigravity', message: agyDirect[1].trim() };
  }

  const normalized = raw.replace(/^\/+/, '').trim();
  const lower = normalized.toLowerCase();

  if (/^(?:trợ giúp|help|lệnh|\?)$/i.test(lower)) {
    return { type: 'help' };
  }
  if (/^(?:báo cáo|báo cáo đầu phiên|báo cáo h\.?d\.?d|briefing)(?:\s+(?:ngay|hôm nay|đi|nào))?$/i.test(lower)) {
    return { type: 'briefing-now' };
  }
  if (/(?:điện năng|tiền điện|hóa đơn|quota|token|định mức)/i.test(lower) && !/^ghi\s*(?:nhớ|chú)/i.test(lower)) {
    return { type: 'power-report' };
  }
  if (/^(?:bật|tắt)\s+(?:tự đọc|theo dõi)?\s*clipboard|^(?:bật|tắt)\s+tự đọc$/i.test(lower)) {
    return { type: 'toggle-clipboard-watch', enabled: /^bật/i.test(lower) };
  }
  if (/^(?:tự đọc|clipboard watch)$/i.test(lower)) {
    return { type: 'toggle-clipboard-watch', enabled: null };
  }
  if (/(?:đọc\s*(?:clipboard|bộ nhớ tạm|nội dung|giúp|văn bản|chữ)|tóm tắt\s*clipboard)/i.test(lower)) {
    return { type: 'read-clipboard' };
  }
  if (/^(?:git(?:\s+status)?|trạng thái git|kiểm tra git|repo)$/i.test(lower)) {
    return { type: 'git-status' };
  }
  if (/^(?:mở thư mục|mở workspace|mở repo|open workspace|open folder)$/i.test(lower)) {
    return { type: 'open-workspace' };
  }
  if (/(?:dừng|tắt|hủy)\s*(?:pomodoro|tập trung|hẹn giờ)/i.test(lower)) {
    return { type: 'pomodoro-stop' };
  }
  const pomoMatch = lower.match(/(?:pomodoro|tập trung|hẹn giờ)(?:\s+(\d{1,3})\s*(?:phút|p|m|min)?)?/i);
  if (pomoMatch && /^(?:pomodoro|tập trung|hẹn giờ|bắt đầu\s+pomodoro|bắt đầu\s+tập trung|đặt\s+hẹn giờ)/i.test(lower)) {
    const mins = Math.max(1, Math.min(120, Number(pomoMatch[1]) || 25));
    return { type: 'pomodoro-start', minutes: mins };
  }
  if (/^(?:xóa|xoá|dọn)\s*(?:hết\s*)?(?:ghi chú|ghi nhớ|nhắc nhở)/i.test(lower)) {
    return { type: 'memory-clear-notes' };
  }
  if (/^(?:xem\s*)?(?:bộ nhớ|trí nhớ|ghi chú|h\.?d\.?d\s*memory)$/i.test(lower)) {
    return { type: 'memory-list' };
  }
  const noteMatch = normalized.match(/^(?:ghi\s*(?:nhớ|chú)|nhắc(?:\s+tôi)?|note)\s*[:\-]?\s+([\s\S]+)$/i);
  if (noteMatch && noteMatch[1].trim()) {
    return { type: 'memory-add-note', text: noteMatch[1].trim() };
  }
  if (/^(?:mở|vào)\s+antigravity$/i.test(lower)) {
    return { type: 'focus-antigravity' };
  }
  if (/^(?:khởi động lại|boot|mở boot)$/i.test(lower)) {
    return { type: 'replay-boot' };
  }

  const directUrl = extractFirstUrl(normalized);
  if (directUrl && /^(?:mở|open)\b/i.test(lower)) {
    return { type: 'open-external', url: directUrl, label: directUrl };
  }

  const openTargetMap = [
    [/^(?:mở|vào|bật)\s+chatgpt$/i, 'https://chatgpt.com/', 'ChatGPT'],
    [/^(?:mở|vào|bật)\s+claude$/i, 'https://claude.ai/', 'Claude'],
    [/^(?:mở|vào|bật)\s+gemini$/i, 'https://gemini.google.com/', 'Gemini'],
    [/^(?:mở|vào|bật)\s+perplexity$/i, 'https://www.perplexity.ai/', 'Perplexity'],
    [/^(?:mở|vào|bật)\s+github$/i, 'https://github.com/', 'GitHub'],
    [/^(?:mở|vào|bật)\s+youtube$/i, 'https://www.youtube.com/', 'YouTube'],
  ];
  for (const [rx, url, label] of openTargetMap) {
    if (rx.test(lower)) return { type: 'open-external', url, label };
  }

  const searchMatch = normalized.match(/^(?:tìm|tra cứu|google|search)\s+([\s\S]+)$/i);
  if (searchMatch && searchMatch[1].trim()) {
    const q = searchMatch[1].trim();
    return {
      type: 'open-external',
      url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
      label: `Tìm "${q}"`,
    };
  }

  if (directUrl) {
    return { type: 'open-external', url: directUrl, label: directUrl };
  }

  return { type: 'unknown', raw };
}

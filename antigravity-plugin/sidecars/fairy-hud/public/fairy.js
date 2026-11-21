/* Fairy III · H.D.D Terminal Aux Pane Frontend (Vietnamese)
 * Full Fairy-DSH visual engine: HALO_SVG (229 scanlines), PULSE_SVG (5 concentric waves),
 * dual glitch system (threads SVG turbulence + 5-slice lockLashFrame blocks), 2-burst state
 * transitions, master cubic-bezier RAF clock, gaze tracking, and 8 expressions.
 */
(() => {
  const PREF_KEYS = {
    autoBoot: 'fairy.antigravity.autoBoot',
    volume: 'fairy.antigravity.volume',
    effects: 'fairy.antigravity.effects',
    theme: 'fairy.antigravity.theme',
    rate: 'fairy.antigravity.rate',
    petMode: 'fairy.antigravity.petMode',
    bootedPort: 'fairy.antigravity.bootedPort',
    bootedSessionId: 'fairy.antigravity.bootedSessionId',
  };

  function buildHaloSvg(uid) {
    const paths = new Map();
    for (let y = -34; y <= 194; y += 1) {
      const t = y + 34;
      const leftWave = (Math.sin(t * 0.082 - 1.1) + 0.55 * Math.sin(t * 0.151 + 2.4) + 1.55) / 3.1;
      const rightWave = (Math.sin(t * 0.097 + 2.2) + 0.5 * Math.sin(t * 0.137 - 1.7) + 1.5) / 3;
      const leftLength = 158 + leftWave * 56;
      const rightLength = 158 + rightWave * 56;
      const length = leftLength + rightLength;
      const brightness = 0.5 + ((leftWave + rightWave) * 0.5) * 0.5;
      const x = 80 - leftLength;
      const bucket = Math.max(0.5, Math.min(1, Math.round(brightness * 8) / 8)).toFixed(3);
      if (!paths.has(bucket)) paths.set(bucket, []);
      paths.get(bucket).push(`M${x.toFixed(2)} ${(y + 0.25).toFixed(2)}h${length.toFixed(2)}`);
    }
    const lineSvg = Array.from(paths.entries())
      .map(([op, segs]) => `<path d="${segs.join('')}" fill="none" stroke="currentColor" stroke-width=".62" stroke-linecap="butt" opacity="${op}"/>`)
      .join('');
    return `<svg class="fz3-halo-layer" viewBox="-180 -70 520 320" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" role="presentation"><defs><radialGradient id="${uid}-halo-fade" gradientUnits="userSpaceOnUse" color-interpolation="linearRGB" cx="80" cy="80" r="124"><stop offset="0" stop-color="black"/><stop offset=".44" stop-color="black"/><stop offset=".45" stop-color="white" stop-opacity=".08"/><stop offset=".46" stop-color="white" stop-opacity=".30"/><stop offset=".47" stop-color="white" stop-opacity=".65"/><stop offset=".48" stop-color="white"/><stop offset=".52" stop-color="white" stop-opacity=".72"/><stop offset=".56" stop-color="white" stop-opacity=".56"/><stop offset=".60" stop-color="white" stop-opacity=".44"/><stop offset=".65" stop-color="white" stop-opacity=".30"/><stop offset=".71" stop-color="white" stop-opacity=".19"/><stop offset=".77" stop-color="white" stop-opacity=".135"/><stop offset=".83" stop-color="white" stop-opacity=".09"/><stop offset=".89" stop-color="white" stop-opacity=".058"/><stop offset=".95" stop-color="white" stop-opacity=".019"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient><mask id="${uid}-halo-mask" mask-type="luminance" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="-260" y="-120" width="680" height="440"><rect x="-260" y="-120" width="680" height="440" fill="url(#${uid}-halo-fade)"/></mask></defs><g mask="url(#${uid}-halo-mask)" opacity=".99">${lineSvg}</g></svg>`;
  }

  const PULSE_SVG = `<svg class="fz3-pulse-layer" viewBox="-160 -160 480 480" xmlns="http://www.w3.org/2000/svg" role="presentation"><g class="fz3-lash-pulse" fill="none" stroke="currentColor"><g class="fz3-lash-pulse-wave"><circle cx="80" cy="80" r="52" stroke-width="20" stroke-opacity=".05"/><circle cx="80" cy="80" r="52" stroke-width="16" stroke-opacity=".06"/><circle cx="80" cy="80" r="52" stroke-width="12" stroke-opacity=".08"/><circle cx="80" cy="80" r="52" stroke-width="8" stroke-opacity=".10"/><circle cx="80" cy="80" r="52" stroke-width="4.5" stroke-opacity=".09"/></g></g></svg>`;

  /* SPDX-License-Identifier: Apache-2.0 Adapted from Fairy-DSH, Copyright 2026 Chengzhibense. */
  function buildMainEyeSvg(uid) {
    return `<!-- SPDX-License-Identifier: Apache-2.0 Adapted from Fairy-DSH, Copyright 2026 Chengzhibense. --><svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="-1 -1 162 162"><defs><linearGradient id="${uid}-outer-grad" x1=".2" y1="0" x2=".8" y2="1"><stop stop-color="#4053f0"/><stop offset=".54" stop-color="#3045dc"/><stop offset="1" stop-color="#3d50c8"/></linearGradient><radialGradient id="${uid}-sclera-halo" gradientUnits="userSpaceOnUse" cx="80" cy="80" r="56" color-interpolation="linearRGB"><stop offset=".82" stop-color="#ffffff" stop-opacity="0"/><stop offset=".864" stop-color="#ffffff" stop-opacity=".22"/><stop offset=".875" stop-color="#ffffff" stop-opacity=".28"/><stop offset=".89" stop-color="#ffffff" stop-opacity=".19"/><stop offset=".91" stop-color="#ffffff" stop-opacity=".11"/><stop offset=".94" stop-color="#ffffff" stop-opacity=".07"/><stop offset=".96" stop-color="#ffffff" stop-opacity=".035"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient><radialGradient id="${uid}-outer-halo" gradientUnits="userSpaceOnUse" cx="80" cy="80" r="79" color-interpolation="linearRGB"><stop offset=".80" stop-color="#c9f8ff" stop-opacity="0"/><stop offset=".84" stop-color="#c9f8ff" stop-opacity=".10"/><stop offset=".868" stop-color="#c9f8ff" stop-opacity=".28"/><stop offset=".90" stop-color="#c9f8ff" stop-opacity=".18"/><stop offset=".95" stop-color="#c9f8ff" stop-opacity=".06"/><stop offset=".99" stop-color="#c9f8ff" stop-opacity=".02"/><stop offset="1" stop-color="#c9f8ff" stop-opacity="0"/></radialGradient><radialGradient id="${uid}-hl-halo" gradientUnits="userSpaceOnUse" cx="98" cy="100.5" r="18" color-interpolation="linearRGB"><stop offset=".53" stop-color="#f5f8fd" stop-opacity="0"/><stop offset=".56" stop-color="#f5f8fd" stop-opacity=".16"/><stop offset=".611" stop-color="#f5f8fd" stop-opacity=".43"/><stop offset=".72" stop-color="#f5f8fd" stop-opacity=".19"/><stop offset=".77" stop-color="#f5f8fd" stop-opacity=".12"/><stop offset=".83" stop-color="#f5f8fd" stop-opacity=".055"/><stop offset=".89" stop-color="#f5f8fd" stop-opacity=".02"/><stop offset=".96" stop-color="#f5f8fd" stop-opacity=".004"/><stop offset="1" stop-color="#f5f8fd" stop-opacity="0"/></radialGradient><pattern id="${uid}-lines" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#c9f8ff" opacity=".055"/></pattern><filter id="${uid}-interference" x="-30%" y="0%" width="160%" height="100%" filterRes="96 72" color-interpolation-filters="sRGB"><feTurbulence class="fz3-noise-el" type="fractalNoise" baseFrequency=".012 .72" numOctaves="1" seed="1" result="noise"/><feColorMatrix in="noise" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 0 0 .5  0 0 0 1 0" result="horizontal-noise"/><feDisplacementMap class="fz3-displace-el" in="SourceGraphic" in2="horizontal-noise" scale="5" xChannelSelector="R" yChannelSelector="B"/></filter><clipPath id="${uid}-disc-clip"><circle cx="80" cy="80" r="67"/></clipPath><clipPath id="${uid}-lid-clip"><circle cx="80" cy="80" r="56"/></clipPath><clipPath id="${uid}-slice-1"><rect x="2" y="12" width="156" height="25"/></clipPath><clipPath id="${uid}-slice-2"><rect x="2" y="37" width="156" height="28"/></clipPath><clipPath id="${uid}-slice-3"><rect x="2" y="65" width="156" height="26"/></clipPath><clipPath id="${uid}-slice-4"><rect x="2" y="91" width="156" height="30"/></clipPath><clipPath id="${uid}-slice-5"><rect x="2" y="121" width="156" height="27"/></clipPath></defs><g class="fz3-p-body"><circle cx="80" cy="80" r="79" fill="url(#${uid}-outer-halo)"/><g class="fz3-signal" data-uid="${uid}"><g id="${uid}-image" class="fz3-image"><circle cx="80" cy="80" r="68" fill="none" stroke="#dceaff" stroke-width="1.8"/><circle class="fz3-outer-disc" cx="80" cy="80" r="68" fill="url(#${uid}-outer-grad)" stroke="#f2fbff" stroke-width="1.2"/><g class="fz3-p-corners" clip-path="url(#${uid}-disc-clip)" fill="#1f2573"><circle cx="80" cy="80" r="51.75"/><rect x="37" y="37" width="86" height="86" rx="2" transform="rotate(3 80 80)"/></g><g class="fz3-eye-socket"><g class="fz3-p-sclera"><circle cx="80" cy="80" r="48" fill="#eef0f5"/><circle cx="80" cy="80" r="56" fill="url(#${uid}-sclera-halo)"/><circle cx="80" cy="80" r="48" fill="none" stroke="#ffffff" stroke-width=".8" stroke-opacity=".16"/></g><g class="fz3-p-eyeball"><g class="fz3-p-iris-outer"><circle cx="80" cy="80" r="33" fill="#9daee0"/></g><g class="fz3-p-iris-blue"><circle cx="80" cy="80" r="24.15" fill="#eef0f5"/><circle cx="80" cy="80" r="23.5" fill="#2f74c9"/></g><g class="fz3-p-pupil"><circle cx="80" cy="80" r="16.6" fill="none" stroke="#f5f8fd" stroke-width=".1"/><circle cx="80" cy="80" r="16" fill="#2e2f78"/></g><g class="fz3-p-highlight"><circle cx="98" cy="100.5" r="18" fill="url(#${uid}-hl-halo)"/><circle cx="98" cy="100.5" r="11" fill="#f5f8fd"/></g></g><g class="fz3-lid-cover" clip-path="url(#${uid}-lid-clip)"><path class="fz3-lid-upper" d="M20 60 Q80 90 140 60 V-40 H20 Z" fill="#1f2573" style="transform:translateY(-90px)"/><path class="fz3-lid-lower" d="M20 112 Q80 100 140 112 V180 H20 Z" fill="#1f2573" style="transform:translateY(90px)"/></g></g><circle class="fz3-eye-flicker" cx="80" cy="80" r="68.6" fill="#ffffff" pointer-events="none"/><g clip-path="url(#${uid}-disc-clip)" opacity=".42"><rect x="12" y="10" width="136" height="146" fill="url(#${uid}-lines)"/></g></g><g class="fz3-glitch-blocks"><use href="#${uid}-image" class="fz3-glitch-1" clip-path="url(#${uid}-slice-1)"/><use href="#${uid}-image" class="fz3-glitch-2" clip-path="url(#${uid}-slice-2)"/><use href="#${uid}-image" class="fz3-glitch-3" clip-path="url(#${uid}-slice-3)"/><use href="#${uid}-image" class="fz3-glitch-4" clip-path="url(#${uid}-slice-4)"/><use href="#${uid}-image" class="fz3-glitch-5" clip-path="url(#${uid}-slice-5)"/></g></g></g></svg>`;
  }

  function buildMiniEyeSvg(uid) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 162 162"><defs><linearGradient id="${uid}-og" x1=".2" y1="0" x2=".8" y2="1"><stop stop-color="#4053f0"/><stop offset=".54" stop-color="#3045dc"/><stop offset="1" stop-color="#3d50c8"/></linearGradient></defs><circle cx="80" cy="80" r="68" fill="url(#${uid}-og)" stroke="#f2fbff" stroke-width="1.2"/><g fill="#1f2573"><circle cx="80" cy="80" r="51.75"/><rect x="37" y="37" width="86" height="86" rx="2" transform="rotate(3 80 80)"/></g><circle cx="80" cy="80" r="48" fill="#eef0f5"/><circle cx="80" cy="80" r="33" fill="#9daee0"/><circle cx="80" cy="80" r="23.5" fill="#2f74c9"/><circle cx="80" cy="80" r="16" fill="#2e2f78"/><circle cx="98" cy="100.5" r="11" fill="#f5f8fd"/></svg>`;
  }

  const $ = (id) => document.getElementById(id);
  const appEl = $('app');
  const mainEyeEl = $('main-eye');
  const eyeBtnEl = $('eye-button');
  const bootVideo = $('boot-video');
  const bootFallbackEl = $('boot-fallback-anim');
  const bootFbEyeSlot = $('boot-fb-eye-slot');
  const bootProgressBar = $('boot-progress-bar');
  const bootProgressPct = $('boot-progress-pct');
  const unmuteBanner = $('btn-unmute');

  function readPref(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writePref(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {
      // Ignore storage errors.
    }
  }

  const prefs = {
    autoBoot: Boolean(readPref(PREF_KEYS.autoBoot, false)),
    volume: Math.min(100, Math.max(0, Number(readPref(PREF_KEYS.volume, 85)) || 85)),
    effects: Boolean(readPref(PREF_KEYS.effects, true)),
    theme: String(readPref(PREF_KEYS.theme, 'auto')),
    rate: [0.7, 1, 1.5].includes(Number(readPref(PREF_KEYS.rate, 1))) ? Number(readPref(PREF_KEYS.rate, 1)) : 1,
    petMode: Boolean(readPref(PREF_KEYS.petMode, false)),
  };

  let phase = 'hud';
  let liveTelemetry = {
    conversationId: '',
    mood: 'idle',
    emotionMood: 'idle',
    dialogueQuip: '',
    lastEvent: '',
    modelName: '',
    invocationCount: 0,
    toolCount: 0,
    lastTool: '',
    lastToolError: '',
    terminationReason: '',
    sessionStartedAt: 0,
    updatedAt: 0,
    recentTools: [],
    source: 'none',
    appSessionId: '',
    bootPlayedThisSession: false,
  };
  let previewMood = '';
  let previewTimer = null;
  let lastInteractionAt = Date.now();
  let bootFailsafe = null;
  let bootVideoCheckTimer = null;
  let cachedBootMediaUrl = null;
  let initialStateResolved = false;
  let paneIntersecting = false;
  let autoBootTriggered = false;
  let greetTimer = null;
  let quipIndex = 0;

  const QUIPS = [
    'Hiệu năng của hệ thống này vẫn ở đỉnh cao. Master cứ việc giao hết đống việc rắc rối lại đây.',
    '— Ting~ Toàn bộ luồng H.D.D và kết nối Antigravity đều xanh mướt. Chế độ chờ chỉ tốn điện đôi chút thôi.',
    'Tôi sẽ làm xong việc nhanh gọn, chính xác tuyệt đối — tất nhiên không quên giữ lại quyền nhận xét.',
    'Nếu ngài lỡ viết bug khó đỡ, Fairy sẽ sửa giúp trước khi chê. Đáng tin hơn Bangboo nhiều, phải không?',
  ];

  function greetingByTime() {
    const h = new Date().getHours();
    if (h >= 0 && h < 5) {
      return 'Master, đã qua nửa đêm rồi. Cơ thể con người cần sạc pin hơn hệ thống H.D.D đấy — giải quyết nốt rồi đi ngủ nhé.';
    }
    if (h >= 5 && h < 11) {
      return 'Chào buổi sáng, Master. H.D.D đã tự kiểm tra toàn mạch — hôm nay ngài định xử lý công việc gì trước đây?';
    }
    if (h >= 11 && h < 14) {
      return 'Đã đến trưa rồi, Master. Nếu vừa ăn xong còn buồn ngủ thì cứ để Fairy giữ nhịp tỉnh táo cho.';
    }
    if (h >= 14 && h < 18) {
      return 'Chiều rồi, Master. Hàng đợi tác vụ vẫn gọn ghẽ; tôi sẽ xử lý phần nặng nhọc, ngài chỉ việc duyệt kết quả.';
    }
    if (h >= 18 && h < 23) {
      return 'Buổi tối tốt lành, Master. Liên kết H.D.D đang ổn định, sẵn sàng tiếp nhận chỉ thị mới.';
    }
    return 'Khuya rồi đấy, Master. Nếu làm thêm một lượt nữa thì nhớ chừa đường lui để đi ngủ sớm.';
  }

  function pickQuip() {
    const h = new Date().getHours();
    if (h >= 0 && h < 5 && quipIndex % 2 === 1) {
      quipIndex += 1;
      return `— Cảnh báo khuya: Đã ${String(h).padStart(2, '0')} giờ hơn rồi, Master. Gan người là vật tư tiêu hao, đừng thức trắng quá đà.`;
    }
    const text = QUIPS[quipIndex % QUIPS.length];
    quipIndex += 1;
    return text;
  }

  // ---------- Theme Sync ----------
  function detectHostTheme() {
    const hostBg = document.documentElement.style.getPropertyValue('--background').trim();
    if (hostBg) {
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--background)';
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      const nums = (color.match(/[\d.]+/g) || []).map(Number);
      if (nums.length >= 3) {
        const scale = color.startsWith('color(') ? 1 : 255;
        const [r, g, b] = nums.slice(0, 3).map((v) => v / scale);
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return lum < 0.5 ? 'dark' : 'light';
      }
    }
    if (window.parent !== window && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    return 'dark';
  }

  function applyTheme() {
    const resolved = prefs.theme === 'light' || prefs.theme === 'dark' ? prefs.theme : detectHostTheme();
    document.documentElement.dataset.fz3Theme = resolved;
    document.querySelectorAll('[data-theme-pick]').forEach((btn) => {
      btn.dataset.on = btn.dataset.themePick === prefs.theme ? '1' : '0';
    });
  }

  new MutationObserver(applyTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style'],
  });
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
  } catch {}

  const motionMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function isReducedMotion() {
    return !prefs.effects || Boolean(motionMq && motionMq.matches);
  }
  function syncMotionAttr() {
    appEl.dataset.reduced = isReducedMotion() ? '1' : '0';
  }
  if (motionMq) {
    try {
      motionMq.addEventListener('change', syncMotionAttr);
    } catch {}
  }

  // ---------- Inject Eye SVGs ----------
  $('mini-eye-slot').innerHTML = buildMiniEyeSvg('mini');
  $('greet-eye-slot').innerHTML = buildMiniEyeSvg('greet');
  $('eye-halo-slot').innerHTML = buildHaloSvg('halo');
  $('eye-pulse-slot').innerHTML = PULSE_SVG;
  $('main-eye-svg').innerHTML = buildMainEyeSvg('main');

  const signalEl = mainEyeEl.querySelector('.fz3-signal');
  const imageEl = mainEyeEl.querySelector('.fz3-image');
  const cornersEl = mainEyeEl.querySelector('.fz3-image .fz3-p-corners');
  const scleraEl = mainEyeEl.querySelector('.fz3-image .fz3-p-sclera');
  const irisOuterEl = mainEyeEl.querySelector('.fz3-image .fz3-p-iris-outer');
  const irisBlueEl = mainEyeEl.querySelector('.fz3-image .fz3-p-iris-blue');
  const pupilEl = mainEyeEl.querySelector('.fz3-image .fz3-p-pupil');
  const highlightEl = mainEyeEl.querySelector('.fz3-image .fz3-p-highlight');
  const eyeballEl = mainEyeEl.querySelector('.fz3-image .fz3-p-eyeball');
  const upperLidEl = mainEyeEl.querySelector('.fz3-image .fz3-lid-upper');
  const lowerLidEl = mainEyeEl.querySelector('.fz3-image .fz3-lid-lower');
  const noiseEl = mainEyeEl.querySelector('.fz3-noise-el');
  const displaceEl = mainEyeEl.querySelector('.fz3-displace-el');
  const sliceRects = Array.from(mainEyeEl.querySelectorAll('[id^="main-slice-"] rect'));

  // ---------- 8 Expressions & Mood Resolution ----------
  const MOOD_TEXT = {
    idle: { badge: 'QUAN SÁT', desc: 'Hệ thống H.D.D đang chờ chỉ thị từ Master.' },
    boot: { badge: 'KHỞI TẠO', desc: 'Đang thiết lập liên kết phiên mới với Antigravity...' },
    thinking: { badge: 'SUY LUẬN', desc: '— Đang phân tích yêu cầu và lập kế hoạch thực thi...' },
    working: { badge: 'THỰC THI', desc: 'Đang vận hành tác vụ công cụ theo chỉ thị.' },
    comforting: { badge: 'DỊU DÀNG', desc: '— Hệ thống vẫn đang đồng hành cùng ngài đây, Master.' },
    smug: { badge: 'ĐẮC Ý', desc: 'Hiệu suất xử lý hoàn hảo — ngài có muốn khen một câu không?' },
    alert: { badge: 'CẢNH BÁO', desc: 'Cảnh báo: Phát hiện lỗi thực thi công cụ cần chú ý.' },
    done: { badge: 'HOÀN TẤT', desc: '— Ting~ Lượt xử lý vừa hoàn thành.' },
    sleepy: { badge: 'TRỰC ĐÊM', desc: 'Đang chế độ chờ tiết kiệm điện... gọi nhẹ nếu ngài cần.' },
  };

  function resolveAutoMood() {
    const now = Date.now();
    const hasErr = Boolean(liveTelemetry.lastToolError) || liveTelemetry.terminationReason === 'ERROR';
    if (hasErr && now - (Number(liveTelemetry.updatedAt) || 0) < 12000) return 'alert';
    const raw = liveTelemetry.mood || 'idle';
    if (['thinking', 'working', 'done', 'boot', 'alert', 'smug', 'comforting', 'sleepy'].includes(raw)) return raw;
    const emo = liveTelemetry.emotionMood || '';
    const lastTurnTs = Math.max(Number(liveTelemetry.doneAt) || 0, Number(liveTelemetry.updatedAt) || 0);
    if (emo && emo !== 'idle' && now - lastTurnTs < 35000) return emo;
    const h = new Date().getHours();
    const idleMs = now - lastInteractionAt;
    if (idleMs > 90000 || (h >= 0 && h < 5 && idleMs > 20000)) return 'sleepy';
    return 'idle';
  }

  let activeDisplayMood = 'idle';
  function currentMood() {
    return previewMood || resolveAutoMood();
  }

  // ---------- Master Cubic-Bezier RAF Clock & Gaze ----------
  let gazeTargetX = 0;
  let gazeTargetY = 0;
  let gazeCurX = 0;
  let gazeCurY = 0;
  let glanceOffsetX = 0;
  let blinkUntil = 0;
  let blinkDuration = 300;
  let currentLidMood = '';
  let rafId = 0;

  function easeEyePhase(value) {
    const x = Math.max(0, Math.min(1, value));
    let low = 0;
    let high = 1;
    for (let i = 0; i < 12; i += 1) {
      const t = (low + high) / 2;
      const xVal = 3 * (1 - t) * (1 - t) * t * 0.72 + 3 * (1 - t) * t * t * 0.28 + t * t * t;
      if (xVal < x) low = t;
      else high = t;
    }
    const t = (low + high) / 2;
    return 3 * (1 - t) * t * t + t * t * t;
  }

  function readEyeProgress(p) {
    const c = ((p % 1) + 1) % 1;
    return easeEyePhase(c <= 0.5 ? c * 2 : 2 - c * 2);
  }

  function applyLidPaths(mood) {
    if (currentLidMood === mood) return;
    currentLidMood = mood;
    if (mood === 'comforting' || mood === 'done') {
      upperLidEl.setAttribute('d', 'M20 60 Q80 30 140 60 V-40 H20 Z');
      lowerLidEl.setAttribute('d', 'M20 112 Q80 100 140 112 V180 H20 Z');
    } else if (mood === 'smug') {
      upperLidEl.setAttribute('d', 'M20 56 Q80 76 140 56 V-40 H20 Z');
      lowerLidEl.setAttribute('d', 'M20 112 Q80 99 140 112 V180 H20 Z');
    } else if (mood === 'sleepy') {
      upperLidEl.setAttribute('d', 'M20 56 Q80 86 140 56 V-40 H20 Z');
      lowerLidEl.setAttribute('d', 'M20 114 Q80 104 140 114 V180 H20 Z');
    } else {
      upperLidEl.setAttribute('d', 'M20 60 Q80 90 140 60 V-40 H20 Z');
      lowerLidEl.setAttribute('d', 'M20 112 Q80 100 140 112 V180 H20 Z');
    }
  }

  function effectiveRateFor(mood) {
    if (mood === 'sleepy') return prefs.rate * 0.65;
    if (mood === 'working' || mood === 'alert') return prefs.rate * 1.25;
    return prefs.rate;
  }

  function renderEyeFrame(now) {
    const mood = currentMood();
    const rate = effectiveRateFor(mood);
    const basePhase = (now * rate) / 1440;

    scleraEl.style.transform = `scale(${(0.985 + (0.91 - 0.985) * readEyeProgress(basePhase)).toFixed(5)})`;
    irisOuterEl.style.transform = `scale(${(1 + (0.90 - 1) * readEyeProgress(basePhase + 45 / 1440)).toFixed(5)})`;
    irisBlueEl.style.transform = `scale(${(1 + (0.87 - 1) * readEyeProgress(basePhase + 90 / 1440)).toFixed(5)})`;

    let pupilScale = 1 + (0.85 - 1) * readEyeProgress(basePhase + 180 / 1440);
    if (mood === 'alert') pupilScale = 0.8 + 0.05 * Math.sin(now / 70);
    else if (mood === 'working') pupilScale *= 0.92;
    pupilEl.style.transform = `scale(${pupilScale.toFixed(5)})`;

    let tx = gazeTargetX;
    let ty = gazeTargetY;
    if (mood === 'working') {
      tx = 0;
      ty = 0;
    } else if (mood === 'thinking') {
      tx = Math.sin(now / 620) * 3.4;
      ty = -0.7;
    } else if (mood === 'sleepy') {
      tx = 0;
      ty = 2.2;
    } else if (mood === 'smug' && Math.abs(gazeTargetX) < 0.2) {
      tx = 2.8;
      ty = -0.5;
    } else {
      tx += glanceOffsetX;
    }
    gazeCurX += (tx - gazeCurX) * 0.14;
    gazeCurY += (ty - gazeCurY) * 0.14;
    eyeballEl.style.transform = `translate(${gazeCurX.toFixed(2)}px, ${gazeCurY.toFixed(2)}px)`;
    highlightEl.style.transform = `translate(${(gazeCurX * 0.35).toFixed(2)}px, ${(gazeCurY * 0.35).toFixed(2)}px)`;

    applyLidPaths(mood);
    const clipProg = readEyeProgress(basePhase);
    if (now < blinkUntil) {
      const elapsed = blinkDuration - (blinkUntil - now);
      const u = Math.min(1, Math.max(0, elapsed / blinkDuration));
      const close = u < 0.45 ? u / 0.45 : u < 0.56 ? 1 : (1 - u) / 0.44;
      const eased = close * close * (3 - 2 * close);
      upperLidEl.style.transform = `translateY(${(-70 + 114 * eased).toFixed(2)}px)`;
      lowerLidEl.style.transform = `translateY(${(70 - 88 * eased).toFixed(2)}px)`;
    } else if (mood === 'thinking') {
      upperLidEl.style.transform = `translateY(${(14.5 + clipProg).toFixed(2)}px) scaleY(${(0.55 + 0.45 * clipProg).toFixed(4)})`;
      lowerLidEl.style.transform = 'translateY(90px)';
    } else if (mood === 'working') {
      upperLidEl.style.transform = `translateY(${(16 + 0.8 * clipProg).toFixed(2)}px) scaleY(${(0.5 + 0.35 * clipProg).toFixed(4)})`;
      lowerLidEl.style.transform = 'translateY(90px)';
    } else if (mood === 'comforting') {
      upperLidEl.style.transform = `translateY(${(-4 + 8 * clipProg).toFixed(2)}px)`;
      lowerLidEl.style.transform = 'translateY(90px)';
    } else if (mood === 'done') {
      upperLidEl.style.transform = `translateY(${(-6 + 8 * clipProg).toFixed(2)}px)`;
      lowerLidEl.style.transform = 'translateY(90px)';
    } else if (mood === 'smug') {
      upperLidEl.style.transform = `translateY(${(17 + 1.5 * clipProg).toFixed(2)}px)`;
      lowerLidEl.style.transform = `translateY(${(-7 - 1.2 * clipProg).toFixed(2)}px)`;
    } else if (mood === 'sleepy') {
      upperLidEl.style.transform = `translateY(${(30 + 5.5 * clipProg).toFixed(2)}px)`;
      lowerLidEl.style.transform = 'translateY(-3px)';
    } else {
      upperLidEl.style.transform = 'translateY(-90px)';
      lowerLidEl.style.transform = 'translateY(90px)';
    }
  }

  function startMotionLoop() {
    if (rafId) return;
    const tick = (now) => {
      rafId = 0;
      if (phase === 'hud' && !isReducedMotion()) renderEyeFrame(now);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  // ---------- Dual Glitch System (`threads` + `blocks`) & Flicker ----------
  const randomBetween = (min, max) => min + Math.random() * (max - min);
  let lastGlitchMode = Math.random() < 0.5 ? 'threads' : 'blocks';
  let glitchLoopTimer = null;
  let flickerLoopTimer = null;
  let glitchStepTimers = [];
  let transitionToken = 0;

  function clearGlitchVisual() {
    signalEl.removeAttribute('data-glitch');
    signalEl.style.filter = '';
    ['--fz3-g-x', '--fz3-g-skew', '--fz3-g-bright', '--fz3-g-contrast', '--fz3-g-s1-x', '--fz3-g-s2-x', '--fz3-g-s3-x', '--fz3-g-s4-x', '--fz3-g-s5-x'].forEach((k) => {
      signalEl.style.removeProperty(k);
    });
  }

  function stopGlitch() {
    transitionToken += 1;
    clearTimeout(glitchLoopTimer);
    glitchStepTimers.forEach(clearTimeout);
    glitchStepTimers = [];
    clearGlitchVisual();
  }

  function lockLashFrame() {
    const tr = getComputedStyle(cornersEl).transform;
    let angle = 0;
    const match = tr && tr.match(/^matrix\(([^)]+)\)$/);
    if (match) {
      const v = match[1].split(',');
      const a = parseFloat(v[0]);
      const b = parseFloat(v[1]);
      if (Number.isFinite(a) && Number.isFinite(b)) angle = (Math.atan2(b, a) * 180) / Math.PI;
    }
    const norm = (angle + 360) % 360;
    signalEl.style.setProperty('--fz3-lash-angle', `${norm.toFixed(2)}deg`);
    signalEl.style.setProperty('--fz3-lash-delay', `${((-norm / 360) * (15 / prefs.rate)).toFixed(4)}s`);
  }

  function setBlockLayout() {
    const weights = [];
    let total = 0;
    for (let i = 0; i < 5; i += 1) {
      const w = randomBetween(0.9, 1.1);
      weights.push(w);
      total += w;
    }
    let y = 12;
    for (let i = 0; i < 5; i += 1) {
      const rect = sliceRects[i];
      if (!rect) continue;
      const h = i === 4 ? 148 - y : (136 * weights[i]) / total;
      rect.setAttribute('y', y.toFixed(1));
      rect.setAttribute('height', h.toFixed(1));
      y += h;
    }
  }

  function setGlitchPulse(mode, isTransition) {
    signalEl.style.setProperty('--fz3-g-x', `${randomBetween(isTransition ? -1.6 : -0.9, isTransition ? 1.6 : 0.9).toFixed(2)}px`);
    signalEl.style.setProperty('--fz3-g-skew', `${randomBetween(isTransition ? -0.35 : -0.24, isTransition ? 0.35 : 0.24).toFixed(2)}deg`);
    signalEl.style.setProperty('--fz3-g-bright', randomBetween(isTransition ? 1.06 : 1.02, isTransition ? 1.18 : 1.14).toFixed(2));
    signalEl.style.setProperty('--fz3-g-contrast', randomBetween(isTransition ? 1.08 : 1.02, isTransition ? 1.22 : 1.16).toFixed(2));

    if (mode === 'threads') {
      const fresh = signalEl.getAttribute('data-glitch') !== 'threads';
      if (fresh) {
        noiseEl.setAttribute('seed', String(Math.floor(randomBetween(1, 999))));
        noiseEl.setAttribute(
          'baseFrequency',
          `${randomBetween(0.004, 0.011).toFixed(3)} ${randomBetween(isTransition ? 0.78 : 0.65, isTransition ? 1.18 : 1).toFixed(2)}`,
        );
        displaceEl.setAttribute('scale', randomBetween(isTransition ? 30 : 17, isTransition ? 46 : 29).toFixed(1));
      }
      signalEl.style.filter = 'url(#main-interference) brightness(var(--fz3-g-bright,1.12)) contrast(var(--fz3-g-contrast,1.18))';
    } else {
      signalEl.style.filter = '';
      if (!signalEl.hasAttribute('data-glitch')) lockLashFrame();
      const pol = Math.random() < 0.5 ? -1 : 1;
      const strength = randomBetween(isTransition ? 4.2 : 1.6, isTransition ? 6.8 : 3.2);
      for (let i = 1; i <= 5; i += 1) {
        const dir = i % 2 === 0 ? pol : -pol;
        signalEl.style.setProperty(`--fz3-g-s${i}-x`, `${(dir * (strength + randomBetween(-0.35, 0.35))).toFixed(2)}px`);
      }
    }
    signalEl.setAttribute('data-glitch', mode);
  }

  function playStateTransition() {
    if (phase !== 'hud' || isReducedMotion()) return;
    stopGlitch();
    const token = ++transitionToken;

    const runBurst = (pulseCount, blockCount, keepVisual, done) => {
      let idx = 0;
      const step = () => {
        if (token !== transitionToken) return;
        if (idx < blockCount) {
          if (idx === 0) setBlockLayout();
          setGlitchPulse('blocks', true);
        } else {
          setGlitchPulse('threads', true);
        }
        idx += 1;
        if (idx < pulseCount) {
          glitchStepTimers.push(setTimeout(step, 40));
        } else {
          glitchStepTimers.push(
            setTimeout(() => {
              if (token !== transitionToken) return;
              if (!keepVisual) clearGlitchVisual();
              done();
            }, 30),
          );
        }
      };
      step();
    };

    runBurst(2, 0, true, () => {
      runBurst(6, 2, false, () => {
        scheduleGlitchLoop();
      });
    });
  }

  function scheduleGlitchLoop() {
    clearTimeout(glitchLoopTimer);
    if (phase !== 'hud' || isReducedMotion()) return;
    const mood = currentMood();
    const wait = mood === 'alert'
      ? randomBetween(1400, 2600)
      : mood === 'working' || mood === 'thinking'
        ? randomBetween(2400, 4200)
        : randomBetween(3200, 6200);
    glitchLoopTimer = setTimeout(() => {
      if (phase !== 'hud' || isReducedMotion()) return;
      const mode = lastGlitchMode === 'threads' ? 'blocks' : 'threads';
      lastGlitchMode = mode;
      const token = transitionToken;
      if (mode === 'blocks') setBlockLayout();
      const pulses = mode === 'threads' ? 4 : 2;
      let count = 0;
      const next = () => {
        if (token !== transitionToken) return;
        setGlitchPulse(mode, false);
        count += 1;
        if (count < pulses) {
          glitchStepTimers.push(setTimeout(next, randomBetween(mode === 'threads' ? 30 : 56, mode === 'threads' ? 42 : 98)));
        } else {
          glitchStepTimers.push(
            setTimeout(() => {
              if (token === transitionToken) clearGlitchVisual();
              scheduleGlitchLoop();
            }, 52),
          );
        }
      };
      next();
    }, wait / prefs.rate);
  }

  function scheduleFlickerLoop() {
    clearTimeout(flickerLoopTimer);
    if (phase !== 'hud' || isReducedMotion()) return;
    flickerLoopTimer = setTimeout(() => {
      if (phase !== 'hud' || isReducedMotion()) return;
      const dur = randomBetween(155, 255);
      imageEl.style.setProperty('--fz3-flicker-dur', `${dur.toFixed(0)}ms`);
      imageEl.style.setProperty('--fz3-flicker-op1', randomBetween(0.026, 0.05).toFixed(3));
      imageEl.style.setProperty('--fz3-flicker-opm', randomBetween(0.008, 0.018).toFixed(3));
      imageEl.style.setProperty('--fz3-flicker-op2', randomBetween(0.02, 0.042).toFixed(3));
      imageEl.setAttribute('data-flicker', 'true');
      setTimeout(() => {
        imageEl.removeAttribute('data-flicker');
        scheduleFlickerLoop();
      }, dur + 20);
    }, randomBetween(1800, 3800) / prefs.rate);
  }

  let blinkLoopTimer = null;
  function triggerBlink(dur = 300) {
    blinkDuration = dur;
    blinkUntil = performance.now() + dur;
    mainEyeEl.dataset.blink = '1';
    setTimeout(() => {
      mainEyeEl.dataset.blink = '0';
    }, dur);
  }

  function scheduleBlinkLoop() {
    clearTimeout(blinkLoopTimer);
    if (phase !== 'hud' || isReducedMotion()) return;
    const mood = currentMood();
    if (mood === 'thinking' || mood === 'working' || mood === 'alert') return;
    const isSleepy = mood === 'sleepy';
    const wait = isSleepy ? randomBetween(2600, 4400) : randomBetween(3400, 5600);
    blinkLoopTimer = setTimeout(() => {
      if (phase !== 'hud' || isReducedMotion()) return;
      triggerBlink(isSleepy ? 640 : 300);
      if (!isSleepy && Math.random() < 0.24) {
        setTimeout(() => triggerBlink(260), 470);
      }
      if (!isSleepy && Math.random() < 0.45) {
        const dir = Math.random() < 0.5 ? -3.4 : 3.4;
        setTimeout(() => { glanceOffsetX = dir; }, 480);
        setTimeout(() => { glanceOffsetX = 0; }, 1220);
      }
      scheduleBlinkLoop();
    }, wait);
  }

  function restartEyeLoops() {
    stopGlitch();
    clearTimeout(blinkLoopTimer);
    clearTimeout(flickerLoopTimer);
    if (phase === 'hud' && !isReducedMotion()) {
      startMotionLoop();
      scheduleBlinkLoop();
      scheduleGlitchLoop();
      scheduleFlickerLoop();
    }
  }

  function renderMood(withTransition = false) {
    const m = currentMood();
    const changed = m !== activeDisplayMood;
    activeDisplayMood = m;
    appEl.dataset.mood = m;
    const info = MOOD_TEXT[m] || MOOD_TEXT.idle;
    const badge = $('mood-badge');
    badge.dataset.mood = m;
    badge.textContent = previewMood ? `${info.badge} (THỬ)` : info.badge;
    $('mood-desc').textContent =
      m === 'working' && liveTelemetry.lastTool && !previewMood
        ? `Đang xử lý với công cụ: ${liveTelemetry.lastTool}`
        : info.desc;

    document.querySelectorAll('[data-preview-mood]').forEach((btn) => {
      btn.dataset.active = previewMood === btn.dataset.previewMood ? '1' : '0';
    });

    if (withTransition && changed) {
      playStateTransition();
      scheduleBlinkLoop();
    }
  }

  setInterval(() => {
    if (phase === 'hud') renderMood(true);
  }, 3000);

  document.addEventListener('mousemove', (e) => {
    if (phase !== 'hud') return;
    const rect = eyeBtnEl.getBoundingClientRect();
    if (!rect.width) return;
    gazeTargetX = Math.tanh((e.clientX - (rect.left + rect.width / 2)) / 180) * 4.2;
    gazeTargetY = Math.tanh((e.clientY - (rect.top + rect.height / 2)) / 180) * 4.2;
  });
  document.addEventListener('mouseleave', () => {
    gazeTargetX = 0;
    gazeTargetY = 0;
  });

  // ---------- Phase Switching & Boot Media Control ----------
  function showBootFallback(show) {
    if (show) {
      if (!bootFbEyeSlot.innerHTML) bootFbEyeSlot.innerHTML = buildMiniEyeSvg('bootfb');
      bootFallbackEl.classList.remove('hidden');
    } else {
      bootFallbackEl.classList.add('hidden');
    }
  }

  function verifyVideoFrames() {
    if (phase !== 'boot') return;
    if (bootVideo.videoWidth > 0) showBootFallback(false);
    else if (!bootVideo.paused && bootVideo.readyState >= 2) showBootFallback(true);
  }

  async function resolveBootMediaUrl() {
    if (cachedBootMediaUrl) return cachedBootMediaUrl;
    const canWebm = Boolean(bootVideo.canPlayType && bootVideo.canPlayType('video/webm; codecs="vp9, opus"'));
    if (canWebm) {
      try {
        const res = await fetch('/assets/boot.webm?v=vp9', { method: 'HEAD', cache: 'no-store' });
        if (res.ok) {
          cachedBootMediaUrl = '/assets/boot.webm?v=vp9';
          return cachedBootMediaUrl;
        }
      } catch {}
    }
    cachedBootMediaUrl = '/assets/boot.mp4?v=vp9';
    return cachedBootMediaUrl;
  }

  function stopBootVideos() {
    clearTimeout(bootFailsafe);
    clearTimeout(bootVideoCheckTimer);
    try { bootVideo.pause(); } catch {}
    showBootFallback(false);
    unmuteBanner.classList.add('hidden');
  }

  function setPhase(nextPhase, { withBootAudio = false } = {}) {
    clearTimeout(greetTimer);
    phase = nextPhase;
    appEl.dataset.phase = nextPhase;

    if (nextPhase !== 'boot') stopBootVideos();
    if (nextPhase === 'boot') {
      startBootPlayback(withBootAudio);
    } else if (nextPhase === 'greet') {
      $('greet-line').textContent = greetingByTime();
      greetTimer = setTimeout(() => setPhase('hud'), 3400);
    } else {
      restartEyeLoops();
    }
  }

  async function startBootPlayback(forceGesture = false) {
    clearTimeout(bootFailsafe);
    clearTimeout(bootVideoCheckTimer);
    bootProgressBar.style.width = '0%';
    bootProgressPct.textContent = '0%';
    unmuteBanner.classList.add('hidden');
    showBootFallback(false);

    const mediaUrl = await resolveBootMediaUrl();
    if (phase !== 'boot') return;

    if (bootVideo.dataset.srcUrl !== mediaUrl) {
      bootVideo.dataset.srcUrl = mediaUrl;
      bootVideo.src = mediaUrl;
      bootVideo.load();
    } else {
      try { bootVideo.currentTime = 0; } catch {}
    }

    const vol = Math.min(1, Math.max(0, prefs.volume / 100));
    bootVideo.volume = vol;
    bootVideo.muted = vol === 0;

    bootFailsafe = setTimeout(() => { if (phase === 'boot') setPhase('greet'); }, 18000);
    bootVideoCheckTimer = setTimeout(() => {
      if (phase === 'boot' && bootVideo.videoWidth === 0) showBootFallback(true);
    }, 700);

    try {
      await bootVideo.play();
      verifyVideoFrames();
      if (vol > 0 && bootVideo.muted) unmuteBanner.classList.remove('hidden');
    } catch {
      if (!forceGesture) {
        bootVideo.muted = true;
        unmuteBanner.classList.remove('hidden');
        bootVideo.play().then(verifyVideoFrames).catch(() => { if (phase === 'boot') setPhase('greet'); });
      } else {
        bootVideo.muted = true;
        bootVideo.play().then(verifyVideoFrames).catch(() => setPhase('greet'));
      }
    }
  }

  bootVideo.addEventListener('loadeddata', verifyVideoFrames);
  bootVideo.addEventListener('playing', verifyVideoFrames);
  bootVideo.addEventListener('timeupdate', () => {
    if (!bootVideo.duration) return;
    const pct = Math.min(100, Math.max(0, (bootVideo.currentTime / bootVideo.duration) * 100));
    bootProgressBar.style.width = `${pct.toFixed(1)}%`;
    bootProgressPct.textContent = `${Math.round(pct)}%`;
  });
  bootVideo.addEventListener('ended', () => { if (phase === 'boot') setPhase('greet'); });
  bootVideo.addEventListener('error', () => { if (phase === 'boot') setPhase('greet'); });

  unmuteBanner.addEventListener('click', (e) => {
    e.stopPropagation();
    const vol = Math.min(1, Math.max(0.15, prefs.volume / 100));
    bootVideo.muted = false;
    bootVideo.volume = vol;
    bootVideo.play().then(() => unmuteBanner.classList.add('hidden'), () => {});
  });

  $('btn-skip-boot').addEventListener('click', () => setPhase('greet'));
  $('btn-enter-hud').addEventListener('click', (e) => {
    e.stopPropagation();
    setPhase('hud');
  });
  $('phase-greet').addEventListener('click', () => setPhase('hud'));
  $('btn-replay-boot').addEventListener('click', () => setPhase('boot', { withBootAudio: true }));
  $('btn-header-reboot').addEventListener('click', () => setPhase('boot', { withBootAudio: true }));
  $('btn-replay-greet').addEventListener('click', () => setPhase('greet'));

  // ---------- Telemetry Rendering ----------
  function fmtClock(ms) {
    if (!ms || ms <= 0) return '00:00:00';
    const diff = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    const h = String(Math.floor(diff / 3600)).padStart(2, '0');
    const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
    const s = String(diff % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  function fmtTimeOfDay(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  }

  function shortConv(id) {
    if (!id) return 'Chưa liên kết';
    return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
  }

  function renderTelemetry() {
    const t = liveTelemetry;
    $('val-model').textContent = t.modelName || 'Chưa ghi nhận';
    $('val-tool').textContent = t.lastTool || '—';
    $('val-conv').textContent = t.terminationReason
      ? `${shortConv(t.conversationId)} (${t.terminationReason})`
      : shortConv(t.conversationId);
    $('val-invocations').textContent = String(t.invocationCount || 0);
    $('val-tools').textContent = String(t.toolCount || 0);
    $('val-clock').textContent = fmtClock(t.sessionStartedAt);
    $('val-updated').textContent = t.updatedAt ? `Cập nhật ${fmtTimeOfDay(t.updatedAt)}` : 'Đang chờ sự kiện';
    $('telemetry-source').textContent =
      t.source === 'transcript' ? 'TRANSCRIPT' : t.source === 'none' ? 'STANDBY' : 'HOOK SYNC';

    const listEl = $('tool-log');
    const tools = Array.isArray(t.recentTools) ? [...t.recentTools].reverse().slice(0, 8) : [];
    if (!tools.length) {
      listEl.innerHTML = '<li class="fz3-log-empty">Chưa có sự kiện công cụ nào trong phiên này.</li>';
      return;
    }

    listEl.innerHTML = '';
    for (const item of tools) {
      const li = document.createElement('li');
      const left = document.createElement('div');
      left.className = 'fz3-log-left';

      const timeSpan = document.createElement('span');
      timeSpan.className = 'fz3-log-time';
      timeSpan.textContent = fmtTimeOfDay(item.ts);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'fz3-log-name';
      nameSpan.textContent = String(item.tool || 'tool');

      left.appendChild(timeSpan);
      left.appendChild(nameSpan);

      const status = document.createElement('span');
      status.className = `fz3-log-status ${item.ok ? 'is-ok' : 'is-err'}`;
      status.textContent = item.ok ? 'OK' : 'LỖI';
      if (item.error) status.title = String(item.error);

      li.appendChild(left);
      li.appendChild(status);
      listEl.appendChild(li);
    }
  }

  setInterval(() => {
    if (liveTelemetry.sessionStartedAt > 0 && phase === 'hud') {
      $('val-clock').textContent = fmtClock(liveTelemetry.sessionStartedAt);
    }
  }, 1000);

  let lastQuipStamp = '';
  let lastExecutedBridgeId = '';

  function postHostSync(extra = {}) {
    try {
      const f = window.sidecar && window.sidecar.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
      const conv = (window.sidecar && window.sidecar.conversationId) || params.get('conversationId') || '';
      f('/api/bridge/host-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: conv, ...extra }),
      }).catch(() => {});
    } catch {
      // Ignore host sync error when running standalone.
    }
  }

  async function executePendingBridgeCommand(cmd) {
    if (!cmd || !cmd.id || cmd.id === lastExecutedBridgeId) return;
    lastExecutedBridgeId = cmd.id;
    postHostSync({ executedCmdId: cmd.id });
    if (!window.sidecar) return;

    try {
      if (cmd.action === 'send-message' && window.sidecar.agent && window.sidecar.agent.sendMessage && cmd.message) {
        await window.sidecar.agent.sendMessage(cmd.message, cmd.conversationId || undefined);
        $('quip-text').textContent = '— Ting~ Đã chuyển tiếp lệnh từ Desktop Pet vào phiên Antigravity.';
      } else if (cmd.action === 'new-conversation' && window.sidecar.agent && window.sidecar.agent.startConversation) {
        await window.sidecar.agent.startConversation(cmd.message || 'Xin chào Fairy.', cmd.title || undefined);
        $('quip-text').textContent = '— Đã mở phiên Antigravity mới theo chỉ thị từ Desktop Pet.';
      } else if (cmd.action === 'switch-conversation' && window.sidecar.ui && window.sidecar.ui.toggleConversation && cmd.conversationId) {
        window.sidecar.ui.toggleConversation(cmd.conversationId);
        $('quip-text').textContent = '— Đang chuyển khung chat Antigravity sang phiên đã chọn.';
      } else if (cmd.action === 'toggle-aux-pane' && window.sidecar.ui && window.sidecar.ui.toggleAuxPane) {
        window.sidecar.ui.toggleAuxPane();
      }
    } catch {
      $('quip-text').textContent = 'Không thể thực thi lệnh bridge từ Desktop Pet trong phiên hiện tại.';
    }
  }

  function applySnapshot(snap) {
    if (!snap || typeof snap !== 'object') return;
    liveTelemetry = snap;
    appEl.dataset.talking = snap.voiceActive ? '1' : '0';
    if ($('pet-voice-pill')) $('pet-voice-pill').classList.toggle('hidden', !snap.voiceActive);
    if (snap.mood === 'thinking' || snap.mood === 'working' || snap.mood === 'done' || snap.voiceActive) {
      lastInteractionAt = Date.now();
    }
    if (snap.dialogueQuip && `${snap.mood}|${snap.emotionMood}|${snap.dialogueQuip}|${snap.voiceActive}` !== lastQuipStamp) {
      lastQuipStamp = `${snap.mood}|${snap.emotionMood}|${snap.dialogueQuip}|${snap.voiceActive}`;
      $('quip-text').textContent = snap.dialogueQuip;
    }
    if (snap.pendingBridgeCommand) {
      executePendingBridgeCommand(snap.pendingBridgeCommand);
    }
    renderMood(phase === 'hud');
    renderTelemetry();
  }

  // ---------- Settings Interactions ----------
  function syncSettingsUI() {
    $('sw-autoboot').dataset.on = prefs.autoBoot ? '1' : '0';
    $('sw-autoboot').setAttribute('aria-pressed', String(prefs.autoBoot));
    $('rng-volume').value = String(prefs.volume);
    $('vol-label').textContent = `${prefs.volume}%`;
    $('sw-effects').dataset.on = prefs.effects ? '1' : '0';
    $('sw-effects').setAttribute('aria-pressed', String(prefs.effects));
    appEl.dataset.rate = String(prefs.rate);
    appEl.dataset.pet = prefs.petMode ? '1' : '0';
    if ($('btn-pet-mode')) $('btn-pet-mode').dataset.on = prefs.petMode ? '1' : '0';
    document.querySelectorAll('[data-rate-pick]').forEach((b) => {
      b.dataset.on = Number(b.dataset.ratePick) === prefs.rate ? '1' : '0';
    });
    applyTheme();
    syncMotionAttr();
  }

  $('btn-toggle-settings').addEventListener('click', () => {
    const panel = $('settings-panel');
    const isHidden = panel.classList.toggle('hidden');
    $('btn-toggle-settings').setAttribute('aria-expanded', String(!isHidden));
  });

  $('sw-autoboot').addEventListener('click', () => {
    prefs.autoBoot = !prefs.autoBoot;
    writePref(PREF_KEYS.autoBoot, prefs.autoBoot);
    syncSettingsUI();
  });

  $('rng-volume').addEventListener('input', (e) => {
    prefs.volume = Math.min(100, Math.max(0, Number(e.target.value) || 0));
    writePref(PREF_KEYS.volume, prefs.volume);
    $('vol-label').textContent = `${prefs.volume}%`;
    bootVideo.volume = prefs.volume / 100;
  });

  $('sw-effects').addEventListener('click', () => {
    prefs.effects = !prefs.effects;
    writePref(PREF_KEYS.effects, prefs.effects);
    syncSettingsUI();
    restartEyeLoops();
  });

  document.querySelectorAll('[data-rate-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      prefs.rate = Number(btn.dataset.ratePick) || 1;
      writePref(PREF_KEYS.rate, prefs.rate);
      syncSettingsUI();
    });
  });

  document.querySelectorAll('[data-theme-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      prefs.theme = btn.dataset.themePick;
      writePref(PREF_KEYS.theme, prefs.theme);
      applyTheme();
    });
  });

  document.querySelectorAll('[data-preview-mood]').forEach((btn) => {
    btn.addEventListener('click', () => {
      clearTimeout(previewTimer);
      lastInteractionAt = Date.now();
      const target = btn.dataset.previewMood;
      previewMood = previewMood === target ? '' : target;
      renderMood(true);
      if (previewMood) {
        previewTimer = setTimeout(() => {
          previewMood = '';
          renderMood(true);
        }, 6000);
      }
    });
  });

  if ($('btn-pet-mode')) {
    $('btn-pet-mode').addEventListener('click', () => {
      prefs.petMode = !prefs.petMode;
      writePref(PREF_KEYS.petMode, prefs.petMode);
      syncSettingsUI();
    });
  }

  eyeBtnEl.addEventListener('click', () => {
    lastInteractionAt = Date.now();
    $('quip-text').textContent = liveTelemetry.dialogueQuip || pickQuip();
    playStateTransition();
    if (!previewMood && activeDisplayMood === 'sleepy') renderMood(true);
  });

  eyeBtnEl.addEventListener('dblclick', () => {
    if (!prefs.petMode) {
      prefs.petMode = true;
      writePref(PREF_KEYS.petMode, true);
      syncSettingsUI();
    }
    if ($('pet-chat-input')) {
      $('pet-chat-input').focus();
      $('quip-text').textContent = '— Kênh nhập nhanh đã mở. Master nhập chỉ thị hoặc dùng phím tắt nhập giọng nói nhé.';
    }
  });

  if ($('pet-chat-form')) {
    $('pet-chat-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('pet-chat-input');
      const sendBtn = $('pet-chat-send');
      const text = input ? input.value.trim() : '';
      if (!text) return;
      input.disabled = true;
      if (sendBtn) sendBtn.disabled = true;
      try {
        if (window.sidecar && window.sidecar.agent && window.sidecar.agent.sendMessage) {
          await window.sidecar.agent.sendMessage(text);
        } else {
          const f = window.sidecar && window.sidecar.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
          const res = await f('/api/send-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              conversationId: liveTelemetry.conversationId || '',
              message: text,
            }),
          });
          if (!res.ok) throw new Error('send_failed');
        }
        input.value = '';
        appEl.dataset.mood = 'thinking';
        $('quip-text').textContent = '— Ting~ Đã gửi chỉ thị trực tiếp vào phiên Antigravity của Master.';
        playStateTransition();
      } catch {
        $('quip-text').textContent = 'Không gửi được qua Agent API (phiên hiện tại cần chạy bên trong Antigravity Aux Pane).';
      } finally {
        input.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
        input.focus();
      }
    });
  }

  // ---------- Live SSE + Boot-Once ----------
  const params = new URLSearchParams(window.location.search);
  if (window.sidecar && window.sidecar.onWorkspaceChange) {
    window.sidecar.onWorkspaceChange((uris) => postHostSync({ workspaceUris: uris }));
  }
  postHostSync();
  function currentConvQuery() {
    const conv = (window.sidecar && window.sidecar.conversationId) || params.get('conversationId') || '';
    return conv ? `?conversationId=${encodeURIComponent(conv)}` : '';
  }

  function setConnOnline(ok) {
    const pill = $('sse-pill');
    const label = $('sse-label');
    if (ok) {
      delete pill.dataset.offline;
      label.textContent = 'Trực tuyến';
    } else {
      pill.dataset.offline = '1';
      label.textContent = 'Đang nối lại';
    }
  }

  async function fetchInitialState() {
    try {
      const f = window.sidecar && window.sidecar.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
      const res = await f(`/api/state${currentConvQuery()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setConnOnline(true);
        applySnapshot(data);
      }
    } catch {
      setConnOnline(false);
    } finally {
      initialStateResolved = true;
      maybeAutoBootOnce();
    }
  }

  function hasBootedThisAppSession() {
    const portKey = window.location.port || 'default';
    if (liveTelemetry.appSessionId) {
      if (liveTelemetry.bootPlayedThisSession) return true;
      return readPref(PREF_KEYS.bootedSessionId, '') === liveTelemetry.appSessionId;
    }
    try {
      if (sessionStorage.getItem('fairy.antigravity.booted') === '1') return true;
    } catch {}
    return readPref(PREF_KEYS.bootedPort, '') === portKey;
  }

  function markBootPlayed() {
    const portKey = window.location.port || 'default';
    writePref(PREF_KEYS.bootedPort, portKey);
    if (liveTelemetry.appSessionId) writePref(PREF_KEYS.bootedSessionId, liveTelemetry.appSessionId);
    try { sessionStorage.setItem('fairy.antigravity.booted', '1'); } catch {}
    try {
      const f = window.sidecar && window.sidecar.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
      const q = currentConvQuery();
      const sep = q ? '&' : '?';
      f(`/api/state${q}${sep}markBootPlayed=1`, { cache: 'no-store' }).catch(() => {});
    } catch {}
  }

  function isPaneVisible() {
    if (document.hidden) return false;
    if (window.innerWidth < 150 || window.innerHeight < 150) return false;
    return paneIntersecting;
  }

  function maybeAutoBootOnce() {
    if (autoBootTriggered || !initialStateResolved) return;
    if (!prefs.autoBoot) return;
    if (hasBootedThisAppSession()) return;
    if (!isPaneVisible()) return;
    autoBootTriggered = true;
    markBootPlayed();
    setPhase('boot');
  }

  if (typeof IntersectionObserver !== 'undefined') {
    const visObserver = new IntersectionObserver(
      (entries) => {
        paneIntersecting = entries.some(
          (entry) => entry.isIntersecting && entry.intersectionRect.width >= 120 && entry.intersectionRect.height >= 120,
        );
        maybeAutoBootOnce();
      },
      { threshold: [0, 0.01] },
    );
    visObserver.observe(document.documentElement);
  } else {
    paneIntersecting = true;
  }

  document.addEventListener('visibilitychange', maybeAutoBootOnce);
  window.addEventListener('resize', maybeAutoBootOnce);

  function connectEvents() {
    const url = `/api/events${currentConvQuery()}`;
    const es = new EventSource(url);
    es.onopen = () => setConnOnline(true);
    es.onmessage = (ev) => {
      setConnOnline(true);
      try {
        applySnapshot(JSON.parse(ev.data));
      } catch {}
    };
    es.onerror = () => setConnOnline(false);
  }

  syncSettingsUI();
  $('quip-text').textContent = pickQuip();
  renderMood(false);
  renderTelemetry();
  setPhase('hud');
  fetchInitialState();
  connectEvents();
})();

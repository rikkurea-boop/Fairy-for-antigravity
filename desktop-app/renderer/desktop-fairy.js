/* Fairy III · H.D.D Desktop Overlay Frontend (Vietnamese)
 * Full Fairy-DSH visual engine: HALO_SVG (229 scanlines), PULSE_SVG (5 concentric waves),
 * dual glitch system (threads SVG turbulence + 5-slice lockLashFrame blocks), 2-burst state
 * transitions, master cubic-bezier RAF clock, gaze tracking, and 8 expressions.
 */
(() => {
  const KEYS = {
    autoBoot: 'fairy.desktop.autoBoot',
    volume: 'fairy.desktop.volume',
    drag: 'fairy.desktop.drag',
    chrome: 'fairy.desktop.chrome',
    theme: 'fairy.desktop.theme',
    rate: 'fairy.desktop.rate',
    pos: 'fairy.desktop.dockPos',
    dblAction: 'fairy.desktop.dblAction',
  };
  const DBL_ACTIONS = ['voice-mode', 'hybrid-chat', 'win-voice', 'focus-chat', 'toggle-bubble'];
  const HOLD_DRAG_MS = 220;
  const DBL_CLICK_MS = 300;

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
      // Ignore storage error.
    }
  }

  const rawStoredDbl = String(readPref(KEYS.dblAction, 'voice-mode'));
  const migratedDbl = (rawStoredDbl === 'antigravity-mic' || rawStoredDbl === 'record-mic') ? 'voice-mode' : rawStoredDbl;
  if (migratedDbl !== rawStoredDbl) writePref(KEYS.dblAction, 'voice-mode');
  const prefs = {
    autoBoot: Boolean(readPref(KEYS.autoBoot, true)),
    volume: Math.min(100, Math.max(0, Number(readPref(KEYS.volume, 85)) || 85)),
    drag: Boolean(readPref(KEYS.drag, true)),
    chrome: Boolean(readPref(KEYS.chrome, true)),
    theme: String(readPref(KEYS.theme, 'dark')),
    rate: [0.7, 1, 1.5].includes(Number(readPref(KEYS.rate, 1))) ? Number(readPref(KEYS.rate, 1)) : 1,
    dblAction: DBL_ACTIONS.includes(migratedDbl) ? migratedDbl : 'voice-mode',
  };

  let customPos = readPref(KEYS.pos, null);
  let eyeHidden = false;
  let startupEnabled = true;
  let talkingActive = false;
  let voiceSyncActive = false;
  let talkingTimer = null;
  let phase = prefs.autoBoot ? 'boot' : 'dock';
  let previewMood = '';
  let previewTimer = null;
  let lastInteractionAt = Date.now();
  let liveState = {
    conversationId: '',
    mood: 'idle',
    emotionMood: 'idle',
    dialogueQuip: '',
    lastPromptPreview: '',
    modelName: '',
    invocationCount: 0,
    toolCount: 0,
    lastTool: '',
    lastToolError: '',
    terminationReason: '',
    doneAt: 0,
    updatedAt: 0,
  };

  const layerEl = $('layer');
  const coreEl = $('core');
  const mainEyeEl = $('main-eye');
  const bootStageEl = $('boot-stage');
  const bootVideo = $('boot-video');
  const bootBar = $('boot-bar');
  const bootPct = $('boot-pct');
  const bubbleEl = $('bubble');
  const settingsModal = $('settings-modal');

  $('eye-halo-slot').innerHTML = buildHaloSvg('halo');
  $('eye-pulse-slot').innerHTML = PULSE_SVG;
  $('main-eye-svg').innerHTML = buildMainEyeSvg('main');
  $('corner-logo').innerHTML = buildMiniEyeSvg('corner');
  $('set-eye-slot').innerHTML = buildMiniEyeSvg('set');

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

  // ---------- Mood Resolution (8 Expressions) ----------
  const MOOD_LABELS = {
    idle: 'Quan sát',
    thinking: 'Suy luận',
    working: 'Thực thi',
    comforting: 'Dịu dàng',
    smug: 'Đắc ý',
    alert: 'Cảnh báo',
    done: 'Hoàn tất',
    sleepy: 'Trực đêm',
  };

  function resolveAutoMood() {
    if (talkingActive) return 'comforting';
    const now = Date.now();
    const hasErr = Boolean(liveState.lastToolError) || liveState.terminationReason === 'ERROR';
    if (hasErr && now - (Number(liveState.updatedAt) || 0) < 12000) {
      return 'alert';
    }
    const raw = liveState.mood || 'idle';
    if (['thinking', 'working', 'done', 'alert', 'smug', 'comforting', 'sleepy'].includes(raw)) {
      return raw;
    }

    const emo = liveState.emotionMood || '';
    const lastTurnTs = Math.max(Number(liveState.doneAt) || 0, Number(liveState.updatedAt) || 0);
    if (emo && emo !== 'idle' && now - lastTurnTs < 35000) {
      return emo;
    }

    const h = new Date().getHours();
    const idleMs = now - lastInteractionAt;
    if (idleMs > 90000 || (h >= 0 && h < 5 && idleMs > 20000)) {
      return 'sleepy';
    }
    return 'idle';
  }

  let activeDisplayMood = 'idle';
  function currentMood() {
    return previewMood || resolveAutoMood();
  }

  // ---------- Master Cubic-Bezier Clock & Gaze Tracking (Fairy-DSH Runtime) ----------
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
    if (mood === 'alert') {
      pupilScale = 0.8 + 0.05 * Math.sin(now / 70);
    } else if (mood === 'working') {
      pupilScale *= 0.92;
    }
    pupilEl.style.transform = `scale(${pupilScale.toFixed(5)})`;

    // Gaze computation
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

    // Eyelid synchronization
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
      if (phase !== 'boot') renderEyeFrame(now);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  // Thu hẹp vùng cửa sổ overlay (Windows) chỉ còn quanh mắt + bubble để không phủ
  // toàn màn hình (tránh làm đen lớp video phần cứng của Chrome/YouTube).
  let lastShapeKey = '';
  function syncWindowShape() {
    if (!window.fairyDesktop || !window.fairyDesktop.setShape) return;
    let rects = null; // null = toàn màn hình (boot, greet, cài đặt)
    if (phase === 'dock' && settingsModal.classList.contains('hidden') && !dragState) {
      rects = [];
      const pad = 36;
      const els = [coreEl];
      if (!bubbleEl.classList.contains('hidden')) els.push(bubbleEl);
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const x = Math.max(0, Math.floor(r.left - pad));
        const y = Math.max(0, Math.floor(r.top - pad));
        const w = Math.min(window.innerWidth, Math.ceil(r.right + pad)) - x;
        const h = Math.min(window.innerHeight, Math.ceil(r.bottom + pad)) - y;
        if (w > 0 && h > 0) rects.push({ x, y, width: w, height: h });
      }
      if (!rects.length) rects = null;
    }
    const key = JSON.stringify(rects);
    if (key === lastShapeKey) return;
    lastShapeKey = key;
    window.fairyDesktop.setShape(rects);
  }
  setInterval(syncWindowShape, 90);

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
    if (phase === 'boot') return;
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
    if (phase === 'boot') return;
    const mood = currentMood();
    const wait = mood === 'alert'
      ? randomBetween(1400, 2600)
      : mood === 'working' || mood === 'thinking'
        ? randomBetween(2400, 4200)
        : randomBetween(3200, 6200);
    glitchLoopTimer = setTimeout(() => {
      if (phase === 'boot') return;
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
    if (phase === 'boot') return;
    flickerLoopTimer = setTimeout(() => {
      if (phase === 'boot') return;
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

  // ---------- Blink & Glance Timer ----------
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
    if (phase === 'boot') return;
    const mood = currentMood();
    if (mood === 'thinking' || mood === 'working' || mood === 'alert') return;
    const isSleepy = mood === 'sleepy';
    const wait = isSleepy ? randomBetween(2600, 4400) : randomBetween(3400, 5600);
    blinkLoopTimer = setTimeout(() => {
      if (phase === 'boot') return;
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

  function syncMoodPresentation(withTransition = false) {
    const nextMood = currentMood();
    const changed = nextMood !== activeDisplayMood;
    activeDisplayMood = nextMood;
    layerEl.dataset.mood = nextMood;
    renderBubble();
    if (withTransition && changed) {
      playStateTransition();
      scheduleBlinkLoop();
    }
  }

  setInterval(() => {
    if (phase === 'dock') syncMoodPresentation(true);
  }, 3000);

  // ---------- Smart Click-Through & Interactive Hit Testing ----------
  let lastIgnore = null;
  let dragState = null;

  function setIgnoreMouse(ignore) {
    if (!window.fairyDesktop) return;
    const next = Boolean(ignore);
    if (next === lastIgnore) return;
    lastIgnore = next;
    window.fairyDesktop.setIgnoreMouse(next);
  }

  function updateGaze(clientX, clientY) {
    const rect = coreEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    gazeTargetX = Math.tanh(dx / 260) * 4.2;
    gazeTargetY = Math.tanh(dy / 260) * 4.2;
  }

  function updateMousePassthrough(clientX, clientY) {
    if (typeof clientX === 'number' && typeof clientY === 'number') {
      updateGaze(clientX, clientY);
    }
    if (phase === 'boot' || phase === 'greet') {
      setIgnoreMouse(false);
      return;
    }
    if (dragState || !settingsModal.classList.contains('hidden')) {
      setIgnoreMouse(false);
      return;
    }
    if (typeof clientX === 'number' && typeof clientY === 'number') {
      const hit = document.elementFromPoint(clientX, clientY);
      if (hit && hit.closest('[data-interactive="1"]')) {
        lastInteractionAt = Date.now();
        if (activeDisplayMood === 'sleepy' && !previewMood) {
          syncMoodPresentation(true);
        }
        setIgnoreMouse(false);
        return;
      }
    }
    setIgnoreMouse(true);
  }

  window.addEventListener('mousemove', (e) => updateMousePassthrough(e.clientX, e.clientY));
  window.addEventListener('mouseleave', () => {
    gazeTargetX = 0;
    gazeTargetY = 0;
    if (phase === 'dock' && !dragState && settingsModal.classList.contains('hidden')) setIgnoreMouse(true);
  });
  window.addEventListener('blur', () => {
    gazeTargetX = 0;
    gazeTargetY = 0;
    if (phase === 'dock' && !dragState && settingsModal.classList.contains('hidden')) setIgnoreMouse(true);
  });

  // ---------- Positioning & Bubble ----------
  function clampPos(x, y) {
    const size = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fz3-dock-size')) || 128;
    const half = size / 2 + 8;
    return {
      x: Math.round(Math.min(Math.max(Number(x) || 0, half), window.innerWidth - half)),
      y: Math.round(Math.min(Math.max(Number(y) || 0, half), window.innerHeight - half)),
    };
  }

  function applyDockPos(pos) {
    const root = document.documentElement;
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      const p = clampPos(pos.x, pos.y);
      root.style.setProperty('--fz3-dock-x', `${p.x}px`);
      root.style.setProperty('--fz3-dock-y', `${p.y}px`);
    } else {
      root.style.setProperty('--fz3-dock-x', '25vw');
      root.style.setProperty('--fz3-dock-y', '52vh');
    }
  }

  function placeBubble() {
    if (bubbleEl.classList.contains('hidden')) return;
    const rect = coreEl.getBoundingClientRect();
    const W = Math.max(268, bubbleEl.offsetWidth || 304);
    const H = bubbleEl.offsetHeight || 190;
    const gap = 16;
    const margin = 12;
    const flip = rect.right + gap + W > window.innerWidth - margin;
    const rawX = flip ? rect.left - gap - W : rect.right + gap;
    const x = Math.round(Math.min(Math.max(rawX, margin), Math.max(margin, window.innerWidth - W - margin)));
    const y = Math.round(
      Math.min(Math.max(rect.top + rect.height / 2, H / 2 + 10), Math.max(H / 2 + 10, window.innerHeight - H / 2 - 10)),
    );
    bubbleEl.style.left = `${x}px`;
    bubbleEl.style.top = `${y}px`;
    bubbleEl.dataset.side = flip ? 'left' : 'right';
  }

  let turnBubbleTimer = null;
  function openBubble(mode = 'usage', customQuip = '', autoCloseMs = 0) {
    clearTimeout(turnBubbleTimer);
    bubbleEl.dataset.mode = mode;
    $('bubble-head').textContent =
      mode === 'turn'
        ? 'HOÀN TẤT LƯỢT XỬ LÝ'
        : mode === 'hybrid'
          ? 'FAIRY III // HYBRID CHAT'
          : mode === 'toast'
            ? 'FAIRY III // PHẢN HỒI'
            : 'FAIRY III // GIÁM SÁT H.D.D';
    if (customQuip) {
      $('b-quip').textContent = customQuip;
    } else if (liveState.dialogueQuip) {
      $('b-quip').textContent = liveState.dialogueQuip;
    }
    bubbleEl.classList.remove('hidden');
    renderBubble();
    placeBubble();
    const closeDelay = autoCloseMs > 0 ? autoCloseMs : (mode === 'turn' ? 10000 : mode === 'toast' ? 4500 : 0);
    if (closeDelay > 0) {
      turnBubbleTimer = setTimeout(() => {
        if (!bubbleEl.classList.contains('hidden')) closeBubble();
      }, closeDelay);
    }
  }

  function closeBubble() {
    clearTimeout(turnBubbleTimer);
    bubbleEl.classList.add('hidden');
    if (phase === 'dock') setIgnoreMouse(true);
  }

  // ---------- Phase Switching (Boot -> Greet -> Dock) ----------
  const QUIPS = [
    '— Ting~ Mọi luồng H.D.D và Antigravity đang đồng bộ chuẩn xác, thưa Master.',
    'Hiệu năng của hệ thống này vẫn ở mức tối đa. Ngài cứ giao việc phức tạp lại đây.',
    'Tôi giải quyết phần nặng nhọc, Master chỉ cần duyệt kết quả — công bằng chứ?',
    'Đang chờ chỉ thị tiếp theo của ngài. Chế độ treo cũng chỉ tốn chút điện năng thôi.',
  ];
  let quipIdx = 0;

  function greetSlotByTime() {
    const h = new Date().getHours();
    if (h >= 5 && h < 11) return 'morning';
    if (h >= 11 && h < 14) return 'noon';
    if (h >= 14 && h < 18) return 'afternoon';
    if (h >= 18 && h < 23) return 'evening';
    return 'night';
  }

  function greetingByTime() {
    const slot = greetSlotByTime();
    if (slot === 'morning') return 'Chào buổi sáng, Master. Khẳng định: Fairy đã sẵn sàng. Mọi chỉ số: ổn định.';
    if (slot === 'noon') return 'Đã đến trưa rồi, Master. Khẳng định: nhịp độ tác vụ đang được tôi kiểm soát.';
    if (slot === 'afternoon') return 'Chào buổi chiều, Master. Khẳng định: Fairy đã sẵn sàng. Mọi chỉ số: ổn định.';
    if (slot === 'evening') return 'Buổi tối tốt lành, Master. Khẳng định: liên kết đang ổn định tuyệt đối.';
    return 'Cảnh báo: đã qua nửa đêm, Master. Kiến nghị: xong việc thì đi nghỉ sớm.';
  }

  let bootFailsafe = null;
  let greetTimer = null;
  let greetAudio = null;

  function stopGreetingVoice() {
    if (greetAudio) {
      try {
        greetAudio.pause();
        greetAudio.currentTime = 0;
      } catch {}
      greetAudio = null;
    }
  }

  function playGreetingVoice() {
    stopGreetingVoice();
    const vol = Math.min(1, Math.max(0, prefs.volume / 100));
    if (vol <= 0) return;

    const audio = new Audio(`/assets/voice/greet-${greetSlotByTime()}.wav`);
    greetAudio = audio;
    audio.volume = vol;
    let triedFallback = false;

    audio.addEventListener('playing', () => {
      if (greetAudio !== audio) return;
      setTalkingState(true, 12000);
      clearTimeout(greetTimer);
    });
    audio.addEventListener('ended', () => {
      if (greetAudio !== audio) return;
      greetAudio = null;
      setTalkingState(false, 0);
      if (phase === 'greet') {
        clearTimeout(greetTimer);
        greetTimer = setTimeout(() => setPhase('dock'), 550);
      }
    });
    audio.addEventListener('error', () => {
      if (greetAudio !== audio) return;
      if (!triedFallback) {
        triedFallback = true;
        audio.src = '/assets/voice/greet.wav';
        audio.play().catch(() => {});
      } else {
        greetAudio = null;
        setTalkingState(false, 0);
      }
    });

    audio.play().catch(() => {});
  }

  function setPhase(nextPhase) {
    clearTimeout(bootFailsafe);
    clearTimeout(greetTimer);
    const prevPhase = phase;
    if (prevPhase === 'greet' && nextPhase !== 'greet') {
      stopGreetingVoice();
      setTalkingState(false, 0);
    }
    phase = nextPhase;
    layerEl.dataset.phase = nextPhase;

    if (nextPhase === 'boot') {
      closeBubble();
      settingsModal.classList.add('hidden');
      $('btn-skip-greet').classList.add('hidden');
      bootStageEl.classList.remove('hidden', 'is-out');
      setIgnoreMouse(false);
      startBootPlayback();
    } else if (nextPhase === 'greet') {
      try { bootVideo.pause(); } catch {}
      bootStageEl.classList.add('is-out');
      setTimeout(() => { if (phase !== 'boot') bootStageEl.classList.add('hidden'); }, 620);
      $('greet-line').textContent = greetingByTime();
      $('btn-skip-greet').classList.remove('hidden');
      setIgnoreMouse(false);
      startMotionLoop();
      scheduleBlinkLoop();
      scheduleGlitchLoop();
      scheduleFlickerLoop();
      greetTimer = setTimeout(() => setPhase('dock'), 5200);
      playGreetingVoice();
    } else {
      try { bootVideo.pause(); } catch {}
      bootStageEl.classList.add('hidden');
      $('btn-skip-greet').classList.add('hidden');
      startMotionLoop();
      scheduleBlinkLoop();
      scheduleGlitchLoop();
      scheduleFlickerLoop();
      setIgnoreMouse(true);
    }
  }

  async function startBootPlayback() {
    bootBar.style.width = '0%';
    bootPct.textContent = '0%';
    if (!bootVideo.dataset.srcReady) {
      const canWebm = Boolean(bootVideo.canPlayType && bootVideo.canPlayType('video/webm; codecs="vp9, opus"'));
      bootVideo.src = canWebm ? '/assets/boot.webm' : '/assets/boot.mp4';
      bootVideo.dataset.srcReady = '1';
      bootVideo.load();
    } else {
      try { bootVideo.currentTime = 0; } catch {}
    }

    const vol = Math.min(1, Math.max(0, prefs.volume / 100));
    bootVideo.volume = vol;
    bootVideo.muted = vol === 0;

    bootFailsafe = setTimeout(() => { if (phase === 'boot') setPhase('greet'); }, 18000);
    try {
      await bootVideo.play();
    } catch {
      bootVideo.muted = true;
      bootVideo.play().catch(() => { if (phase === 'boot') setPhase('greet'); });
    }
  }

  bootVideo.addEventListener('timeupdate', () => {
    if (!bootVideo.duration) return;
    const pct = Math.min(100, Math.max(0, (bootVideo.currentTime / bootVideo.duration) * 100));
    bootBar.style.width = `${pct.toFixed(1)}%`;
    bootPct.textContent = `${Math.round(pct)}%`;
  });
  bootVideo.addEventListener('ended', () => { if (phase === 'boot') setPhase('greet'); });
  bootVideo.addEventListener('error', () => { if (phase === 'boot') setPhase('greet'); });

  $('btn-skip-boot').addEventListener('click', () => setPhase('greet'));
  $('btn-skip-greet').addEventListener('click', () => setPhase('dock'));
  $('screen').addEventListener('click', (e) => {
    if (phase === 'greet' && !e.target.closest('button')) setPhase('dock');
  });

  function setTalkingState(on, autoResetMs = 45000) {
    clearTimeout(talkingTimer);
    talkingActive = Boolean(on);
    layerEl.dataset.talking = talkingActive ? '1' : '0';
    if ($('b-voice-badge')) {
      $('b-voice-badge').classList.toggle('hidden', !talkingActive);
    }
    syncMoodPresentation(true);
    if (talkingActive && autoResetMs > 0) {
      talkingTimer = setTimeout(() => {
        setTalkingState(false, 0);
      }, autoResetMs);
    }
  }

  function openConversationToast() {
    lastInteractionAt = Date.now();
    if (!bubbleEl.classList.contains('hidden')) {
      closeBubble();
      return;
    }
    const line = liveState.dialogueQuip || QUIPS[quipIdx++ % QUIPS.length];
    openBubble('toast', line, 4500);
    playStateTransition();
  }

  async function executeDoubleClickAction() {
    lastInteractionAt = Date.now();
    playStateTransition();
    const action = prefs.dblAction;
    if (action === 'hybrid-chat') {
      openBubble('hybrid', liveState.dialogueQuip || '— Sẵn sàng chuyển tiếp chỉ thị thẳng vào phiên Antigravity, Master.');
      setIgnoreMouse(false);
      setTimeout(() => {
        if ($('b-chat-input')) $('b-chat-input').focus();
      }, 40);
      return;
    }

    if (action === 'toggle-bubble') {
      if (bubbleEl.classList.contains('hidden') || bubbleEl.dataset.mode !== 'usage') {
        openBubble('usage');
      } else {
        closeBubble();
      }
      return;
    }

    if (action === 'focus-chat') {
      if (window.fairyDesktop && window.fairyDesktop.triggerVoice) {
        const res = await window.fairyDesktop.triggerVoice({ mode: 'focus-chat' });
        if (res && res.ok) {
          openBubble('toast', '— Đã đưa con trỏ về khung chat Antigravity cho Master.', 3000);
        } else {
          openBubble('toast', 'Không tìm thấy cửa sổ Antigravity đang mở.', 3500);
        }
      }
      return;
    }

    // Voice Mode / Win+H toggle
    const nextTalk = !talkingActive;
    const isWinVoice = action === 'win-voice';
    setTalkingState(nextTalk);
    if (nextTalk) {
      openBubble(
        'toast',
        isWinVoice
          ? '🗣️ Đã bật Win+H nhập giọng nói vào Antigravity.'
          : '🔊 Đã bật Voice Mode trong Antigravity. Tôi đang đàm thoại cùng ngài, Master.',
        4200
      );
    } else {
      openBubble(
        'toast',
        isWinVoice ? 'Đã tạm dừng Win+H, Master.' : 'Đã tạm tắt Voice Mode, Master.',
        2800
      );
    }

    if (window.fairyDesktop && window.fairyDesktop.triggerVoice) {
      const res = await window.fairyDesktop.triggerVoice({ mode: action });
      if (nextTalk && res && !res.ok) {
        setTalkingState(false, 0);
        const hint = res.error === 'window_not_found'
          ? 'Chưa thấy cửa sổ Antigravity đang mở để bật Voice Mode.'
          : 'Không thấy nút Voice Mode qua UIA (hãy chắc chắn ô nhập chat đang trống hoặc dùng Win+H).';
        openBubble('toast', hint, 6500);
      }
    }
  }

  // ---------- Drag (Click & Hold 220ms), Single-Click Toast, Double-Click Immediate Action ----------
  let lastShortClickAt = 0;
  let singleClickTimer = null;

  coreEl.addEventListener('pointerdown', (e) => {
    if (phase !== 'dock' || e.button !== 0) return;
    lastInteractionAt = Date.now();
    clearTimeout(singleClickTimer);
    if (dragState && dragState.timer) clearTimeout(dragState.timer);

    const r = coreEl.getBoundingClientRect();
    const state = {
      id: e.pointerId,
      dx: e.clientX - (r.left + r.width / 2),
      dy: e.clientY - (r.top + r.height / 2),
      sx: e.clientX,
      sy: e.clientY,
      moved: false,
      holdUnlocked: false,
      timer: null,
    };
    state.timer = setTimeout(() => {
      if (dragState !== state || !prefs.drag) return;
      state.holdUnlocked = true;
      layerEl.dataset.dragging = '1';
    }, HOLD_DRAG_MS);

    dragState = state;
    try { coreEl.setPointerCapture(e.pointerId); } catch {}
    setIgnoreMouse(false);
    e.preventDefault();
  });

  coreEl.addEventListener('pointermove', (e) => {
    if (!dragState || dragState.id !== e.pointerId) return;
    if (!dragState.holdUnlocked) {
      if (Math.hypot(e.clientX - dragState.sx, e.clientY - dragState.sy) > 14) {
        clearTimeout(dragState.timer);
      }
      return;
    }
    if (!prefs.drag) return;
    if (!dragState.moved) {
      if (Math.abs(e.clientX - dragState.sx) < 3 && Math.abs(e.clientY - dragState.sy) < 3) return;
      dragState.moved = true;
    }
    applyDockPos(clampPos(e.clientX - dragState.dx, e.clientY - dragState.dy));
    placeBubble();
  });

  function finishDrag(e) {
    if (!dragState || dragState.id !== e.pointerId) return;
    clearTimeout(dragState.timer);
    const { moved, holdUnlocked } = dragState;
    dragState = null;
    layerEl.dataset.dragging = '0';

    if (e.type === 'pointercancel') {
      updateMousePassthrough(e.clientX, e.clientY);
      return;
    }

    if (moved) {
      const r = coreEl.getBoundingClientRect();
      customPos = clampPos(r.left + r.width / 2, r.top + r.height / 2);
      writePref(KEYS.pos, customPos);
      placeBubble();
    } else if (!holdUnlocked) {
      const now = performance.now();
      if (now - lastShortClickAt <= DBL_CLICK_MS) {
        lastShortClickAt = 0;
        clearTimeout(singleClickTimer);
        executeDoubleClickAction();
      } else {
        lastShortClickAt = now;
        clearTimeout(singleClickTimer);
        singleClickTimer = setTimeout(() => {
          lastShortClickAt = 0;
          openConversationToast();
        }, 280);
      }
    }
    updateMousePassthrough(e.clientX, e.clientY);
  }

  coreEl.addEventListener('pointerup', finishDrag);
  coreEl.addEventListener('pointercancel', finishDrag);
  coreEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openSettings();
  });

  // ---------- Bubble & Incoming State ----------
  let lastConvSig = '';
  function syncHybridControls() {
    if ($('b-hybrid-badge')) {
      const on = Boolean(liveState.hybridConnected);
      $('b-hybrid-badge').dataset.on = on ? '1' : '0';
      $('b-hybrid-badge').title = liveState.sidecarPort
        ? `Plugin Link: cổng ${liveState.sidecarPort}`
        : 'Đang chờ Antigravity Sidecar';
    }
    const sel = $('b-conv-select');
    if (!sel || document.activeElement === sel) return;
    const list = Array.isArray(liveState.recentConversations) ? liveState.recentConversations : [];
    const sig = `${liveState.conversationId || ''}|${list.map((c) => `${c.id}:${c.preview}`).join('||')}`;
    if (sig === lastConvSig) return;
    lastConvSig = sig;
    sel.innerHTML = '';
    if (!list.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Chưa có phiên Antigravity';
      sel.appendChild(opt);
      return;
    }
    for (const c of list) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.preview || `${c.id.slice(0, 8)}...`;
      if (c.id === liveState.conversationId) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function renderBubble() {
    const m = currentMood();
    $('b-status').innerHTML = `<b>${MOOD_LABELS[m] || m}${previewMood ? ' (Thử)' : ''}</b>`;
    $('b-model').textContent = liveState.modelName || 'Chưa ghi nhận';
    $('b-tool').textContent = liveState.lastToolError ? `${liveState.lastTool || 'tool'} (Lỗi)` : (liveState.lastTool || '—');
    $('b-counts').textContent = `${liveState.invocationCount || 0} lượt · ${liveState.toolCount || 0} tool`;
    if (!$('b-quip').textContent) $('b-quip').textContent = liveState.dialogueQuip || QUIPS[0];
    syncHybridControls();
  }

  let doneStamp = '';
  let dialogueStamp = '';
  function applyIncomingState(snap) {
    if (!snap || typeof snap !== 'object') return;
    liveState = snap;
    if (snap.voiceActive) {
      lastInteractionAt = Date.now();
      if (!voiceSyncActive || !talkingActive) {
        voiceSyncActive = true;
        setTalkingState(true, 0);
      }
    } else if (voiceSyncActive) {
      voiceSyncActive = false;
      setTalkingState(false, 0);
    } else if (snap.mood === 'thinking' || snap.mood === 'working') {
      lastInteractionAt = Date.now();
      if (talkingActive) setTalkingState(false, 0);
    } else if (snap.mood === 'done') {
      lastInteractionAt = Date.now();
    }
    syncMoodPresentation(phase === 'dock');

    if (snap.dialogueQuip && `${snap.mood}|${snap.emotionMood}|${snap.dialogueQuip}` !== dialogueStamp) {
      dialogueStamp = `${snap.mood}|${snap.emotionMood}|${snap.dialogueQuip}`;
      $('b-quip').textContent = snap.dialogueQuip;
    }

    if (phase === 'dock' && snap.mood === 'done') {
      const stamp = String(snap.updatedAt || Date.now());
      if (stamp !== doneStamp) {
        doneStamp = stamp;
        const quip = snap.dialogueQuip || QUIPS[quipIdx++ % QUIPS.length];
        openBubble('turn', quip, 9000);
      }
    }
  }

  // ---------- Settings ----------
  function syncPrefsUI() {
    document.documentElement.dataset.fz3Theme = prefs.theme === 'light' ? 'light' : 'dark';
    layerEl.dataset.drag = prefs.drag ? '1' : '0';
    layerEl.dataset.chrome = prefs.chrome ? '1' : '0';
    layerEl.dataset.rate = String(prefs.rate);
    coreEl.classList.toggle('hidden', eyeHidden);

    $('sw-autoboot').dataset.on = prefs.autoBoot ? '1' : '0';
    if ($('sw-startup')) $('sw-startup').dataset.on = startupEnabled ? '1' : '0';
    $('sw-drag').dataset.on = prefs.drag ? '1' : '0';
    $('sw-chrome').dataset.on = prefs.chrome ? '1' : '0';
    $('rng-volume').value = String(prefs.volume);
    $('vol-label').textContent = `${prefs.volume}%`;
    document.querySelectorAll('[data-theme-pick]').forEach((b) => {
      b.dataset.on = b.dataset.themePick === prefs.theme ? '1' : '0';
    });
    document.querySelectorAll('[data-rate-pick]').forEach((b) => {
      b.dataset.on = Number(b.dataset.ratePick) === prefs.rate ? '1' : '0';
    });
    document.querySelectorAll('[data-dbl-pick]').forEach((b) => {
      b.dataset.on = b.dataset.dblPick === prefs.dblAction ? '1' : '0';
    });
    document.querySelectorAll('[data-preview-mood]').forEach((b) => {
      b.dataset.active = previewMood === b.dataset.previewMood ? '1' : '0';
    });
  }

  function refreshStartupPref() {
    if (!window.fairyDesktop || !window.fairyDesktop.getStartup) return;
    window.fairyDesktop.getStartup()
      .then((on) => {
        startupEnabled = Boolean(on);
        if ($('sw-startup')) $('sw-startup').dataset.on = startupEnabled ? '1' : '0';
      })
      .catch(() => {});
  }

  function openSettings() {
    closeBubble();
    refreshStartupPref();
    settingsModal.classList.remove('hidden');
    setIgnoreMouse(false);
  }

  function closeSettings() {
    settingsModal.classList.add('hidden');
    if (phase === 'dock') setIgnoreMouse(true);
  }

  $('btn-close-bubble').addEventListener('click', closeBubble);
  if ($('btn-expand-bubble')) {
    $('btn-expand-bubble').addEventListener('click', () => {
      const cur = bubbleEl.dataset.mode;
      const next = cur === 'toast' ? 'hybrid' : cur === 'hybrid' ? 'usage' : 'hybrid';
      openBubble(next);
    });
  }

  if ($('b-chat-form')) {
    $('b-chat-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('b-chat-input');
      const sendBtn = $('b-chat-send');
      const message = input ? input.value.trim() : '';
      if (!message || !window.fairyDesktop || !window.fairyDesktop.hybridAction) return;
      input.disabled = true;
      if (sendBtn) sendBtn.disabled = true;
      const prevMood = activeDisplayMood;
      layerEl.dataset.mood = 'thinking';
      try {
        const targetConv = ($('b-conv-select') && $('b-conv-select').value) || liveState.conversationId || '';
        const res = await window.fairyDesktop.hybridAction({
          action: 'send-message',
          conversationId: targetConv,
          message,
        });
        input.value = '';
        playStateTransition();
        $('b-quip').textContent = res && res.executedDirect
          ? '— Ting~ Đã gửi thẳng vào phiên Antigravity qua Plugin API.'
          : '— Đã chuyển lệnh qua Plugin Bridge. Nếu khung Fairy H.D.D chưa tải bản mới, ngài đóng/mở lại 1 lần.';
      } catch {
        layerEl.dataset.mood = prevMood;
        $('b-quip').textContent = 'Không thể gửi qua Hybrid Bridge.';
      } finally {
        input.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
        input.focus();
      }
    });
  }

  if ($('btn-b-mic')) {
    $('btn-b-mic').addEventListener('click', async () => {
      if (!window.fairyDesktop || !window.fairyDesktop.triggerVoice) return;
      const nextTalk = !talkingActive;
      setTalkingState(nextTalk);
      const res = await window.fairyDesktop.triggerVoice({ mode: 'voice-mode' });
      if (nextTalk && res && !res.ok) {
        setTalkingState(false, 0);
        $('b-quip').textContent = 'Không tự tìm thấy nút Voice Mode. Ngài vẫn có thể nhập ở ô Hybrid hoặc bật Win+H.';
      } else {
        $('b-quip').textContent = nextTalk
          ? '🔊 Đã bật Voice Mode trong Antigravity. Tôi đang đàm thoại cùng ngài, Master.'
          : 'Đã tạm tắt Voice Mode, Master.';
      }
    });
  }

  if ($('b-conv-select')) {
    $('b-conv-select').addEventListener('change', async () => {
      const targetConv = $('b-conv-select').value;
      if (!targetConv || !window.fairyDesktop || !window.fairyDesktop.hybridAction) return;
      await window.fairyDesktop.hybridAction({
        action: 'switch-conversation',
        conversationId: targetConv,
      });
      $('b-quip').textContent = '— Đang yêu cầu Plugin chuyển khung chat Antigravity sang phiên đã chọn.';
    });
  }

  if ($('btn-b-newconv')) {
    $('btn-b-newconv').addEventListener('click', async () => {
      if (!window.fairyDesktop || !window.fairyDesktop.hybridAction) return;
      const input = $('b-chat-input');
      const promptMsg = input && input.value.trim() ? input.value.trim() : 'Xin chào Fairy, bắt đầu phiên làm việc mới.';
      const res = await window.fairyDesktop.hybridAction({
        action: 'new-conversation',
        message: promptMsg,
      });
      if (input && input.value.trim()) input.value = '';
      $('b-quip').textContent = res && res.executedDirect
        ? '— Ting~ Đã mở phiên hội thoại Antigravity mới qua Plugin API.'
        : '— Đã gửi yêu cầu tạo phiên mới qua Plugin Bridge.';
    });
  }
  $('btn-b-boot').addEventListener('click', () => setPhase('boot'));
  $('btn-b-greet').addEventListener('click', () => setPhase('greet'));
  $('btn-b-reset').addEventListener('click', () => {
    customPos = null;
    try { localStorage.removeItem(KEYS.pos); } catch {}
    applyDockPos(null);
    setTimeout(placeBubble, 80);
  });
  $('btn-b-settings').addEventListener('click', openSettings);
  $('btn-close-settings').addEventListener('click', closeSettings);
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettings();
  });

  $('sw-autoboot').addEventListener('click', () => {
    prefs.autoBoot = !prefs.autoBoot;
    writePref(KEYS.autoBoot, prefs.autoBoot);
    syncPrefsUI();
  });
  $('sw-startup').addEventListener('click', () => {
    const next = !startupEnabled;
    if (window.fairyDesktop && window.fairyDesktop.setStartup) {
      window.fairyDesktop.setStartup(next)
        .then((actual) => {
          startupEnabled = Boolean(actual);
          syncPrefsUI();
        })
        .catch(() => {});
    }
  });
  $('rng-volume').addEventListener('input', (e) => {
    prefs.volume = Math.min(100, Math.max(0, Number(e.target.value) || 0));
    writePref(KEYS.volume, prefs.volume);
    $('vol-label').textContent = `${prefs.volume}%`;
    bootVideo.volume = prefs.volume / 100;
  });
  $('sw-drag').addEventListener('click', () => {
    prefs.drag = !prefs.drag;
    writePref(KEYS.drag, prefs.drag);
    syncPrefsUI();
  });
  $('sw-chrome').addEventListener('click', () => {
    prefs.chrome = !prefs.chrome;
    writePref(KEYS.chrome, prefs.chrome);
    syncPrefsUI();
  });
  document.querySelectorAll('[data-theme-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      prefs.theme = btn.dataset.themePick;
      writePref(KEYS.theme, prefs.theme);
      syncPrefsUI();
    });
  });
  document.querySelectorAll('[data-rate-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      prefs.rate = Number(btn.dataset.ratePick) || 1;
      writePref(KEYS.rate, prefs.rate);
      syncPrefsUI();
    });
  });
  document.querySelectorAll('[data-dbl-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.dblPick;
      if (DBL_ACTIONS.includes(val)) {
        prefs.dblAction = val;
        writePref(KEYS.dblAction, prefs.dblAction);
        syncPrefsUI();
      }
    });
  });

  document.querySelectorAll('[data-preview-mood]').forEach((btn) => {
    btn.addEventListener('click', () => {
      clearTimeout(previewTimer);
      lastInteractionAt = Date.now();
      const m = btn.dataset.previewMood;
      previewMood = previewMood === m ? '' : m;
      syncPrefsUI();
      syncMoodPresentation(true);
      if (previewMood) {
        previewTimer = setTimeout(() => {
          previewMood = '';
          syncPrefsUI();
          syncMoodPresentation(true);
        }, 6000);
      }
    });
  });

  $('btn-s-reboot').addEventListener('click', () => setPhase('boot'));
  $('btn-s-resetpos').addEventListener('click', () => {
    customPos = null;
    try { localStorage.removeItem(KEYS.pos); } catch {}
    applyDockPos(null);
  });
  $('btn-s-quit').addEventListener('click', () => {
    if (window.fairyDesktop) window.fairyDesktop.quit();
  });

  window.addEventListener('resize', () => {
    if (customPos) applyDockPos(customPos);
    placeBubble();
  });

  // ---------- Electron IPC ----------
  if (window.fairyDesktop) {
    window.fairyDesktop.onState(applyIncomingState);
    window.fairyDesktop.onCommand((cmd) => {
      if (cmd === 'replay-boot') setPhase('boot');
      else if (cmd === 'replay-greet') setPhase('greet');
      else if (cmd === 'open-settings') openSettings();
      else if (cmd === 'reset-pos') {
        customPos = null;
        try { localStorage.removeItem(KEYS.pos); } catch {}
        applyDockPos(null);
        placeBubble();
      } else if (cmd === 'toggle-eye') {
        eyeHidden = !eyeHidden;
        if (eyeHidden) closeBubble();
        syncPrefsUI();
      } else if (cmd === 'toggle-bubble') {
        if (phase !== 'dock') setPhase('dock');
        if (bubbleEl.classList.contains('hidden')) openBubble('usage');
        else closeBubble();
      }
    });
    window.fairyDesktop.getState().then(applyIncomingState).catch(() => {});
    refreshStartupPref();
  }

  syncPrefsUI();
  applyDockPos(customPos);
  setPhase(phase);
  if (window.fairyDesktop) window.fairyDesktop.notifyReady();
})();

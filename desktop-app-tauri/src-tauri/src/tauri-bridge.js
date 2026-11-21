(() => {
  if (window.fairyDesktop) return;

  function tauriInvoke(cmd, args) {
    const t = window.__TAURI__;
    if (!t || !t.core || typeof t.core.invoke !== 'function') {
      return Promise.reject(new Error('TAURI_CORE_UNAVAILABLE'));
    }
    return t.core.invoke(cmd, args || {});
  }

  function tauriListen(eventName, cb) {
    const t = window.__TAURI__;
    if (!t || !t.event || typeof t.event.listen !== 'function') {
      return () => {};
    }
    let disposed = false;
    let unlistenFn = null;
    const promise = t.event.listen(eventName, (event) => {
      if (!disposed && typeof cb === 'function') {
        cb(event ? event.payload : undefined);
      }
    });
    promise.then((fn) => {
      if (disposed) {
        try { fn(); } catch {}
      } else {
        unlistenFn = fn;
      }
    }).catch(() => {});

    return () => {
      disposed = true;
      if (typeof unlistenFn === 'function') {
        try { unlistenFn(); } catch {}
      }
    };
  }

  function collectInteractiveRects() {
    const rects = [];
    const nodes = document.querySelectorAll('[data-interactive="1"]');
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i];
      if (!el || el.classList.contains('hidden')) continue;
      if (el.closest('.hidden')) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue;
      rects.push({ x: r.left, y: r.top, width: r.width, height: r.height });
    }
    return rects;
  }

  let currentIgnoreMouse = false;
  function syncInteractiveRectsSoon() {
    if (!currentIgnoreMouse) return;
    setTimeout(() => {
      if (!currentIgnoreMouse) return;
      tauriInvoke('update_interactive_rects', { rects: collectInteractiveRects() }).catch(() => {});
    }, 45);
  }

  window.fairyDesktop = {
    setIgnoreMouse: (ignore) => {
      const next = Boolean(ignore);
      currentIgnoreMouse = next;
      const rects = next ? collectInteractiveRects() : [];
      tauriInvoke('set_ignore_mouse', { ignore: next, rects }).catch(() => {});
    },
    setShape: (rects) => {
      tauriInvoke('set_shape', { rects: Array.isArray(rects) ? rects : null }).catch(() => {});
    },
    setWindowRect: (rect) => {
      tauriInvoke('set_window_rect', { rect: rect || null }).catch(() => {});
      syncInteractiveRectsSoon();
    },
    getDisplayBounds: () => tauriInvoke('get_display_bounds'),
    setFocusable: (focusable) => {
      tauriInvoke('set_focusable', { focusable: Boolean(focusable) }).catch(() => {});
    },
    setPhase: (phase) => {
      tauriInvoke('set_phase', { phase: String(phase || 'dock') }).catch(() => {});
    },
    getState: () => tauriInvoke('get_state'),
    onState: (cb) => tauriListen('fairy:state', cb),
    onCommand: (cb) => tauriListen('fairy:cmd', (cmd) => {
      cb(cmd);
      syncInteractiveRectsSoon();
    }),
    onSpeak: (cb) => tauriListen('fairy:speak', cb),
    setTtsEnabled: (enabled) => {
      tauriInvoke('set_tts_enabled', { enabled: Boolean(enabled) }).catch(() => {});
    },
    setAutoMute: (enabled) => {
      tauriInvoke('set_auto_mute', { enabled: Boolean(enabled) }).catch(() => {});
    },
    speakText: (text) => tauriInvoke('speak_text', { text: String(text || '') }),
    notifyReady: () => {
      tauriInvoke('notify_ready').catch(() => {});
    },
    getStartup: () => tauriInvoke('get_startup'),
    setStartup: (enabled) => tauriInvoke('set_startup', { enabled: Boolean(enabled) }),
    triggerVoice: (payload) => tauriInvoke('trigger_voice', { payload: payload || {} }),
    hybridAction: (req) => tauriInvoke('hybrid_action', { req: req || {} }),
    butlerAction: (req) => tauriInvoke('butler_action', { req: req || {} }),
    setButlerPrefs: (patch) => tauriInvoke('set_butler_prefs', { patch: patch || {} }),
    onButlerEvent: (cb) => tauriListen('fairy:butler-event', (evt) => {
      cb(evt);
      syncInteractiveRectsSoon();
    }),
    quit: () => {
      tauriInvoke('quit_app').catch(() => {});
    },
  };
})();

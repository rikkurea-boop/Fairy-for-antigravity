#!/bin/bash
pkill -f "fairy-zzz-antigravity/desktop-app" 2>/dev/null || pkill -f "Electron.*desktop-app" 2>/dev/null || true
pkill -f "fairy_tts_daemon.py" 2>/dev/null || true
echo "Da dong Fairy Desktop Overlay va TTS daemon."

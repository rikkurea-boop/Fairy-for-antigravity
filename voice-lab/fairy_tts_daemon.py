"""
Persistent VieNeu-TTS worker daemon for Fairy III Desktop Overlay.
Keeps the Vietnamese reference model warm in RAM and synthesizes short
antigravity/Fairy utterances using the locked 2-layer android DSP chain.
Protocol (JSON Lines over stdin/stdout):
  -> {"id": 1, "text": "...", "out": "..."}
  <- {"ready": true}
  <- {"id": 1, "ok": true, "out": "...", "elapsedMs": 1240}
"""
import atexit
import contextlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

os.environ.setdefault("PYTHONUTF8", "1")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

REAL_STDOUT = sys.stdout
if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8", errors="replace")
if hasattr(REAL_STDOUT, "reconfigure"):
    REAL_STDOUT.reconfigure(encoding="utf-8", errors="replace")

if os.name == "nt":
    _orig_subproc_run = subprocess.run
    _NO_WIN = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)

    def _hidden_run(*args, **kwargs):
        kwargs.setdefault("creationflags", _NO_WIN)
        return _orig_subproc_run(*args, **kwargs)

    subprocess.run = _hidden_run

import tune_fairy_jp as tf  # noqa: E402


def emit_json(payload: dict):
    REAL_STDOUT.write(json.dumps(payload, ensure_ascii=False) + "\n")
    REAL_STDOUT.flush()


def split_speech_clauses(raw: str, max_chars: int = 340, max_clauses: int = 3):
    text = re.sub(r"\s+", " ", str(raw or "")).strip()
    if not text:
        return []
    parts = [p.strip(" -—–~") for p in re.split(r"(?<=[.!?])\s+|\n+", text)]
    clauses = []
    total_len = 0
    for part in parts:
        if not part or not re.search(r"[\wÀ-ỹ]", part, re.UNICODE):
            continue
        if len(part) > 190:
            subparts = [sp.strip() for sp in re.split(r"(?<=[,;:])\s+", part) if sp.strip()]
            buf = ""
            for sp in subparts:
                if buf and len(buf) + len(sp) + 1 > 160:
                    clauses.append(buf)
                    total_len += len(buf) + 1
                    buf = sp
                    if len(clauses) >= max_clauses or total_len >= max_chars:
                        break
                else:
                    buf = f"{buf} {sp}".strip() if buf else sp
            if buf and len(clauses) < max_clauses and total_len < max_chars:
                if not re.search(r"[.!?]$", buf):
                    buf += "."
                clauses.append(buf)
                total_len += len(buf) + 1
            if len(clauses) >= max_clauses or total_len >= max_chars:
                break
            continue
        if not re.search(r"[.!?]$", part):
            part += "."
        if clauses and total_len + len(part) + 1 > max_chars:
            break
        clauses.append(part)
        total_len += len(part) + 1
        if len(clauses) >= max_clauses:
            break
    return clauses


def main():
    ref_src = os.path.join(SCRIPT_DIR, "ref_trucly_raw.wav")
    if not os.path.isfile(ref_src):
        emit_json({"ready": False, "error": f"Missing reference WAV: {ref_src}"})
        return

    tmpd = tempfile.mkdtemp(prefix="fairy_tts_ref_")
    atexit.register(lambda: shutil.rmtree(tmpd, ignore_errors=True))

    with contextlib.redirect_stdout(sys.stderr):
        y_src = tf.load_mono_f32(ref_src)
        tts, voice_id = tf.build_fairy_ref_tts(y_src, tmpd)
        # Warm up NeuCodec/LLM kernel caches once so first live reply runs fast
        try:
            _ = tf.synthesize_clauses(tts, voice_id, ["Sẵn sàng."])
        except Exception:
            pass

    emit_json({"ready": True})

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            out_path = str(req.get("out") or "").strip()
            clauses = split_speech_clauses(str(req.get("text") or ""))
            if not out_path or not clauses:
                emit_json({"id": req_id, "ok": False, "error": "empty_text_or_out"})
                continue

            os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
            base_root, base_ext = os.path.splitext(out_path)
            t0 = time.perf_counter()
            total_chunks = len(clauses)
            chunk_paths = []
            for idx, clause in enumerate(clauses):
                chunk_out = out_path if total_chunks == 1 else f"{base_root}_c{idx}{base_ext or '.wav'}"
                tmp_out = f"{chunk_out}.tmp.wav"
                with contextlib.redirect_stdout(sys.stderr):
                    y_raw = tts.infer(clause, voice=voice_id, temperature=0.58, top_k=20, silence_p=0.06)
                    y_seg = tf.trim_silence_taper(y_raw.astype(tf.np.float32), sr=tf.SR)
                    tf.render_with_locked_preset(y_seg, tmp_out)
                os.replace(tmp_out, chunk_out)
                chunk_paths.append(chunk_out)
                emit_json({
                    "id": req_id,
                    "chunk": True,
                    "chunkIndex": idx,
                    "totalChunks": total_chunks,
                    "out": chunk_out,
                    "clause": clause,
                    "elapsedMs": int((time.perf_counter() - t0) * 1000),
                })

            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            emit_json({
                "id": req_id,
                "ok": True,
                "out": chunk_paths[0],
                "chunks": chunk_paths,
                "clauses": clauses,
                "elapsedMs": elapsed_ms,
            })
        except Exception as exc:
            emit_json({"id": req_id, "ok": False, "error": str(exc)})


if __name__ == "__main__":
    main()

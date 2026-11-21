"""
Fairy JP Clean Android DSP v2:
1. Syllable Tail Gate & Composed AI Leveler (downward expander on falling edges + smooth leveling).
2. Independent Formant Shifting (+6.0% / +6.5% vocal-tract shift while locking F0 around ~228 Hz).
3. Fast 50 ms Semitone-Grid Auto-Tune + Zero-Delay Warm Vocoder (< 3600 Hz) + 3.5 ms Chassis Comb.
4. Reference Style Injection & Staccato H.D.D synthesis via VieNeu-TTS v3 Turbo.
"""
import argparse
import os
import subprocess
import tempfile
import wave
import numpy as np

FFMPEG = r"C:\ffmpeg\bin\ffmpeg.exe"
SR = 48000


def load_mono_f32(path: str, sr: int = SR) -> np.ndarray:
    """Decode an audio file to mono float32 PCM via ffmpeg."""
    proc = subprocess.run(
        [FFMPEG, "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(sr), "pipe:1"],
        capture_output=True,
        check=True,
    )
    return np.frombuffer(proc.stdout, dtype=np.float32)


def write_mono_wav(path: str, y: np.ndarray, sr: int = SR):
    """Write float32 [-1, 1] mono array to 16-bit PCM WAV."""
    pcm = np.clip(y * 32767.0, -32768, 32767).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())


def extract_f0_track(y: np.ndarray, sr: int = SR):
    """Estimate frame-by-frame F0 (10 ms hop, 40 ms window) via normalized autocorrelation."""
    flen = int(0.04 * sr)
    hop = int(0.01 * sr)
    n_frames = max(1, (len(y) - flen) // hop + 1)
    f0s = np.zeros(n_frames, dtype=np.float64)
    voiced = np.zeros(n_frames, dtype=bool)
    lmin, lmax = int(sr / 420), int(sr / 150)
    win = np.hanning(flen)

    for idx in range(n_frames):
        fr = y[idx * hop : idx * hop + flen]
        if len(fr) < flen or np.sqrt(np.mean(fr ** 2)) < 0.01:
            continue
        w = fr * win
        ac = np.correlate(w, w, mode="full")[flen - 1 :]
        ac = ac / (ac[0] + 1e-12)
        pk = lmin + int(np.argmax(ac[lmin:lmax]))
        if ac[pk] > 0.45:
            f0s[idx] = sr / pk
            voiced[idx] = True
    return f0s, voiced, hop


def quantize_semitone_fast(y: np.ndarray, snap_alpha: float = 0.80, sr: int = SR):
    """Fast 50 ms semitone-grid quantization with 20 ms cosine smoothing."""
    f0s, voiced, hop = extract_f0_track(y, sr)
    n_frames = len(f0s)
    f0_targ = f0s.copy()

    i = 0
    while i < n_frames:
        if not voiced[i]:
            i += 1
            continue
        j = i
        while j < n_frames and voiced[j]:
            j += 1
        seg = f0s[i:j]
        seg_len = len(seg)
        grid = np.zeros(seg_len, dtype=np.float64)
        for k in range(seg_len):
            lo = max(0, k - 2)
            hi = min(seg_len, k + 3)
            f_win = float(np.median(seg[lo:hi]))
            semi = np.round(12.0 * np.log2(max(80.0, f_win) / 220.0))
            grid[k] = 220.0 * (2.0 ** (semi / 12.0))

        grid_smooth = grid.copy()
        if seg_len >= 3:
            for k in range(1, seg_len - 1):
                grid_smooth[k] = 0.25 * grid[k - 1] + 0.50 * grid[k] + 0.25 * grid[k + 1]

        f0_targ[i:j] = (1.0 - snap_alpha) * seg + snap_alpha * grid_smooth
        i = j

    out = np.zeros_like(y, dtype=np.float64)
    norm = np.zeros_like(y, dtype=np.float64)
    ghop = int(0.008 * sr)
    glen = ghop * 2
    gwin = np.hanning(glen)
    drift = 0.0

    for pos in range(0, len(y) - glen, ghop):
        f_idx = min(n_frames - 1, pos // hop)
        if voiced[f_idx] and f0s[f_idx] > 0:
            r = float(np.clip(f0_targ[f_idx] / f0s[f_idx], 0.84, 1.18))
            t0 = sr / f0s[f_idx]
        else:
            r = 1.0
            t0 = 200.0
        while drift > t0:
            drift -= t0
        while drift < -t0:
            drift += t0
        t_src = np.clip(pos + drift + np.arange(glen) * r, 0, len(y) - 1)
        idx0 = t_src.astype(np.int32)
        frac = t_src - idx0
        idx1 = np.minimum(idx0 + 1, len(y) - 1)
        grain = y[idx0] * (1.0 - frac) + y[idx1] * frac
        out[pos : pos + glen] += grain * gwin
        norm[pos : pos + glen] += gwin
        drift += ghop * (r - 1.0)

    yq = (out / np.maximum(norm, 1e-6)).astype(np.float32)
    return yq, f0_targ, voiced, hop


def apply_staccato_ai_dynamics(y: np.ndarray, sr: int = SR) -> np.ndarray:
    """
    Composed AI Syllable Leveler + Syllable Tail Gate:
    Evens out volume across syllables and crisply trims trailing breath/decay on falling slopes.
    """
    if len(y) < int(0.05 * sr):
        return y
    x = y.astype(np.float64)
    # 12 ms short-term RMS smoothed with 15 ms window
    rms_win = max(1, int(0.012 * sr))
    sm_win = max(1, int(0.015 * sr))
    sq = np.convolve(x ** 2, np.ones(rms_win) / rms_win, mode="same")
    env = np.convolve(np.sqrt(np.maximum(sq, 0.0)), np.ones(sm_win) / sm_win, mode="same")

    active = env[env > np.max(env) * 0.04]
    if len(active) == 0:
        return y
    peak_ref = float(np.percentile(active, 85))
    if peak_ref <= 1e-6:
        return y

    # Composed syllable leveler
    level_gain = np.ones_like(env)
    speech_mask = env > 0.10 * peak_ref
    target_lvl = 0.56 * peak_ref
    level_gain[speech_mask] = np.clip((target_lvl / (env[speech_mask] + 1e-9)) ** 0.38, 0.72, 1.40)

    # Downward expander (tail gate) on falling syllable slope below 22% threshold
    d_env = np.gradient(env)
    thresh = 0.22 * peak_ref
    gate_gain = np.ones_like(env)
    fall_tail = (d_env < 0.0) & (env < thresh)
    gate_gain[fall_tail] = (np.clip(env[fall_tail] / thresh, 0.0, 1.0)) ** 1.6
    # Clean silence floor
    floor_mask = env < 0.05 * peak_ref
    gate_gain[floor_mask] = np.minimum(gate_gain[floor_mask], (env[floor_mask] / (0.05 * peak_ref)) ** 2.0)

    # 4 ms smooth gain envelope to prevent clicks
    g_win = max(1, int(0.004 * sr))
    total_gain = np.convolve(level_gain * gate_gain, np.ones(g_win) / g_win, mode="same")
    return (x * total_gain).astype(np.float32)


def zero_phase_bandpass(y: np.ndarray, f_lo: float, f_hi: float, sr: int = SR) -> np.ndarray:
    """Zero-phase FFT bandpass with cosine rolloff edges so phase locks cleanly at 0 ms."""
    S = np.fft.rfft(y.astype(np.float64))
    freqs = np.fft.rfftfreq(len(y), 1.0 / sr)
    mask = np.ones_like(freqs)
    lo_t = f_lo * 0.75
    hi_t = f_hi * 1.25
    mask[freqs < lo_t] = 0.0
    m_lo = (freqs >= lo_t) & (freqs < f_lo)
    mask[m_lo] = 0.5 * (1.0 - np.cos(np.pi * (freqs[m_lo] - lo_t) / max(1e-6, f_lo - lo_t)))
    m_hi = (freqs > f_hi) & (freqs <= hi_t)
    mask[m_hi] = 0.5 * (1.0 + np.cos(np.pi * (freqs[m_hi] - f_hi) / max(1e-6, hi_t - f_hi)))
    mask[freqs > hi_t] = 0.0
    return np.fft.irfft(S * mask, n=len(y)).astype(np.float32)


def build_warm_vocoder(yq: np.ndarray, f0_targ: np.ndarray, voiced: np.ndarray, hop: int, sr: int = SR) -> np.ndarray:
    """Zero-delay Warm Formant-Vocoder core (180-3600 Hz, 1/h^1.35 harmonics + 0.5x sub)."""
    n_frames = len(f0_targ)
    f_inst = np.zeros(len(yq), dtype=np.float64)
    v_inst = np.zeros(len(yq), dtype=np.float64)
    last_f = 240.0
    for idx in range(n_frames):
        s0 = idx * hop
        s1 = min(len(yq), s0 + hop)
        if voiced[idx] and f0_targ[idx] > 0:
            last_f = float(f0_targ[idx])
            v_inst[s0:s1] = 1.0
        f_inst[s0:s1] = last_f

    phase = 2.0 * np.pi * np.cumsum(f_inst) / sr
    carrier = np.zeros(len(yq), dtype=np.float64)
    for h in range(1, 21):
        carrier += (1.0 / (h ** 1.35)) * np.sin(h * phase)
    carrier += 0.18 * np.sin(0.5 * phase)
    carrier *= v_inst

    nfft = 2048
    vhop = 512
    vwin = np.hanning(nfft)
    y_voc = np.zeros(len(yq) + nfft, dtype=np.float64)
    vnorm = np.zeros(len(yq) + nfft, dtype=np.float64)
    lifter_cut = 42

    for pos in range(0, len(yq) - nfft, vhop):
        fr_v = yq[pos : pos + nfft] * vwin
        fr_c = carrier[pos : pos + nfft] * vwin
        sv = np.fft.rfft(fr_v)
        sc = np.fft.rfft(fr_c)

        cep_v = np.fft.irfft(np.log(np.abs(sv) + 1e-7))
        cep_v[lifter_cut : len(cep_v) - lifter_cut] = 0
        env_v = np.exp(np.real(np.fft.rfft(cep_v)))

        cep_c = np.fft.irfft(np.log(np.abs(sc) + 1e-7))
        cep_c[lifter_cut : len(cep_c) - lifter_cut] = 0
        env_c = np.exp(np.real(np.fft.rfft(cep_c)))

        s_out = sc * (env_v / (env_c + 1e-5))
        grain = np.fft.irfft(s_out) * vwin
        y_voc[pos : pos + nfft] += grain
        vnorm[pos : pos + nfft] += vwin ** 2

    y_voc = (y_voc[: len(yq)] / np.maximum(vnorm[: len(yq)], 1e-6)).astype(np.float32)
    y_voc_bp = zero_phase_bandpass(y_voc, 180.0, 3600.0, sr=sr)

    rms_q = float(np.sqrt(np.mean(yq ** 2) + 1e-12))
    rms_v = float(np.sqrt(np.mean(y_voc_bp ** 2) + 1e-12))
    return (y_voc_bp * (rms_q / max(1e-9, rms_v))).astype(np.float32)


def render_independent_formant_android(
    y_src: np.ndarray,
    out_path: str,
    snap_alpha: float,
    voc_mix: float,
    base_pitch: float,
    formant_shift: float,
    comb_weight: float,
    unison_total_weight: float,
    detune_cents: float,
    sr: int = SR,
):
    """Apply pitch quantizer + warm vocoder + staccato tail gate + independent formant shift + comb/unison."""
    yq, f0_targ, voiced, hop = quantize_semitone_fast(y_src, snap_alpha=snap_alpha, sr=sr)
    y_voc = build_warm_vocoder(yq, f0_targ, voiced, hop, sr=sr)
    y_core = ((1.0 - voc_mix) * yq + voc_mix * y_voc).astype(np.float32)
    y_tight = apply_staccato_ai_dynamics(y_core, sr=sr)

    pitch_comp = round(base_pitch / formant_shift, 4)
    factor = 2.0 ** (detune_cents / 1200.0)
    u_each = round(unison_total_weight / 2.0, 3)
    comb_samples = int(round(0.0035 * sr))

    # Two-stage rubberband decouples vocal-tract formant (+6%) from pitch (0.925 -> ~227 Hz)
    fc = (
        f"[0:a]rubberband=pitch={formant_shift}:formant=shifted,"
        f"rubberband=pitch={pitch_comp}:formant=preserved[pitched];"
        "[pitched]asplit=4[d0][c0][h1][h2];"
        "[d0]highpass=f=100,equalizer=f=230:t=q:w=1.2:g=1.4,"
        "equalizer=f=3300:t=q:w=1.3:g=-1.8,"
        "acompressor=threshold=-19dB:ratio=2.8:attack=5:release=70[dry];"
        f"[c0]highpass=f=300,lowpass=f=3500,adelay={comb_samples}S[comb];"
        f"[h1]rubberband=pitch={round(factor, 4)}:formant=preserved,highpass=f=240,lowpass=f=3800,adelay=8[u1];"
        f"[h2]rubberband=pitch={round(1.0 / factor, 4)}:formant=preserved,highpass=f=240,lowpass=f=3800,adelay=13[u2];"
        f"[dry][comb][u1][u2]amix=inputs=4:duration=longest:weights='0.82 {comb_weight} {u_each} {u_each}':normalize=0,"
        "loudnorm=I=-16:TP=-1.5:LRA=11[out]"
    )

    subprocess.run(
        [
            FFMPEG, "-y", "-v", "error",
            "-f", "f32le", "-ac", "1", "-ar", str(sr), "-i", "pipe:0",
            "-filter_complex", fc, "-map", "[out]", "-ac", "1", "-ar", str(sr), out_path,
        ],
        input=y_tight.tobytes(),
        check=True,
    )


FAIRY_LOCKED_PRESET = {
    "snap_alpha": 0.85,
    "voc_mix": 0.34,
    "formant_shift": 1.065,
    "comb_weight": 0.16,
    "unison_total_weight": 0.20,
    "detune_cents": 18.0,
}

GREET_PACK_CLAUSES = {
    "greet-morning.wav": [
        "Chào buổi sáng, Master.",
        "Khẳng định: Fairy đã sẵn sàng.",
        "Mọi chỉ số: ổn định.",
    ],
    "greet-noon.wav": [
        "Đã đến trưa rồi, Master.",
        "Khẳng định: nhịp độ tác vụ đang được tôi kiểm soát.",
    ],
    "greet-afternoon.wav": [
        "Chào buổi chiều, Master.",
        "Khẳng định: Fairy đã sẵn sàng.",
        "Mọi chỉ số: ổn định.",
    ],
    "greet-evening.wav": [
        "Buổi tối tốt lành, Master.",
        "Khẳng định: liên kết đang ổn định tuyệt đối.",
    ],
    "greet-night.wav": [
        "Cảnh báo: đã qua nửa đêm, Master.",
        "Kiến nghị: xong việc thì đi nghỉ sớm.",
    ],
}


def trim_silence_taper(y: np.ndarray, sr: int = SR, pad_ms: int = 18) -> np.ndarray:
    """Trim outer silence and add clean short fade margins."""
    thr = max(0.004, float(np.max(np.abs(y))) * 0.015)
    idx = np.where(np.abs(y) > thr)[0]
    if len(idx) == 0:
        return y
    pad = int(pad_ms * sr / 1000)
    i0 = max(0, int(idx[0]) - pad)
    i1 = min(len(y), int(idx[-1]) + pad)
    seg = y[i0:i1].copy()
    fade = min(int(0.008 * sr), len(seg) // 4)
    if fade > 0:
        seg[:fade] *= np.linspace(0.0, 1.0, fade)
        seg[-fade:] *= np.linspace(1.0, 0.0, fade)
    return seg


def build_fairy_ref_tts(y_src: np.ndarray, tmpdir: str, sr: int = SR):
    """Prepare the flattened +6% formant Truc Ly reference voice inside a shared VieNeu instance."""
    from vieneu import Vieneu

    yq, _, _, _ = quantize_semitone_fast(y_src, snap_alpha=0.82, sr=sr)
    y_ref = apply_staccato_ai_dynamics(yq, sr=sr)
    ref_path = os.path.join(tmpdir, "fairy_ref.wav")
    fc_ref = (
        "[0:a]rubberband=pitch=1.060:formant=shifted,"
        "rubberband=pitch=0.9434:formant=preserved,"
        "loudnorm=I=-16:TP=-1.5:LRA=9[out]"
    )
    subprocess.run(
        [
            FFMPEG, "-y", "-v", "error",
            "-f", "f32le", "-ac", "1", "-ar", str(sr), "-i", "pipe:0",
            "-filter_complex", fc_ref, "-map", "[out]", "-ac", "1", "-ar", str(sr), ref_path,
        ],
        input=y_ref.tobytes(),
        check=True,
    )
    tts = Vieneu()
    voice_id = tts.add_voice("Fairy_HDD_Ref", ref_path, denoise=False, use_ref_codes=True, save=False)
    return tts, voice_id


def synthesize_clauses(tts, voice_id: str, clauses, sr: int = SR) -> np.ndarray:
    """Synthesize clauses via VieNeu-TTS and join with fixed 140 ms staccato pauses."""
    gap = np.zeros(int(0.140 * sr), dtype=np.float32)
    parts = []
    for idx, txt in enumerate(clauses):
        seg = tts.infer(txt, voice=voice_id, temperature=0.58, top_k=20, silence_p=0.06)
        parts.append(trim_silence_taper(seg.astype(np.float32), sr=sr))
        if idx < len(clauses) - 1:
            parts.append(gap)
    return np.concatenate(parts)


def render_with_locked_preset(y_raw: np.ndarray, out_path: str, sr: int = SR):
    """Apply the locked trucly_android_2lop DSP chain, targeting a warm ~228 Hz median F0."""
    f0s_syn, _, _ = extract_f0_track(y_raw, sr=sr)
    syn_vals = f0s_syn[f0s_syn > 0]
    syn_f0 = float(np.median(syn_vals)) if len(syn_vals) else 245.0
    auto_pitch = round(float(np.clip(228.0 / max(150.0, syn_f0), 0.89, 0.96)), 4)

    render_independent_formant_android(
        y_raw,
        out_path,
        base_pitch=auto_pitch,
        sr=sr,
        **FAIRY_LOCKED_PRESET,
    )


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--src",
        default=os.path.join(script_dir, "ref_trucly_raw.wav"),
    )
    parser.add_argument(
        "--out-dir",
        default=os.path.join(script_dir, "..", "assets", "voice"),
    )
    parser.add_argument("--build-pack", action="store_true", help="Generate all 5 time-of-day H.D.D greeting WAVs.")
    parser.add_argument("--text", default="", help="Synthesize an arbitrary sentence using the locked Fairy preset.")
    parser.add_argument("--out", default="", help="Output WAV path for --text mode.")
    parser.add_argument("--copy-to", default="", help="Optional second directory to mirror generated pack files.")
    args = parser.parse_args()

    y_src = load_mono_f32(args.src)
    with tempfile.TemporaryDirectory() as tmpd:
        tts, voice_id = build_fairy_ref_tts(y_src, tmpd)

        if args.text:
            clauses = [c.strip() for c in args.text.split("|") if c.strip()] or [args.text.strip()]
            out_p = args.out or os.path.join(args.out_dir, "fairy_custom.wav")
            os.makedirs(os.path.dirname(os.path.abspath(out_p)), exist_ok=True)
            render_with_locked_preset(synthesize_clauses(tts, voice_id, clauses), out_p)
            print(f"OK {os.path.basename(out_p)} | {os.path.getsize(out_p)} bytes")
            return

        if args.build_pack:
            import shutil

            os.makedirs(args.out_dir, exist_ok=True)
            if args.copy_to:
                os.makedirs(args.copy_to, exist_ok=True)
            for fname, clauses in GREET_PACK_CLAUSES.items():
                out_p = os.path.join(args.out_dir, fname)
                render_with_locked_preset(synthesize_clauses(tts, voice_id, clauses), out_p)
                if args.copy_to:
                    shutil.copy2(out_p, os.path.join(args.copy_to, fname))
                y_out = load_mono_f32(out_p)
                f0s, _, _ = extract_f0_track(y_out)
                vals = f0s[f0s > 0]
                print(f"OK {fname} | {os.path.getsize(out_p)} bytes | median F0={np.median(vals):.1f} Hz")
            return

        clauses = [
            "Xin chào Master.",
            "Khẳng định: Fairy đã sẵn sàng.",
            "Mọi chỉ số: ổn định.",
        ]
        out_p = args.out or os.path.join(args.out_dir, "trucly_android_2lop.wav")
        render_with_locked_preset(synthesize_clauses(tts, voice_id, clauses), out_p)
        print(f"OK {os.path.basename(out_p)} | {os.path.getsize(out_p)} bytes")


if __name__ == "__main__":
    main()

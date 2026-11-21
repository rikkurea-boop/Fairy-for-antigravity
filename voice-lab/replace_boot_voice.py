"""
Replace only the Chinese speech line inside Fairy H.D.D boot.mp4 / boot.webm (4.26s-5.65s)
with the locked Vietnamese Android Fairy voice ('trucly_android_2lop' preset), while
preserving 100% of the surrounding mechanical boot audio and stereo background bed.
"""
import argparse
import os
import shutil
import subprocess
import tempfile
import numpy as np

FFMPEG = r"C:\ffmpeg\bin\ffmpeg.exe"
SR = 48000

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tune_fairy_jp import (
    FAIRY_LOCKED_PRESET,
    build_fairy_ref_tts,
    extract_f0_track,
    load_mono_f32,
    render_independent_formant_android,
    synthesize_clauses,
)


def load_stereo_f32(path: str, sr: int = SR) -> np.ndarray:
    proc = subprocess.run(
        [FFMPEG, "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(sr), "pipe:1"],
        capture_output=True,
        check=True,
    )
    return np.frombuffer(proc.stdout, dtype=np.float32).reshape(-1, 2)


def smooth_window(n_samples: int, i_start: int, i_end: int, fade_samples: int) -> np.ndarray:
    """Create a 0..1 raised-cosine mask over [i_start, i_end] with smooth fade edges."""
    w = np.zeros(n_samples, dtype=np.float64)
    a = max(0, i_start)
    b = min(n_samples, i_end)
    if b <= a:
        return w
    f = min(fade_samples, (b - a) // 3)
    w[a:b] = 1.0
    if f > 0:
        ramp = 0.5 * (1.0 - np.cos(np.pi * np.arange(f) / f))
        w[a : a + f] = ramp
        w[b - f : b] = ramp[::-1]
    return w


def split_band_zero_phase(sig: np.ndarray, f_lo: float, f_hi: float, sr: int = SR):
    """Return (low < f_lo, band f_lo..f_hi, high > f_hi) using smooth zero-phase cosine crossovers."""
    S = np.fft.rfft(sig.astype(np.float64))
    freqs = np.fft.rfftfreq(len(sig), 1.0 / sr)
    tw_lo = f_lo * 0.25
    tw_hi = f_hi * 0.15

    # Lowpass < f_lo
    m_low = np.ones_like(freqs)
    r_lo = (freqs >= f_lo - tw_lo) & (freqs <= f_lo + tw_lo)
    m_low[r_lo] = 0.5 * (1.0 + np.cos(np.pi * (freqs[r_lo] - (f_lo - tw_lo)) / (2.0 * tw_lo)))
    m_low[freqs > f_lo + tw_lo] = 0.0

    # Highpass > f_hi
    m_high = np.ones_like(freqs)
    m_high[freqs < f_hi - tw_hi] = 0.0
    r_hi = (freqs >= f_hi - tw_hi) & (freqs <= f_hi + tw_hi)
    m_high[r_hi] = 0.5 * (1.0 - np.cos(np.pi * (freqs[r_hi] - (f_hi - tw_hi)) / (2.0 * tw_hi)))

    m_mid = np.maximum(0.0, 1.0 - m_low - m_high)
    y_low = np.fft.irfft(S * m_low, n=len(sig))
    y_band = np.fft.irfft(S * m_mid, n=len(sig))
    y_high = np.fft.irfft(S * m_high, n=len(sig))
    return y_low, y_band, y_high


def generate_boot_vi_voice(src_ref_wav: str, out_wav: str, text: str = "Hệ thống khởi động hoàn tất."):
    """Synthesize Vietnamese Fairy boot line with the locked Android DSP preset."""
    y_src = load_mono_f32(src_ref_wav)
    with tempfile.TemporaryDirectory() as tmpd:
        tts, voice_id = build_fairy_ref_tts(y_src, tmpd)
        y_raw = synthesize_clauses(tts, voice_id, [text])
        f0s_syn, _, _ = extract_f0_track(y_raw)
        syn_vals = f0s_syn[f0s_syn > 0]
        syn_f0 = float(np.median(syn_vals)) if len(syn_vals) else 245.0
        auto_pitch = round(float(np.clip(228.0 / max(150.0, syn_f0), 0.89, 0.96)), 4)

        render_independent_formant_android(
            y_raw,
            out_wav,
            base_pitch=auto_pitch,
            **FAIRY_LOCKED_PRESET,
        )


def replace_speech_in_boot_audio(boot_media_path: str, vi_voice_wav: str, out_audio_wav: str):
    """Suppress Chinese speech in Mid(200..7500 Hz) over 4.30-5.65s, preserve Side bed + low bass, and mix VI voice."""
    st = load_stereo_f32(boot_media_path, SR)
    vi = load_mono_f32(vi_voice_wav, SR).astype(np.float64)

    n = len(st)
    mid = (st[:, 0].astype(np.float64) + st[:, 1].astype(np.float64)) * 0.5
    side = (st[:, 0].astype(np.float64) - st[:, 1].astype(np.float64)) * 0.5

    # Fade window covering the exact Chinese phrase (4.26s - 5.65s) with 45 ms edges
    i_a = int(4.26 * SR)
    i_b = int(5.68 * SR)
    mask = smooth_window(n, i_a, i_b, fade_samples=int(0.045 * SR))

    # Suppress center-channel voice band (180..9200 Hz) inside mask while preserving sub-bass (<180Hz) & highs (>9200Hz)
    w_pad = int(0.4 * SR)
    s0 = max(0, i_a - w_pad)
    s1 = min(n, i_b + w_pad)
    mid_low, _mid_vband, mid_high = split_band_zero_phase(mid[s0:s1], 180.0, 9200.0, SR)
    mid_clean_local = mid_low + mid_high * 0.65

    mid_out = mid.copy()
    m_local = mask[s0:s1]
    mid_out[s0:s1] = mid[s0:s1] * (1.0 - m_local) + mid_clean_local * m_local

    # Gentle attenuation on Side reverb bleed (~-3.5dB max) so no ghost ZH echo leaks while stereo bed stays intact
    side_out = side * (1.0 - 0.35 * mask)

    # Trim silence from VI voice and normalize to match original ZH window RMS (~ -17.5 dB / active speech peak)
    nz = np.where(np.abs(vi) > 0.005)[0]
    if len(nz) > 0:
        pad_s = int(0.02 * SR)
        vi = vi[max(0, int(nz[0]) - pad_s) : min(len(vi), int(nz[-1]) + pad_s)]

    # Measure RMS of original ZH mid vocal band inside [4.45s .. 5.55s]
    orig_rms = float(np.sqrt(np.mean((mid[int(4.45 * SR) : int(5.55 * SR)]) ** 2) + 1e-12))
    vi_rms = float(np.sqrt(np.mean(vi ** 2) + 1e-12))
    vi_scaled = vi * (orig_rms / max(1e-9, vi_rms)) * 0.96

    # Fit inside 4.26s..5.68s window; time-compress cleanly with rubberband if needed (>1.38s)
    max_slot = int(1.36 * SR)
    if len(vi_scaled) > max_slot:
        ratio = len(vi_scaled) / max_slot
        with tempfile.TemporaryDirectory() as td:
            v_in = os.path.join(td, "vi_in.wav")
            v_fit = os.path.join(td, "vi_fit.wav")
            subprocess.run(
                [FFMPEG, "-y", "-v", "error", "-f", "f32le", "-ac", "1", "-ar", str(SR), "-i", "pipe:0", v_in],
                input=vi_scaled.astype(np.float32).tobytes(),
                check=True,
            )
            subprocess.run(
                [FFMPEG, "-y", "-v", "error", "-i", v_in, "-af", f"atempo={ratio:.4f}", v_fit],
                check=True,
            )
            vi_scaled = load_mono_f32(v_fit, SR).astype(np.float64)

    insert_at = int(4.28 * SR)
    end_at = min(n, insert_at + len(vi_scaled))
    seg_len = end_at - insert_at
    fade_v = min(int(0.015 * SR), seg_len // 4)
    if fade_v > 0:
        vi_scaled[:fade_v] *= np.linspace(0.0, 1.0, fade_v)
        vi_scaled[seg_len - fade_v : seg_len] *= np.linspace(1.0, 0.0, fade_v)
    mid_out[insert_at:end_at] += vi_scaled[:seg_len]

    # Reconstruct L/R stereo and prevent clipping
    left = mid_out + side_out
    right = mid_out - side_out
    stereo = np.stack([left, right], axis=1)
    peak = float(np.max(np.abs(stereo)))
    if peak > 0.96:
        stereo *= 0.96 / peak

    pcm16 = np.clip(stereo * 32767.0, -32768, 32767).astype(np.int16)
    subprocess.run(
        [
            FFMPEG, "-y", "-v", "error",
            "-f", "s16le", "-ac", "2", "-ar", str(SR), "-i", "pipe:0",
            out_audio_wav,
        ],
        input=pcm16.tobytes(),
        check=True,
    )


def remux_video_with_audio(video_in: str, wav_in: str, video_out: str, audio_codec: str, bitrate: str):
    """Mux untouched video stream with new Vietnamese audio track cleanly."""
    tmp_out = video_out + ".tmp" + os.path.splitext(video_out)[1]
    cmd = [
        FFMPEG, "-y", "-v", "error",
        "-i", video_in,
        "-i", wav_in,
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", audio_codec,
        "-b:a", bitrate,
    ]
    if video_out.lower().endswith(".mp4"):
        cmd += ["-movflags", "+faststart"]
    cmd.append(tmp_out)
    subprocess.run(cmd, check=True)
    os.replace(tmp_out, video_out)


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(script_dir, ".."))

    parser = argparse.ArgumentParser()
    parser.add_argument("--ref", default=os.path.join(script_dir, "ref_trucly_raw.wav"))
    parser.add_argument("--text", default="Hệ thống khởi động hoàn tất.")
    args = parser.parse_args()

    plugin_mp4 = os.path.join(repo_root, "antigravity-plugin", "assets", "boot.mp4")
    plugin_webm = os.path.join(repo_root, "antigravity-plugin", "assets", "boot.webm")
    root_mp4 = os.path.join(repo_root, "assets", "boot.mp4")

    with tempfile.TemporaryDirectory() as tmpd:
        vi_wav = os.path.join(tmpd, "vi_boot_line.wav")
        mixed_wav = os.path.join(tmpd, "boot_stereo_vi.wav")

        print("1. Synthesizing Vietnamese boot line via Fairy locked preset...")
        generate_boot_vi_voice(args.ref, vi_wav, text=args.text)

        print("2. Attenuating ZH Mid vocal (4.26-5.68s) while preserving mechanical boot & Side stereo...")
        replace_speech_in_boot_audio(plugin_mp4, vi_wav, mixed_wav)

        print("3. Remuxing untouched video streams with new VI audio track...")
        remux_video_with_audio(plugin_mp4, mixed_wav, plugin_mp4, "aac", "192k")
        remux_video_with_audio(plugin_webm, mixed_wav, plugin_webm, "libopus", "160k")
        if os.path.exists(root_mp4):
            remux_video_with_audio(root_mp4, mixed_wav, root_mp4, "aac", "192k")

    installed_assets = os.path.join(os.path.expanduser("~"), ".gemini", "config", "plugins", "fairy-zzz", "assets")
    if os.path.isdir(installed_assets):
        shutil.copy2(plugin_mp4, os.path.join(installed_assets, "boot.mp4"))
        shutil.copy2(plugin_webm, os.path.join(installed_assets, "boot.webm"))

    print(f"DONE boot.mp4={os.path.getsize(plugin_mp4)}B | boot.webm={os.path.getsize(plugin_webm)}B | root_boot.mp4={os.path.getsize(root_mp4)}B")


if __name__ == "__main__":
    main()

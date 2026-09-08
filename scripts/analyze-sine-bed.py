"""Offline sinusoidal modeling of BV1jebG6zE1E. Do not ship source audio."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import medfilt, stft

ROOT = Path(__file__).resolve().parents[1]
WAV = ROOT / "video" / "BV1jebG6zE1E.wav"
SCORE = ROOT / "src" / "sine-bed-score.ts"
RECON = ROOT / "video" / "sine-bed-recon.wav"

NPERSEG = 8192
HOP = 441  # 10 ms at 44.1 kHz
MAX_PEAKS = 14
MIN_PEAK_FRAC = 0.045
FREQ_MATCH_HZ = 28.0
MAX_MISS = 12
VOICE_MIN_SEC = 0.35
FREQ_CLUSTER_HZ = 18.0
ORNAMENT_MIN_SEC = 0.07
ORNAMENT_MAX_SEC = 0.45
ORNAMENT_MIN_HZ = 380.0
KEYFRAME_DT = 0.12
CROSSFADE = 0.32
MAX_VOICES = 8
MAX_ORNAMENTS = 80


def parabolic(mag: np.ndarray, k: int) -> tuple[float, float]:
    if k <= 0 or k >= len(mag) - 1:
        return float(k), float(mag[k])
    a, b, c = float(mag[k - 1]), float(mag[k]), float(mag[k + 1])
    denom = a - 2 * b + c
    if abs(denom) < 1e-12:
        return float(k), b
    delta = 0.5 * (a - c) / denom
    delta = max(-0.5, min(0.5, delta))
    amp = b - 0.25 * (a - c) * delta
    return k + delta, max(amp, 0.0)


def frame_peaks(mag_col: np.ndarray, freqs: np.ndarray) -> list[tuple[float, float]]:
    floor = max(float(mag_col.max()) * MIN_PEAK_FRAC, 1e-4)
    peaks: list[tuple[float, float]] = []
    for k in range(2, len(mag_col) - 2):
        if mag_col[k] < floor:
            continue
        if mag_col[k] >= mag_col[k - 1] and mag_col[k] >= mag_col[k + 1]:
            if mag_col[k] < mag_col[k - 2] or mag_col[k] < mag_col[k + 2]:
                continue
            bin_f, amp = parabolic(mag_col, k)
            freq = float(np.interp(bin_f, np.arange(len(freqs)), freqs))
            if 55 <= freq <= 2400:
                peaks.append((freq, amp))
    peaks.sort(key=lambda p: p[1], reverse=True)
    return peaks[:MAX_PEAKS]


def click_mask(mag: np.ndarray) -> np.ndarray:
    flux = np.maximum(0.0, np.diff(mag, axis=1, prepend=mag[:, :1])).sum(axis=0)
    med = medfilt(flux, 31)
    high = mag[mag.shape[0] // 4 :].sum(axis=0)
    high_med = medfilt(high, 31)
    flux_cut = np.percentile(flux, 93)
    return (flux > np.maximum(med * 2.8, flux_cut)) | (
        high > high_med * 3.2 + np.percentile(high, 90) * 0.2
    )


class Track:
    __slots__ = ("start", "frames", "freq", "amp", "missed", "alive")

    def __init__(self, frame: int, freq: float, amp: float):
        self.start = frame
        self.frames = [frame]
        self.freq = [freq]
        self.amp = [amp]
        self.missed = 0
        self.alive = True


def track_peaks(
    peaks_by_frame: list[list[tuple[float, float]]], clicks: np.ndarray
) -> list[Track]:
    live: list[Track] = []
    done: list[Track] = []
    for i, peaks in enumerate(peaks_by_frame):
        unused = [] if clicks[i] else peaks[:]
        live.sort(key=lambda tr: tr.amp[-1], reverse=True)
        for tr in live:
            best_j = -1
            best_d = FREQ_MATCH_HZ
            for j, (freq, _amp) in enumerate(unused):
                d = abs(freq - tr.freq[-1])
                limit = max(FREQ_MATCH_HZ, tr.freq[-1] * 0.05)
                if d < best_d and d <= limit:
                    best_d = d
                    best_j = j
            if best_j >= 0:
                freq, amp = unused.pop(best_j)
                tr.frames.append(i)
                tr.freq.append(freq)
                tr.amp.append(amp)
                tr.missed = 0
            else:
                hold = clicks[i] or tr.missed < MAX_MISS
                if hold:
                    tr.frames.append(i)
                    tr.freq.append(tr.freq[-1])
                    tr.amp.append(tr.amp[-1] if clicks[i] else tr.amp[-1] * 0.96)
                    if not clicks[i]:
                        tr.missed += 1
                else:
                    tr.alive = False
        done.extend(tr for tr in live if not tr.alive)
        live = [tr for tr in live if tr.alive]
        if not clicks[i]:
            for freq, amp in unused:
                live.append(Track(i, freq, amp))
    done.extend(live)
    return done


def cluster_voices(tracks: list[Track], n_frames: int, dt: float) -> list[dict]:
    ranked = sorted(tracks, key=lambda tr: float(np.mean(tr.amp)) * len(tr.frames), reverse=True)
    clusters: list[dict] = []
    for tr in ranked:
        median_f = float(np.median(tr.freq))
        host = next(
            (
                c
                for c in clusters
                if abs(c["freq"] - median_f) <= max(FREQ_CLUSTER_HZ, median_f * 0.03)
            ),
            None,
        )
        if host is None:
            host = {
                "freq": median_f,
                "amp": np.zeros(n_frames, dtype=np.float64),
                "freq_sum": np.zeros(n_frames, dtype=np.float64),
                "freq_w": np.zeros(n_frames, dtype=np.float64),
            }
            clusters.append(host)
        for frame, freq, amp in zip(tr.frames, tr.freq, tr.amp):
            if amp >= host["amp"][frame]:
                host["amp"][frame] = amp
            host["freq_sum"][frame] += freq * amp
            host["freq_w"][frame] += amp
        host["freq"] = (
            host["freq"] * 0.6 + median_f * 0.4
            if host["freq_w"].sum()
            else median_f
        )
    voices = []
    for cluster in clusters:
        amp = cluster["amp"]
        if amp.max() < 0.006 or (amp > amp.max() * 0.12).mean() < 0.08:
            continue
        freq = np.divide(
            cluster["freq_sum"],
            np.maximum(cluster["freq_w"], 1e-9),
            out=np.full(n_frames, cluster["freq"]),
            where=cluster["freq_w"] > 0,
        )
        for i in range(1, n_frames):
            if cluster["freq_w"][i] <= 0:
                freq[i] = freq[i - 1]
        amp = smooth_amp(amp, dt)
        times = np.arange(n_frames, dtype=np.float64) * dt
        envelope = downsample(times, freq, amp)
        voices.append(
            {
                "energy": float(amp.sum() * dt),
                **envelope,
            }
        )
    voices.sort(key=lambda v: v["energy"], reverse=True)
    return voices[:MAX_VOICES]


def fill_short_gaps(amp: np.ndarray, dt: float, max_gap: float = 0.5) -> np.ndarray:
    out = amp.copy()
    limit = max(1, int(max_gap / dt))
    quiet = out <= max(out.max() * 0.05, 1e-4)
    index = 0
    n = len(out)
    while index < n:
        if not quiet[index]:
            index += 1
            continue
        end = index
        while end < n and quiet[end]:
            end += 1
        if end - index <= limit and index > 0 and end < n:
            out[index:end] = np.linspace(out[index - 1], out[end], end - index, endpoint=False)
        index = end
    return out


def smooth_amp(amp: np.ndarray, dt: float) -> np.ndarray:
    filled = fill_short_gaps(amp, dt)
    kernel = max(3, int(round(0.2 / dt)) | 1)
    return medfilt(filled, kernel)


def downsample(times: np.ndarray, freq: np.ndarray, amp: np.ndarray) -> dict:
    t_out = [float(times[0])]
    f_out = [round(float(freq[0]), 2)]
    a_out = [round(float(amp[0]), 5)]
    last_t, last_f, last_a = times[0], freq[0], amp[0]
    for t, f, a in zip(times[1:], freq[1:], amp[1:]):
        if last_a < 1e-4 and a < 1e-4 and t - last_t < 0.4:
            continue
        if (
            t - last_t >= KEYFRAME_DT
            or abs(f - last_f) > 2.5
            or abs(a - last_a) > max(0.012, last_a * 0.12)
        ):
            t_out.append(round(float(t), 3))
            f_out.append(round(float(f), 2))
            a_out.append(round(float(a), 5))
            last_t, last_f, last_a = t, f, a
    if t_out[-1] != round(float(times[-1]), 3):
        t_out.append(round(float(times[-1]), 3))
        f_out.append(round(float(freq[-1]), 2))
        a_out.append(round(float(amp[-1]), 5))
    return {"t": t_out, "freq": f_out, "amp": a_out}


def write_ts(score: dict) -> None:
    voices = json.dumps(score["voices"], ensure_ascii=False, separators=(",", ":"))
    ornaments = json.dumps(score["ornaments"], ensure_ascii=False, separators=(",", ":"))
    SCORE.write_text(
        "export type SineVoice = { t: number[]; freq: number[]; amp: number[] };\n"
        "export type SineOrnament = { t: number; freq: number; dur: number; amp: number };\n"
        "export type SineBedScore = {\n"
        "  duration: number;\n"
        "  crossfade: number;\n"
        "  voices: SineVoice[];\n"
        "  ornaments: SineOrnament[];\n"
        "};\n\n"
        "export const sineBedScore: SineBedScore = {\n"
        f"  duration: {score['duration']},\n"
        f"  crossfade: {score['crossfade']},\n"
        f"  voices: {voices},\n"
        f"  ornaments: {ornaments},\n"
        "};\n",
        encoding="utf-8",
    )


def reconstruct(score: dict, sr: int) -> None:
    n = int(score["duration"] * sr)
    y = np.zeros(n, dtype=np.float64)
    t = np.arange(n) / sr
    for voice in score["voices"]:
        ts = np.array(voice["t"])
        fs = np.array(voice["freq"])
        amps = np.array(voice["amp"])
        freq = np.interp(t, ts, fs)
        amp = np.interp(t, ts, amps)
        phase = np.cumsum(2 * math.pi * freq / sr)
        y += amp * np.sin(phase)
    for ev in score["ornaments"]:
        start = int(ev["t"] * sr)
        length = max(1, int(ev["dur"] * sr))
        env = np.hanning(length)
        tone = env * ev["amp"] * np.sin(2 * math.pi * ev["freq"] * np.arange(length) / sr)
        end = min(n, start + length)
        y[start:end] += tone[: end - start]
    peak = np.max(np.abs(y)) or 1
    y = 0.9 * y / peak
    wavfile.write(RECON, sr, (y * 32767).astype(np.int16))


def main() -> None:
    sr, raw = wavfile.read(WAV)
    x = raw.astype(np.float64)
    if x.ndim > 1:
        x = x.mean(axis=1)
    x /= np.max(np.abs(x)) or 1
    freqs, times, spec = stft(
        x,
        fs=sr,
        window="hann",
        nperseg=NPERSEG,
        noverlap=NPERSEG - HOP,
        padded=True,
        boundary="zeros",
    )
    mag = np.abs(spec)
    clicks = click_mask(mag)
    peaks_by_frame = [frame_peaks(mag[:, i], freqs) for i in range(mag.shape[1])]
    tracks = track_peaks(peaks_by_frame, clicks)
    dt = float(times[1] - times[0]) if len(times) > 1 else 0.01
    duration = float(len(x) / sr)

    voices = cluster_voices(tracks, mag.shape[1], dt)
    ornaments = []
    for tr in tracks:
        length = (tr.frames[-1] - tr.frames[0] + 1) * dt
        mean_amp = float(np.mean(tr.amp))
        mean_freq = float(np.mean(tr.freq))
        energy = mean_amp * length
        t0 = tr.start * dt
        if (
            ORNAMENT_MIN_SEC <= length <= ORNAMENT_MAX_SEC
            and mean_freq >= ORNAMENT_MIN_HZ
            and mean_amp > 0.012
        ):
            ornaments.append(
                {
                    "t": round(t0, 4),
                    "freq": round(mean_freq, 2),
                    "dur": round(min(length * 1.1, 0.28), 4),
                    "amp": round(min(mean_amp * 0.45, 0.04), 5),
                    "energy": energy,
                }
            )
    ornaments.sort(key=lambda o: o["energy"], reverse=True)
    ornaments = ornaments[:MAX_ORNAMENTS]

    peak_amp = max((max(v["amp"]) for v in voices), default=1.0)
    scale = 0.09 / peak_amp if peak_amp else 1.0
    for voice in voices:
        voice["amp"] = [round(a * scale, 5) for a in voice["amp"]]
        del voice["energy"]
    for ev in ornaments:
        del ev["energy"]

    score = {
        "duration": round(duration, 4),
        "crossfade": CROSSFADE,
        "voices": voices,
        "ornaments": ornaments,
    }
    write_ts(score)
    reconstruct(score, sr)
    print(
        f"duration={duration:.2f}s voices={len(voices)} ornaments={len(ornaments)} "
        f"click_frac={float(clicks.mean()):.3f} score={SCORE}"
    )


if __name__ == "__main__":
    main()

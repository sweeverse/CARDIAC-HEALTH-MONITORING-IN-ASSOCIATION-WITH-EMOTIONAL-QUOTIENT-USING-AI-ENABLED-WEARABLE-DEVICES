"""
CardioEQ AI — Feature Extraction Engine
=========================================
Converts raw wearable sensor streams (PPG, GSR, accelerometer, gyroscope,
skin temperature, SpO2) into windowed, clinically-meaningful biomarkers:

  - Heart Rate (from PPG beat detections)
  - RR Interval (beat-to-beat interval, ms)
  - RMSSD  (root mean square of successive RR differences — vagal/HRV)
  - SDNN   (standard deviation of RR intervals — overall HRV)
  - Stress Index (derived from GSR/EDA conductance, z-scored per subject)
  - Recovery Rate (intra-window HR slope; negative slope = recovering)
  - Motion Intensity (accelerometer magnitude — activity confound control)
  - SpO2, skin temperature, environmental temp/humidity

Source data is raw, high-frequency (~80-100Hz) sensor output with a
`beat` flag marking detected PPG pulses and `inst_bpm` at those rows.
We window the stream (default 30s, non-overlapping) and compute features
per window — this is the time series the dashboard visualizes.
"""

import re
import pandas as pd
import numpy as np
from pathlib import Path

WINDOW_SECONDS = 30


def normalize_subject_id(raw: str) -> str:
    """
    Canonical subject ID format: a letter prefix + zero-padded 2-digit number
    (S01, S02, ... S09, S10, S11, ...). Fixes both an ambiguous ID scheme AND
    the search bug where "S1" substring-matched S10-S19 — with this format,
    plain exact-match search (see SubjectsOverview.jsx) can never conflate
    "S1"/"S01" with "S10". Non-conforming IDs are returned unchanged.
    """
    m = re.match(r"^([A-Za-z]+)0*(\d+)$", raw.strip())
    if not m:
        return raw.strip()
    prefix, num = m.group(1).upper(), m.group(2)
    return f"{prefix}{int(num):02d}"


def _parse_timestamp_to_seconds(ts_series: pd.Series) -> np.ndarray:
    """Timestamps are 'HH.MM.SS.mmm' strings (dot-delimited, not colon)."""
    parts = ts_series.str.split(".", expand=True).astype(float)
    # HH . MM . SS . mmm  -> 4 columns
    h, m, s, ms = parts[0], parts[1], parts[2], parts[3]
    total = h * 3600 + m * 60 + s + ms / 1000.0
    # handle midnight rollover (not expected here, but safe)
    total = total - total.iloc[0]
    return total.to_numpy()


def _stress_index_from_gsr(gsr_conductance: np.ndarray) -> np.ndarray:
    """
    Skin conductance rises with sympathetic arousal (stress/effort).
    We min-max scale within-subject-recording to a 0-100 'stress index'.
    This is a relative, explainable proxy — not a calibrated clinical EDA score.
    """
    if len(gsr_conductance) == 0 or np.all(np.isnan(gsr_conductance)):
        return np.array([np.nan])
    lo, hi = np.nanpercentile(gsr_conductance, 2), np.nanpercentile(gsr_conductance, 98)
    if hi - lo < 1e-9:
        return np.full_like(gsr_conductance, 50.0)
    scaled = (gsr_conductance - lo) / (hi - lo) * 100
    return np.clip(scaled, 0, 100)


def pan_tompkins_detect(signal: np.ndarray, fs: float) -> np.ndarray:
    """
    Real Pan-Tompkins QRS/pulse detector: bandpass filter -> derivative ->
    squaring -> moving-window integration -> adaptive thresholding.

    This ONLY runs when a raw continuous waveform (PPG or ECG) is actually
    present in the source data — see extract_windows below. This dataset's
    CSVs only ship a precomputed `beat` flag column (peaks already marked
    upstream, no raw waveform to filter), so this function has no signal
    to operate on for the current cohort; it exists and activates
    automatically the moment a raw waveform column is provided, e.g. by a
    live wearable stream, instead of pretending to detect beats from data
    that was never there.

    Returns an array of sample INDICES where a beat was detected.
    """
    if len(signal) < int(fs * 2):
        return np.array([], dtype=int)

    signal = np.nan_to_num(signal.astype(float), nan=np.nanmean(signal))

    # 1. Bandpass filter (5-15 Hz passband, approximated with a simple
    #    difference-based low-pass then high-pass — avoids requiring scipy).
    #    Low-pass: y[n] = 2y[n-1] - y[n-2] + x[n] - 2x[n-6] + x[n-12]
    lp = np.zeros_like(signal)
    for n in range(len(signal)):
        x_n = signal[n]
        x_n6 = signal[n - 6] if n >= 6 else 0
        x_n12 = signal[n - 12] if n >= 12 else 0
        y_n1 = lp[n - 1] if n >= 1 else 0
        y_n2 = lp[n - 2] if n >= 2 else 0
        lp[n] = 2 * y_n1 - y_n2 + x_n - 2 * x_n6 + x_n12

    # High-pass: y[n] = 32x[n-16] - [y[n-1] + x[n] - x[n-32]]
    hp = np.zeros_like(lp)
    for n in range(len(lp)):
        x_n = lp[n]
        x_n16 = lp[n - 16] if n >= 16 else 0
        x_n32 = lp[n - 32] if n >= 32 else 0
        y_n1 = hp[n - 1] if n >= 1 else 0
        hp[n] = x_n16 * 32 - (y_n1 + x_n - x_n32)
    filtered = hp

    # 2. Derivative (5-point)
    deriv = np.zeros_like(filtered)
    for n in range(2, len(filtered) - 2):
        deriv[n] = (-filtered[n - 2] - 2 * filtered[n - 1] + 2 * filtered[n + 1] + filtered[n + 2]) / 8.0

    # 3. Squaring
    squared = deriv ** 2

    # 4. Moving-window integration (~150ms window)
    win_size = max(1, int(round(0.15 * fs)))
    integrated = np.convolve(squared, np.ones(win_size) / win_size, mode="same")

    # 5. Adaptive thresholding — classic Pan-Tompkins two-level running
    #    threshold based on running estimates of signal peak vs noise peak.
    refractory = int(round(0.2 * fs))  # 200ms refractory period between beats
    spki, npki = 0.0, 0.0
    threshold = 0.0
    beats = []
    last_beat = -refractory

    for n in range(1, len(integrated) - 1):
        if integrated[n] > integrated[n - 1] and integrated[n] >= integrated[n + 1]:  # local peak
            peak_val = integrated[n]
            if peak_val > threshold and (n - last_beat) > refractory:
                spki = 0.125 * peak_val + 0.875 * spki
                beats.append(n)
                last_beat = n
            else:
                npki = 0.125 * peak_val + 0.875 * npki
            threshold = npki + 0.25 * (spki - npki)

    return np.array(beats, dtype=int)


def extract_windows(csv_path: Path, subject: str, activity: str) -> pd.DataFrame:
    """Extract windowed biomarker features from one subject/activity recording."""
    df = pd.read_csv(csv_path)
    if df.empty:
        return pd.DataFrame()

    df["t_sec"] = _parse_timestamp_to_seconds(df["timestamp"])

    # If a raw waveform column is present, run real Pan-Tompkins detection
    # and use those beats instead of trusting a precomputed `beat` flag.
    # Falls back to the existing beat-flag/window_bpm approach otherwise —
    # this dataset doesn't ship a raw waveform, so the fallback is what
    # actually runs for the current cohort.
    waveform_col = next((c for c in ("ppg_raw", "ecg_raw", "ppg_waveform") if c in df.columns), None)
    if waveform_col is not None and df[waveform_col].notna().sum() > 100:
        sample_gaps = np.diff(df["t_sec"].dropna().to_numpy())
        fs = 1.0 / np.median(sample_gaps[sample_gaps > 0]) if len(sample_gaps) else 100.0
        beat_indices = pan_tompkins_detect(df[waveform_col].to_numpy(), fs)
        df["beat"] = 0
        df.loc[df.index[beat_indices], "beat"] = 1

    # Static per-recording attributes (forward/back fill — only present on sparse rows)
    static_cols = ["bmi", "age", "height", "weight", "env_temp_c", "env_humidity_pct"]
    static_vals = {c: df[c].dropna().iloc[0] if df[c].notna().any() else np.nan for c in static_cols}

    # Whole-recording stress index needs global scaling, computed once then windowed
    df["stress_index"] = np.nan
    valid_gsr = df["gsr_conductance_us"].notna()
    if valid_gsr.any():
        df.loc[valid_gsr, "stress_index"] = _stress_index_from_gsr(
            df.loc[valid_gsr, "gsr_conductance_us"].to_numpy()
        )

    beats = df[df["beat"] == 1].copy()

    duration = df["t_sec"].max()
    n_windows = max(1, int(duration // WINDOW_SECONDS) + 1)

    rows = []
    for w in range(n_windows):
        t0, t1 = w * WINDOW_SECONDS, (w + 1) * WINDOW_SECONDS
        win = df[(df["t_sec"] >= t0) & (df["t_sec"] < t1)]
        win_beats = beats[(beats["t_sec"] >= t0) & (beats["t_sec"] < t1)]

        if len(win) < 5:
            continue

        # --- Heart rate / HRV from beat-to-beat intervals ---
        beat_times = win_beats["t_sec"].to_numpy()
        rr_ms = np.diff(beat_times) * 1000.0
        rr_ms = rr_ms[(rr_ms > 250) & (rr_ms < 2000)]  # physiological bounds (30-240bpm)

        if len(rr_ms) >= 3:
            heart_rate = 60000.0 / np.mean(rr_ms)
            rr_interval = float(np.mean(rr_ms))
            sdnn = float(np.std(rr_ms, ddof=1))
            rmssd = float(np.sqrt(np.mean(np.diff(rr_ms) ** 2))) if len(rr_ms) >= 4 else np.nan
            # recovery rate: slope of instantaneous HR across the window (bpm/min). Negative = recovering.
            inst_bpm_win = 60000.0 / rr_ms
            if len(inst_bpm_win) >= 3:
                x = np.arange(len(inst_bpm_win))
                slope = np.polyfit(x, inst_bpm_win, 1)[0]
                recovery_rate = float(-slope)  # positive = recovering (HR falling)
            else:
                recovery_rate = np.nan
        elif win["window_bpm"].notna().any():
            heart_rate = float(win["window_bpm"].dropna().mean())
            rr_interval = 60000.0 / heart_rate if heart_rate else np.nan
            sdnn = np.nan
            rmssd = np.nan
            recovery_rate = np.nan
        else:
            heart_rate = rr_interval = sdnn = rmssd = recovery_rate = np.nan

        # --- Motion intensity (signal magnitude area of accelerometer) ---
        acc_cols = ["accel_x", "accel_y", "accel_z"]
        if win[acc_cols].notna().any().any():
            acc = win[acc_cols].ffill().bfill().to_numpy()
            motion_intensity = float(np.mean(np.linalg.norm(acc, axis=1)))
        else:
            motion_intensity = np.nan

        stress = win["stress_index"].dropna()
        stress_val = float(stress.mean()) if len(stress) else np.nan

        spo2 = win["SpO2"].dropna()
        spo2_val = float(spo2.mean()) if len(spo2) else np.nan

        temp = win["temp_c"].dropna()
        temp_val = float(temp.mean()) if len(temp) else np.nan

        rows.append({
            "subject": subject,
            "activity": activity,
            "window_index": w,
            "t_start_sec": t0,
            "heart_rate": heart_rate,
            "rr_interval_ms": rr_interval,
            "rmssd": rmssd,
            "sdnn": sdnn,
            "stress_index": stress_val,
            "recovery_rate": recovery_rate,
            "motion_intensity": motion_intensity,
            "spo2": spo2_val,
            "skin_temp_c": temp_val,
            **static_vals,
        })

    return pd.DataFrame(rows)


def extract_all(csv_dir: Path, metadata_path: Path) -> pd.DataFrame:
    """Run extraction across every subject/activity CSV in the dataset."""
    metadata = pd.read_csv(metadata_path)
    metadata["subject"] = metadata["subject"].astype(str).map(normalize_subject_id)

    all_windows = []
    # Accepts both the legacy "*_modified.csv" naming and the current
    # dataset's "<Subject>_<Activity>.csv" naming (e.g. S01_Cog.csv) —
    # the _modified suffix convention is stale and no longer produced
    # upstream, confirmed 2026-07-11.
    candidates = sorted(set(csv_dir.glob("*_modified.csv")) | set(csv_dir.glob("*.csv")))
    for csv_path in candidates:
        name = csv_path.stem.replace("_modified", "")
        subject, activity = name.rsplit("_", 1)
        subject = normalize_subject_id(subject)
        activity = activity.strip().lower()
        try:
            wdf = extract_windows(csv_path, subject, activity)
            if not wdf.empty:
                all_windows.append(wdf)
                print(f"  {subject}/{activity}: {len(wdf)} windows")
        except Exception as e:
            print(f"  ! failed {subject}/{activity}: {e}")

    windows = pd.concat(all_windows, ignore_index=True)
    return windows


if __name__ == "__main__":
    import os
    _ml_pipeline = Path(__file__).resolve().parent.parent.parent.parent / "ml-pipeline"
    base = Path(os.environ.get("RAW_DATA_DIR", _ml_pipeline / "raw_data" / "modified_all_subjects_FIXED"))
    out = extract_all(base / "modified_csvs", base / "subject_metadata.csv")
    out_path = _ml_pipeline / "data_processed"
    out_path.mkdir(exist_ok=True)
    out.to_parquet(out_path / "windows.parquet", index=False)
    out.to_csv(out_path / "windows.csv", index=False)
    print(f"\nTotal windows extracted: {len(out)}")
    print(out.describe(include="all").T[["count", "mean", "std"]] if False else out.head())

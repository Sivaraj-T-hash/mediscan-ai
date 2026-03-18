#!/usr/bin/env python3
"""
HealthGuard AI — Heart Rate Detector (rPPG)
Uses Remote Photoplethysmography to measure BPM from camera.
Finger-on-camera mode: captures red channel intensity fluctuations.
"""

import sys
import json
import time
import warnings
warnings.filterwarnings("ignore")

try:
    import numpy as np
except ImportError:
    print(json.dumps({"success": False, "error": "numpy not installed. Run: pip install numpy"}))
    sys.exit(1)

try:
    import cv2
except ImportError:
    print(json.dumps({"success": False, "error": "opencv-python not installed. Run: pip install opencv-python"}))
    sys.exit(1)

try:
    from scipy.signal import butter, filtfilt, find_peaks
except ImportError:
    print(json.dumps({"success": False, "error": "scipy not installed. Run: pip install scipy"}))
    sys.exit(1)


# ─── Constants ────────────────────────────────────────────────────────────────
SAMPLE_DURATION_SEC  = 15       # seconds to record
TARGET_FPS           = 30       # expected frames per second
MIN_FRAMES           = 60       # minimum valid frames
BANDPASS_LOW         = 0.7      # Hz — lower bound (42 BPM)
BANDPASS_HIGH        = 3.5      # Hz — upper bound (210 BPM)
BANDPASS_ORDER       = 4
MIN_BPM              = 40
MAX_BPM              = 200
PEAK_MIN_DISTANCE    = 0.3      # seconds between peaks


# ─── Step 1: Capture video ────────────────────────────────────────────────────
def capture_video(duration: int = SAMPLE_DURATION_SEC, camera_index: int = 0) -> tuple[list, float]:
    """
    Capture frames from camera for `duration` seconds.
    Returns (frames_list, actual_fps).
    """
    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        raise RuntimeError("Cannot open camera. Ensure camera permissions are granted.")

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 320)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 240)
    cap.set(cv2.CAP_PROP_FPS, TARGET_FPS)

    frames = []
    start_time = time.time()

    while (time.time() - start_time) < duration:
        ret, frame = cap.read()
        if not ret:
            break
        frames.append(frame)

    cap.release()

    elapsed = time.time() - start_time
    actual_fps = len(frames) / elapsed if elapsed > 0 else TARGET_FPS

    if len(frames) < MIN_FRAMES:
        raise RuntimeError(
            f"Too few frames captured ({len(frames)}). "
            "Check camera access and ensure finger covers lens."
        )

    return frames, actual_fps


# ─── Step 2: Extract red channel mean ─────────────────────────────────────────
def extract_red_signal(frames: list) -> np.ndarray:
    """
    For each frame, compute mean red intensity (OpenCV uses BGR order).
    Returns 1-D numpy array of red channel means.
    """
    red_values = []
    for frame in frames:
        # OpenCV BGR → index 2 = Red channel
        mean_red = np.mean(frame[:, :, 2])
        red_values.append(mean_red)

    signal = np.array(red_values, dtype=np.float64)

    # Validate signal variance — finger must cover lens
    signal_range = signal.max() - signal.min()
    if signal_range < 1.0:
        raise ValueError(
            "Signal too flat. Place your finger firmly over the camera lens."
        )

    return signal


# ─── Step 3: Bandpass filter ───────────────────────────────────────────────────
def apply_bandpass_filter(signal: np.ndarray, fps: float) -> np.ndarray:
    """
    Apply Butterworth bandpass filter (0.7–3.5 Hz = 42–210 BPM).
    """
    nyquist = fps / 2.0
    low  = BANDPASS_LOW  / nyquist
    high = BANDPASS_HIGH / nyquist

    # Clamp to valid range
    low  = max(low,  1e-4)
    high = min(high, 0.999)

    b, a = butter(BANDPASS_ORDER, [low, high], btype='bandpass')
    filtered = filtfilt(b, a, signal)
    return filtered


# ─── Step 4: Detect peaks ────────────────────────────────────────────────────
def detect_peaks(signal: np.ndarray, fps: float) -> np.ndarray:
    """
    Find peaks in the filtered signal corresponding to heartbeats.
    """
    min_distance_samples = int(PEAK_MIN_DISTANCE * fps)
    peaks, _ = find_peaks(signal, distance=min_distance_samples)
    return peaks


# ─── Step 5: Calculate BPM ───────────────────────────────────────────────────
def calculate_bpm(peaks: np.ndarray, duration: float) -> float:
    """
    BPM = (number_of_peaks / duration_seconds) * 60
    """
    if len(peaks) < 2:
        raise ValueError("Not enough peaks detected. Hold finger steady on camera.")

    bpm = (len(peaks) / duration) * 60.0
    return round(bpm, 1)


# ─── Signal quality assessment ───────────────────────────────────────────────
def assess_signal_quality(signal: np.ndarray, peaks: np.ndarray, fps: float) -> str:
    """
    Rate quality: good / fair / poor based on peak regularity and SNR.
    """
    if len(peaks) < 3:
        return "poor"

    # Inter-peak intervals
    intervals = np.diff(peaks) / fps
    cv = np.std(intervals) / np.mean(intervals) if np.mean(intervals) > 0 else 1.0

    if cv < 0.15:
        return "good"
    elif cv < 0.30:
        return "fair"
    else:
        return "poor"


# ─── Risk classification ──────────────────────────────────────────────────────
def classify_heart_rate(bpm: float) -> dict:
    """
    Classify heart rate into risk categories.
    Returns dict with risk level and description.
    """
    if bpm < 50:
        return {
            "risk": "warning",
            "category": "Bradycardia",
            "message": "Heart rate is below normal. Consider consulting a doctor.",
            "message_ta": "இதய துடிப்பு இயல்பை விட குறைவாக உள்ளது. மருத்துவரை அணுகவும்."
        }
    elif bpm > 110:
        return {
            "risk": "high",
            "category": "Tachycardia",
            "message": "Heart rate is elevated. Rest and monitor closely.",
            "message_ta": "இதய துடிப்பு அதிகமாக உள்ளது. ஓய்வெடுத்து கவனமாக கண்காணிக்கவும்."
        }
    elif 50 <= bpm <= 60:
        return {
            "risk": "low",
            "category": "Low Normal",
            "message": "Heart rate is slightly low but within acceptable range.",
            "message_ta": "இதய துடிப்பு சற்று குறைவாக உள்ளது, ஆனால் ஏற்றுக்கொள்ளக்கூடிய வரம்பில் உள்ளது."
        }
    else:
        return {
            "risk": "normal",
            "category": "Normal",
            "message": "Heart rate is within the normal resting range (60–110 BPM).",
            "message_ta": "இதய துடிப்பு இயல்பான ஓய்வு வரம்பில் உள்ளது (60–110 BPM)."
        }


# ─── Main function ────────────────────────────────────────────────────────────
def measure_heart_rate(duration: int = SAMPLE_DURATION_SEC, camera_index: int = 0) -> dict:
    """
    Full rPPG pipeline: capture → extract → filter → peaks → BPM.
    Returns JSON-serializable dict.
    """
    try:
        # Capture
        frames, fps = capture_video(duration, camera_index)

        # Extract red signal
        red_signal = extract_red_signal(frames)

        # Bandpass filter
        filtered = apply_bandpass_filter(red_signal, fps)

        # Peak detection
        peaks = detect_peaks(filtered, fps)

        # BPM calculation
        bpm = calculate_bpm(peaks, duration)

        # Validate
        if not (MIN_BPM <= bpm <= MAX_BPM):
            raise ValueError(
                f"BPM {bpm} is outside valid range ({MIN_BPM}–{MAX_BPM}). "
                "Ensure your finger covers the camera completely."
            )

        # Quality
        quality = assess_signal_quality(filtered, peaks, fps)

        # Risk
        risk_info = classify_heart_rate(bpm)

        return {
            "success": True,
            "bpm": bpm,
            "bpm_rounded": int(round(bpm)),
            "signal_quality": quality,
            "fps": round(fps, 1),
            "frames_captured": len(frames),
            "peaks_detected": int(len(peaks)),
            "duration_sec": duration,
            "risk": risk_info["risk"],
            "category": risk_info["category"],
            "message": risk_info["message"],
            "message_ta": risk_info["message_ta"],
        }

    except RuntimeError as e:
        return {"success": False, "error": str(e), "error_type": "camera"}
    except ValueError as e:
        return {"success": False, "error": str(e), "error_type": "signal"}
    except Exception as e:
        return {"success": False, "error": f"Unexpected error: {str(e)}", "error_type": "unknown"}


# ─── CLI entry point ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="HealthGuard rPPG Heart Rate Detector")
    parser.add_argument("--duration", type=int, default=SAMPLE_DURATION_SEC, help="Recording duration in seconds")
    parser.add_argument("--camera",   type=int, default=0, help="Camera index")
    parser.add_argument("--demo",     action="store_true", help="Run with simulated data (no camera needed)")
    args = parser.parse_args()

    if args.demo:
        # Demo mode — simulate a realistic rPPG signal
        fps = 30.0
        t = np.linspace(0, args.duration, int(fps * args.duration))
        bpm_sim = 72.0
        freq = bpm_sim / 60.0
        # Simulate red channel with heartbeat + noise
        signal = 180 + 10 * np.sin(2 * np.pi * freq * t) + np.random.normal(0, 1.5, len(t))
        filtered = apply_bandpass_filter(signal, fps)
        peaks = detect_peaks(filtered, fps)
        try:
            bpm = calculate_bpm(peaks, args.duration)
        except ValueError:
            bpm = bpm_sim
        quality = assess_signal_quality(filtered, peaks, fps)
        risk_info = classify_heart_rate(bpm)
        result = {
            "success": True,
            "bpm": bpm,
            "bpm_rounded": int(round(bpm)),
            "signal_quality": quality,
            "fps": fps,
            "frames_captured": len(t),
            "peaks_detected": int(len(peaks)),
            "duration_sec": args.duration,
            "risk": risk_info["risk"],
            "category": risk_info["category"],
            "message": risk_info["message"],
            "message_ta": risk_info["message_ta"],
            "demo": True,
        }
    else:
        result = measure_heart_rate(args.duration, args.camera)

    print(json.dumps(result))

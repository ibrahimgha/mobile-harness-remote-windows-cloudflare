"""Build a display-sized GIF from complete source clips without altering the original.

Uses presentation timestamps, Lanczos resizing and a full 256-colour palette per
frame. The result keeps every clip and its duration while reducing only spatial
resolution and temporal sampling to what the voice-orb UI can display.
"""

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import GifImagePlugin, Image


def inspect(source: Path, fps: int):
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise ValueError(f"Cannot open {source}")
    timestamps = []
    source_size = None
    source_fps = capture.get(cv2.CAP_PROP_FPS)
    orientation = capture.get(cv2.CAP_PROP_ORIENTATION_META)
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        source_size = [frame.shape[1], frame.shape[0]]
        timestamps.append(capture.get(cv2.CAP_PROP_POS_MSEC) / 1000)
    capture.release()
    if len(timestamps) < 2 or not all(right > left for left, right in zip(timestamps, timestamps[1:])):
        raise ValueError(f"Expected increasing presentation timestamps: {source}")
    times = np.asarray(timestamps) - timestamps[0]
    duration = float(times[-1] + np.median(np.diff(times)))
    count = max(2, round(duration * fps))
    output_times = np.arange(count) * duration / count
    indices = np.searchsorted(times, output_times + 1e-7, side="right") - 1
    ticks = [round(index * duration * 100 / count) for index in range(count + 1)]
    delays = [(right - left) * 10 for left, right in zip(ticks, ticks[1:])]
    if min(delays) < 20:
        raise ValueError("GIF delay is too short for reliable browser playback")
    return {
        "source": str(source.resolve()), "source_size": source_size, "source_fps": source_fps,
        "source_frames": len(times), "source_duration_seconds": duration,
        "source_orientation_degrees": orientation, "count": count, "indices": indices, "delays": delays
    }


def build(sources: list[Path], target: Path, poster: Path, report: Path, size: int, fps: int):
    clips = [inspect(source, fps) for source in sources]
    if any(abs(clip["source_size"][0] / clip["source_size"][1] - 1) > 0.001 for clip in clips):
        raise ValueError("Sources must retain their existing square presentation aspect ratio")
    target.parent.mkdir(parents=True, exist_ok=True)
    poster.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".encoding.gif")
    encoded_count = elapsed_ms = 0
    total_count = sum(clip["count"] for clip in clips)
    clip_reports = []
    with temporary.open("wb") as output:
        for clip_number, clip in enumerate(clips, start=1):
            start_frame, start_ms = encoded_count, elapsed_ms
            capture = cv2.VideoCapture(clip["source"])
            source_index = output_index = 0
            sample_errors = []
            while output_index < clip["count"]:
                ok, frame = capture.read()
                if not ok:
                    raise ValueError("Video ended before every sampled frame was encoded")
                if clip["indices"][output_index] == source_index:
                    rgb = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                    rgb = rgb.resize((size, size), Image.Resampling.LANCZOS)
                    if encoded_count == 0:
                        rgb.save(poster, optimize=True)
                    indexed = rgb.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
                    if encoded_count == 0:
                        header, _ = GifImagePlugin.getheader(indexed, info={"loop": 0, "optimize": False})
                        for part in header:
                            output.write(part)
                    while output_index < clip["count"] and clip["indices"][output_index] == source_index:
                        delay = clip["delays"][output_index]
                        for part in GifImagePlugin.getdata(indexed, duration=delay, disposal=2, include_color_table=True):
                            output.write(part)
                        elapsed_ms += delay
                        encoded_count += 1
                        output_index += 1
                    if output_index % 60 == 0 or output_index == clip["count"]:
                        print(f"{target.name}: {encoded_count}/{total_count}; clip {clip_number}/{len(clips)}", flush=True)
                        sample_errors.append(float(np.abs(np.asarray(rgb, dtype=np.float32) - np.asarray(indexed.convert("RGB"), dtype=np.float32)).mean()))
                source_index += 1
            capture.release()
            clip_reports.append({key: value for key, value in clip.items() if key not in ("indices", "delays", "count")} | {
                "playback_start_frame": start_frame, "playback_frames": clip["count"],
                "playback_start_seconds": start_ms / 1000, "playback_end_seconds": elapsed_ms / 1000,
                "sample_palette_mean_error_out_of_255": round(float(np.mean(sample_errors)), 3)
            })
        output.write(b";")
    temporary.replace(target)
    actual_delays = []
    with Image.open(target) as gif:
        assert gif.size == (size, size) and gif.info.get("loop") == 0 and gif.n_frames == total_count
        for index in range(gif.n_frames):
            gif.seek(index)
            actual_delays.append(gif.info["duration"])
    assert sum(actual_delays) == elapsed_ms and min(actual_delays) >= 20
    result = {
        "clips_in_playback_order": clip_reports, "size": [size, size], "playback_fps": fps,
        "gif_duration_seconds": elapsed_ms / 1000, "gif_frames": encoded_count,
        "frame_delays_ms": sorted(set(actual_delays)), "loop": "forward repeat",
        "crop": False, "orientation_change": False, "clip_cut": False,
        "source_full_resolution_gif_retained": True,
        "gif_bytes": target.stat().st_size, "poster_bytes": poster.stat().st_size,
        "gif_sha256": hashlib.file_digest(target.open("rb"), "sha256").hexdigest(),
        "poster_sha256": hashlib.file_digest(poster.open("rb"), "sha256").hexdigest()
    }
    report.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("poster", type=Path)
    parser.add_argument("--append", action="append", default=[], type=Path)
    parser.add_argument("--size", type=int, default=480)
    parser.add_argument("--fps", type=int, default=15)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()
    build([args.source, *args.append], args.target, args.poster, args.report, args.size, args.fps)

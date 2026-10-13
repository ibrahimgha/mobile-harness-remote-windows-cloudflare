"""Convert a video to a constant-speed, endpoint-exclusive boomerang GIF.

Requires OpenCV, numpy and Pillow. Honors the video's presentation orientation,
preserves aspect ratio, and uses presentation timestamps rather than average FPS.
Example: python scripts/build-model-bar-boomerang.py input.mov public/loop.gif
"""

import argparse
from bisect import bisect_right
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


def build(source: Path, target: Path, width: int, frame_ms: int, report_dir: Path):
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise ValueError(f'Cannot open video: {source}')
    orientation = capture.get(cv2.CAP_PROP_ORIENTATION_META)
    frames, timestamps = [], []
    while True:
        ok, decoded = capture.read()
        if not ok:
            break
        timestamps.append(capture.get(cv2.CAP_PROP_POS_MSEC) / 1000)
        rgb = Image.fromarray(cv2.cvtColor(decoded, cv2.COLOR_BGR2RGB))
        source_size = rgb.size
        size = (width, round(rgb.height * width / rgb.width))
        frames.append(rgb.resize(size, Image.Resampling.LANCZOS))
    capture.release()
    if len(frames) < 3 or not all(b > a for a, b in zip(timestamps, timestamps[1:])):
        raise ValueError('Video needs at least three frames with increasing presentation times')
    timestamps = [value - timestamps[0] for value in timestamps]

    # A linear time ramp, not a cosine/eased boomerang: playback never slows at
    # either end. Truncate less than one output interval to align both reversals.
    step = frame_ms / 1000
    last = int(np.floor((timestamps[-1] + 1e-8) / step))
    if last < 2:
        raise ValueError('Video is too short for this frame interval')

    def at_time(seconds):
        index = min(len(frames) - 2, max(0, bisect_right(timestamps, seconds) - 1))
        mix = (seconds - timestamps[index]) / (timestamps[index + 1] - timestamps[index])
        # Interpolate VFR presentation times onto an even GIF clock; this removes
        # timing jitter without adding slow-motion, freeze frames or a speed ramp.
        return Image.blend(frames[index], frames[index + 1], max(0, min(1, mix)))

    forward = [at_time(index * step) for index in range(last + 1)]
    # Each endpoint occurs exactly once. Neither the reverse nor the next GIF
    # iteration duplicates it (the usual source of a visible turnaround pause).
    phase_indices = list(range(last + 1)) + list(range(last - 1, 0, -1))
    assert len(phase_indices) == 2 * last
    assert all(abs(b - a) == 1 for a, b in zip(phase_indices, phase_indices[1:] + [0]))
    timeline = [forward[index] for index in phase_indices]

    # One full-animation palette avoids frame-to-frame color shimmer. Retain all
    # 256 colors and full frames; do not trade color quality for a file-size cap.
    atlas = Image.new('RGB', (size[0] * 8, size[1] * 8))
    for slot, index in enumerate(np.linspace(0, len(forward) - 1, 64, dtype=int)):
        atlas.paste(forward[index], ((slot % 8) * size[0], (slot // 8) * size[1]))
    palette = atlas.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    quantized = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in forward]
    encoded = [quantized[index] for index in phase_indices]
    target.parent.mkdir(parents=True, exist_ok=True)
    encoded[0].save(target, save_all=True, append_images=encoded[1:], duration=frame_ms,
                    loop=0, disposal=1, optimize=False)

    with Image.open(target) as gif:
        assert gif.size == size and gif.info.get('loop') == 0
        decoded_frames, delays = [], []
        for index in range(gif.n_frames):
            gif.seek(index)
            delay = gif.info['duration']
            assert delay >= frame_ms and delay % frame_ms == 0
            delays.append(delay)
            decoded_frames.extend([gif.convert('RGB')] * (delay // frame_ms))
    assert len(decoded_frames) == len(timeline)
    assert sum(delays) == len(timeline) * frame_ms

    def delta(left, right):
        return float(np.abs(np.asarray(left, dtype=np.float32) - np.asarray(right, dtype=np.float32)).mean())

    frame_changes = [delta(a, b) for a, b in zip(decoded_frames, decoded_frames[1:] + decoded_frames[:1])]
    for boundary in (0, last):
        assert frame_changes[(boundary - 1) % len(timeline)] > 0.01, 'Repeated frame before a reversal'
        assert frame_changes[boundary] > 0.01, 'Repeated frame after a reversal'
    quality_error = np.mean([delta(a, b) for a, b in zip(timeline, decoded_frames)])
    report = {
        'source': str(source.resolve()),
        'source_display_size': source_size,
        'orientation_metadata_degrees': orientation,
        'additional_rotation_or_crop': False,
        'source_frames': len(frames),
        'source_last_presentation_seconds': timestamps[-1],
        'size': size,
        'forward_seconds': last * step,
        'loop_seconds': len(timeline) * step,
        'timeline_frames': len(timeline),
        'encoded_frames': len(delays),
        'gif_frame_delays_ms': sorted(set(delays)),
        'playback_time_step_ms': frame_ms,
        'endpoint_hold_or_easing': False,
        'turnaround_changes_out_of_255': [frame_changes[-1], frame_changes[0], frame_changes[last - 1], frame_changes[last]],
        'mean_palette_error_out_of_255': round(float(quality_error), 3),
        'bytes': target.stat().st_size,
        'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
    }
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    sheet = Image.new('RGB', (size[0] * 2 + 30, (size[1] + 30) * 6), '#17191c')
    draw = ImageDraw.Draw(sheet)
    for row, index in enumerate([last // 4, last // 2, last * 3 // 4, last - 1, last, len(timeline) - 1]):
        y = row * (size[1] + 30)
        draw.text((10, y + 5), f'Video at {phase_indices[index] * step:.2f}s', fill='white')
        draw.text((size[0] + 20, y + 5), f'Decoded GIF frame {index}', fill='white')
        sheet.paste(timeline[index], (10, y + 24))
        sheet.paste(decoded_frames[index], (size[0] + 20, y + 24))
    sheet.save(report_dir / 'quality-check.png')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('target', type=Path)
    parser.add_argument('--width', type=int, default=400)
    parser.add_argument('--frame-ms', type=int, choices=(20, 30, 40, 50), default=20)
    parser.add_argument('--report-dir', type=Path, default=Path('.runtime/model-bar-boomerang'))
    args = parser.parse_args()
    if args.width <= 0:
        parser.error('--width must be positive')
    build(args.source, args.target, args.width, args.frame_ms, args.report_dir)

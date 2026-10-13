"""Convert one or more whole videos to a forward-playing GIF and first-paint poster.

Preserves presentation orientation, resolution, aspect ratio, and clip duration.
No seam blending, reversal, extra end hold, or file-size cap. GIF's centisecond
clock is distributed across frames; 30 fps avoids browser-clamped 10 ms delays.
Requires OpenCV, numpy, and Pillow.
"""

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import GifImagePlugin, Image


def build_sequence(sources: list[Path], target: Path, poster: Path, report_path: Path):
    """Join full clips in the supplied order, encoding one frame at a time.

    Use the largest presentation dimensions as the shared canvas; smaller clips
    are scaled up proportionally, never down. Memory does not grow with length.
    """
    clips = []
    for source in sources:
        capture = cv2.VideoCapture(str(source))
        if not capture.isOpened():
            raise ValueError(f'Cannot open {source}')
        fps = capture.get(cv2.CAP_PROP_FPS)
        rotation = capture.get(cv2.CAP_PROP_ORIENTATION_META)
        timestamps = []
        size = None
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            size = [frame.shape[1], frame.shape[0]]
            timestamps.append(capture.get(cv2.CAP_PROP_POS_MSEC) / 1000)
        capture.release()
        if len(timestamps) < 2 or not all(b > a for a, b in zip(timestamps, timestamps[1:])):
            raise ValueError(f'Expected increasing presentation timestamps: {source}')
        times = np.asarray(timestamps) - timestamps[0]
        duration = float(times[-1] + np.median(np.diff(times)))
        count = min(len(times), max(2, round(duration * 30)))
        indices = np.searchsorted(times, np.arange(count) * duration / count + 1e-7, side='right') - 1
        ticks = [round(index * duration * 100 / count) for index in range(count + 1)]
        delays = [(right - left) * 10 for left, right in zip(ticks, ticks[1:])]
        if min(delays) < 20:
            raise ValueError('GIF delay is too short for reliable browser playback')
        clips.append(dict(source=str(source.resolve()), size=size, source_fps=fps,
                          source_frames=len(times), source_orientation_degrees=rotation,
                          source_duration_seconds=duration, count=count, indices=indices, delays=delays))

    width, height = max(clip['size'][0] for clip in clips), max(clip['size'][1] for clip in clips)
    if any(abs(clip['size'][0] / clip['size'][1] - width / height) > 0.001 for clip in clips):
        raise ValueError('Different aspect ratios need an explicit crop/padding choice')
    target.parent.mkdir(parents=True, exist_ok=True)
    poster.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.encoding.gif')
    encoded_count = 0
    total_count = sum(clip['count'] for clip in clips)
    elapsed_ms = 0
    clip_reports = []
    with temporary.open('wb') as output:
        for clip in clips:
            start_frame, start_ms = encoded_count, elapsed_ms
            capture = cv2.VideoCapture(clip['source'])
            source_index = output_index = 0
            sample_errors = []
            while output_index < clip['count']:
                ok, frame = capture.read()
                if not ok:
                    raise ValueError('Video ended before every output frame was encoded')
                if clip['indices'][output_index] == source_index:
                    rgb = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                    if rgb.size != (width, height):
                        rgb = rgb.resize((width, height), Image.Resampling.LANCZOS)
                    if encoded_count == 0:
                        rgb.save(poster)
                    indexed = rgb.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
                    if encoded_count == 0:
                        header, _ = GifImagePlugin.getheader(indexed, info={'loop': 0, 'optimize': False})
                        for part in header:
                            output.write(part)
                    while output_index < clip['count'] and clip['indices'][output_index] == source_index:
                        delay = clip['delays'][output_index]
                        # Every frame covers the full opaque canvas. Explicit
                        # background disposal makes frames independently decodable.
                        for part in GifImagePlugin.getdata(indexed, duration=delay, disposal=2, include_color_table=True):
                            output.write(part)
                        elapsed_ms += delay
                        encoded_count += 1
                        output_index += 1
                    if output_index % 30 == 0 or output_index == clip['count']:
                        print(f'{target.name}: {encoded_count}/{total_count} frames; clip {len(clip_reports) + 1}/{len(clips)}', flush=True)
                        sample_errors.append(float(np.abs(np.asarray(rgb, dtype=np.float32) -
                                                          np.asarray(indexed.convert('RGB'), dtype=np.float32)).mean()))
                source_index += 1
            capture.release()
            clip_reports.append({key: value for key, value in clip.items() if key not in ('indices', 'delays', 'count')} | {
                'gif_start_frame': start_frame, 'gif_frames': clip['count'],
                'gif_start_seconds': start_ms / 1000, 'gif_end_seconds': elapsed_ms / 1000,
                'sample_palette_mean_error_out_of_255': round(float(np.mean(sample_errors)), 3)
            })
        output.write(b';')
    temporary.replace(target)

    actual_delays = []
    with Image.open(target) as gif:
        assert gif.size == (width, height)
        assert gif.info.get('loop') == 0
        assert gif.n_frames == total_count
        for index in range(gif.n_frames):
            gif.seek(index)
            actual_delays.append(gif.info['duration'])
    assert sum(actual_delays) == elapsed_ms
    assert min(actual_delays) >= 20
    result = {
        'clips_in_playback_order': clip_reports, 'size': [width, height],
        'gif_duration_seconds': elapsed_ms / 1000, 'gif_frames': encoded_count,
        'frame_delays_ms': sorted(set(actual_delays)), 'loop': 'forward repeat',
        'crop': False, 'downscale': False, 'extra_reverse_crossfade_or_hold': False,
        'gif_bytes': target.stat().st_size, 'poster_bytes': poster.stat().st_size,
        'gif_sha256': hashlib.file_digest(target.open('rb'), 'sha256').hexdigest(),
        'poster_sha256': hashlib.file_digest(poster.open('rb'), 'sha256').hexdigest()
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=2), flush=True)


def build(source: Path, target: Path, poster: Path, report_path: Path):
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise ValueError(f'Cannot open {source}')
    source_fps = capture.get(cv2.CAP_PROP_FPS)
    rotation = capture.get(cv2.CAP_PROP_ORIENTATION_META)
    timestamps = []
    source_size = None
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        source_size = [frame.shape[1], frame.shape[0]]
        timestamps.append(capture.get(cv2.CAP_PROP_POS_MSEC) / 1000)
    capture.release()
    if len(timestamps) < 2 or not all(b > a for a, b in zip(timestamps, timestamps[1:])):
        raise ValueError('Expected increasing video presentation timestamps')
    times = np.asarray(timestamps) - timestamps[0]
    duration = float(times[-1] + np.median(np.diff(times)))
    output_count = min(len(times), max(2, round(duration * 30)))
    output_times = np.arange(output_count) * duration / output_count
    source_indices = np.searchsorted(times, output_times + 1e-7, side='right') - 1
    centiseconds = [round(index * duration * 100 / output_count) for index in range(output_count + 1)]
    delays = [(right - left) * 10 for left, right in zip(centiseconds, centiseconds[1:])]
    if min(delays) < 20:
        raise ValueError('GIF frame delay is too short for reliable browser playback')

    # Per-frame full 256-color palettes retain detail across scene changes.
    # Store indexed frames only, keeping peak RAM well below a full RGB clip.
    capture = cv2.VideoCapture(str(source))
    encoded = []
    sample_errors = []
    output_index = 0
    source_index = 0
    target.parent.mkdir(parents=True, exist_ok=True)
    poster.parent.mkdir(parents=True, exist_ok=True)
    while output_index < output_count:
        ok, frame = capture.read()
        if not ok:
            raise ValueError('Video ended before all output frames were encoded')
        if source_indices[output_index] == source_index:
            rgb = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            if output_index == 0:
                rgb.save(poster)
            indexed = rgb.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
            while output_index < output_count and source_indices[output_index] == source_index:
                encoded.append(indexed.copy())
                output_index += 1
            if output_index % 50 == 0 or output_index == output_count:
                print(f'{target.name}: {output_index}/{output_count} frames', flush=True)
                sample_errors.append(float(np.abs(np.asarray(rgb, dtype=np.float32) -
                                                  np.asarray(indexed.convert('RGB'), dtype=np.float32)).mean()))
        source_index += 1
    capture.release()
    encoded[0].save(target, save_all=True, append_images=encoded[1:], duration=delays,
                    loop=0, disposal=1, optimize=False)
    del encoded

    with Image.open(target) as gif:
        assert list(gif.size) == source_size
        assert gif.info.get('loop') == 0
        actual_delays = []
        for index in range(gif.n_frames):
            gif.seek(index)
            actual_delays.append(gif.info['duration'])
        assert sum(actual_delays) == sum(delays)
        assert min(actual_delays) >= 20
        assert gif.n_frames > 1
        encoded_count = gif.n_frames
    result = {
        'source': str(source.resolve()), 'source_fps': source_fps, 'source_frames': len(times),
        'size': source_size, 'source_duration_seconds': duration,
        'gif_duration_seconds': sum(delays) / 1000, 'gif_frames': encoded_count,
        'frame_delays_ms': sorted(set(actual_delays)), 'loop': 'forward repeat',
        'extra_rotation_crop_resize_reverse_or_crossfade': False,
        'source_orientation_degrees': rotation,
        'sample_palette_mean_error_out_of_255': round(float(np.mean(sample_errors)), 3),
        'gif_bytes': target.stat().st_size, 'poster_bytes': poster.stat().st_size,
        'gif_sha256': hashlib.file_digest(target.open('rb'), 'sha256').hexdigest(),
        'poster_sha256': hashlib.file_digest(poster.open('rb'), 'sha256').hexdigest()
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('target', type=Path)
    parser.add_argument('poster', type=Path)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--append', action='append', default=[], type=Path,
                        help='Append another full clip after the source; repeat in playback order')
    args = parser.parse_args()
    if args.append:
        build_sequence([args.source, *args.append], args.target, args.poster, args.report)
    else:
        build(args.source, args.target, args.poster, args.report)

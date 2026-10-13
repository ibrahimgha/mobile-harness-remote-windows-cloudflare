import { useRef, useState } from "react";
import { Play, Pause, Download } from "lucide-react";

export function isAudioFile(path: string | undefined) {
  return Boolean(path && /\.(?:wav|mp3|m4a|aac|ogg|oga|opus|flac|aiff?)(?:[?#].*)?$/i.test(path));
}

export function AudioFilePlayer({ src, downloadUrl, label }: { src: string; downloadUrl: string; label: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState("");
  const time = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) { audio.pause(); return; }
    setError("");
    try { await audio.play(); }
    catch { setError("Unable to play this file. You can download it instead."); }
  };
  return <span className="chat-audio-file">
    <span className="chat-audio-title">{label}</span>
    <span className="chat-audio-controls">
      <audio ref={audioRef} src={src} preload="none"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setPosition(0); if (audioRef.current) audioRef.current.currentTime = 0; }}
        onTimeUpdate={event => setPosition(event.currentTarget.currentTime)}
        onDurationChange={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onError={() => { setPlaying(false); setError("Unable to play this file. You can download it instead."); }} />
      <button type="button" onClick={() => void toggle()} aria-label={`${playing ? "Pause" : "Play"} ${label}`}>
        {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
      </button>
      <input type="range" min={0} max={duration || 1} step={0.01} value={Math.min(position, duration || 1)}
        disabled={!duration} aria-label={`Seek ${label}`} onChange={event => {
          const next = Number(event.currentTarget.value);
          if (audioRef.current) audioRef.current.currentTime = next;
          setPosition(next);
        }} />
      <span className="chat-audio-time">{time(position)}{duration > 0 ? ` / ${time(duration)}` : ""}</span>
      <a href={downloadUrl} download aria-label={`Download ${label}`}><Download size={17} /></a>
    </span>
    {error ? <span className="chat-audio-error" role="status">{error}</span> : null}
  </span>;
}

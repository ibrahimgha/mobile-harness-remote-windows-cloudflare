import { ArrowLeft, ArrowRight, Mic, Send, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ControlRoomShortcutFeedback } from "./controlRoomShortcuts";
import "./shortcut-control-overlay.css";

export function useShortcutControlOverlay() {
  const [feedback, setFeedback] = useState<(ControlRoomShortcutFeedback & { serial: number }) | null>(null);
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<number | undefined>(undefined);
  const removeTimerRef = useRef<number | undefined>(undefined);
  const serialRef = useRef(0);

  const show = useCallback((next: ControlRoomShortcutFeedback) => {
    window.clearTimeout(hideTimerRef.current);
    window.clearTimeout(removeTimerRef.current);
    serialRef.current += 1;
    setFeedback({ ...next, serial: serialRef.current });
    setVisible(true);
    hideTimerRef.current = window.setTimeout(() => setVisible(false), 720);
    removeTimerRef.current = window.setTimeout(() => setFeedback(null), 980);
  }, []);

  useEffect(() => () => {
    window.clearTimeout(hideTimerRef.current);
    window.clearTimeout(removeTimerRef.current);
  }, []);

  return { feedback, visible, show };
}

function ActionGlyph({ feedback }: { feedback: ControlRoomShortcutFeedback }) {
  if (feedback.action === "model-left" || feedback.action === "model-right") {
    const Icon = feedback.action === "model-left" ? ArrowLeft : ArrowRight;
    return (
      <div className="shortcut-model-glyph" aria-hidden="true">
        <Icon size={84} strokeWidth={1.4} />
        <span className="shortcut-model-rail"><i /></span>
      </div>
    );
  }
  if (feedback.action === "fast-on" || feedback.action === "fast-off") {
    return <div className="shortcut-fast-glyph" aria-hidden="true"><Zap size={104} strokeWidth={1.3} /></div>;
  }
  const Icon = feedback.action === "mic-sending" ? Send : Mic;
  return <div className="shortcut-mic-glyph" aria-hidden="true"><i /><i /><Icon size={96} strokeWidth={1.25} /></div>;
}

export function ShortcutControlOverlay({
  feedback,
  visible
}: {
  feedback: (ControlRoomShortcutFeedback & { serial?: number }) | null;
  visible: boolean;
}) {
  if (!feedback) return null;
  return (
    <div className={`shortcut-control-overlay${visible ? " is-visible" : ""} is-${feedback.action}`} role="status" aria-live="polite">
      <div className="shortcut-control-vignette" />
      <div className="shortcut-control-content" key={feedback.serial}>
        <span className="shortcut-control-kicker">CONTROL INPUT</span>
        <ActionGlyph feedback={feedback} />
        <strong>{feedback.label}</strong>
      </div>
    </div>
  );
}

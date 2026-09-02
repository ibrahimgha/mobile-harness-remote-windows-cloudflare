import { MessageSquare, Triangle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import "./shortcut-control-overlay.css";

export type ChatSwitchPreview = {
  projectName: string;
  previousTitle: string;
  selectedTitle: string;
  nextTitle: string;
};

export function useChatSwitchOverlay() {
  const [preview, setPreview] = useState<(ChatSwitchPreview & { serial: number }) | null>(null);
  const [visible, setVisible] = useState(false);
  const [committing, setCommitting] = useState(false);
  const hideTimerRef = useRef<number | undefined>(undefined);
  const removeTimerRef = useRef<number | undefined>(undefined);
  const serialRef = useRef(0);

  const show = useCallback((next: ChatSwitchPreview) => {
    window.clearTimeout(hideTimerRef.current);
    window.clearTimeout(removeTimerRef.current);
    serialRef.current += 1;
    setPreview({ ...next, serial: serialRef.current });
    setCommitting(false);
    setVisible(true);
  }, []);

  const commit = useCallback(() => {
    setCommitting(true);
    hideTimerRef.current = window.setTimeout(() => setVisible(false), 520);
    removeTimerRef.current = window.setTimeout(() => {
      setPreview(null);
      setCommitting(false);
    }, 760);
  }, []);

  useEffect(() => () => {
    window.clearTimeout(hideTimerRef.current);
    window.clearTimeout(removeTimerRef.current);
  }, []);

  return { preview, visible, committing, show, commit };
}

export function ChatSwitchOverlay({
  preview,
  visible,
  committing
}: {
  preview: (ChatSwitchPreview & { serial?: number }) | null;
  visible: boolean;
  committing: boolean;
}) {
  if (!preview) return null;
  return (
    <div className={`chat-switch-overlay${visible ? " is-visible" : ""}${committing ? " is-committing" : ""}`} role="status" aria-live="polite">
      <div className="chat-switch-vignette" />
      <div className="chat-switch-panel">
        <span className="chat-switch-kicker"><MessageSquare size={18} /> Chat selector</span>
        <span className="chat-switch-project">{preview.projectName}</span>
        <div className="chat-switch-drum" key={preview.serial}>
          <span className="chat-switch-neighbor is-previous">{preview.previousTitle}</span>
          <span className="chat-switch-pointer" aria-hidden="true"><Triangle size={18} fill="currentColor" /></span>
          <strong>{preview.selectedTitle}</strong>
          <span className="chat-switch-neighbor is-next">{preview.nextTitle}</span>
        </div>
      </div>
    </div>
  );
}

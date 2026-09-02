import { Send, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { VoiceOrb, type VoiceAudioMetrics } from "./VoiceOrb";

export type DictationOverlayPhase = "starting" | "recording" | "processing";

type DictationRecordingOverlayProps = {
  projectName: string;
  chatTitle: string;
  audioMetricsRef: RefObject<VoiceAudioMetrics>;
  phase: DictationOverlayPhase;
  exitRequested?: boolean;
  onCancel: () => void;
  onSend: () => void;
};

function recordingTimeLabel(elapsedSeconds: number) {
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function DictationRecordingOverlay({
  projectName,
  chatTitle,
  audioMetricsRef,
  phase,
  exitRequested = false,
  onCancel,
  onSend
}: DictationRecordingOverlayProps) {
  const overlayRef = useRef<HTMLElement | null>(null);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : document.activeElement instanceof HTMLElement ? document.activeElement : null
  );
  const recordingStartedAtRef = useRef<number | null>(null);
  const [entered, setEntered] = useState(false);
  const [entranceSettled, setEntranceSettled] = useState(false);
  const [timerVisible, setTimerVisible] = useState(false);
  const [loadAnimatedOrb, setLoadAnimatedOrb] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [sendRequested, setSendRequested] = useState(false);
  const [closing, setClosing] = useState(false);
  const isClosing = closing || exitRequested;
  const displayPhase: DictationOverlayPhase = phase === "processing" || sendRequested ? "processing" : phase;

  const requestCancel = useCallback(() => {
    if (closingRef.current || exitRequested || displayPhase === "processing") return;

    closingRef.current = true;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(onCancel, 460);
  }, [displayPhase, exitRequested, onCancel]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current);
    },
    []
  );

  useEffect(() => {
    let secondFrame = 0;
    let entranceTimer = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setEntered(true);
        entranceTimer = window.setTimeout(() => setEntranceSettled(true), 460);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      if (entranceTimer) window.clearTimeout(entranceTimer);
    };
  }, []);

  useEffect(() => {
    if (!entranceSettled || displayPhase !== "recording") return;

    // The full-quality animation is intentionally very large. Let the overlay
    // and timer finish their compositor-only fades before asking the browser to
    // decode it; the lightweight poster keeps the orb visible in the meantime.
    const timer = window.setTimeout(() => setLoadAnimatedOrb(true), 380);
    return () => window.clearTimeout(timer);
  }, [displayPhase, entranceSettled]);

  useEffect(() => {
    if (!entranceSettled || displayPhase !== "recording") {
      setTimerVisible(false);
      return;
    }

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setTimerVisible(true));
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [displayPhase, entranceSettled]);

  useEffect(() => {
    if (displayPhase !== "recording") return;

    recordingStartedAtRef.current ??= Date.now();
    const updateElapsed = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - (recordingStartedAtRef.current ?? Date.now())) / 1000)));
    };
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(interval);
  }, [displayPhase]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && displayPhase !== "processing") {
        event.preventDefault();
        requestCancel();
        return;
      }

      if (event.key !== "Tab") return;
      const overlay = overlayRef.current;
      if (!overlay) return;
      const controls = Array.from(overlay.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      if (!controls.length) {
        event.preventDefault();
        overlay.focus({ preventScroll: true });
        return;
      }

      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyboard, true);
    return () => window.removeEventListener("keydown", handleKeyboard, true);
  }, [displayPhase, requestCancel]);

  useEffect(() => {
    const overlay = overlayRef.current;
    const parent = overlay?.parentElement;
    if (!overlay || !parent) return;

    const siblings = Array.from(parent.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child !== overlay);
    const previousInert = siblings.map((element) => element.inert);
    siblings.forEach((element) => {
      element.inert = true;
    });

    return () => {
      siblings.forEach((element, index) => {
        element.inert = previousInert[index] ?? false;
      });
      returnFocusRef.current?.focus({ preventScroll: true });
    };
  }, []);

  const requestSend = () => {
    if (displayPhase !== "recording") return;
    setSendRequested(true);
    onSend();
  };

  const destination = [projectName, chatTitle].filter(Boolean).join(", ");
  const statusText =
    displayPhase === "starting"
      ? "Starting microphone"
      : displayPhase === "recording"
        ? "Recording voice prompt"
        : "Processing voice prompt";

  return (
    <section
      ref={overlayRef}
      className={`dictation-recording-overlay is-${displayPhase}${entered ? " is-entered" : ""}${timerVisible ? " is-timer-visible" : ""}${isClosing ? " is-closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dictation-recording-title"
      aria-describedby="dictation-recording-description"
      aria-busy={displayPhase !== "recording" || isClosing}
      tabIndex={-1}
    >
      <h2 id="dictation-recording-title" className="dictation-visually-hidden">
        {statusText}
      </h2>
      <p id="dictation-recording-description" className="dictation-visually-hidden">
        {destination ? `Voice prompt for ${destination}.` : "Voice prompt for the current chat."}
      </p>

      <div className="dictation-recording-stage">
        <div className="dictation-orb-shell">
          <VoiceOrb audioMetricsRef={audioMetricsRef} phase={displayPhase} loadAnimatedAsset={loadAnimatedOrb} />
          <time
            className="dictation-recording-timer"
            dateTime={`PT${elapsedSeconds}S`}
            aria-hidden={displayPhase !== "recording"}
          >
            {recordingTimeLabel(elapsedSeconds)}
          </time>
        </div>
      </div>

      <span className="dictation-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {statusText}
      </span>

      {displayPhase !== "processing" ? (
        <div className="dictation-recording-actions">
          <button className="dictation-overlay-cancel" type="button" onClick={requestCancel} disabled={isClosing} aria-label="Cancel voice recording" title="Cancel">
            <X size={24} aria-hidden="true" />
          </button>
          <button
            className="dictation-overlay-send"
            type="button"
            onClick={requestSend}
            disabled={displayPhase !== "recording" || isClosing}
            aria-label="Send voice prompt"
            title="Send"
          >
            <Send size={22} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </section>
  );
}

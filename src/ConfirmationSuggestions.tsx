import { useRef, useState } from "react";
import type { PendingConfirmation } from "../shared/confirmation";

type Props = {
  request: PendingConfirmation;
  chatId: string;
  disabled: boolean;
  onAccept: () => Promise<void>;
  onDismiss: () => Promise<void>;
  focusComposer: () => void;
};

export function ConfirmationSuggestions({ request, chatId, disabled, onAccept, onDismiss, focusComposer }: Props) {
  const key = `confirmation-dismissed:${chatId}:${request.id}`;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  function hide() {
    setHidden(true);
    try { localStorage.setItem(key, "1"); } catch { /* Server persists the decision too. */ }
  }
  if (hidden) return null;
  return <div className="confirmation-suggestions" aria-label="Worker requests confirmation">
    <div className="confirmation-actions" title={request.summary}>
      <button type="button" disabled={disabled || busy} onClick={async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setError("");
        try { await onAccept(); hide(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send confirmation"); }
        finally { inFlight.current = false; setBusy(false); }
      }} aria-label={`1: Send ${request.reply}`}>
        <span className="confirmation-number">1</span>
        <span>{busy ? "Sending…" : request.reply.charAt(0).toUpperCase() + request.reply.slice(1)}</span>
      </button>
      <button type="button" disabled={disabled || busy} onClick={() => {
        // Keep focus inside this user gesture: delayed focus cannot open iOS keyboards.
        focusComposer();
        hide();
        void onDismiss().catch(() => { /* Local dismissal survives offline/reload. */ });
      }} aria-label="2: Reply myself">
        <span className="confirmation-number">2</span><span>Reply myself</span>
      </button>
    </div>
    {error ? <small role="alert" className="confirmation-error">{error}</small> : null}
  </div>;
}

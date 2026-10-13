import { ArrowLeft, ArrowRight, GripVertical } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { moveQueuedId, sameQueueOrder } from "../shared/queueOrder";

type QueueJob = { id: string; status: string; promptPreview: string };
type Drag = {
  id: string; pointerId: number; pointerType: string; startX: number; startY: number;
  x: number; y: number; grabOffset: number; original: string[]; order: string[];
  active: boolean; moved: boolean; hold?: number; frame?: number; lastFrame: number;
};

export function ReorderableQueue<T extends QueueJob>({ jobs, enabled, onReorder, children }: {
  jobs: T[];
  enabled: boolean;
  onReorder: (jobIds: string[], expectedOrder: string[]) => Promise<void>;
  children: (job: T, index: number, handle: ReactNode, locked: boolean) => ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const ignoreClickUntil = useRef(0);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const ids = jobs.map((job) => job.id);
  const orderKey = JSON.stringify(ids);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const ordered = preview && preview.length === jobs.length && preview.every((id) => ids.includes(id))
    ? preview.map((id) => jobs.find((job) => job.id === id)!) : jobs;
  const canReorder = enabled && jobs.length > 1 && !saving;

  function releaseDrag() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.hold !== undefined) window.clearTimeout(drag.hold);
    if (drag?.frame !== undefined) window.cancelAnimationFrame(drag.frame);
    const list = listRef.current;
    if (drag && list?.hasPointerCapture(drag.pointerId)) list.releasePointerCapture(drag.pointerId);
    list?.querySelectorAll<HTMLElement>("[data-queue-id]").forEach((card) => card.style.removeProperty("--queue-drag-x"));
  }

  function cancelDrag(notice = "Reordering cancelled") {
    if (!dragRef.current) return;
    releaseDrag();
    setDragging(null);
    setPreview(null);
    setMessage(notice);
  }

  useEffect(() => {
    const drag = dragRef.current;
    if (drag && (!enabled || !sameQueueOrder(drag.original, idsRef.current))) {
      cancelDrag("The queue changed. Please reorder the updated list.");
    }
  }, [orderKey, enabled]);

  useEffect(() => {
    mountedRef.current = true;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { cancelDrag(); setMenu(null); } };
    const blur = () => cancelDrag();
    const visibility = () => { if (document.hidden) cancelDrag(); };
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mountedRef.current = false;
      releaseDrag();
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  async function save(order: string[], original: string[]) {
    if (savingRef.current || sameQueueOrder(order, original)) { setPreview(null); return; }
    savingRef.current = true;
    setSaving(true);
    setPreview(order);
    setMenu(null);
    setMessage("Saving queue order…");
    try {
      await onReorder(order, original);
      if (mountedRef.current) setMessage("Queue order saved");
    } catch (error) {
      if (mountedRef.current) setMessage(error instanceof Error ? error.message : "Could not save the order. Please try again.");
    } finally {
      savingRef.current = false;
      if (mountedRef.current) { setPreview(null); setSaving(false); }
    }
  }

  function move(id: string, index: number) {
    if (!canReorder || dragRef.current) return;
    void save(moveQueuedId(ids, id, index), ids);
  }

  function paintDrag() {
    const drag = dragRef.current, list = listRef.current;
    if (!drag?.active || !list) return;
    const card = [...list.querySelectorAll<HTMLElement>("[data-queue-id]")].find((item) => item.dataset.queueId === drag.id);
    if (!card) return;
    const left = drag.x - list.getBoundingClientRect().left + list.scrollLeft - drag.grabOffset;
    card.style.setProperty("--queue-drag-x", `${left - card.offsetLeft}px`);
  }
  useLayoutEffect(paintDrag, [preview, dragging]);

  function frame(now: number) {
    const drag = dragRef.current, list = listRef.current;
    if (!drag?.active || !list) return;
    const rect = list.getBoundingClientRect();
    const elapsed = Math.min(32, now - drag.lastFrame);
    drag.lastFrame = now;
    const withinRow = drag.y >= rect.top - 35 && drag.y <= rect.bottom + 35;
    if (withinRow) {
      const edge = Math.min(48, rect.width / 5);
      const velocity = drag.x < rect.left + edge ? -Math.min(1, (rect.left + edge - drag.x) / edge)
        : drag.x > rect.right - edge ? Math.min(1, (drag.x - rect.right + edge) / edge) : 0;
      if (drag.moved) list.scrollLeft += velocity * elapsed * 0.65;
      const cards = [...list.querySelectorAll<HTMLElement>("[data-queue-id]")];
      const card = cards.find((item) => item.dataset.queueId === drag.id);
      if (card && drag.moved) {
        const center = drag.x - rect.left + list.scrollLeft - drag.grabOffset + card.offsetWidth / 2;
        const index = cards.filter((item) => item !== card && center > item.offsetLeft + item.offsetWidth / 2).length;
        const next = moveQueuedId(drag.order, drag.id, index);
        if (!sameQueueOrder(next, drag.order)) { drag.order = next; setPreview(next); }
      }
    }
    paintDrag();
    drag.frame = window.requestAnimationFrame(frame);
  }

  function begin(event: PointerEvent<HTMLButtonElement>, job: T) {
    if (!canReorder || savingRef.current || dragRef.current || !event.isPrimary || event.button !== 0) return;
    const card = event.currentTarget.closest<HTMLElement>("[data-queue-id]")!;
    const drag: Drag = {
      id: job.id, pointerId: event.pointerId, pointerType: event.pointerType,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      grabOffset: event.clientX - card.getBoundingClientRect().left,
      original: [...ids], order: [...ids], active: false, moved: false, lastFrame: performance.now()
    };
    dragRef.current = drag;
    const activate = () => {
      if (dragRef.current !== drag || !sameQueueOrder(drag.original, idsRef.current)) return;
      drag.active = true;
      // Capture on the stable list, not a card which will move in the DOM.
      listRef.current?.setPointerCapture(drag.pointerId);
      setDragging(job.id);
      setPreview(drag.order);
      setMenu(null);
      setMessage("Drag left or right. Release to save; Escape cancels.");
      drag.frame = window.requestAnimationFrame(frame);
    };
    if (event.pointerType === "touch") drag.hold = window.setTimeout(activate, 350);
    else { event.preventDefault(); activate(); }
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 8) {
      if (!drag.active) { cancelDrag(""); return; }
      drag.moved = true;
    }
    if (drag.active) event.preventDefault();
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const rect = listRef.current!.getBoundingClientRect();
    const inside = event.clientY >= rect.top - 35 && event.clientY <= rect.bottom + 35 &&
      event.clientX >= rect.left - 35 && event.clientX <= rect.right + 35;
    releaseDrag();
    setDragging(null);
    if (!drag.active) return; // A short touch remains a normal tap on the handle.
    ignoreClickUntil.current = Date.now() + 500;
    if (!inside || !sameQueueOrder(idsRef.current, drag.original)) {
      setPreview(null); setMessage("Reordering cancelled; the queue was not changed.");
    } else if (sameQueueOrder(drag.order, drag.original)) {
      setPreview(null); setMessage("");
      if (!drag.moved) setMenu((current) => current === drag.id ? null : drag.id);
    } else void save(drag.order, drag.original);
  }

  return <>
    <div ref={listRef} className={`queue-list${dragging ? " is-reordering" : ""}`} aria-label="Selected chat command queue" aria-busy={saving}
      onPointerMove={pointerMove} onPointerUp={end} onPointerCancel={() => cancelDrag()}
      onLostPointerCapture={(event) => { if (event.target === listRef.current && dragRef.current?.active) cancelDrag(); }}
      onPointerLeave={() => { if (dragRef.current && !dragRef.current.active) cancelDrag(""); }}>
      {ordered.map((job, index) => {
        const locked = saving || Boolean(dragging);
        const handle = enabled && jobs.length > 1 ? <button type="button" className="queue-drag-handle" disabled={saving}
          aria-label={`Reorder queued prompt ${index + 1}`} aria-expanded={menu === job.id}
          title="Drag to reorder (hold first on touch). Tap for move buttons, or use Left/Right arrow keys."
          onPointerDown={(event) => begin(event, job)} onContextMenu={(event) => event.preventDefault()}
          onClick={() => { if (Date.now() >= ignoreClickUntil.current) setMenu((current) => current === job.id ? null : job.id); }}
          onKeyDown={(event) => {
            const target = event.key === "ArrowLeft" || event.key === "ArrowUp" ? index - 1
              : event.key === "ArrowRight" || event.key === "ArrowDown" ? index + 1
              : event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1 : null;
            if (target !== null) { event.preventDefault(); event.stopPropagation(); move(job.id, target); }
          }}><GripVertical size={18} /></button> : null;
        return <article key={job.id} data-queue-id={job.id} className={`queue-item is-${job.status}${dragging === job.id ? " is-dragging" : ""}`}>
          {children(job, index, handle, locked)}
          {menu === job.id && canReorder && !dragging ? <div className="queue-move-actions">
            <button type="button" disabled={index === 0} onClick={() => move(job.id, index - 1)}><ArrowLeft size={14} /> Move earlier</button>
            <button type="button" disabled={index === ordered.length - 1} onClick={() => move(job.id, index + 1)}><ArrowRight size={14} /> Move later</button>
          </div> : null}
        </article>;
      })}
    </div>
    <p className="queue-reorder-feedback" role="status" aria-live="polite">{message || (enabled && jobs.length > 1 ? "Drag the grip to reorder · hold first on touch" : "")}</p>
  </>;
}

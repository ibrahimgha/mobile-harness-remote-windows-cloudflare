export type PrependScrollSnapshot = {
  chatId: string;
  scrollHeight: number;
  scrollTop: number;
  anchorRenderKey?: string;
  anchorOffset?: number;
  scroller?: HTMLElement;
};

export function transcriptScrollElements(container: HTMLElement) {
  // CSS gives the transcript one scroll owner on every browser. Never include
  // the document sentinel, composer, code blocks, or a second inner scroll view.
  return [container];
}

export function scrollTranscriptToTop(container: HTMLElement) {
  container.scrollTo({ top: 0, left: container.scrollLeft, behavior: "instant" });
  return container;
}

export type TranscriptScrollAnimation = {
  readonly active: boolean;
  cancel: () => void;
};

type TranscriptScrollAnimationOptions = {
  durationMs?: number;
  shouldContinue?: () => boolean;
  onScroll?: () => void;
  onComplete?: () => void;
};

/**
 * Animate the transcript itself rather than invoking WebKit's native smooth
 * scrolling. This keeps top and bottom navigation visually identical while
 * avoiding a second compositor animation alongside iOS' status-bar gesture.
 */
export function animateTranscriptScroll(
  container: HTMLElement,
  requestedTop: number,
  options: TranscriptScrollAnimationOptions = {}
): TranscriptScrollAnimation {
  const view = container.ownerDocument.defaultView;
  const duration = Math.max(1, options.durationMs ?? 420);
  const start = container.scrollTop;
  const maximum = Math.max(0, container.scrollHeight - container.clientHeight);
  const destination = Math.min(maximum, Math.max(0, requestedTop));
  const distance = destination - start;
  let active = true;
  let frame: number | undefined;
  let startedAt: number | undefined;

  const cancel = () => {
    if (!active) return;
    active = false;
    if (frame !== undefined) view?.cancelAnimationFrame(frame);
  };
  const finish = () => {
    if (!active) return;
    container.scrollTop = destination;
    options.onScroll?.();
    active = false;
    options.onComplete?.();
  };

  if (!view || Math.abs(distance) < 1) {
    finish();
    return { get active() { return active; }, cancel };
  }

  const step = (timestamp: number) => {
    if (!active) return;
    if (options.shouldContinue && !options.shouldContinue()) {
      cancel();
      return;
    }
    startedAt ??= timestamp;
    const progress = Math.min(1, Math.max(0, (timestamp - startedAt) / duration));
    const eased = progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    container.scrollTop = start + distance * eased;
    options.onScroll?.();
    if (progress >= 1) finish();
    else frame = view.requestAnimationFrame(step);
  };
  frame = view.requestAnimationFrame(step);
  return { get active() { return active; }, cancel };
}

export function restoredPrependScrollTop(
  snapshot: Pick<PrependScrollSnapshot, "scrollHeight" | "scrollTop" | "anchorOffset">,
  currentScrollTop: number,
  currentScrollHeight: number,
  currentAnchorOffset?: number
) {
  if (snapshot.anchorOffset !== undefined && currentAnchorOffset !== undefined) {
    return Math.max(0, currentScrollTop + currentAnchorOffset - snapshot.anchorOffset);
  }

  return Math.max(0, snapshot.scrollTop + currentScrollHeight - snapshot.scrollHeight);
}

function renderedMessageElements(scroller: HTMLElement) {
  return Array.from(scroller.querySelectorAll<HTMLElement>("[data-render-key]"))
    .filter((element) => element.getBoundingClientRect().height > 0);
}

function scrollViewportTop(scroller: HTMLElement) {
  return scroller === scroller.ownerDocument.scrollingElement ? 0 : scroller.getBoundingClientRect().top + scroller.clientTop;
}

export function capturePrependScrollSnapshot(scroller: HTMLElement, chatId: string): PrependScrollSnapshot {
  const scrollerTop = scrollViewportTop(scroller);
  const anchor = renderedMessageElements(scroller)
    .find((element) => element.getBoundingClientRect().bottom > scrollerTop + 1);

  return {
    chatId,
    scroller,
    scrollHeight: scroller.scrollHeight,
    scrollTop: scroller.scrollTop,
    anchorRenderKey: anchor?.dataset.renderKey,
    anchorOffset: anchor ? anchor.getBoundingClientRect().top - scrollerTop : undefined
  };
}

export function restorePrependScrollSnapshot(scroller: HTMLElement, snapshot: PrependScrollSnapshot) {
  const scrollerTop = scrollViewportTop(scroller);
  const anchor = snapshot.anchorRenderKey
    ? renderedMessageElements(scroller).find((element) => element.dataset.renderKey === snapshot.anchorRenderKey)
    : undefined;
  const currentAnchorOffset = anchor ? anchor.getBoundingClientRect().top - scrollerTop : undefined;

  scroller.scrollTop = restoredPrependScrollTop(
    snapshot,
    scroller.scrollTop,
    scroller.scrollHeight,
    currentAnchorOffset
  );
}

export type PrependScrollKeeper = { readonly active: boolean; stop: () => void };

export function keepPrependScrollAnchor(
  scroller: HTMLElement,
  snapshot: PrependScrollSnapshot,
  onRestore: () => void = () => undefined
): PrependScrollKeeper {
  const view = scroller.ownerDocument.defaultView;
  let active = true;
  let frame: number | undefined;
  let timeout: number | undefined;
  const settlingTimers: number[] = [];
  let observer: ResizeObserver | undefined;
  const inputEvents = ["wheel", "touchmove", "pointerdown", "keydown"] as const;
  const stop = () => {
    if (!active) return;
    active = false;
    if (frame !== undefined) view?.cancelAnimationFrame(frame);
    if (timeout !== undefined) view?.clearTimeout(timeout);
    for (const timer of settlingTimers) view?.clearTimeout(timer);
    observer?.disconnect();
    scroller.removeEventListener("load", restore, true);
    for (const event of inputEvents) view?.removeEventListener(event, stop, true);
  };
  function restore() {
    if (!active) return;
    if (!scroller.isConnected) { stop(); return; }
    restorePrependScrollSnapshot(scroller, snapshot);
    onRestore();
  }

  // Called from a layout effect: restore synchronously before the first paint.
  restore();
  if (active && view) {
    frame = view.requestAnimationFrame(restore);
    // WebKit can apply a deferred scroll adjustment after the first paint,
    // without resizing anything. Preserve the anchor through that short
    // settling period; the input listeners below cancel every correction.
    for (const delay of [80, 300, 900]) settlingTimers.push(view.setTimeout(restore, delay));
    const content = scroller.querySelector(".chat-thread") ?? scroller.firstElementChild;
    if (content && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(restore);
      observer.observe(content);
    }
    // Older screenshots, rich content and fonts may size themselves after the
    // fetch completes. Follow those layout changes, but never fight user input.
    scroller.addEventListener("load", restore, true);
    for (const event of inputEvents) view.addEventListener(event, stop, { capture: true, passive: true });
    timeout = view.setTimeout(stop, 10_000);
  }
  return { get active() { return active; }, stop };
}

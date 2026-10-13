/** Keep the phone app inside the visible area above the native keyboard.
 * Viewport units and fixed positioning alone use WebKit's layout viewport,
 * which can remain full-height while the keyboard covers its bottom half.
 */
export function installMobileViewport(view: Window) {
  const viewport = view.visualViewport;
  if (!viewport) return () => {};
  const root = view.document.documentElement;
  const flag = root.getAttribute("data-mobile-viewport");
  const properties = ["--app-height", "--app-viewport-top"] as const;
  const previous = properties.map(name => ({ name, value: root.style.getPropertyValue(name), priority: root.style.getPropertyPriority(name) }));
  let frame: number | undefined;
  const settleTimers = new Set<number>();
  let watchdog: number | undefined;
  let disposed = false;
  const isEditableFocused = () => {
    const active = view.document.activeElement as HTMLElement | null;
    if (!active) return false;
    const tagName = active.tagName?.toLowerCase();
    return tagName === "input" || tagName === "textarea" || active.isContentEditable;
  };
  const update = () => {
    frame = undefined;
    if (disposed || viewport.height <= 0 || Math.abs(viewport.scale - 1) > 0.01) return;
    const layoutHeight = Math.max(root.clientHeight || 0, view.innerHeight || 0);
    const staleKeyboardViewport = !isEditableFocused()
      && layoutHeight > 0
      && viewport.height < layoutHeight * 0.72;
    const visibleHeight = staleKeyboardViewport ? layoutHeight : viewport.height;
    const visibleTop = staleKeyboardViewport ? 0 : Math.max(0, viewport.offsetTop);
    // Follow the visual viewport without scrolling or refocusing the editor.
    // That preserves caret/selection and iOS's native long-press Paste menu.
    // If WebKit misses the final keyboard-close resize, reject the obviously
    // stale half-height viewport once focus has left the editor.
    root.style.setProperty("--app-height", `${visibleHeight}px`);
    root.style.setProperty("--app-viewport-top", `${visibleTop}px`);
    root.setAttribute("data-mobile-viewport", "true");
  };
  const schedule = () => {
    if (frame === undefined) frame = view.requestAnimationFrame(update);
  };
  const settle = () => {
    schedule();
    for (const timer of settleTimers) view.clearTimeout(timer);
    settleTimers.clear();
    for (const delay of [80, 240, 600, 1200]) {
      const timer = view.setTimeout(() => {
        settleTimers.delete(timer);
        schedule();
      }, delay);
      settleTimers.add(timer);
    }
  };
  viewport.addEventListener("resize", schedule, { passive: true });
  viewport.addEventListener("scroll", schedule, { passive: true });
  view.addEventListener("resize", settle, { passive: true });
  view.addEventListener("orientationchange", settle, { passive: true });
  view.addEventListener("pageshow", settle);
  view.addEventListener("pointerup", settle, { passive: true, capture: true });
  view.document.addEventListener("focusin", settle);
  view.document.addEventListener("focusout", settle);
  view.document.addEventListener("visibilitychange", settle);
  // WebKit occasionally updates visualViewport without delivering its final
  // resize event. This inexpensive check makes the CSS state self-healing.
  watchdog = view.setInterval(() => {
    if (view.document.visibilityState !== "hidden") schedule();
  }, 1000);
  update();
  return () => {
    disposed = true;
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    for (const timer of settleTimers) view.clearTimeout(timer);
    settleTimers.clear();
    if (watchdog !== undefined) view.clearInterval(watchdog);
    viewport.removeEventListener("resize", schedule);
    viewport.removeEventListener("scroll", schedule);
    view.removeEventListener("resize", settle);
    view.removeEventListener("orientationchange", settle);
    view.removeEventListener("pageshow", settle);
    view.removeEventListener("pointerup", settle, { capture: true });
    view.document.removeEventListener("focusin", settle);
    view.document.removeEventListener("focusout", settle);
    view.document.removeEventListener("visibilitychange", settle);
    if (flag === null) root.removeAttribute("data-mobile-viewport");
    else root.setAttribute("data-mobile-viewport", flag);
    for (const { name, value, priority } of previous) {
      if (value) root.style.setProperty(name, value, priority);
      else root.style.removeProperty(name);
    }
  };
}

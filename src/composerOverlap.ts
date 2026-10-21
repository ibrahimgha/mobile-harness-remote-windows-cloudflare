/** Let messages pass behind the mobile fade, reserving the real draft height at
 * the end of the transcript so the final message can still scroll into view. */
export function installComposerOverlap(workspace: HTMLElement, composer: HTMLElement, scroller: HTMLElement) {
  // Keep the non-overlapping fallback on engines without size observation.
  if (typeof ResizeObserver === "undefined") return () => {};
  const mobile = window.matchMedia("(max-width: 920px)");
  let previousHeight = -1;
  let disposed = false;
  const reset = () => {
    workspace.removeAttribute("data-composer-overlap");
    workspace.style.removeProperty("--mobile-composer-height");
    previousHeight = -1;
  };
  const measure = () => {
    if (disposed) return;
    if (!mobile.matches) { reset(); return; }
    const height = Math.ceil(composer.getBoundingClientRect().height);
    if (height <= 0) { reset(); return; }
    if (height === previousHeight) return;
    const atBottom = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 1;
    previousHeight = height;
    workspace.style.setProperty("--mobile-composer-height", `${height}px`);
    workspace.setAttribute("data-composer-overlap", "true");
    if (atBottom) scroller.scrollTop = scroller.scrollHeight;
  };
  const observer = new ResizeObserver(measure);
  observer.observe(composer);
  mobile.addEventListener("change", measure);
  measure();
  return () => {
    disposed = true;
    observer.disconnect();
    mobile.removeEventListener("change", measure);
    reset();
  };
}

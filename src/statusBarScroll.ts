export function supportsStatusBarScrollBridge(navigator: Pick<Navigator, "userAgent" | "maxTouchPoints"> & { standalone?: boolean }, standalone: boolean) {
  const ios = /iP(?:hone|ad|od)/.test(navigator.userAgent)
    || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  return ios && (standalone || navigator.standalone === true);
}

/**
 * iOS sends its native status-bar gesture to the page's scroll view, not to
 * our nested chat panel. A one-pixel document scroll range lets that gesture
 * reach us while the fixed app itself stays in exactly the same position.
 */
export function installStatusBarScrollBridge(view: Window, scrollToTop: () => void) {
  const root = view.document.documentElement;
  const previousFlag = root.getAttribute("data-status-bar-scroll");
  const previousScroll = view.scrollY;
  let disposed = false;
  let armed = false;
  let timer: number | undefined;
  let suppressUntil = 0;
  const arm = () => {
    if (disposed || view.document.visibilityState === "hidden") return;
    // WebKit pans the page to reveal a focused editor. Resetting that offset
    // after 550 ms makes the composer fall behind the still-open keyboard.
    // Retain an existing native gesture offset without moving the caret or
    // dismissing/repositioning the native Paste selection popover.
    if (view.document.activeElement?.matches("input, textarea, [contenteditable=true]")) {
      armed = view.scrollY > 0;
      return;
    }
    view.scrollTo({ top: 1, left: 0, behavior: "instant" });
    armed = view.scrollY > 0;
  };
  const scheduleArm = (delay = 600) => {
    if (timer !== undefined) view.clearTimeout(timer);
    timer = view.setTimeout(arm, delay);
  };
  const onScroll = () => {
    if (view.scrollY > 0) return;
    const navigate = armed && Date.now() >= suppressUntil;
    armed = false;
    if (navigate) scrollToTop();
    // UIKit continues its status-bar animation after JS first observes zero.
    // Re-arming at 80 ms fought that animation (0 -> 1 -> 0 repeatedly),
    // generating duplicate top requests and corrupting WebKit scroll tiles.
    // One gesture stays disarmed until the native scroll has been quiet.
    scheduleArm();
  };
  const onViewportChange = () => {
    // Keyboard/rotation/restoration can also reset the document offset. Those
    // changes must never be mistaken for the user's status-bar gesture.
    armed = false;
    suppressUntil = Date.now() + 500;
    scheduleArm(550);
  };
  const onEditorFocusChange = (event: Event) => {
    const target = event.target as Element | null;
    // A down-arrow/button tap does not open the keyboard. Suppressing the
    // bridge for every focus event drops a status-bar tap immediately after it.
    if (target && typeof target.matches === "function"
      && target.matches("input, textarea, [contenteditable=true]")) onViewportChange();
  };
  root.setAttribute("data-status-bar-scroll", "true");
  view.addEventListener("scroll", onScroll, { passive: true });
  view.addEventListener("resize", onViewportChange, { passive: true });
  view.addEventListener("pageshow", onViewportChange);
  view.visualViewport?.addEventListener("resize", onViewportChange, { passive: true });
  view.document.addEventListener("focusin", onEditorFocusChange);
  view.document.addEventListener("focusout", onEditorFocusChange);
  view.document.addEventListener("visibilitychange", onViewportChange);
  scheduleArm(80);
  return () => {
    disposed = true;
    if (timer !== undefined) view.clearTimeout(timer);
    view.removeEventListener("scroll", onScroll);
    view.removeEventListener("resize", onViewportChange);
    view.removeEventListener("pageshow", onViewportChange);
    view.visualViewport?.removeEventListener("resize", onViewportChange);
    view.document.removeEventListener("focusin", onEditorFocusChange);
    view.document.removeEventListener("focusout", onEditorFocusChange);
    view.document.removeEventListener("visibilitychange", onViewportChange);
    if (previousFlag === null) root.removeAttribute("data-status-bar-scroll");
    else root.setAttribute("data-status-bar-scroll", previousFlag);
    view.scrollTo({ top: previousScroll, left: 0, behavior: "instant" });
  };
}

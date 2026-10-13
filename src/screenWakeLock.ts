export type ScreenWakeLockStatus = "requesting" | "active" | "paused" | "unavailable" | "unsupported";

/** Keep one visible recording popup awake, without playing media or polling. */
export function keepScreenAwake(view: Window, onStatus: (status: ScreenWakeLockStatus) => void) {
  const page = view.document;
  const wakeLock = view.navigator.wakeLock;
  let stopped = false;
  let pageHidden = false;
  let generation = 0;
  let pending = false;
  let sentinel: WakeLockSentinel | null = null;
  let releaseListener: (() => void) | null = null;
  let status: ScreenWakeLockStatus | undefined;

  const visible = () => !pageHidden && page.visibilityState === "visible";
  const report = (next: ScreenWakeLockStatus) => {
    if (stopped || status === next) return;
    status = next;
    onStatus(next);
  };
  const release = async (lock: WakeLockSentinel) => {
    try {
      await lock.release();
    } catch {
      // A browser may already have released the lock when the page was hidden.
    }
  };
  const releaseCurrent = () => {
    const lock = sentinel;
    sentinel = null;
    if (lock && releaseListener) lock.removeEventListener("release", releaseListener);
    releaseListener = null;
    if (lock) void release(lock);
  };

  const request = async () => {
    if (stopped) return;
    if (!visible()) {
      report("paused");
      return;
    }
    if (!wakeLock?.request) {
      report("unsupported");
      return;
    }
    if (sentinel && !sentinel.released) return;
    if (pending) return;

    pending = true;
    const requestedGeneration = generation;
    report("requesting");
    try {
      const lock = await wakeLock.request("screen");
      // Cancel/start and hide/show can race an outstanding browser request.
      // Never retain a late lock belonging to an old popup or visibility cycle.
      if (stopped || requestedGeneration !== generation || !visible()) {
        void release(lock);
        return;
      }
      if (lock.released) {
        report("unavailable");
        return;
      }
      releaseCurrent();
      sentinel = lock;
      releaseListener = () => {
        if (sentinel !== lock) return;
        lock.removeEventListener("release", releaseListener!);
        sentinel = null;
        releaseListener = null;
        // Respect battery/power policy; retry on foreground return or an
        // explicit tap, not a busy loop fighting an OS-initiated release.
        report(visible() ? "unavailable" : "paused");
      };
      lock.addEventListener("release", releaseListener);
      report("active");
    } catch {
      if (requestedGeneration === generation && visible()) report("unavailable");
    } finally {
      pending = false;
      if (!stopped && requestedGeneration !== generation && visible()) void request();
    }
  };

  const pause = () => {
    generation += 1;
    releaseCurrent();
    report("paused");
  };
  const onVisibility = () => {
    if (page.visibilityState === "visible") {
      pageHidden = false;
      void request();
    } else {
      pause();
    }
  };
  const onPageHide = () => {
    pageHidden = true;
    pause();
  };
  const onPageShow = () => {
    pageHidden = false;
    void request();
  };
  const onFocus = () => { void request(); };
  page.addEventListener("visibilitychange", onVisibility);
  view.addEventListener("pagehide", onPageHide);
  view.addEventListener("pageshow", onPageShow);
  view.addEventListener("focus", onFocus);
  void request();

  return {
    retry: () => { void request(); },
    stop: () => {
      if (stopped) return;
      stopped = true;
      generation += 1;
      page.removeEventListener("visibilitychange", onVisibility);
      view.removeEventListener("pagehide", onPageHide);
      view.removeEventListener("pageshow", onPageShow);
      view.removeEventListener("focus", onFocus);
      releaseCurrent();
    }
  };
}

type SurfaceStyle = Pick<CSSStyleDeclaration, "getPropertyValue" | "getPropertyPriority" | "setProperty" | "removeProperty">;

function restoreProperty(style: SurfaceStyle, property: string, value: string, priority: string) {
  if (value) style.setProperty(property, value, priority);
  else style.removeProperty(property);
}

/** Match the system-owned PWA status-bar area to a fullscreen app surface. */
export function applySystemSurface(document: Document, color: string) {
  const root = document.documentElement;
  const body = document.body;
  const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const previousTheme = theme?.getAttribute("content") ?? null;
  const previousRootColor = root.style.getPropertyValue("background-color");
  const previousRootPriority = root.style.getPropertyPriority("background-color");
  const previousBodyColor = body.style.getPropertyValue("background-color");
  const previousBodyPriority = body.style.getPropertyPriority("background-color");

  root.style.setProperty("background-color", color);
  body.style.setProperty("background-color", color);
  theme?.setAttribute("content", color);

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    restoreProperty(root.style, "background-color", previousRootColor, previousRootPriority);
    restoreProperty(body.style, "background-color", previousBodyColor, previousBodyPriority);
    if (theme) {
      if (previousTheme === null) theme.removeAttribute("content");
      else theme.setAttribute("content", previousTheme);
    }
  };
}

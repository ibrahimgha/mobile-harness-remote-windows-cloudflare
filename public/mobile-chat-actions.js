// An additive toolbar enhancement: preserve React's existing buttons and handlers.
const mobile = matchMedia("(max-width: 920px)");
const mounted = new WeakMap();

function installToolbar(toolbar) {
  if (mounted.has(toolbar) && toolbar.querySelector(".chat-actions-toggle")) { mounted.get(toolbar).sync(); return; }
  let actions = [...toolbar.children].filter(child => child.tagName === "BUTTON" && !child.classList.contains("chat-actions-toggle"));
  if (!actions.length) return;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "icon-button chat-actions-toggle";
  toggle.setAttribute("aria-label", "Chat actions");
  toggle.setAttribute("aria-expanded", "false");
  toggle.title = "Chat actions";
  toggle.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
  let open = false;
  const setOpen = value => {
    open = value;
    toolbar.dataset.actionsOpen = String(open);
    toggle.setAttribute("aria-expanded", String(open));
    actions.forEach(action => {
      action.inert = mobile.matches && !open;
      if (mobile.matches && !open) action.setAttribute("aria-hidden", "true");
      else action.removeAttribute("aria-hidden");
    });
  };
  const sync = () => {
    actions = [...toolbar.children].filter(child => child.tagName === "BUTTON" && child !== toggle);
    actions.forEach((action, index) => {
      action.classList.add("chat-action-reveal");
      action.style.setProperty("--action-offset", `${44 + (actions.length - index - 1) * 42}px`);
    });
    toolbar.style.setProperty("--actions-width", `${actions.length * 42 + 44}px`);
    setOpen(open);
  };
  toggle.addEventListener("click", () => setOpen(!open));
  toolbar.addEventListener("keydown", event => {
    if (event.key === "Escape") { setOpen(false); toggle.focus(); }
  });
  toolbar.addEventListener("click", event => {
    if (event.target.closest(".chat-action-reveal")) setOpen(false);
  });
  toolbar.append(toggle);
  mounted.set(toolbar, { setOpen, toggle, sync });
  sync();
}

function scan() {
  document.querySelectorAll(".chat-topbar-actions").forEach(installToolbar);
}
document.addEventListener("pointerdown", event => {
  document.querySelectorAll('.chat-topbar-actions[data-actions-open="true"]').forEach(toolbar => {
    if (!toolbar.contains(event.target)) mounted.get(toolbar)?.setOpen(false);
  });
});
mobile.addEventListener("change", () => {
  document.querySelectorAll(".chat-topbar-actions").forEach(toolbar => mounted.get(toolbar)?.setOpen(false));
});
new MutationObserver(scan).observe(document.getElementById("root"), { childList: true, subtree: true });
scan();

// Pins every window that appears in Roam's right sidebar.

const WINDOW_CLASS = "rm-sidebar-window";

/** The window as `pinWindow` wants it: a search by its text, everything else by a uid. */
const toApiWindow = (w) => {
  if (w.type === "search-query") {
    return { type: w.type, "search-query-str": w["search-query-str"] };
  }
  // getWindows reports the uid under a different name for each kind of window.
  const uid = w["block-uid"] ?? w["page-uid"] ?? w["mentions-uid"];
  return uid ? { type: w.type, "block-uid": uid } : null;
};

/** Pins the sidebar window shown in the element `el`, unless it's pinned already. */
const pin = (el) => {
  const slot = el.parentElement;
  if (!slot?.parentElement) return;
  const order = Array.from(slot.parentElement.children).indexOf(slot);
  const sidebar = window.roamAlphaAPI.ui.rightSidebar;
  const sidebarWindow = sidebar.getWindows().find((w) => w.order === order);
  if (!sidebarWindow?.type || sidebarWindow["pinned?"]) return;
  const apiWindow = toApiWindow(sidebarWindow);
  if (!apiWindow) return;
  try {
    // An async call: a window closed in the meantime rejects, which is fine.
    Promise.resolve(sidebar.pinWindow({ window: apiWindow })).catch(() => {});
  } catch {
    // The window is gone already.
  }
};

/** Starts pinning, the windows already open included. Returns a function that stops it. */
const initializeAutopin = () => {
  const isWindow = (el) => el.nodeName === "DIV" && el.classList.contains(WINDOW_CLASS);
  const windowsIn = (el) =>
    Array.from(el.getElementsByClassName(WINDOW_CLASS)).filter(isWindow);

  windowsIn(document).forEach(pin);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (isWindow(node)) pin(node);
        else windowsIn(node).forEach(pin);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
};

export default initializeAutopin;

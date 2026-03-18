const createHTMLObserver = ({ callback, tag, className }) => {
  const getChildren = (el) =>
    Array.from(el.getElementsByClassName(className)).filter(
      (child) => child.nodeName === tag
    );
  getChildren(document).forEach(callback);

  const isNode = (el) =>
    el.nodeName === tag && el.classList.contains(className);
  const getNodes = (nodes) =>
    Array.from(nodes)
      .filter((el) => isNode(el) || el.hasChildNodes())
      .flatMap((el) => (isNode(el) ? [el] : getChildren(el)));

  const htmlObserver = new MutationObserver((ms) => {
    ms.flatMap((m) => getNodes(m.addedNodes)).forEach(callback);
  });
  htmlObserver.observe(document.body, { childList: true, subtree: true });
  return htmlObserver;
};

const initializeRoamJSSidebarFeatures = (extensionAPI) => {
  const unloads = new Set();

  const sidebarWindowObserver = createHTMLObserver({
    tag: "DIV",
    className: "rm-sidebar-window",
    callback: (d) => {
      const order = Array.from(
        d.parentElement.parentElement.children
      ).findIndex((c) => c === d.parentElement);
      const sidebarWindow = window.roamAlphaAPI.ui.rightSidebar
        .getWindows()
        .find((w) => w.order === order);
      if (!sidebarWindow || !sidebarWindow.type) return;
      const uid = sidebarWindow.type === "block"
        ? sidebarWindow["block-uid"]
        : sidebarWindow["page-uid"];
      window.roamAlphaAPI.ui.rightSidebar.pinWindow({
        window: { type: sidebarWindow.type, "block-uid": uid }
      });
    },
  });
  unloads.add(() => sidebarWindowObserver.disconnect());

  return () => {
    unloads.forEach((u) => u());
  };
};

export default initializeRoamJSSidebarFeatures;

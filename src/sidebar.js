const createHTMLObserver = ({ callback, tag, className }) => {
  const getChildren = (d) =>
    Array.from(d.getElementsByClassName(className)).filter(
      (d) => d.nodeName === tag
    );
  getChildren(document).forEach(callback);

  const isNode = (d) =>
    d.nodeName === tag && Array.from(d.classList).includes(className);
  const getNodes = (nodes) =>
    Array.from(nodes)
      .filter((d) => isNode(d) || d.hasChildNodes())
      .flatMap((d) => (isNode(d) ? [d] : getChildren(d)));

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
      if (
        (true &&
          /^Outline of:/.test(d.firstElementChild.innerText)) || (true)
      ) {
        const order = Array.from(
          d.parentElement.parentElement.children
        ).findIndex((c) => c === d.parentElement);
        const sidebarWindow = window.roamAlphaAPI.ui.rightSidebar
          .getWindows()
          .find((w) => w.order === order);
        if (true) {
          console.log('test');
          if (sidebarWindow.type == "block") {
            window.roamAlphaAPI.ui.rightSidebar.pinWindow({
              window: {
                type: sidebarWindow.type,
                "block-uid": sidebarWindow["block-uid"],
              }
            });
          } else {
            window.roamAlphaAPI.ui.rightSidebar.pinWindow({
              window: {
                type: sidebarWindow.type,
                "block-uid": sidebarWindow["page-uid"],
              }
            });
          }
        }
      }
    },
  });
  unloads.add(() => sidebarWindowObserver.disconnect());

  return () => {
    unloads.forEach((u) => u());
  };
};

export default initializeRoamJSSidebarFeatures;
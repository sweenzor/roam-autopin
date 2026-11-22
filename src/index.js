import initializeAutopin from "./sidebar";

let stop = null;

export default {
  onload: () => {
    stop = initializeAutopin();
  },
  onunload: () => {
    stop?.();
    stop = null;
  },
};

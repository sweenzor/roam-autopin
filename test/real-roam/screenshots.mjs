// Takes the README's screenshots in Roam's real desktop app (the Linux build, under Xvfb), signed in to
// the hosted test graph with the build loaded through Roam Depot's developer mode.
//
//   npm run build
//   DISPLAY=:99 ROAM_EMAIL=… ROAM_PASSWORD=… OUT=docs/images node test/real-roam/screenshots.mjs
//
// Every picture shows the real extension at work: the windows are opened the way a shift-click opens
// them, and the pins on them are the ones the extension set. It makes a few small pages about a trip to
// have something to show, and empties the sidebar when done. It stops with an error if a window it
// expects to be pinned isn't. See .github/workflows/screenshots.yml.
//
// Without ROAM_EMAIL and ROAM_PASSWORD it opens Roam's public help graph and loads the build straight
// into the page. That is for trying the script out only: the help graph can't be written to and keeps
// nothing in the sidebar across a restart, so those pictures are not for the README.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  roam, log, sleep, evalIn, serve, stopServing, launchRoam, quitRoam, waitFor, signIn, openGraph, loadDevExtension,
  sb, clearSidebar, EXT_URL,
} from './roam.mjs';

const EMAIL = process.env.ROAM_EMAIL, PASSWORD = process.env.ROAM_PASSWORD;
delete process.env.ROAM_EMAIL; delete process.env.ROAM_PASSWORD;
const PUBLIC = !EMAIL || !PASSWORD;
const GRAPH = PUBLIC ? 'help' : process.env.ROAM_GRAPH || 'vault-spike-hosted';
const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.resolve(process.env.OUT || 'docs/images');
const WIDTH = 1280, HEIGHT = 800;

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.startsWith('debug-')) fs.rmSync(path.join(OUT, f)); // from an earlier run
roam.logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'real-roam-'));
// Roam loads extension.js from a folder URL. Serve a folder with the build alone in it.
const DIST = path.join(roam.logDir, 'dist');
fs.mkdirSync(DIST);
fs.copyFileSync(path.join(ROOT, 'extension.js'), path.join(DIST, 'extension.js'));

// A few pages to fill the sidebar with. Each entry is a block, or [block, its children].
const PAGES = {
  'Lisbon trip': [
    'Dates: May 12 to May 19',
    'Staying in [[Alfama]]',
    ['Things to book', ['Train to [[Sintra]]', 'Dinner at one of the [[Restaurants to try]]']],
    'Go through the [[Packing list]] the night before',
  ],
  'Packing list': ['Passport', 'Walking shoes', 'Rain jacket', 'Plug adapter'],
  'Restaurants to try': ['Cervejaria Ramiro for seafood', 'Time Out Market for lunch', 'Pastéis de Belém, go early'],
  Sintra: ['Take the early train from Rossio', 'Pena Palace', 'Quinta da Regaleira'],
  Alfama: ['Miradouro de Santa Luzia at sunset', 'Fado on Thursday night'],
};
const HELP_PAGES = { 'Lisbon trip': 'Workflows', 'Packing list': 'Writing', 'Restaurants to try': 'Research', Sintra: 'Workflows', Alfama: 'Writing' };

/** Makes the pages that are missing, and returns the uid of each page plus Sintra's first block. */
const makePages = () => evalIn(async ([PAGES, HELP_PAGES, PUBLIC]) => {
  const api = window.roamAlphaAPI;
  const uidOf = (t) => api.data.q('[:find ?u . :in $ ?t :where [?p :node/title ?t] [?p :block/uid ?u]]', t);
  const add = async (parent, items) => {
    for (const [order, item] of items.entries()) {
      const [string, children] = Array.isArray(item) ? item : [item, []];
      const uid = api.util.generateUID();
      await api.data.block.create({ location: { 'parent-uid': parent, order }, block: { string, uid } });
      await add(uid, children);
    }
  };
  // A page can be there already and empty, made by a [[link]] to it from another page.
  const empty = (uid) => !api.data.q('[:find ?b . :in $ ?u :where [?p :block/uid ?u] [?p :block/children ?b]]', uid);
  const uids = {};
  for (const [title, items] of Object.entries(PAGES)) {
    if (PUBLIC) { uids[title] = uidOf(HELP_PAGES[title]); continue; }
    if (!uidOf(title)) await api.data.page.create({ page: { title, uid: api.util.generateUID() } });
    uids[title] = uidOf(title);
    if (empty(uids[title])) await add(uids[title], items);
  }
  await new Promise((r) => setTimeout(r, 500));
  uids.block = api.data.q('[:find ?c . :in $ ?u :where [?p :block/uid ?u] [?p :block/children ?b] [?b :block/order 0] [?b :block/uid ?c]]', uids.Sintra);
  return uids;
}, [PAGES, HELP_PAGES, PUBLIC]);

const openPage = async (title) => {
  if (PUBLIC) title = HELP_PAGES[title];
  await evalIn((title) => window.roamAlphaAPI.ui.mainWindow.openPage({ page: { title } }), title);
  await waitFor(`the page "${title}"`, () => evalIn((t) => document.querySelector('.roam-article .rm-title-display')?.textContent.trim() === t, title), 20000);
  await sleep(1500);
};
/** The sidebar's windows, top to bottom, as "type:uid" with " pinned" after the pinned ones. */
const windows = () => evalIn(() => window.roamAlphaAPI.ui.rightSidebar.getWindows().sort((a, b) => a.order - b.order)
  .map((x) => `${x.type}:${x['search-query-str'] ?? x['block-uid'] ?? x['page-uid'] ?? x['mentions-uid']}${x['pinned?'] ? ' pinned' : ''}`));
const pinnedCount = async () => (await windows()).filter((x) => x.endsWith(' pinned')).length;

let cdp = null;
/** Starts Roam and opens the graph at twice the pixel density, so the pictures are sharp. */
async function start() {
  await launchRoam();
  if (!PUBLIC) await signIn(EMAIL, PASSWORD);
  await openGraph(GRAPH);
  if (PUBLIC) await evalIn(async (url) => { const m = await import(`${url}extension.js?${Date.now()}`); m.default.onload({ extensionAPI: {} }); }, EXT_URL);
  cdp = await roam.page.context().newCDPSession(roam.page); // kept open: the override ends with it
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: false });
  await sleep(1000);
}
/** The part of the window `selector` covers, for a cropped picture. */
const boxOf = (selector, pad = 0) => evalIn(([selector, pad, W, H]) => {
  const r = document.querySelector(selector)?.getBoundingClientRect();
  if (!r) return null;
  const x = Math.max(0, r.left - pad), y = Math.max(0, r.top - pad);
  return { x, y, width: Math.min(W, r.right + pad) - x, height: Math.min(H, r.bottom + pad) - y };
}, [selector, pad, WIDTH, HEIGHT]);
/** How far down the text in `selector` goes, so a picture can stop there and not show empty space. */
const fold = (selector = '.roam-article *, #right-sidebar .rm-sidebar-window *', pad = 28) => evalIn(([selector, pad, H]) => {
  let bottom = 0;
  for (const e of document.querySelectorAll(selector)) {
    if (e.children.length || !e.textContent.trim()) continue;
    const r = e.getBoundingClientRect();
    if (r.width && r.height) bottom = Math.max(bottom, r.bottom);
  }
  return Math.min(H, Math.ceil(bottom + pad));
}, [selector, pad, HEIGHT]);
/** The whole window, down to where its text ends. */
const windowBox = async () => ({ x: 0, y: 0, width: WIDTH, height: await fold() });
async function snap(name, clip) {
  await evalIn(() => document.querySelectorAll('.bp3-toast .bp3-button').forEach((b) => b.click()));
  await roam.page.mouse.move(WIDTH / 2, HEIGHT - 4);
  await sleep(500);
  // Straight from the page's own session: Playwright's screenshot puts its own 1x viewport back first.
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  log('saved', `${name}.png`, clip ? JSON.stringify(clip) : '');
}

async function main() {
  serve(DIST);
  log(`graph ${GRAPH}${PUBLIC ? ' (public, no sign-in: trying the script out only)' : ''}`);
  await start();
  if (!PUBLIC) await loadDevExtension();
  await clearSidebar();
  const u = await makePages();
  await openPage('Lisbon trip');

  // 1. Three windows opened in the sidebar. The extension pins each one as it appears.
  await sb(`
    for (const key of ['block:' + arg.block, 'outline:' + arg['Packing list'], 'outline:' + arg['Restaurants to try']]) {
      await sb.addWindow({ window: w(key) });
      await new Promise((r) => setTimeout(r, 1200));
    }`, u);
  await waitFor('three pinned windows', async () => (await pinnedCount()) === 3, 15000);
  log('sidebar', JSON.stringify(await windows()));
  await snap('autopin', await windowBox());

  // 2. One window up close, with its pin.
  const header = await evalIn(() => {
    const win = document.querySelector('#right-sidebar .rm-sidebar-window');
    document.querySelectorAll('[data-ap-shot]').forEach((e) => e.removeAttribute('data-ap-shot'));
    win?.setAttribute('data-ap-shot', '');
    return !!win;
  });
  if (!header) throw new Error('no window in the sidebar to take a close-up of');
  await snap('pinned-window', await boxOf('[data-ap-shot]', 12));

  // 3. Roam quit and started again: pinned windows are the ones Roam keeps.
  if (!PUBLIC) {
    await sleep(3000); // let Roam sync the pins
    await quitRoam('SIGTERM');
    await start();
    await waitFor('the three pinned windows after a restart', async () => (await pinnedCount()) === 3, 30000);
    await openPage('Lisbon trip');
    log('sidebar after restart', JSON.stringify(await windows()));
    await snap('after-restart', await windowBox());
  }

  // 4. Which kinds of window get pinned: one of each, opened one after the other.
  await clearSidebar();
  await sb(`
    for (const key of ['search-query:train', 'graph:' + arg['Lisbon trip'], 'mentions:' + arg.Sintra, 'block:' + arg.block, 'outline:' + arg['Packing list']]) {
      await sb.addWindow({ window: w(key) });
      await new Promise((r) => setTimeout(r, 1200));
    }`, u);
  await sleep(2500);
  log('one of each kind', JSON.stringify(await windows()));
}

let failure = '';
try { await main(); } catch (e) { failure = e.message.split('\n')[0]; log('ERROR', e.stack ?? e.message); if (roam.page && cdp) await snap('debug-error').catch(() => {}); }
try { if (roam.page) { await clearSidebar(); await sleep(1500); } } catch { /* best effort */ }
await quitRoam('SIGTERM').catch(() => {});
stopServing();
log(failure ? `FAILED: ${failure}` : 'DONE', '->', OUT);
process.exit(failure ? 1 : 0);

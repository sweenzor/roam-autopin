// Drives Roam's real desktop app (the Linux build, under Xvfb) over the Chrome DevTools Protocol with
// Playwright, for screenshots.mjs. Taken from sweenzor/roam-persistent-sidebar (test/real-roam/roam.mjs).
//
// The build under test is served from a local URL and loaded through Roam Depot's developer mode. Roam
// loads it again from that URL on every launch. Credentials are passed to signIn() only; Roam itself is
// started without them in its environment. Nothing here logs Roam's own console or log, and shot()
// takes no screenshot before the graph is open.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require('playwright-core'); } catch { return require('playwright'); } })();

export const APP_URL = 'https://roamresearch.com/?server-port=3333#/app';
const ROAM_BIN = process.env.ROAM_BIN || 'roam-research';
const CDP_PORT = 9222, SERVE_PORT = 8766;
export const EXT_URL = `http://127.0.0.1:${SERVE_PORT}/ci/`;

export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The open Roam: `page` is its main window, `signedIn` turns true once the graph is open. */
export const roam = { browser: null, page: null, signedIn: false, out: null, logDir: null, shotN: 0 };
export const evalIn = (fn, arg) => roam.page.evaluate(fn, arg);

function roamPids() {
  return fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).filter((pid) => {
    try { return /Roam Research|roam-research/.test(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8')); } catch { return false; }
  });
}

// ---------- extension server (Roam Depot developer extension from URL) ----------
let server = null;
export function serve(dir) {
  const root = path.resolve(dir);
  server = http.createServer((q, s) => {
    const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Allow-Headers': '*', 'Cache-Control': 'no-store' };
    if (q.method === 'OPTIONS') { s.writeHead(204, h); return s.end(); }
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/ci\//, '');
    const f = path.join(root, rel);
    if (!f.startsWith(root) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { s.writeHead(404, h); return s.end(); }
    h['Content-Type'] = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.md') ? 'text/markdown' : 'text/plain';
    s.writeHead(200, h); s.end(q.method === 'HEAD' ? undefined : fs.readFileSync(f));
  }).listen(SERVE_PORT, '127.0.0.1');
}
export const stopServing = () => server?.close();

// ---------- Roam ----------
export async function launchRoam() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ROAM_|GITHUB_TOKEN|ACTIONS_)/.test(k)));
  const out = fs.openSync(path.join(roam.logDir, 'roam.log'), 'a');
  spawn(ROAM_BIN, ['--no-sandbox', `--remote-debugging-port=${CDP_PORT}`], { env, detached: true, stdio: ['ignore', out, out] }).unref();
  for (let i = 0; i < 90; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
      if (list.some((t) => t.type === 'page' && t.url.includes('roamresearch.com'))) break;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  roam.browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const ctx = roam.browser.contexts()[0];
  roam.page = null;
  for (let i = 0; i < 30 && !roam.page; i++) {
    roam.page = ctx.pages().find((p) => p.url().includes('roamresearch.com') && !p.url().includes('sw.js')) ?? null;
    if (!roam.page) await sleep(1000);
  }
  if (!roam.page) throw new Error('Roam window not found over CDP');
  roam.page.on('console', (m) => { if (m.type() === 'error' && /sidebar|pinWindow/i.test(m.text())) log('[page]', m.text().slice(0, 300)); });
  roam.page.on('crash', () => log('[crash] Roam\'s window crashed'));
  await roam.page.setViewportSize?.({ width: 1200, height: 773 }).catch(() => {});
}
/** Stops Roam. SIGKILL goes to every Roam process, as a crash would. SIGTERM goes to the main process
 *  only, which then quits the way closing the window does. */
export async function quitRoam(signal = 'SIGTERM', grace = 15000) {
  try { await roam.browser?.close(); } catch { /* already gone */ }
  roam.browser = null; roam.page = null;
  const pids = roamPids();
  const main = pids.filter((pid) => { try { return !fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('--type='); } catch { return false; } });
  for (const pid of signal === 'SIGKILL' || !main.length ? pids : main) { try { process.kill(+pid, signal); } catch { /* gone */ } }
  for (let t = 0; t < grace && roamPids().length; t += 500) await sleep(500);
  for (const pid of roamPids()) { try { process.kill(+pid, 'SIGKILL'); } catch { /* gone */ } }
  await sleep(1000);
}
export async function waitFor(label, fn, timeout = 30000, every = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { const last = await fn(); if (last) return last; } catch { /* page navigating */ }
    await sleep(every);
  }
  throw new Error(`timed out after ${timeout / 1000} s waiting for ${label}`);
}
export async function shot(name) {
  if (!roam.signedIn || !roam.page || !roam.out) return; // never photograph the sign-in screen
  const f = path.join(roam.out, `${String(++roam.shotN).padStart(2, '0')}-${name}.png`);
  await roam.page.screenshot({ path: f }).catch((e) => log('screenshot failed', e.message));
}

export async function signIn(email, password) {
  const page = roam.page;
  const form = await waitFor('the sign-in form or a graph', () => evalIn(() =>
    document.querySelector('input[name="password"], input[type="password"]') ? 'form'
      : document.querySelector('.roam-app, .rm-graph-list, .roam-body') || /HOSTED GRAPHS/i.test(document.body.innerText) ? 'in' : null), 90000);
  if (form === 'in') { log('already signed in'); return; }
  if (!email || !password) throw new Error('ROAM_EMAIL and ROAM_PASSWORD are not set');
  let step = 'email';
  try {
    await page.fill('input[name="email"], input[type="email"]', email);
    step = 'password';
    await page.focus('input[name="password"], input[type="password"]');
    await page.keyboard.insertText(password);
    step = 'Sign In button';
    await page.locator('button', { hasText: /^Sign In$/ }).first().click();
  } catch (e) {
    const why = e.message.split('\n')[0].split(email).join('***').split(password).join('***');
    throw new Error(`could not fill in the sign-in form (${step}): ${why}`);
  }
  await waitFor('sign-in to finish', () => evalIn(() => !document.querySelector('input[type="password"]')), 60000)
    .catch(() => { throw new Error('sign-in failed: check the ROAM_EMAIL and ROAM_PASSWORD secrets'); });
  log('signed in');
}
export async function openGraph(graph) {
  if (!roam.page.url().includes(`#/app/${graph}`)) await roam.page.goto(`${APP_URL}/${graph}`);
  await waitFor(`graph ${graph} to load`, () => evalIn(() => {
    if (/error loading your graph/i.test(document.body.innerText)) throw new Error('graph error');
    return !!(window.roamAlphaAPI?.data?.q && document.querySelector('.roam-main .roam-article, .roam-main .roam-log-container, .rm-title-display'));
  }), 180000);
  roam.signedIn = true;
  await dismissDialogs();
  log('graph open');
}
export async function dismissDialogs() {
  for (let i = 0; i < 3; i++) {
    if (!(await evalIn(() => !!document.querySelector('.bp3-dialog, .bp3-overlay-open')))) return;
    await roam.page.keyboard.press('Escape'); await sleep(500);
  }
}

// ---------- Settings dialog / Roam Depot ----------
const clickLeaf = (text, scope = '.bp3-dialog') => evalIn(([text, scope]) => {
  const el = [...document.querySelectorAll(`${scope} *`)].find((e) => e.children.length === 0 && e.textContent.trim() === text);
  el?.click(); return !!el;
}, [text, scope]);
async function openSettings() {
  if (await evalIn(() => !!document.querySelector('.bp3-dialog'))) return;
  const more = roam.page.locator('.rm-topbar .bp3-icon-more').first();
  if (await more.count()) await more.click(); else await roam.page.mouse.click(1088, 22);
  await waitFor('the More menu', () => evalIn(() => !!document.querySelector('.bp3-menu-item')), 5000);
  await evalIn(() => [...document.querySelectorAll('.bp3-menu-item')].find((e) => /^Settings/.test(e.innerText.trim()))?.click());
  await waitFor('the Settings dialog', () => evalIn(() => !!document.querySelector('.bp3-dialog')), 10000);
}
async function clickHeaderIcon(label, name) {
  const btn = roam.page.locator('.bp3-dialog .rm-extensions-installed__header', { hasText: label }).locator(`button.bp3-icon-${name}`).first();
  await btn.waitFor({ timeout: 10000 });
  let last = null;
  for (let i = 0; i < 20; i++) {
    const box = await btn.boundingBox();
    if (box && last && box.x === last.x && box.y === last.y) break;
    last = box; await sleep(150);
  }
  await btn.click();
}
/** Loads the served build as a Roam Depot developer extension, unless one from EXT_URL is loaded. */
export async function loadDevExtension() {
  const page = roam.page;
  await openSettings();
  await waitFor('Roam Depot in Settings', () => clickLeaf('Roam Depot'), 10000);
  await waitFor('the Roam Depot settings', () => evalIn(() => /Installed Extensions/.test(document.querySelector('.bp3-dialog')?.innerText ?? '')), 15000);
  if (await evalIn((url) => (document.querySelector('.bp3-dialog')?.innerText ?? '').includes(url.replace(/\/$/, '')), EXT_URL)) {
    log('developer extension already loaded'); await dismissDialogs(); return;
  }
  if (!(await evalIn(() => /Developer Extensions/.test(document.querySelector('.bp3-dialog')?.innerText ?? '')))) {
    await clickHeaderIcon('Installed Extensions', 'cog');
    await waitFor('"Enable developer mode"', () => clickLeaf('Enable developer mode', '.bp3-popover'), 5000);
    await waitFor('the Developer Extensions row', () => evalIn(() => /Developer Extensions/.test(document.querySelector('.bp3-dialog')?.innerText ?? '')), 5000);
  }
  await clickHeaderIcon('Developer Extensions', 'link');
  const input = page.locator('input[placeholder^="Something like"]');
  await input.waitFor({ timeout: 5000 });
  await input.fill(EXT_URL);
  await sleep(500); // an instant click after typing loads nothing: Roam's input state lags a moment
  await page.locator('.bp3-dialog button', { hasText: 'Load remote extension' }).click();
  await sleep(3000);
  await dismissDialogs();
}

// ---------- the sidebar and pages ----------
/** Runs `fn(sidebar, w)` in the page, where `w(key)` turns a window key back into an API window. */
export const sb = (body, arg) => evalIn(async ([body, arg]) => {
  const sb = window.roamAlphaAPI.ui.rightSidebar;
  const w = (key) => { const [type, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]; return type === 'search-query' ? { type, 'search-query-str': id } : { type, 'block-uid': id }; };
  return new Function('sb', 'w', 'arg', `return (async () => { ${body} })()`)(sb, w, arg);
}, [body, arg]);

export async function clearSidebar() {
  await sb(`for (const x of sb.getWindows()) { const k = x.type + ':' + (x['search-query-str'] ?? x['block-uid'] ?? x['page-uid'] ?? x['mentions-uid']);
    if (x['pinned?']) await sb.unpinWindow({ window: w(k) }); await sb.removeWindow({ window: w(k) }); }`);
}
export const deletePage = (title) => evalIn(async (title) => {
  const uid = window.roamAlphaAPI.data.q('[:find ?u . :in $ ?t :where [?p :node/title ?t] [?p :block/uid ?u]]', title);
  if (uid) await window.roamAlphaAPI.data.page.delete({ page: { uid } });
}, title);

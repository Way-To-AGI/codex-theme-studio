#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTheme } from "./theme-core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function parseArgs(argv) {
  const options = { port: 9335, mode: "watch", timeoutMs: 30000, screenshot: null, theme: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--watch") options.mode = "watch";
    else if (arg === "--once") options.mode = "once";
    else if (arg === "--verify") options.mode = "verify";
    else if (arg === "--smoke") options.mode = "smoke";
    else if (arg === "--remove") options.mode = "remove";
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (arg === "--screenshot") options.screenshot = path.resolve(argv[++index]);
    else if (arg === "--theme") options.theme = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error("Invalid CDP port");
  if (options.mode !== "remove" && !options.theme) throw new Error("--theme is required");
  return options;
}

class CdpSession {
  constructor(target, timeoutMs) {
    this.target = target;
    this.timeoutMs = timeoutMs;
    this.socket = new WebSocket(target.webSocketDebuggerUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP socket open timed out")), this.timeoutMs);
      this.socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener("error", (event) => { clearTimeout(timer); reject(event.error ?? new Error("CDP socket failed")); }, { once: true });
    });
    this.socket.addEventListener("message", (event) => this.onMessage(event));
    this.socket.addEventListener("close", () => this.close());
    await this.send("Runtime.enable");
    await this.send("Page.enable");
    return this;
  }

  onMessage(event) {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${message.error.message} (${message.error.code})`));
      else pending.resolve(message.result);
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
  }

  on(method, callback) {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), callback]);
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("CDP session is closed"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP request timed out: ${method}`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: false });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.socket.close(); } catch { /* already closed */ }
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("CDP session closed")); }
    this.pending.clear();
  }
}

async function waitForTargets(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const targets = (await response.json()).filter((item) => item.type === "page" && String(item.url).startsWith("app://"));
      if (targets.length) return targets;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`No Codex app:// renderer found on 127.0.0.1:${port}: ${lastError?.message ?? "timeout"}`);
}

function mimeType(filename) {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

async function loadPayload(reference) {
  const theme = await loadTheme(reference);
  const template = await fs.readFile(path.join(root, "assets", "renderer-inject.js"), "utf8");
  const artDataUrl = theme.artPath ? `data:${mimeType(theme.artPath)};base64,${(await fs.readFile(theme.artPath)).toString("base64")}` : "";
  const publicTheme = {
    id: theme.manifest.id,
    displayName: theme.manifest.displayName,
    version: theme.manifest.version,
    decorations: theme.manifest.decorations ?? {
      sidebarWidget: { enabled: false, icon: "", eyebrow: "", title: "", caption: "" },
      cornerCard: { enabled: false, icon: "", eyebrow: "", title: "", caption: "" },
    },
  };
  const expression = template
    .replace("__CTS_CSS_JSON__", JSON.stringify(theme.css))
    .replace("__CTS_ART_JSON__", JSON.stringify(artDataUrl))
    .replace("__CTS_THEME_JSON__", JSON.stringify(publicTheme));
  return { expression, theme: publicTheme };
}

const removeExpression = `(() => {
  window.__CODEX_THEME_STUDIO_DISABLED__ = true;
  const state = window.__CODEX_THEME_STUDIO_STATE__;
  if (state?.cleanup) return state.cleanup();
  document.documentElement?.classList.remove('codex-theme-studio-skin');
  document.documentElement?.style.removeProperty('--codex-theme-art');
  document.getElementById('codex-theme-studio-style')?.remove();
  document.getElementById('codex-theme-studio-decorations')?.remove();
  return true;
})()`;

const verifyExpression = (expected, smoke) => `(() => {
  const rect = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
  const visible = (value) => Boolean(value && value.width > 0 && value.height > 0);
  const overlap = (a,b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const decorations = document.getElementById('codex-theme-studio-decorations');
  const cards = decorations ? [...decorations.querySelectorAll('.cts-decoration-card:not([hidden])')] : [];
  const controls = [...document.querySelectorAll('button,a[href],input,textarea,select,[contenteditable="true"],[role="button"],[role="link"],[role="menuitem"],[role="option"],[role="tab"]')]
    .filter(node => !node.closest('#codex-theme-studio-decorations')).map(rect).filter(visible);
  const collisions = cards.flatMap(card => controls.filter(control => overlap(rect(card), control))).length;
  const home = document.querySelector('[role="main"]:has([data-testid="home-icon"])');
  const composer = document.querySelector('.composer-surface-chrome');
  const sidebar = document.querySelector('aside.app-shell-left-panel');
  const main = document.querySelector('main.main-surface') || document.querySelector('main');
  const result = {
    installed: document.documentElement.classList.contains('codex-theme-studio-skin'),
    themeId: document.documentElement.dataset.codexThemeStudio || null,
    version: document.documentElement.dataset.codexThemeStudioVersion || null,
    stylePresent: Boolean(document.getElementById('codex-theme-studio-style')),
    decorationsPresent: Boolean(decorations),
    decorationsAriaHidden: decorations?.getAttribute('aria-hidden') === 'true',
    decorationsPointerEvents: decorations ? getComputedStyle(decorations).pointerEvents : null,
    decorationsBodySibling: decorations?.parentElement === document.body,
    visibleDecorations: cards.map(card => ({ slot: card.dataset.slot || null, rect: rect(card) })),
    hiddenDecorations: decorations ? [...decorations.querySelectorAll('.cts-decoration-card[hidden]')].map(card => ({ slot: card.dataset.slot || null, reason: card.dataset.hiddenReason || null })) : [],
    decorationCollisions: collisions,
    main: rect(main), sidebar: rect(sidebar), composer: rect(composer), home: Boolean(home),
    nativeControls: controls.length,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    viewport: { width: innerWidth, height: innerHeight }
  };
  const expected = ${JSON.stringify(expected)};
  const strictSurface = ${smoke ? "true" : "visible(result.main) && (!result.home || visible(result.composer)) && (!result.sidebar || visible(result.sidebar)) && result.nativeControls >= 5"};
  result.pass = result.installed && result.themeId === expected.id && result.version === expected.version && result.stylePresent &&
    result.decorationsPresent && result.decorationsAriaHidden && result.decorationsPointerEvents === 'none' && result.decorationsBodySibling &&
    result.decorationCollisions === 0 && !result.horizontalOverflow && strictSurface;
  return result;
})()`;

async function capture(session, output) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await session.send("Page.bringToFront");
  await new Promise((resolve) => setTimeout(resolve, 220));
  const result = await session.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await fs.writeFile(output, Buffer.from(result.data, "base64"));
}

function isAuxiliaryTarget(target) {
  try {
    const route = new URL(target.url).searchParams.get("initialRoute") ?? "";
    return route === "/hotkey-window" || route.startsWith("/overlay") || route.startsWith("/diagnostic");
  } catch { return false; }
}

async function apply(session, payload) {
  return session.evaluate(payload.expression);
}

async function runOneShot(options) {
  const targets = await waitForTargets(options.port, options.timeoutMs);
  const payload = options.mode === "remove" ? null : await loadPayload(options.theme);
  const results = [];
  let screenshotCaptured = false;
  let screenshotError = null;
  for (const target of targets) {
    const session = await new CdpSession(target, Math.min(options.timeoutMs, 10000)).open();
    try {
      if (options.mode === "remove") await session.evaluate(removeExpression);
      else if (options.mode === "once") { await apply(session, payload); await new Promise((resolve) => setTimeout(resolve, 500)); }
      const result = options.mode === "remove"
        ? await session.evaluate("!document.documentElement.classList.contains('codex-theme-studio-skin')")
        : await session.evaluate(verifyExpression(payload.theme, options.mode === "smoke" || isAuxiliaryTarget(target)));
      results.push({ targetId: target.id, title: target.title, url: target.url, result });
      if (options.screenshot && !screenshotCaptured && !isAuxiliaryTarget(target)) {
        try { await capture(session, options.screenshot); screenshotCaptured = true; }
        catch (error) { screenshotError = error.message; }
      }
    } finally { session.close(); }
  }
  const passed = (options.mode === "remove" ? results.every((row) => row.result === true) : results.every((row) => row.result.pass)) && (!options.screenshot || screenshotCaptured);
  console.log(JSON.stringify({ mode: options.mode, port: options.port, passed, screenshot: options.screenshot ? { captured: screenshotCaptured, path: options.screenshot, error: screenshotError } : null, targets: results }, null, 2));
  if (!passed) process.exitCode = 2;
}

async function runWatch(options) {
  const payload = await loadPayload(options.theme);
  const sessions = new Map();
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });
  while (!stopping) {
    let targets = [];
    try { targets = await waitForTargets(options.port, 1800); }
    catch (error) { console.error(`[theme-studio] ${error.message}`); await new Promise((resolve) => setTimeout(resolve, 900)); continue; }
    const active = new Set(targets.map((target) => target.id));
    for (const [id, session] of sessions) {
      if (!active.has(id) || session.closed) { session.close(); sessions.delete(id); }
    }
    for (const target of targets) {
      if (sessions.has(target.id)) continue;
      try {
        const session = await new CdpSession(target, 10000).open();
        session.on("Page.loadEventFired", () => setTimeout(() => apply(session, payload).catch((error) => console.error(error.message)), 250));
        await apply(session, payload);
        sessions.set(target.id, session);
      } catch (error) { console.error(`[theme-studio] inject failed: ${error.message}`); }
    }
    await new Promise((resolve) => setTimeout(resolve, 650));
  }
  for (const session of sessions.values()) session.close();
}

const options = parseArgs(process.argv.slice(2));
if (options.mode === "watch") await runWatch(options);
else await runOneShot(options);

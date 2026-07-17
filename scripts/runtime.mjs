#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listThemes, loadTheme } from "./theme-core.mjs";
import { startThemeControl } from "./theme-control-server.mjs";
import { openLoopbackUrl, securePrivateFile, statePathFor } from "./platform-runtime.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function parseArgs(argv) {
  const options = { port: 9335, controlPort: null, controlToken: null, statePath: null, mode: "watch", timeoutMs: 30000, screenshot: null, theme: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--control-port") options.controlPort = Number(argv[++index]);
    else if (arg === "--control-token") options.controlToken = argv[++index];
    else if (arg === "--state-path") options.statePath = path.resolve(argv[++index]);
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
  if (options.controlPort !== null && (!Number.isInteger(options.controlPort) || options.controlPort < 1024 || options.controlPort > 65535)) throw new Error("Invalid control port");
  if ((options.controlPort === null) !== (options.controlToken === null)) throw new Error("Control port and token must be supplied together");
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

const removeManagerExpression = `(() => window.__CODEX_THEME_STUDIO_SWITCHER_STATE__?.cleanup?.() ?? true)()`;

async function managerExpression(control) {
  if (!control) return null;
  const template = await fs.readFile(path.join(root, "assets", "theme-switcher.js"), "utf8");
  return template.replace("__CTS_CONTROL_JSON__", JSON.stringify(control));
}

const bridgeDrainExpression = `(() => window.__CODEX_THEME_STUDIO_SWITCHER_STATE__?.drainRequests?.() ?? [])()`;
const bridgeDeliveryExpression = (id, result, error) => `(() => window.__CODEX_THEME_STUDIO_SWITCHER_STATE__?.deliver?.(${JSON.stringify(id)}, ${JSON.stringify(result ?? null)}, ${JSON.stringify(error ?? null)}) ?? false)()`;

const verifyExpression = (expected, smoke) => `(() => {
  const rect = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
  const visible = (value) => Boolean(value && value.width > 0 && value.height > 0);
  const overlap = (a,b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const decorations = document.getElementById('codex-theme-studio-decorations');
  const switcher = document.getElementById('codex-theme-studio-switcher');
  const switcherButton = switcher?.querySelector('.cts-switch-button');
  const cards = decorations ? [...decorations.querySelectorAll('.cts-decoration-card:not([hidden])')] : [];
  const controls = [...document.querySelectorAll('button,a[href],input,textarea,select,[contenteditable="true"],[role="button"],[role="link"],[role="menuitem"],[role="option"],[role="tab"]')]
    .filter(node => !node.closest('#codex-theme-studio-decorations')).map(rect).filter(visible);
  const collisions = cards.flatMap(card => controls.filter(control => overlap(rect(card), control))).length;
  const switcherRect = switcher && !switcher.hidden ? rect(switcher) : null;
  const switcherCollisions = switcherRect ? [...document.querySelectorAll('button,a[href],input,textarea,select,[contenteditable="true"],[role="button"],[role="link"]')]
    .filter(node => !switcher.contains(node) && !node.closest('#codex-theme-studio-decorations')).map(rect).filter(visible).filter(control => overlap(switcherRect, control)).length : 0;
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
    switcherPresent: Boolean(switcher), switcherBodySibling: switcher?.parentElement === document.body,
    switcherButtonLabel: switcherButton?.getAttribute('aria-label') || null, switcherCollisions,
    main: rect(main), sidebar: rect(sidebar), composer: rect(composer), home: Boolean(home),
    nativeControls: controls.length,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    viewport: { width: innerWidth, height: innerHeight }
  };
  const expected = ${JSON.stringify(expected)};
  const strictSurface = ${smoke ? "true" : "visible(result.main) && (!result.home || visible(result.composer)) && (!result.sidebar || visible(result.sidebar)) && result.nativeControls >= 5"};
  result.pass = result.installed && result.themeId === expected.id && result.version === expected.version && result.stylePresent &&
    result.decorationsPresent && result.decorationsAriaHidden && result.decorationsPointerEvents === 'none' && result.decorationsBodySibling &&
    result.decorationCollisions === 0 && result.switcherPresent && result.switcherBodySibling && result.switcherButtonLabel &&
    result.switcherCollisions === 0 && !result.horizontalOverflow && strictSurface;
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
    return route === "/hotkey-window" || route === "/avatar-overlay" || route.startsWith("/overlay") || route.startsWith("/diagnostic");
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
      if (options.mode === "remove") { await session.evaluate(removeExpression); await session.evaluate(removeManagerExpression); }
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
  let payload = await loadPayload(options.theme);
  const sessions = new Map();
  let stopping = false;
  let queue = Promise.resolve();
  const statePath = options.statePath ?? statePathFor();
  const control = options.controlPort && options.controlToken ? { port: options.controlPort, token: options.controlToken } : null;
  const switcherExpression = await managerExpression(control ? { bridge: true } : null);
  const enqueue = (operation) => { const next = queue.then(operation, operation); queue = next.catch(() => {}); return next; };
  const saveActive = async (nextPayload) => {
    let state = {};
    try { state = JSON.parse(await fs.readFile(statePath, "utf8")); } catch { /* initialize */ }
    state.theme = nextPayload?.theme?.id ? (await loadTheme(nextPayload.theme.id)).manifestPath : null;
    state.activeTheme = nextPayload?.theme?.id ?? null;
    state.updatedAt = new Date().toISOString();
    const temporary = `${statePath}.${process.pid}.tmp`;
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await securePrivateFile(temporary);
    await fs.rename(temporary, statePath);
  };
  const applyCurrent = async (session, refreshSwitcher = true) => {
    if (payload) await apply(session, payload); else await session.evaluate(removeExpression);
    if (refreshSwitcher && switcherExpression) await session.evaluate(switcherExpression);
  };
  const verifyCurrent = async () => {
    if (!payload) return true;
    if (!sessions.size) throw new Error("No Codex renderer is connected to Theme Studio CDP");
    for (const [id, session] of sessions) {
      const target = { id, url: session.target.url };
      const result = await session.evaluate(verifyExpression(payload.theme, isAuxiliaryTarget(target)));
      if (!result.pass) throw new Error(`Live verification failed for renderer ${id}`);
    }
    return true;
  };
  let controlServer = null;
  const stopWatching = () => {
    stopping = true;
    for (const session of sessions.values()) session.close();
    controlServer?.server.closeAllConnections?.();
    controlServer?.server.close();
  };
  process.on("SIGINT", stopWatching);
  process.on("SIGTERM", stopWatching);
  const switchTheme = (themeId) => enqueue(async () => {
        const previous = payload;
        const candidate = await loadPayload(themeId);
        try {
          payload = candidate;
          await Promise.all([...sessions.values()].map((session) => applyCurrent(session, false)));
          await verifyCurrent();
          await saveActive(payload);
          return { activeTheme: payload.theme.id, themes: await listThemes(), designedFor: (await loadTheme(themeId)).manifest.appearance?.designedFor ?? "light" };
        } catch (error) {
          payload = previous;
          await Promise.allSettled([...sessions.values()].map((session) => applyCurrent(session, false)));
          throw new Error(`Theme switch rolled back: ${error.message}`);
        }
      });
  const nativeTheme = () => enqueue(async () => {
        const previous = payload;
        try {
          payload = null;
          await Promise.all([...sessions.values()].map((session) => applyCurrent(session, false)));
          await saveActive(null);
          return { activeTheme: null, themes: await listThemes(), native: true };
        } catch (error) { payload = previous; await Promise.allSettled([...sessions.values()].map((session) => applyCurrent(session, false))); throw error; }
      });
  const shutdownTheme = () => enqueue(async () => {
        payload = null;
        await Promise.allSettled([...sessions.values()].map(async (session) => { await session.evaluate(removeExpression); await session.evaluate(removeManagerExpression); }));
        await fs.rm(statePath, { force: true });
        stopping = true;
        return { restored: true, stopped: true };
      });
  if (control) {
    controlServer = await startThemeControl({
      ...control,
      listThemes,
      currentTheme: () => payload?.theme?.id ?? null,
      runtimeReady: () => sessions.size > 0,
      readArtwork: async (id) => {
        const theme = await loadTheme(id);
        if (!theme.artPath) return null;
        return { mimeType: mimeType(theme.artPath), data: await fs.readFile(theme.artPath) };
      },
      switchTheme,
      nativeTheme,
      shutdownTheme,
    });
  }
  const handleBridgeRequest = async (request) => {
    if (request.route === "themes") return { activeTheme: payload?.theme?.id ?? null, runtimeReady: sessions.size > 0, themes: await listThemes() };
    if (request.route === "switch") return switchTheme(request.body?.theme);
    if (request.route === "native") return nativeTheme();
    if (request.route === "open") { if (!controlServer) throw new Error("Theme library is unavailable"); openLoopbackUrl(controlServer.url); return { ok: true }; }
    throw new Error("Unsupported in-app theme action");
  };
  const drainBridge = async (session) => {
    const requests = await session.evaluate(bridgeDrainExpression);
    for (const request of Array.isArray(requests) ? requests : []) {
      try { await session.evaluate(bridgeDeliveryExpression(request.id, await handleBridgeRequest(request), null)); }
      catch (error) { await session.evaluate(bridgeDeliveryExpression(request.id, null, error.message)); }
    }
  };
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
        session.on("Page.loadEventFired", () => setTimeout(() => applyCurrent(session).catch((error) => console.error(error.message)), 250));
        await applyCurrent(session);
        sessions.set(target.id, session);
      } catch (error) { console.error(`[theme-studio] inject failed: ${error.message}`); }
    }
    for (const session of sessions.values()) {
      try { await drainBridge(session); }
      catch (error) { console.error(`[theme-studio] in-app bridge failed: ${error.message}`); }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  for (const session of sessions.values()) session.close();
  controlServer?.server.closeAllConnections?.();
  controlServer?.server.close();
}

const options = parseArgs(process.argv.slice(2));
if (options.mode === "watch") await runWatch(options);
else await runOneShot(options);

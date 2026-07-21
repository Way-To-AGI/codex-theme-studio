#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildThemePackage, contrastRatio, createTheme, importThemePackage, loadTheme, normalizeBrief, validateCss } from "./theme-core.mjs";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "codex-theme-studio-test-"));
try {
  const result = await createTheme({
    id: "self-test-theme",
    name: "Self Test",
    mode: "dark",
    direction: "aurora-glass",
    palette: { accent: "#64DDF2", support: "#A58BFA", surface: "#0D1420", ink: "#222222" },
    background: { source: "none", position: "center right", veil: 0.68 },
    decorations: { density: "standard", sidebarWidget: { enabled: true, content: "quota" }, cornerCard: { enabled: true } },
  }, { outputRoot: temporary });
  assert.equal(result.manifest.engine, "codex-theme-studio");
  assert.ok(result.brief.corrections.includes("ink-adjusted-for-contrast"));
  assert.ok(contrastRatio(result.brief.palette.ink, result.brief.palette.surface) >= 4.5);
  assert.equal(result.manifest.decorations.cornerCard.enabled, true);
  assert.equal(result.manifest.decorations.sidebarWidget.content, "quota");
  assert.equal(result.manifest.appearance.designedFor, "dark");
  assert.equal(result.manifest.quality.grade, "excellent");
  assert.ok(result.manifest.quality.checks.every((check) => check.pass));
  assert.ok(Array.isArray(result.manifest.corrections));
  const loaded = await loadTheme(result.manifestPath);
  assert.equal(loaded.manifest.id, "self-test-theme");
  assert.match(loaded.css, /--color-token-side-bar-background/);
  assert.match(loaded.css, /--cts-accent-ink/);
  assert.match(loaded.css, /pointer-events:\s*none/);
  const packaged = await buildThemePackage(result.manifestPath);
  assert.equal(packaged.bundle.format, "codex-theme");
  assert.ok(Buffer.byteLength(packaged.serialized) < 30 * 1024 * 1024);
  const packagePath = path.join(temporary, "self-test.codex-theme");
  await fs.writeFile(packagePath, packaged.serialized, "utf8");
  const importedRoot = path.join(temporary, "imported");
  const imported = await importThemePackage(packagePath, { outputRoot: importedRoot });
  assert.equal((await loadTheme(imported.manifestPath)).manifest.id, "self-test-theme");
  for (const unsafe of [
    "@import 'https://example.com/x.css';",
    "body{background:url(https://example.com/x.png)}",
    "#root{width:100px}",
    "main.main-surface{position:fixed}",
  ]) assert.throws(() => validateCss(unsafe));
  const renderer = await fs.readFile(new URL("../assets/renderer-inject.js", import.meta.url), "utf8");
  assert.doesNotMatch(renderer, /\.innerHTML\s*=/);
  assert.match(renderer, /aria-hidden/);
  assert.match(renderer, /interactiveRects/);
  assert.match(renderer, /dialogOpen/);
  assert.match(renderer, /updateUsage/);
  assert.match(renderer, /Quota unavailable/);
  assert.doesNotMatch(renderer, /\bfetch\s*\(/);
  const unsafeLight = normalizeBrief({
    id: "unsafe-light",
    mode: "light",
    palette: { accent: "#EEEEEE", support: "#FFFFFF", surface: "#111111", ink: "#DDDDDD" },
  });
  assert.ok(unsafeLight.corrections.includes("surface-lightened-for-light-mode"));
  assert.ok(unsafeLight.corrections.includes("ink-adjusted-for-contrast"));
  assert.ok(unsafeLight.corrections.includes("accent-adjusted-for-ui-contrast"));
  assert.equal(unsafeLight.appearance.designedFor, "light");
  assert.equal(unsafeLight.quality.score, 100);
  assert.ok(unsafeLight.quality.checks.every((check) => check.pass));
  const unsafeDark = normalizeBrief({
    id: "unsafe-dark",
    mode: "dark",
    palette: { accent: "#111111", support: "#151515", surface: "#EEEEEE", ink: "#222222" },
  });
  assert.ok(unsafeDark.corrections.includes("surface-darkened-for-dark-mode"));
  assert.ok(unsafeDark.corrections.includes("accent-adjusted-for-ui-contrast"));
  assert.equal(unsafeDark.appearance.designedFor, "dark");
  assert.equal(unsafeDark.quality.grade, "excellent");
  const studio = await fs.readFile(new URL("../assets/studio/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(studio, /https?:\/\//i);
  assert.doesNotMatch(studio, /result\.innerHTML/);
  assert.match(studio, /id="quotaWidget"/);
  const switcher = await fs.readFile(new URL("../assets/switcher/index.html", import.meta.url), "utf8");
  const inAppSwitcher = await fs.readFile(new URL("../assets/theme-switcher.js", import.meta.url), "utf8");
  const cli = await fs.readFile(new URL("./theme.mjs", import.meta.url), "utf8");
  const runtime = await fs.readFile(new URL("./runtime.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(switcher, /https?:\/\//i);
  assert.doesNotMatch(switcher, /\.innerHTML\s*=/);
  assert.doesNotMatch(inAppSwitcher, /\.innerHTML\s*=/);
  assert.doesNotMatch(inAppSwitcher, /\bfetch\s*\(/);
  assert.match(inAppSwitcher, /Switch Codex theme/);
  assert.match(inAppSwitcher, /drainRequests/);
  assert.match(inAppSwitcher, /deliver/);
  for (const command of ["list", "status", "use", "native", "restore", "web", "create", "studio"]) assert.match(cli, new RegExp(`command === "${command}"`));
  assert.match(cli, /theme\.mjs create <agent\|html>/);
  assert.match(cli, /opensHtml: false/);
  assert.match(cli, /opensHtml: true/);
  assert.match(runtime, /\/avatar-overlay/);
  assert.match(runtime, /handleBridgeRequest/);
  assert.match(runtime, /closeAllConnections/);
  assert.match(runtime, /CodexUsageProvider/);
  assert.match(runtime, /usesQuota/);
  assert.match(runtime, /applyToLiveSessions/);
  assert.match(runtime, /acquireWatcherLock/);
  console.log(JSON.stringify({ pass: true, checks: 66 }, null, 2));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

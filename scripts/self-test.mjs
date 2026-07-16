#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildThemePackage, contrastRatio, createTheme, importThemePackage, loadTheme, validateCss } from "./theme-core.mjs";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "codex-theme-studio-test-"));
try {
  const result = await createTheme({
    id: "self-test-theme",
    name: "Self Test",
    mode: "dark",
    direction: "aurora-glass",
    palette: { accent: "#64DDF2", support: "#A58BFA", surface: "#0D1420", ink: "#222222" },
    background: { source: "none", position: "center right", veil: 0.68 },
    decorations: { density: "standard", sidebarWidget: { enabled: true }, cornerCard: { enabled: true } },
  }, { outputRoot: temporary });
  assert.equal(result.manifest.engine, "codex-theme-studio");
  assert.ok(result.brief.corrections.includes("ink-adjusted-for-contrast"));
  assert.ok(contrastRatio(result.brief.palette.ink, result.brief.palette.surface) >= 4.5);
  assert.equal(result.manifest.decorations.cornerCard.enabled, true);
  const loaded = await loadTheme(result.manifestPath);
  assert.equal(loaded.manifest.id, "self-test-theme");
  assert.match(loaded.css, /--color-token-side-bar-background/);
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
  const studio = await fs.readFile(new URL("../assets/studio/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(studio, /https?:\/\//i);
  assert.doesNotMatch(studio, /result\.innerHTML/);
  console.log(JSON.stringify({ pass: true, checks: 21 }, null, 2));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

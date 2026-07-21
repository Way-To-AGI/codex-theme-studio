import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const skillRoot = path.resolve(here, "..");
export const themesRoot = path.join(skillRoot, "themes");
export const MAX_PACKAGE_BYTES = 30 * 1024 * 1024;

const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/i;
const HEX = /^#[0-9a-f]{6}$/i;
const MODES = new Set(["light", "dark"]);
const DIRECTIONS = new Set(["quiet-editorial", "aurora-glass", "cyber-neon", "warm-studio", "custom"]);
const DENSITIES = new Set(["none", "light", "standard"]);
const SHADOWS = new Set(["none", "soft", "crisp"]);
const ART_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const UNSAFE_CSS = [
  /@import\s/i,
  /url\(\s*["']?(?!data:|var\()/i,
  /javascript\s*:/i,
  /expression\s*\(/i,
  /behavior\s*:/i,
  /-moz-binding\s*:/i,
  /(^|[^-\w])#root([^\w-]|$)/im,
];
const NATIVE_SELECTOR = /aside\.app-shell-left-panel|main\.main-surface|\.composer-surface-chrome/i;
const LAYOUT_PROPERTY = /(?:^|;)\s*(?:position|z-index|display|visibility|pointer-events|transform|(?:min-|max-)?width|(?:min-|max-)?height)\s*:/im;

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function text(value, fallback, max = 80) {
  const result = typeof value === "string" ? value.trim() : "";
  return (result || fallback).slice(0, max);
}

function hex(value, fallback) {
  return HEX.test(value ?? "") ? value.toUpperCase() : fallback;
}

function rgb(value) {
  return [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
}

function toHex(values) {
  return `#${values.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function mix(a, b, weight = 0.5) {
  const aa = rgb(a);
  const bb = rgb(b);
  return toHex(aa.map((value, index) => value * (1 - weight) + bb[index] * weight));
}

function alpha(value, opacity) {
  const [r, g, b] = rgb(value);
  return `rgba(${r}, ${g}, ${b}, ${clamp(opacity, 0, 1, 1).toFixed(3)})`;
}

function luminance(value) {
  return rgb(value)
    .map((channel) => channel / 255)
    .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

export function contrastRatio(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function moveUntil(color, target, predicate) {
  let result = color;
  for (let step = 0; step < 24 && !predicate(result); step += 1) result = mix(result, target, 0.08);
  return result;
}

function ensureContrast(color, background, target, direction) {
  return moveUntil(color, direction, (candidate) => contrastRatio(candidate, background) >= target);
}

function normalizePalette(mode, raw, defaults, corrections) {
  const dark = mode === "dark";
  const palette = {
    accent: hex(raw?.accent, defaults.accent),
    support: hex(raw?.support, defaults.support),
    surface: hex(raw?.surface, defaults.surface),
    ink: hex(raw?.ink, defaults.ink),
  };
  const correctedSurface = moveUntil(palette.surface, dark ? "#000000" : "#FFFFFF", (candidate) => dark ? luminance(candidate) <= 0.06 : luminance(candidate) >= 0.78);
  if (correctedSurface !== palette.surface) {
    palette.surface = correctedSurface;
    corrections.push(dark ? "surface-darkened-for-dark-mode" : "surface-lightened-for-light-mode");
  }
  if (contrastRatio(palette.ink, palette.surface) < 4.5) {
    palette.ink = dark ? "#F4F7FA" : "#1D232B";
    corrections.push("ink-adjusted-for-contrast");
  }
  const panel = dark ? mix(palette.surface, "#FFFFFF", 0.065) : mix(palette.surface, "#FFFFFF", 0.56);
  for (const key of ["accent", "support"]) {
    const corrected = moveUntil(palette[key], dark ? "#FFFFFF" : "#000000", (candidate) => (
      contrastRatio(candidate, panel) >= 3 && (dark ? luminance(candidate) > luminance(panel) : luminance(candidate) < luminance(panel))
    ));
    if (corrected !== palette[key]) {
      palette[key] = corrected;
      corrections.push(`${key}-adjusted-for-ui-contrast`);
    }
  }
  return palette;
}

function paletteDefaults(mode, direction) {
  const presets = {
    "quiet-editorial": { accent: "#3867D6", support: "#7C8AA5", surface: "#F4F3EF", ink: "#20242B" },
    "aurora-glass": { accent: "#64DDF2", support: "#A58BFA", surface: "#0D1420", ink: "#F2F7FA" },
    "cyber-neon": { accent: "#F4E527", support: "#32D8FF", surface: "#080D18", ink: "#F5F7FA" },
    "warm-studio": { accent: "#FF7A45", support: "#E0A82E", surface: "#FAF4E8", ink: "#302821" },
  };
  const picked = presets[direction] ?? presets[mode === "dark" ? "aurora-glass" : "quiet-editorial"];
  if (mode === "dark" && luminance(picked.surface) > 0.25) return presets["aurora-glass"];
  if (mode === "light" && luminance(picked.surface) < 0.35) return presets["quiet-editorial"];
  return picked;
}

function normalizeWidget(raw, defaults, enabled, allowQuota = false) {
  return {
    enabled: enabled && raw?.enabled !== false,
    content: allowQuota && raw?.content === "quota" ? "quota" : "static",
    icon: text(raw?.icon, defaults.icon, 4),
    eyebrow: text(raw?.eyebrow, defaults.eyebrow, 24),
    title: text(raw?.title, defaults.title, 32),
    caption: text(raw?.caption, defaults.caption, 56),
  };
}

export function normalizeBrief(raw = {}) {
  const mode = MODES.has(raw.mode) ? raw.mode : "light";
  const direction = DIRECTIONS.has(raw.direction) ? raw.direction : (mode === "dark" ? "aurora-glass" : "quiet-editorial");
  const defaults = paletteDefaults(mode, direction);
  const corrections = Array.isArray(raw.corrections) ? raw.corrections.filter((value) => typeof value === "string").slice(0, 20) : [];
  const palette = normalizePalette(mode, raw.palette, defaults, corrections);
  const id = text(raw.id, `codex-theme-${Date.now()}`, 48).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!SAFE_ID.test(id)) throw new Error("Theme id must contain only letters, digits, hyphens, and underscores");
  const density = DENSITIES.has(raw.decorations?.density) ? raw.decorations.density : "light";
  const allowSidebar = density !== "none";
  const allowCorner = density === "standard";
  const normalized = {
    id,
    name: text(raw.name, id, 64),
    version: /^\d+\.\d+\.\d+$/.test(raw.version ?? "") ? raw.version : "1.0.0",
    mode,
    direction,
    palette,
    background: {
      source: ["builtin", "upload", "generated", "none"].includes(raw.background?.source) ? raw.background.source : "builtin",
      position: text(raw.background?.position, "center right", 32),
      veil: clamp(raw.background?.veil, 0.35, 0.92, mode === "dark" ? 0.68 : 0.78),
      prompt: text(raw.background?.prompt, "", 360),
    },
    shape: {
      radius: clamp(raw.shape?.radius, 8, 24, 16),
      shadow: SHADOWS.has(raw.shape?.shadow) ? raw.shape.shadow : "soft",
    },
    decorations: {
      density,
      sidebarWidget: normalizeWidget(raw.decorations?.sidebarWidget, {
        icon: "✦", eyebrow: "CODEX / STUDIO", title: "Focus mode", caption: "Theme synchronized",
      }, allowSidebar, true),
      cornerCard: normalizeWidget(raw.decorations?.cornerCard, {
        icon: "C", eyebrow: "CREATIVE SPACE", title: "Build with clarity", caption: "Ideas in motion",
      }, allowCorner),
    },
    copy: {
      tagline: text(raw.copy?.tagline, "Build with clarity", 72),
    },
    corrections,
  };
  normalized.appearance = {
    designedFor: mode,
    switchPolicy: "prompt",
    message: mode === "dark"
      ? "This theme is designed for Codex dark appearance. Switch Codex to dark mode if native surfaces look mixed."
      : "This theme is designed for Codex light appearance. Switch Codex to light mode if native surfaces look mixed.",
  };
  normalized.quality = analyzePalette(mode, palette);
  return normalized;
}

function themeColors(brief) {
  const { mode, palette } = brief;
  const dark = mode === "dark";
  const panel = dark ? mix(palette.surface, "#FFFFFF", 0.065) : mix(palette.surface, "#FFFFFF", 0.56);
  const elevated = dark ? mix(palette.surface, "#FFFFFF", 0.11) : mix(palette.surface, "#FFFFFF", 0.76);
  const under = dark ? mix(palette.surface, "#000000", 0.32) : mix(palette.surface, palette.accent, 0.035);
  const mutedBase = mix(palette.ink, palette.surface, dark ? 0.36 : 0.38);
  const muted = ensureContrast(mutedBase, panel, 4.5, palette.ink);
  const borderBase = mix(palette.surface, palette.ink, dark ? 0.24 : 0.18);
  const border = ensureContrast(borderBase, panel, 1.5, palette.ink);
  const accentInk = contrastRatio("#FFFFFF", palette.accent) >= 4.5 ? "#FFFFFF" : "#11151B";
  return { panel, elevated, under, muted, border, accentInk };
}

export function analyzePalette(mode, palette) {
  const colors = themeColors({ mode, palette });
  const checks = [
    ["body", palette.ink, palette.surface, 4.5],
    ["panelText", palette.ink, colors.panel, 4.5],
    ["secondaryText", colors.muted, colors.panel, 4.5],
    ["accent", palette.accent, colors.panel, 3],
    ["support", palette.support, colors.panel, 3],
    ["accentText", colors.accentInk, palette.accent, 4.5],
    ["border", colors.border, colors.panel, 1.5],
  ].map(([id, foreground, background, target]) => {
    const ratio = Number(contrastRatio(foreground, background).toFixed(2));
    return { id, ratio, target, pass: ratio >= target };
  });
  const failed = checks.filter((check) => !check.pass).length;
  const minimumRatio = Math.min(...checks.map((check) => check.ratio));
  return {
    score: Math.max(0, 100 - failed * 18),
    grade: failed === 0 ? "excellent" : failed <= 2 ? "review" : "unsafe",
    minimumRatio,
    checks,
  };
}

export function generateCss(briefInput) {
  const brief = normalizeBrief(briefInput);
  const { palette, mode, shape, background } = brief;
  const c = themeColors(brief);
  const dark = mode === "dark";
  const veil = background.veil;
  const shadow = shape.shadow === "none"
    ? "none"
    : shape.shadow === "crisp"
      ? `0 10px 28px ${alpha("#000000", dark ? 0.34 : 0.13)}, 0 0 0 1px ${alpha(c.border, 0.55)}`
      : `0 18px 48px ${alpha("#000000", dark ? 0.30 : 0.11)}, inset 0 1px ${alpha("#FFFFFF", dark ? 0.08 : 0.72)}`;
  const artPosition = background.position.replace(/[^a-z0-9% .-]/gi, "");
  const baseGradient = dark
    ? `radial-gradient(circle at 82% 8%, ${alpha(palette.support, 0.16)}, transparent 34%), linear-gradient(145deg, ${c.under}, ${palette.surface} 52%, ${mix(palette.surface, palette.accent, 0.08)})`
    : `radial-gradient(circle at 82% 8%, ${alpha(palette.support, 0.14)}, transparent 34%), linear-gradient(145deg, ${mix(palette.surface, "#FFFFFF", 0.58)}, ${palette.surface} 56%, ${mix(palette.surface, palette.accent, 0.07)})`;
  const homeVeil = dark
    ? `linear-gradient(90deg, ${alpha(c.under, Math.min(0.96, veil + 0.14))} 0%, ${alpha(c.under, veil)} 58%, ${alpha(c.under, Math.max(0.32, veil - 0.24))} 100%)`
    : `linear-gradient(90deg, ${alpha(c.elevated, Math.min(0.98, veil + 0.12))} 0%, ${alpha(c.elevated, veil)} 58%, ${alpha(c.elevated, Math.max(0.38, veil - 0.24))} 100%)`;

  return `/* Generated by Codex Theme Studio. Declarative tokens first; native geometry is untouched. */
:root.codex-theme-studio-skin {
  color-scheme: ${mode} !important;
  --cts-accent: ${palette.accent};
  --cts-support: ${palette.support};
  --cts-surface: ${palette.surface};
  --cts-panel: ${c.panel};
  --cts-elevated: ${c.elevated};
  --cts-under: ${c.under};
  --cts-ink: ${palette.ink};
  --cts-muted: ${c.muted};
  --cts-border: ${c.border};
  --cts-accent-ink: ${c.accentInk};
  --cts-radius: ${shape.radius}px;
  --color-background-surface: ${palette.surface} !important;
  --color-background-surface-under: ${c.under} !important;
  --color-background-elevated-primary: ${c.elevated} !important;
  --color-text-foreground: ${palette.ink} !important;
  --color-text-secondary: ${c.muted} !important;
  --color-icon-primary: ${palette.ink} !important;
  --color-icon-secondary: ${c.muted} !important;
  --color-border: ${c.border} !important;
  --color-border-focus: ${palette.accent} !important;
  --color-token-main-surface-primary: ${palette.surface} !important;
  --color-token-side-bar-background: ${c.under} !important;
  --color-token-conversation-body: ${palette.surface} !important;
  --color-token-conversation-header: ${alpha(c.panel, 0.96)} !important;
  --color-token-editor-background: ${c.panel} !important;
  --color-token-input-background: ${alpha(c.elevated, dark ? 0.90 : 0.92)} !important;
  --color-token-input-border: ${c.border} !important;
  --color-token-list-hover-background: ${alpha(palette.accent, dark ? 0.13 : 0.09)} !important;
  --color-token-list-selected-background: ${alpha(palette.accent, dark ? 0.20 : 0.14)} !important;
  --color-token-text-primary: ${palette.ink} !important;
  --color-token-text-secondary: ${c.muted} !important;
}

html.codex-theme-studio-skin body {
  color: var(--cts-ink) !important;
  background: ${baseGradient} !important;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif !important;
}

html.codex-theme-studio-skin aside.app-shell-left-panel {
  color: var(--cts-ink) !important;
  background: linear-gradient(180deg, ${alpha(c.under, 0.97)}, ${alpha(c.panel, 0.94)}) !important;
  border-color: ${alpha(c.border, 0.72)} !important;
  box-shadow: inset -1px 0 ${alpha("#FFFFFF", dark ? 0.05 : 0.66)} !important;
}

html.codex-theme-studio-skin main.main-surface {
  color: var(--cts-ink) !important;
  background: ${baseGradient} !important;
  border-color: ${alpha(c.border, 0.66)} !important;
  box-shadow: ${shadow} !important;
}

html.codex-theme-studio-skin main.main-surface.codex-theme-home-shell {
  background-image: ${homeVeil}, var(--codex-theme-art), ${baseGradient} !important;
  background-repeat: no-repeat !important;
  background-size: cover, cover, cover !important;
  background-position: center, ${artPosition || "center right"}, center !important;
}

html.codex-theme-studio-skin .composer-surface-chrome {
  color: var(--cts-ink) !important;
  background: ${alpha(c.elevated, dark ? 0.88 : 0.90)} !important;
  border-color: ${alpha(palette.accent, dark ? 0.42 : 0.34)} !important;
  border-radius: calc(var(--cts-radius) + 4px) !important;
  box-shadow: 0 12px 38px ${alpha("#000000", dark ? 0.32 : 0.12)}, inset 0 1px ${alpha("#FFFFFF", dark ? 0.08 : 0.78)} !important;
  backdrop-filter: blur(18px) saturate(1.08) !important;
}

html.codex-theme-studio-skin :is([role="dialog"], [aria-modal="true"], [role="menu"], pre, code) {
  border-color: ${alpha(c.border, 0.78)} !important;
}

html.codex-theme-studio-skin :is([role="dialog"], [aria-modal="true"], [role="menu"]) {
  color: var(--cts-ink) !important;
  background-color: ${alpha(c.elevated, dark ? 0.98 : 0.985)} !important;
  box-shadow: 0 22px 70px ${alpha("#000000", dark ? 0.46 : 0.18)} !important;
}

html.codex-theme-studio-skin :is(button, [role="button"], a):focus-visible {
  outline-color: var(--cts-accent) !important;
}

#codex-theme-studio-decorations {
  position: fixed;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  color: var(--cts-ink);
}

#codex-theme-studio-decorations[hidden],
#codex-theme-studio-decorations [hidden] { display: none !important; }

.cts-decoration-card {
  position: fixed;
  box-sizing: border-box;
  overflow: hidden;
  pointer-events: none;
  border: 1px solid ${alpha(palette.accent, dark ? 0.45 : 0.32)};
  border-radius: var(--cts-radius);
  background: linear-gradient(145deg, ${alpha(c.elevated, dark ? 0.90 : 0.94)}, ${alpha(c.panel, dark ? 0.82 : 0.88)});
  box-shadow: 0 14px 36px ${alpha("#000000", dark ? 0.34 : 0.14)}, inset 0 1px ${alpha("#FFFFFF", dark ? 0.08 : 0.74)};
  backdrop-filter: blur(16px) saturate(1.12);
}

.cts-decoration-card::after {
  content: "";
  position: absolute;
  inset: auto -18% -52% 38%;
  height: 110%;
  border-radius: 50%;
  background: radial-gradient(circle, ${alpha(palette.support, 0.23)}, transparent 68%);
}

.cts-decoration-inner { position: relative; z-index: 1; height: 100%; padding: 14px; box-sizing: border-box; }
.cts-decoration-icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 10px; color: var(--cts-accent-ink); background: var(--cts-accent); font-weight: 800; box-shadow: 0 7px 18px ${alpha(palette.accent, 0.28)}; }
.cts-decoration-eyebrow { margin-top: 12px; color: var(--cts-accent); font-size: 9px; font-weight: 800; letter-spacing: .15em; text-transform: uppercase; }
.cts-decoration-title { margin-top: 4px; color: var(--cts-ink); font-size: 14px; line-height: 1.25; font-weight: 760; }
.cts-decoration-caption { margin-top: 5px; color: var(--cts-muted); font-size: 10px; line-height: 1.35; }
.cts-sidebar-widget[data-content="quota"] .cts-decoration-icon { width: 24px; height: 24px; font-size: 10px; }
.cts-sidebar-widget[data-content="quota"] .cts-decoration-eyebrow { margin-top: 7px; }
.cts-sidebar-widget[data-content="quota"] .cts-decoration-title { font-size: 13px; }
.cts-sidebar-widget[data-content="quota"] .cts-decoration-caption { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 8px; }
.cts-quota-rows { display: grid; gap: 5px; margin-top: 7px; }
.cts-quota-line { display: flex; align-items: center; justify-content: space-between; color: var(--cts-muted); font-size: 8px; font-variant-numeric: tabular-nums; }
.cts-quota-value { color: var(--cts-ink); font-weight: 760; }
.cts-quota-track { overflow: hidden; height: 3px; margin-top: 2px; border-radius: 99px; background: ${alpha(c.border, 0.48)}; }
.cts-quota-fill { height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--cts-accent), ${palette.support}); }
.cts-sidebar-widget[data-usage-status="stale"] .cts-quota-fill { opacity: .55; }
.cts-sidebar-widget { width: 176px; height: 142px; }
.cts-corner-card { width: 178px; height: 112px; transform: rotate(-2deg); }

@media (max-width: 1179px), (max-height: 719px) {
  #codex-theme-studio-decorations { display: none !important; }
}

@media (prefers-reduced-motion: reduce) {
  html.codex-theme-studio-skin *, html.codex-theme-studio-skin *::before, html.codex-theme-studio-skin *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
  }
}
`;
}

function assertInside(base, target, label) {
  const relative = path.relative(base, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} must stay inside the theme directory`);
}

export function validateCss(css) {
  if (typeof css !== "string" || !css.trim()) throw new Error("Theme CSS is empty");
  for (const pattern of UNSAFE_CSS) {
    if (pattern.test(css)) throw new Error(`Unsafe theme CSS matched ${pattern}`);
  }
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (NATIVE_SELECTOR.test(rule[1]) && LAYOUT_PROPERTY.test(rule[2])) throw new Error("Theme CSS mutates native layout geometry");
  }
  return true;
}

export async function createTheme(briefInput, options = {}) {
  const brief = normalizeBrief(briefInput);
  const outputRoot = path.resolve(options.outputRoot ?? themesRoot);
  const themeDir = path.join(outputRoot, brief.id);
  await fs.mkdir(themeDir, { recursive: true });
  const css = generateCss(brief);
  validateCss(css);

  let art = null;
  const sourceArt = options.artPath ? path.resolve(options.artPath) : null;
  if (sourceArt) {
    const extension = path.extname(sourceArt).toLowerCase();
    if (!ART_EXTENSIONS.has(extension)) throw new Error("Artwork must be PNG, JPEG, or WebP");
    const stat = await fs.stat(sourceArt);
    if (!stat.isFile() || stat.size > 24 * 1024 * 1024) throw new Error("Artwork is missing or too large");
    art = `background${extension === ".jpeg" ? ".jpg" : extension}`;
    await fs.copyFile(sourceArt, path.join(themeDir, art));
  } else if (options.artData) {
    const extension = ART_EXTENSIONS.has(options.artExtension) ? options.artExtension : ".png";
    if (options.artData.length > 24 * 1024 * 1024) throw new Error("Artwork is too large");
    art = `background${extension === ".jpeg" ? ".jpg" : extension}`;
    await fs.writeFile(path.join(themeDir, art), options.artData);
  } else if (brief.background.source === "builtin") {
    const builtin = path.join(skillRoot, "assets", "studio-default-art.png");
    try {
      await fs.access(builtin);
      art = "background.png";
      await fs.copyFile(builtin, path.join(themeDir, art));
    } catch {
      brief.corrections.push("builtin-art-missing-gradient-fallback-used");
    }
  }

  const manifest = {
    schemaVersion: 1,
    engine: "codex-theme-studio",
    id: brief.id,
    displayName: brief.name,
    version: brief.version,
    css: "theme.css",
    art,
    design: { mode: brief.mode, direction: brief.direction, palette: brief.palette, shape: brief.shape },
    appearance: brief.appearance,
    quality: brief.quality,
    corrections: brief.corrections,
    background: brief.background,
    decorations: brief.decorations,
    copy: {
      brandTitle: brief.name,
      brandSubtitle: "Codex Theme Studio",
      signature: brief.copy.tagline,
      tagline: brief.copy.tagline,
      projectPrefix: "选择项目 · ",
      projectLabel: "选择项目",
      ribbon: brief.decorations.cornerCard.icon,
    },
    baseTheme: {
      mode: brief.mode,
      codeTheme: "codex",
      accent: brief.palette.accent,
      contrast: Math.round(contrastRatio(brief.palette.ink, brief.palette.surface) * 10),
      ink: brief.palette.ink,
      surface: brief.palette.surface,
      opaqueWindows: true,
      fonts: { windowsCode: "Cascadia Code", windowsUi: "Microsoft YaHei UI", macCode: "SF Mono", macUi: "PingFang SC" },
      semanticColors: { diffAdded: brief.mode === "dark" ? "#2F7D57" : "#CDEBD9", diffRemoved: brief.mode === "dark" ? "#8E3F52" : "#F4CCD3", skill: brief.palette.support },
    },
  };
  const manifestPath = path.join(themeDir, `${brief.id}.json`);
  const cssPath = path.join(themeDir, "theme.css");
  await Promise.all([
    fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    fs.writeFile(cssPath, css, "utf8"),
    fs.writeFile(path.join(themeDir, "brief.json"), `${JSON.stringify(brief, null, 2)}\n`, "utf8"),
  ]);
  return { brief, manifest, manifestPath, cssPath, themeDir, artPath: art ? path.join(themeDir, art) : null };
}

export function resolveThemeManifest(reference) {
  if (!reference) throw new Error("A theme id or manifest path is required");
  if (SAFE_ID.test(reference)) return path.join(themesRoot, reference, `${reference}.json`);
  return path.resolve(reference);
}

export async function loadTheme(reference) {
  const manifestPath = resolveThemeManifest(reference);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || !SAFE_ID.test(manifest.id ?? "")) throw new Error("Unsupported or unsafe theme manifest");
  for (const key of ["displayName", "version", "css"]) {
    if (typeof manifest[key] !== "string" || !manifest[key].trim()) throw new Error(`Missing manifest field: ${key}`);
  }
  const base = path.dirname(manifestPath);
  const cssPath = path.resolve(base, manifest.css);
  assertInside(base, cssPath, "CSS path");
  const css = await fs.readFile(cssPath, "utf8");
  validateCss(css);
  let artPath = null;
  if (manifest.art) {
    artPath = path.resolve(base, manifest.art);
    assertInside(base, artPath, "Artwork path");
    if (!ART_EXTENSIONS.has(path.extname(artPath).toLowerCase())) throw new Error("Unsupported artwork type");
    await fs.access(artPath);
  }
  return { manifest, manifestPath, cssPath, css, artPath };
}

export async function listThemes() {
  let entries = [];
  try { entries = await fs.readdir(themesRoot, { withFileTypes: true }); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const themes = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SAFE_ID.test(entry.name)) continue;
    try {
      const theme = await loadTheme(entry.name);
      if (theme.manifest.id !== entry.name) continue;
      themes.push({
        id: theme.manifest.id,
        displayName: theme.manifest.displayName,
        version: theme.manifest.version,
        designedFor: theme.manifest.appearance?.designedFor ?? theme.manifest.design?.mode ?? "light",
        quality: theme.manifest.quality ?? null,
        palette: theme.manifest.design?.palette ?? theme.manifest.baseTheme?.palette ?? null,
        hasArt: Boolean(theme.artPath),
      });
    } catch { /* Invalid themes stay out of every trusted selector. */ }
  }
  return themes.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function mimeType(filename) {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "image/png";
}

export async function buildThemePackage(reference) {
  const theme = await loadTheme(reference);
  const manifest = { ...theme.manifest, css: "theme.css", art: theme.artPath ? path.basename(theme.artPath) : null };
  const bundle = {
    format: "codex-theme",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    manifest,
    css: theme.css,
  };
  if (theme.artPath) {
    bundle.art = { filename: path.basename(theme.artPath), mimeType: mimeType(theme.artPath), base64: (await fs.readFile(theme.artPath)).toString("base64") };
  }
  const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_PACKAGE_BYTES) throw new Error("Theme package exceeds 30 MB");
  return { bundle, serialized };
}

export async function importThemePackage(packagePath, options = {}) {
  const source = path.resolve(packagePath);
  const stat = await fs.stat(source);
  if (!stat.isFile() || stat.size > MAX_PACKAGE_BYTES) throw new Error("Theme package is missing or exceeds 30 MB");
  const bundle = JSON.parse(await fs.readFile(source, "utf8"));
  if (bundle.format !== "codex-theme" || bundle.schemaVersion !== 1) throw new Error("Unsupported theme package format");
  const manifest = bundle.manifest;
  if (!manifest || manifest.schemaVersion !== 1 || !SAFE_ID.test(manifest.id ?? "")) throw new Error("Unsafe package manifest");
  for (const key of ["displayName", "version"]) {
    if (typeof manifest[key] !== "string" || !manifest[key].trim()) throw new Error(`Missing package manifest field: ${key}`);
  }
  validateCss(bundle.css);
  let art = null;
  let artData = null;
  if (bundle.art) {
    if (!manifest.art || path.basename(manifest.art) !== manifest.art || path.basename(bundle.art.filename ?? "") !== bundle.art.filename) throw new Error("Unsafe packaged artwork name");
    const extension = path.extname(bundle.art.filename).toLowerCase();
    if (!ART_EXTENSIONS.has(extension) || !["image/png", "image/jpeg", "image/webp"].includes(bundle.art.mimeType)) throw new Error("Unsupported packaged artwork type");
    if (typeof bundle.art.base64 !== "string" || !/^[a-z0-9+/=]+$/i.test(bundle.art.base64)) throw new Error("Invalid packaged artwork data");
    artData = Buffer.from(bundle.art.base64, "base64");
    if (!artData.length || artData.length > 24 * 1024 * 1024) throw new Error("Packaged artwork is empty or too large");
    art = bundle.art.filename;
  } else if (manifest.art) {
    throw new Error("Package manifest references missing artwork");
  }
  const outputRoot = path.resolve(options.outputRoot ?? themesRoot);
  const themeDir = path.join(outputRoot, manifest.id);
  try {
    await fs.access(themeDir);
    if (!options.force) throw new Error(`Theme ${manifest.id} already exists; use --force to replace it`);
    await fs.rm(themeDir, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.mkdir(themeDir, { recursive: true });
  const normalizedManifest = { ...manifest, engine: manifest.engine ?? "codex-theme-studio", css: "theme.css", art };
  const manifestPath = path.join(themeDir, `${manifest.id}.json`);
  await Promise.all([
    fs.writeFile(manifestPath, `${JSON.stringify(normalizedManifest, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(themeDir, "theme.css"), bundle.css, "utf8"),
    ...(art ? [fs.writeFile(path.join(themeDir, art), artData)] : []),
  ]);
  return { imported: true, id: manifest.id, manifestPath, themeDir, artPath: art ? path.join(themeDir, art) : null };
}

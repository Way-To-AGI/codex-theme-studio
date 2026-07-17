#!/usr/bin/env node
import { loadTheme } from "./theme-core.mjs";

const args = process.argv.slice(2);
const themeIndex = args.indexOf("--theme");
if (themeIndex < 0 || !args[themeIndex + 1]) throw new Error("--theme is required");
if (args.some((arg, index) => arg.startsWith("--") && index !== themeIndex)) throw new Error("Unknown argument");

const theme = await loadTheme(args[themeIndex + 1]);
const designedFor = theme.manifest.appearance?.designedFor ?? theme.manifest.design?.mode ?? theme.manifest.baseTheme?.mode ?? "light";
const quality = theme.manifest.quality ?? null;
const corrections = Array.isArray(theme.manifest.corrections) ? theme.manifest.corrections : [];

console.log(JSON.stringify({
  status: "ready",
  themeId: theme.manifest.id,
  displayName: theme.manifest.displayName,
  designedFor,
  recommendation: designedFor === "dark"
    ? "Switch Codex official appearance to dark before applying if it is currently light."
    : "Switch Codex official appearance to light before applying if it is currently dark.",
  quality,
  corrections,
}, null, 2));

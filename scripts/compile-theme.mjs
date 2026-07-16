#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createTheme } from "./theme-core.mjs";

function parseArgs(argv) {
  const options = { brief: null, art: null, outputRoot: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--brief") options.brief = path.resolve(argv[++index]);
    else if (arg === "--art") options.art = path.resolve(argv[++index]);
    else if (arg === "--output-root") options.outputRoot = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.brief) throw new Error("--brief is required");
  return options;
}

const options = parseArgs(process.argv.slice(2));
const brief = JSON.parse(await fs.readFile(options.brief, "utf8"));
const result = await createTheme(brief, { artPath: options.art, outputRoot: options.outputRoot });
console.log(JSON.stringify({
  created: true,
  id: result.manifest.id,
  manifestPath: result.manifestPath,
  cssPath: result.cssPath,
  artPath: result.artPath,
  contrast: result.manifest.baseTheme.contrast / 10,
  corrections: result.brief.corrections,
}, null, 2));

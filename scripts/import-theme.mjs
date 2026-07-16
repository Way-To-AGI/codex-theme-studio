#!/usr/bin/env node
import path from "node:path";
import { importThemePackage } from "./theme-core.mjs";

function parseArgs(argv) {
  const options = { input: null, outputRoot: null, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") options.input = path.resolve(argv[++index]);
    else if (arg === "--output-root") options.outputRoot = path.resolve(argv[++index]);
    else if (arg === "--force") options.force = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.input) throw new Error("--input is required");
  return options;
}

const options = parseArgs(process.argv.slice(2));
console.log(JSON.stringify(await importThemePackage(options.input, options), null, 2));

#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOverviewSpec, type OverviewSpec } from "./overview-model.ts";

const DATA_TOKEN = "__BRANCH_OVERVIEW_DATA__";
const RUNTIME_TOKEN = "__BRANCH_OVERVIEW_RUNTIME__";

interface BuildArgs {
  manifest: string;
  output: string;
  emitSpec?: string;
}

function printHelp(): void {
  console.log(`Usage:
  node scripts/build-overview.ts --manifest <manifest.json> --output <branch-overview.html>
    [--emit-spec <overview.json>]

Loads Markdown and Mermaid files referenced by a branch-overview manifest, validates
the assembled spec, and builds one self-contained HTML file.`);
}

function parseArgs(args: string[]): BuildArgs {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    printHelp();
    process.exit(0);
  }
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error(
        "Expected --manifest <path>, --output <path>, and optional --emit-spec <path>.",
      );
    }
    values.set(flag, value);
  }
  const manifest = values.get("--manifest");
  const output = values.get("--output");
  const unknownFlags = [...values.keys()].filter(
    (flag) => !["--manifest", "--output", "--emit-spec"].includes(flag),
  );
  if (unknownFlags.length > 0) {
    throw new Error(`Unknown option: ${unknownFlags.join(", ")}.`);
  }
  if (!manifest || !output) {
    throw new Error("Both --manifest and --output are required.");
  }
  const emitSpec = values.get("--emit-spec");
  return {
    manifest: resolve(manifest),
    output: resolve(output),
    ...(emitSpec ? { emitSpec: resolve(emitSpec) } : {}),
  };
}

function replaceToken(source: string, token: string, replacement: string): string {
  const first = source.indexOf(token);
  if (first === -1 || source.indexOf(token, first + token.length) !== -1) {
    throw new Error(`Template must contain exactly one ${token} token.`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + token.length)}`;
}

function encodeForScript(spec: OverviewSpec): string {
  return JSON.stringify(spec)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

async function main(): Promise<void> {
  const { manifest, output, emitSpec } = parseArgs(process.argv.slice(2));
  const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const [spec, template, runtime, verifier] = await Promise.all([
    loadOverviewSpec({ manifest }),
    readFile(resolve(skillRoot, "assets/branch-overview.html"), "utf8"),
    readFile(resolve(skillRoot, "assets/branch-overview-runtime.js"), "utf8"),
    readFile(resolve(skillRoot, "assets/branch-overview-verifier.js"), "utf8"),
  ]);
  const withData = replaceToken(template, DATA_TOKEN, encodeForScript(spec));
  const html = replaceToken(withData, RUNTIME_TOKEN, `${runtime}\n${verifier}`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html, "utf8");
  if (emitSpec) {
    await mkdir(dirname(emitSpec), { recursive: true });
    await writeFile(emitSpec, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  }
  console.log(output);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Could not build branch overview: ${message}`);
  process.exitCode = 1;
});

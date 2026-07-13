#!/usr/bin/env node
/*
 * Signed-parent trampoline for OpenAI's Codex Computer Use MCP client.
 * Run this file with an OpenAI-signed Codex Node binary, not with the host pi
 * Node process. Current OpenAI desktop builds package it under
 * Contents/Resources/cua_node/bin/node; older builds used
 * Contents/Resources/node. The native MCP client checks its responsible
 * process signature, and the bundled Node binary carries OpenAI's Team ID.
 */
const { spawn } = require('node:child_process');
const { existsSync, accessSync, constants } = require('node:fs');
const { dirname, join } = require('node:path');

const DEFAULT_OPENAI_APP_PATHS = [
  '/Applications/ChatGPT.app',
  '/Applications/Codex.app',
];
const CODEX_PLUGIN_NATIVE_APP_RELATIVE_PATH = join(
  'Contents',
  'Resources',
  'plugins',
  'openai-bundled',
  'plugins',
  'computer-use',
  'Codex Computer Use.app',
);

function clientPathFor(nativeAppPath) {
  return join(
    nativeAppPath,
    'Contents',
    'SharedSupport',
    'SkyComputerUseClient.app',
    'Contents',
    'MacOS',
    'SkyComputerUseClient',
  );
}

function isExecutable(filePath) {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveNativeAppPath() {
  if (process.env.PI_CUA_NATIVE_APP_PATH) return process.env.PI_CUA_NATIVE_APP_PATH;

  const bundled = join(__dirname, 'vendor', 'Codex Computer Use.app');
  if (isExecutable(clientPathFor(bundled))) return bundled;

  const openAIAppPath = process.env.PI_CUA_OPENAI_APP_PATH
    || process.env.PI_CUA_CODEX_APP_PATH
    || DEFAULT_OPENAI_APP_PATHS.find(existsSync)
    || DEFAULT_OPENAI_APP_PATHS[0];
  return join(openAIAppPath, CODEX_PLUGIN_NATIVE_APP_RELATIVE_PATH);
}

const nativeAppPath = resolveNativeAppPath();
const clientPath = clientPathFor(nativeAppPath);
if (!existsSync(clientPath) || !isExecutable(clientPath)) {
  process.stderr.write(`SkyComputerUseClient not found or not executable at ${clientPath}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const child = spawn(clientPath, args.length > 0 ? args : ['mcp'], {
  cwd: dirname(nativeAppPath),
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe'],
});

process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

child.on('error', (error) => {
  process.stderr.write(`Failed to launch SkyComputerUseClient: ${error.message}\n`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

const forwardSignal = (signal) => {
  if (!child.killed) child.kill(signal);
};
process.on('SIGTERM', () => forwardSignal('SIGTERM'));
process.on('SIGINT', () => forwardSignal('SIGINT'));

#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { join } = require('node:path');

const env = { ...process.env };

// Some hosts, including automation agents, run Electron tooling with this set
// so Electron behaves like Node. The desktop app must launch real Electron.
env.ELECTRON_RUN_AS_NODE = undefined;

// Electron exits fatally when launched as uid 0 unless --no-sandbox is passed.
// Containers, dev VMs, and CI runners commonly run as root. dev.cjs relies on
// electron-vite's NO_SANDBOX handling for this; here the flag is passed directly.
const args = [join(__dirname, '..')];
if (process.getuid && process.getuid() === 0) {
  args.unshift('--no-sandbox');
}

const child = spawn(require('electron'), args, {
  env,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('exit', (code, signal) => {
  // Signal death (crash, kill) must not surface as success; re-raise on the
  // parent so the wrapper exits with the conventional 128+N status.
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

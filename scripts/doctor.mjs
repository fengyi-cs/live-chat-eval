#!/usr/bin/env node
// scripts/doctor.mjs
// 环境诊断。输出 Node/pnpm 版本、端口占用等，不输出任何密钥或数据内容。
// 用法：node scripts/doctor.mjs

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return '(not found)';
  }
}

function checkPort(port) {
  return new Promise((res) => {
    const srv = createServer();
    srv.listen(port, '127.0.0.1', () => srv.close(() => res(false)));
    srv.on('error', () => res(true));
  });
}

console.log('\n=== live-chat-eval doctor ===\n');

const nodeVer = process.versions.node;
const nodeMajor = parseInt(nodeVer.split('.')[0], 10);
console.log('Node.js:  ', nodeVer, nodeMajor >= 22 ? '✓' : '✗ (need >= 22)');

const pnpmVer = run('pnpm --version');
console.log('pnpm:     ', pnpmVer, pnpmVer === '10.28.2' ? '✓' : '(expected 10.28.2)');

console.log('Platform: ', process.platform, process.arch);
console.log('Root dir: ', ROOT);

for (const rel of ['node_modules', 'apps/web/dist', 'data']) {
  const full = resolve(ROOT, rel);
  console.log('  ' + rel.padEnd(20) + (existsSync(full) ? 'exists' : 'not found'));
}

const port = Number(process.env.PORT ?? 8787);
const inUse = await checkPort(port);
console.log('Port ' + port + ':       ' + (inUse ? 'IN USE ⚠ (server may already be running)' : 'free ✓'));

const relevantEnv = ['PORT', 'HOST', 'LCE_DB_PATH', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'];
const setVars = relevantEnv.filter((k) => process.env[k] !== undefined);
if (setVars.length > 0) {
  console.log('\nEnv vars set (names only):');
  for (const k of setVars) console.log('  ' + k);
} else {
  console.log('\nNo relevant env vars set (using defaults).');
}

console.log('\n=== end ===\n');

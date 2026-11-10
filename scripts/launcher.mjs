#!/usr/bin/env node
// scripts/launcher.mjs
// 跨平台统一启动入口。检测 Node 版本、确保 pnpm 10.28.2、冻结安装依赖、构建前端、启动服务端。
// 用法：node scripts/launcher.mjs
//       node scripts/launcher.mjs --skip-build   （跳过前端重建，仅启动服务端）

import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const REQUIRED_NODE_MAJOR = 22;
const REQUIRED_PNPM = '10.28.2';

// ── 版本检测 ──────────────────────────────────────────────────────────────────

const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
if (nodeMajor < REQUIRED_NODE_MAJOR) {
  console.error(
    `\n[launcher] Error: Node.js >= ${REQUIRED_NODE_MAJOR} required, got ${process.versions.node}.\n` +
    `  Download from https://nodejs.org/ or use a version manager (nvm/fnm).\n`
  );
  process.exit(1);
}
console.log(`[launcher] Node ${process.versions.node} ✓`);

// ── pnpm 检测与安装 ───────────────────────────────────────────────────────────

function pnpmVersion() {
  try {
    return execSync('pnpm --version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

let currentPnpm = pnpmVersion();
if (currentPnpm !== REQUIRED_PNPM) {
  console.log(
    currentPnpm
      ? `[launcher] pnpm ${currentPnpm} found, need ${REQUIRED_PNPM}. Installing via corepack...`
      : `[launcher] pnpm not found. Installing via corepack...`
  );
  try {
    execSync(`corepack enable pnpm`, { cwd: ROOT, stdio: 'inherit' });
    execSync(`corepack use pnpm@${REQUIRED_PNPM}`, { cwd: ROOT, stdio: 'inherit' });
  } catch {
    // corepack 失败时回退到 npm 全局安装
    console.log('[launcher] corepack failed, falling back to npm install -g...');
    execSync(`npm install -g pnpm@${REQUIRED_PNPM}`, { stdio: 'inherit' });
  }
  currentPnpm = pnpmVersion();
}
console.log(`[launcher] pnpm ${currentPnpm} ✓`);

// ── 依赖安装 ──────────────────────────────────────────────────────────────────

console.log('[launcher] Installing dependencies (frozen)...');
execSync('pnpm install --frozen-lockfile', { cwd: ROOT, stdio: 'inherit' });

// ── 前端构建 ──────────────────────────────────────────────────────────────────

const skipBuild = process.argv.includes('--skip-build');
const webDist = join(ROOT, 'apps', 'web', 'dist');

if (!skipBuild) {
  console.log('[launcher] Building frontend...');
  execSync('pnpm build', { cwd: ROOT, stdio: 'inherit' });
} else if (!existsSync(webDist)) {
  console.log('[launcher] --skip-build specified but dist not found; building anyway...');
  execSync('pnpm build', { cwd: ROOT, stdio: 'inherit' });
} else {
  console.log('[launcher] --skip-build: reusing existing frontend dist.');
}

// ── 启动服务端 ────────────────────────────────────────────────────────────────

const port = process.env.PORT ?? '8787';
const host = process.env.HOST ?? '127.0.0.1';

console.log(`\n[launcher] Starting server on http://${host}:${port}\n`);

// 透传所有环境变量，直接执行服务端，子进程绑定到本终端 TTY
const serverEntry = join(ROOT, 'apps', 'server', 'src', 'main.ts');
const tsx = join(ROOT, 'node_modules', '.bin', 'tsx');

const child = spawn(process.execPath, [tsx, serverEntry], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env },
});

child.on('error', (err) => {
  console.error('[launcher] Failed to start server:', err.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    // 正常的 Ctrl+C
    process.exit(0);
  }
  process.exit(code ?? 1);
});

// 透传信号给子进程
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    child.kill(sig);
  });
}

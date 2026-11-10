#!/usr/bin/env node
// scripts/smoke.mjs
// 最小冒烟验收：确认健康检查通过、根路径返回 HTML。
// 假设服务已在运行。用法：node scripts/smoke.mjs

const BASE = 'http://' + (process.env.HOST ?? '127.0.0.1') + ':' + (process.env.PORT ?? '8787');
let passed = 0, failed = 0;

async function check(label, fn) {
  try {
    await fn();
    console.log('  ✓ ' + label);
    passed++;
  } catch (err) {
    console.error('  ✗ ' + label + ': ' + err.message);
    failed++;
  }
}

console.log('\n=== smoke test: ' + BASE + ' ===\n');

await check('/api/health returns ok', async () => {
  const res = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const body = await res.json();
  if (body.status !== 'ok') throw new Error('unexpected status: ' + JSON.stringify(body));
});

await check('root page returns HTML', async () => {
  const res = await fetch(BASE, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('html')) throw new Error('content-type: ' + ct);
});

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  console.error('Smoke test FAILED. Make sure the server is running: node scripts/launcher.mjs');
  process.exit(1);
}
console.log('Smoke test PASSED.\n');

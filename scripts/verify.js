#!/usr/bin/env node
/**
 * The gate. Run it before committing.
 *
 *   npm run verify              everything
 *   npm run verify -- --fast    skip the browser step
 *
 * Ordered cheapest-first so the common failure is also the quickest to find. It
 * starts the dev servers if they are not up, and stops them again only if it was
 * the one that started them.
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER_PORT = Number(process.env.PORT || 3101);
const CLIENT_PORT = Number(process.env.CLIENT_PORT || 5273);
const FAST = process.argv.includes('--fast');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function step(name, fn) {
  process.stdout.write(`  ${name.padEnd(34)}`);
  const started = Date.now();
  try {
    fn();
    console.log(`ok   ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return true;
  } catch (err) {
    console.log(`FAIL ${((Date.now() - started) / 1000).toFixed(1)}s`);
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}` || err.message;
    console.log('\n' + String(out).split('\n').slice(-40).join('\n') + '\n');
    return false;
  }
}

const run = (cmd, cwd = ROOT) =>
  execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });

async function alive(url) {
  try { return (await fetch(url)).ok; } catch { return false; }
}

(async () => {
  console.log('\nFajil verify\n');

  // Pure checks first — no servers needed, and the bank is the thing most often
  // edited by hand.
  if (!step('question bank lint', () => run('node questions/lint.js'))) process.exit(1);
  if (!step('client build', () => run('npm run build', path.join(ROOT, 'client')))) process.exit(1);

  const needServers = true;
  const wasUp = (await alive(`http://localhost:${SERVER_PORT}/health`))
    && (await alive(`http://localhost:${CLIENT_PORT}/`));
  let started = false;

  if (needServers && !wasUp) {
    process.stdout.write('  starting dev servers…            ');
    const r = spawnSync(process.execPath, [path.join(__dirname, 'dev.js'), 'up'], {
      cwd: ROOT, encoding: 'utf8',
    });
    if (r.status !== 0) {
      console.log('FAIL');
      console.log(r.stdout + r.stderr);
      process.exit(1);
    }
    started = true;
    console.log('ok');
    await sleep(500);
  }

  let ok = true;
  // The reliability suite boots its own server on its own port, so it does not care
  // about the pair above — but the browser test does.
  ok = step('reliability (sockets)', () => run('node test-reliability.js')) && ok;
  if (!FAST) {
    ok = step('browser (host + 3 phones)', () =>
      run(`node test-browser.js --url http://localhost:${CLIENT_PORT}`)) && ok;
  }

  if (started) {
    spawnSync(process.execPath, [path.join(__dirname, 'dev.js'), 'down'], { cwd: ROOT });
  }

  console.log(ok ? '\n  all green\n' : '\n  FAILED\n');
  process.exit(ok ? 0 : 1);
})();

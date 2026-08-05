#!/usr/bin/env node
/**
 * Background dev servers.
 *
 *   npm run dev            start both, detached, return when they genuinely answer
 *   npm run dev:status     what is actually listening, and whether it is ours
 *   npm run dev:stop
 *   npm run dev:restart
 *   npm run dev:logs
 *
 * The point of "return when they genuinely answer" is that a server which failed to
 * bind still leaves the npm script exiting 0. See the stale-server trap below.
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, '.dev');
const PIDFILE = path.join(DIR, 'pids.json');

const SERVER_PORT = Number(process.env.PORT || 3101);
const CLIENT_PORT = Number(process.env.CLIENT_PORT || 5273);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

/** Who is listening on a port, if anyone. Windows-first, since that is the box. */
function listenerPid(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano -p tcp | findstr LISTENING | findstr :${port}`, {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      });
      const line = out.split('\n').find((l) => new RegExp(`[:.]${port}\\s`).test(l));
      return line ? Number(line.trim().split(/\s+/).pop()) : null;
    }
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return Number(out.trim().split('\n')[0]) || null;
  } catch {
    return null;
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

async function waitForHttp(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  return false;
}

function readPids() {
  try { return JSON.parse(fs.readFileSync(PIDFILE, 'utf8')); } catch { return {}; }
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      // /T because killing a bare pid leaves npm's child node process serving.
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch { /* already gone */ }
}

async function up() {
  ensureDir();

  /*
   * The stale-server trap.
   *
   * Starting a second server on a taken port fails with EADDRINUSE and exits
   * silently — the original keeps serving, and you spend an hour debugging against
   * code that is not running. Refusing to start is the whole reason this check
   * exists, and why both ports are strict.
   */
  for (const [name, port] of [['server', SERVER_PORT], ['client', CLIENT_PORT]]) {
    if (!(await portFree(port))) {
      const pid = listenerPid(port);
      const ours = readPids();
      const isOurs = pid && (pid === ours.server || pid === ours.client);
      console.error(
        `\n  port ${port} (${name}) is already in use by PID ${pid ?? '?'}` +
        `${isOurs ? ' — ours, already running' : ' — NOT ours'}\n` +
        `  run "npm run dev:status", then "npm run dev:stop" if it is stale.\n`,
      );
      process.exit(1);
    }
  }

  const serverLog = fs.openSync(path.join(DIR, 'server.log'), 'a');
  const clientLog = fs.openSync(path.join(DIR, 'client.log'), 'a');

  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'src', 'index.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(SERVER_PORT) },
    detached: process.platform !== 'win32',
    stdio: ['ignore', serverLog, serverLog],
  });

  const client = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--port', String(CLIENT_PORT), '--strictPort'],
    {
      cwd: path.join(ROOT, 'client'),
      env: { ...process.env, VITE_SERVER_URL: `http://localhost:${SERVER_PORT}` },
      detached: process.platform !== 'win32',
      stdio: ['ignore', clientLog, clientLog],
    },
  );

  server.unref();
  client.unref();
  fs.writeFileSync(PIDFILE, JSON.stringify({ server: server.pid, client: client.pid }, null, 2));

  const okServer = await waitForHttp(`http://localhost:${SERVER_PORT}/health`);
  const okClient = await waitForHttp(`http://localhost:${CLIENT_PORT}/`);

  if (!okServer || !okClient) {
    console.error(`\n  failed to start (server=${okServer} client=${okClient}) — see .dev/*.log\n`);
    process.exit(1);
  }

  console.log(`\n  server  http://localhost:${SERVER_PORT}`);
  console.log(`  client  http://localhost:${CLIENT_PORT}`);
  console.log(`  phones  use your LAN IP on port ${CLIENT_PORT}\n`);
}

function status() {
  const ours = readPids();
  console.log('');
  for (const [name, port] of [['server', SERVER_PORT], ['client', CLIENT_PORT]]) {
    const pid = listenerPid(port);
    const mine = ours[name];
    const tag = !pid ? 'not listening'
      : pid === mine ? `PID ${pid} (ours)`
      : `PID ${pid} — NOT the one we started (${mine ?? 'none'})`;
    console.log(`  ${name.padEnd(7)} :${port}  ${tag}`);
  }
  console.log('');
}

function down() {
  const ours = readPids();
  for (const port of [SERVER_PORT, CLIENT_PORT]) killTree(listenerPid(port));
  for (const pid of Object.values(ours)) killTree(pid);
  try { fs.unlinkSync(PIDFILE); } catch { /* ignore */ }
  console.log('\n  stopped\n');
}

function logs() {
  for (const f of ['server.log', 'client.log']) {
    const p = path.join(DIR, f);
    console.log(`\n─── ${f} ──────────────────────────────`);
    try { console.log(fs.readFileSync(p, 'utf8').split('\n').slice(-30).join('\n')); }
    catch { console.log('  (none)'); }
  }
}

const cmd = process.argv[2] ?? 'up';
(async () => {
  if (cmd === 'up') return up();
  if (cmd === 'down') return down();
  if (cmd === 'status') return status();
  if (cmd === 'logs') return logs();
  if (cmd === 'restart') { down(); await sleep(700); return up(); }
  console.error(`unknown command: ${cmd}`);
  process.exit(1);
})();

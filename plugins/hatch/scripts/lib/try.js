'use strict';
/**
 * lib/try.js — the hands-on test between build and share: the app running on the person's own
 * computer, their checks as the checklist, their verdicts in the ledger. `hatch.js try` is the only
 * caller.
 *
 * Rulings of 2026-10-28: a failure lives in the ledger (the TRY_RESULT blob, in the person's words)
 * and reaches the maker's brief; the checks stay as the interview wrote them. Device checks ("open it
 * on the iPad") are on the list with the same-wifi address, pass only when the person says so, and
 * never block share. The person talks; the script takes a number, an id or a title. "Pass" passes
 * everything left and ends the try pointing at share; a fail on the list ends it pointing at build.
 *
 * State owned here, all in `<project>/.cohdit/local.json` under `try` (gitignored, per working copy):
 *   { run, started, pid, port, url, lan?, items: [ITEM…], results: {ITEM: pass|fail} }
 * The run's records go to the spool and are landed on the shared copy at every verdict (lib/build.js
 * `land`), so another computer's build sees a failed thing as queued again. The app's command comes
 * from stack.json `scaffold.dev`; opening the browser and stopping the app are lib/tools.js's.
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const ml = require('./ledger');
const sp = require('./spec');
const bd = require('./build');
const doc = require('./doctor');
const tools = require('./tools');

const PORT_FROM = Number(process.env.COHDIT_PORT_FROM) || 3000;   // COHDIT_PORT_FROM keeps parallel test files apart
const START_MS = 180000;                         // the app has this long to answer its first request
const POLL_MS = 1000;
const LOG_TAIL = 40;

function current(dir) {
  const t = sp.readLocal(dir).try;
  return t && t.run ? t : null;
}

function save(dir, t) {
  const local = sp.readLocal(dir);
  if (t) local.try = t; else delete local.try;
  sp.writeLocal(dir, local);
}

/** When this computer last started, to the second: a pid is ours only within the same boot, since a
 *  reboot hands the number to some other process. */
function bootTime() {
  return Math.round(Date.now() / 1000 - os.uptime());
}

function owns(t) {
  return !!t.pid && Math.abs((t.boot || 0) - bootTime()) < 5;
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Is the try's app still ours and running? */
function appAlive(t) {
  return owns(t) && processAlive(t.pid);
}

function isStale(t) {
  return ml.hoursBetween(ml.parseTs(ml.utcNow()), ml.parseTs(t.started)) > ml.STALE_RUN_H;
}

/** The things to try, in the idea's order: every finished thing not yet tried, and every device check
 *  once something has been finished (it needs an app to open). A bug a scan found is proved by its
 *  test, never by the person: it is not on the list. */
function toTry(spec, status) {
  const built = spec.items.some((i) => !i.device && ['done', 'tried'].includes(status.get(i.id)));
  const forPerson = (i) => !(i.kind === 'bug' && i.source === 'scan');
  return spec.items.filter((i) => forPerson(i) && (i.device ? built && status.get(i.id) === 'queued' : status.get(i.id) === 'done')).map((i) => i.id);
}

/** Which thing the person means: its number on the list, its id, or its title (whole, or a unique
 *  part). Returns the id or null. */
function resolveItem(spec, items, which) {
  const w = String(which || '').trim();
  if (!w) return null;
  if (/^\d+$/.test(w)) return items[Number(w) - 1] || null;
  if (ml.ITEM_RE.test(w.toUpperCase())) return items.includes(w.toUpperCase()) ? w.toUpperCase() : null;
  const lw = w.toLowerCase();
  const titled = items.map((id) => [id, (spec.items.find((i) => i.id === id) || {}).title || '']);
  const exact = titled.filter(([, t]) => t.toLowerCase() === lw);
  if (exact.length === 1) return exact[0][0];
  const part = titled.filter(([, t]) => t.toLowerCase().includes(lw));
  return part.length === 1 ? part[0][0] : null;
}

/** Does something answer on this port, on either loopback address? A bind check alone misses a
 *  server listening on the other kind of address (a dev server of the person's own on *:3000). */
function taken(port) {
  const probe = (host) => new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 1000 });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.once('timeout', () => { s.destroy(); resolve(false); });
  });
  return Promise.all([probe('127.0.0.1'), probe('::1')]).then((r) => r.some(Boolean));
}

/** The first free port from PORT_FROM: nothing answers on it, and the app's address can be bound. */
async function freePort(host, from) {
  for (let port = from || PORT_FROM; port < (from || PORT_FROM) + 100; port++) {
    if (await taken(port)) continue;
    const bound = await new Promise((resolve) => {
      const s = net.createServer();
      s.once('error', () => resolve(false));
      s.once('listening', () => s.close(() => resolve(true)));
      s.listen(port, host);
    });
    if (bound) return port;
  }
  throw new sp.Invalid('no free port between ' + PORT_FROM + ' and ' + (PORT_FROM + 99));
}

/** This computer's address on the local network, for a phone or tablet on the same wifi; null if none.
 *  The address the default route uses comes first (a connected UDP socket learns it without sending
 *  anything), then the first ordinary IPv4 (what a phone types), never a link-local one. */
function lanAddress() {
  return new Promise((resolve) => {
    const scan = () => {
      for (const list of Object.values(os.networkInterfaces())) {
        for (const a of list || []) if (!a.internal && a.address && !a.address.includes(':') && !a.address.startsWith('169.254.')) return a.address;
      }
      return null;
    };
    try {
      const s = require('dgram').createSocket('udp4');
      s.once('error', () => { s.close(); resolve(scan()); });
      s.connect(53, '1.1.1.1', () => {
        let a = null;
        try { a = s.address().address; } catch (e) { /* no route */ }
        s.close();
        // a tunnel's own address (a point-to-point route, netmask all ones) is no use to a phone on the wifi
        const tunnel = a && Object.values(os.networkInterfaces()).some((list) => (list || []).some((x) => x.address === a && x.netmask === '255.255.255.255'));
        resolve(a && !tunnel && !a.startsWith('127.') && !a.startsWith('169.254.') ? a : scan());
      });
    } catch (e) { resolve(scan()); }
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function logPath(dir) { return path.join(ml.spoolDir(dir), 'try.log'); }

/** Start the app detached, in a process group of its own, logging to the spool. Returns the pid. */
function startApp(dir, port, host) {
  const dev = (sp.loadStack().scaffold || {}).dev || { command: 'npm', args: ['run', 'dev', '--', '-p', '{port}', '-H', '{host}'] };
  const args = (dev.args || []).map((a) => a.replace('{port}', String(port)).replace('{host}', host));
  const fd = fs.openSync(logPath(dir), 'w');
  const env = Object.assign({}, process.env, { PATH: tools.pathWithExtras(), PORT: String(port), BROWSER: 'none' });
  const child = spawn(dev.command || 'npm', args, { cwd: dir, detached: true, stdio: ['ignore', fd, fd], env, shell: process.platform === 'win32' });
  child.on('error', (e) => { try { fs.appendFileSync(logPath(dir), 'hatch: could not start the app: ' + e.message + '\n'); } catch (e2) { /* nothing */ } });
  child.unref();
  fs.closeSync(fd);
  return child.pid;
}

/** Wait until the app accepts a connection (on whichever loopback address it bound: the port was
 *  free when it started, so the first answer is the app's), or it died, or the time is up. */
async function waitUp(pid, port, ms) {
  const deadline = Date.now() + (ms || START_MS);
  for (;;) {
    if (await taken(port)) return true;
    if (!processAlive(pid) || Date.now() >= deadline) return false;
    await sleep(POLL_MS);
  }
}

function logTail(dir) {
  try { return fs.readFileSync(logPath(dir), 'utf8').trim().split('\n').slice(-LOG_TAIL).join('\n'); } catch (e) { return ''; }
}

/** Bring this copy up to date with the shared copy, only when that is safe: a clean tree on main. */
function updateMain(dir) {
  if (!bd.hasRemote(dir) || bd.currentBranch(dir) !== 'main' || bd.dirtyPaths(dir).length) return false;
  if (!bd.fetch(dir)) return false;
  return bd.git(['merge', '-q', '--ff-only', 'origin/main'], dir, false) !== null;
}

/** The packages, when this copy never had them (an idea fetched from the shared copy). */
function ensurePackages(dir) {
  if (process.env.COHDIT_FAKE_SCAFFOLD || fs.existsSync(path.join(dir, 'node_modules'))) return true;
  return doc.realRun('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, timeout: bd.LONG_MS }).code === 0;
}

/** Start the app for a try: port, address, process, first answer. `started(pid, port, boot)` is told
 *  the moment the app is spawned, so a call cut off while waiting leaves nothing unknown behind.
 *  Returns {pid, port, boot, url, lan} or {error} with the log's tail. */
async function launch(dir, withLan, started) {
  const host = withLan ? '0.0.0.0' : 'localhost';
  const port = await freePort(host);
  const pid = startApp(dir, port, host);
  const boot = bootTime();
  if (started) started(pid, port, boot);
  if (!(await waitUp(pid, port))) {
    tools.stopProcess(pid);
    return { error: logTail(dir) || 'the app printed nothing' };
  }
  const lanIp = withLan ? await lanAddress() : null;
  return { pid, port, boot, url: 'http://localhost:' + port, lan: lanIp ? 'http://' + lanIp + ':' + port : null };
}

/** Stop the app (when it is still ours) and close the run: RUN_END, the ledger landed, the pointers
 *  cleared. `t` is the active record, so "not saved online" is said once per run. */
function end(dir, t, outcome) {
  if (owns(t)) tools.stopProcess(t.pid);
  bd.emit(dir, t.run, [['RUN_END', { outcome: outcome || 'ok' }]]);
  bd.land(dir, t, 'Hatch: tried');
  bd.flush(dir, t.run);                                          // the push result of that landing, so nothing of this run stays spooled
  bd.commitLedger(dir, 'Hatch: ledger');
  const active = bd.active(dir);
  if (active && active.run === t.run) ml.clearActiveRun(dir);
  bd.clearPointer(dir, t.session);
  save(dir, null);
}

module.exports = {
  PORT_FROM, START_MS, current, save, bootTime, owns, appAlive, isStale, toTry, resolveItem, taken, freePort, lanAddress,
  startApp, waitUp, logTail, updateMain, ensurePackages, launch, end,
};

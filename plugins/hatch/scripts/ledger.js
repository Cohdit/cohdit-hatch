#!/usr/bin/env node
'use strict';
/**
 * ledger.js — write, flush and check the event ledger. The only writer of events.
 *
 *   ledger.js start --skill build [--base <sha>]        open a run; prints its id (resumes a crashed one)
 *   ledger.js emit CODE [ITEM-NNN] k=v ... [--blob-from FILE|-]
 *   ledger.js end [--outcome ok|stopped|crashed]        RUN_END and close the active run
 *   ledger.js flush [--prune]      spool → .cohdit/ledger/runs/<run>.jsonl (+ blobs); prune old runs
 *   ledger.js status               active run, spooled records, hook errors, spend so far
 *   ledger.js lint                 every problem that would make a rendering wrong; exit 1 if any
 *
 * Every field is validated against data/codes.json before anything is written: a bad call fails
 * now with exit 64, never as a line a parser silently drops later. Timestamps come from the clock
 * (COHDIT_NOW pins them for tests). Exit 0 ok · 2 no active run · 64 bad call.
 *
 * The model never calls this directly: hatch.js does.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ml = require('./lib/ledger');
const api = require('./lib/api');
const cz = require('./lib/codes');

const KEEP_RUNS = 50;
const KEEP_BLOBS = 300;
const MAX_LEDGER_BYTES = 2 * 1024 * 1024;
const USAGE = fs.readFileSync(__filename, 'utf8').split('/**')[1].split('*/')[0].replace(/^ \* ?/gm, '');

function fail(message) {
  process.stderr.write('ledger: ' + message + '\n');
  return 64;
}

function posix(p) {
  return p.split(path.sep).join('/');
}

/** k=v pairs → fields; anything else → extra (positional). */
function parseKv(args) {
  const fields = {}, extra = [];
  for (const a of args) {
    if (a.includes('=') && !a.startsWith('-')) {
      const i = a.indexOf('=');
      fields[a.slice(0, i)] = a.slice(i + 1);
    } else {
      extra.push(a);
    }
  }
  return { fields, extra };
}

/** --k v and --k=v pairs → opts; anything else → extra. */
function parseOpts(args) {
  const opts = {}, extra = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      if (a.includes('=')) {
        const j = a.indexOf('=');
        opts[a.slice(2, j)] = a.slice(j + 1);
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        opts[a.slice(2)] = args[++i];
      } else {
        opts[a.slice(2)] = '';
      }
    } else {
      extra.push(a);
    }
  }
  return { opts, extra };
}

function onlyKeys(obj, allowed) {
  return Object.keys(obj).every((k) => allowed.includes(k));
}

function cmdStart(argv, cwd) {
  const { opts, extra } = parseOpts(argv);
  const skill = opts.skill, base = opts.base;
  if (!skill || extra.length || !onlyKeys(opts, ['skill', 'base'])) return fail('start needs --skill <name> [--base <sha>]');
  const table = cz.load();
  const now = ml.utcNow();
  const cur = ml.activeRun(cwd);
  if (cur) {
    const ageH = ml.hoursBetween(ml.parseTs(now), ml.parseTs(cur.started));
    if (ageH <= ml.STALE_RUN_H && cur.skill === skill) {
      process.stdout.write(cur.run + '\n');          // crash recovery: the same run resumes, never forks
      return 0;
    }
    const why = ageH > ml.STALE_RUN_H ? 'crashed' : 'stopped';
    ml.appendSpool({ c: 'RUN_END', f: { outcome: why }, r: cur.run, ts: now }, cwd);
    process.stderr.write('ledger: closed abandoned run ' + cur.run + '\n');
  }
  const run = now.replace(/[-:]/g, '') + '-' + ml.host() + '-' + crypto.randomBytes(2).toString('hex');
  const raw = { skill, plugin: ml.pluginVersion(), host: ml.host(), os: ml.osName() };
  if (base) raw.base = base;
  const pricesDate = ml.loadPrices().date;
  if (pricesDate) raw.prices = pricesDate;      // which price list this run's estimates come from
  let f;
  try {
    f = cz.coerce(table, 'RUN_START', raw);
  } catch (e) {
    if (!(e instanceof cz.Invalid)) throw e;
    return fail(e.message);
  }
  ml.setActiveRun({ run, started: now, skill, base: base || null, open: {} }, cwd);
  ml.appendSpool({ c: 'RUN_START', f, r: run, ts: now }, cwd);
  process.stdout.write(run + '\n');
  return 0;
}

function cmdEmit(argv, cwd) {
  if (!argv.length) return fail('emit needs a CODE');
  const code = argv[0];
  let rest = argv.slice(1);
  let blobFrom = null;
  const bi = rest.indexOf('--blob-from');
  if (bi >= 0) {
    if (bi + 1 >= rest.length) return fail('--blob-from needs a path or -');
    blobFrom = rest[bi + 1];
    rest = rest.slice(0, bi).concat(rest.slice(bi + 2));
  }
  const { fields, extra } = parseKv(rest);
  let item = null;
  if (extra.length) {
    if (extra.length > 1 || !ml.ITEM_RE.test(extra[0])) return fail(code + ': unexpected argument(s) ' + extra.join(' '));
    item = extra[0];
  }
  const table = cz.load();
  if (!table.codes[code]) return fail('unknown code ' + code);
  const spec = table.codes[code];
  if (spec.item === 'req' && !item) return fail(code + ' needs an ITEM-NNN');
  if (spec.item === 'no' && item) return fail(code + ' does not take an item');
  // Validate everything before touching the spool, so a bad call is always 64 and never a
  // half-written blob. The blob's real id replaces the placeholder once it is stored.
  const bf = blobFrom !== null ? cz.blobField(table, code) : null;
  let text = null;
  if (blobFrom !== null) {
    if (!bf) return fail(code + ' has no blob field');
    try {
      text = fs.readFileSync(blobFrom === '-' ? 0 : blobFrom, 'utf8');
    } catch (e) {
      return fail('cannot read blob: ' + e.message);
    }
    if (!text.trim()) return fail('blob is empty');
    fields[bf] = '0'.repeat(16);
  }
  let f;
  try {
    f = cz.coerce(table, code, fields);
  } catch (e) {
    if (!(e instanceof cz.Invalid)) throw e;
    return fail(e.message);
  }
  const cur = ml.activeRun(cwd);
  if (!cur) {
    process.stderr.write('ledger: no active run — call `ledger.js start` first\n');
    return 2;
  }
  if (text !== null) f[bf] = ml.writeBlob(text, cwd);
  const rec = { c: code, f, r: cur.run, ts: ml.utcNow() };
  if (item) rec.i = item;
  // Bookkeeping hatch.js relies on: which items are open, for usage attribution.
  if (code === 'PICK') {
    cur.open = cur.open || {};
    cur.open[item] = { branch: f.branch, fork: f.fork === undefined ? null : f.fork };
    ml.setActiveRun(cur, cwd);
  } else if (code === 'DONE' || code === 'BLOCKED' || code === 'HELD') {
    if (cur.open) delete cur.open[item];
    ml.setActiveRun(cur, cwd);
  }
  ml.appendSpool(rec, cwd);
  return 0;
}

function cmdEnd(argv, cwd) {
  const { opts, extra } = parseOpts(argv);
  const outcome = opts.outcome === undefined ? 'ok' : opts.outcome;
  if (extra.length || !onlyKeys(opts, ['outcome'])) return fail('end takes only --outcome ok|stopped|crashed');
  const cur = ml.activeRun(cwd);
  if (!cur) {
    process.stderr.write('ledger: no active run\n');
    return 2;
  }
  let f;
  try {
    f = cz.coerce(cz.load(), 'RUN_END', { outcome });
  } catch (e) {
    if (!(e instanceof cz.Invalid)) throw e;
    return fail(e.message);
  }
  ml.appendSpool({ c: 'RUN_END', f, r: cur.run, ts: ml.utcNow() }, cwd);
  return 0;
}

function cohditDir(root) {
  return path.join(root, ml.COHDIT_DIR);
}

function cmdFlush(argv, root, cwd) {
  const prune = argv.includes('--prune');
  const d = ml.spoolDir(cwd);
  const spool = path.join(d, 'spool.jsonl');
  const parts = fs.readdirSync(d).filter((f) => f.startsWith('spool.jsonl.flushing.')).sort().map((f) => path.join(d, f));
  if (fs.existsSync(spool)) {
    const part = spool + '.flushing.' + process.pid;
    fs.renameSync(spool, part);                        // new hook writes start a fresh spool
    parts.push(part);
  }
  let recs = [];
  for (const part of parts) {
    const got = ml.readJsonl(part);
    if (got.bad.length) ml.logError('flush: ' + got.bad.length + ' unreadable spool line(s) dropped', cwd);
    recs = recs.concat(got.recs);
  }
  const byRun = new Map();
  for (const r of recs) {
    const run = r.r || 'no-run';
    if (!byRun.has(run)) byRun.set(run, []);
    byRun.get(run).push(r);
  }
  for (const run of [...byRun.keys()].sort()) {
    const file = path.join(root, ml.LEDGER_DIR, run + '.jsonl');
    const n = ml.appendRecords(file, byRun.get(run));
    if (n) process.stdout.write('flushed ' + n + ' record(s) → ' + posix(path.relative(root, file)) + '\n');
  }
  for (const part of parts) fs.unlinkSync(part);
  // Blobs travel with their events.
  const bdst = path.join(root, ml.BLOB_DIR);
  let moved = 0;
  for (const src of ml.listFiles(path.join(d, 'blobs'), '.txt')) {
    fs.mkdirSync(bdst, { recursive: true });
    const dst = path.join(bdst, path.basename(src));
    if (fs.existsSync(dst)) {
      fs.unlinkSync(src);
    } else {
      fs.renameSync(src, dst);
      moved += 1;
    }
  }
  if (moved) process.stdout.write('moved ' + moved + ' blob(s) → ' + posix(path.relative(root, bdst)) + '\n');
  const cur = ml.activeRun(cwd);
  if (cur && recs.some((r) => r.c === 'RUN_END' && r.r === cur.run)) ml.clearActiveRun(cwd);
  if (prune) pruneLedger(root);
  return 0;
}

/** Keep the newest KEEP_RUNS run files; fold older ones into archive/YYYY-MM.jsonl. Keep the
 *  newest KEEP_BLOBS blobs that a kept record references. */
function pruneLedger(root) {
  const runs = ml.listFiles(path.join(root, ml.LEDGER_DIR), '.jsonl');
  const old = runs.length > KEEP_RUNS ? runs.slice(0, runs.length - KEEP_RUNS) : [];
  const arch = path.join(root, ml.COHDIT_DIR, 'ledger', 'archive');
  for (const file of old) {
    const m = path.basename(file).slice(0, 6);
    const month = m.slice(0, 4) + '-' + m.slice(4, 6);
    ml.appendRecords(path.join(arch, month + '.jsonl'), ml.readJsonl(file).recs);
    fs.unlinkSync(file);
  }
  if (old.length) process.stdout.write('archived ' + old.length + ' run file(s)\n');
  const referenced = new Set();
  for (const r of ml.readLedger(cohditDir(root)).recs) {
    for (const v of Object.values(r.f || {})) {
      if (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v)) referenced.add(v);
    }
  }
  const blobs = ml.listFiles(path.join(root, ml.BLOB_DIR), '.txt')
    .map((p) => [fs.statSync(p).mtimeMs, p])
    .sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map((x) => x[1]);
  let removed = 0;
  for (const file of blobs) {
    const bid = path.basename(file, '.txt');
    if (!referenced.has(bid) || blobs.length - removed > KEEP_BLOBS) {
      fs.unlinkSync(file);
      removed += 1;
    }
  }
  if (removed) process.stdout.write('removed ' + removed + ' orphaned/excess blob(s)\n');
}

function errorCount(cwd) {
  try {
    return fs.readFileSync(path.join(ml.spoolDir(cwd), 'errors.log'), 'utf8').split('\n').filter((l) => l.trim()).length;
  } catch (e) {
    return 0;
  }
}

function cmdStatus(root, cwd) {
  const cur = ml.activeRun(cwd);
  let line = 'active run: ' + (cur ? cur.run : 'none') + ' · spooled: ' + ml.readSpool(cwd).length + ' · hook errors: ' + errorCount(cwd);
  if (cur) {
    const prices = ml.loadPrices();
    let tokens = 0, est = 0;
    for (const r of ml.runRecords(cur.run, cohditDir(root), cwd)) {
      if (r.c !== 'USAGE') continue;
      tokens += ml.usageTokens(r.f.models);
      const c = ml.usageCost(r.f.models, prices);
      if (c) est += c;
    }
    line += ' · tokens ' + ml.fmtTokens(tokens) + ' ≈ $' + est.toFixed(2) + ' at API list price';
  }
  process.stdout.write(line + '\n');
  return 0;
}

function dirBytes(dir) {
  let total = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += dirBytes(p);
    else total += fs.statSync(p).size;
  }
  return total;
}

function cmdLint(root, cwd) {
  const table = cz.load();
  const issues = cz.lint(table, cz.loadRails());
  const { recs, bad } = ml.readLedger(cohditDir(root));
  for (const file of Object.keys(bad).sort()) {
    issues.push(posix(path.relative(root, file)) + ': ' + bad[file].length + ' unreadable line(s) at ' + bad[file].slice(0, 5).join(', '));
  }
  const ends = new Map(), started = new Map();
  for (const r of recs) {
    for (const p of cz.validateRecord(table, r)) issues.push('run ' + r.r + ': ' + p);
    if (r.c === 'RUN_START' || r.c === 'RUN_END') {
      if (!ends.has(r.r)) ends.set(r.r, new Set());
      ends.get(r.r).add(r.c);
      if (r.c === 'RUN_START' && r.ts) started.set(r.r, ml.parseTs(r.ts));
    }
  }
  const cur = ml.activeRun(cwd);
  const now = ml.parseTs(ml.utcNow());
  for (const run of [...ends.keys()].sort()) {
    const fresh = started.has(run) && ml.hoursBetween(now, started.get(run)) <= ml.STALE_RUN_H;
    if (!ends.get(run).has('RUN_END') && !(cur && cur.run === run) && !fresh) issues.push('run ' + run + ' never ended');
  }
  const size = dirBytes(path.join(root, ml.COHDIT_DIR, 'ledger'));
  if (size > MAX_LEDGER_BYTES) issues.push('ledger is ' + Math.floor(size / 1024) + ' KB — run `ledger.js flush --prune`');
  const spooled = ml.readSpool(cwd).length;
  if (spooled) issues.push(spooled + ' record(s) still in the spool — run `ledger.js flush`');
  const errors = errorCount(cwd);
  if (errors) issues.push(errors + ' hook error(s) — see ' + path.join(ml.spoolDir(cwd), 'errors.log'));
  for (const i of issues) process.stdout.write(i + '\n');
  if (issues.length) return 1;
  process.stdout.write('ledger: all readable\n');
  return 0;
}

function main(argv) {
  if (!argv.length || !['start', 'emit', 'end', 'flush', 'status', 'lint'].includes(argv[0])) {
    process.stderr.write(USAGE);
    return 64;
  }
  const cwd = process.cwd();
  let root;
  try {
    root = ml.repoRoot(cwd);
  } catch (e) {
    process.stderr.write('ledger: not inside a git repository\n');
    return 2;
  }
  switch (argv[0]) {
    case 'start': return cmdStart(argv.slice(1), cwd);
    case 'emit': return cmdEmit(argv.slice(1), cwd);
    case 'end': return cmdEnd(argv.slice(1), cwd);
    case 'flush': return cmdFlush(argv.slice(1), root, cwd);
    case 'status': return cmdStatus(root, cwd);
    default: return cmdLint(root, cwd);
  }
}

if (require.main === module) {
  api.preloadData().then(() => main(process.argv.slice(2)), (e) => {
    process.stdout.write(api.message(e.code) + '\n');
    return 1;
  }).then((code) => { process.exitCode = code; });
}
module.exports = { parseKv, parseOpts, main };

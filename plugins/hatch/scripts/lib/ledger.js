'use strict';
/**
 * lib/ledger.js — shared plumbing for the Cohdit event ledger.
 *
 * Lifted as a contract from cohdit-backlog-loop's metrics_ledger.py and re-implemented in Node:
 * exact-match pricing (a model with no price entry is unpriced, never silently priced as a shorter
 * name), one host identity, no RUN.md parsing, no operating-system branches.
 *
 * Every number the ledger holds was recorded by a machine: timestamps by the clock, tokens by
 * usage.js reading Claude Code transcripts, heads and touches by git. The model records verdicts
 * only, and only as enum values validated against data/codes.json.
 *
 * Writers append JSON lines to a spool in the git common dir — outside every working tree, so a
 * hook can never dirty a checkout. `ledger.js flush` moves them into .cohdit/ledger/runs/<run>.jsonl,
 * which travels with the project through git.
 *
 * Record shape (sorted keys, compact, content-hash id):
 *   {"c":CODE,"f":{fields},"i":"ITEM-003"?,"id":sha1[:16],"r":run,"ts":iso,"v":1}
 *
 * Node >= 20, no dependencies. Spawns only `git`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const SCHEMA = 1;
const COHDIT_DIR = '.cohdit';
const LEDGER_DIR = path.join(COHDIT_DIR, 'ledger', 'runs');
const BLOB_DIR = path.join(COHDIT_DIR, 'ledger', 'blobs');
const SCRIPTS = path.dirname(__dirname);
const PLUGIN = path.dirname(SCRIPTS);
const ITEM_RE = /^ITEM-\d{3}$/;
const STALE_RUN_H = 24;        // a run this old with no RUN_END was abandoned, not in progress
const BLOB_MAX = 4096;         // bytes kept of any one blob; the rest is truncated with a marker

// --- canonical JSON ---------------------------------------------------------------------------

/** JSON with every object's keys sorted, compact. The one serialisation the ledger uses. */
function dumps(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

function sha1(text) {
  return crypto.createHash('sha1').update(text, 'utf8').digest('hex');
}

// --- clock ------------------------------------------------------------------------------------

/** The clock, as the ledger writes it. COHDIT_NOW pins it for tests. */
function utcNow() {
  return process.env.COHDIT_NOW || fmtTs(new Date());
}

/** Every timestamp form the ledger meets, as a Date: a bare date, ...Z, fractional seconds
 *  (transcripts) and numeric offsets (git %cI). */
function parseTs(s) {
  let t = String(s).trim();
  if (t.length === 10) t += 'T00:00:00Z';
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) throw new Error('bad timestamp: ' + s);
  return d;
}

function fmtTs(d) {
  return d.toISOString().slice(0, 19) + 'Z';
}

function hoursBetween(later, earlier) {
  return (later.getTime() - earlier.getTime()) / 3600000;
}

// --- identity ---------------------------------------------------------------------------------

/** One identity for this machine: COHDIT_HOST, else the short hostname. Lower-cased and
 *  sanitised so the same machine never appears twice. */
function host() {
  const name = process.env.COHDIT_HOST || os.hostname().split('.')[0] || 'unknown';
  return name.replace(/[^A-Za-z0-9._-]/g, '-').toLowerCase();
}

/** Which kind of operating system this is, as the RUN_START enum names it. */
function osName() {
  const p = process.platform;
  if (p === 'darwin') return 'mac';
  if (p === 'win32') return 'windows';
  if (p === 'linux') return 'linux';
  return 'other';
}

/** This plugin's version. COHDIT_PLUGIN_VERSION pins it for tests. */
function pluginVersion() {
  if (process.env.COHDIT_PLUGIN_VERSION) return process.env.COHDIT_PLUGIN_VERSION;
  try {
    return JSON.parse(fs.readFileSync(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  } catch (e) {
    return 'unknown';
  }
}

// --- git --------------------------------------------------------------------------------------

/** Stripped stdout of a git command. On failure: throw, or null when check is false. */
function git(args, cwd, check = true) {
  try {
    return execFileSync('git', args, { cwd: cwd || undefined, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    if (check) throw new Error('git ' + args.join(' ') + ': ' + String(e.stderr || e.message).trim());
    return null;
  }
}

/** The main worktree, even when called from a secondary worktree. */
function repoRoot(cwd) {
  const out = git(['worktree', 'list', '--porcelain'], cwd);
  return out.split('\n', 1)[0].slice('worktree '.length);
}

function spoolDir(cwd) {
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
  const d = path.join(common, 'cohdit');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Hooks never fail the session; they leave a line here for `ledger.js lint`. */
function logError(message, cwd) {
  try {
    fs.appendFileSync(path.join(spoolDir(cwd), 'errors.log'), utcNow() + ' ' + message.replace(/\n/g, ' | ') + '\n');
  } catch (e) { /* nothing to do */ }
}

// --- records ----------------------------------------------------------------------------------

function recordId(rec) {
  const body = {};
  for (const k of Object.keys(rec)) if (k !== 'id') body[k] = rec[k];
  return sha1(dumps(body)).slice(0, 16);
}

function stamp(rec) {
  const r = Object.assign({}, rec);
  if (r.v === undefined) r.v = SCHEMA;
  if (r.id === undefined) r.id = recordId(r);
  return r;
}

/** One line per record: a single short append, so concurrent hooks interleave whole lines
 *  rather than corrupting each other. */
function appendSpool(rec, cwd) {
  const r = stamp(rec);
  fs.appendFileSync(path.join(spoolDir(cwd), 'spool.jsonl'), dumps(r) + '\n');
  return r;
}

/** {recs, bad}: records and the 1-based numbers of malformed lines. A malformed line is counted,
 *  never silently skipped. */
function readJsonl(file) {
  const recs = [], bad = [];
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { recs, bad };
  }
  const lines = text.split('\n');
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim();
    if (!line) continue;
    try {
      recs.push(JSON.parse(line));
    } catch (e) {
      bad.push(n + 1);
    }
  }
  return { recs, bad };
}

/** Append records whose id the file does not already hold. Returns how many were written. */
function appendRecords(file, recs) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const have = new Set(readJsonl(file).recs.map((r) => r.id));
  const out = [];
  for (const rec of recs) {
    const r = stamp(rec);
    if (!have.has(r.id)) {
      have.add(r.id);
      out.push(dumps(r) + '\n');
    }
  }
  if (out.length) fs.appendFileSync(file, out.join(''));
  return out.length;
}

function readSpool(cwd) {
  return readJsonl(path.join(spoolDir(cwd), 'spool.jsonl')).recs;
}

function listFiles(dir, suffix) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(suffix)).sort().map((f) => path.join(dir, f));
  } catch (e) {
    return [];
  }
}

/** Every committed record under <cohditDir>/ledger/runs, de-duplicated by id:
 *  {recs, bad: {file: [line numbers]}}. Sorted by file name then line order. */
function readLedger(cohditDir) {
  const seen = new Set(), recs = [], bad = {};
  for (const file of listFiles(path.join(cohditDir, 'ledger', 'runs'), '.jsonl')) {
    const got = readJsonl(file);
    if (got.bad.length) bad[file] = got.bad;
    for (const r of got.recs) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      recs.push(r);
    }
  }
  return { recs, bad };
}

/** Where build says which working copy is building: `<home>/.cohdit/active.json`, and per session
 *  `active.<session>.json`, so the usage hook of each session finds its own run. */
function pointerPath(session) {
  const d = path.dirname(settingsPath());
  if (!session) return path.join(d, 'active.json');
  return path.join(d, 'active.' + String(session).replace(/[^A-Za-z0-9._-]/g, '_') + '.json');
}

/** The active run belongs to one working copy: the primary one keeps `active-run.json`; another
 *  working copy of the same repository (a second session on the machine) keeps its own, named by its
 *  path, in the same shared spool. */
function activeRunFile(cwd) {
  const d = spoolDir(cwd);
  const top = git(['rev-parse', '--show-toplevel'], cwd, false);
  if (!top || path.resolve(top) === path.resolve(repoRoot(cwd))) return path.join(d, 'active-run.json');
  return path.join(d, 'active-run.' + sha1(path.resolve(top)).slice(0, 8) + '.json');
}

function activeRun(cwd) {
  try {
    return JSON.parse(fs.readFileSync(activeRunFile(cwd), 'utf8'));
  } catch (e) {
    return null;
  }
}

function setActiveRun(info, cwd) {
  const file = activeRunFile(cwd);
  fs.writeFileSync(file + '.tmp', JSON.stringify(info));
  fs.renameSync(file + '.tmp', file);
}

function clearActiveRun(cwd) {
  try {
    fs.unlinkSync(activeRunFile(cwd));
  } catch (e) { /* already gone */ }
}

/** Last transcript timestamp already recorded for `key`; sets it when value is given.
 *  One file per key, so parallel hooks never race on a shared file. */
function checkpoint(key, cwd, value) {
  const d = path.join(spoolDir(cwd), 'checkpoints');
  fs.mkdirSync(d, { recursive: true });
  const file = path.join(d, sha1(key).slice(0, 16));
  if (value === undefined) {
    try {
      return fs.readFileSync(file, 'utf8').trim() || null;
    } catch (e) {
      return null;
    }
  }
  fs.writeFileSync(file, value);
  return value;
}

/** One run's records: committed ledger plus whatever is still spooled. */
function runRecords(run, cohditDir, cwd) {
  const recs = readLedger(cohditDir).recs.filter((r) => r.r === run);
  const ids = new Set(recs.map((r) => r.id));
  for (const r of readSpool(cwd)) if (r.r === run && !ids.has(r.id)) recs.push(r);
  return recs;
}

// --- what happened to each item ----------------------------------------------------------------

/** Statuses after which a pick means nothing until the item is queued again. */
const SETTLED = ['done', 'blocked', 'refused', 'tried'];

/** Every item's status, derived from the records (every run, every session), with spec.json's own
 *  status as the floor. The one rule render.js, build and try share, so a status is the same
 *  everywhere: DONE → done (to try), BLOCKED, REFUSE, HELD as named, TRY_RESULT pass → tried,
 *  TRY_RESULT fail → queued again, PICK → building while the picking run is alive (no RUN_END and a
 *  record under STALE_RUN_H old at `now`), else the pick lapsed and the item is queued. Returns a Map. */
function itemStatus(recs, items, now) {
  const out = new Map();
  for (const it of items || []) out.set(it.id, it.status || 'queued');
  const all = (recs || []).filter((r) => r && typeof r === 'object');
  const ended = new Set(), last = new Map();
  for (const r of all) {
    if (r.c === 'RUN_END') ended.add(r.r);
    if (!last.has(r.r) || last.get(r.r) < r.ts) last.set(r.r, r.ts);
  }
  const at = now ? (now instanceof Date ? now : parseTs(now)) : parseTs(utcNow());
  const alive = (run) => !ended.has(run) && hoursBetween(at, parseTs(last.get(run))) < STALE_RUN_H;
  const ordered = all.map((r, n) => [r, n]).filter(([r]) => r.i && out.has(r.i))
    .sort((a, b) => (a[0].ts < b[0].ts ? -1 : a[0].ts > b[0].ts ? 1 : a[1] - b[1])).map(([r]) => r);
  const pick = new Map();
  for (const r of ordered) {
    if (r.c === 'DONE') out.set(r.i, 'done');
    else if (r.c === 'BLOCKED') out.set(r.i, 'blocked');
    else if (r.c === 'REFUSE') out.set(r.i, 'refused');
    else if (r.c === 'HELD') out.set(r.i, 'held');
    else if (r.c === 'TRY_RESULT') out.set(r.i, r.f && r.f.result === 'pass' ? 'tried' : 'queued');
    else if (r.c === 'PICK' && !SETTLED.includes(out.get(r.i))) { out.set(r.i, 'building'); pick.set(r.i, r.r); }
  }
  for (const [id, run] of pick) if (out.get(id) === 'building' && !alive(run)) out.set(id, 'queued');
  return out;
}

// --- blobs ------------------------------------------------------------------------------------

function blobId(text) {
  return sha1(text).slice(0, 16);
}

/** Store long text beside the spool; flush moves it to .cohdit/ledger/blobs/. Truncated at
 *  BLOB_MAX bytes with a marker, so no event can drag a whole log into the ledger. */
function writeBlob(text, cwd) {
  let t = text;
  const data = Buffer.from(t, 'utf8');
  if (data.length > BLOB_MAX) {
    t = data.subarray(0, BLOB_MAX).toString('utf8').replace(/�+$/, '') + '\n…[truncated]';
  }
  const bid = blobId(t);
  const d = path.join(spoolDir(cwd), 'blobs');
  fs.mkdirSync(d, { recursive: true });
  const file = path.join(d, bid + '.txt');
  if (!fs.existsSync(file)) fs.writeFileSync(file, t);
  return bid;
}

/** The blob's text from the committed ledger, else the spool (unless cwd === false); null if unknown. */
function readBlob(cohditDir, bid, cwd) {
  const dirs = [path.join(cohditDir, 'ledger', 'blobs')];
  if (cwd !== false) {
    try { dirs.push(path.join(spoolDir(cwd), 'blobs')); } catch (e) { /* not a repo */ }
  }
  for (const d of dirs) {
    try {
      return fs.readFileSync(path.join(d, bid + '.txt'), 'utf8');
    } catch (e) { /* try the next */ }
  }
  return null;
}

// --- prices -----------------------------------------------------------------------------------

function loadPrices(file) {
  return file ? JSON.parse(fs.readFileSync(file, 'utf8')) : require('./api').dataJson('prices');
}

/** Tokens are what Hatch measures; dollars are derived from them at API list price, an estimate
 *  that is never what the person was billed. Total tokens for {model: counters}. */
function usageTokens(models) {
  let n = 0;
  for (const c of Object.values(models)) n += (c.in || 0) + (c.out || 0) + (c.cr || 0) + (c.cw5 || 0) + (c.cw1 || 0);
  return n;
}

/** The same, split by kind — how the estimate is reached. */
function usageKinds(models) {
  const k = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  for (const c of Object.values(models)) {
    k.input += c.in || 0;
    k.output += c.out || 0;
    k.cache_read += c.cr || 0;
    k.cache_write += (c.cw5 || 0) + (c.cw1 || 0);
  }
  return k;
}

/** 950 · 824k · 2.8M — or, with words, 824 thousand · 2.8 million. */
function fmtTokens(n, words) {
  if (n === null || n === undefined) return 'n/a';
  if (n < 1000) return String(Math.round(n));
  const [k, m] = words ? [' thousand', ' million'] : ['k', 'M'];
  if (n < 1e6) return Math.round(n / 1e3) + k;
  const x = n / 1e6;
  return (x < 10 ? x.toFixed(1).replace(/\.0$/, '') : String(Math.round(x))) + m;
}

/** Exact match only. The predecessor matched by longest prefix and silently priced
 *  claude-sonnet-5-5 as claude-sonnet-5, so its trust gate could never notice. */
function modelPrice(prices, model) {
  return Object.prototype.hasOwnProperty.call(prices.models, model) ? prices.models[model] : null;
}

/** List-price USD for {model: counters}. null if any model is unpriced — an unknown model must
 *  surface in the trust gate, never price at zero. */
function usageCost(models, prices) {
  let total = 0;
  for (const model of Object.keys(models)) {
    const p = modelPrice(prices, model);
    if (p === null) return null;
    const c = models[model];
    const i = p.input;
    total += ((c.in || 0) * i
      + (c.out || 0) * p.output
      + (c.cr || 0) * p.cacheRead
      + (c.cw5 || 0) * i * prices.cacheWrite5mMultiplier
      + (c.cw1 || 0) * i * prices.cacheWrite1hMultiplier) / 1e6;
  }
  return total;
}

// --- transcripts ------------------------------------------------------------------------------

/** Characters of text the person could read in one assistant message: its text blocks only. */
function saidChars(content) {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const block of content) if (block && block.type === 'text' && typeof block.text === 'string') n += block.text.length;
  return n;
}

/** The whole context one turn sent: fresh input + cache reads + cache writes. */
function contextOf(u) {
  return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
}

/**
 * Token usage per model in a Claude Code transcript, for rows with after < ts < before.
 *
 * A streamed assistant message repeats its usage row once per content block under one message.id,
 * and only the last row carries the final output count — so the last row per id wins. Returns
 * {models, lastTs}; lastTs is the next checkpoint.
 *
 * ctx_max is the largest context any one turn sent. cold5/cold1 are cache writes on turns that read
 * nothing from cache: the whole context rewritten because the cache expired or the model changed.
 * They are a subset of cw5/cw1, never extra.
 *
 * said is the number of characters of text the model showed the person (text blocks only, never
 * tool calls or thinking). It is how verbosity is measured rather than asserted.
 */
function transcriptUsage(file, after, before) {
  const last = new Map();
  let lastTs = after || null;
  for (const d of readJsonl(file).recs) {
    const ts = d.timestamp || '';
    const m = d.message || {};
    const u = m.usage, mid = m.id, model = m.model;
    if (!u || !mid || !model || model === '<synthetic>') continue;
    if ((after && ts <= after) || (before && ts >= before)) continue;
    const prev = last.get(mid);
    last.set(mid, [model, u, Math.max(prev ? prev[2] : 0, saidChars(m.content))]);
    if (!lastTs || ts > lastTs) lastTs = ts;
  }
  const out = {};
  for (const [model, u, said] of last.values()) {
    const c = out[model] || (out[model] = { in: 0, out: 0, cr: 0, cw5: 0, cw1: 0, cold5: 0, cold1: 0, msgs: 0, ctx_max: 0, said: 0 });
    c.said += said;
    const cc = u.cache_creation;
    let w5, w1;
    if (cc) {
      w5 = cc.ephemeral_5m_input_tokens || 0;
      w1 = cc.ephemeral_1h_input_tokens || 0;
    } else {
      w5 = u.cache_creation_input_tokens || 0;
      w1 = 0;
    }
    c.cw5 += w5;
    c.cw1 += w1;
    if (!u.cache_read_input_tokens) {
      c.cold5 += w5;
      c.cold1 += w1;
    }
    c.in += u.input_tokens || 0;
    c.out += u.output_tokens || 0;
    c.cr += u.cache_read_input_tokens || 0;
    c.msgs += 1;
    c.ctx_max = Math.max(c.ctx_max, contextOf(u));
  }
  return { models: out, lastTs };
}

/** The context the transcript's last turn sent — at a run's start, how much the session already carried. */
function lastContext(file) {
  let last = null;
  for (const d of readJsonl(file).recs) {
    const m = d.message || {};
    if (m.usage && m.model !== '<synthetic>') last = m.usage;
  }
  return last ? contextOf(last) : 0;
}

/** The attribution evidence a subagent transcript carries: the branch it ran on and the item ids
 *  its first prompt names. */
function transcriptMeta(file) {
  let branch = null, prompt = null;
  for (const d of readJsonl(file).recs) {
    if (branch === null && d.gitBranch) branch = d.gitBranch;
    if (prompt === null && d.type === 'user') {
      const c = (d.message || {}).content;
      prompt = typeof c === 'string' ? c : JSON.stringify(c);
    }
    if (branch !== null && prompt !== null) break;
  }
  const items = new Set((prompt || '').match(/ITEM-\d{3}/g) || []);
  return { branch, promptItems: [...items].sort() };
}

/** [item, how]. The branch beats the prompt beats the run's only open item; else none. */
function attribute(meta, openItems) {
  const m = /^item\/(\d{3})/.exec(meta.branch || '');
  if (m) return ['ITEM-' + m[1], 'branch'];
  const named = (meta.promptItems || []).filter((i) => openItems.includes(i));
  if (named.length === 1) return [named[0], 'prompt'];
  if (openItems.length === 1) return [openItems[0], 'window'];
  return [null, 'none'];
}

// --- the person's own settings ----------------------------------------------------------------

/** The person's settings file: `<home>/.cohdit/settings.json`, holding `level` (how Hatch talks to
 *  them). It belongs to the person, not a project. COHDIT_HOME overrides the home directory for tests. */
function settingsPath() {
  return path.join(process.env.COHDIT_HOME || os.homedir(), '.cohdit', 'settings.json');
}

function userSettings() {
  return readJson(settingsPath(), {});
}

// --- project files ----------------------------------------------------------------------------

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

/** The project's .cohdit/spec.json, or null. hatch.js idea is its only writer. */
function loadSpec(cohditDir) {
  return readJson(path.join(cohditDir, 'spec.json'), null);
}

function loadConfig(cohditDir) {
  return readJson(path.join(cohditDir, 'config.json'), {});
}

module.exports = {
  SCHEMA, COHDIT_DIR, LEDGER_DIR, BLOB_DIR, SCRIPTS, PLUGIN, ITEM_RE, STALE_RUN_H, BLOB_MAX,
  dumps, sortKeys, sha1, utcNow, parseTs, fmtTs, hoursBetween, host, osName, pluginVersion,
  git, repoRoot, spoolDir, logError, recordId, stamp, appendSpool, readJsonl, appendRecords,
  readSpool, listFiles, readLedger, pointerPath, activeRunFile, activeRun, setActiveRun, clearActiveRun, checkpoint, runRecords, SETTLED, itemStatus,
  blobId, writeBlob, readBlob, loadPrices, modelPrice, usageCost, usageTokens, usageKinds, fmtTokens, transcriptUsage, contextOf,
  lastContext, transcriptMeta, attribute, settingsPath, userSettings, readJson, loadSpec, loadConfig,
};

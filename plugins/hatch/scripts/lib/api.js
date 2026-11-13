'use strict';
/**
 * lib/api.js — Hatch's content (playbooks, agent briefs, data) comes from Cohdit at run time,
 * authenticated by the person's access key. docs/THIN-CLIENT.md in the site repo is the contract.
 *
 *   fetchContent(kind, name)   the text; cached at ~/.hatch/cache/{kind}/{name}
 *                              kind `expert` is a knowledge agent's pack, named by slug (no list here:
 *                              the server says who owns what); a 403 not_owned drops only that pack
 *   me / askFree / buyLink / manage
 *                              the knowledge-agent calls (JSON, never cached)
 *   preloadExperts(slugs) / expertJson(slug)
 *                              packs for the synchronous build loaders; a pack that fails is left out
 *   setKey(key)                check the shape, store it (mode 600), prove it with GET /skill/setup
 *   keyStatus()                'ok', 'missing', or an error code
 *   preloadData([agents]) / dataJson(name) / agentText(name)
 *                              the scripts read content synchronously: an entry point awaits
 *                              preloadData() once (true adds the read-only agents), then every
 *                              loader calls dataJson() or agentText()
 *
 * HATCH_KEY overrides ~/.hatch/key. HATCH_API overrides the base URL. HATCH_DEV_DIR reads the
 * content from disk instead ({dir}/skills/{name}/SKILL.md, agents/{name}.md, data/{name}.json|.md)
 * with no key and no cache.
 *
 * Every request sends X-Hatch-Machine: a random id made once at ~/.hatch/machine, so Cohdit can see how many
 * computers use one key. It names no person and survives the cache being cleared.
 *
 * A failed request leaves ~/.hatch/down; for a minute after, cached content is served without
 * asking again, so a hung Cohdit costs one wait, not one per command. A 403 deletes the whole cache.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = 'https://www.cohdit.com/api/hatch/v1';
const FRESH_MS = 10 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
// Request time limits in ms; tests shorten them.
const limits = {
  slow: 15000,    // nothing cached to fall back on: wait for a slow Cohdit
  quick: 5000,    // a cached copy to fall back on: give up sooner
};
const DOWN_MS = 60 * 1000;      // after a failed request, use the cache without asking for this long
const KEY_RE = /^hk_sub_[A-Za-z0-9]+\.[A-Za-z0-9_-]{32}$/;
const NAMES = {
  skill: ['setup', 'dream', 'build', 'try', 'share', 'fix', 'remember', 'ask'],
  agent: ['advisor', 'maker', 'checker', 'lens-security', 'lens-privacy', 'lens-compliance', 'lens-cost'],
  data: ['baseline', 'codes', 'domains', 'hosting', 'interview', 'leader', 'lenses', 'lessons', 'prices', 'questions', 'rails', 'stack', 'TERMS'],
};
const MARKDOWN_DATA = ['TERMS'];
// Agents with no Bash: hatch.js writes their instructions next to the brief (lib/build.js writeRole).
const READ_ONLY = ['advisor', 'checker', 'lens-security', 'lens-privacy', 'lens-compliance', 'lens-cost'];
const FORBIDDEN = ['inactive', 'revoked', 'wrong_plan'];
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}$/;

const MESSAGES = {
  bad_key: 'That key does not look right. Copy it again from your welcome page and say "set me up".',
  inactive: 'Your Hatch subscription is not active. Check your email for a receipt, or write to delon@cohdit.com.',
  revoked: 'This key has been turned off. Write to delon@cohdit.com.',
  unavailable: 'Hatch cannot reach Cohdit right now. Try again in a few minutes.',
  missing: 'Hatch needs your access key. Say "set me up" and paste the key from your welcome page.',
  // Not yet worded in the contract.
  wrong_plan: 'Your Hatch plan does not include this. Write to delon@cohdit.com.',
  not_found: 'Hatch is missing a part it needs. Update Hatch, or write to delon@cohdit.com.',
  update_required: 'This part of Hatch needs a newer version. Update Hatch, then try again.',
  not_owned: 'You don\'t have that agent. Say "what agents are there" to see it.',
  no_free_left: 'That was your last free question for this agent.',
  daily_limit: 'That\'s today\'s free questions used. Try again tomorrow.',
  owned: 'You already have that agent.',
  ask_failed: 'The agent couldn\'t answer just now. That one didn\'t count. Try again.',
};

class HatchError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function message(code) { return MESSAGES[code] || MESSAGES.unavailable; }

function home() { return path.join(os.homedir(), '.hatch'); }
function keyFile() { return path.join(home(), 'key'); }
function cacheDir() { return path.join(home(), 'cache'); }
function cacheFile(kind, name) { return path.join(cacheDir(), kind, name); }
function downFile() { return path.join(home(), 'down'); }
function machineFile() { return path.join(home(), 'machine'); }
function devDir() { return process.env.HATCH_DEV_DIR || ''; }
function base() { return (process.env.HATCH_API || BASE).replace(/\/+$/, ''); }

function readKey() {
  if (process.env.HATCH_KEY) return process.env.HATCH_KEY.trim();
  try { return fs.readFileSync(keyFile(), 'utf8').trim() || null; } catch (e) { return null; }
}

function check(kind, name) {
  if (kind === 'expert') { if (!SLUG_RE.test(String(name))) throw new HatchError('not_found'); return; }
  if (!NAMES[kind] || !NAMES[kind].includes(name)) throw new HatchError('not_found');
}

function devPath(kind, name) {
  const d = devDir();
  if (kind === 'skill') return path.join(d, 'skills', name, 'SKILL.md');
  if (kind === 'agent') return path.join(d, 'agents', name + '.md');
  if (kind === 'expert') return path.join(d, 'experts', name + '.json');
  return path.join(d, 'data', name + (MARKDOWN_DATA.includes(name) ? '.md' : '.json'));
}

function readDev(kind, name) {
  try { return fs.readFileSync(devPath(kind, name), 'utf8'); } catch (e) { throw new HatchError('not_found'); }
}

const MACHINE_RE = /^[a-f0-9]{16}$/;

/** This computer's id: random, made once, kept outside the cache. Null if it cannot be stored. */
function machineId() {
  try {
    const id = fs.readFileSync(machineFile(), 'utf8').trim();
    if (MACHINE_RE.test(id)) return id;
  } catch (e) { /* not made yet */ }
  try {
    const id = require('crypto').randomBytes(8).toString('hex');
    fs.mkdirSync(home(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(machineFile(), id + '\n', { mode: 0o600 });
    return id;
  } catch (e) {
    return null;
  }
}

/** One GET (or, with a body, a JSON POST). Resolves {status, body}; rejects on a network error or timeout. */
function get(url, key, ms, body) {
  const lib = url.startsWith('http:') ? require('http') : require('https');
  const headers = { Authorization: 'Bearer ' + key };
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = payload.length; }
  const machine = machineId();
  if (machine) headers['X-Hatch-Machine'] = machine;
  const version = pluginVersion();
  if (version) headers['X-Hatch-Plugin'] = version;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method: payload ? 'POST' : 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
      res.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(new Error('timeout')), ms || limits.slow);   // whole request, not idle time
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end(payload || undefined);
  });
}

/** This plugin's version, sent so the server can keep a newer playbook from an older plugin. */
function pluginVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.claude-plugin', 'plugin.json'), 'utf8')).version || ''; } catch (e) { return ''; }
}

/** A 200 that cannot be right (empty, or data that is not JSON) is treated like Cohdit not answering: the cached copy stays. */
function sound(kind, name, text) {
  if (!text || !text.trim()) return false;
  if ((kind === 'data' && !MARKDOWN_DATA.includes(name)) || kind === 'expert') { try { JSON.parse(text); } catch (e) { return false; } }
  return true;
}

function markDown() {
  try { fs.mkdirSync(home(), { recursive: true, mode: 0o700 }); fs.writeFileSync(downFile(), ''); } catch (e) { /* best effort */ }
}
function recentlyDown(now) { return cacheAge(downFile(), now) < DOWN_MS; }
function clearDown() { fs.rmSync(downFile(), { force: true }); }

function errorCode(res) {
  try { return JSON.parse(res.body).error || null; } catch (e) { return null; }
}

function cacheAge(file, now) {
  try { return now - fs.statSync(file).mtimeMs; } catch (e) { return Infinity; }
}

function writeCache(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Network (or dev dir) only, no cache read: the answer of the server for this key. */
async function request(kind, name, key, ms) {
  const res = await get(base() + '/' + kind + '/' + name, key, ms);
  if (res.status === 200) {
    if (sound(kind, name, res.body)) return res.body;
    const bad = new Error('unsound content');
    bad.retryable = true;
    throw bad;
  }
  if (res.status === 426) throw new HatchError('update_required');
  if (res.status === 401) throw new HatchError('bad_key');
  if (res.status === 403) {
    const code = errorCode(res);
    if (code === 'not_owned') throw new HatchError('not_owned');
    throw new HatchError(FORBIDDEN.includes(code) ? code : 'inactive');
  }
  if (res.status === 404) throw new HatchError('not_found');
  const e = new Error('status ' + res.status);   // 503 and anything else: Cohdit could not answer
  e.retryable = true;
  throw e;
}

async function fetchContent(kind, name) {
  check(kind, name);
  if (devDir()) return readDev(kind, name);
  const file = cacheFile(kind, name);
  const now = Date.now();
  const age = cacheAge(file, now);
  if (age < FRESH_MS) return fs.readFileSync(file, 'utf8');
  const key = readKey();
  if (!key) throw new HatchError('missing');
  const stale = age < STALE_MS;
  if (stale && recentlyDown(now)) return fs.readFileSync(file, 'utf8');
  let text;
  try {
    text = await request(kind, name, key, stale ? limits.quick : limits.slow);
  } catch (e) {
    if (e instanceof HatchError) {
      if (e.code === 'update_required' && stale) return fs.readFileSync(file, 'utf8');   // the older copy still suits this plugin
      if (FORBIDDEN.includes(e.code)) fs.rmSync(cacheDir(), { recursive: true, force: true });
      if (e.code === 'not_owned') fs.rmSync(file, { force: true });   // that agent only; Hatch itself still works
      throw e;
    }
    markDown();
    if (stale) return fs.readFileSync(file, 'utf8');
    throw new HatchError('unavailable');
  }
  clearDown();
  writeCache(file, text);
  return text;
}

/** Store a key and prove it. Returns 'ok' or an error code; the key stays stored either way
 *  unless its shape is wrong. */
async function setKey(key) {
  key = String(key || '').trim();
  if (!KEY_RE.test(key)) return 'bad_key';
  fs.mkdirSync(home(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(keyFile(), key + '\n', { mode: 0o600 });
  fs.chmodSync(keyFile(), 0o600);
  if (devDir()) return 'ok';
  try {
    writeCache(cacheFile('skill', 'setup'), await request('skill', 'setup', key));
    clearDown();
    return 'ok';
  } catch (e) {
    if (!(e instanceof HatchError)) markDown();
    else if (FORBIDDEN.includes(e.code)) fs.rmSync(cacheDir(), { recursive: true, force: true });
    return e instanceof HatchError ? e.code : 'unavailable';
  }
}

async function keyStatus() {
  if (devDir()) return 'ok';
  const key = readKey();
  if (!key) return 'missing';
  if (!KEY_RE.test(key)) return 'bad_key';
  try {
    await fetchContent('skill', 'setup');
    return 'ok';
  } catch (e) {
    return e instanceof HatchError ? e.code : 'unavailable';
  }
}

// --- knowledge agents: JSON calls, never cached ---------------------------------------------------

const JSON_ERRORS = { 402: 'no_free_left', 409: 'owned', 429: 'daily_limit', 502: 'ask_failed' };

/** One JSON call with the key. Resolves the parsed body; rejects with a HatchError. */
async function call(pathname, body) {
  const key = readKey();
  if (!key) throw new HatchError('missing');
  let res;
  try {
    res = await get(base() + pathname, key, limits.slow, body);
  } catch (e) {
    throw new HatchError('unavailable');
  }
  let json = null;
  try { json = JSON.parse(res.body); } catch (e) { /* refused below */ }
  if (res.status === 200 && json && typeof json === 'object') return json;
  const code = json && json.error;
  if (res.status === 401) throw new HatchError('bad_key');
  if (res.status === 403) throw new HatchError(code === 'not_owned' || FORBIDDEN.includes(code) ? code : 'inactive');
  if (res.status === 404) throw new HatchError('not_found');
  if (res.status === 426) throw new HatchError('update_required');
  if (JSON_ERRORS[res.status]) throw new HatchError(JSON_ERRORS[res.status]);
  throw new HatchError('unavailable');
}

/** What this key owns and could add: {experts:[{slug,name,field}], available:[{slug,name,field,pitch,price,free_left}]}. */
function me(opts) { return call('/me' + (opts && opts.fresh ? '?fresh=1' : '')); }
/** One free question to an agent this key does not own: {answer, left}. */
function askFree(slug, question) { check('expert', slug); return call('/ask/' + slug, { question: String(question) }); }
/** A link that subscribes in two clicks: {url}. */
function buyLink(slug) { check('expert', slug); return call('/buy-link', { slug }); }
/** The Stripe billing page: {url}. */
function manage() { return call('/manage'); }

const loaded = new Map();

async function preloadData(agents) {
  if (devDir()) return;
  const want = NAMES.data.map((n) => ['data', n]).concat(agents ? READ_ONLY.map((n) => ['agent', n]) : []);
  const texts = await Promise.all(want.map(([k, n]) => fetchContent(k, n)));
  want.forEach(([k, n], i) => loaded.set(k + '/' + n, texts[i]));
}

function loadedText(kind, name) {
  check(kind, name);
  if (devDir()) return readDev(kind, name);
  if (!loaded.has(kind + '/' + name)) throw new HatchError('unavailable');
  return loaded.get(kind + '/' + name);
}

/** Fetch packs for the synchronous loaders. Resolves the slugs that could not be had; never rejects. */
async function preloadExperts(slugs) {
  const missing = [];
  for (const slug of slugs || []) {
    try {
      const text = await fetchContent('expert', slug);
      JSON.parse(text);
      loaded.set('expert/' + slug, text);
    } catch (e) {
      missing.push(slug);
    }
  }
  return missing;
}

/** A preloaded (or dev-dir) pack, or null when it could not be had. */
function expertJson(slug) {
  try { return JSON.parse(loadedText('expert', slug)); } catch (e) { return null; }
}

function dataText(name) { return loadedText('data', name); }
function agentText(name) { return loadedText('agent', name); }

function dataJson(name) { return JSON.parse(dataText(name)); }

module.exports = {
  BASE, FRESH_MS, STALE_MS, DOWN_MS, KEY_RE, SLUG_RE, limits, NAMES, READ_ONLY, MESSAGES, HatchError, message,
  me, askFree, buyLink, manage, preloadExperts, expertJson,
  home, keyFile, cacheFile, downFile, machineFile, machineId, readKey, fetchContent, setKey, keyStatus, preloadData, dataText, dataJson, agentText,
};

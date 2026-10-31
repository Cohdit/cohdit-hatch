'use strict';
// lib/api.js against a stub server on 127.0.0.1: the cache rules, each error code, the key, the
// dev folder and the two CLI commands. No live network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const api = require('../scripts/lib/api');

const HATCH = path.join(__dirname, '..', 'scripts', 'hatch.js');
// Built from parts so the repo holds no literal key prefix.
const KEY = ['hk', 'sub_test1.'].join('_') + 'a'.repeat(32);
const MIN = 60 * 1000;

let server, port, reply, hits;
test.before(async () => {
  server = http.createServer((req, res) => {
    hits.push({ url: req.url, auth: req.headers.authorization, machine: req.headers['x-hatch-machine'] });
    const r = reply(req);
    res.writeHead(r.status, { 'Content-Type': r.json ? 'application/json' : 'text/markdown', 'X-Hatch-Content-Version': 'v1' });
    res.end(r.json ? JSON.stringify(r.json) : r.body);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
});
test.after(() => server.close());

const ENV = ['HOME', 'USERPROFILE', 'HATCH_API', 'HATCH_KEY', 'HATCH_DEV_DIR'];
let saved;
test.beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hatch-api-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.HATCH_API = 'http://127.0.0.1:' + port + '/api/hatch/v1/';
  delete process.env.HATCH_KEY;
  delete process.env.HATCH_DEV_DIR;
  reply = () => ({ status: 200, body: '# fresh' });
  hits = [];
});
test.afterEach(() => {
  for (const k of ENV) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
});

function storeKey() {
  fs.mkdirSync(api.home(), { recursive: true });
  fs.writeFileSync(api.keyFile(), KEY + '\n');
}
function seedCache(kind, name, text, ageMs) {
  const f = api.cacheFile(kind, name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  const t = (Date.now() - ageMs) / 1000;
  fs.utimesSync(f, t, t);
}
async function code(p) {
  try { await p; } catch (e) { return e.code; }
  return 'resolved';
}

test('a fetch sends the key as a bearer token to {base}/{kind}/{name} and caches the text', async () => {
  storeKey();
  assert.equal(await api.fetchContent('skill', 'dream'), '# fresh');
  assert.deepEqual(hits.map(({ url, auth }) => ({ url, auth })), [{ url: '/api/hatch/v1/skill/dream', auth: 'Bearer ' + KEY }]);
  assert.equal(fs.readFileSync(api.cacheFile('skill', 'dream'), 'utf8'), '# fresh');
});

test('HATCH_KEY wins over the key file', async () => {
  storeKey();
  process.env.HATCH_KEY = '  other  ';
  await api.fetchContent('data', 'codes');
  assert.equal(hits[0].auth, 'Bearer other');
});

test('no key: missing, and nothing is asked of the server', async () => {
  assert.equal(await code(api.fetchContent('skill', 'dream')), 'missing');
  assert.equal(hits.length, 0);
});

test('cache younger than 10 minutes is served without a request', async () => {
  storeKey();
  seedCache('skill', 'dream', '# cached', 9 * MIN);
  assert.equal(await api.fetchContent('skill', 'dream'), '# cached');
  assert.equal(hits.length, 0);
});

test('cache older than 10 minutes is refreshed', async () => {
  storeKey();
  seedCache('skill', 'dream', '# cached', 11 * MIN);
  assert.equal(await api.fetchContent('skill', 'dream'), '# fresh');
  assert.equal(fs.readFileSync(api.cacheFile('skill', 'dream'), 'utf8'), '# fresh');
});

test('503: cache under 24 hours is served, older is unavailable, none is unavailable', async () => {
  storeKey();
  reply = () => ({ status: 503, json: { error: 'unavailable' } });
  seedCache('skill', 'dream', '# stale', 23 * 60 * MIN);
  assert.equal(await api.fetchContent('skill', 'dream'), '# stale');
  seedCache('skill', 'dream', '# stale', 25 * 60 * MIN);
  assert.equal(await code(api.fetchContent('skill', 'dream')), 'unavailable');
  assert.equal(await code(api.fetchContent('skill', 'build')), 'unavailable');
});

test('network error: cache under 24 hours is served, else unavailable', async () => {
  storeKey();
  process.env.HATCH_API = 'http://127.0.0.1:1/api/hatch/v1';   // nothing listens on port 1
  seedCache('skill', 'dream', '# stale', 2 * 60 * MIN);
  assert.equal(await api.fetchContent('skill', 'dream'), '# stale');
  assert.equal(await code(api.fetchContent('skill', 'build')), 'unavailable');
});

test('a hung Cohdit: one short wait, then the cache is used without asking for a minute', async () => {
  storeKey();
  const hang = http.createServer(() => {});   // accepts, never answers
  await new Promise((ok) => hang.listen(0, '127.0.0.1', ok));
  const was = api.limits.quick;
  api.limits.quick = 300;
  try {
    process.env.HATCH_API = 'http://127.0.0.1:' + hang.address().port + '/api/hatch/v1';
    seedCache('skill', 'dream', '# stale', 11 * MIN);
    seedCache('skill', 'build', '# stale build', 11 * MIN);
    let t = Date.now();
    assert.equal(await api.fetchContent('skill', 'dream'), '# stale');
    assert.ok(Date.now() - t >= 250, 'waited for the quick limit');
    assert.ok(fs.existsSync(api.downFile()));
    t = Date.now();
    assert.equal(await api.fetchContent('skill', 'build'), '# stale build');
    assert.ok(Date.now() - t < 200, 'no second wait');
  } finally {
    api.limits.quick = was;
    hang.closeAllConnections();
    hang.close();
  }
});

test('after a minute the down mark expires and Cohdit is asked again; success clears it', async () => {
  storeKey();
  seedCache('skill', 'dream', '# stale', 11 * MIN);
  fs.writeFileSync(api.downFile(), '');
  assert.equal(await api.fetchContent('skill', 'dream'), '# stale');
  assert.equal(hits.length, 0);
  const t = (Date.now() - 61 * 1000) / 1000;
  fs.utimesSync(api.downFile(), t, t);
  assert.equal(await api.fetchContent('skill', 'dream'), '# fresh');
  assert.equal(hits.length, 1);
  assert.equal(fs.existsSync(api.downFile()), false);
});

test('the down mark never stands in for missing content: no cache still asks', async () => {
  storeKey();
  fs.mkdirSync(api.home(), { recursive: true });
  fs.writeFileSync(api.downFile(), '');
  assert.equal(await api.fetchContent('skill', 'dream'), '# fresh');
  assert.equal(hits.length, 1);
});

test('401 is bad_key and never serves the cache', async () => {
  storeKey();
  reply = () => ({ status: 401, json: { error: 'bad_key' } });
  seedCache('skill', 'dream', '# stale', 11 * MIN);
  assert.equal(await code(api.fetchContent('skill', 'dream')), 'bad_key');
});

test('404 is not_found and never serves the cache', async () => {
  storeKey();
  reply = () => ({ status: 404, json: { error: 'not_found' } });
  seedCache('skill', 'dream', '# stale', 11 * MIN);
  assert.equal(await code(api.fetchContent('skill', 'dream')), 'not_found');
});

for (const err of ['inactive', 'revoked', 'wrong_plan']) {
  test('403 ' + err + ' throws its code and deletes the whole cache', async () => {
    storeKey();
    reply = () => ({ status: 403, json: { error: err } });
    seedCache('skill', 'dream', '# stale', 11 * MIN);
    seedCache('skill', 'build', '# fresh build', 1 * MIN);
    seedCache('data', 'codes', '{}', 1 * MIN);
    assert.equal(await code(api.fetchContent('skill', 'dream')), err);
    assert.equal(fs.existsSync(path.dirname(path.dirname(api.cacheFile('skill', 'dream')))), false);
    assert.equal(await code(api.fetchContent('skill', 'build')), err, 'a fresh copy is gone too');
  });
}

test('every request carries this computer\'s id: random, made once, kept when a refusal clears the cache', async () => {
  storeKey();
  await api.fetchContent('skill', 'dream');
  const id = hits[0].machine;
  assert.match(id, /^[a-f0-9]{16}$/);
  assert.equal(fs.readFileSync(api.machineFile(), 'utf8').trim(), id);
  assert.equal(fs.statSync(api.machineFile()).mode & 0o777, 0o600);
  reply = () => ({ status: 403, json: { error: 'inactive' } });
  await code(api.fetchContent('skill', 'build'));
  assert.equal(hits[1].machine, id);
  assert.ok(fs.existsSync(api.machineFile()));
  fs.writeFileSync(api.machineFile(), 'not-an-id\n');
  reply = () => ({ status: 200, body: '# fresh' });
  await api.fetchContent('skill', 'try');
  assert.match(hits[2].machine, /^[a-f0-9]{16}$/);
  assert.notEqual(hits[2].machine, id);
});

test('a name outside the contract is not_found before any request', async () => {
  storeKey();
  assert.equal(await code(api.fetchContent('skill', '../key')), 'not_found');
  assert.equal(await code(api.fetchContent('secret', 'dream')), 'not_found');
  assert.equal(hits.length, 0);
});

test('HATCH_DEV_DIR reads skills, agents and data from disk with no key and no cache', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hatch-dev-'));
  fs.mkdirSync(path.join(d, 'skills', 'dream'), { recursive: true });
  fs.mkdirSync(path.join(d, 'agents'));
  fs.mkdirSync(path.join(d, 'data'));
  fs.writeFileSync(path.join(d, 'skills', 'dream', 'SKILL.md'), '# dev dream');
  fs.writeFileSync(path.join(d, 'agents', 'maker.md'), '# dev maker');
  fs.writeFileSync(path.join(d, 'data', 'codes.json'), '{"v":1}');
  fs.writeFileSync(path.join(d, 'data', 'TERMS.md'), '# Terms');
  process.env.HATCH_DEV_DIR = d;
  assert.equal(await api.fetchContent('skill', 'dream'), '# dev dream');
  assert.equal(await api.fetchContent('agent', 'maker'), '# dev maker');
  assert.equal(await api.fetchContent('data', 'TERMS'), '# Terms');
  assert.deepEqual(api.dataJson('codes'), { v: 1 });
  assert.equal(await code(api.fetchContent('skill', 'build')), 'not_found');
  assert.equal(hits.length, 0);
  assert.equal(fs.existsSync(api.home()), false);
});

test('preloadData fetches every data file once; dataJson then reads it synchronously', async () => {
  storeKey();
  reply = (req) => ({ status: 200, body: JSON.stringify({ name: req.url.split('/').pop() }) });
  await api.preloadData();
  assert.equal(hits.length, api.NAMES.data.length);
  assert.deepEqual(api.dataJson('stack'), { name: 'stack' });
});

test('preloadData(true) adds the read-only agents; agentText reads them synchronously', async () => {
  storeKey();
  reply = (req) => ({ status: 200, body: '# ' + req.url.split('/').slice(-2).join('/') });
  await api.preloadData(true);
  assert.equal(hits.length, api.NAMES.data.length + api.READ_ONLY.length);
  assert.equal(api.agentText('lens-cost'), '# agent/lens-cost');
  assert.equal(api.dataText('TERMS'), '# data/TERMS');
  assert.throws(() => api.agentText('../maker'), (e) => e.code === 'not_found');
});

test('setKey refuses a wrong shape and stores nothing', async () => {
  assert.equal(await api.setKey('not-a-key'), 'bad_key');
  assert.equal(await api.setKey(KEY + 'x'), 'bad_key');
  assert.equal(fs.existsSync(api.keyFile()), false);
  assert.equal(hits.length, 0);
});

test('setKey stores the key (mode 600) and proves it with GET /skill/setup', async () => {
  assert.equal(await api.setKey('  ' + KEY + '\n'), 'ok');
  assert.equal(fs.readFileSync(api.keyFile(), 'utf8').trim(), KEY);
  if (process.platform !== 'win32') assert.equal(fs.statSync(api.keyFile()).mode & 0o777, 0o600);
  assert.deepEqual(hits.map((h) => h.url), ['/api/hatch/v1/skill/setup']);
});

test('setKey reports the server\'s refusal', async () => {
  reply = () => ({ status: 403, json: { error: 'inactive' } });
  assert.equal(await api.setKey(KEY), 'inactive');
});

test('keyStatus: missing, bad_key on shape, ok, then the server\'s code', async () => {
  assert.equal(await api.keyStatus(), 'missing');
  process.env.HATCH_KEY = 'nope';
  assert.equal(await api.keyStatus(), 'bad_key');
  delete process.env.HATCH_KEY;
  storeKey();
  assert.equal(await api.keyStatus(), 'ok');
  fs.rmSync(api.cacheFile('skill', 'setup'));
  reply = () => ({ status: 403, json: { error: 'revoked' } });
  assert.equal(await api.keyStatus(), 'revoked');
});

function run(args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [HATCH, ...args], { env: process.env });
    let out = '', err = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (status) => resolve({ status, out, err }));
  });
}

test('cli: content prints the text with the plugin path filled in', async () => {
  storeKey();
  reply = () => ({ status: 200, body: 'Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/hatch.js" idea new`' });
  const r = await run(['content', 'skill', 'dream']);
  assert.equal(r.status, 0);
  assert.equal(r.out, 'Run `node "' + path.join(__dirname, '..') + '/scripts/hatch.js" idea new`');
});

test('cli: every error is one line for the person, word for word from the contract, exit 1', async () => {
  const cases = { bad_key: 401, inactive: 403, revoked: 403, unavailable: 503 };
  storeKey();
  for (const [err, status] of Object.entries(cases)) {
    reply = () => ({ status, json: { error: err } });
    const r = await run(['content', 'skill', 'dream']);
    assert.equal(r.status, 1, err);
    assert.equal(r.out, api.MESSAGES[err] + '\n');
  }
  fs.rmSync(api.keyFile());
  const r = await run(['content', 'skill', 'dream']);
  assert.equal(r.out, 'Hatch needs your access key. Say "set me up" and paste the key from your welcome page.\n');
});

test('cli: a data command with no key says so instead of crashing', async () => {
  const r = await run(['level']);
  assert.equal(r.status, 1);
  assert.equal(r.out, api.MESSAGES.missing + '\n');
});

test('cli: key set and key status never print the key', async () => {
  let r = await run(['key', 'status']);
  assert.deepEqual([r.status, r.out], [1, 'missing\n']);
  r = await run(['key', 'set', 'wrong']);
  assert.deepEqual([r.status, r.out], [1, api.MESSAGES.bad_key + '\n']);
  r = await run(['key', 'set', KEY]);
  assert.deepEqual([r.status, r.out], [0, 'ok\n']);
  r = await run(['key', 'status']);
  assert.deepEqual([r.status, r.out], [0, 'ok\n']);
  for (const x of [r.out, r.err]) assert.ok(!x.includes(KEY));
});

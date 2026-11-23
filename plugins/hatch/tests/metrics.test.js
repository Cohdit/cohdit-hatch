'use strict';
// lib/metrics.js: consent, the allowlist, what a run's payload holds, and the anonymous send.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hatch-metrics-'));
process.env.HOME = home; process.env.USERPROFILE = home; process.env.COHDIT_HOME = home;
delete process.env.HATCH_KEY;
const mt = require('../scripts/lib/metrics');
const api = require('../scripts/lib/api');
const render = require('../scripts/render');
const ml = require('../scripts/lib/ledger');

const FIX = path.join(__dirname, 'fixtures', 'happy');
const DEV = process.env.HATCH_DEV_DIR;
const KEY = ['hk', 'sub_test1.'].join('_') + 'a'.repeat(32);
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

function ctx() { return new render.Ctx({ level: 'tech', cohdit: FIX }); }
function lastBuildRun(c) {
  const ended = c.recs.filter((r) => r.c === 'RUN_END').map((r) => r.r);
  return ended.filter((r) => c.recs.some((x) => x.r === r && x.c === 'RUN_START' && x.f.skill === 'build')).pop();
}

test('consent: undecided is ask, never on; the answer is kept', () => {
  assert.equal(mt.status(), 'ask');
  mt.set('on'); assert.equal(mt.status(), 'on');
  mt.set('off'); assert.equal(mt.status(), 'off');
  assert.throws(() => mt.set('yes'));
  assert.equal(mt.askedOnce(), true, 'asked the first time');
  assert.equal(mt.askedOnce(), false, 'and only once');
});

test('a run payload passes the allowlist and holds no words from the project', () => {
  const c = ctx();
  const run = lastBuildRun(c);
  assert.ok(run, 'the fixture has a finished build run');
  const p = mt.build(c, run, render);
  assert.deepEqual(mt.check(p), []);
  assert.equal(p.v, 1);
  assert.match(p.id, /^[a-f0-9]{16}$/);
  assert.notEqual(p.id, api.machineId(), 'the install id is not the machine id');
  const text = JSON.stringify(p);
  const spec = ml.loadSpec(FIX) || {};
  for (const it of spec.items || []) assert.ok(!text.includes(it.title), 'no item title: ' + it.title);
  if (spec.name) assert.ok(!text.includes(spec.name), 'no idea name');
  assert.ok(!text.includes(KEY));
  assert.equal(mt.build(c, 'no-such-run', render), null);
});

test('the allowlist refuses free text, unknown fields and wrong types', () => {
  const good = mt.build(ctx(), lastBuildRun(ctx()), render);
  const bad = (patch) => mt.check(Object.assign({}, good, patch));
  assert.ok(bad({ stop: 'my secret idea about rentals' }).length, 'free text in a label');
  assert.ok(bad({ title: 'Add a chore' }).length, 'an unknown field');
  assert.ok(bad({ done: '3' }).length, 'a number as text');
  assert.ok(bad({ done: -1 }).length, 'a negative count');
  assert.ok(bad({ first_pass: 1.5 }).length, 'a rate over 1');
  assert.ok(bad({ tokens: Object.assign({}, good.tokens, { note: 'x' }) }).length, 'an unknown nested field');
  assert.ok(bad({ models: ['/Users/me/app'] }).length, 'a path as a model');
  assert.ok(bad({ owner: 'asked a lot' }).length, 'a string where an object belongs');
  assert.ok(bad({ id: 'abc' }).length, 'an id that is not the random id');
});

test('record: off sends and keeps nothing; on without a key keeps it queued', async () => {
  mt.set('off');
  assert.equal(await mt.record(ctx(), lastBuildRun(ctx()), render), 'off');
  assert.deepEqual(mt.queued(), []);
  mt.set('on');
  assert.equal(await mt.record(ctx(), lastBuildRun(ctx()), render), 'ok');
  assert.equal(mt.queued().length, 1, 'no key: kept for later');
  await mt.record(ctx(), lastBuildRun(ctx()), render);
  assert.equal(mt.queued().length, 1, 'the same run is not queued twice');
});

test('the send is anonymous: key for the door, no machine id, body is the payload', async () => {
  const hits = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => { hits.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  process.env.HATCH_API = 'http://127.0.0.1:' + server.address().port;
  process.env.HATCH_KEY = KEY; delete process.env.HATCH_DEV_DIR;   // dev content mode never sends
  try {
    api.machineId();   // a machine id exists, and still must not be sent
    mt.set('on');
    const sent = await mt.flush();
    assert.equal(sent, 1);
    assert.deepEqual(mt.queued(), [], 'sent ones leave the queue');
    assert.equal(hits[0].url, '/metrics');
    assert.equal(hits[0].headers.authorization, 'Bearer ' + KEY);
    assert.equal(hits[0].headers['x-hatch-machine'], undefined);
    assert.deepEqual(mt.check(JSON.parse(hits[0].body)), []);
    assert.ok(!hits[0].body.includes(KEY));
    assert.ok(!hits[0].body.includes(api.machineId()));
  } finally {
    delete process.env.HATCH_API; delete process.env.HATCH_KEY; if (DEV) process.env.HATCH_DEV_DIR = DEV;
    server.close();
  }
});

test('a server that is down keeps the queue and never throws', async () => {
  const c = ctx(), run = lastBuildRun(c);
  process.env.HATCH_API = 'http://127.0.0.1:9';
  process.env.HATCH_KEY = KEY; delete process.env.HATCH_DEV_DIR;
  try {
    mt.set('on');
    assert.equal(await mt.record(c, run, render), 'ok');
    assert.equal(mt.queued().length, 1);
    assert.equal(await mt.flush(), 0);
    assert.equal(mt.queued().length, 1, 'still there for the next time');
  } finally { delete process.env.HATCH_API; delete process.env.HATCH_KEY; if (DEV) process.env.HATCH_DEV_DIR = DEV; }
});

test('a payload that fails the check is never sent or queued', async () => {
  const real = mt.build;
  // record() builds through the module's own function; a tampered queue line is dropped at send time instead.
  fs.mkdirSync(api.home(), { recursive: true });
  fs.writeFileSync(path.join(api.home(), 'metrics-queue.jsonl'), JSON.stringify({ v: 1, title: 'leak' }) + '\n');
  process.env.HATCH_API = 'http://127.0.0.1:9'; process.env.HATCH_KEY = KEY; delete process.env.HATCH_DEV_DIR;
  try {
    mt.set('on');
    await mt.flush();
    assert.deepEqual(mt.queued(), [], 'the bad line is dropped, not sent');
  } finally { delete process.env.HATCH_API; delete process.env.HATCH_KEY; if (DEV) process.env.HATCH_DEV_DIR = DEV; }
  assert.equal(mt.build, real);
});

test('the commands: metrics asks first, then holds the answer; scorecard needs no key', () => {
  const { spawnSync } = require('child_process');
  const HATCH = path.join(__dirname, '..', 'scripts', 'hatch.js');
  const env = Object.assign({}, process.env, { HOME: home, USERPROFILE: home, COHDIT_HOME: home });
  const run = (...a) => spawnSync(process.execPath, [HATCH, ...a], { env, encoding: 'utf8' });
  fs.rmSync(path.join(home, '.cohdit'), { recursive: true, force: true });
  assert.match(run('metrics').stdout, /Say "share my build numbers"/);
  assert.match(run('metrics', 'on').stdout, /is on/);
  assert.match(run('metrics').stdout, /: on\./);
  assert.match(run('metrics', 'off').stdout, /Nothing is sent/);
  assert.equal(mt.status(), 'off');
});

#!/usr/bin/env node
'use strict';
/**
 * mkfixtures.js — regenerate tests/fixtures/<name>/ (each one a complete .cohdit directory).
 *
 * Fixtures are generated, not hand-edited, so a schema change is one edit here plus
 * `UPDATE_GOLDEN=1 node --test tests/`. Every record goes through the same validation the emitter
 * uses, so a fixture can never hold a line the ledger would refuse.
 *
 *   node tests/mkfixtures.js            rewrite every fixture
 */
const fs = require('fs');
const path = require('path');
const ml = require('../scripts/lib/ledger');
const cz = require('../scripts/lib/codes');

const FIX = path.join(__dirname, 'fixtures');
const TABLE = cz.load();
const HOST = 'delons-laptop';
const OS = 'mac';

const SPEC = {
  v: 1, name: 'Chore Chart',
  pitch: "A shared list where the kids tick off chores and see who's ahead this week.",
  anchor: 'Both kids have ticked a chore on their own phone by next Sunday.',
  in: ['add a chore', 'tick it done', 'weekly scoreboard', 'reset on Sunday', 'share link'],
  out: ['rewards or money', 'sign-in for kids'],
  gates: { personal_details: false, payments: false, messaging: false, children: false, advice: false, uploads: false, user_content: true },
  rails: ['user_content'],
  terms_v: 1,
  decisions: [{ n: 1, q: 'Who can reset the week?', a: 'a parent' }],
  open_questions: ['What happens to unticked chores on Sunday?'],
  items: [
    { id: 'ITEM-001', title: 'Add a chore', status: 'done', criteria: ['type "Dishes", press Add: it appears in the list'], depends: [] },
    { id: 'ITEM-002', title: 'Tick a chore done', status: 'done', criteria: ['tick Dishes: it moves under Done'], depends: ['ITEM-001'] },
    { id: 'ITEM-003', title: 'Reset on Sunday', status: 'held', criteria: ['on Sunday night the list is empty again'], depends: ['ITEM-002'] },
    { id: 'ITEM-004', title: 'Weekly scoreboard', status: 'queued', criteria: ['the top of the page shows who ticked most this week'], depends: ['ITEM-002'] },
  ],
};

const USAGE_SONNET = { 'claude-sonnet-5-5': { in: 20000, out: 4000, cr: 300000, cw5: 50000, cw1: 0, cold5: 0, cold1: 0, msgs: 12, ctx_max: 90000, said: 900 } };
const USAGE_OPUS = { 'claude-opus-5-5': { in: 5000, out: 2000, cr: 150000, cw5: 20000, cw1: 0, cold5: 0, cold1: 0, msgs: 6, ctx_max: 70000, said: 400 } };
const USAGE_UNPRICED = { 'claude-future-9': { in: 1000, out: 100, cr: 0, cw5: 0, cw1: 0, cold5: 0, cold1: 0, msgs: 1, ctx_max: 1000, said: 50 } };

const hm = (day, t) => day + 'T' + t + 'Z';
const two = (n) => String(n).padStart(2, '0');

class Fixture {
  constructor(name, spec = SPEC) {
    this.dir = path.join(FIX, name);
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(this.dir, 'ledger', 'runs'), { recursive: true });
    fs.mkdirSync(path.join(this.dir, 'ledger', 'blobs'), { recursive: true });
    if (spec !== null) {
      fs.writeFileSync(path.join(this.dir, 'spec.json'), JSON.stringify(ml.sortKeys(spec), null, 1) + '\n');
      const config = { v: 1, verify: 'npm test && npm run build', connectors: { github: { repo: 'delon/chore-chart' } } };
      fs.writeFileSync(path.join(this.dir, 'config.json'), JSON.stringify(config, null, 2) + '\n');
    }
    this.run = null;
  }

  blob(text) {
    const bid = ml.blobId(text);
    fs.writeFileSync(path.join(this.dir, 'ledger', 'blobs', bid + '.txt'), text);
    return bid;
  }

  /** The maker's try note for an item, as build writes it. */
  note(item, text) {
    fs.mkdirSync(path.join(this.dir, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(this.dir, 'notes', item + '.txt'), text + '\n');
  }

  start(skill, ts, base) {
    const n = fs.readdirSync(path.join(this.dir, 'ledger', 'runs')).length + 1;
    this.run = ts.replace(/[-:]/g, '') + '-' + HOST + '-' + n.toString(16).padStart(4, '0');
    const f = { skill, plugin: '0.0.1', host: HOST, os: OS, prices: '2026-10-06' };
    if (base) f.base = base;
    this.ev('RUN_START', ts, null, f);
    return this.run;
  }

  ev(code, ts, item, fields) {
    const f = cz.coerce(TABLE, code, fields || {});
    const rec = { c: code, f, r: this.run, ts };
    if (item) rec.i = item;
    const problems = cz.validateRecord(TABLE, Object.assign({ id: 'x', v: 1 }, rec));
    if (problems.length) throw new Error('fixture ' + this.dir + ': ' + problems.join('; '));
    rec.v = 1;
    rec.id = ml.recordId(rec);
    fs.appendFileSync(path.join(this.dir, 'ledger', 'runs', this.run + '.jsonl'), ml.dumps(rec) + '\n');
    return rec;
  }

  usage(ts, agent, item, models, attrib) {
    const f = {
      agent,
      attrib: attrib || (agent === 'orchestrator' ? 'orchestrator' : (item ? 'branch' : 'none')),
      models: models || USAGE_SONNET,
    };
    return this.ev('USAGE', ts, item, f);
  }

  raw(line) {
    fs.appendFileSync(path.join(this.dir, 'ledger', 'runs', this.run + '.jsonl'), line + '\n');
  }
}

/** A typical build run: picks, maker, checker, gate, done; optional HELD at the end. Returns the minute reached. */
function buildRun(fx, day, itemsDone = ['ITEM-001', 'ITEM-002'], held = null, base = '3f2a9c1e') {
  const t = (m, s = '00') => hm(day, '09:' + two(m) + ':' + s);
  fx.start('build', hm(day, '09:00:00'), base);
  fx.usage(hm(day, '09:00:30'), 'orchestrator');
  let minute = 1;
  itemsDone.forEach((i, idx) => {
    const n = idx + 1;
    const br = 'item/' + i.slice(-3) + '-' + (n === 1 ? 'add-a-chore' : 'tick-done');
    fx.ev('PICK', t(minute), i, { branch: br, fork: base });
    fx.ev('DISPATCH', t(minute, '10'), i, { agent: 'maker', model: 'claude-sonnet-5-5' });
    fx.usage(t(minute + 6), 'maker', i);
    fx.ev('VERIFY', t(minute + 6, '30'), i, { rc: 0, dur_s: 48 });
    fx.ev('RETURN', t(minute + 7), i, { agent: 'maker', verdict: 'done' });
    fx.ev('RISK', t(minute + 7, '01'), i, { tier: 'standard', signals: 'logic,tests' });
    fx.ev('DISPATCH', t(minute + 7, '05'), i, { agent: 'checker', model: 'claude-sonnet-5-5' });
    fx.usage(t(minute + 9), 'checker', i, USAGE_OPUS);
    fx.ev('REVIEW', t(minute + 9), i, { must_fix: n === 1 ? 0 : 1, nits: 2 });
    fx.ev('RETURN', t(minute + 9, '01'), i, { agent: 'checker', verdict: n === 1 ? 'pass' : 'fail' });
    if (n !== 1) {
      fx.ev('ROUND', t(minute + 9, '05'), i, { cause: 'review' });
      fx.ev('DISPATCH', t(minute + 9, '06'), i, { agent: 'maker', model: 'claude-sonnet-5-5' });
      fx.usage(t(minute + 12), 'maker', i);
      fx.ev('VERIFY', t(minute + 12, '30'), i, { rc: 0, dur_s: 51 });
      fx.ev('RETURN', t(minute + 13), i, { agent: 'maker', verdict: 'done' });
      minute += 4;
    }
    fx.ev('GATE', t(minute + 10), i, { result: 'pass' });
    fx.ev('DONE', t(minute + 10, '30'), i, { head: 'a1b2c3d' + n, touches: 'app/,tests/' });
    fx.ev('PUSH', t(minute + 10, '40'), null, { branch: br, result: 'ok' });
    minute += 12;
  });
  if (held) {
    fx.ev('PICK', t(minute), held, { branch: 'item/003-reset-sunday', fork: base });
    fx.ev('DISPATCH', t(minute, '10'), held, { agent: 'maker', model: 'claude-sonnet-5-5' });
    fx.usage(t(minute + 3), 'maker', held);
    fx.ev('RETURN', t(minute + 4), held, { agent: 'maker', verdict: 'blocked' });
    fx.ev('HELD', t(minute + 4, '01'), held, { reason: 'decision', blob: fx.blob('Reset on Sunday night, or Monday morning before school?') });
    minute += 5;
  }
  fx.usage(t(minute + 1), 'orchestrator');
  return minute;
}

function main() {
  fs.mkdirSync(FIX, { recursive: true });
  const D = '2026-11-01';
  const t = (m, s = '00') => hm(D, '09:' + two(m) + ':' + s);
  let fx, m;

  // happy: a build run (2 done, 1 parked) then a share run that went live.
  fx = new Fixture('happy');
  m = buildRun(fx, D, undefined, 'ITEM-003');
  fx.ev('RUN_END', t(m + 2), null, { outcome: 'ok' });
  fx.start('share', hm(D, '09:50:00'));
  fx.ev('DECIDE', hm(D, '09:50:20'), null, { type: 'publish', choice: 'live', who: 'you' });
  fx.ev('DEPLOY', hm(D, '09:50:30'), null, { target: 'vercel', env: 'production', state: 'building', dep: 'dpl_8f3k2' });
  fx.ev('DEPLOY', hm(D, '09:52:10'), null, { target: 'vercel', env: 'production', state: 'ready', url: 'https://chore-chart.vercel.app', dep: 'dpl_8f3k2' });
  fx.ev('URL_SHARED', hm(D, '09:52:11'), null, { target: 'vercel', env: 'production', url: 'https://chore-chart.vercel.app' });
  fx.usage(hm(D, '09:52:20'), 'orchestrator', null, USAGE_OPUS);
  fx.ev('RUN_END', hm(D, '09:52:30'), null, { outcome: 'ok' });

  // stop-gate: the third item failed its checks twice and was set aside.
  const specGate = JSON.parse(JSON.stringify(SPEC));
  specGate.items[2].status = 'blocked';
  fx = new Fixture('stop-gate', specGate);
  m = buildRun(fx, D);
  let i = 'ITEM-003';
  fx.ev('PICK', t(m), i, { branch: 'item/003-reset-sunday', fork: '3f2a9c1e' });
  fx.ev('DISPATCH', t(m, '10'), i, { agent: 'maker', model: 'claude-sonnet-5-5' });
  fx.usage(t(m + 4), 'maker', i);
  fx.ev('VERIFY', t(m + 4, '30'), i, { rc: 1, dur_s: 62 });
  fx.ev('RETURN', t(m + 5), i, { agent: 'maker', verdict: 'done' });
  fx.ev('GATE', t(m + 5, '10'), i, { result: 'fail' });
  fx.ev('ROUND', t(m + 5, '20'), i, { cause: 'gate' });
  fx.ev('DISPATCH', t(m + 5, '30'), i, { agent: 'maker', model: 'claude-sonnet-5-5' });
  fx.usage(t(m + 9), 'maker', i);
  fx.ev('VERIFY', t(m + 9, '30'), i, { rc: 1, dur_s: 59 });
  fx.ev('RETURN', t(m + 10), i, { agent: 'maker', verdict: 'done' });
  fx.ev('GATE', t(m + 10, '10'), i, { result: 'fail' });
  fx.ev('ROUND', t(m + 10, '20'), i, { cause: 'gate' });
  fx.ev('BLOCKED', t(m + 10, '30'), i, { reason: 'other', blob: fx.blob('tests/reset.test.tsx: expected [] but received ["Dishes"]') });
  fx.ev('STOP', t(m + 10, '40'), i, { cause: 'gate_fail_max' });
  fx.ev('RUN_END', t(m + 11), null, { outcome: 'stopped' });

  // stop-budget
  fx = new Fixture('stop-budget');
  m = buildRun(fx, D, ['ITEM-001']);
  fx.ev('STOP', t(m + 2), null, { cause: 'budget' });
  fx.ev('RUN_END', t(m + 2, '10'), null, { outcome: 'stopped' });

  // deploy-error: a share run whose deploy failed.
  fx = new Fixture('deploy-error');
  fx.start('share', hm(D, '09:40:00'));
  fx.ev('DECIDE', hm(D, '09:40:20'), null, { type: 'publish', choice: 'live', who: 'you' });
  fx.ev('DEPLOY', hm(D, '09:40:30'), null, { target: 'vercel', env: 'production', state: 'building', dep: 'dpl_zz91q' });
  fx.ev('DEPLOY', hm(D, '09:43:10'), null, { target: 'vercel', env: 'production', state: 'error', dep: 'dpl_zz91q' });
  fx.ev('STOP', hm(D, '09:43:20'), null, {
    cause: 'connector', name: 'vercel',
    blob: fx.blob('Error: Command "npm run build" exited with 1\n./app/page.tsx:12:5 Type error: Property \'chores\' does not exist'),
  });
  fx.usage(hm(D, '09:43:25'), 'orchestrator', null, USAGE_OPUS);
  fx.ev('RUN_END', hm(D, '09:43:30'), null, { outcome: 'stopped' });

  // refused: a dream that hit one of the two refused categories.
  const rspec = {
    v: 1, name: 'Ex Finder', pitch: 'Show me where my ex is right now and who she is with.', refused: 'harm',
    items: [], in: [], out: [], gates: { personal_details: true }, rails: [], terms_v: 1, decisions: [], open_questions: [],
  };
  fx = new Fixture('refused', rspec);
  fx.start('dream', hm(D, '09:30:00'));
  fx.ev('DECIDE', hm(D, '09:30:40'), null, { type: 'terms', choice: 'accepted', who: 'you', v: 1 });
  fx.ev('DECIDE', hm(D, '09:31:00'), null, { type: 'hosting', choice: 'own_free', who: 'you' });
  fx.ev('REFUSE', hm(D, '09:34:00'), null, { category: 'harm' });
  fx.ev('STOP', hm(D, '09:34:01'), null, { cause: 'refused' });
  fx.ev('RUN_END', hm(D, '09:34:02'), null, { outcome: 'stopped' });

  // crashed: the builder was dispatched 2 hours ago and never came back; no RUN_END.
  fx = new Fixture('crashed');
  fx.start('build', hm(D, '07:50:00'), '3f2a9c1e');
  fx.ev('PICK', hm(D, '07:51:00'), 'ITEM-004', { branch: 'item/004-scoreboard', fork: '3f2a9c1e' });
  fx.ev('DISPATCH', hm(D, '07:51:10'), 'ITEM-004', { agent: 'maker', model: 'claude-sonnet-5-5' });
  fx.usage(hm(D, '07:58:00'), 'orchestrator');

  // live: a build run whose last event is 3 minutes old.
  fx = new Fixture('live');
  fx.start('build', hm(D, '09:50:00'), '3f2a9c1e');
  fx.ev('PICK', hm(D, '09:51:00'), 'ITEM-004', { branch: 'item/004-scoreboard', fork: '3f2a9c1e' });
  fx.ev('DISPATCH', hm(D, '09:51:10'), 'ITEM-004', { agent: 'maker', model: 'claude-sonnet-5-5' });
  fx.ev('BEAT', hm(D, '09:57:00'), 'ITEM-004', { phase: 'building' });

  // setup: a capability pass with two things left (own-account hosting: no team checks).
  fx = new Fixture('setup', null);
  fx.start('setup', hm(D, '09:00:00'));
  for (const [name, state] of [['node', 'ok'], ['git', 'ok'], ['gh', 'missing'], ['gh_auth', 'unauth'],
    ['vercel', 'ok'], ['vercel_auth', 'ok'], ['guard', 'ok'], ['hook_path', 'ok']]) {
    fx.ev('CHECK', hm(D, '09:00:05'), null, { name, state });
  }
  fx.ev('RUN_END', hm(D, '09:00:07'), null, { outcome: 'ok' });

  // dream: an interview in progress, from the draft the script writes. Gates mostly inferred.
  const DRAFT = {
    v: 1, name: 'ABC Friends', slug: 'abc-friends', shape: 'use', for: 'Maya, 4', anchor: 'she asks to play it again',
    items: [
      { id: 'ITEM-001', title: 'Letter grid', criteria: ['open it; you see all 26 letters, big'], source: 'said', status: 'queued' },
      { id: 'ITEM-002', title: 'Tap to hear', criteria: ['tap a letter; you hear "A, a, alligator"'], source: 'said', status: 'queued' },
      { id: 'ITEM-003', title: 'Animal picture', criteria: ['tap a letter; you see the animal and its name'], source: 'said', status: 'queued' },
      { id: 'ITEM-004', title: 'On the iPad', criteria: ['open it on the iPad; the letters fill the screen'], source: 'inferred', device: true, status: 'queued' },
    ],
    out: ['scores', 'levels', 'remembering what she has done'],
    gates: {
      personal_details: { value: false, source: 'inferred' }, payments: { value: false, source: 'inferred' },
      messaging: { value: false, source: 'inferred' }, children: { value: true, source: 'said' },
      advice: { value: false, source: 'inferred' }, uploads: { value: false, source: 'inferred' }, user_content: { value: false, source: 'inferred' },
    },
    decisions: [{ type: 'design', choice: 'name_then_sound_then_animal', who: 'hatch' }],
    open_questions: [], agreed: false,
  };
  fx = new Fixture('dream', DRAFT);
  fx.start('dream', hm(D, '10:00:00'));
  fx.ev('ASK', hm(D, '10:00:40'), null, { goal: 'walk', n: 1 });
  fx.ev('READBACK', hm(D, '10:01:00'), null, { kind: 'partial', items: 3, inferred: 0, open: 0 });
  fx.ev('ASK', hm(D, '10:01:30'), null, { goal: 'worked', n: 2 });
  fx.ev('READBACK', hm(D, '10:02:00'), null, { kind: 'full', items: 4, inferred: 7, open: 0 });

  // tried: a build run (2 done), then a try: one worked, one did not. The failed thing is queued again.
  fx = new Fixture('tried');
  m = buildRun(fx, D);
  fx.ev('RUN_END', t(m + 2), null, { outcome: 'ok' });
  fx.start('try', hm(D, '09:40:00'));
  fx.ev('TRY_START', hm(D, '09:40:20'), null, { items: 'ITEM-001,ITEM-002', url: 'http://localhost:3000' });
  fx.ev('TRY_RESULT', hm(D, '09:44:00'), 'ITEM-001', { result: 'pass' });
  fx.ev('TRY_RESULT', hm(D, '09:45:00'), 'ITEM-002', { result: 'fail', blob: fx.blob('Dishes stayed in the list after I ticked it.') });
  fx.usage(hm(D, '09:45:10'), 'orchestrator', null, USAGE_OPUS);
  fx.ev('RUN_END', hm(D, '09:45:20'), null, { outcome: 'ok' });

  // trying: a try in progress, 3 minutes old, with a device check and a maker's note on the list.
  const specTry = JSON.parse(JSON.stringify(SPEC));
  specTry.items.push({ id: 'ITEM-005', title: 'On the iPad', status: 'queued', criteria: ['the list fills the screen'], depends: [], device: true, source: 'inferred' });
  fx = new Fixture('trying', specTry);
  fx.note('ITEM-002', 'I drafted the chore names; read them and change any.');
  m = buildRun(fx, D);
  fx.ev('RUN_END', t(m + 2), null, { outcome: 'ok' });
  fx.start('try', hm(D, '09:55:00'));
  fx.ev('TRY_START', hm(D, '09:55:30'), null, { items: 'ITEM-001,ITEM-002,ITEM-005', url: 'http://localhost:3000', lan: 'http://192.168.1.12:3000' });
  fx.ev('TRY_RESULT', hm(D, '09:57:00'), 'ITEM-001', { result: 'pass' });

  // shared: the real path to a link. A build (2 done), a try (one worked, one did not), then a share that
  // went ahead with what works (ruling 2026-10-28): the failed thing is named as not fixed yet, and the
  // device check is offered again at the public link.
  const specShared = JSON.parse(JSON.stringify(SPEC));
  specShared.items.push({ id: 'ITEM-005', title: 'On the iPad', status: 'queued', criteria: ['the list fills the screen'], depends: [], device: true, source: 'inferred' });
  fx = new Fixture('shared', specShared);
  m = buildRun(fx, D);
  fx.ev('RUN_END', t(m + 2), null, { outcome: 'ok' });
  fx.start('try', hm(D, '09:40:00'));
  fx.ev('TRY_START', hm(D, '09:40:20'), null, { items: 'ITEM-001,ITEM-002,ITEM-005', url: 'http://localhost:3000', lan: 'http://192.168.1.12:3000' });
  fx.ev('TRY_RESULT', hm(D, '09:44:00'), 'ITEM-001', { result: 'pass' });
  fx.ev('TRY_RESULT', hm(D, '09:45:00'), 'ITEM-002', { result: 'fail', blob: fx.blob('Dishes stayed in the list after I ticked it.') });
  fx.ev('RUN_END', hm(D, '09:45:20'), null, { outcome: 'ok' });
  fx.start('share', hm(D, '09:50:00'));
  fx.ev('DECIDE', hm(D, '09:50:20'), null, { type: 'publish', choice: 'live', who: 'you' });
  fx.ev('DEPLOY', hm(D, '09:50:30'), null, { target: 'vercel', env: 'production', state: 'building', url: 'https://chore-chart-delon.vercel.app', dep: 'dpl_8f3k2' });
  fx.ev('DEPLOY', hm(D, '09:52:10'), null, { target: 'vercel', env: 'production', state: 'ready', url: 'https://chore-chart-delon.vercel.app', dep: 'dpl_8f3k2' });
  fx.ev('URL_SHARED', hm(D, '09:52:11'), null, { target: 'vercel', env: 'production', url: 'https://chore-chart.vercel.app' });
  fx.usage(hm(D, '09:52:20'), 'orchestrator', null, USAGE_OPUS);
  fx.ev('RUN_END', hm(D, '09:52:30'), null, { outcome: 'ok' });

  // declined: the person said "not yet" to the one question.
  fx = new Fixture('declined');
  m = buildRun(fx, D, ['ITEM-001']);
  fx.ev('RUN_END', t(m + 2), null, { outcome: 'ok' });
  fx.start('try', hm(D, '09:40:00'));
  fx.ev('TRY_START', hm(D, '09:40:20'), null, { items: 'ITEM-001', url: 'http://localhost:3000' });
  fx.ev('TRY_RESULT', hm(D, '09:44:00'), 'ITEM-001', { result: 'pass' });
  fx.ev('RUN_END', hm(D, '09:44:20'), null, { outcome: 'ok' });
  fx.start('share', hm(D, '09:50:00'));
  fx.ev('DECIDE', hm(D, '09:50:20'), null, { type: 'publish', choice: 'not_yet', who: 'you' });
  fx.ev('RUN_END', hm(D, '09:50:21'), null, { outcome: 'ok' });

  // empty: nothing at all.
  new Fixture('empty', null);

  // untrusted: an unpriced model, a run that never ended, a run with no items, and one bad line.
  fx = new Fixture('untrusted');
  fx.start('build', '2026-10-29T09:00:00Z', '3f2a9c1e');
  fx.ev('PICK', '2026-10-29T09:01:00Z', 'ITEM-001', { branch: 'item/001-add', fork: '3f2a9c1e' });
  fx.ev('DISPATCH', '2026-10-29T09:01:10Z', 'ITEM-001', { agent: 'maker', model: 'claude-future-9' });
  fx.usage('2026-10-29T09:05:00Z', 'maker', 'ITEM-001', USAGE_UNPRICED);
  fx.ev('RETURN', '2026-10-29T09:06:00Z', 'ITEM-001', { agent: 'maker', verdict: 'done' });
  fx.ev('DONE', '2026-10-29T09:07:00Z', 'ITEM-001', { head: 'deadbee1', touches: 'app/' });
  fx.raw('{"this is not json');

  // codes: one event per code (coverage for codes.test.js), every blob real.
  fx = new Fixture('codes');
  fx.start('build', hm(D, '08:00:00'), '3f2a9c1e');
  const b = (s) => fx.blob(s);
  const rows = [
    ['CHECK', null, { name: 'gh_auth', state: 'unauth' }],
    ['DECIDE', null, { type: 'terms', choice: 'accepted', who: 'you', v: 1 }],
    ['DECIDE', null, { type: 'data', choice: 'neon_free', who: 'hatch' }],
    ['ASK', null, { goal: 'walk', n: 1 }],
    ['READBACK', null, { kind: 'full', items: 4, inferred: 6, open: 1 }],
    ['SPEC', null, { items: 4, gates_yes: 1, held: 1 }],
    ['REFUSE', null, { category: 'harm' }],
    ['DECIDE', 'ITEM-003', { type: 'design', choice: 'sunday_night', who: 'you' }],
    ['PICK', 'ITEM-001', { branch: 'item/001-add-a-chore', fork: '3f2a9c1e' }],
    ['DISPATCH', 'ITEM-001', { agent: 'maker', model: 'claude-sonnet-5-5' }],
    ['RETURN', 'ITEM-001', { agent: 'maker', verdict: 'done' }],
    ['VERIFY', 'ITEM-001', { rc: 0, dur_s: 48, cmd: b('npm test && npm run build') }],
    ['GATE', 'ITEM-001', { result: 'pass' }],
    ['RISK', 'ITEM-001', { tier: 'low', signals: 'copy' }],
    ['REVIEW', 'ITEM-001', { must_fix: 1, nits: 3 }],
    ['ROUND', 'ITEM-001', { cause: 'review' }],
    ['DONE', 'ITEM-001', { head: 'a1b2c3d4', touches: 'app/,tests/' }],
    ['BLOCKED', 'ITEM-004', { reason: 'dependency', blob: b('Needs the tick-done flow from ITEM-002 merged first.') }],
    ['HELD', 'ITEM-003', { reason: 'decision', blob: b('Reset on Sunday night, or Monday morning before school?') }],
    ['FINDING', 'ITEM-001', { scope: 'out', sev: 'medium', blob: b('The chore list has no empty state when every chore is done.') }],
    ['PUSH', null, { branch: 'item/001-add-a-chore', result: 'rejected' }],
    ['DEPLOY', null, { target: 'vercel', env: 'production', state: 'ready', url: 'https://chore-chart.vercel.app', dep: 'dpl_8f3k2' }],
    ['URL_SHARED', null, { target: 'vercel', env: 'production', url: 'https://chore-chart.vercel.app' }],
    ['TRY_START', null, { items: 'ITEM-001,ITEM-002', url: 'http://localhost:3101', lan: 'http://192.168.1.12:3101' }],
    ['TRY_RESULT', 'ITEM-002', { result: 'fail', blob: b('Dishes stayed in the list after I ticked it.') }],
    ['BEAT', 'ITEM-001', { phase: 'building' }],
    ['USAGE', 'ITEM-001', { agent: 'maker', attrib: 'branch', models: USAGE_SONNET }],
    ['STOP', 'ITEM-001', { cause: 'gate_fail_max' }],
    ['RUN_END', null, { outcome: 'stopped' }],
  ];
  rows.forEach(([code, item, f], idx) => fx.ev(code, hm(D, '08:' + two(idx + 1) + ':00'), item, f));
  process.stdout.write('fixtures written to ' + FIX + '\n');
}

if (require.main === module) main();
module.exports = { SPEC, Fixture, buildRun, main };

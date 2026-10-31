'use strict';
// try.test.js — hatch.js try: the app started on a free port and stopped with the run, the checklist
// in the person's words with the maker's note and the same-wifi address for a device check, verdicts
// by number, id or title, "pass" for everything left (device checks excepted), the digest pointing at
// share or build, a failed thing queued again with the person's words in the next maker's brief, a
// try that died with the lid resumed under the same run, a build that ends a live try, and the one
// status rule shared by render.js and build. The fake scaffold's dev server stands in for the app.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const H = require('./harness');
const ml = require('../scripts/lib/ledger');
const tr = require('../scripts/lib/try');

const ITEMS = [
  { title: 'Letter grid', criteria: ['open it; you see all 26 letters, big'] },
  { title: 'Tap to hear', criteria: ['tap a letter; you hear it'] },
  { title: 'Animal picture', criteria: ['tap a letter; you see the animal and its name'] },
  { title: 'On the iPad', criteria: ['open it on the iPad'], device: true, source: 'inferred' },
];
const GATES = { personal_details: false, payments: false, messaging: false, children: { value: true, source: 'said' }, advice: false, uploads: false, user_content: false };
const OK = { code: 0, out: 'ok\n' };

function home() {
  const d = H.mkrepo();
  const probes = { 'gh --version': OK, 'gh auth status': { code: 1 } };
  fs.writeFileSync(path.join(d, 'probes.json'), JSON.stringify(probes));
  return { dir: d, env: { COHDIT_HOME: d, GIT_CONFIG_GLOBAL: path.join(d, 'gitconfig'), COHDIT_PROBES: path.join(d, 'probes.json'), COHDIT_FAKE_SCAFFOLD: '1' } };
}

const run = (h, args, input, env) => H.run('hatch.js', args, { env: Object.assign({}, h.env, env || {}), input, cwd: h.dir });
const hintOf = (r, k) => { const m = new RegExp('^' + k + '=(.*)$', 'm').exec(r.err); return m ? m[1] : null; };
const B = (h, dir, args, input) => run(h, ['build'].concat(args, ['--dir', dir]), input);
const T = (h, dir, args, input, env) => run(h, ['try'].concat(args, ['--dir', dir]), input, env);
const R = (h, dir, view, lvl, ...extra) => H.run('render.js', [view, '--level', lvl, '--cohdit', path.join(dir, '.cohdit'), ...extra], { env: h.env }).out;
const DONE = (change = 'copy', extra = {}) => JSON.stringify(Object.assign({ verdict: 'done', change, criteria: [{ n: 1, met: true, ref: 'app/page.tsx:1' }], blocked: null, findings: [] }, extra));
const local = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.cohdit', 'local.json'), 'utf8'));

/** An agreed idea, built: every non-device thing done through the gate (a copy change, no checker). */
function builtIdea(h, name, items = ITEMS, notes = {}) {
  const n = run(h, ['idea', 'new', name]);
  const dir = hintOf(n, 'dir');
  assert.equal(run(h, ['idea', 'set', '--dir', dir, '--json', JSON.stringify({ items, gates: GATES })]).code, 0);
  assert.equal(run(h, ['idea', 'agree', '--dir', dir]).code, 0);
  assert.equal(B(h, dir, ['open']).code, 0);
  for (;;) {
    const nx = B(h, dir, ['next']);
    if (hintOf(nx, 'next') !== 'maker') break;
    const item = hintOf(nx, 'item');
    fs.writeFileSync(path.join(dir, 'app', item + '.txt'), item + '\n');
    assert.equal(B(h, dir, ['commit', '-m', item]).code, 0);
    assert.match(B(h, dir, ['built', item, '--return', DONE('copy', notes[item] ? { try_note: notes[item] } : {})]).out, /^Done: /m);
  }
  assert.equal(B(h, dir, ['close']).code, 0);
  return dir;
}

const answers = (url) => new Promise((resolve) => {
  const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode); });
  req.on('error', () => resolve(null));
});

test('a free port is one nothing answers on, whichever address family the other server took', async () => {
  const busy = http.createServer((q, s) => s.end('mine')).listen(0, '::');     // the person's own server, on *:port
  await new Promise((r) => busy.once('listening', r));
  const port = busy.address().port;
  assert.equal(await tr.taken(port), true);
  assert.notEqual(await tr.freePort('localhost', port), port, 'a bind check alone would have said free');
  busy.close();
  await new Promise((r) => busy.once('close', r));
  assert.equal(await tr.taken(port), false);
});

test('the status rule: done, tried, queued again after a fail, building only while the pick\'s run lives', () => {
  const items = [{ id: 'ITEM-001' }, { id: 'ITEM-002', status: 'queued' }, { id: 'ITEM-003' }];
  const recs = [
    { c: 'RUN_START', r: 'a', ts: '2026-11-01T09:00:00Z', f: {} },
    { c: 'PICK', r: 'a', ts: '2026-11-01T09:01:00Z', i: 'ITEM-001', f: {} },
    { c: 'DONE', r: 'a', ts: '2026-11-01T09:10:00Z', i: 'ITEM-001', f: {} },
    { c: 'PICK', r: 'a', ts: '2026-11-01T09:11:00Z', i: 'ITEM-002', f: {} },
    { c: 'DONE', r: 'a', ts: '2026-11-01T09:20:00Z', i: 'ITEM-002', f: {} },
    { c: 'PICK', r: 'a', ts: '2026-11-01T09:21:00Z', i: 'ITEM-003', f: {} },
    { c: 'RUN_START', r: 'b', ts: '2026-11-01T09:30:00Z', f: {} },
    { c: 'TRY_RESULT', r: 'b', ts: '2026-11-01T09:35:00Z', i: 'ITEM-001', f: { result: 'pass' } },
    { c: 'TRY_RESULT', r: 'b', ts: '2026-11-01T09:36:00Z', i: 'ITEM-002', f: { result: 'fail', blob: 'deadbeefdeadbeef' } },
  ];
  const at = (now) => Object.fromEntries(ml.itemStatus(recs, items, now));
  assert.deepEqual(at('2026-11-01T10:00:00Z'), { 'ITEM-001': 'tried', 'ITEM-002': 'queued', 'ITEM-003': 'building' });
  assert.deepEqual(at('2026-11-03T10:00:00Z'), { 'ITEM-001': 'tried', 'ITEM-002': 'queued', 'ITEM-003': 'queued' }, 'the pick lapsed with its run');
  const ended = recs.concat([{ c: 'RUN_END', r: 'a', ts: '2026-11-01T09:40:00Z', f: {} }, { c: 'PICK', r: 'c', ts: '2026-11-01T09:50:00Z', i: 'ITEM-002', f: {} }, { c: 'DONE', r: 'c', ts: '2026-11-01T09:55:00Z', i: 'ITEM-002', f: {} }]);
  assert.deepEqual(Object.fromEntries(ml.itemStatus(ended, items, '2026-11-01T10:00:00Z')), { 'ITEM-001': 'tried', 'ITEM-002': 'done', 'ITEM-003': 'queued' }, 'built again after the fail: to try again');
  assert.equal(ml.itemStatus([], [{ id: 'ITEM-009', status: 'tried' }], '2026-11-01T10:00:00Z').get('ITEM-009'), 'tried', 'spec.json is the floor');
});

test('which thing they mean: a number, an id, a title, a unique part; nothing else', () => {
  const spec = { items: [{ id: 'ITEM-001', title: 'Letter grid' }, { id: 'ITEM-002', title: 'Tap to hear' }, { id: 'ITEM-004', title: 'On the iPad' }] };
  const list = ['ITEM-001', 'ITEM-002', 'ITEM-004'];
  assert.equal(tr.resolveItem(spec, list, '2'), 'ITEM-002');
  assert.equal(tr.resolveItem(spec, list, '3'), 'ITEM-004', 'the number is the place on the list, not the id');
  assert.equal(tr.resolveItem(spec, list, 'item-004'), 'ITEM-004');
  assert.equal(tr.resolveItem(spec, list, 'tap to hear'), 'ITEM-002');
  assert.equal(tr.resolveItem(spec, list, 'ipad'), 'ITEM-004');
  assert.equal(tr.resolveItem(spec, list, 't'), null, 'a part that matches more than one thing is nothing');
  assert.equal(tr.resolveItem(spec, list, '7'), null);
  assert.equal(tr.resolveItem(spec, list, 'ITEM-003'), null, 'a thing not on the list');
});

test('a try from start to pass: the app, the list, a fail in their words, pass for the rest, the digest; the fail reaches the next brief', async () => {
  const h = home();
  const dir = builtIdea(h, 'ABC Friends', ITEMS, { 'ITEM-003': 'Read the animal names; change any.' });
  assert.match(R(h, dir, 'status', 'plain'), /^Waiting on you: 3 things to try/m);
  const s = T(h, dir, ['start']);
  assert.equal(s.code, 0, s.err + s.out);
  const url = hintOf(s, 'url');
  assert.match(url, /^http:\/\/localhost:\d+$/);
  const lan = hintOf(s, 'lan');                                            // null on a computer with no network
  assert.equal(s.out, [
    'Open ' + url + ' to try it.',
    '  1 Letter grid — open it; you see all 26 letters, big',
    '  2 Tap to hear — tap a letter; you hear it',
    '  3 Animal picture — tap a letter; you see the animal and its name',
    '      Read the animal names; change any.',
    '  4 On the iPad — ' + (lan ? 'on the same wifi, open ' + lan + ' on it (if this computer asks whether to allow connections, say yes); ' : '') + 'open it on the iPad',
    'Say "pass", or say which one didn\'t work and what you saw.',
  ].join('\n'));
  const t0 = local(dir).try;
  assert.ok(t0.boot && Math.abs(t0.boot - tr.bootTime()) < 5, 'the app is remembered with the boot it belongs to');
  assert.equal(hintOf(s, 'next'), 'results');
  assert.equal(await answers(url), 200, 'the app answers');
  const t = local(dir).try;
  assert.ok(t.pid && t.run, 'the try is remembered per working copy');
  const pointer = JSON.parse(fs.readFileSync(path.join(h.dir, '.cohdit', 'active.json'), 'utf8'));
  assert.equal(pointer.run, t.run, 'the usage hook can find the try');
  assert.match(R(h, dir, 'status', 'plain', '--spool', H.spool(dir)), /^Working now: waiting for you to try it/m);
  const again = T(h, dir, ['start']);
  assert.equal(again.code, 0, again.err);
  assert.equal(hintOf(again, 'run'), t.run, 'saying it again reprints the list under the same run');
  const f = T(h, dir, ['result', '3', 'fail', '--note', '-'], 'the picture for X is a weird box with a question mark\n');
  assert.equal(f.code, 0, f.err);
  assert.equal(f.out, 'Didn\'t work: "Animal picture" — the picture for X is a weird box with a question mark');
  assert.equal(hintOf(f, 'left'), '3');
  const bad = T(h, dir, ['result', 'nine', 'pass']);
  assert.equal(bad.code, 64);
  assert.match(bad.err, /^hint=which$/m);
  const d = T(h, dir, ['result', 'ipad', 'pass']);
  assert.equal(d.out, 'Worked: "On the iPad".');
  const p = T(h, dir, ['pass']);
  assert.equal(p.code, 1, 'something failed');
  assert.equal(p.out, [
    'Worked: "Letter grid".',
    'Worked: "Tap to hear".',
    'Tried 4 things: 3 worked, 1 didn\'t.',
    '  didn\'t    Animal picture — the picture for X is a weird box with a question mark',
    'Next: say "build it" and I\'ll fix it.',
  ].join('\n'));
  assert.equal(hintOf(p, 'next'), 'build');
  assert.equal(await answers(url), null, 'the app is stopped with the try');
  assert.equal(local(dir).try, undefined);
  assert.ok(!fs.existsSync(path.join(h.dir, '.cohdit', 'active.json')), 'pointer cleared');
  assert.equal(H.git(['status', '--porcelain'], dir), '', 'the ledger is committed');
  const status = R(h, dir, 'status', 'plain');
  assert.match(status, /^  tested     Letter grid$/m);
  assert.match(status, /^  to do      Animal picture$/m, 'queued again');
  assert.match(status, /^  tested     On the iPad$/m);
  assert.doesNotMatch(status, /things to try/);
  const none = T(h, dir, ['start']);
  assert.equal(none.code, 1);
  assert.equal(none.out, 'Nothing to try yet. Say "build it".');
  // the next build picks the failed thing and tells the maker what the person saw
  assert.equal(B(h, dir, ['open']).code, 0);
  const nx = B(h, dir, ['next']);
  assert.equal(hintOf(nx, 'item'), 'ITEM-003', 'the failed thing is built again, nothing else');
  const brief = fs.readFileSync(hintOf(nx, 'brief'), 'utf8');
  assert.match(brief, /## When they tried it\nThe person tried this thing and said, in their words: the picture for X is a weird box with a question mark/);
  assert.match(brief, /ITEM-001 Letter grid \(tried\)/);
});

test('everything works: "pass" ends pointing at share; a device check is not passed by "pass"', async () => {
  const h = home();
  const dir = builtIdea(h, 'Marcus', ITEMS);
  const s = T(h, dir, ['start']);
  assert.equal(s.code, 0, s.err);
  const p = T(h, dir, ['pass']);
  assert.equal(p.code, 0, p.err);
  assert.match(p.out, /^Tried 3 things: all worked\.$/m);
  assert.match(p.out, /^Next: say "share it" when you want friends to see it\.$/m);
  assert.equal(hintOf(p, 'next'), 'share');
  const status = R(h, dir, 'status', 'plain');
  assert.match(status, /^  to check   On the iPad$/m, 'the device check stays theirs to do');
  assert.doesNotMatch(status, /things to try/, 'and never blocks');
  const d = R(h, dir, 'digest', 'product', '--last');
  assert.match(d, /^Tested 3 items: all passed\.$/m);
  const late = T(h, dir, ['result', '1', 'fail']);
  assert.equal(late.code, 2, 'nothing is being tried any more');
  assert.match(late.err, /^hint=no_run$/m);
});

test('a try that died with the lid is picked up: same run, same numbers, only what is left; "stop" ends it', async () => {
  const h = home();
  const dir = builtIdea(h, 'Linh', ITEMS.slice(0, 3));
  const s = T(h, dir, ['start']);
  assert.equal(s.code, 0, s.err);
  T(h, dir, ['result', '1', 'pass']);
  require('../scripts/lib/tools').stopProcess(local(dir).try.pid);            // the lid closes
  await new Promise((r) => setTimeout(r, 300));
  const again = T(h, dir, ['start']);
  assert.equal(again.code, 0, again.err + again.out);
  assert.equal(hintOf(again, 'run'), hintOf(s, 'run'));
  assert.doesNotMatch(again.out, /1 Letter grid/, 'what has an answer is not asked again');
  assert.match(again.out, /^  2 Tap to hear/m);
  assert.match(again.out, /^  3 Animal picture/m);
  assert.equal(await answers(hintOf(again, 'url')), 200, 'the app is back');
  const st = T(h, dir, ['stop']);
  assert.equal(st.code, 0, st.err);
  assert.match(st.out, /^Tried 1 thing: all worked\.$/m);
  assert.match(st.out, /^Say "let me try it" when you're ready\.$/m, 'two things unanswered: not yet share');
  assert.equal(hintOf(st, 'next'), 'none');
  assert.match(R(h, dir, 'status', 'plain'), /^Waiting on you: 2 things to try/m, 'what was not answered is still to try');
});

test('a build ends a live try first; a try refuses while a build is live; the app that will not start is a stop', async () => {
  const h = home();
  const dir = builtIdea(h, 'Sam', ITEMS.slice(0, 2));
  const s = T(h, dir, ['start']);
  assert.equal(s.code, 0, s.err);
  const url = hintOf(s, 'url');
  T(h, dir, ['result', '2', 'fail', '--note', '-'], 'no audio in Firefox\n');
  const o = B(h, dir, ['open']);
  assert.equal(o.code, 0, o.err);
  assert.equal(await answers(url), null, 'the app stopped when the build opened');
  assert.equal(local(dir).try, undefined, 'the try is closed');
  assert.equal(hintOf(B(h, dir, ['next']), 'item'), 'ITEM-002', 'and its fail is already a queued thing');
  const busy = T(h, dir, ['start']);
  assert.equal(busy.code, 1);
  assert.equal(busy.out, 'Still building; say "status" for where it is up to, and try it once the build has finished.');
  assert.match(busy.err, /^hint=busy$/m);
  fs.writeFileSync(path.join(dir, 'app', 'ITEM-002.txt'), 'v2\n');
  B(h, dir, ['commit', '-m', 'fix']);
  B(h, dir, ['built', 'ITEM-002', '--return', DONE('copy')]);
  B(h, dir, ['close']);
  const dead = T(h, dir, ['start'], undefined, { COHDIT_FAKE_DEV: 'die' });
  assert.equal(dead.code, 1);
  assert.equal(dead.out, 'The app wouldn\'t start on this computer, so I stopped. Say "show me the details".');
  assert.match(dead.err, /^hint=app$/m);
  assert.equal(local(dir).try, undefined, 'no half-started try is left behind');
  const events = R(h, dir, 'events', 'tech', '--last');
  assert.match(events, /RUN_START skill=try/, 'recorded as a try, not a build');
  assert.match(events, /STOP cause=app/);
  assert.match(R(h, dir, 'why', 'plain', '--last'), /The app wouldn't start/);
  assert.equal(H.git(['status', '--porcelain'], dir), '', 'the stopped run and its details are committed');
  const blobs = fs.readdirSync(path.join(dir, '.cohdit', 'ledger', 'blobs'));
  assert.ok(blobs.some((b) => /exit|died|printed nothing|dev/.test(fs.readFileSync(path.join(dir, '.cohdit', 'ledger', 'blobs', b), 'utf8'))), 'the log tail is in the ledger');
  // a reboot hands the pid to someone else: the try must not trust or kill it
  const s2 = T(h, dir, ['start']);
  assert.equal(s2.code, 0, s2.err);
  const t2 = local(dir).try;
  t2.boot -= 1000;
  fs.writeFileSync(path.join(dir, '.cohdit', 'local.json'), JSON.stringify({ try: t2 }));
  assert.equal(tr.owns(t2), false);
  const s3 = T(h, dir, ['start']);
  assert.equal(s3.code, 0, s3.err);
  assert.equal(hintOf(s3, 'run'), hintOf(s2, 'run'), 'the same run, restarted');
  assert.notEqual(local(dir).try.pid, t2.pid, 'a fresh app, the stale pid left alone');
  require('../scripts/lib/tools').stopProcess(t2.pid);                     // the one from before the "reboot", in this test still ours
  T(h, dir, ['stop']);
  assert.equal(local(dir).try, undefined);
  const ok = T(h, dir, ['start']);
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /^  1 Letter grid/m, 'never answered, so still on the list');
  assert.match(ok.out, /^  2 Tap to hear/m, 'the rebuilt thing is back on the list');
  T(h, dir, ['stop']);
});

test('a start cut off while waiting: the app is remembered before anything is recorded, and the next start begins the run properly', async () => {
  const h = home();
  const dir = builtIdea(h, 'Cutoff', ITEMS.slice(0, 2));
  // what the started callback leaves behind when Claude Code kills the call mid-wait: an app, no records
  const { spawn } = require('child_process');
  const port = await tr.freePort('localhost', 3050);
  const orphan = spawn(process.execPath, [path.join(dir, 'server.js'), '-p', String(port), '-H', 'localhost'], { detached: true, stdio: 'ignore' });
  orphan.unref();
  for (let i = 0; i < 50 && !(await tr.taken(port)); i++) await new Promise((r) => setTimeout(r, 100));
  const stub = { run: '20261101T100000Z-testhost-00ff', started: H.NOW, items: ['ITEM-001', 'ITEM-002'], results: {}, pid: orphan.pid, port, boot: tr.bootTime() };
  fs.writeFileSync(path.join(dir, '.cohdit', 'local.json'), JSON.stringify({ try: stub }));
  const s = T(h, dir, ['start']);
  assert.equal(s.code, 0, s.err);
  assert.notEqual(hintOf(s, 'run'), stub.run, 'a run with no record never began; a new one does');
  assert.match(s.out, /^Open http:\/\/localhost:\d+ to try it\.$/m, 'the list comes with an address, from a recorded TRY_START');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await tr.taken(port), false, 'the orphan was stopped, not kept');
  const events = R(h, dir, 'events', 'tech', '--last');
  assert.match(events, /RUN_START skill=try/);
  assert.match(events, /TRY_START items=ITEM-001,ITEM-002/);
  const st = T(h, dir, ['stop']);
  assert.equal(st.code, 0, st.err);
});

test('the try skill: short, one script, no questions but one, ends where the script says', (t) => {
  const skill = H.playbook('skill', 'try');
  if (!skill) return t.skip('no content folder in HATCH_DEV_DIR');
  assert.ok(skill.split('\n').length <= 100, 'skill is ' + skill.split('\n').length + ' lines');
  assert.match(skill, /hatch\.js" try/);
  assert.match(skill, /CONTRACTS\.md/);
  assert.match(skill, /<<'HATCH'/);
  assert.doesNotMatch(skill, /new chat/i);
  assert.doesNotMatch(skill, /ITEM-\d/);
});

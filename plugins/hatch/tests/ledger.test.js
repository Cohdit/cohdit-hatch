'use strict';
// ledger.test.js — events are stamped by the clock, validated against codes.json at write time,
// a crashed run resumes its own id, blobs travel with flush, lint catches drift.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./harness');

// In-process loaders read content synchronously; fetch it first when it comes over the API.
test.before(() => H.ready());

const L = (cwd, ...args) => H.run('ledger.js', args, { cwd });
const Lin = (cwd, input, ...args) => H.run('ledger.js', args, { cwd, input });
const OS = { darwin: 'mac', win32: 'windows', linux: 'linux' }[process.platform] || 'other';

test('nothing is recorded before start', () => {
  const repo = H.mkrepo();
  const sp = H.spool(repo);
  assert.equal(L(repo, 'emit', 'PICK', 'ITEM-001', 'branch=item/001-x').code, 2, 'emit before start → 2');
  assert.equal(H.lines(sp).length, 0, 'nothing written');
});

test('start validates, prints the id, resumes the same skill', () => {
  const repo = H.mkrepo();
  const sp = H.spool(repo);
  assert.equal(L(repo, 'start').code, 64, 'start without --skill → 64');
  const r = L(repo, 'start', '--skill', 'build', '--base', '3f2a9c1e');
  assert.equal(r.code, 0, 'start ok');
  const run = r.out;
  assert.match(run, /^20261101T100000Z-testhost-[0-9a-f]{4}$/, 'run id shape');
  assert.equal(L(repo, 'start', '--skill', 'build').out, run, 'resume returns the same id');
  assert.equal(H.lines(sp).length, 1, 'resume writes no second RUN_START');
  const rec = H.lastLine(sp);
  assert.equal(rec.ts, '2026-11-01T10:00:00Z', "ts is the clock's");
  assert.deepEqual(Object.keys(rec), ['c', 'f', 'id', 'r', 'ts', 'v'], 'record shape, keys sorted');
  assert.deepEqual(rec.f, { base: '3f2a9c1e', host: 'testhost', os: OS, plugin: '0.0.1', prices: require('../scripts/lib/ledger').loadPrices().date, skill: 'build' }, 'fields typed and complete, incl. which price list the run estimates from');
  assert.equal(H.lines(sp)[0], JSON.stringify(rec), 'the line is compact JSON');
});

test('bad calls fail loudly with 64 and write nothing', () => {
  const repo = H.mkrepo();
  const sp = H.spool(repo);
  L(repo, 'start', '--skill', 'build');
  const n0 = H.lines(sp).length;
  const bad = [
    [['emit', 'BOGUS'], 'unknown code'],
    [['emit', 'PICK', 'branch=item/001-x'], 'PICK without item'],
    [['emit', 'PICK', 'ITEM-1', 'branch=item/001-x'], 'malformed item'],
    [['emit', 'PICK', 'ITEM-001'], 'missing required field'],
    [['emit', 'PICK', 'ITEM-001', 'branch=item/001-x', 'colour=red'], 'unknown field'],
    [['emit', 'ROUND', 'ITEM-001', 'cause=vibes'], 'enum violation'],
    [['emit', 'REVIEW', 'ITEM-001', 'must_fix=two', 'nits=0'], 'non-integer'],
    [['emit', 'DONE', 'ITEM-001', 'head=nothex', 'touches=app/'], 'bad sha'],
    [['emit', 'HELD', 'ITEM-001', 'reason=decision'], 'HELD without blob'],
    [['emit', 'HELD', 'ITEM-001', 'reason=decision', 'blob=tooshort'], 'bad blob id'],
    [['emit', 'PUSH', 'ITEM-001', 'branch=x', 'result=ok'], 'item on an item=no code'],
    [['emit', 'URL_SHARED', 'target=vercel', 'env=production', 'url=ftp://x'], 'bad url'],
    [['emit', 'DECIDE', 'type=terms', 'choice=accepted', 'who=you', 'v=one'], 'non-integer terms version'],
    [['emit', 'CHECK', 'name=brew', 'state=ok'], 'an OS-specific check name is not a capability'],
  ];
  for (const [args, why] of bad) assert.equal(L(repo, ...args).code, 64, why + ' → 64');
  assert.equal(H.lines(sp).length, n0, 'nothing written');
});

test('a run of valid events; PICK opens the item, DONE closes it', () => {
  const repo = H.mkrepo();
  const sp = H.spool(repo);
  const run = L(repo, 'start', '--skill', 'build').out;
  const active = path.join(path.dirname(sp), 'active-run.json');
  assert.equal(L(repo, 'emit', 'PICK', 'ITEM-001', 'branch=item/001-add', 'fork=3f2a9c1e').code, 0, 'PICK ok');
  assert.equal(H.lastLine(sp).i, 'ITEM-001', 'item recorded on i');
  assert.deepEqual(Object.keys(H.readJson(active).open), ['ITEM-001'], 'item is open');
  assert.equal(L(repo, 'emit', 'DISPATCH', 'ITEM-001', 'agent=maker', 'model=claude-sonnet-5-5').code, 0);
  assert.equal(L(repo, 'emit', 'VERIFY', 'rc=0', 'dur_s=48').code, 0, 'VERIFY without item ok (opt)');
  assert.deepEqual(H.lastLine(sp).f, { dur_s: 48, rc: 0 }, 'ints are ints');
  assert.equal(L(repo, 'emit', 'RISK', 'ITEM-001', 'tier=low', 'signals=tests,copy').code, 0);
  assert.deepEqual(H.lastLine(sp).f.signals, ['copy', 'tests'], 'list field sorted');
  assert.equal(L(repo, 'emit', 'DECIDE', 'type=hosting', 'choice=own_free').code, 64, 'a decision must say who made it');
  assert.equal(L(repo, 'emit', 'DECIDE', 'type=hosting', 'choice=own_free', 'who=you').code, 0, 'hosting decision ok');
  assert.equal(L(repo, 'emit', 'DECIDE', 'type=data', 'choice=neon_free', 'who=hatch').code, 0, 'a default taken by Hatch is a decision too');
  assert.equal(L(repo, 'emit', 'DECIDE', 'type=terms', 'choice=accepted', 'who=you', 'v=1').code, 0, 'terms decision ok');
  assert.equal(H.lastLine(sp).f.v, 1);
  assert.equal(L(repo, 'emit', 'DONE', 'ITEM-001', 'head=a1b2c3d4', 'touches=app/,tests/').code, 0);
  assert.deepEqual(Object.keys(H.readJson(active).open), [], 'item closed');
  assert.ok(H.records(sp).every((r) => r.r === run), 'every record carries the run');
});

test('blobs: text goes to a side file, the event carries its id', () => {
  const repo = H.mkrepo();
  const sp = H.spool(repo);
  L(repo, 'start', '--skill', 'build');
  assert.equal(Lin(repo, 'Reset on Sunday night, or Monday morning?\n', 'emit', 'HELD', 'ITEM-002', 'reason=decision', '--blob-from', '-').code, 0, 'HELD with blob ok');
  const bid = H.lastLine(sp).f.blob;
  assert.match(bid, /^[0-9a-f]{16}$/, 'blob id is 16 hex');
  assert.equal(fs.readFileSync(path.join(path.dirname(sp), 'blobs', bid + '.txt'), 'utf8'), 'Reset on Sunday night, or Monday morning?\n', 'blob file exists in the spool');
  assert.equal(Lin(repo, '', 'emit', 'HELD', 'ITEM-002', 'reason=decision', '--blob-from', '-').code, 64, 'empty blob → 64');
  assert.equal(Lin(repo, 'x'.repeat(6000), 'emit', 'BLOCKED', 'ITEM-002', 'reason=other', '--blob-from', '-').code, 0);
  const big = fs.readFileSync(path.join(path.dirname(sp), 'blobs', H.lastLine(sp).f.blob + '.txt'), 'utf8');
  assert.ok(big.endsWith('[truncated]') && big.length < 4200, 'blob truncated at 4 KB');
});

test('end, flush, status', () => {
  const repo = H.mkrepo();
  const sp = H.spool(repo);
  L(repo, 'start', '--skill', 'build');
  L(repo, 'emit', 'PICK', 'ITEM-001', 'branch=item/001-add');
  Lin(repo, 'why?\n', 'emit', 'HELD', 'ITEM-001', 'reason=decision', '--blob-from', '-');
  Lin(repo, 'because\n', 'emit', 'BLOCKED', 'ITEM-002', 'reason=other', '--blob-from', '-');
  assert.equal(L(repo, 'end', '--outcome', 'ok').code, 0, 'end ok');
  assert.equal(H.lastLine(sp).c, 'RUN_END', 'RUN_END recorded');
  assert.equal(L(repo, 'flush').code, 0, 'flush ok');
  const runs = path.join(repo, '.cohdit', 'ledger', 'runs');
  assert.equal(H.ls(runs).length, 1, 'ledger file exists');
  assert.equal(H.ls(path.join(repo, '.cohdit', 'ledger', 'blobs')).length, 2, 'blobs moved');
  assert.equal(H.lines(sp).length, 0, 'spool empty');
  assert.equal(L(repo, 'status').out, 'active run: none · spooled: 0 · hook errors: 0', 'active run cleared');
  L(repo, 'flush');
  assert.equal(H.lines(path.join(runs, H.ls(runs)[0])).length, 5, 'second flush adds nothing');
  assert.equal(L(repo, 'end').code, 2, 'end with no run → 2');
});

test('lint: a clean ledger passes; drift is named', () => {
  const repo = H.mkrepo();
  const run = L(repo, 'start', '--skill', 'build').out;
  L(repo, 'end');
  L(repo, 'flush');
  assert.equal(L(repo, 'lint').out, 'ledger: all readable', 'lint clean');
  const file = path.join(repo, '.cohdit', 'ledger', 'runs', run + '.jsonl');
  fs.appendFileSync(file, '{"c":"ROUND","f":{"cause":"vibes"},"i":"ITEM-001","id":"0000000000000001","r":"x","ts":"2026-11-01T09:00:00Z","v":1}\nnot json\n');
  const r = L(repo, 'lint');
  assert.equal(r.code, 1, 'lint fails');
  assert.match(r.out, /ROUND\.cause must be one of gate\|review\|contract/, 'lint names the enum violation');
  assert.match(r.out, /1 unreadable line\(s\)/, 'lint counts the unreadable line');
});

test('a different skill, or a stale run, closes the old run and opens a new one', () => {
  const repo = H.mkrepo();
  const sp = H.spool(repo);
  const old = L(repo, 'start', '--skill', 'build').out;
  const next = L(repo, 'start', '--skill', 'share').out;
  assert.notEqual(next, old, 'another skill opens a new run');
  const ends = H.records(sp).filter((r) => r.c === 'RUN_END');
  assert.equal(ends[0].r, old);
  assert.equal(ends[0].f.outcome, 'stopped', 'the old run got RUN_END stopped');
  const stale = H.run('ledger.js', ['start', '--skill', 'share'], { cwd: repo, env: { COHDIT_NOW: '2026-11-03T10:00:00Z' } }).out;
  assert.notEqual(stale, next, 'a run older than 24h is not resumed');
  const ends2 = H.records(sp).filter((r) => r.c === 'RUN_END');
  assert.equal(ends2[ends2.length - 1].f.outcome, 'crashed', 'the stale run got RUN_END crashed');
});

test('prune keeps the newest 50 runs and archives the rest', () => {
  const repo = H.mkrepo();
  const runs = path.join(repo, '.cohdit', 'ledger', 'runs');
  fs.mkdirSync(runs, { recursive: true });
  for (let n = 1; n <= 55; n++) {
    const day = String((n % 28) + 1).padStart(2, '0');
    const run = '202610' + day + 'T000000Z-h-' + String(n).padStart(4, '0');
    fs.writeFileSync(path.join(runs, run + '.jsonl'),
      JSON.stringify({ c: 'RUN_START', f: { host: 'h', os: 'linux', plugin: '0.0.1', skill: 'status' }, id: String(n).padStart(16, '0'), r: run, ts: '2026-10-' + day + 'T00:00:00Z', v: 1 }) + '\n');
  }
  assert.equal(L(repo, 'flush', '--prune').code, 0);
  assert.equal(H.ls(runs).length, 50, '50 run files kept');
  assert.equal(H.ls(path.join(repo, '.cohdit', 'ledger', 'archive')).length, 1, 'archive created');
});

test('outside a git repository: exit 2', () => {
  assert.equal(L(H.tmpdir(), 'status').code, 2);
});

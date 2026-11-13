'use strict';
// remember.test.js — the lesson bank: hatch.js remember add|set|drop|list|show through the script, the
// shape rules, twins refused, selection for a brief (tagged lessons ride with their detail only when a
// tag is in the thing's words, general ones always, the cap), the brief carrying them, the committed
// bank lint-clean, and the permission hook approving the heredoc shape the skill uses.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const ls = require('../scripts/lib/lessons');
const bd = require('../scripts/lib/build');
const hatch = require('../scripts/hatch');

// In-process loaders read content synchronously; fetch it first when it comes over the API.
test.before(() => H.ready());

function bank() {
  const d = H.tmpdir();
  const file = path.join(d, 'lessons.json');
  return { file, env: { COHDIT_LESSONS: file, COHDIT_HOME: d, GIT_CONFIG_GLOBAL: path.join(d, 'gitconfig') } };
}
const run = (b, args, input) => H.run('hatch.js', ['remember'].concat(args), { env: b.env, input });
const hintOf = (r, k) => { const m = new RegExp('^' + k + '=(.*)$', 'm').exec(r.err); return m ? m[1] : null; };

test('add, list, show, set, drop: the whole life of a lesson through the script', () => {
  const b = bank();
  const empty = run(b, ['list']);
  assert.equal(empty.code, 0, empty.err);
  assert.equal(empty.out, 'No lessons yet.');
  const a = run(b, ['add', '--json', '-'], '{"gist":"Write the failing test before the fix.","tags":["bug","fix"]}');
  assert.equal(a.code, 0, a.err);
  assert.equal(a.out, 'L-001 [maker] Write the failing test before the fix. #bug #fix');
  assert.equal(hintOf(a, 'id'), 'L-001');
  assert.equal(hintOf(a, 'count'), '1');
  const c = run(b, ['add', '--json', '{"gist":"A must-fix names the input that breaks the code.","for":"checker,maker"}']);
  assert.equal(c.code, 0, c.err);
  assert.equal(c.out, 'L-002 [maker,checker] A must-fix names the input that breaks the code.');
  const l = run(b, ['list']);
  assert.equal(l.out.split('\n').length, 2);
  assert.equal(run(b, ['list', '--for', 'checker']).out, 'L-002 [maker,checker] A must-fix names the input that breaks the code.');
  const s = run(b, ['set', 'L-001', '--json', '{"detail":"A test that passes before the change proves nothing."}']);
  assert.equal(s.code, 0, s.err);
  const shown = JSON.parse(run(b, ['show', 'L-001']).out);
  assert.equal(shown.detail, 'A test that passes before the change proves nothing.');
  assert.deepEqual(shown.tags, ['bug', 'fix']);
  assert.equal(shown.added, '2026-11-01');
  const d = run(b, ['drop', 'L-001']);
  assert.equal(d.code, 0, d.err);
  assert.equal(hintOf(d, 'count'), '1');
  const next = run(b, ['add', '--json', '{"gist":"Ids are never reused."}']);
  assert.equal(next.out, 'L-003 [maker] Ids are never reused.', 'a dropped id is not given out again');
  const saved = JSON.parse(fs.readFileSync(b.file, 'utf8'));
  assert.equal(saved.next, 4);
  assert.deepEqual(saved.lessons.map((x) => x.id), ['L-002', 'L-003']);
});

test('the shape is enforced and a twin is refused, with exit 64 and nothing written', () => {
  const b = bank();
  assert.equal(run(b, ['add', '--json', '{"gist":"Keep forms short."}']).code, 0);
  const cases = [
    ['{"gist":"keep forms short"}', /already L-001/],
    ['{"gist":"' + 'x'.repeat(351) + '"}', /gist is 351 chars/],
    ['{"gist":"ok","for":["owner"]}', /not a reader/],
    ['{"gist":"ok","tags":["Has Space"]}', /tag "has space"/],
    ['{"gist":"ok","tags":["aa","bb","cc","dd","ee","ff","gg","hh","ii","jj","kk"]}', /at most 10 tags/],
    ['{"gist":"ok","detail":"' + 'y'.repeat(601) + '"}', /detail is 601 chars/],
    ['{"gist":"ok","when":"build"}', /unknown field when/],
    ['not json', /not JSON/],
  ];
  for (const [json, re] of cases) {
    const r = run(b, ['add', '--json', json]);
    assert.equal(r.code, 64, json);
    assert.match(r.err, re);
  }
  assert.equal(run(b, ['set', 'L-009', '--json', '{"gist":"x"}']).code, 64);
  assert.equal(run(b, ['drop', 'L-009']).code, 64);
  assert.equal(run(b, ['list', '--for', 'nobody']).code, 64);
  assert.equal(run(b, ['wat']).code, 64);
  assert.equal(JSON.parse(fs.readFileSync(b.file, 'utf8')).lessons.length, 1);
});

test('select: a tag rides only when it starts a word in the thing, with its detail; general gists always; the cap', () => {
  const bk = ls.load(path.join(H.tmpdir(), 'none.json'));
  ls.add(bk, { gist: 'Validate on the server.', tags: ['form', 'upload'], detail: 'The browser check is a courtesy.' }, '2026-11-01');
  ls.add(bk, { gist: 'One screen, one job.' }, '2026-11-01');
  ls.add(bk, { gist: 'Review the empty state.', for: ['checker'] }, '2026-11-01');
  ls.add(bk, { gist: 'Never a platform.', tags: ['platform'] }, '2026-11-01');
  const yes = ls.select(bk, 'maker', 'Sign-up form: fill it in; you see a thank-you');
  assert.deepEqual(yes.matched.map((l) => l.id), ['L-001']);
  assert.deepEqual(yes.general.map((l) => l.id), ['L-002']);
  assert.deepEqual(ls.lines(yes), ['- L-001 Validate on the server. — The browser check is a courtesy.', '- L-002 One screen, one job.']);
  const no = ls.select(bk, 'maker', 'Letter grid: open it; you see all 26 letters');
  assert.deepEqual(no.matched, []);
  assert.deepEqual(no.general.map((l) => l.id), ['L-002']);
  assert.deepEqual(ls.select(bk, 'maker', 'the platform').matched.map((l) => l.id), ['L-004']);
  assert.deepEqual(ls.select(bk, 'maker', 'a cross-platform app').matched.map((l) => l.id), ['L-004'], 'a tag after a hyphen still starts a word');
  assert.deepEqual(ls.select(bk, 'maker', 'informal').matched, [], '"form" inside "informal" is not the word');
  assert.deepEqual(ls.select(bk, 'checker', 'anything').general.map((l) => l.id), ['L-003']);
  for (let i = 0; i < 30; i++) ls.add(bk, { gist: 'General rule number ' + i + '.' }, '2026-11-01');
  const capped = ls.select(bk, 'maker', 'a form');
  assert.equal(capped.matched.length + capped.general.length, ls.CAP);
  assert.equal(capped.matched[0].id, 'L-001', 'a tagged match always fits');
  assert.equal(capped.dropped, 1 + 31 - ls.CAP, 'one match and 31 general lessons apply; the platform one does not');
  assert.deepEqual(ls.crowded(bk), ['maker']);
  assert.deepEqual(ls.lint(bk), []);
});

test('the committed bank is lint-clean, and a bank of real lessons lints clean after edits by hand go wrong', () => {
  assert.deepEqual(ls.lint(ls.load()), []);
  const bk = { v: 1, next: 1, lessons: [
    { id: 'L-001', gist: 'A.', for: ['maker'], tags: [], detail: null, added: '2026-11-01' },
    { id: 'L-001', gist: 'a', for: ['maker'], tags: [], detail: null, added: 'yesterday' },
    { id: 'L-002', gist: '', for: ['maker'], tags: [], detail: null, added: '2026-11-01' },
  ] };
  const msgs = ls.lint(bk);
  assert.ok(msgs.some((m) => /duplicate id L-001/.test(m)), msgs.join('|'));
  assert.ok(msgs.some((m) => /added must be a date/.test(m)));
  assert.ok(msgs.some((m) => /L-002: gist/.test(m)));
  assert.ok(msgs.some((m) => /next must be above/.test(m)));
});

test('the brief carries the lessons that apply, in two lists, and none when the bank is empty', () => {
  const b = bank();
  const spec = { name: 'ABC Friends', pitch: 'letters for a toddler', rails: ['children'], items: [
    { id: 'ITEM-001', title: 'Letter grid', criteria: ['open it; you see all 26 letters, big'], source: 'said', status: 'queued' },
    { id: 'ITEM-002', title: 'Parent login', criteria: ['a parent signs in with a login form'], source: 'said', status: 'queued' },
  ] };
  const dir = H.mkrepo();
  const cfg = { verify: 'npm test' };
  const status = new Map([['ITEM-001', 'queued'], ['ITEM-002', 'queued']]);
  const withBank = (fn) => { const prev = process.env.COHDIT_LESSONS; process.env.COHDIT_LESSONS = b.file; try { return fn(); } finally { if (prev === undefined) delete process.env.COHDIT_LESSONS; else process.env.COHDIT_LESSONS = prev; } };
  const none = withBank(() => bd.brief(dir, spec, 'ITEM-001', cfg, null, status));
  assert.doesNotMatch(none, /## Lessons/);
  assert.equal(run(b, ['add', '--json', '{"gist":"Big tap targets for small hands.","tags":["children"],"detail":"At least 64px."}']).code, 0);
  assert.equal(run(b, ['add', '--json', '{"gist":"Never store a password you could avoid.","tags":["login"],"for":["maker","checker"]}']).code, 0);
  assert.equal(run(b, ['add', '--json', '{"gist":"Ship the smallest thing that works."}']).code, 0);
  const grid = withBank(() => bd.brief(dir, spec, 'ITEM-001', cfg, null, status));
  assert.match(grid, /## Lessons\nHow Cohdit builds\. Each one holds like a rule attached\.\n- L-001 Big tap targets for small hands\. — At least 64px\.\n- L-003 Ship the smallest thing that works\.\n\n## Technology/, grid);
  assert.doesNotMatch(grid, /For the review/, 'no checker lesson applies to the grid');
  const login = withBank(() => bd.brief(dir, spec, 'ITEM-002', cfg, null, status));
  assert.match(login, /- L-001 Big tap targets[^\n]*\n- L-002 Never store a password you could avoid\.\n- L-003 Ship the smallest[^\n]*\n\nFor the review \(the checker judges these\):\n- L-002 Never store a password you could avoid\.\n\n## Technology/, login);
  const order = login.indexOf('## Rules attached') < login.indexOf('## Lessons') && login.indexOf('## Lessons') < login.indexOf('## Technology');
  assert.ok(order, 'lessons sit between the rules and the technology');
});

test('the permission hook approves the heredoc the skill uses, and refuses a shell around it', () => {
  const script = path.join(H.S, 'hatch.js');
  const call = (cmd) => hatch.allowDecision({ tool_name: 'Bash', tool_input: { command: cmd } }, [], script);
  const heredoc = 'node "' + script + '" remember add --json - <<\'HATCH\'\n{"gist":"Keep it small, even with $HOME in it."}\nHATCH\n';
  assert.ok(call(heredoc), 'the quoted heredoc is approved');
  assert.ok(call('node "' + script + '" remember list --for maker'));
  assert.equal(call('cat x | node "' + script + '" remember add --json -'), null);
  assert.equal(call('node "' + script + '" remember add --json "$(cat x)"'), null);
});

'use strict';
// fix.test.js — hatch.js fix | report: a problem told in words becomes a bug on the list; a fix run pulls
// the live app's reports (the publishing tool stubbed), sets every lens over the whole project, turns each
// must-fix into a queued bug (twins folded), prints the digest and points at build; the build then fixes a
// bug from a brief that says it is one; a scan's bug never reaches the try list; the schedule and the due
// hint; share creates the private report store once.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const sh = require('../scripts/lib/share');

const ITEMS = [
  { title: 'Letter grid', criteria: ['open it; you see all 26 letters, big'] },
  { title: 'Tap to hear', criteria: ['tap a letter; you hear it'] },
];
const GATES = { personal_details: false, payments: false, messaging: false, children: false, advice: false, uploads: false, user_content: false };
const OK = { code: 0, out: 'ok\n' };
const VC = 'npx -y vercel@latest ';

function home(extraProbes = {}) {
  const d = H.mkrepo();
  const probes = Object.assign({ 'gh --version': OK, 'gh auth status': { code: 1 } }, extraProbes);
  fs.writeFileSync(path.join(d, 'probes.json'), JSON.stringify(probes));
  return { dir: d, env: { COHDIT_HOME: d, GIT_CONFIG_GLOBAL: path.join(d, 'gitconfig'), COHDIT_PROBES: path.join(d, 'probes.json'), COHDIT_FAKE_SCAFFOLD: '1' } };
}
const run = (h, args, input, env) => H.run('hatch.js', args, { env: Object.assign({}, h.env, env || {}), input, cwd: h.dir });
const hintOf = (r, k) => { const m = new RegExp('^' + k + '=(.*)$', 'm').exec(r.err); return m ? m[1] : null; };
const B = (h, dir, args, input) => run(h, ['build'].concat(args, ['--dir', dir]), input);
const F = (h, dir, args, input, env) => run(h, ['fix'].concat(args, ['--dir', dir]), input, env);
const R = (h, dir, view, lvl, ...extra) => H.run('render.js', [view, '--level', lvl, '--cohdit', path.join(dir, '.cohdit'), ...extra], { env: h.env }).out;
const DONE = (change = 'copy') => JSON.stringify({ verdict: 'done', change, criteria: [{ n: 1, met: true, ref: 'app/page.tsx:1' }], blocked: null, findings: [] });
const PASS = '{"verdict":"pass","must_fix":[],"nits":0}';
const spec = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.cohdit', 'spec.json'), 'utf8'));

/** An agreed idea with its first version built (copy changes, no review). */
function builtIdea(h, name) {
  const n = run(h, ['idea', 'new', name]);
  const dir = hintOf(n, 'dir');
  assert.equal(run(h, ['idea', 'set', '--dir', dir, '--json', JSON.stringify({ items: ITEMS, gates: GATES })]).code, 0);
  assert.equal(run(h, ['idea', 'agree', '--dir', dir]).code, 0);
  assert.equal(B(h, dir, ['open']).code, 0);
  for (;;) {
    const nx = B(h, dir, ['next']);
    if (hintOf(nx, 'next') !== 'maker') break;
    const item = hintOf(nx, 'item');
    fs.writeFileSync(path.join(dir, 'app', item + '.txt'), item + '\n');
    assert.equal(B(h, dir, ['commit', '-m', item]).code, 0);
    assert.match(B(h, dir, ['built', item, '--return', DONE()]).out, /^Done: /m);
  }
  assert.equal(B(h, dir, ['close']).code, 0);
  return dir;
}

test('a problem told in words becomes a bug on the list, in their words; a twin is folded', () => {
  const h = home();
  const dir = builtIdea(h, 'Words');
  const r = run(h, ['report', 'add', '--dir', dir, '--json', '-'], '{"did":"tapped B","expected":"to hear bee","saw":"a weird box with a question mark"}');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'Bug filed: a weird box with a question mark.\n1 bug waiting. Say "fix all" when you want them fixed.');
  assert.equal(hintOf(r, 'item'), 'ITEM-003');
  const it = spec(dir).items[2];
  assert.equal(it.kind, 'bug');
  assert.equal(it.source, 'report');
  assert.equal(it.lens, 'product', 'a person\'s report is the product owner\'s');
  assert.equal(it.title, 'a weird box with a question mark');
  assert.equal(it.criteria[0], 'Someone using it they were tapped B; expected to hear bee; saw: a weird box with a question mark. Once fixed, that no longer happens.');
  const again = run(h, ['report', 'add', '--dir', dir, '--json', '{"saw":"A weird box with a question mark"}']);
  assert.equal(again.out, 'That bug is already on the list.\n1 bug waiting. Say "fix all" when you want them fixed.');
  assert.equal(spec(dir).items.length, 3, 'a twin by title is not queued twice');
  const second = run(h, ['report', 'add', '--dir', dir, '--json', '-'], '{"saw":"the back button does nothing"}');
  assert.equal(second.out, 'Bug filed: the back button does nothing.\n2 bugs waiting. Say "fix all" when you want them fixed.');
  assert.equal(run(h, ['report', 'add', '--dir', dir, '--json', '{"did":"x"}']).code, 64, 'a report needs what they saw');
  assert.equal(fs.readdirSync(path.join(dir, '.cohdit', 'reports')).length, 0, 'the file is gone once the bug is on the list');
  assert.match(R(h, dir, 'status', 'plain'), /^  to do      a weird box with a question mark$/m);
});

test('a fix run: reports pulled from the live app, every lens over the whole project, bugs queued, then build fixes one from a bug brief', () => {
  const h = home({
    [VC + 'link --yes --project abc-friends']: OK,
    [VC + 'blob list --prefix reports/ --limit 1000']: { code: 0, out: 'reports/20261101-abc.json  200 B  https://x.blob.vercel-storage.com/reports/20261101-abc.json\nreports/20261101-def.json  210 B\n' },
    [VC + 'blob del reports/20261101-abc.json']: OK,
    [VC + 'blob del reports/20261101-def.json']: OK,
  });
  const dir = builtIdea(h, 'ABC Friends');
  // the publishing tool's `get` writes the file it is asked for: the stub cannot, so the test does what it would
  const into = path.join(dir, '.cohdit', 'reports');
  fs.mkdirSync(into, { recursive: true });
  const probes = JSON.parse(fs.readFileSync(path.join(h.dir, 'probes.json'), 'utf8'));
  for (const n of ['abc', 'def']) {
    const file = path.join(into, '20261101-' + n + '.json');
    probes[VC + 'blob get reports/20261101-' + n + '.json --access private --output ' + file] = OK;
    fs.writeFileSync(file, JSON.stringify({ saw: 'report ' + n, did: 'd', expected: 'e', page: '/grid', at: '2026-11-01T00:00:00Z', agent: 'ua' }));
  }
  fs.writeFileSync(path.join(h.dir, 'probes.json'), JSON.stringify(probes));
  const cfgFile = path.join(dir, '.cohdit', 'config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  cfg.connectors = Object.assign({}, cfg.connectors, { vercel: { project: 'abc-friends', reports: 'abc-friends-reports' } });
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + '\n');
  H.git(['commit', '-qam', 'linked'], dir);
  const o = F(h, dir, ['open']);
  assert.equal(o.code, 0, o.err);
  assert.equal(o.out, '2 reports from people using it, now on the list to fix.');
  assert.equal(hintOf(o, 'agents'), 'checker,lens-security,lens-privacy,lens-cost', 'every lens, whatever the signals');
  assert.equal(hintOf(o, 'next'), 'scan');
  assert.equal(path.dirname(hintOf(o, 'brief')), hintOf(o, 'roles'), 'each lens finds its file beside the brief');
  for (const a of hintOf(o, 'agents').split(',')) assert.match(fs.readFileSync(path.join(hintOf(o, 'roles'), 'agent-' + a + '.md'), 'utf8'), /## The rules \(baseline\.json\)/);
  const brief = fs.readFileSync(hintOf(o, 'brief'), 'utf8');
  assert.match(brief, /# Scan the whole project: "ABC Friends"/);
  assert.match(brief, /There is no diff/);
  assert.match(brief, /ITEM-003 report abc \(a bug already queued\)/);
  const again = F(h, dir, ['open']);
  assert.match(again.err, /^hint=resumed$/m, 'a second open resumes the same run');
  assert.equal(hintOf(again, 'run'), hintOf(o, 'run'));
  const f1 = F(h, dir, ['found', 'checker', '--return', '-'], '```json\n{"verdict":"fail","must_fix":[{"n":1,"ref":"app/grid.tsx:4","text":"the Z key renders nothing"},{"n":0,"text":"report abc"}],"nits":2}\n```');
  assert.equal(f1.code, 0, f1.err);
  assert.equal(hintOf(f1, 'agents'), 'lens-security,lens-privacy,lens-cost');
  assert.equal(hintOf(f1, 'next'), 'scan');
  assert.equal(F(h, dir, ['found', 'checker', '--return', PASS]).code, 64, 'a lens reports once');
  assert.equal(F(h, dir, ['found', 'lens-cost', '--return', 'nope']).code, 64);
  assert.match(F(h, dir, ['found', 'lens-cost', '--return', 'nope']).err, /^hint=reask$/m);
  F(h, dir, ['found', 'lens-security', '--return', PASS]);
  F(h, dir, ['found', 'lens-privacy', '--return', '{"verdict":"fail","must_fix":[{"n":0,"ref":"app/api/x.ts:9","text":"PRI-NOLOG: the name is logged"}],"nits":0}']);
  const last = F(h, dir, ['found', 'lens-cost', '--return', PASS]);
  assert.equal(hintOf(last, 'next'), 'close');
  const items = spec(dir).items;
  assert.deepEqual(items.map((i) => i.id + ' ' + (i.kind || 'thing') + ' ' + (i.by || '')), ['ITEM-001 thing ', 'ITEM-002 thing ', 'ITEM-003 bug person', 'ITEM-004 bug person', 'ITEM-005 bug checker', 'ITEM-006 bug lens-privacy']);
  assert.equal(items[4].criteria[0], 'app/grid.tsx:4: the Z key renders nothing');
  assert.equal(items[4].lens, 'technical', 'a scan\'s bug is the architect\'s');
  const close = F(h, dir, ['close']);
  assert.equal(close.code, 0, close.err);
  assert.equal(close.out, ['Found 4 things to fix:', '  report abc', '  report def', '  the Z key renders nothing', '  PRI-NOLOG: the name is logged', 'Next: say "fix all" and I\'ll fix them.'].join('\n'));
  assert.equal(hintOf(close, 'next'), 'build');
  assert.equal(H.git(['status', '--porcelain'], dir), '', 'the ledger is committed');
  const events = R(h, dir, 'events', 'tech', '--last');
  assert.match(events, /RUN_START skill=fix/);
  assert.match(events, /FINDING ITEM-005 scope=in sev=high blob=[0-9a-f]{16}/);
  assert.match(events, /FINDING ITEM-003 scope=in sev=medium/);
  // the build picks the bugs up like any other thing, from a brief that says it is one
  assert.equal(B(h, dir, ['open']).code, 0);
  const n = B(h, dir, ['next']);
  assert.equal(hintOf(n, 'item'), 'ITEM-003');
  const bugBrief = fs.readFileSync(hintOf(n, 'brief'), 'utf8');
  assert.match(bugBrief, /# Fix one bug: "report abc" \(ITEM-003\)/);
  assert.match(bugBrief, /## The bug, and what must be true once it is fixed\n- Someone using it they were d; expected e; saw: report abc \(at \/grid\)\. Once fixed, that no longer happens\.\n\(The person using the app reported this\. Write the failing test first/);
  fs.writeFileSync(path.join(dir, 'app', 'fix.txt'), 'fixed\n');
  B(h, dir, ['commit', '-m', 'fix']);
  assert.match(B(h, dir, ['built', 'ITEM-003', '--return', DONE()]).out, /^Done: "report abc"\.$/m);
  B(h, dir, ['close']);
  const tryList = JSON.parse(fs.readFileSync(path.join(dir, '.cohdit', 'spec.json'), 'utf8')).items;
  const tr = require('../scripts/lib/try');
  const st = new Map(tryList.map((i) => [i.id, i.id === 'ITEM-003' || i.id === 'ITEM-005' ? 'done' : 'queued']));
  assert.deepEqual(tr.toTry({ items: tryList }, st), ['ITEM-003'], 'a person\'s report is tried by them; a scan\'s bug is proved by its test');
});

test('the schedule: every N days, due when the last fix run is older than that, said at the start of a build', () => {
  const h = home();
  const dir = builtIdea(h, 'Sched');
  assert.equal(F(h, dir, ['due']).out, 'No check is due yet.');
  assert.equal(F(h, dir, ['every', 'soon']).code, 64);
  const set = F(h, dir, ['every', '7']);
  assert.equal(set.out, 'Noted: I\'ll say when a check for problems is due, every 7 days. Say "scan it" then.');
  const due = F(h, dir, ['due']);
  assert.equal(due.out, 'A check for problems is due. Say "scan it".');
  assert.equal(hintOf(due, 'due'), 'yes', 'never run: due now');
  F(h, dir, ['open']);
  for (const a of ['checker', 'lens-security', 'lens-privacy', 'lens-cost']) F(h, dir, ['found', a, '--return', PASS]);
  assert.equal(F(h, dir, ['close']).out, 'Nothing to fix: the scan found no problems and nobody reported any.');
  assert.equal(hintOf(F(h, dir, ['due']), 'due'), 'no');
  const later = { dir: h.dir, env: Object.assign({}, h.env, { COHDIT_NOW: '2026-11-09T10:00:00Z' }) };
  assert.equal(hintOf(F(later, dir, ['due']), 'due'), 'yes', 'eight days on');
  const o = B(later, dir, ['open']);
  assert.match(o.err, /^hint=fix_due$/m, 'the build says a check is due');
  B(later, dir, ['close']);
  assert.equal(F(h, dir, ['every', 'off']).out, 'Noted: no regular check. Say "scan it" whenever you like.');
  assert.equal(hintOf(F(later, dir, ['due']), 'due'), 'no');
  assert.equal(F(h, dir, ['found', 'checker', '--return', PASS]).code, 2, 'no run open');
});

test('share creates the private report store once and records it; the deploy goes on when it cannot', () => {
  const calls = [];
  const fake = (cmd, args) => { calls.push(args.slice(2).join(' ')); return args.includes('create-store') && calls.filter((c) => c.includes('create-store')).length > 1 ? { code: 1, out: '', err: 'exists' } : { code: 0, out: '', err: '' }; };
  const dir = H.mkrepo();
  fs.mkdirSync(path.join(dir, '.cohdit'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.cohdit', 'config.json'), '{"v":1}\n');
  const settings = path.join(H.tmpdir(), 'settings.json');
  process.env.COHDIT_HOME = path.dirname(settings);
  try {
    const cfg = { v: 1 };
    assert.equal(sh.ensureReportStore(fake, dir, cfg, 'abc-friends', null), 'ok');
    assert.deepEqual(calls, ['link --yes --project abc-friends', 'blob create-store abc-friends-reports --access private --yes']);
    assert.equal(cfg.connectors.vercel.reports, 'abc-friends-reports');
    assert.equal(sh.ensureReportStore(fake, dir, cfg, 'abc-friends', null), 'exists', 'never a second store');
    assert.equal(sh.ensureReportStore(fake, dir, { v: 1 }, 'other', 'team-x'), 'failed', 'a refusal is not a stop');
    assert.equal(calls[calls.length - 1], 'blob create-store other-reports --access private --yes --scope team-x');
    assert.deepEqual(sh.pullReports(fake, dir, { v: 1 }, null, path.join(dir, 'in')), [], 'no store recorded: nothing to pull');
  } finally {
    delete process.env.COHDIT_HOME;
  }
});

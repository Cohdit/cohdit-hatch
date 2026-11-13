'use strict';
// build.test.js — hatch.js build: the run from open to close with a maker and a checker played by the
// test, the gate, risk tiers, set-aside and refusal paths, the permission hook, the usage pointer, and
// many sessions on one idea: claims on the shared copy, combining before merging, a side copy for a
// second session on the same computer, and an idea fetched by name on a computer that never saw it.
// The scaffold is faked (COHDIT_FAKE_SCAFFOLD) and the GitHub tool answered from COHDIT_PROBES; the
// shared copy is a bare repository on disk, so no network and no machine state is touched.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./harness');
const bdl = require('../scripts/lib/build');
const hatch = require('../scripts/hatch');

const ITEMS = [
  { title: 'Letter grid', criteria: ['open it; you see all 26 letters, big'] },
  { title: 'Tap to hear', criteria: ['tap a letter; you hear it'] },
  { title: 'Animal picture', criteria: ['tap a letter; you see the animal and its name'] },
  { title: 'On the iPad', criteria: ['open it on the iPad'], device: true, source: 'inferred' },
];
const GATES = { personal_details: false, payments: false, messaging: false, children: { value: true, source: 'said' }, advice: false, uploads: false, user_content: false };
const OK = { code: 0, out: 'ok\n' };
const SLUGS = ['abc-friends', 'rounds', 'reports', 'dirty', 'deps', 'pointer', 'offline', 'shared', 'stale', 'checks', 'leftover', 'crash', 'lease', 'unreachable', 'ledger', 'sweep', 'lanes', 'clash'];

function home(ghOk = true, extraProbes = {}) {
  const d = H.mkrepo();
  const probes = {
    'gh --version': OK, 'gh auth status': ghOk ? OK : { code: 1 },
    'gh api user': { code: 0, out: '{"login":"priya-k","id":12345,"name":"Priya K"}\n' },
  };
  for (const slug of SLUGS) {
    probes['gh repo view priya-k/' + slug] = { code: 1 };
    probes['gh repo create priya-k/' + slug + ' --private --source=. --remote=origin --push'] = OK;
    probes['gh repo edit priya-k/' + slug + ' --add-topic cohdit-hatch'] = OK;
  }
  Object.assign(probes, extraProbes);
  fs.writeFileSync(path.join(d, 'probes.json'), JSON.stringify(probes));
  return { dir: d, env: { COHDIT_HOME: d, GIT_CONFIG_GLOBAL: path.join(d, 'gitconfig'), COHDIT_PROBES: path.join(d, 'probes.json'), COHDIT_FAKE_SCAFFOLD: '1' } };
}

const run = (h, args, input) => H.run('hatch.js', args, { env: h.env, input, cwd: h.dir });
const hintOf = (r, k) => { const m = new RegExp('^' + k + '=(.*)$', 'm').exec(r.err); return m ? m[1] : null; };
const B = (h, dir, args, input) => run(h, ['build'].concat(args, ['--dir', dir]), input);
const R = (h, dir, view, lvl, ...extra) => H.run('render.js', [view, '--level', lvl, '--cohdit', path.join(dir, '.cohdit'), ...extra], { env: h.env }).out;

/** An agreed idea, as the interview leaves it. Returns its folder. */
function agreedIdea(h, name = 'ABC Friends', items = ITEMS) {
  const n = run(h, ['idea', 'new', name]);
  assert.equal(n.code, 0, n.err);
  const dir = hintOf(n, 'dir');
  assert.equal(run(h, ['idea', 'set', '--dir', dir, '--json', JSON.stringify({ items, gates: GATES })]).code, 0);
  const a = run(h, ['idea', 'agree', '--dir', dir]);
  assert.equal(a.code, 0, a.err);
  return dir;
}

/** A shared copy on disk, wired as origin so no GitHub tool is needed. */
function withOrigin(dir) {
  const bare = H.tmpdir();
  H.git(['init', '-q', '--bare', '-b', 'main'], bare);
  H.git(['remote', 'add', 'origin', bare], dir);
  return bare;
}

/** One maker at a time: for the tests of two separate sessions, whose own lanes would only get in the way. */
function oneLane(dir) {
  const f = path.join(dir, '.cohdit', 'config.json');
  const cfg = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { v: 1 };
  cfg.caps = Object.assign({}, cfg.caps, { lanes: 1 });
  fs.writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n');
}

/** The maker's work: a file and a commit through the gate. */
function makerCommits(h, dir, file, text, msg) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
  const c = B(h, dir, ['commit', '-m', msg]);
  assert.equal(c.code, 0, c.err + c.out);
  return c;
}

const DONE = (change = 'logic', extra = {}) => JSON.stringify(Object.assign({ verdict: 'done', change, criteria: [{ n: 1, met: true, ref: 'app/page.tsx:1', test: 'app/page.test.tsx:9' }], blocked: null, findings: [] }, extra));
const PASS = '{"verdict":"pass","must_fix":[],"nits":0}';
/** Every lens the script asked for reports in turn, `verdicts` by agent (pass unless given); returns the last call. */
function review(h, dir, item, agents, verdicts = {}) {
  let last = null;
  for (const a of agents.split(',')) last = B(h, dir, ['checked', item, '--agent', a, '--return', verdicts[a] || PASS]);
  return last;
}
const bareLs = (bare, ref = 'main') => spawnSync('git', ['ls-tree', '-r', '--name-only', ref], { cwd: bare, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);

test('open: the skeleton, the GitHub copy, the run; a device check is never picked', () => {
  const h = home();
  const dir = agreedIdea(h);
  const o = B(h, dir, ['open']);
  assert.equal(o.code, 0, o.err);
  assert.ok(fs.existsSync(path.join(dir, 'package.json')), 'scaffolded');
  assert.match(o.err, /^hint=scaffolded$/m);
  assert.match(o.err, /^next=next$/m);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.cohdit', 'config.json'), 'utf8'));
  assert.equal(cfg.verify, 'npm test && npm run build');
  assert.equal(cfg.caps.items_per_run, 8);
  assert.equal(cfg.connectors.github.repo, 'priya-k/abc-friends');
  assert.equal(H.git(['rev-parse', '--abbrev-ref', 'HEAD'], dir), 'main');
  const pointer = JSON.parse(fs.readFileSync(path.join(h.dir, '.cohdit', 'active.json'), 'utf8'));
  assert.equal(pointer.path, dir, 'the usage hook can find the project from any folder');
  const again = B(h, dir, ['open']);
  assert.equal(again.code, 0, again.err);
  assert.match(again.err, /^hint=resumed$/m);
  assert.equal(hintOf(again, 'run'), hintOf(o, 'run'));
  const n1 = B(h, dir, ['next']);
  assert.equal(n1.code, 0, n1.err);
  assert.equal(n1.out, 'Started on "Letter grid".');
  assert.equal(hintOf(n1, 'item'), 'ITEM-001');
  assert.equal(hintOf(n1, 'next'), 'maker');
  const brief = fs.readFileSync(hintOf(n1, 'brief'), 'utf8');
  assert.match(brief, /# Build one thing: "Letter grid" \(ITEM-001\)/);
  assert.match(brief, /open it; you see all 26 letters, big/);
  assert.match(brief, /children: No accounts for under-13s/);
  assert.match(brief, /Cohdit does not build apps in a refused category/);
  assert.match(brief, /build commit --dir/);
  assert.match(brief, /On the iPad \(a device check, not built\)/);
  assert.equal(H.git(['rev-parse', '--abbrev-ref', 'HEAD'], dir), 'item/001-letter-grid');
  assert.match(R(h, dir, 'status', 'plain', '--spool', H.spool(dir)), /^  building   Letter grid$/m, 'status reads the ledger, spool included');
});

test('the gate: commit refuses failing checks; a logic change goes to the checker; pass merges, prints Done; close commits the ledger', () => {
  const h = home();
  const dir = agreedIdea(h);
  const bare = withOrigin(dir);
  B(h, dir, ['open']);
  B(h, dir, ['next']);
  const lie = B(h, dir, ['built', 'ITEM-001', '--return', DONE()]);
  assert.equal(lie.code, 0, lie.err);
  assert.match(lie.out, /^Set aside "Letter grid"\.$/m);
  assert.equal(hintOf(lie, 'next'), 'next');
  const n2 = B(h, dir, ['next']);
  assert.equal(hintOf(n2, 'item'), 'ITEM-002');
  const pkg = path.join(dir, 'package.json');
  const good = fs.readFileSync(pkg, 'utf8');
  fs.writeFileSync(pkg, good.replace('"test": "node -e 0"', '"test": "node -e process.exit(1)"'));
  fs.writeFileSync(path.join(dir, 'app', 'sound.tsx'), 'export const sound = 1;\n');
  const bad = B(h, dir, ['commit', '-m', 'Tap to hear']);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /^The checks failed\.$/m);
  assert.match(bad.err, /^hint=checks_failed$/m);
  assert.equal(H.git(['log', '-1', '--format=%s'], dir), 'Hatch: ITEM-002 started', 'nothing committed beyond the start mark');
  fs.writeFileSync(pkg, good);
  const c = B(h, dir, ['commit', '-m', 'Tap to hear']);
  assert.equal(c.code, 0, c.err);
  assert.match(c.out, /^The checks passed\.$/m);
  assert.ok(bareLs(bare, 'item/002-tap-to-hear').includes('app/sound.tsx'), 'the claim branch on the shared copy carries the work');
  const built = B(h, dir, ['built', 'ITEM-002', '--return', DONE('logic', { findings: [{ scope: 'out', sev: 'low', text: 'Safari needs a tap before sound plays' }], decisions: [{ type: 'design', choice: 'speech_synthesis' }] })]);
  assert.equal(built.code, 0, built.err);
  assert.equal(built.out, 'Checking "Tap to hear".', 'one line for the whole review, however many lenses');
  assert.equal(hintOf(built, 'next'), 'review');
  assert.equal(hintOf(built, 'agents'), 'checker,lens-security,lens-privacy', 'a logic change under a personal rule: the bugs, security and privacy lenses');
  assert.match(fs.readFileSync(hintOf(built, 'diff'), 'utf8'), /sound\.tsx/);
  for (const a of hintOf(built, 'agents').split(',')) {
    const role = fs.readFileSync(path.join(hintOf(built, 'roles'), 'agent-' + a + '.md'), 'utf8');
    assert.match(role, /## The rules \(baseline\.json\)\n\n```json\n\{/, a + ' carries the rules it checks');
    const body = H.playbook('agent', a);
    if (body) assert.ok(role.startsWith(body.trim()), a + ' carries its instructions from the content, not the plugin stub');
  }
  const first = B(h, dir, ['checked', 'ITEM-002', '--return', '```json\n{"verdict":"pass","must_fix":[],"nits":2}\n```']);
  assert.equal(first.code, 0, first.err);
  assert.equal(first.out, '', 'nothing is said until every lens has reported');
  assert.equal(hintOf(first, 'agents'), 'lens-security,lens-privacy');
  assert.equal(B(h, dir, ['checked', 'ITEM-002', '--agent', 'checker', '--return', PASS]).code, 64, 'a lens reports once');
  assert.equal(B(h, dir, ['checked', 'ITEM-002', '--agent', 'lens-cost', '--return', PASS]).code, 64, 'a lens that was not asked is refused');
  const chk = review(h, dir, 'ITEM-002', 'lens-security,lens-privacy');
  assert.equal(chk.code, 0, chk.err);
  assert.equal(chk.out, 'Done: "Tap to hear".');
  assert.equal(H.git(['rev-parse', '--abbrev-ref', 'HEAD'], dir), 'main');
  assert.ok(bareLs(bare).includes('app/sound.tsx'), 'merged and pushed to the shared main');
  assert.ok(!spawnSync('git', ['show-ref', 'refs/heads/item/002-tap-to-hear'], { cwd: bare }).stdout.toString().trim(), 'the claim is released');
  B(h, dir, ['next']);
  makerCommits(h, dir, 'app/words.txt', 'A is for alligator\n', 'Animal picture');
  const low = B(h, dir, ['built', 'ITEM-003', '--return', DONE('copy', { try_note: 'Read the animal names; change any.' })]);
  assert.equal(low.out, 'Done: "Animal picture".');
  assert.equal(fs.readFileSync(path.join(dir, '.cohdit', 'notes', 'ITEM-003.txt'), 'utf8'), 'Read the animal names; change any.\n');
  const n4 = B(h, dir, ['next']);
  assert.equal(hintOf(n4, 'next'), 'close');
  const close = B(h, dir, ['close']);
  assert.equal(close.code, 0, close.err);
  assert.equal(close.out, [
    'Built 2 of 3 things.',
    "  set aside Letter grid — couldn't finish it",
    '  done      Tap to hear — tap a letter; you hear it',
    '  done      Animal picture — tap a letter; you see the animal and its name',
    'Saved in your GitHub account as abc-friends.',
    'Next: say "let me try it" and check these 2 things yourself.',
  ].join('\n'));
  assert.equal(hintOf(close, 'next'), 'try');
  assert.ok(!fs.existsSync(path.join(h.dir, '.cohdit', 'active.json')), 'pointer cleared');
  assert.equal(H.git(['status', '--porcelain'], dir), '', 'the ledger is committed');
  assert.ok(bareLs(bare).some((f) => /^\.cohdit\/ledger\/runs\/.*\.jsonl$/.test(f)), 'the ledger is on the shared copy');
  const events = R(h, dir, 'events', 'tech', '--last');
  for (const code of ['RUN_START', 'PUSH', 'PICK', 'DISPATCH', 'RETURN', 'VERIFY', 'RISK', 'REVIEW', 'GATE', 'DONE', 'FINDING', 'DECIDE', 'BLOCKED', 'RUN_END']) assert.match(events, new RegExp('  ' + code + ' '), code);
  assert.match(events, /REVIEW lens-security ITEM-002 must_fix=0 nits=0/, 'each lens leaves its own review record');
  assert.match(events, /DISPATCH lens-privacy ITEM-002 model=/);
  const status = R(h, dir, 'status', 'plain');
  assert.match(status, /^  to check   On the iPad$/m);
  assert.match(status, /^  set aside  Letter grid$/m);
  assert.match(status, /^Waiting on you: 2 things to try\. Say "let me try it"\.$/m);
  const digestTech = R(h, dir, 'digest', 'tech', '--last');
  assert.match(digestTech, /^Built 2 of 3 items \(run \S+\)\.$/m);
  assert.match(digestTech, /^  done      Tap to hear \(ITEM-002, [0-9a-f]{8}\) — /m);
  assert.doesNotMatch(digestTech, /^run=/m, 'tech reads sentences; key=value is the events view');
});

test('review rounds: a fail sends the maker back once; a second fail sets the thing aside', () => {
  const h = home();
  const dir = agreedIdea(h, 'Rounds', ITEMS.slice(0, 1));
  B(h, dir, ['open']);
  B(h, dir, ['next']);
  makerCommits(h, dir, 'app/grid.tsx', 'v1\n', 'grid');
  const b1 = B(h, dir, ['built', 'ITEM-001', '--return', DONE()]);
  const f1 = review(h, dir, 'ITEM-001', hintOf(b1, 'agents'), {
    checker: '{"verdict":"fail","must_fix":[{"n":1,"ref":"app/grid.tsx:1","text":"only 25 letters render"}],"nits":0}',
    'lens-privacy': '{"verdict":"fail","must_fix":[{"n":0,"ref":"app/grid.tsx:3","text":"PRI-NOLOG: the child\'s name is logged"}],"nits":1}',
  });
  assert.equal(f1.out, 'Fixing and rebuilding "Letter grid".');
  assert.equal(hintOf(f1, 'next'), 'maker');
  assert.match(fs.readFileSync(hintOf(f1, 'brief'), 'utf8'), /## The review asked for these changes\n- app\/grid\.tsx:1: only 25 letters render\n- \[privacy\] app\/grid\.tsx:3: PRI-NOLOG: the child's name is logged/, 'every lens\'s must-fix reaches the maker, the lens named');
  assert.equal(H.git(['rev-parse', '--abbrev-ref', 'HEAD'], dir), 'item/001-letter-grid');
  makerCommits(h, dir, 'app/grid.tsx', 'v2\n', 'grid again');
  const b2 = B(h, dir, ['built', 'ITEM-001', '--return', DONE()]);
  const f2 = review(h, dir, 'ITEM-001', hintOf(b2, 'agents'), { checker: '{"verdict":"fail","must_fix":[{"n":1,"text":"still 25"}],"nits":0}' });
  assert.match(f2.out, /^Set aside "Letter grid"\.$/m);
  assert.equal(hintOf(f2, 'next'), 'next');
  assert.equal(H.git(['rev-parse', '--abbrev-ref', 'HEAD'], dir), 'main');
  const close = B(h, dir, ['close']);
  // two review rounds failed; under the pinned test clock the two identical ROUND records share one id, so the count may read once
  assert.match(close.out, /^  set aside Letter grid — the checks failed (once|twice)$/m);
  assert.equal(hintOf(close, 'next'), 'none', 'nothing to try');
});

test('reports: a malformed report is re-asked once, then the thing is set aside; blocked and refused verdicts', () => {
  const h = home();
  const dir = agreedIdea(h, 'Reports', ITEMS.slice(0, 3));
  B(h, dir, ['open']);
  B(h, dir, ['next']);
  const bad1 = B(h, dir, ['built', 'ITEM-001', '--return', 'I built it, all good!']);
  assert.equal(bad1.code, 64);
  assert.match(bad1.err, /^hint=reask$/m);
  const bad2 = B(h, dir, ['built', 'ITEM-001', '--return', '{"verdict":"maybe"}']);
  assert.equal(bad2.code, 0);
  assert.match(bad2.out, /^Set aside "Letter grid"\.$/m);
  B(h, dir, ['next']);
  const blocked = B(h, dir, ['built', 'ITEM-002', '--return', '{"verdict":"blocked","blocked":{"reason":"ambiguous","text":"Which voice: the letter name or its sound?"},"findings":[]}']);
  assert.equal(blocked.out, 'Set aside "Tap to hear": I need you to decide something.');
  B(h, dir, ['next']);
  const refused = B(h, dir, ['built', 'ITEM-003', '--return', '{"verdict":"refused","refused":"harm","findings":[]}']);
  assert.equal(refused.code, 1);
  assert.match(refused.out, /Cohdit doesn't build apps that are designed to physically hurt/);
  assert.equal(hintOf(refused, 'next'), 'close');
  const n = B(h, dir, ['next']);
  assert.equal(hintOf(n, 'next'), 'close', 'a stopped run picks nothing more');
  const close = B(h, dir, ['close']);
  assert.equal(close.code, 1);
  assert.match(close.out, /^Built 0 of 3 things\.$/m);
  assert.doesNotMatch(close.out, /let me try it/);
});

test('maker report: brackets in test paths pass, extra paths and long sentence choices are normalised, and the message names the limit', () => {
  const bd = require('../scripts/lib/build');
  const rep = (o) => '```json\n' + JSON.stringify(Object.assign({ verdict: 'done', change: 'logic' }, o)) + '\n```';
  const ok = bd.makerReturn(rep({ criteria: [
    { n: 1, met: true, test: 'app/api/tests/[id]/runs/route.test.ts:230' },
    { n: 2, met: true, test: 'app/(shop)/cart/page.test.tsx' },
    { n: 3, met: true, test: 'a.test.ts:3; b.test.ts:9; c.test.ts' },
  ] }));
  assert.equal(ok.criteria[0].test, 'app/api/tests/[id]/runs/route.test.ts:230');
  assert.equal(ok.criteria[1].test, 'app/(shop)/cart/page.test.tsx');
  assert.equal(ok.criteria[2].test, 'a.test.ts:3');
  const sentence = 'Use the {id} route, with a "retry" button (not a link), because the list can be long and it keeps the page simple for people on slow phones and small screens';
  assert.ok(sentence.length > 109);
  const d = bd.makerReturn(rep({ decisions: [{ type: 'design', choice: sentence }, { type: 'design', choice: 'fox_for_x' }] }));
  assert.match(d.decisions[0].choice, /^[A-Za-z0-9._/:@-]{1,96}$/);
  assert.equal(d.decisions[1].choice, 'fox_for_x');
  // a side note that does not fit is left out and named, never a reason to refuse the report
  const loose = bd.makerReturn(rep({
    criteria: [{ n: 1, met: true, test: '$(x)' }],
    decisions: [{ type: 'design', choice: '!!!' }, { type: 'architecture', choice: 'server' }, { type: 'data', choice: 'kv' }],
    findings: [{ scope: 'maybe', sev: 'huge', text: 'slow on old phones' }, { scope: 'in' }],
    try_note: 3,
  }));
  assert.equal(loose.criteria[0].test, undefined);
  assert.deepEqual(loose.decisions, [{ type: 'data', choice: 'kv' }]);
  assert.deepEqual(loose.findings, [{ scope: 'in', sev: 'medium', text: 'slow on old phones' }]);
  assert.equal(loose.try_note, undefined);
  assert.equal(loose.dropped.length, 5, loose.dropped.join('; '));
  assert.throws(() => bd.makerReturn(rep({ change: 'big' })), /change must be one of/, 'what decides the outcome is still checked');
  assert.throws(() => bd.makerReturn(rep({ criteria: [{ n: 'one', met: true }] })), /each criterion needs n/);
});

test('a report refused twice sets the thing aside but keeps its committed work on kept/<branch>', () => {
  const h = home();
  const dir = agreedIdea(h);
  const bare = withOrigin(dir);
  B(h, dir, ['open']);
  B(h, dir, ['next']);
  makerCommits(h, dir, 'app/grid.tsx', 'export const grid = 1;\n', 'Letter grid');
  assert.equal(B(h, dir, ['built', 'ITEM-001', '--return', '{"verdict":"maybe"}']).code, 64);
  const second = B(h, dir, ['built', 'ITEM-001', '--return', '{"verdict":"maybe"}']);
  assert.match(second.out, /^Set aside "Letter grid"\.$/m);
  assert.equal(hintOf(second, 'kept'), 'kept/001-letter-grid');
  assert.ok(bareLs(bare, 'kept/001-letter-grid').includes('app/grid.tsx'), 'the work is on the shared copy');
  assert.ok(H.git(['ls-tree', '-r', '--name-only', 'kept/001-letter-grid'], dir).split('\n').includes('app/grid.tsx'), 'and here');
  const n = B(h, dir, ['next']);
  assert.equal(hintOf(n, 'item'), 'ITEM-002', 'a kept branch is not a claim');
});

test('a new item starts from this computer\'s main when the person committed on it without pushing', () => {
  const h = home();
  const dir = agreedIdea(h);
  const bare = withOrigin(dir);
  B(h, dir, ['open']);
  B(h, dir, ['close']);
  fs.writeFileSync(path.join(dir, 'NOTES.md'), 'reshaped by hand\n');
  H.git(['add', 'NOTES.md'], dir);
  H.git(['commit', '-q', '-m', 'local only'], dir);
  assert.ok(!bareLs(bare).includes('NOTES.md'), 'not pushed yet');
  B(h, dir, ['open']);
  const n = B(h, dir, ['next']);
  assert.equal(n.code, 0, n.err);
  assert.ok(fs.existsSync(path.join(dir, 'NOTES.md')), 'the item is built on the local commit');
  assert.ok(bareLs(bare).includes('NOTES.md'), 'and the local commit was pushed first');
});

test('open refuses to start: a refused idea (exit 5), an unagreed one, a dirty tree; and resumes after a crash', () => {
  const h = home();
  const r = run(h, ['idea', 'new', 'Tracker']);
  const refusedDir = hintOf(r, 'dir');
  run(h, ['idea', 'refuse', 'harm', '--dir', refusedDir]);
  const o5 = B(h, refusedDir, ['open']);
  assert.equal(o5.code, 5);
  assert.match(o5.out, /^I can't build this idea\./);
  const u = run(h, ['idea', 'new', 'Unagreed']);
  const o1 = B(h, hintOf(u, 'dir'), ['open']);
  assert.equal(o1.code, 1);
  assert.match(o1.err, /^hint=not_agreed$/m);
  const dir = agreedIdea(h, 'Dirty', ITEMS.slice(0, 1));
  B(h, dir, ['open']);
  B(h, dir, ['close']);
  fs.appendFileSync(path.join(dir, 'app', 'page.tsx'), '// mine\n');
  const od = B(h, dir, ['open']);
  assert.equal(od.code, 1);
  assert.equal(od.out, 'I stopped because the project has changes I didn\'t make. Say "show me the details".');
  H.git(['commit', '-q', '-am', 'mine'], dir);
  const ok = B(h, dir, ['open']);
  assert.equal(ok.code, 0, ok.err);
  const n = B(h, dir, ['next']);
  assert.equal(hintOf(n, 'next'), 'maker');
  fs.writeFileSync(path.join(dir, 'app', 'half.tsx'), 'half done\n');   // the maker mid-work, then the lid closes
  const re = B(h, dir, ['open']);
  assert.equal(re.code, 0, re.err);
  assert.match(re.err, /^hint=resumed$/m);
  const n2 = B(h, dir, ['next']);
  assert.equal(hintOf(n2, 'item'), 'ITEM-001', 'the same thing continues');
  assert.equal(hintOf(n2, 'next'), 'maker');
  assert.equal(H.git(['rev-parse', '--abbrev-ref', 'HEAD'], dir), 'item/001-letter-grid');
});

test('add: a package on the list installs; one off the list is refused with the reason', () => {
  const h = home();
  const dir = agreedIdea(h, 'Deps', ITEMS.slice(0, 1));
  B(h, dir, ['open']);
  B(h, dir, ['next']);
  assert.equal(B(h, dir, ['add', 'stripe']).code, 0);
  const off = B(h, dir, ['add', 'tailwindcss']);
  assert.equal(off.code, 64);
  assert.match(off.err, /not on my list: tailwindcss/);
  assert.match(off.err, /^hint=not_on_list$/m);
  makerCommits(h, dir, 'app/pay.tsx', 'pay\n', 'payments');
  const built = B(h, dir, ['built', 'ITEM-001', '--return', DONE('config')]);
  assert.equal(hintOf(built, 'next'), 'review', 'a dependency change is never low risk');
  assert.equal(hintOf(built, 'agents'), 'checker,lens-security,lens-privacy,lens-cost', 'a paid package brings the cost lens');
  const events = R(h, dir, 'events', 'tech', '--spool', H.spool(dir));
  assert.match(events, /RISK ITEM-001 tier=high signals=config,deps,paid,personal,rails/);
});

test('without GitHub the build still runs and says the copy is not online', () => {
  const h = home(false);
  const dir = agreedIdea(h, 'Offline', ITEMS.slice(0, 1));
  const o = B(h, dir, ['open']);
  assert.equal(o.code, 0, o.err);
  B(h, dir, ['next']);
  makerCommits(h, dir, 'app/x.txt', 'x\n', 'x');
  B(h, dir, ['built', 'ITEM-001', '--return', DONE('copy')]);
  const close = B(h, dir, ['close']);
  assert.match(close.out, /^Not saved online yet; say "set me up" to sign in to GitHub\.$/m);
  assert.match(close.out, /^  done      Letter grid/m, 'merged locally');
});

test('two sessions on one computer share the work: a side copy, claims, and combining before merging', () => {
  const h = home();
  const dir = agreedIdea(h, 'Shared', ITEMS.slice(0, 3));
  oneLane(dir);
  const bare = withOrigin(dir);
  const A = (args, input) => run(h, ['build', args[0], '--session', 'sess-a'].concat(args.slice(1), ['--dir', dir]), input);   // the hook's shape
  const oA = A(['open']);
  assert.equal(oA.code, 0, oA.err);
  assert.ok(bareLs(bare).includes('package.json'), 'the first run pushed the skeleton to the shared copy');
  const nA = A(['next']);
  assert.equal(hintOf(nA, 'item'), 'ITEM-001');
  assert.ok(spawnSync('git', ['show-ref', 'refs/heads/item/001-letter-grid'], { cwd: bare }).stdout.toString().trim(), 'the claim is a branch on the shared copy');
  // a second session, same computer, same folder: it gets its own working copy
  const oB = run(h, ['build', 'open', '--dir', dir, '--session', 'sess-b']);
  assert.equal(oB.code, 0, oB.err);
  assert.match(oB.err, /^hint=side_copy$/m);
  const dirB = hintOf(oB, 'dir');
  assert.notEqual(dirB, dir);
  assert.ok(dirB.includes(path.join('Hatch', '.work', 'shared-2')), dirB);
  const Bb = (args, input) => run(h, ['build'].concat(args, ['--dir', dirB, '--session', 'sess-b']), input);
  const pointer = (s) => JSON.parse(fs.readFileSync(path.join(h.dir, '.cohdit', 'active.' + s + '.json'), 'utf8')).path;
  assert.equal(pointer('sess-a'), dir); assert.equal(pointer('sess-b'), dirB);
  const oB2 = run(h, ['build', 'open', '--dir', dir, '--session', 'sess-b']);                 // "continue" in the second window
  assert.equal(hintOf(oB2, 'dir'), dirB, 'finds its own copy instead of opening a third');
  assert.match(oB2.err, /^hint=resumed$/m);
  assert.ok(!fs.existsSync(path.join(path.dirname(dirB), 'shared-3')));
  const nB = Bb(['next']);
  assert.equal(hintOf(nB, 'item'), 'ITEM-002', 'the claimed thing is skipped');
  assert.equal(nB.out, 'Started on "Tap to hear".');
  // A finishes first
  makerCommits(h, dir, 'app/grid.tsx', 'grid\n', 'grid');
  const dA = A(['built', 'ITEM-001', '--return', DONE('copy')]);
  assert.equal(dA.out, 'Done: "Letter grid".');
  assert.ok(bareLs(bare).includes('app/grid.tsx'));
  // B finishes on a main that moved: rebased, re-checked, pushed
  fs.mkdirSync(path.join(dirB, 'app'), { recursive: true });
  fs.writeFileSync(path.join(dirB, 'app', 'sound.tsx'), 'sound\n');
  const cB = Bb(['commit', '-m', 'sound']);
  assert.equal(cB.code, 0, cB.err);
  const dB = Bb(['built', 'ITEM-002', '--return', DONE('copy')]);
  assert.equal(dB.out, 'The checks passed.\nDone: "Tap to hear".', 'combined with A\'s work and checked again');
  const files = bareLs(bare);
  assert.ok(files.includes('app/grid.tsx') && files.includes('app/sound.tsx'), 'both things are on the shared main');
  // B picks the last thing, A finds nothing left but sees it is being built elsewhere
  const nB3 = Bb(['next']);
  assert.equal(hintOf(nB3, 'item'), 'ITEM-003');
  const nA3 = A(['next']);
  assert.equal(hintOf(nA3, 'next'), 'close');
  assert.match(nA3.err, /^hint=others_building$/m);
  const closeA = A(['close']);
  assert.equal(closeA.code, 0, closeA.err);
  assert.match(closeA.out, /^Built 1 of 1 thing\.$/m);
  const statusA = R(h, dir, 'status', 'plain');
  assert.match(statusA, /^  done       Letter grid$/m);
  assert.match(statusA, /^  done       Tap to hear$/m, 'A\'s ledger holds B\'s outcome too, through the shared copy');
  assert.match(statusA, /^  building   Animal picture$/m);
  fs.writeFileSync(path.join(dirB, 'app', 'animal.tsx'), 'animal\n');
  Bb(['commit', '-m', 'animal']);
  Bb(['built', 'ITEM-003', '--return', DONE('copy')]);
  const closeB = Bb(['close']);
  assert.equal(closeB.code, 0, closeB.err);
  assert.match(closeB.out, /^Built 2 of 2 things\.$/m);
  assert.ok(!fs.existsSync(dirB), 'the side copy is removed when its run ends');
  assert.equal(H.git(['branch', '--list', 'hatch/*'], dir), '', 'and so is its branch');
  assert.ok(!fs.existsSync(path.join(h.dir, '.cohdit', 'active.sess-b.json')), 'B\'s pointer is gone with its run');
  const runs = bareLs(bare).filter((f) => /^\.cohdit\/ledger\/runs\/.*\.jsonl$/.test(f));
  assert.ok(runs.length >= 3, 'both runs\' ledgers are on the shared copy: ' + runs.join(', '));
  B(h, dir, ['open']);
  const nA4 = B(h, dir, ['next']);
  assert.equal(hintOf(nA4, 'next'), 'close', 'nothing left: the primary sees every outcome after syncing');
  assert.match(R(h, dir, 'status', 'plain'), /^Waiting on you: 3 things to try/m);
});

test('lanes: three makers at once, one thing each, landed on main one at a time, one run and one digest', () => {
  const h = home();
  const dir = agreedIdea(h, 'Lanes', ITEMS);
  const bare = withOrigin(dir);
  const o = B(h, dir, ['open']);
  assert.equal(o.code, 0, o.err);
  const lanes = (hintOf(o, 'lanes') || '').split(',').filter(Boolean);
  assert.equal(lanes.length, 2, 'three things to build: the lead and two lanes (the device check is not built)');
  const [l2, l3] = lanes;
  for (const l of lanes) assert.ok(l.includes(path.join('Hatch', '.work', 'lanes-')), l);
  const n1 = B(h, dir, ['next']), n2 = B(h, l2, ['next']), n3 = B(h, l3, ['next']);
  assert.deepEqual([n1, n2, n3].map((n) => hintOf(n, 'item')), ['ITEM-001', 'ITEM-002', 'ITEM-003'], 'each lane its own thing');
  assert.deepEqual([n1, n2, n3].map((n) => hintOf(n, 'next')), ['maker', 'maker', 'maker']);
  assert.ok(hintOf(n2, 'brief').endsWith('brief-ITEM-002.md'));
  assert.match(fs.readFileSync(hintOf(n2, 'brief'), 'utf8'), new RegExp('Folder: ' + l2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the lane\'s maker works in the lane');
  // they finish in any order; each lands on the shared main through the gate
  makerCommits(h, l2, 'app/sound.tsx', 'sound\n', 'sound');
  makerCommits(h, dir, 'app/grid.tsx', 'grid\n', 'grid');
  makerCommits(h, l3, 'app/animal.tsx', 'animal\n', 'animal');
  const d2 = B(h, l2, ['built', 'ITEM-002', '--return', DONE('copy', { try_note: 'Tap A. You hear it.' })]);
  assert.equal(d2.out, 'Done: "Tap to hear".');
  assert.equal(hintOf(B(h, l2, ['next']), 'next'), 'wait', 'nothing left to start, but others are mid-thing');
  const d1 = B(h, dir, ['built', 'ITEM-001', '--return', DONE('copy')]);
  assert.equal(d1.out, 'The checks passed.\nDone: "Letter grid".', 'combined with the lane\'s work, checked again');
  const d3 = B(h, l3, ['built', 'ITEM-003', '--return', DONE('copy')]);
  assert.match(d3.out, /Done: "Animal picture"\.$/);
  const files = bareLs(bare);
  for (const f of ['app/grid.tsx', 'app/sound.tsx', 'app/animal.tsx']) assert.ok(files.includes(f), f);
  assert.equal(hintOf(B(h, l2, ['next']), 'next'), 'close');
  assert.equal(hintOf(B(h, l3, ['next']), 'next'), 'close');
  assert.equal(hintOf(B(h, dir, ['next']), 'next'), 'close');
  assert.equal(fs.readFileSync(path.join(dir, '.cohdit', 'notes', 'ITEM-002.txt'), 'utf8'), 'Tap A. You hear it.\n', 'a lane\'s try note is kept with the lead');
  const close = B(h, dir, ['close']);
  assert.equal(close.code, 0, close.err);
  assert.match(close.out, /^Built 3 of 3 things\.$/m, 'one digest for the whole run');
  for (const l of lanes) assert.ok(!fs.existsSync(l), 'the lanes are removed: ' + l);
  assert.equal(H.git(['branch', '--list', 'hatch/*'], dir), '');
  assert.match(R(h, dir, 'status', 'plain'), /^Waiting on you: 3 things to try/m);
  const runs = bareLs(bare).filter((f) => /^\.cohdit\/ledger\/runs\/.*\.jsonl$/.test(f));
  const recs = runs.flatMap((f) => spawnSync('git', ['show', 'main:' + f], { cwd: bare, encoding: 'utf8' }).stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  assert.equal(recs.filter((r) => r.c === 'DONE').length, 3, 'every lane\'s outcome is in the ledger on the shared copy');
  assert.equal(new Set(recs.filter((r) => r.c === 'PICK').map((r) => r.r)).size, 1, 'one run');
});

test('lanes: a clash rebuilds the thing once on the new main and narrows the run to one lane', () => {
  const h = home();
  const dir = agreedIdea(h, 'Clash', ITEMS.slice(0, 2));
  const bare = withOrigin(dir);
  const o = B(h, dir, ['open']);
  const [l2] = (hintOf(o, 'lanes') || '').split(',');
  assert.ok(l2, o.err);
  B(h, dir, ['next']);
  B(h, l2, ['next']);
  makerCommits(h, l2, 'app/page.tsx', 'from the lane\n', 'lane');
  makerCommits(h, dir, 'app/page.tsx', 'from the lead\n', 'lead');
  assert.match(B(h, l2, ['built', 'ITEM-002', '--return', DONE('copy')]).out, /Done/);
  const c = B(h, dir, ['built', 'ITEM-001', '--return', DONE('copy')]);
  assert.equal(c.code, 0, c.err);
  assert.equal(hintOf(c, 'next'), 'maker', 'built again, not set aside');
  assert.equal(c.out, 'Fixing and rebuilding "Letter grid".');
  const brief = fs.readFileSync(hintOf(c, 'brief'), 'utf8');
  assert.match(brief, /Build this thing again on the current main\. Your earlier version is the diff at /);
  assert.match(fs.readFileSync(bdl.diffPath(dir, 'ITEM-001'), 'utf8'), /\+from the lead/, 'the earlier version is kept beside it');
  assert.equal(H.git(['merge-base', '--is-ancestor', 'origin/main', 'item/001-letter-grid'], dir), '', 'restarted on the current main');
  assert.ok(H.git(['branch', '--list', 'kept/001-letter-grid'], dir), 'its first version is kept');
  assert.equal(hintOf(B(h, l2, ['next']), 'next'), 'close', 'narrowed: the lane takes nothing new');
  makerCommits(h, dir, 'app/page.tsx', 'from the lane\nand the lead\n', 'both');
  assert.match(B(h, dir, ['built', 'ITEM-001', '--return', DONE('copy')]).out, /Done: "Letter grid"/);
  assert.equal(spawnSync('git', ['show', 'main:app/page.tsx'], { cwd: bare, encoding: 'utf8' }).stdout, 'from the lane\nand the lead\n');
  assert.match(B(h, dir, ['close']).out, /^Built 2 of 2 things\.$/m);
});

test('narrow: the lanes finish what they hold and take nothing new', () => {
  const h = home();
  const dir = agreedIdea(h, 'Lanes', ITEMS.slice(0, 3));
  withOrigin(dir);
  const [l2, l3] = hintOf(B(h, dir, ['open']), 'lanes').split(',');
  B(h, dir, ['next']);
  assert.equal(hintOf(B(h, l2, ['next']), 'item'), 'ITEM-002');
  assert.equal(B(h, dir, ['narrow']).code, 0);
  assert.equal(hintOf(B(h, l2, ['next']), 'item'), 'ITEM-002', 'what it holds, it finishes');
  assert.equal(hintOf(B(h, l3, ['next']), 'next'), 'close', 'nothing new');
  assert.equal(hintOf(B(h, dir, ['open']), 'lanes'), [l2, l3].join(','), 'a resumed run keeps its lanes and opens no more');
});

test('a claim untouched for a day is taken over; a live one is not', () => {
  const h = home();
  const dir = agreedIdea(h, 'Stale', ITEMS.slice(0, 2));
  const bare = withOrigin(dir);
  B(h, dir, ['open']);
  // another computer claimed both things; one claim is a day old
  const other = H.tmpdir();
  spawnSync('git', ['clone', '-q', bare, other], { encoding: 'utf8' });
  const env = Object.assign({}, H.ENV, { GIT_COMMITTER_DATE: '2026-10-30T10:00:00Z', GIT_AUTHOR_DATE: '2026-10-30T10:00:00Z' });
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'old work'], { cwd: other, env, encoding: 'utf8' });
  spawnSync('git', ['push', '-q', 'origin', 'HEAD:refs/heads/item/001-letter-grid'], { cwd: other, encoding: 'utf8' });
  spawnSync('git', ['reset', '-q', '--hard', 'origin/main'], { cwd: other, encoding: 'utf8' });
  const live = Object.assign({}, H.ENV, { GIT_COMMITTER_DATE: '2026-11-01T09:50:00Z', GIT_AUTHOR_DATE: '2026-11-01T09:50:00Z' });
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'live work'], { cwd: other, env: live, encoding: 'utf8' });
  spawnSync('git', ['push', '-q', 'origin', 'HEAD:refs/heads/item/002-tap-to-hear'], { cwd: other, encoding: 'utf8' });
  const n = B(h, dir, ['next']);
  assert.equal(hintOf(n, 'item'), 'ITEM-001', 'the stale claim is taken over; the live one is left alone');
  const tip = spawnSync('git', ['log', '-1', '--format=%s %cI', 'item/001-letter-grid'], { cwd: bare, encoding: 'utf8' }).stdout.trim();
  assert.match(tip, /^Hatch: ITEM-001 started 2026-11-01T/, 'the claim carries its own date, not main\'s: ' + tip);
  const n2 = B(h, dir, ['next']);
  assert.equal(hintOf(n2, 'item'), 'ITEM-001', 'still ours');
});

const BLOCKED = (text = 'stuck') => JSON.stringify({ verdict: 'blocked', blocked: { reason: 'other', text }, findings: [] });

test('the maker may ask one colleague: the advisor answers into the brief, a second question is a decision for the person', () => {
  const h = home();
  const dir = agreedIdea(h, 'Consult', ITEMS.slice(0, 1));
  B(h, dir, ['open']);
  B(h, dir, ['next']);
  makerCommits(h, dir, 'app/grid.tsx', 'v1\n', 'grid');
  const bad = B(h, dir, ['built', 'ITEM-001', '--return', '{"verdict":"consult","consult":{"role":"wizard","question":"?"}}']);
  assert.equal(bad.code, 64);
  assert.match(bad.err, /consult needs role \(architect, tester, analyst, owner, security, privacy, cost\)/);
  const ask = B(h, dir, ['built', 'ITEM-001', '--return', '{"verdict":"consult","consult":{"role":"architect","question":"One grid component or 26 buttons?"}}']);
  assert.equal(ask.code, 0, ask.err);
  assert.equal(ask.out, 'Asking a colleague about "Letter grid".');
  assert.equal(hintOf(ask, 'next'), 'advisor');
  const consult = fs.readFileSync(hintOf(ask, 'consult'), 'utf8');
  assert.ok(fs.existsSync(path.join(hintOf(ask, 'roles'), 'agent-advisor.md')), 'the advisor\'s instructions sit beside the consult');
  assert.equal(path.dirname(hintOf(ask, 'consult')), hintOf(ask, 'roles'));
  assert.match(consult, /# A question for the architect\n[\s\S]*One grid component or 26 buttons\?/);
  assert.equal(B(h, dir, ['built', 'ITEM-001', '--return', DONE()]).code, 64, 'the maker is not expected while the advisor thinks');
  const re = B(h, dir, ['next']);
  assert.equal(hintOf(re, 'next'), 'advisor', 'a resumed run waits on the same advisor');
  const ans = B(h, dir, ['advised', 'ITEM-001', '--return', '```json\n{"answer":"One component; a button per letter is 26 places to get it wrong."}\n```']);
  assert.equal(ans.code, 0, ans.err);
  assert.equal(ans.out, 'Carrying on with "Letter grid".');
  assert.equal(hintOf(ans, 'next'), 'maker');
  assert.match(fs.readFileSync(hintOf(ans, 'brief'), 'utf8'), /## The architect's answer\nYou asked: One grid component or 26 buttons\?\n\nOne component; a button per letter/);
  assert.equal(H.git(['rev-parse', '--abbrev-ref', 'HEAD'], dir), 'item/001-letter-grid', 'the maker carries on where it was');
  const twice = B(h, dir, ['built', 'ITEM-001', '--return', '{"verdict":"consult","consult":{"role":"tester","question":"and again?"}}']);
  assert.match(twice.out, /^Set aside "Letter grid": I need you to decide something\.$/m, 'one question per thing');
  const events = R(h, dir, 'events', 'tech', '--spool', H.spool(dir));
  assert.match(events, /DISPATCH advisor ITEM-001 model=/);
  assert.match(events, /RETURN advisor ITEM-001 verdict=answered/);
  assert.match(events, /ROUND ITEM-001 cause=consult/);
});

test('the gate refuses a commit under the coverage floor and says which test to add', () => {
  const h = home();
  const dir = agreedIdea(h, 'Coverage', ITEMS.slice(0, 1));
  B(h, dir, ['open']);
  const cfgFile = path.join(dir, '.cohdit', 'config.json');
  assert.equal(JSON.parse(fs.readFileSync(cfgFile, 'utf8')).coverage_min, 80, 'the scaffold sets the floor');
  B(h, dir, ['next']);
  const summary = (lines, branches) => fs.writeFileSync(path.join(dir, 'coverage', 'coverage-summary.json'), JSON.stringify({ total: { lines: { pct: lines }, branches: { pct: branches } } }));
  fs.mkdirSync(path.join(dir, 'coverage'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app', 'grid.tsx'), 'grid\n');
  summary(91.2, 62.5);
  const low = B(h, dir, ['commit', '-m', 'grid']);
  assert.equal(low.code, 1);
  assert.match(low.out, /^The checks failed\.\nCoverage is 62%; this project requires 80%\. Add the test that proves the change/m, 'the lower of lines and branches counts');
  summary(91.2, 84);
  const ok = B(h, dir, ['commit', '-m', 'grid']);
  assert.equal(ok.code, 0, ok.err + ok.out);
  const events = R(h, dir, 'events', 'tech', '--spool', H.spool(dir));
  assert.match(events, /VERIFY ITEM-001 rc=1 dur=\d+s cov=62% cmd=[0-9a-f]{16}/);
  assert.match(events, /VERIFY ITEM-001 rc=0 dur=\d+s cov=84% cmd=-/);
  const noTest = B(h, dir, ['built', 'ITEM-001', '--return', DONE('logic', { criteria: [{ n: 1, met: true, ref: 'a.tsx:1', test: 'not a path!' }] })]);
  assert.equal(noTest.code, 0, 'a test path that does not fit is left out, never a reason to set the thing aside');
  assert.match(noTest.err, /^hatch: left out of the report: criterion 1 test/m);
});

test('a done report with an unmet check is set aside; a report from the wrong agent is refused', () => {
  const h = home();
  const dir = agreedIdea(h, 'Checks', ITEMS.slice(0, 2));
  B(h, dir, ['open']);
  B(h, dir, ['next']);
  makerCommits(h, dir, 'app/grid.tsx', 'grid\n', 'grid');
  const wrong = B(h, dir, ['checked', 'ITEM-001', '--return', PASS]);
  assert.equal(wrong.code, 64);
  assert.match(wrong.err, /^hint=wrong_phase$/m);
  assert.equal(H.git(['rev-parse', '--abbrev-ref', 'HEAD'], dir), 'item/001-letter-grid', 'nothing moved');
  const unmet = B(h, dir, ['built', 'ITEM-001', '--return', DONE('logic', { criteria: [{ n: 1, met: false }] })]);
  assert.equal(unmet.code, 0, unmet.err);
  assert.match(unmet.out, /^Set aside "Letter grid"\.$/m, 'a guess is never done');
  assert.equal(hintOf(unmet, 'next'), 'next');
  const twice = B(h, dir, ['built', 'ITEM-001', '--return', DONE()]);
  assert.equal(twice.code, 64, 'a report for a thing that is no longer open is refused');
});

test("the maker's half work never reaches the next thing, the person, or a run that crashed", () => {
  const h = home();
  const dir = agreedIdea(h, 'Leftover', ITEMS.slice(0, 2));
  withOrigin(dir);
  B(h, dir, ['open']);
  B(h, dir, ['next']);
  const page = path.join(dir, 'app', 'page.tsx');
  const scaffolded = fs.readFileSync(page, 'utf8');
  makerCommits(h, dir, 'app/page.tsx', 'v1\n', 'page');
  fs.writeFileSync(page, 'v2, half\n');                                   // an uncommitted edit to a file the branch changed
  fs.writeFileSync(path.join(dir, 'app', 'half.tsx'), 'half\n');
  const b = B(h, dir, ['built', 'ITEM-001', '--return', BLOCKED()]);
  assert.equal(b.code, 0, b.err);
  assert.match(b.out, /^Set aside "Letter grid"\.$/m);
  assert.equal(H.git(['rev-parse', '--abbrev-ref', 'HEAD'], dir), 'main');
  assert.equal(H.git(['status', '--porcelain'], dir), '', 'clean, and the ledger committed');
  const n2 = B(h, dir, ['next']);
  assert.equal(hintOf(n2, 'item'), 'ITEM-002');
  assert.ok(!fs.existsSync(path.join(dir, 'app', 'half.tsx')), 'the next thing starts clean');
  assert.equal(fs.readFileSync(page, 'utf8'), scaffolded);
  fs.writeFileSync(path.join(dir, 'app', 'half.tsx'), 'half again\n');      // the maker mid-work when the session dies
  const later = { dir: h.dir, env: Object.assign({}, h.env, { COHDIT_NOW: '2026-11-02T11:00:00Z' }) };
  const o = B(later, dir, ['open']);
  assert.equal(o.code, 0, o.err + o.out);
  assert.doesNotMatch(o.out, /changes I didn't make/, 'Hatch never blames its own leftovers on the person');
  assert.notEqual(hintOf(o, 'run'), hintOf(n2, 'run'), 'a new run');
  const n3 = B(later, dir, ['next']);
  assert.equal(hintOf(n3, 'item'), 'ITEM-002', 'the thing the crashed run held is built again, not stuck as building');
  assert.ok(!fs.existsSync(path.join(dir, 'app', 'half.tsx')));
  const events = R(later, dir, 'events', 'tech', '--run', hintOf(n2, 'run'));
  assert.match(events, /RUN_END outcome=crashed/, 'the abandoned run is closed in the ledger');
});

test('a side copy keeps its outcomes when the shared main moved under it', () => {
  const h = home();
  const dir = agreedIdea(h, 'Lease', ITEMS.slice(0, 3));
  oneLane(dir);
  const bare = withOrigin(dir);
  const A = (args, input) => run(h, ['build'].concat(args, ['--dir', dir, '--session', 'sess-a']), input);
  A(['open']);
  A(['next']);
  const oB = run(h, ['build', 'open', '--dir', dir, '--session', 'sess-b']);
  const dirB = hintOf(oB, 'dir'), runB = hintOf(oB, 'run');
  const Bb = (args, input) => run(h, ['build'].concat(args, ['--dir', dirB, '--session', 'sess-b']), input);
  assert.equal(hintOf(Bb(['next']), 'item'), 'ITEM-002');
  const other = H.tmpdir();                                                // a third computer moves main
  spawnSync('git', ['clone', '-q', bare, other], { encoding: 'utf8' });
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'elsewhere'], { cwd: other, env: H.ENV, encoding: 'utf8' });
  spawnSync('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: other, encoding: 'utf8' });
  const b = Bb(['built', 'ITEM-002', '--return', BLOCKED()]);             // the ledger push loses its lease
  assert.match(b.out, /^Set aside "Tap to hear"\.$/m);
  const n = Bb(['next']);
  assert.equal(hintOf(n, 'item'), 'ITEM-003', 'the set-aside thing is not picked again');
  const kept = spawnSync('git', ['show', 'hatch/lease-2:.cohdit/ledger/runs/' + runB + '.jsonl'], { cwd: dirB, encoding: 'utf8' });
  assert.equal(kept.status, 0, 'the run file survived on the side copy\'s own main line');
  fs.writeFileSync(path.join(dirB, 'app', 'animal.tsx'), 'animal\n');
  Bb(['commit', '-m', 'animal']);
  assert.match(Bb(['built', 'ITEM-003', '--return', DONE('copy')]).out, /^Done: "Animal picture"\.$/m);
  const close = Bb(['close']);
  assert.match(close.out, /^Built 1 of 2 things\.$/m);
  assert.ok(bareLs(bare).includes('.cohdit/ledger/runs/' + runB + '.jsonl'), 'the outcome reached the shared copy');
  const shared = spawnSync('git', ['show', 'main:.cohdit/ledger/runs/' + runB + '.jsonl'], { cwd: bare, encoding: 'utf8' }).stdout;
  assert.match(shared, /"c":"BLOCKED".*"i":"ITEM-002"|"i":"ITEM-002".*"c":"BLOCKED"/);
});

test('a changed ledger file never costs the shared main what others merged', () => {
  const h = home();
  const dir = agreedIdea(h, 'Ledger', ITEMS.slice(0, 1));
  const bare = withOrigin(dir);
  B(h, dir, ['open']);
  B(h, dir, ['next']);
  const cfgFile = path.join(dir, '.cohdit', 'config.json');                // as ensureRepo leaves it after the first push
  fs.writeFileSync(cfgFile, fs.readFileSync(cfgFile, 'utf8').replace('"v": 1', '"v": 1, "touched": true'));
  const other = H.tmpdir();                                                // another computer moves main meanwhile
  spawnSync('git', ['clone', '-q', bare, other], { encoding: 'utf8' });
  fs.writeFileSync(path.join(other, 'theirs.txt'), 'theirs\n');
  const otherCfg = path.join(other, '.cohdit', 'config.json');               // and changes the same ledger file, so the carried change conflicts
  fs.writeFileSync(otherCfg, fs.readFileSync(otherCfg, 'utf8').replace('"v": 1', '"v": 1, "theirs": true'));
  spawnSync('git', ['add', '-A'], { cwd: other, env: H.ENV, encoding: 'utf8' });
  spawnSync('git', ['commit', '-q', '-m', 'theirs'], { cwd: other, env: H.ENV, encoding: 'utf8' });
  spawnSync('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: other, encoding: 'utf8' });
  makerCommits(h, dir, 'app/grid.tsx', 'grid\n', 'grid');
  const d = B(h, dir, ['built', 'ITEM-001', '--return', DONE('copy')]);
  assert.match(d.out, /^Done: "Letter grid"\.$/m);
  const files = bareLs(bare);
  assert.ok(files.includes('app/grid.tsx') && files.includes('theirs.txt'), 'both the finished work and theirs are on the shared main: ' + files.join(' '));
  const close = B(h, dir, ['close']);
  assert.equal(close.code, 0, close.err);
  assert.equal(H.git(['status', '--porcelain'], dir), '', 'the changed ledger file is committed too');
  assert.equal(H.git(['rev-parse', 'main'], dir), H.git(['rev-parse', 'origin/main'], dir), 'local and shared main agree');
  assert.ok(bareLs(bare).some((f) => f.startsWith('.cohdit/ledger/runs/')), 'the ledger landed');
  const cfg = spawnSync('git', ['show', 'main:.cohdit/config.json'], { cwd: bare, encoding: 'utf8' }).stdout;
  assert.doesNotMatch(cfg, /<<<<<<<|>>>>>>>/, 'no conflict marker ever reaches the ledger');
  assert.match(cfg, /"theirs": true/, 'the shared copy wins a conflict in a carried change');
});

test('a side copy that cannot land at close is kept, and landed by the next open', () => {
  const h = home();
  const dir = agreedIdea(h, 'Sweep', ITEMS.slice(0, 2));
  const bare = withOrigin(dir);
  const A = (args, input) => run(h, ['build'].concat(args, ['--dir', dir, '--session', 'sess-a']), input);
  A(['open']);
  A(['next']);
  const oB = run(h, ['build', 'open', '--dir', dir, '--session', 'sess-b']);
  const dirB = hintOf(oB, 'dir'), runB = hintOf(oB, 'run');
  const Bb = (args, input) => run(h, ['build'].concat(args, ['--dir', dirB, '--session', 'sess-b']), input);
  Bb(['next']);
  const other = H.tmpdir();                                                // another computer moves main after B's last fetch
  spawnSync('git', ['clone', '-q', bare, other], { encoding: 'utf8' });
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'elsewhere'], { cwd: other, env: H.ENV, encoding: 'utf8' });
  spawnSync('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: other, encoding: 'utf8' });
  Bb(['built', 'ITEM-002', '--return', BLOCKED()]);
  assert.ok(bareLs(bare).includes('.cohdit/ledger/runs/' + runB + '.jsonl'), 'landed over a moved main: fetched, replayed, pushed');
  H.git(['remote', 'set-url', 'origin', path.join(H.tmpdir(), 'gone')], dir);   // the connection drops before close
  const close = Bb(['close']);
  assert.equal(close.code, 0, close.err);
  assert.ok(fs.existsSync(dirB), 'the copy is kept while its last records have not landed');
  H.git(['remote', 'set-url', 'origin', bare], dir);
  const closeA = A(['close']);
  assert.equal(closeA.code, 0, closeA.err);
  B(h, dir, ['open']);
  assert.ok(!fs.existsSync(dirB), 'the next open landed the copy and removed it');
  const shared = spawnSync('git', ['show', 'main:.cohdit/ledger/runs/' + runB + '.jsonl'], { cwd: bare, encoding: 'utf8' }).stdout;
  assert.match(shared, /"c":"RUN_END"/, 'the close reached the shared copy');
});

test('the shared copy out of reach stops the run and says so, instead of building blind', () => {
  const h = home();
  const dir = agreedIdea(h, 'Unreachable', ITEMS.slice(0, 1));
  withOrigin(dir);
  B(h, dir, ['open']);
  H.git(['remote', 'set-url', 'origin', path.join(H.tmpdir(), 'gone')], dir);
  const n = B(h, dir, ['next']);
  assert.equal(n.code, 0, n.err);
  assert.equal(n.out, 'I stopped because I couldn\'t reach GitHub. Check the connection and say "build it" again.');
  assert.equal(hintOf(n, 'next'), 'close');
  assert.equal(H.git(['rev-parse', '--abbrev-ref', 'HEAD'], dir), 'main');
  assert.equal(H.git(['branch', '--list', 'item/*'], dir), '', 'no half-opened thing is left behind');
});

test('an idea this computer never saw is found in the GitHub account by name and fetched', () => {
  const h1 = home();
  const dir = agreedIdea(h1, 'ABC Friends', ITEMS.slice(0, 2));
  const bare = withOrigin(dir);
  B(h1, dir, ['open']);
  B(h1, dir, ['next']);
  makerCommits(h1, dir, 'app/grid.tsx', 'grid\n', 'grid');
  B(h1, dir, ['built', 'ITEM-001', '--return', DONE('copy')]);
  B(h1, dir, ['close']);
  // the second computer
  const h2 = home(true, {
    'gh repo list priya-k --topic cohdit-hatch --json name,nameWithOwner,url --limit 200': { code: 0, out: JSON.stringify([{ name: 'abc-friends', nameWithOwner: 'priya-k/abc-friends', url: bare }]) },
  });
  const none = run(h2, ['build', 'open', '--name', 'Nothing Like It']);
  assert.equal(none.code, 64);
  assert.match(none.err, /no idea called "Nothing Like It" here or in your GitHub account/);
  const o = run(h2, ['build', 'open', '--name', 'ABC Friends']);
  assert.equal(o.code, 0, o.err);
  assert.match(o.err, /^hint=fetched$/m);
  const dir2 = hintOf(o, 'dir');
  assert.equal(path.basename(dir2), 'abc-friends');
  assert.ok(dir2.startsWith(h2.dir), 'fetched under this computer\'s Hatch folder');
  const reg = JSON.parse(fs.readFileSync(path.join(h2.dir, '.cohdit', 'settings.json'), 'utf8'));
  assert.equal(reg.projects[0].repo, 'priya-k/abc-friends');
  const n = run(h2, ['build', 'next', '--dir', dir2]);
  assert.equal(hintOf(n, 'item'), 'ITEM-002', 'the first thing is already done on the shared copy');
  assert.match(R(h2, dir2, 'status', 'plain'), /^  done       Letter grid$/m);
});

test('the permission hook approves exactly two shapes, and tells a build call which session made it', () => {
  const projects = ['/Users/p/Hatch/abc-friends'];
  const hatchPath = path.join(H.S, 'hatch.js');
  const A = (h) => hatch.allowDecision(h, projects, hatchPath);
  const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
  assert.ok(A(bash('node "' + hatchPath + '" build next --dir "/Users/p/Hatch/abc-friends"')));
  assert.ok(A(bash("node " + hatchPath + " idea set --json '{\"items\":[{\"title\":\"a; b\"}]}'")), 'a semicolon inside a quoted argument is fine');
  assert.ok(A(bash('node "' + hatchPath + '" build built ITEM-001 --return - <<\'EOF\'\n{"verdict":"done"}\nEOF')), 'a heredoc body is not a second command');
  assert.equal(A(bash('node "' + hatchPath + '" build next && rm -rf ~')), null);
  assert.equal(A(bash('node "' + hatchPath + '" build next; ls')), null);
  assert.equal(A(bash('node "' + hatchPath + '" build next > out.txt')), null);
  assert.equal(A(bash('node "' + hatchPath + '" build next | cat')), null);
  assert.equal(A(bash('node other.js build next')), null);
  assert.equal(A(bash('npm test')), null);
  assert.equal(A(bash('cd /Users/p/Hatch/abc-friends && node "' + hatchPath + '" build next')), null);
  assert.equal(A(bash('node "' + hatchPath + '" build built ITEM-001 --return - <<\'EOF\' && rm -rf ~\n{}\nEOF')), null, 'nothing may follow the heredoc operator');
  assert.equal(A(bash('node "' + hatchPath + '" build built ITEM-001 --return - <<\'EOF\' | sh\n{}\nEOF')), null);
  assert.equal(A(bash('node "' + hatchPath + '" build built ITEM-001 --return - <<EOF\n$(rm -rf ~)\nEOF')), null, 'an unquoted heredoc body is live shell');
  assert.equal(A(bash('node "' + hatchPath + '" build commit --dir /x -m "$(rm -rf ~)"')), null, 'a substitution runs inside double quotes');
  assert.equal(A(bash('node "' + hatchPath + '" build commit --dir /x -m "use `code`"')), null);
  assert.equal(A(bash('node "' + hatchPath + '" build commit --dir "$HOME/x" -m ok')), null);
  assert.ok(A(bash('node "' + hatchPath + '" build commit --dir /x -m "the person\'s chart; 3 > 2"')), 'punctuation inside double quotes is text');
  assert.ok(A(bash("node \"" + hatchPath + "\" build commit --dir /x -m 'costs $5 `each`'")), 'single quotes are literal');
  assert.ok(A(bash('node "' + hatchPath + '" build verify --dir /x 2>&1')), 'a merged stderr costs no question');
  assert.ok(A(bash('node "' + hatchPath + '" build built ITEM-001 --return - <<\'HATCH\'\n```json\n{"a":"$5"}\n```\nHATCH\n')), 'a quoted heredoc body may hold anything');
  process.env.CLAUDE_PLUGIN_ROOT = path.join(H.S, '..');
  try { assert.ok(A(bash('node "${CLAUDE_PLUGIN_ROOT}/scripts/hatch.js" build next')), 'the plugin root placeholder is the hook\'s own'); } finally { delete process.env.CLAUDE_PLUGIN_ROOT; }
  assert.equal(A(bash('node "${CLAUDE_PLUGIN_ROOT}/scripts/hatch.js" build next')), null, 'without the root it is just a dollar sign');
  const edit = (file_path, tool = 'Edit') => ({ tool_name: tool, tool_input: { file_path } });
  assert.ok(A(edit('/Users/p/Hatch/abc-friends/app/page.tsx')));
  assert.ok(A(edit('/Users/p/Hatch/abc-friends/new.ts', 'Write')));
  assert.equal(A(edit('/Users/p/Hatch/abc-friends-2/app/page.tsx')), null, 'a sibling folder is not inside');
  assert.equal(A(edit('/Users/p/other/page.tsx')), null);
  assert.equal(A(edit('/Users/p/Hatch/abc-friends/.git/config')), null);
  assert.equal(A(edit('/Users/p/Hatch/abc-friends/.env.local')), null);
  assert.equal(A(edit('/Users/p/Hatch/abc-friends/.env')), null);
  assert.ok(A(edit('/Users/p/Hatch/abc-friends/app/.envelope.ts')), 'only secrets files are held back');
  assert.equal(A({ tool_name: 'Read', tool_input: { file_path: '/Users/p/Hatch/abc-friends/x' } }), null);
  assert.equal(hatch.withSession('node "' + hatchPath + '" build next --dir x', 'sess-1'), 'node "' + hatchPath + '" build next --session sess-1 --dir x');
  assert.equal(hatch.withSession('node "' + hatchPath + '" build built ITEM-001 --return - <<\'EOF\'\n{}\nEOF', 'sess-1'), 'node "' + hatchPath + '" build built --session sess-1 ITEM-001 --return - <<\'EOF\'\n{}\nEOF');
  assert.equal(hatch.withSession('node "' + hatchPath + '" idea show', 'sess-1'), null, 'only build calls carry the session');
  assert.equal(hatch.withSession('node "' + hatchPath + '" build next --session s', 'sess-1'), null);
  const r = H.run('hatch.js', ['allow'], { input: JSON.stringify(bash('ls')) });
  assert.equal(r.code, 0);
  assert.equal(r.out, '', 'no decision means the usual prompt');
});

test('the usage hook finds a build started from another folder through the pointer', () => {
  const h = home();
  const dir = agreedIdea(h, 'Pointer', ITEMS.slice(0, 1));
  const o = B(h, dir, ['open']);
  const runId = hintOf(o, 'run');
  const elsewhere = H.mkrepo();
  const transcript = path.join(H.tmpdir(), 'main.jsonl');
  const row = (ts, id, text) => JSON.stringify({ type: 'assistant', timestamp: ts, gitBranch: 'main', message: { id, model: 'claude-sonnet-5-5', content: [{ type: 'text', text }], usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) + '\n';
  fs.writeFileSync(transcript, row('2026-11-01T09:00:00Z', 'm1', 'hi'));
  const U = (command) => H.run('usage.js', ['hook'], { env: h.env, cwd: elsewhere, input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', session_id: 's1', cwd: elsewhere, transcript_path: transcript, tool_input: { command } }) });
  assert.equal(U('node "' + H.S + '/hatch.js" build open --dir x').code, 0);
  fs.appendFileSync(transcript, row('2026-11-01T09:05:00Z', 'm2', 'Started.'));
  U('node "' + H.S + '/hatch.js" build next --dir x');
  const recs = H.records(H.spool(dir)).filter((r) => r.c === 'USAGE');
  assert.equal(recs.length, 1, 'one USAGE record in the project\'s spool, written from another folder');
  assert.equal(recs[0].r, runId);
  const close = B(h, dir, ['close']);
  assert.match(close.out, /^This run used about 110 tokens/m, 'the digest shows what the hook measured');
});

test('the build skill: short, one script, the refusal clause, points at try and never at share', (t) => {
  const skill = H.playbook('skill', 'build');
  if (!skill) return t.skip('no content folder in HATCH_DEV_DIR');
  assert.ok(skill.split('\n').length <= 100, 'skill is ' + skill.split('\n').length + ' lines');
  assert.match(skill, /hatch\.js" build/);
  assert.match(skill, /CONTRACTS\.md/);
  assert.match(skill, /Cohdit does not build apps in a refused category/);
  assert.match(skill, /hatch:maker/);
  assert.match(skill, /hatch:checker/);
  assert.match(skill, /hatch:advisor/);
  assert.match(skill, /agents=/);
  assert.doesNotMatch(skill, /new chat/i);
  assert.doesNotMatch(skill, /say "share it"/i);
  for (const a of ['maker', 'checker', 'lens-security', 'lens-privacy', 'lens-cost', 'advisor']) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'agents', a + '.md'), 'utf8');
    const body = H.playbook('agent', a);
    if (body) assert.ok(body.split('\n').length <= 60, a + ' is one page');
    assert.match(text, new RegExp('^name: ' + a + '$', 'm'));
    assert.match(text, /^tools: /m);
    assert.match(text, /^model: /m);
  }
});

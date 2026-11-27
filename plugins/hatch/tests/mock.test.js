'use strict';
// mock.test.js — the mock-up: drawn by the designer before anything is built, checked by the script against the agreed
// list, changed in the person's words, signed off; the build refuses until it is, and then every brief points at it.
// A later change big enough to see first is drawn into it; a small one is not, and the person may skip a later one.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const mk = require('../scripts/lib/mock');
const hatch = require('../scripts/hatch');

test.before(() => H.ready());

const ITEMS = [
  { title: 'Letter grid', criteria: ['open it; you see all 26 letters, big'] },
  { title: 'Tap to hear', criteria: ['tap a letter; you hear it'] },
];
const GATES = { personal_details: false, payments: false, messaging: false, children: false, advice: false, uploads: false, user_content: false };
const OK = { code: 0, out: 'ok\n' };

function home() {
  const d = H.mkrepo();
  fs.writeFileSync(path.join(d, 'probes.json'), JSON.stringify({ 'gh --version': OK, 'gh auth status': { code: 1 } }));
  return { dir: d, env: { COHDIT_HOME: d, GIT_CONFIG_GLOBAL: path.join(d, 'gitconfig'), COHDIT_PROBES: path.join(d, 'probes.json'), COHDIT_FAKE_SCAFFOLD: '1' } };
}
const run = (h, args, input) => H.run('hatch.js', args, { env: h.env, input, cwd: h.dir });
const hintOf = (r, k) => { const m = new RegExp('^' + k + '=(.*)$', 'm').exec(r.err); return m ? m[1] : null; };
const M = (h, dir, args, input) => run(h, ['mock'].concat(args, ['--dir', dir]), input);
const put = (dir, file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
const linkTo = (dir, from, to) => fs.appendFileSync(path.join(dir, from), '<nav><a href="' + to + '">' + to + '</a></nav>\n');
const spec = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.cohdit', 'spec.json'), 'utf8'));
const DRAWN = '{"verdict":"drawn","look":"Big friendly letters on warm paper colours, for a small child."}';
const page = (items, extra = '') => '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="look.css"><main>'
  + items.map((i) => '<section data-item="' + i + '"><h1>' + i + '</h1></section>').join('') + extra + '</main>\n';

function agreed(h, name = 'ABC Friends') {
  const n = run(h, ['idea', 'new', name]);
  const dir = hintOf(n, 'dir');
  assert.equal(run(h, ['idea', 'set', '--dir', dir, '--json', JSON.stringify({ items: ITEMS, gates: GATES })]).code, 0);
  assert.equal(run(h, ['idea', 'agree', '--dir', dir]).code, 0);
  return dir;
}

/** The designer's work: the look, the index and a screen per thing. */
function draw(dir, items = ['ITEM-001', 'ITEM-002']) {
  put(dir, 'mock/look.css', ':root { --ink: #222; }\n');
  put(dir, 'mock/index.html', page([items[0]], '<a href="hear.html">Hear</a>'));
  if (items[1]) put(dir, 'mock/hear.html', page(items.slice(1)));
}

test('nothing is built before the mock-up is signed off; drawn, checked, changed and signed off in the person\'s words', () => {
  const h = home();
  const dir = agreed(h);
  const b = run(h, ['build', 'open', '--dir', dir]);
  assert.equal(b.code, 1);
  assert.equal(hintOf(b, 'hint'), 'mock_needed');
  assert.match(b.out, /Before I build anything, you see a mock-up of it/);

  const o = M(h, dir, ['open']);
  assert.equal(o.code, 0, o.err);
  assert.equal(hintOf(o, 'next'), 'designer');
  const brief = fs.readFileSync(hintOf(o, 'brief'), 'utf8');
  assert.match(brief, /# Draw the mock-up of "ABC Friends"/);
  assert.match(brief, /ITEM-001 Letter grid\n {2}- open it; you see all 26 letters, big/);
  assert.match(brief, /data-item="ITEM-NNN"/);
  assert.ok(fs.existsSync(path.join(hintOf(o, 'roles'), 'agent-designer.md')), 'its instructions are beside the brief');

  // a thing missing from the drawing is sent back once, then the person is told
  draw(dir, ['ITEM-001']);
  const short = M(h, dir, ['drawn', '--return', DRAWN]);
  assert.equal(short.code, 64);
  assert.equal(hintOf(short, 'hint'), 'reask');
  assert.match(short.err, /no screen is marked data-item for: ITEM-002 Tap to hear/);

  // anything written outside mock/ is thrown away
  draw(dir);
  put(dir, 'app/page.tsx', 'cheat\n');
  const stray = M(h, dir, ['drawn', '--return', DRAWN]);
  assert.equal(stray.code, 1, 'the second refusal in a row is told to the person');
  assert.equal(hintOf(stray, 'hint'), 'mock_failed');
  assert.equal(fs.existsSync(path.join(dir, 'app', 'page.tsx')), false);

  const good = M(h, dir, ['drawn', '--return', DRAWN]);
  assert.equal(good.code, 0, good.err);
  assert.equal(hintOf(good, 'next'), 'person');
  assert.match(good.out, /Big friendly letters[\s\S]*open in your browser: file:\/\/.*mock\/index\.html[\s\S]*say "that's it" to sign it off/);

  const c = M(h, dir, ['change', '--note', 'make the letters blue']);
  assert.equal(hintOf(c, 'next'), 'designer');
  assert.match(fs.readFileSync(hintOf(c, 'brief'), 'utf8'), /## What the person asked you to change[\s\S]*- make the letters blue[\s\S]*Your earlier look: Big friendly letters/);
  assert.equal(M(h, dir, ['agree']).code, 64, 'not signed off while it is being redrawn');
  assert.equal(M(h, dir, ['drawn', '--return', DRAWN]).code, 0);

  const a = M(h, dir, ['agree']);
  assert.equal(a.code, 0, a.err);
  assert.equal(hintOf(a, 'next'), 'build');
  assert.ok(spec(dir).mock.agreed, 'signed off in the idea');
  const recs = require('../scripts/lib/build').allRecords(dir);
  assert.deepEqual(recs.filter((r) => r.c === 'MOCK').map((r) => r.f.state), ['drawing', 'drawn', 'changed', 'drawn', 'agreed']);
  assert.ok(recs.some((r) => r.c === 'DECIDE' && r.f.type === 'design' && r.f.choice === 'mock' && r.f.who === 'you'));
  assert.equal(M(h, dir, ['skip']).code, 64, 'the first mock-up of an idea is never skipped');

  // then the build starts, its first commit takes the mock-up, and the builder's brief points at this thing's screen
  const bo = run(h, ['build', 'open', '--dir', dir]);
  assert.equal(bo.code, 0, bo.err + bo.out);
  assert.match(H.git(['ls-files', 'mock'], dir), /mock\/index\.html/);
  const cfg = path.join(dir, '.cohdit', 'config.json');
  fs.writeFileSync(cfg, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(cfg, 'utf8')), { caps: { lanes: 1 } })));
  const n = run(h, ['build', 'next', '--dir', dir]);
  assert.equal(hintOf(n, 'next'), 'maker', n.err);
  const mb = fs.readFileSync(hintOf(n, 'brief'), 'utf8');
  assert.match(mb, /## The signed-off mock-up\n[^\n]*never link, import or copy[\s\S]*drawn in `mock\/index\.html` \(the part marked `data-item="ITEM-001"`\)/);
});

test('a later change: a big one is drawn into the mock-up first and may be skipped; a small one is built straight away', () => {
  const h = home();
  const dir = agreed(h, 'Later');
  M(h, dir, ['open']);
  draw(dir);
  assert.equal(M(h, dir, ['drawn', '--return', DRAWN]).code, 0);
  assert.equal(M(h, dir, ['agree']).code, 0);

  const small = run(h, ['idea', 'change', '--dir', dir, '--json', JSON.stringify({ add: [{ title: 'Bigger letters button', criteria: ['press Bigger; the letters grow'] }] })]);
  assert.equal(hintOf(small, 'next'), 'build', 'a small tweak is never sent to be drawn');
  assert.equal(spec(dir).items.find((i) => i.id === 'ITEM-003').mock, undefined);

  const big = run(h, ['idea', 'change', '--dir', dir, '--json', JSON.stringify({ mock: true, add: [{ title: 'Spelling game', criteria: ['open Spelling; you see a word to spell'] }] })]);
  assert.equal(big.code, 0, big.err);
  assert.equal(hintOf(big, 'next'), 'mock');
  assert.equal(spec(dir).items.find((i) => i.id === 'ITEM-004').mock, 'needed');
  assert.equal(hintOf(run(h, ['build', 'open', '--dir', dir]), 'hint'), 'mock_needed', 'the build waits for it');

  const o = M(h, dir, ['open']);
  const brief = fs.readFileSync(hintOf(o, 'brief'), 'utf8');
  assert.match(brief, /## What to draw this time[\s\S]*- ITEM-004 Spelling game\n[\s\S]*Keep every signed-off screen as it is/);
  assert.doesNotMatch(brief, /## What the person asked you to change/, 'the first round\'s changes are not carried over');
  // the small thing added without a mock needs no screen; the new one does
  put(dir, 'mock/spell.html', page(['ITEM-004']));
  linkTo(dir, 'mock/index.html', 'spell.html');
  assert.equal(M(h, dir, ['drawn', '--return', DRAWN]).code, 0);
  assert.equal(M(h, dir, ['agree']).code, 0);
  assert.equal(spec(dir).items.find((i) => i.id === 'ITEM-004').mock, 'agreed');
  assert.equal(run(h, ['build', 'open', '--dir', dir]).code, 0);
  run(h, ['build', 'close', '--dir', dir]);

  const third = run(h, ['idea', 'change', '--dir', dir, '--json', JSON.stringify({ mock: true, add: [{ title: 'Word of the day', criteria: ['open it; you see today\'s word'] }] })]);
  assert.equal(hintOf(third, 'next'), 'mock');
  M(h, dir, ['open']);
  put(dir, 'mock/word.html', page(['ITEM-005']));
  linkTo(dir, 'mock/index.html', 'word.html');
  assert.equal(M(h, dir, ['drawn', '--return', DRAWN]).code, 0);
  assert.equal(M(h, dir, ['agree']).code, 0);
  assert.equal(H.git(['log', '-1', '--format=%s'], dir), 'Hatch: the signed-off mock-up', 'after the first build, committed on its own');
  assert.equal(run(h, ['build', 'open', '--dir', dir]).code, 0, 'and the folder is clean for the build');
  run(h, ['build', 'close', '--dir', dir]);

  const again = run(h, ['idea', 'change', '--dir', dir, '--json', JSON.stringify({ mock: true, add: [{ title: 'Sticker book', criteria: ['open Stickers; you see the stickers you won'] }] })]);
  assert.equal(hintOf(again, 'next'), 'mock');
  const skip = M(h, dir, ['skip']);
  assert.equal(skip.code, 0, skip.err);
  assert.equal(spec(dir).items.find((i) => i.title === 'Sticker book').mock, 'skipped');
  assert.equal(run(h, ['build', 'open', '--dir', dir]).code, 0, 'skipped, so the build goes ahead');
  assert.throws(() => require('../scripts/lib/spec').applyChange(spec(dir), { mock: true }, {}, new Map()), /goes with the new things/);
});

test('an idea built before mock-ups existed is never stopped for one', () => {
  const h = home();
  const dir = agreed(h, 'Older');
  const runs = path.join(dir, '.cohdit', 'ledger', 'runs');
  fs.writeFileSync(path.join(runs, '20261101T090000Z-test-0099.jsonl'), JSON.stringify({ v: 1, c: 'DONE', r: '20261101T090000Z-test-0099', ts: '2026-11-01T09:10:00Z', i: 'ITEM-001', f: { head: 'a1b2c3d', touches: 'app/' } }) + '\n');
  assert.equal(run(h, ['build', 'open', '--dir', dir]).code, 0);
});

test('what the script refuses in a mock, and the designer\'s report', () => {
  const dir = H.tmpdir();
  assert.match(mk.lint(dir).join('|'), /no mock\/index\.html[\s\S]*no mock\/look\.css/);
  put(dir, 'mock/look.css', '');
  put(dir, 'mock/index.html', '<script src="https://cdn.example.com/x.js"></script><p data-item="ITEM-001">x</p>');
  assert.match(mk.lint(dir).join('|'), /loads a script from the network[\s\S]*does not use look\.css/);
  assert.deepEqual(mk.screensFor(dir, 'ITEM-001'), ['mock/index.html']);
  assert.match(mk.lint(dir).join('|'), /index\.html has no <meta name="viewport"/);
  assert.throws(() => mk.designerReturn('{"verdict":"drawn"}'), /look needs one sentence/);
  assert.throws(() => mk.designerReturn('{"verdict":"done","look":"x"}'), /verdict must be drawn/);
  assert.equal(mk.designerReturn('```json\n' + DRAWN + '\n```').look, 'Big friendly letters on warm paper colours, for a small child.');
});

test('every screen is reached by using the app, every link goes somewhere, and every screen fits a phone', () => {
  const dir = H.tmpdir();
  put(dir, 'mock/look.css', '');
  put(dir, 'mock/index.html', page(['ITEM-001'], '<a class="row" href="agent.html#refunds">Refunds</a><a href="gone.html">Gone</a>'
    + '<footer><a href="first-visit.html">First visit</a><a href="agent.html">Agent</a></footer>'));
  put(dir, 'mock/agent.html', page(['ITEM-002'], '<a href="index.html">Back</a><a href="sub/rules.html">Rules</a>'));
  put(dir, 'mock/first-visit.html', page([], '<a href="first-visit.html">Agents</a>'));
  put(dir, 'mock/sub/rules.html', page([], '<a href="../agent.html">Back</a>'));
  const problems = mk.lint(dir);
  assert.deepEqual(problems.filter((p) => /reached only/.test(p)).map((p) => p.split(' ')[0]), ['mock/first-visit.html'],
    'a screen linked only from a footer list, or only from itself, is not reached; a row link and a relative path are');
  assert.deepEqual(problems.filter((p) => /not drawn/.test(p)), ['mock/index.html links to mock/gone.html, which is not drawn']);
  assert.equal(problems.length, 2);
});

test('the look the person already has goes to the designer, set at the interview or changed later', () => {
  const h = home();
  const n = run(h, ['idea', 'new', 'Owl Board']);
  const dir = hintOf(n, 'dir');
  assert.equal(run(h, ['idea', 'set', '--dir', dir, '--json', JSON.stringify({ items: ITEMS, gates: GATES, look_from: 'the app it replaces, in ~/apps/old-board' })]).code, 0);
  assert.equal(run(h, ['idea', 'agree', '--dir', dir]).code, 0);
  assert.match(fs.readFileSync(hintOf(M(h, dir, ['open']), 'brief'), 'utf8'), /## The look they already have\nThe person already has a look this must match: the app it replaces, in ~\/apps\/old-board\. Open it before you draw/);
  const c = run(h, ['idea', 'change', '--dir', dir, '--json', JSON.stringify({ look_from: 'their brand at https://example.com' })]);
  assert.equal(c.code, 0, c.err);
  assert.equal(spec(dir).look_from, 'their brand at https://example.com');
  assert.notEqual(run(h, ['idea', 'change', '--dir', dir, '--json', JSON.stringify({ look_from: '' })]).code, 0);
});

test('the designer writes the mock-up and nothing else', () => {
  const projects = ['/Users/p/Hatch/abc'];
  const D = (file) => hatch.denyDecision({ agent_type: 'hatch:designer', tool_name: 'Write', tool_input: { file_path: file } }, projects, '/Users/p', '/x/hatch.js');
  assert.equal(D('/Users/p/Hatch/abc/mock/index.html'), null);
  assert.match(D('/Users/p/Hatch/abc/app/page.tsx'), /the designer writes the mock-up/);
  assert.match(D('/Users/p/Hatch/abc/e2e/item-001.spec.ts'), /the designer writes the mock-up/);
});

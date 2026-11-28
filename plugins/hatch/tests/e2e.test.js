'use strict';
// e2e.test.js — the browser checks: the tester's one file is checked by the script, seen to fail, and held
// where the maker cannot reach it; the maker's commit runs it and is refused when it touches a test; the
// script commits the test at the gate. The browser runner is a stand-in (COHDIT_FAKE_E2E): a test file
// says what it needs in comments, so no browser and no network is touched.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./harness');
const e2 = require('../scripts/lib/e2e');

const ITEMS = [
  { title: 'Letter grid', criteria: ['open it; you see all 26 letters, big'] },
  { title: 'Tap to hear', criteria: ['tap a letter; you hear it'] },
];
const GATES = { personal_details: false, payments: false, messaging: false, children: false, advice: false, uploads: false, user_content: false };
const OK = { code: 0, out: 'ok\n' };

function home() {
  const d = H.mkrepo();
  fs.writeFileSync(path.join(d, 'probes.json'), JSON.stringify({ 'gh --version': OK, 'gh auth status': { code: 1 } }));
  return { dir: d, env: { COHDIT_HOME: d, GIT_CONFIG_GLOBAL: path.join(d, 'gitconfig'), COHDIT_PROBES: path.join(d, 'probes.json'), COHDIT_FAKE_SCAFFOLD: '1', COHDIT_FAKE_E2E: '1' } };
}
const run = (h, args, input) => H.run('hatch.js', args, { env: h.env, input, cwd: h.dir });
const hintOf = (r, k) => { const m = new RegExp('^' + k + '=(.*)$', 'm').exec(r.err); return m ? m[1] : null; };
const B = (h, dir, args, input) => run(h, ['build'].concat(args, ['--dir', dir]), input);

function idea(h, name = 'ABC Friends') {
  const n = run(h, ['idea', 'new', name]);
  assert.equal(n.code, 0, n.err);
  const dir = hintOf(n, 'dir');
  assert.equal(run(h, ['idea', 'set', '--dir', dir, '--json', JSON.stringify({ items: ITEMS, gates: GATES })]).code, 0);
  assert.equal(run(h, ['idea', 'agree', '--dir', dir]).code, 0);
  H.mockSignedOff(dir);
  return dir;
}

/** A test file the script's rules accept; the stand-in runner passes it once `needs` exists. */
const SPEC = (needs, extra = '') => 'import { test, expect } from "@playwright/test";\n// needs: ' + needs + '\n' + extra
  + 'test(' + JSON.stringify(needs === 'app/sound.txt' ? ITEMS[1].criteria[0] : ITEMS[0].criteria[0]) + ', async ({ page }) => {\n  await page.goto("/");\n  await expect(page.getByText("A")).toBeVisible();\n});\n';
const WRITTEN = '{"verdict":"written","stand_ins":[]}';
const DONE = JSON.stringify({ verdict: 'done', change: 'logic', criteria: [{ n: 1, met: true, ref: 'app/page.tsx:1' }], blocked: null, findings: [] });
const PASS = '{"verdict":"pass","must_fix":[],"nits":0}';
const put = (dir, file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
const records = (dir) => require('../scripts/lib/build').allRecords(dir);   // the ledger and what is still in the spool

/** The maker reports done and every lens asked for passes: the thing reaches the gate. */
function finish(h, dir, item) {
  let r = B(h, dir, ['built', item, '--return', DONE]);
  assert.equal(r.code, 0, r.err + r.out);
  for (const a of (hintOf(r, 'agents') || '').split(',').filter(Boolean)) r = B(h, dir, ['checked', item, '--agent', a, '--return', PASS]);
  return r;
}

test('the rules a test is held to: no skip, wait, selector or faking; an expect per test; only the test library', () => {
  assert.deepEqual(e2.lint(SPEC('x')), []);
  const bad = (text) => e2.lint(SPEC('x', text)).join(' | ');
  assert.match(bad('test.skip("later", async () => {});\n'), /no skip/);
  assert.match(bad('test.fixme();\n'), /no skip/);
  assert.match(bad('await page.waitForTimeout(500);\n'), /fixed waits/);
  assert.match(bad('await page.locator(".btn").click();\n'), /the way a person does/);
  assert.match(bad('await page.route("**", (r) => r.fulfill({}));\n'), /faking the app/);
  assert.match(bad('import fs from "node:fs";\n'), /import only from @playwright\/test/);
  assert.match(e2.lint('import { test } from "@playwright/test";\ntest("a", async () => {});\n').join('|'), /at least one expect/);
  assert.match(e2.lint('// nothing here\n').join('|'), /no test\(/);
  assert.deepEqual(e2.lint(SPEC('x', '// test.skip is forbidden, and so is page.locator(\n')), [], 'a comment is not code');
});

test('what the tester returns, and which paths are the tests\' own', () => {
  assert.deepEqual(e2.testerReturn('```json\n' + WRITTEN + '\n```'), { verdict: 'written', stand_ins: [] });
  assert.equal(e2.testerReturn('{"verdict":"none","reason":"it only changes a nightly job"}').reason, 'it only changes a nightly job');
  assert.throws(() => e2.testerReturn('{"verdict":"none"}'), /needs a reason/);
  assert.throws(() => e2.testerReturn('{"verdict":"done"}'), /written, none or stands/);
  assert.equal(e2.testerReturn('{"verdict":"stands","reason":"it asks for the 26 letters, as the check does"}').verdict, 'stands');
  assert.throws(() => e2.testerReturn('{"verdict":"stands"}'), /stands needs a reason/);
  assert.throws(() => e2.testerReturn('all good'), /not one JSON block/);
  assert.equal(e2.specName('ITEM-004'), 'e2e/item-004.spec.ts');
  assert.equal(e2.itemOf('e2e/item-004.spec.ts'), 'ITEM-004');
  assert.equal(e2.itemOf('e2e/smoke.spec.ts'), null);
  assert.ok(e2.isProtected('e2e/item-001.spec.ts') && e2.isProtected('playwright.config.ts'));
  assert.ok(!e2.isProtected('app/e2e/page.tsx') && !e2.isProtected('app/page.tsx'));
});

test('a report from the browser runner: skipped and flaky are not passed; the record names the thing, the check and the scope', () => {
  const report = { suites: [{ file: 'e2e/item-001.spec.ts', specs: [
    { title: 'you see the letters', ok: true, tests: [{ status: 'expected', results: [{ status: 'passed' }] }] },
    { title: 'tap a letter', ok: false, tests: [{ status: 'unexpected', results: [{ status: 'failed', error: { message: '\u001b[31mError\u001b[39m: element(s) not found' } }] }] },
  ], suites: [{ specs: [{ title: 'later', ok: true, tests: [{ status: 'skipped', results: [] }] }, { title: 'wobbly', ok: true, tests: [{ status: 'flaky', results: [{ status: 'failed', error: { message: 'timeout' } }, { status: 'passed' }] }] }] }] }] };
  const list = e2.flatten(report);
  assert.deepEqual(list.map((t) => t.status), ['expected', 'unexpected', 'skipped', 'flaky']);
  assert.equal(list[1].error, 'Error: element(s) not found', 'colour codes are stripped');
  assert.equal(list[3].file, 'e2e/item-001.spec.ts', 'a nested test keeps its file');
  const res = { tests: 4, passed: 1, failed: 1, flaky: 1, skipped: 1, list };
  assert.equal(e2.green(res), false);
  assert.equal(e2.green({ tests: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, list: [] }), false, 'nothing ran is not a pass');
  assert.equal(e2.green({ tests: 1, passed: 1, failed: 0, flaky: 0, skipped: 0, list: [] }), true);
  const text = e2.record(res, 'ITEM-002');
  assert.match(text, /THING {5}ITEM-001 \(finished earlier: your change broke it\)\nVERDICT {3}failed\nCHECK {5}tap a letter\nEVIDENCE {2}Error: element\(s\) not found\nSCOPE/);
  assert.match(text, /VERDICT {3}skipped \(a skipped check counts as failed\)/);
  assert.match(text, /VERDICT {3}flaky/);
});

test('the whole path: the test is written first, seen to fail, held from the maker, run at every commit, and committed by the script at the gate', () => {
  const h = home();
  const dir = idea(h);
  assert.equal(B(h, dir, ['open']).code, 0);
  const n = B(h, dir, ['next']);
  assert.equal(hintOf(n, 'next'), 'tester', 'the tester goes before the maker');
  assert.equal(hintOf(n, 'item'), 'ITEM-001');
  const brief = fs.readFileSync(hintOf(n, 'brief'), 'utf8');
  assert.match(brief, /# Write the browser test for one thing: "Letter grid" \(ITEM-001\)/);
  assert.match(brief, /open it; you see all 26 letters, big/);
  assert.match(brief, /Exactly one file: `e2e\/item-001\.spec\.ts`/);
  assert.ok(fs.existsSync(path.join(hintOf(n, 'roles'), 'agent-tester.md')), 'its instructions are beside the brief');
  assert.match(B(h, dir, ['commit', '-m', 'early']).err, /still being written/);

  // The tester writes its file, and something of the app's as well: all thrown away, asked once more.
  put(dir, 'e2e/item-001.spec.ts', SPEC('app/grid.txt'));
  put(dir, 'app/page.tsx', 'export default function Page() { return "cheat"; }\n');
  const stray = B(h, dir, ['tested', 'ITEM-001', '--return', WRITTEN]);
  assert.equal(stray.code, 64);
  assert.equal(hintOf(stray, 'hint'), 'reask');
  assert.match(stray.err, /write only e2e\/item-001\.spec\.ts.*app\/page\.tsx/);
  assert.equal(fs.existsSync(path.join(dir, 'e2e', 'item-001.spec.ts')), false);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'app', 'page.tsx'), 'utf8'), /cheat/);

  put(dir, 'e2e/item-001.spec.ts', SPEC('app/grid.txt'));
  const t = B(h, dir, ['tested', 'ITEM-001', '--return', WRITTEN]);
  assert.equal(t.code, 0, t.err);
  assert.equal(hintOf(t, 'next'), 'maker');
  assert.equal(fs.existsSync(path.join(dir, 'e2e', 'item-001.spec.ts')), false, 'the maker never finds the test in the folder');
  const held = spawnSync('find', [path.join(h.dir, '.cohdit', 'held'), '-name', 'item-001.spec.ts'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(held && !held.startsWith(dir + path.sep), 'it is held outside the project');
  const mb = fs.readFileSync(hintOf(t, 'brief'), 'utf8');
  assert.match(mb, /## The browser check\nA test of this thing in a real browser was written/);
  assert.match(mb, /Never create or edit anything under `e2e\/`/);

  // The maker builds something else: its commit is refused with the record of what the browser saw.
  put(dir, 'app/other.tsx', 'export const x = 1;\n');
  const red = B(h, dir, ['commit', '-m', 'not it']);
  assert.equal(red.code, 1);
  assert.match(red.out, /The browser tests did not pass\. Fix the app; the tests are not yours to change\./);
  assert.match(red.out, /THING {5}ITEM-001\nVERDICT {3}failed\nCHECK {5}needs: app\/grid\.txt\nEVIDENCE {2}expected app\/grid\.txt to be there\nSCOPE/);
  assert.equal(fs.existsSync(path.join(dir, 'e2e', 'item-001.spec.ts')), false, 'the test is taken back out after the run');

  // The maker writes its own version of the test: put back, refused, nothing committed.
  put(dir, 'e2e/item-001.spec.ts', 'import { test } from "@playwright/test";\ntest("ok", async () => {});\n');
  const cheat = B(h, dir, ['commit', '-m', 'my own test']);
  assert.equal(cheat.code, 1);
  assert.equal(hintOf(cheat, 'hint'), 'protected');
  assert.match(cheat.err, /not yours to change; put back: e2e\/item-001\.spec\.ts/);
  assert.equal(fs.existsSync(path.join(dir, 'e2e', 'item-001.spec.ts')), false);
  assert.equal(H.git(['log', '-1', '--format=%s'], dir), 'Hatch: ITEM-001 started');

  // The maker builds the thing: green, committed without the test; the gate adds it by the script's hand.
  put(dir, 'app/grid.txt', 'A to Z\n');
  const green = B(h, dir, ['commit', '-m', 'Letter grid']);
  assert.equal(green.code, 0, green.err + green.out);
  assert.doesNotMatch(H.git(['show', '--name-only', '--format=', 'HEAD'], dir), /e2e\//);
  const done = finish(h, dir, 'ITEM-001');
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(done.out, /^Done: "Letter grid"\.$/m);
  assert.ok(H.git(['ls-tree', '-r', '--name-only', 'main'], dir).split('\n').includes('e2e/item-001.spec.ts'), 'the test is part of the project now');
  assert.match(H.git(['log', '--format=%s', 'main'], dir), /Hatch: the browser check for ITEM-001/);
  const d = records(dir).filter((r) => r.c === 'DONE' && r.i === 'ITEM-001').pop();
  assert.equal(d.f.e2e, 1);
  assert.equal(d.f.red, 1, 'it was seen to fail before the thing existed');
  const v = records(dir).filter((r) => r.c === 'VERIFY').pop();
  assert.equal(v.f.e2e, 1);
  assert.equal(v.f.e2e_fail, 0);
  assert.equal(spawnSync('find', [path.join(h.dir, '.cohdit', 'held'), '-name', 'item-001.spec.ts'], { encoding: 'utf8' }).stdout.trim(), '', 'the hold is emptied');

  // The next thing breaks the first: its commit is refused, and the record says whose check it was.
  assert.equal(hintOf(B(h, dir, ['next']), 'next'), 'tester');
  put(dir, 'e2e/item-002.spec.ts', SPEC('app/sound.txt'));
  assert.equal(B(h, dir, ['tested', 'ITEM-002', '--return', WRITTEN]).code, 0);
  put(dir, 'app/sound.txt', 'beep\n');
  fs.rmSync(path.join(dir, 'app', 'grid.txt'));
  const broke = B(h, dir, ['commit', '-m', 'Tap to hear']);
  assert.equal(broke.code, 1);
  assert.match(broke.out, /THING {5}ITEM-001 \(finished earlier: your change broke it\)/);
  // An earlier thing's committed test is no more the maker's to change than its own.
  put(dir, 'app/grid.txt', 'A to Z\n');
  put(dir, 'e2e/item-001.spec.ts', '// gone\n');
  const edit = B(h, dir, ['verify']);
  assert.equal(edit.code, 1);
  assert.equal(hintOf(edit, 'hint'), 'protected');
  assert.match(fs.readFileSync(path.join(dir, 'e2e', 'item-001.spec.ts'), 'utf8'), /needs: app\/grid\.txt/, 'put back as it was');
  assert.equal(B(h, dir, ['commit', '-m', 'Tap to hear']).code, 0);
});

test('a test that breaks the rules twice, or a thing no screen shows: built without a browser test, and it says so', () => {
  const h = home();
  const dir = idea(h, 'Rounds');
  B(h, dir, ['open']);
  B(h, dir, ['next']);
  put(dir, 'e2e/item-001.spec.ts', SPEC('app/grid.txt', 'test.skip("later", async () => {});\n'));
  const one = B(h, dir, ['tested', 'ITEM-001', '--return', WRITTEN]);
  assert.equal(one.code, 64);
  assert.match(one.err, /breaks these rules: no skip/);
  const two = B(h, dir, ['tested', 'ITEM-001', '--return', WRITTEN]);
  assert.equal(two.code, 0, two.err);
  assert.ok(records(dir).some((r) => r.c === 'FINDING' && r.i === 'ITEM-001'), 'why there is no test is on the record');
  assert.equal(hintOf(two, 'next'), 'maker');
  assert.match(fs.readFileSync(hintOf(two, 'brief'), 'utf8'), /No browser test was written for this thing \(no usable browser test could be written\)/);
  put(dir, 'app/grid.txt', 'A\n');
  assert.equal(B(h, dir, ['commit', '-m', 'Letter grid']).code, 0);
  assert.equal(finish(h, dir, 'ITEM-001').code, 0);
  const d = records(dir).filter((r) => r.c === 'DONE').pop();
  assert.equal(d.f.e2e, 0, 'no browser test proves it, and the record says so');
  assert.equal(d.f.red, 0);

  B(h, dir, ['next']);
  const none = B(h, dir, ['tested', 'ITEM-002', '--return', '{"verdict":"none","reason":"it only plays a sound, nothing on a screen changes"}']);
  assert.equal(none.code, 0, none.err);
  assert.equal(hintOf(none, 'next'), 'maker');
  assert.match(fs.readFileSync(hintOf(none, 'brief'), 'utf8'), /No browser test was written for this thing \(it only plays a sound/);
  assert.ok(records(dir).some((r) => r.c === 'RETURN' && r.f.agent === 'tester' && r.f.verdict === 'none'));
  // The run closes and every view of it still reads: the tester is one more agent on the record.
  const close = B(h, dir, ['close']);
  assert.match(close.out, /^Built 1 of 2 things\.$/m);
  for (const lvl of ['plain', 'product', 'tech']) {
    const sc = H.run('render.js', ['score', '--level', lvl, '--cohdit', path.join(dir, '.cohdit')], { env: h.env });
    assert.equal(sc.code, 0, lvl + ': ' + sc.err);
  }
});

test('a test that passes before the thing exists is asked for again, then taken as not seen to fail; a flaky test stops the commit', () => {
  const h = home();
  const dir = idea(h, 'Deps');
  B(h, dir, ['open']);
  B(h, dir, ['next']);
  put(dir, 'e2e/item-001.spec.ts', SPEC('package.json'));
  const one = B(h, dir, ['tested', 'ITEM-001', '--return', WRITTEN]);
  assert.equal(one.code, 64);
  assert.match(one.err, /every test passes before the thing is built/);
  put(dir, 'e2e/item-001.spec.ts', SPEC('package.json', '// flaky\n'));
  const two = B(h, dir, ['tested', 'ITEM-001', '--return', WRITTEN]);
  assert.equal(two.code, 0, two.err);
  put(dir, 'app/grid.txt', 'A\n');
  const c = B(h, dir, ['commit', '-m', 'Letter grid']);
  assert.equal(c.code, 1);
  assert.match(c.out, /VERDICT {3}flaky \(it failed, then passed on a second go\)/);
});

test('an idea made before the browser checks builds as it always did', () => {
  const h = home();
  delete h.env.COHDIT_FAKE_E2E;
  const dir = idea(h, 'Count');
  B(h, dir, ['open']);
  const n = B(h, dir, ['next']);
  assert.equal(hintOf(n, 'next'), 'maker');
  assert.doesNotMatch(fs.readFileSync(hintOf(n, 'brief'), 'utf8'), /The browser check/);
  put(dir, 'e2e/anything.spec.ts', '// theirs\n');
  assert.equal(B(h, dir, ['commit', '-m', 'Letter grid']).code, 0);
});

test('how the checks run is not the maker\'s to change: scripts and the test settings are put back, a switched-off test is refused', () => {
  const h = home();
  const dir = idea(h, 'Checks');
  B(h, dir, ['open']);
  B(h, dir, ['next']);
  put(dir, 'e2e/item-001.spec.ts', SPEC('app/grid.txt'));
  assert.equal(B(h, dir, ['tested', 'ITEM-001', '--return', WRITTEN]).code, 0);
  put(dir, 'app/grid.txt', 'A\n');
  const pkg = path.join(dir, 'package.json');
  const before = JSON.parse(fs.readFileSync(pkg, 'utf8'));
  fs.writeFileSync(pkg, JSON.stringify(Object.assign({}, before, { scripts: Object.assign({}, before.scripts, { test: 'node -e 0 # nothing' }), dependencies: { zod: '*' } }), null, 2) + '\n');
  put(dir, 'vitest.config.ts', 'export default { test: { coverage: { exclude: ["app/**"] } } };\n');
  const c = B(h, dir, ['commit', '-m', 'Letter grid']);
  assert.equal(c.code, 1);
  assert.equal(hintOf(c, 'hint'), 'protected');
  assert.match(c.err, /how the checks run is not yours to change; put back: vitest\.config\.ts, package\.json \(scripts\)/);
  const after = JSON.parse(fs.readFileSync(pkg, 'utf8'));
  assert.deepEqual(after.scripts, before.scripts, 'the scripts are as they were');
  assert.deepEqual(after.dependencies, { zod: '*' }, 'a package it added stays');
  assert.equal(fs.existsSync(path.join(dir, 'vitest.config.ts')), false);
  put(dir, 'app/grid.test.tsx', 'import { test } from "vitest";\ntest.skip("the grid shows", () => {});\n');
  const off = B(h, dir, ['commit', '-m', 'Letter grid']);
  assert.equal(off.code, 1);
  assert.match(off.err, /a test is switched off \(skip, only or todo\) in: app\/grid\.test\.tsx/);
  put(dir, 'app/grid.test.tsx', 'import { test } from "vitest";\n// test.skip is not used here\ntest("the grid shows", () => {});\n');
  assert.equal(B(h, dir, ['commit', '-m', 'Letter grid']).code, 0);
});

test('a commit made past the gate sets the thing aside: the checks never ran on it', () => {
  const h = home();
  const dir = idea(h, 'Lease');
  B(h, dir, ['open']);
  B(h, dir, ['next']);
  put(dir, 'e2e/item-001.spec.ts', SPEC('app/grid.txt'));
  B(h, dir, ['tested', 'ITEM-001', '--return', WRITTEN]);
  put(dir, 'app/grid.txt', 'A\n');
  assert.equal(B(h, dir, ['commit', '-m', 'Letter grid']).code, 0);
  put(dir, 'app/extra.tsx', 'export const untested = 1;\n');
  H.git(['add', '-A'], dir);
  H.git(['commit', '-q', '-m', 'straight in'], dir);
  const r = B(h, dir, ['built', 'ITEM-001', '--return', DONE]);
  assert.match(r.out, /^Set aside "Letter grid"\.$/m);
  const why = records(dir).filter((x) => x.c === 'BLOCKED').pop();
  assert.match(require('../scripts/lib/ledger').readBlob(path.join(dir, '.cohdit'), why.f.blob, dir), /not made through the gate/);
});

test('the permission hook refuses, in any mode, an edit of Hatch\'s own settings and any look at a held test', () => {
  const hatch = require('../scripts/hatch');
  const projects = ['/Users/p/Hatch/abc-friends'];
  const D = (tool_name, file_path) => hatch.denyDecision({ tool_name, tool_input: { file_path } }, projects, '/Users/p');
  assert.match(D('Edit', '/Users/p/Hatch/abc-friends/.cohdit/config.json'), /only through its script/);
  assert.match(D('Write', '/Users/p/Hatch/abc-friends/.cohdit/spec.json'), /only through its script/);
  assert.equal(D('Read', '/Users/p/Hatch/abc-friends/.cohdit/spec.json'), null, 'reading them is fine');
  assert.equal(D('Edit', '/Users/p/Hatch/abc-friends/app/page.tsx'), null);
  assert.equal(D('Edit', '/Users/p/elsewhere/.cohdit/config.json'), null, 'only inside a project Hatch made');
  assert.match(D('Read', '/Users/p/.cohdit/held/abc/ITEM-001/e2e/item-001.spec.ts'), /held here/);
  assert.match(D('Write', '/Users/p/.cohdit/held/abc/ITEM-001/e2e/item-001.spec.ts'), /held here/);
  assert.match(hatch.denyDecision({ tool_name: 'Grep', tool_input: { path: '/Users/p/.cohdit/held' } }, projects, '/Users/p'), /held here/);
  assert.equal(D('Read', '/Users/p/.cohdit/settings.json'), null);
  assert.equal(hatch.denyDecision({ tool_name: 'Bash', tool_input: { command: 'ls' } }, projects, '/Users/p'), null);
  // Inside one of Hatch's agents the hook holds it to its job.
  const hp = path.join(H.S, 'hatch.js');
  const As = (agent_type, tool_name, tool_input) => hatch.denyDecision({ agent_type, tool_name, tool_input }, projects, '/Users/p', hp);
  assert.match(As('hatch:maker', 'Bash', { command: 'git commit -am x' }), /nothing else/);
  assert.match(As('hatch:maker', 'Bash', { command: 'cat /Users/p/.cohdit/held/abc/ITEM-001/e2e/item-001.spec.ts' }), /nothing else/);
  assert.equal(As('hatch:maker', 'Bash', { command: 'node "' + hp + '" build verify --dir "/Users/p/Hatch/abc-friends"' }), null);
  assert.match(As('hatch:maker', 'Write', { file_path: '/Users/p/Hatch/abc-friends/e2e/item-001.spec.ts' }), /not the maker/);
  assert.match(As('hatch:maker', 'Edit', { file_path: '/Users/p/Hatch/abc-friends/playwright.config.ts' }), /not the maker/);
  assert.equal(As('hatch:maker', 'Edit', { file_path: '/Users/p/Hatch/abc-friends/app/page.tsx' }), null);
  assert.match(As('hatch:tester', 'Write', { file_path: '/Users/p/Hatch/abc-friends/app/page.tsx' }), /one file/);
  assert.match(As('hatch:tester', 'Write', { file_path: '/Users/p/Hatch/abc-friends/e2e/smoke.spec.ts' }), /one file/);
  assert.equal(As('hatch:tester', 'Write', { file_path: '/Users/p/Hatch/abc-friends/e2e/item-002.spec.ts' }), null);
  assert.match(As('hatch:runner', 'Bash', { command: 'npm test' }), /nothing else/);
  assert.equal(As(undefined, 'Bash', { command: 'npm test' }), null, 'the person\'s own session is never held to an agent\'s job');
  assert.equal(As('general-purpose', 'Bash', { command: 'npm test' }), null);
});

test('the tester is told whether the idea remembers anything: it reloads only when it does', () => {
  const b = require('../scripts/lib/build');
  const spec = { name: 'N', items: [{ id: 'ITEM-001', title: 'T', criteria: ['c'] }] };
  const st = new Map([['ITEM-001', 'queued']]);
  const dir = H.mkrepo();
  const off = b.testerBrief(dir, Object.assign({ memory: false }, spec), 'ITEM-001', st);
  const on = b.testerBrief(dir, Object.assign({ memory: true }, spec), 'ITEM-001', st);
  assert.match(off, /Never reload/);
  assert.doesNotMatch(off, /reload the page or open it again/);
  assert.match(on, /reload the page or open it again/);
  assert.doesNotMatch(on, /Never reload/);
});

test('each of the person\'s checks needs a test titled with it, word for word', () => {
  const two = ['Type \'Water\' and press Add: it appears.', 'A count says how many are left'];
  const file = 'test("type \'water\' and press  Add: it appears", async () => {});\ntest(\'Something else\', async () => {});\n// test("A count says how many are left", ...\n';
  assert.deepEqual(e2.uncovered(file, two), [two[1]], 'case, quotes, spacing and a full stop aside; a comment is not a test');
  assert.deepEqual(e2.uncovered(file + 'test(\`A count says how many are left\`, async () => {});\n', two), []);
  const h = home();
  const dir = idea(h, 'Titles');
  B(h, dir, ['open']);
  B(h, dir, ['next']);
  put(dir, 'e2e/item-001.spec.ts', SPEC('app/grid.txt').replace(ITEMS[0].criteria[0], 'it works'));
  const r = B(h, dir, ['tested', 'ITEM-001', '--return', WRITTEN]);
  assert.equal(r.code, 64);
  assert.match(r.err, /word for word\. Not found: "open it; you see all 26 letters, big"/);
});

test('the reviewer reads the browser test; what it says against the test goes to the person, and the try list says so', () => {
  const h = home();
  const dir = idea(h, 'Weak');
  B(h, dir, ['open']);
  B(h, dir, ['next']);
  put(dir, 'e2e/item-001.spec.ts', SPEC('app/grid.txt'));
  assert.equal(B(h, dir, ['tested', 'ITEM-001', '--return', WRITTEN]).code, 0);
  put(dir, 'app/grid.txt', 'A\n');
  assert.equal(B(h, dir, ['commit', '-m', 'the grid']).code, 0);
  const b = B(h, dir, ['built', 'ITEM-001', '--return', DONE]);
  assert.equal(hintOf(b, 'next'), 'review', b.err + b.out);
  const diff = fs.readFileSync(hintOf(b, 'diff'), 'utf8');
  assert.match(diff, /# The browser test this thing had to pass: e2e\/item-001\.spec\.ts\n# The builder never saw it/);
  assert.match(diff, /needs: app\/grid\.txt/, 'the test itself is there to read');
  let r;
  for (const a of hintOf(b, 'agents').split(',')) {
    r = B(h, dir, ['checked', 'ITEM-001', '--agent', a, '--return', a === 'checker'
      ? '{"verdict":"fail","must_fix":[{"n":1,"ref":"e2e/item-001.spec.ts:4","text":"check 1: the test sees one letter, not all 26"}],"nits":0}' : PASS]);
  }
  assert.match(r.out, /^Done: "Letter grid"\.$/m, 'the builder is not sent back for a test it cannot see: ' + r.err);
  const done = records(dir).filter((x) => x.c === 'DONE' && x.i === 'ITEM-001').pop();
  assert.equal(done.f.weak, 1);
  B(h, dir, ['next']); B(h, dir, ['close']);
  const list = H.run('render.js', ['checklist', '--level', 'plain', '--cohdit', path.join(dir, '.cohdit')], { env: h.env }).out;
  assert.match(list, /1\. Letter grid\n   Check: Open it; you see all 26 letters, big\n   Checked in a browser, but the test may prove less than you asked: check this one with care\./);
});

test('a check nobody could verify is named to the interviewer: "works" with nothing to see and no example', () => {
  const sp = require('../scripts/lib/spec');
  const spec = { items: [
    { title: 'Search', criteria: ['Search works correctly', "Type 'cat' and see the runs with cat in the note"] },
    { title: 'Totals', criteria: ['The totals work for 10,000 runs', 'It saves properly'] },
  ] };
  assert.deepEqual(sp.vagueChecks(spec), ['Search: Search works correctly', 'Totals: It saves properly']);
  const h = home();
  const n = run(h, ['idea', 'new', 'Vague']);
  const r = run(h, ['idea', 'set', '--dir', hintOf(n, 'dir'), '--json', JSON.stringify({ items: [{ title: 'Search', criteria: ['Search works'] }] })]);
  assert.equal(hintOf(r, 'vague'), 'Search: Search works');
});

test('"the test is wrong": the tester looks again and keeps or rewrites it; a second objection goes to the person', () => {
  const h = home();
  const dir = idea(h, 'Question');
  B(h, dir, ['open']);
  B(h, dir, ['next']);
  put(dir, 'e2e/item-001.spec.ts', SPEC('app/grid.txt'));
  assert.equal(B(h, dir, ['tested', 'ITEM-001', '--return', WRITTEN]).code, 0);
  const objection = JSON.stringify({ verdict: 'blocked', blocked: { reason: 'other', text: 'test: it looks for a heading the check never mentions' }, findings: [] });
  const q = B(h, dir, ['built', 'ITEM-001', '--return', objection]);
  assert.equal(q.code, 0, q.err);
  assert.equal(hintOf(q, 'next'), 'tester', 'back to the tester, not set aside');
  assert.match(q.out, /questioned the browser test for "Letter grid"/);
  const tb = fs.readFileSync(hintOf(q, 'brief'), 'utf8');
  assert.match(tb, /## The builder questioned your test[\s\S]*> it looks for a heading the check never mentions/);
  assert.match(tb, /need not fail today/);
  assert.ok(fs.existsSync(path.join(dir, 'e2e', 'item-001.spec.ts')), 'the tester finds its own test where it wrote it');
  const kept = B(h, dir, ['tested', 'ITEM-001', '--return', '{"verdict":"stands","reason":"it only looks for the letters the check names."}']);
  assert.equal(kept.code, 0, kept.err);
  assert.equal(hintOf(kept, 'next'), 'maker');
  assert.equal(fs.existsSync(path.join(dir, 'e2e', 'item-001.spec.ts')), false, 'held from the maker again');
  assert.match(fs.readFileSync(hintOf(kept, 'brief'), 'utf8'), /kept it: it only looks for the letters the check names\. Build to it/);
  const again = B(h, dir, ['built', 'ITEM-001', '--return', objection]);
  assert.match(again.out, /^Set aside "Letter grid": I need you to decide something\.$/m);
  const why = records(dir).filter((x) => x.c === 'BLOCKED').pop();
  assert.equal(why.f.reason, 'ambiguous', 'the person decides, and the second pass leaves it for them');
  const text = require('../scripts/lib/ledger').readBlob(path.join(dir, '.cohdit'), why.f.blob, dir);
  assert.match(text, /disagree[\s\S]*The builder: it looks for a heading[\s\S]*The tester kept the test: it only looks for the letters/);
});

test('"the test is wrong", rewritten: the new test is checked and held like the first, and only claims to have failed if it did', () => {
  const h = home();
  const dir = idea(h, 'Rewrite');
  B(h, dir, ['open']);
  B(h, dir, ['next']);
  put(dir, 'e2e/item-001.spec.ts', SPEC('app/grid.txt'));
  B(h, dir, ['tested', 'ITEM-001', '--return', WRITTEN]);
  put(dir, 'app/grid.txt', 'A\n');
  assert.equal(B(h, dir, ['commit', '-m', 'the grid']).code, 0);
  const objection = JSON.stringify({ verdict: 'blocked', blocked: { reason: 'other', text: 'test: wants a sound the check does not ask for' }, findings: [] });
  assert.equal(hintOf(B(h, dir, ['built', 'ITEM-001', '--return', objection]), 'next'), 'tester');
  put(dir, 'e2e/item-001.spec.ts', SPEC('app/grid.txt', '// rewritten\n'));
  const t = B(h, dir, ['tested', 'ITEM-001', '--return', WRITTEN]);
  assert.equal(t.code, 0, t.err);
  assert.equal(hintOf(t, 'next'), 'maker');
  assert.match(fs.readFileSync(hintOf(t, 'brief'), 'utf8'), /the tester rewrote it/);
  const r = finish(h, dir, 'ITEM-001');
  assert.equal(r.code, 0, r.err + r.out);
  const done = records(dir).filter((x) => x.c === 'DONE').pop();
  assert.equal(done.f.red, 0, 'the rewrite passed at once, against what was built: not claimed as seen to fail');
});

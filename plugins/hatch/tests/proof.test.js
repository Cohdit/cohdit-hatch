'use strict';
// proof.test.js — what proves one finished thing: the tests its change added and the coverage of the
// source files it touched, as the status and the try list say them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const bd = require('../scripts/lib/build');

function change(dir, files) {
  H.git(['checkout', '-q', '-b', 'item/001-x'], dir);
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
  H.git(['add', '-A'], dir);
  H.git(['commit', '-q', '-m', 'x'], dir);
}

test('proof: counts the test cases the change added, and how much of the lines it wrote the tests ran (existing tests too)', () => {
  const dir = H.mkrepo();
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.writeFileSync(path.join(dir, 'lib/chores.ts'), 'export const old = 1;\n');          // line 1 exists before the change and is never run
  H.git(['add', '-A'], dir); H.git(['commit', '-q', '-m', 'old'], dir);
  const base = H.git(['rev-parse', 'HEAD'], dir).trim();
  change(dir, {
    'lib/chores.ts': 'export const old = 1;\nexport const a = 1;\n// a comment\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\n',
    'lib/chores.test.ts': 'import { it } from "vitest";\nit("adds", () => {});\ntest.each([1])("twice", () => {});\n  it.only("only", () => {});\n// it("commented", () => {})\n',
  });
  const stmt = (line) => ({ start: { line, column: 0 }, end: { line, column: 10 } });
  fs.mkdirSync(path.join(dir, 'coverage'));
  fs.writeFileSync(path.join(dir, 'coverage', 'coverage-final.json'), JSON.stringify({
    [path.join(dir, 'lib/chores.ts')]: {
      statementMap: { 0: stmt(1), 1: stmt(2), 2: stmt(4), 3: stmt(5), 4: stmt(6) },
      s: { 0: 0, 1: 3, 2: 1, 3: 0, 4: 2 },                    // lines 2, 4 and 6 run (by new or old tests alike); 5 does not; 1 is not its own
    },
  }));
  const p = bd.proof(dir, base, 'item/001-x', ['lib/chores.ts', 'lib/chores.test.ts']);
  assert.equal(p.tests, 3, 'it, test.each and it.only count; a comment does not');
  assert.equal(p.cov, 75, 'of the 4 lines it wrote that hold a statement, 3 run; the comment and the old line are not counted');
});

test('proof: no coverage summary or no source file in it is not a number; no new test is zero', () => {
  const dir = H.mkrepo();
  const base = H.git(['rev-parse', 'HEAD'], dir).trim();
  change(dir, { 'app/page.tsx': 'export default () => null;\n' });
  assert.deepEqual(bd.proof(dir, base, 'item/001-x', ['app/page.tsx']), { tests: 0, cov: null });
});

test('a project made before line reports gets the line report added once, committed, on a clean main only', () => {
  const dir = H.mkrepo();
  const cfg = path.join(dir, 'vitest.config.ts');
  fs.writeFileSync(cfg, 'export default { test: { coverage: { reporter: ["text-summary", "json-summary"] } } };\n');
  H.git(['add', '-A'], dir); H.git(['commit', '-q', '-m', 'cfg'], dir);
  fs.writeFileSync(path.join(dir, 'stray.txt'), 'x\n'); H.git(['add', 'stray.txt'], dir);
  assert.equal(bd.ensureLineCoverage(dir), false, 'something staged: it waits');
  H.git(['commit', '-q', '-m', 'stray'], dir);
  assert.equal(bd.ensureLineCoverage(dir), true);
  assert.match(fs.readFileSync(cfg, 'utf8'), /"json-summary", "json"/);
  assert.equal(H.git(['status', '--porcelain'], dir), '', 'committed');
  assert.equal(bd.ensureLineCoverage(dir), false, 'once');
});

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

test('proof: counts the test cases the change added and the lines covered in the source it touched', () => {
  const dir = H.mkrepo();
  const base = H.git(['rev-parse', 'HEAD'], dir).trim();
  change(dir, {
    'lib/chores.ts': 'export const add = () => 1;\n',
    'lib/other.ts': 'export const other = () => 2;\n',
    'lib/chores.test.ts': 'import { it } from "vitest";\nit("adds", () => {});\ntest.each([1])("twice", () => {});\n  it.only("only", () => {});\n// it("commented", () => {})\n',
  });
  fs.mkdirSync(path.join(dir, 'coverage'));
  fs.writeFileSync(path.join(dir, 'coverage', 'coverage-summary.json'), JSON.stringify({
    total: { lines: { pct: 50 } },
    [path.join(dir, 'lib/chores.ts')]: { lines: { total: 10, covered: 9 } },
    [path.join(dir, 'lib/other.ts')]: { lines: { total: 10, covered: 3 } },
    [path.join(dir, 'lib/untouched.ts')]: { lines: { total: 100, covered: 0 } },
  }));
  const p = bd.proof(dir, base, 'item/001-x', ['lib/chores.ts', 'lib/other.ts', 'lib/chores.test.ts']);
  assert.equal(p.tests, 3, 'it, test.each and it.only count; a comment does not');
  assert.equal(p.cov, 60, '12 of 20 lines in the two files it touched; the test file and untouched files do not count');
});

test('proof: no coverage summary or no source file in it is not a number; no new test is zero', () => {
  const dir = H.mkrepo();
  const base = H.git(['rev-parse', 'HEAD'], dir).trim();
  change(dir, { 'app/page.tsx': 'export default () => null;\n' });
  assert.deepEqual(bd.proof(dir, base, 'item/001-x', ['app/page.tsx']), { tests: 0, cov: null });
});

'use strict';
// scripts/ip-guard.js in a scratch repo: each kind of leak fails with its path, a clean tree passes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GUARD = path.join(__dirname, '..', '..', '..', 'scripts', 'ip-guard.js');
const STUB = '---\nname: dream\ndescription: d\n---\nRun `node "${CLAUDE_PLUGIN_ROOT}/scripts/hatch.js" content skill dream`.\n';

function repo(files, content) {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ipguard-')));
  const root = path.join(top, 'cohdit-hatch');
  const put = (base, rel, text) => { fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), text); };
  put(root, 'scripts/ip-guard.js', fs.readFileSync(GUARD, 'utf8'));
  put(root, 'README.md', '# Hatch\n');
  put(root, 'plugins/hatch/skills/dream/SKILL.md', STUB);
  for (const [rel, text] of Object.entries(files)) put(root, rel, text);
  if (content) for (const [rel, text] of Object.entries(content)) put(path.join(top, 'cohdit-hatch-private', 'hatch-content'), rel, text);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(top, 'nogit'), HATCH_DEV_DIR: '' };
  spawnSync('git', ['init', '-q'], { cwd: root, env });
  spawnSync('git', ['add', '-A'], { cwd: root, env });
  return (args = []) => {
    const r = spawnSync(process.execPath, ['scripts/ip-guard.js', ...args], { cwd: root, env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout };
  };
}

const LINE = 'The maker writes the failing test first, then the smallest change that passes it, always.';

test('a clean tree passes', () => {
  const r = repo({})();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /clean/);
});

test('a file off the public list fails: data, a doc, a lesson bank', () => {
  const r = repo({ 'plugins/hatch/data/lessons.json': '{}', 'docs/CONTRACTS.md': '# c', 'notes.md': 'x' })();
  assert.equal(r.code, 1);
  for (const f of ['plugins/hatch/data/lessons.json', 'docs/CONTRACTS.md', 'notes.md']) assert.match(r.out, new RegExp(f.replace(/\./g, '\\.') + ': not on the public list'));
});

test('a full playbook where a stub belongs fails', () => {
  const r = repo({ 'plugins/hatch/skills/build/SKILL.md': STUB + 'step\n'.repeat(30) })();
  assert.equal(r.code, 1);
  assert.match(r.out, /skills\/build\/SKILL\.md: \d+ lines; the plugin keeps stubs only/);
});

test('a customer mark or a key fails, and the matched text is never printed', () => {
  const key = ['hk', 'sub_x1.'].join('_') + 'b'.repeat(32);
  const r = repo({ 'plugins/hatch/tests/a.txt': 'copied line' + ' \t'.repeat(24) + '\n', 'plugins/hatch/tests/b.txt': 'key ' + key + '\n' })();
  assert.equal(r.code, 1);
  assert.match(r.out, /tests\/a\.txt:1: carries a customer's mark/);
  assert.match(r.out, /tests\/b\.txt:1: holds a key/);
  assert.ok(!r.out.includes(key));
});

test('with the content beside the repo, a copied line fails; front matter the stubs share does not', () => {
  const content = { 'skills/build/SKILL.md': '---\ndescription: ' + 'shared front matter line long enough to count, sixty plus chars\n---\n' + LINE + '\n' };
  const ok = repo({ 'plugins/hatch/skills/build/SKILL.md': '---\ndescription: ' + 'shared front matter line long enough to count, sixty plus chars\n---\nstub\n' }, content)();
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /no content lines copied/);
  const bad = repo({ 'plugins/hatch/tests/copied.md': '# notes\n  ' + LINE + '\n' }, content)();
  assert.equal(bad.code, 1);
  assert.match(bad.out, /tests\/copied\.md:2: copies a line of the private content/);
  assert.ok(!bad.out.includes(LINE));
});

test('--staged checks only what is about to be committed', () => {
  const run = repo({});
  assert.equal(run(['--staged']).code, 0);
  const r = repo({ 'secret.md': 'x' })(['--staged']);
  assert.equal(r.code, 1);
  assert.match(r.out, /secret\.md: not on the public list/);
});

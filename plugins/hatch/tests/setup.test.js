'use strict';
// setup.test.js — hatch.js setup on a computer with nothing, with everything, and with a sign-in to
// do. Tools are faked through COHDIT_PROBES; the home directory through COHDIT_HOME; git's global
// config through the harness, so a test never touches the machine it runs on.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const doc = require('../scripts/lib/doctor');
const tools = require('../scripts/lib/tools');
const { spawnSync } = require('child_process');

const OK = { code: 0, out: 'ok\n' };
const NONE = { code: null };
const VERCEL = doc.VERCEL.join(' ');

function probes(dir, map) {
  const file = path.join(dir, 'probes.json');
  fs.writeFileSync(file, JSON.stringify(map));
  return file;
}

/** A home directory for the person and the env that points every script at it. */
function home() {
  const d = H.mkrepo();                              // any temp dir; the harness cleans it up
  return { dir: d, env: { COHDIT_HOME: d, GIT_CONFIG_GLOBAL: path.join(d, 'gitconfig') } };
}

const EVERYTHING = {
  'node --version': { code: 0, out: 'v22.11.0\n' },
  'git --version': OK,
  'gh --version': OK,
  'gh auth status': OK,
  [VERCEL + ' --version']: OK,
  [VERCEL + ' whoami']: { code: 0, out: 'priya-k\n' },
  'gh api user': { code: 0, out: '{"login":"priya-k","id":12345,"name":"Priya K"}\n' },
};

test('doctor: nothing installed → every tool missing, in walk order, node first', () => {
  const results = doc.checks(doc.fakeRun(probes(H.mkrepo(), {})));
  assert.deepEqual(results.map((x) => x.name), doc.ORDER);
  assert.equal(results[0].state, 'missing');
  assert.equal(doc.next(results), 'node');
});

test('doctor: an old node is "old", a signed-out tool is "unauth", not "missing"', () => {
  const file = probes(H.mkrepo(), {
    'node --version': { code: 0, out: 'v18.20.0\n' }, 'gh --version': OK, 'gh auth status': { code: 1 },
  });
  const run = doc.fakeRun(file);
  const was = process.env.COHDIT_PROBES;
  process.env.COHDIT_PROBES = file;                  // probe names gh plainly, not this machine's gh path
  try {
    assert.equal(doc.probe('node', run), 'old');
    assert.equal(doc.probe('gh_auth', run), 'unauth');
    assert.equal(doc.probe('vercel_auth', run), 'missing');
  } finally {
    if (was === undefined) delete process.env.COHDIT_PROBES; else process.env.COHDIT_PROBES = was;
  }
});

test('setup on an empty machine: four plain rows, nothing about Hatch\'s own installs, node is next, exit 1', () => {
  const h = home();
  const env = Object.assign({ COHDIT_PROBES: probes(h.dir, {}) }, h.env);
  const r = H.run('hatch.js', ['setup'], { env });
  assert.equal(r.code, 1, r.err);
  const lines = r.out.split('\n');
  assert.equal(lines[0], 'Checking your computer…');
  assert.match(lines[1], /^  Node\s+not installed yet$/);
  assert.match(lines[2], /^  Git\s+not installed yet$/);
  assert.match(lines[3], /^  GitHub\s+can't fetch/);
  assert.match(lines[4], /^  Vercel\s+can't fetch/);
  assert.equal(lines[5], "6 things left. I'll walk you through them one at a time.");
  assert.equal(lines.length, 6, 'a tool row speaks for its sign-in row; advisory rows wait until the rest is done');
  assert.doesNotMatch(r.out, /Safety net|Measuring/);
  assert.doesNotMatch(r.err, /hookspath_taken/, 'a guard that installed fine is not reported as taken');
  assert.match(r.err, /^next=node$/m);
  assert.match(r.err, /^level=plain$/m);
  // The run went to the machine ledger and the settings file exists with the default level.
  assert.equal(fs.readdirSync(path.join(h.dir, '.cohdit', 'ledger', 'runs')).length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.dir, '.cohdit', 'settings.json'), 'utf8')).level, 'plain');
  for (const f of doc.GUARD_FILES) assert.ok(fs.existsSync(path.join(h.dir, '.cohdit', 'guard', f)), f);
});

test('setup when everything is there: who is signed in, "Everything is ready.", exit 0, git identity from GitHub', () => {
  const h = home();
  const env = Object.assign({ COHDIT_PROBES: probes(h.dir, EVERYTHING) }, h.env);
  const r = H.run('hatch.js', ['setup'], { env });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, ['Checking your computer…', '  Node        ready', '  Git         ready',
    '  GitHub      signed in as priya-k', '  Vercel      signed in as priya-k', 'Everything is ready.'].join('\n'));
  assert.doesNotMatch(r.err, /^next=/m);
  const cfg = fs.readFileSync(path.join(h.dir, 'gitconfig'), 'utf8');
  assert.match(cfg, /name = Priya K/);
  assert.match(cfg, /email = 12345\+priya-k@users\.noreply\.github\.com/);
  assert.match(cfg, /hooksPath = /);
});

test('setup again: only what changed and what is left; a re-run with nothing new is two lines', () => {
  const h = home();
  const env1 = Object.assign({ COHDIT_PROBES: probes(h.dir, { 'node --version': { code: 0, out: 'v22.0.0\n' }, 'git --version': OK }) }, h.env);
  H.run('hatch.js', ['setup'], { env: env1 });
  const env2 = Object.assign({ COHDIT_PROBES: probes(h.dir, EVERYTHING) }, h.env);
  const b = H.run('hatch.js', ['setup'], { env: env2 });
  assert.equal(b.out, ['Checking your computer…', '  GitHub      signed in as priya-k', '  Vercel      signed in as priya-k', 'Everything is ready.'].join('\n'), 'node and git did not change, so they are not repeated');
  const c = H.run('hatch.js', ['setup'], { env: env2 });
  assert.equal(c.out, 'Checking your computer…\nEverything is ready.');
  assert.equal(fs.readdirSync(path.join(h.dir, '.cohdit', 'ledger', 'runs')).length, 3);
});

test('advisory checks never block: a hooks path owned by another tool is reported once, exit 0', () => {
  const h = home();
  fs.writeFileSync(path.join(h.dir, 'gitconfig'), '[core]\n\thooksPath = /somewhere/else\n');
  const env = Object.assign({ COHDIT_PROBES: probes(h.dir, EVERYTHING) }, h.env);
  const r = H.run('hatch.js', ['setup'], { env });
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /^hint=hookspath_taken$/m);
  assert.match(r.out, /^  Safety net  not installed — another tool manages your git hooks, so I left it alone$/m);
  assert.equal(r.out.split('\n').pop(), 'Everything is ready.');
  assert.doesNotMatch(fs.readFileSync(path.join(h.dir, 'gitconfig'), 'utf8'), /cohdit/, 'the other tool\'s hooks path was left alone');
  assert.ok(!fs.existsSync(path.join(h.dir, '.cohdit', 'guard', 'pre-commit')), 'nothing copied for a guard that is not wired');
});

test('tech level shows every check as a sentence, never the run summary', () => {
  const h = home();
  const env = Object.assign({ COHDIT_PROBES: probes(h.dir, { 'node --version': { code: 0, out: 'v22.0.0\n' }, 'git --version': OK }) }, h.env);
  H.run('hatch.js', ['level', 'tech'], { env });
  const r = H.run('hatch.js', ['setup'], { env });
  assert.equal(r.code, 1);
  const lines = r.out.split('\n');
  assert.equal(lines.length, 2 + doc.ORDER.length);
  assert.doesNotMatch(r.out, /run=|picked=|tokens=/);
  assert.match(lines[3], /^  gh\s+not found; Hatch fetches its own copy/);
  assert.equal(lines[lines.length - 1], '4 left; next=gh');
});

test('product level changes the closing line and nothing else', () => {
  const h = home();
  const env = Object.assign({ COHDIT_PROBES: probes(h.dir, { 'node --version': { code: 0, out: 'v22.0.0\n' }, 'git --version': OK }) }, h.env);
  assert.equal(H.run('hatch.js', ['level', 'product'], { env }).out, 'product');
  assert.equal(H.run('hatch.js', ['level'], { env }).out, 'product');
  const r = H.run('hatch.js', ['setup'], { env });
  assert.match(r.out.split('\n').pop(), /items to fix; one at a time\.$/);
  assert.match(r.err, /^level=product$/m);
  assert.equal(H.run('hatch.js', ['level', 'loud'], { env }).code, 64);
});

test('wait: returns 0 the moment the capability is there, 3 with a restart hint when it is not', () => {
  const h = home();
  let env = Object.assign({ COHDIT_PROBES: probes(h.dir, { 'gh --version': OK }) }, h.env);
  assert.equal(H.run('hatch.js', ['wait', 'gh'], { env }).code, 0);
  env = Object.assign({ COHDIT_PROBES: probes(h.dir, {}) }, h.env);
  const r = H.run('hatch.js', ['wait', 'node', '--minutes', '1'], { env });
  assert.equal(r.code, 3);
  assert.equal(r.out, 'node=waiting');
  assert.match(r.err, /^hint=restart$/m);
  assert.equal(H.run('hatch.js', ['wait', 'node', '--minutes', '15'], { env }).code, 3, 'a long wait is clamped, not refused');
  assert.equal(H.run('hatch.js', ['wait', 'vercel_auth'], { env }).code, 3);
  assert.match(H.run('hatch.js', ['wait', 'vercel_auth'], { env }).err, /^hint=again$/m);
  assert.equal(H.run('hatch.js', ['wait', 'teapot'], { env }).code, 64);
});

test('connect: relays the one-time code and the URL, says which capability to wait for', () => {
  const h = home();
  const env = Object.assign({ COHDIT_PROBES: probes(h.dir, {
    'gh auth login --hostname github.com --git-protocol https --web': { code: 0, out: '! First copy your one-time code: ABCD-1234\nOpen this URL to continue in your web browser: https://github.com/login/device\n' },
    [VERCEL + ' login']: { code: 1, err: 'Error: login requires an interactive terminal\n' },
  }) }, h.env);
  const g = H.run('hatch.js', ['connect', 'github'], { env });
  assert.equal(g.code, 0, g.err);
  assert.equal(g.out, 'code=ABCD-1234\nurl=https://github.com/login/device');
  assert.match(g.err, /^wait=gh_auth$/m);
  const sw = H.run('hatch.js', ['connect', 'github', '--switch'], { env });
  assert.equal(sw.code, 0, sw.err);
  const v = H.run('hatch.js', ['connect', 'vercel'], { env });
  assert.equal(v.code, 11);
  assert.match(v.err, /^hint=signin_not_started$/m);
  assert.equal(H.run('hatch.js', ['connect', 'bitbucket'], { env }).code, 64);
});

test('doctor command: one name=state line per capability, exit 1 while anything needs a person', () => {
  const h = home();
  const env = Object.assign({ COHDIT_PROBES: probes(h.dir, EVERYTHING) }, h.env);
  H.run('hatch.js', ['setup'], { env });                 // installs the guard into this fake home
  const r = H.run('hatch.js', ['doctor'], { env });
  const lines = r.out.split('\n');
  assert.equal(lines.length, doc.ORDER.length);
  assert.ok(lines.every((l) => /^[a-z_]+=(ok|missing|unauth|old)$/.test(l)), r.out);
  assert.equal(r.code, 0);
});

test('the setup skill exists, is short, calls only hatch.js, owns the pre-Node moment, never asks which level', (t) => {
  const skill = H.playbook('skill', 'setup');
  if (!skill) return t.skip('no content folder in HATCH_DEV_DIR');
  assert.ok(skill.split('\n').length <= 100, 'skill is ' + skill.split('\n').length + ' lines');
  assert.match(skill, /hatch\.js/);
  assert.doesNotMatch(skill, /ledger\.js|step\.js|render\.js/);
  assert.doesNotMatch(skill, /How should I talk to you/i);
  assert.match(skill, /CONTRACTS\.md/);
  assert.match(skill, /Before the script can run/);
  assert.doesNotMatch(skill, /--minutes 1[05]/, 'no wait longer than Claude Code allows');
  assert.doesNotMatch(skill, /cli\.github\.com/i, "no download page for a tool Hatch fetches itself");
});

test('tools: the GitHub release asset is named for this kind of machine; PATH gains Hatch\'s bin', () => {
  assert.deepEqual(tools.ghAsset('v2.80.0', 'darwin', 'arm64'), { file: 'gh_2.80.0_macOS_arm64.zip', dir: 'gh_2.80.0_macOS_arm64', tag: 'v2.80.0' });
  assert.equal(tools.ghAsset('2.80.0', 'win32', 'x64').file, 'gh_2.80.0_windows_amd64.zip');
  assert.equal(tools.ghAsset('v2.80.0', 'linux', 'x64').file, 'gh_2.80.0_linux_amd64.tar.gz');
  assert.equal(tools.ghAsset('v2.80.0', 'linux', 'ia32'), null);
  const h = home();
  const bin = path.join(h.dir, '.cohdit', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const saved = process.env.COHDIT_HOME;
  process.env.COHDIT_HOME = h.dir;
  try {
    assert.ok(tools.pathWithExtras({ PATH: '/usr/bin' }).split(path.delimiter).includes(bin));
    fs.writeFileSync(path.join(bin, tools.exe('gh')), '');
    assert.equal(tools.ghCmd(), path.join(bin, tools.exe('gh')));
  } finally {
    if (saved === undefined) delete process.env.COHDIT_HOME; else process.env.COHDIT_HOME = saved;
  }
});

test('the global guard blocks a secret and hands over to the repo\'s own hook', { skip: process.platform === 'win32' && !process.env.MSYSTEM }, () => {
  const repo = H.mkrepo();
  const guard = path.join(H.mkrepo(), 'guard');
  fs.mkdirSync(guard);
  for (const f of doc.GUARD_FILES) {
    fs.copyFileSync(path.join(__dirname, '..', 'templates', 'global-guard', f), path.join(guard, f));
    if (f !== 'gitignore') fs.chmodSync(path.join(guard, f), 0o755);
  }
  const own = path.join(repo, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(own, '#!/usr/bin/env bash\ntouch "$(git rev-parse --show-toplevel)/own-hook-ran"\n');
  fs.chmodSync(own, 0o755);
  const git = (args, ok) => {
    const r = spawnSync('git', ['-c', 'core.hooksPath=' + guard].concat(args), { cwd: repo, encoding: 'utf8', env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }) });
    assert.equal(r.status === 0, ok, args.join(' ') + '\n' + r.stderr);
    return r;
  };
  fs.writeFileSync(path.join(repo, 'app.js'), 'ok\n');
  git(['add', 'app.js'], true);
  git(['commit', '-q', '-m', 'fine'], true);
  assert.ok(fs.existsSync(path.join(repo, 'own-hook-ran')), 'the repo\'s own pre-commit ran after the guard');
  fs.writeFileSync(path.join(repo, '.env'), 'SECRET=1\n');
  git(['add', '-f', '.env'], true);
  const r = git(['commit', '-q', '-m', 'oops'], false);
  assert.match(r.stderr, /BLOCKED by global git secret guard/);
});

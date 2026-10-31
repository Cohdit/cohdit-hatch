'use strict';
/**
 * harness.js — shared test plumbing for `node --test`.
 *
 *   run(script, args, opts)   spawn a plugin script with the pinned clock and host; {code, out, err}
 *   mkrepo()                  an empty git repo with one commit; returns its path
 *   spool(repo)               the spool.jsonl path for a repo
 *   lastLine(file)            the last JSON record in a .jsonl file
 *
 * Clock, host and plugin version are pinned so every ledger line is reproducible on any machine.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const T = __dirname;                       // tests/
const P = path.dirname(T);                 // plugin root
const S = path.join(P, 'scripts');         // scripts/
const NOW = '2026-11-01T10:00:00Z';

const ENV = Object.assign({}, process.env, {
  COHDIT_HOST: 'testhost', COHDIT_NOW: NOW, COHDIT_PLUGIN_VERSION: '0.0.1', LC_ALL: 'C',
  GIT_AUTHOR_DATE: NOW, GIT_COMMITTER_DATE: NOW,          // git's clock is Hatch's clock, so a claim's age means what it says
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: path.join(os.tmpdir(), 'cohdit-no-gitconfig'),
});

const tmps = [];
function tmpdir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hatch-'));
  tmps.push(d);
  return fs.realpathSync(d);
}
process.on('exit', () => {
  for (const d of tmps) fs.rmSync(d, { recursive: true, force: true });
});

/** Spawn `node scripts/<script> args…` in cwd with stdin input. Returns {code, out, err}. */
function run(script, args, opts = {}) {
  const r = spawnSync(process.execPath, [path.join(S, script), ...args], {
    cwd: opts.cwd, env: Object.assign({}, ENV, opts.env || {}), input: opts.input, encoding: 'utf8',
  });
  return { code: r.status, out: (r.stdout || '').replace(/\n$/, ''), err: r.stderr || '' };
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, env: ENV, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr);
  return r.stdout.trim();
}

/** An empty git repo with one commit. */
function mkrepo() {
  const d = tmpdir();
  git(['init', '-q', '-b', 'main'], d);
  fs.writeFileSync(path.join(d, 'README.md'), 'base\n');
  git(['add', 'README.md'], d);
  git(['commit', '-q', '-m', 'base'], d);
  return d;
}

function spool(repo) {
  return path.join(git(['rev-parse', '--path-format=absolute', '--git-common-dir'], repo), 'cohdit', 'spool.jsonl');
}

function lines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  } catch (e) {
    return [];
  }
}

function records(file) {
  return lines(file).map((l) => JSON.parse(l));
}

function lastLine(file) {
  const rs = records(file);
  return rs[rs.length - 1];
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function ls(dir) {
  try {
    return fs.readdirSync(dir).sort();
  } catch (e) {
    return [];
  }
}

/** A skill's or agent's playbook from the content folder (HATCH_DEV_DIR); null when the folder does not
 *  hold one, e.g. when it is the plugin itself, whose skills are thin stubs. */
function playbook(kind, name) {
  const d = process.env.HATCH_DEV_DIR;
  if (!d) return null;
  const f = kind === 'skill' ? path.join(d, 'skills', name, 'SKILL.md') : path.join(d, 'agents', name + '.md');
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch (e) { return null; }
  const stub = /follow (the printed instructions|it) exactly as if (they were|it were) this file\./i.test(text);
  return stub ? null : text;
}

/** Content for in-process loaders: a no-op with HATCH_DEV_DIR, else fetched with the key (HATCH_KEY). */
function ready() { return require('../scripts/lib/api').preloadData(); }

module.exports = { ready, playbook, T, P, S, NOW, ENV, tmpdir, run, git, mkrepo, spool, lines, records, lastLine, readJson, ls };

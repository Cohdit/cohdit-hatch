'use strict';
/**
 * lib/doctor.js — what this computer can do, as CHECK events. Capabilities, never operating systems.
 *
 * Every probe is a command run through one `runner`, so the checks are testable without the tools:
 * COHDIT_PROBES=<file.json> replaces the runner with a map of "cmd args" → {code, out, err} (tests
 * only). The install route for a missing capability is never here; the model supplies it for the
 * machine in front of it (docs/CONTRACTS.md § Principles, 8).
 *
 * Order matters: it is the order setup walks them in, and `next()` returns the first that needs a
 * person. Team and AWS checks are not run here; they belong to a hosting choice or another plugin.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ml = require('./ledger');
const tools = require('./tools');

const NODE_MIN = 20;
const ORDER = ['node', 'git', 'gh', 'gh_auth', 'vercel', 'vercel_auth', 'guard', 'hook_path'];
/** Hatch's own two installs. They never block "Everything is ready." and never need the person. */
const ADVISORY = ['guard', 'hook_path'];
/** The publishing tool is run through npx, so there is nothing for the person to install. */
const VERCEL = ['npx', '-y', 'vercel@latest'];
const GUARD_FILES = ['pre-commit', 'pre-push', '_env-guard.sh', 'gitignore'];
const PROBE_TIMEOUT_MS = 120000;

function homeDir() {
  return process.env.COHDIT_HOME || os.homedir();
}

function cohditHome() {
  return path.join(homeDir(), '.cohdit');
}

function guardDir() {
  return path.join(cohditHome(), 'guard');
}

/** Run a command; never throws. {code, out, err}. code is null when the tool is not there. Children
 *  see PATH plus the directories installers use (lib/tools.js), so a tool installed a minute ago is
 *  found without a restart. A shell is used only where a `.cmd` shim needs one. */
function realRun(cmd, args, opts) {
  const o = opts || {};
  try {
    const env = Object.assign({}, o.env || process.env);
    env.PATH = tools.pathWithExtras(env);
    const r = spawnSync(cmd, args, {
      encoding: 'utf8', timeout: o.timeout || PROBE_TIMEOUT_MS, input: o.input,
      stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' && !path.isAbsolute(cmd), env, cwd: o.cwd,
    });
    if (r.error && r.error.code === 'ENOENT') return { code: null, out: '', err: r.error.message };
    return { code: r.status === null ? -1 : r.status, out: r.stdout || '', err: r.stderr || '' };
  } catch (e) {
    return { code: null, out: '', err: e.message };
  }
}

/** The runner tests inject: COHDIT_PROBES maps "cmd arg arg" → {code, out, err}; unknown → not found. */
function fakeRun(file) {
  const table = ml.readJson(file, {});
  return function (cmd, args) {
    const key = [cmd].concat(args || []).join(' ');
    const hit = table[key];
    if (!hit) return { code: null, out: '', err: 'not in COHDIT_PROBES: ' + key };
    return { code: hit.code === undefined ? 0 : hit.code, out: hit.out || '', err: hit.err || '' };
  };
}

function runner() {
  return process.env.COHDIT_PROBES ? fakeRun(process.env.COHDIT_PROBES) : realRun;
}

function major(versionText) {
  const m = /v?(\d+)\./.exec(versionText || '');
  return m ? Number(m[1]) : null;
}

/** git's global config, always through the real git: tests redirect it with GIT_CONFIG_GLOBAL. */
function cfg(args) {
  return realRun('git', ['config', '--global'].concat(args));
}

function gitGlobal(key) {
  const r = cfg(['--get', key]);
  return r.code === 0 ? r.out.trim() : '';
}

/** Does PATH contain the directory the running node lives in? Hooks run node from PATH. */
function nodeOnPath(env) {
  const dir = path.dirname(process.execPath);
  const sep = process.platform === 'win32' ? ';' : ':';
  return ((env || process.env).PATH || '').split(sep).some((p) => p && path.resolve(p) === path.resolve(dir));
}

function guardInstalled() {
  const dir = guardDir();
  if (!GUARD_FILES.every((f) => fs.existsSync(path.join(dir, f)))) return false;
  const hooks = gitGlobal('core.hooksPath');
  const excludes = gitGlobal('core.excludesfile');
  return !!hooks && path.resolve(hooks) === path.resolve(dir) && !!excludes && path.resolve(excludes) === path.resolve(path.join(dir, 'gitignore'));
}

/** The GitHub tool to run: tests see plain `gh`; a real machine may use Hatch's own copy. */
function gh() {
  return process.env.COHDIT_PROBES ? 'gh' : tools.ghCmd();
}

/** One capability. Returns 'ok' | 'missing' | 'unauth' | 'old'. The team checks take `opts`:
 *  {scope} (a Vercel team slug) or {org} (a GitHub organisation); without one they are not applicable, ok. */
function probe(name, run, opts) {
  const o = opts || {};
  switch (name) {
    case 'node': {
      const r = run('node', ['--version']);
      if (r.code !== 0) return 'missing';
      return major(r.out) >= NODE_MIN ? 'ok' : 'old';
    }
    case 'git': return run('git', ['--version']).code === 0 ? 'ok' : 'missing';
    case 'gh': return run(gh(), ['--version']).code === 0 ? 'ok' : 'missing';
    case 'gh_auth': {
      if (run(gh(), ['--version']).code !== 0) return 'missing';
      return run(gh(), ['auth', 'status']).code === 0 ? 'ok' : 'unauth';
    }
    case 'vercel': return run(VERCEL[0], VERCEL.slice(1).concat(['--version'])).code === 0 ? 'ok' : 'missing';
    case 'vercel_auth': {
      if (run(VERCEL[0], VERCEL.slice(1).concat(['--version'])).code !== 0) return 'missing';
      return run(VERCEL[0], VERCEL.slice(1).concat(['whoami'])).code === 0 ? 'ok' : 'unauth';
    }
    case 'vercel_team': return !o.scope || teams(run).includes(o.scope) ? 'ok' : 'missing';
    case 'gh_org': return !o.org || run(gh(), ['api', 'user/memberships/orgs/' + o.org]).code === 0 ? 'ok' : 'missing';
    case 'guard': return guardInstalled() ? 'ok' : 'missing';
    case 'hook_path': return nodeOnPath() ? 'ok' : 'missing';
    default: throw new Error('unknown capability ' + name);
  }
}

/** The slugs of the teams the person is on, from the publishing tool; [] when it cannot say. */
function teams(run) {
  const r = run(VERCEL[0], VERCEL.slice(1).concat(['teams', 'ls', '--json']));
  if (r.code !== 0) return [];
  try {
    const j = JSON.parse(r.out);
    return (Array.isArray(j) ? j : j.teams || []).map((t) => t && (t.slug || t.id)).filter(Boolean);
  } catch (e) { return []; }
}

/** Who is signed in, for the two accounts; '' when it cannot be told. */
function who(name, run) {
  if (name === 'gh_auth') {
    const r = run(gh(), ['api', 'user']);
    try { return r.code === 0 ? String(JSON.parse(r.out).login || '') : ''; } catch (e) { return ''; }
  }
  if (name === 'vercel_auth') {
    const r = run(VERCEL[0], VERCEL.slice(1).concat(['whoami']));
    const lines = (r.out || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const last = lines.length ? lines[lines.length - 1] : '';
    return r.code === 0 && /^[A-Za-z0-9._-]{1,96}$/.test(last) ? last : '';
  }
  return '';
}

/** Every capability in walk order: [{name, state, who?}]. */
function checks(run) {
  const r = run || runner();
  return ORDER.map((name) => {
    const state = probe(name, r);
    const out = { name, state };
    if (state === 'ok') {
      const w = who(name, r);
      if (w) out.who = w;
    }
    return out;
  });
}

/** The first capability that still needs a person, or null. Advisory ones never do. */
function next(results) {
  const r = results.find((x) => x.state !== 'ok' && !ADVISORY.includes(x.name));
  return r ? r.name : null;
}

// --- what setup can fix on its own ------------------------------------------------------------

/** The person's settings file exists with a level. Returns the level. */
function ensureSettings() {
  const file = ml.settingsPath();
  const s = ml.readJson(file, null);
  if (s && ['plain', 'product', 'tech'].includes(s.level)) return s.level;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fresh = Object.assign({ v: 1, level: 'plain', projects: [] }, s || {}, { level: (s && s.level) || 'plain' });
  if (!Array.isArray(fresh.projects)) fresh.projects = [];
  fs.writeFileSync(file, JSON.stringify(fresh, null, 2) + '\n');
  return fresh.level;
}

function setLevel(level) {
  const file = ml.settingsPath();
  ensureSettings();
  const s = ml.readJson(file, {});
  s.level = level;
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
}

/** Copy the guard templates to ~/.cohdit/guard and point git's global hooks and excludes at them.
 *  Returns 'ok' | 'taken' (another tool owns the global hooksPath; left alone) | 'nogit'. */
function installGuard() {
  const dir = guardDir();
  if (realRun('git', ['--version']).code !== 0) return 'nogit';
  const hooks = gitGlobal('core.hooksPath');
  if (hooks && path.resolve(hooks) !== path.resolve(dir)) return 'taken';
  const src = path.join(ml.PLUGIN, 'templates', 'global-guard');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of GUARD_FILES) {
    fs.copyFileSync(path.join(src, f), path.join(dir, f));
    if (f !== 'gitignore') fs.chmodSync(path.join(dir, f), 0o755);
  }
  if (cfg(['core.hooksPath', dir]).code !== 0) return 'nogit';
  if (cfg(['core.excludesfile', path.join(dir, 'gitignore')]).code !== 0) return 'nogit';
  return 'ok';
}

/** A git identity from the GitHub account, only where none is set. Returns true if set or present. */
function ensureIdentity(run) {
  if (gitGlobal('user.name') && gitGlobal('user.email')) return true;
  const r = run(gh(), ['api', 'user']);
  if (r.code !== 0) return false;
  let u;
  try { u = JSON.parse(r.out); } catch (e) { return false; }
  if (!u || !u.login || !u.id) return false;
  if (!gitGlobal('user.name')) cfg(['user.name', u.name || u.login]);
  if (!gitGlobal('user.email')) cfg(['user.email', u.id + '+' + u.login + '@users.noreply.github.com']);
  return true;
}

module.exports = {
  ORDER, ADVISORY, VERCEL, NODE_MIN, GUARD_FILES, homeDir, cohditHome, guardDir, runner, realRun, fakeRun, major,
  nodeOnPath, gh, probe, who, teams, checks, next, ensureSettings, setLevel, installGuard, ensureIdentity, guardInstalled,
};

'use strict';
/**
 * lib/e2e.js — the browser checks: tests a tester agent writes from the person's own checks before a
 * thing is built, and that the maker can neither read nor change.
 *
 * Custody is by code, never by instruction:
 *   - the tester may write one file, e2e/<item>.spec.ts, and nothing else (`build tested` looks at the tree);
 *   - that file is held outside the project while the maker works, copied in only while the checks run,
 *     and committed by the script when the thing passes the gate;
 *   - a change under e2e/ or to playwright.config.* by the maker is put back and its commit refused;
 *   - a skipped test is a failed test, and a test that fails and then passes is flaky, not passed.
 *
 * A project has browser checks when its config carries `e2e.command` (set at the skeleton); one made
 * before this has none and builds as it always did.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const ml = require('./ledger');
const sp = require('./spec');
const tools = require('./tools');

class Invalid extends Error {}

const PROTECTED = /^(e2e\/|playwright\.config\.)/;
const RUN_MS = 9 * 60000;
const REASON_MAX = 300;

function enabled(cfg) { return !!(cfg && cfg.e2e && typeof cfg.e2e.command === 'string' && cfg.e2e.command.trim()); }
function isProtected(file) { return PROTECTED.test(String(file).split(path.sep).join('/')); }
function specName(item) { return 'e2e/' + String(item).toLowerCase() + '.spec.ts'; }

/** Which thing a test file belongs to (e2e/item-004.spec.ts → ITEM-004), or null for the skeleton's own. */
function itemOf(file) {
  const m = /(^|\/)(item-\d+)\.spec\.[cm]?[jt]sx?$/i.exec(String(file));
  return m ? m[2].toUpperCase() : null;
}

/** Where a thing's test waits while it is being built: under the person's home, not in the project and not
 *  beside the briefs, so nothing the maker is told about leads to it. */
function holdDir(dir, item) {
  const key = crypto.createHash('sha1').update(path.resolve(dir)).digest('hex').slice(0, 16);
  return path.join(sp.homeDir(), '.cohdit', 'held', key, item);
}

function heldFiles(dir, item) {
  const root = holdDir(dir, item);
  const out = [];
  const walk = (d) => {
    for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else out.push(path.relative(root, path.join(d, e.name)).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

/** Take the tester's file out of the project and into the hold. */
function hold(dir, item, files) {
  const root = holdDir(dir, item);
  fs.rmSync(root, { recursive: true, force: true });
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.copyFileSync(path.join(dir, f), path.join(root, f));
  }
}

function drop(dir, item) { fs.rmSync(holdDir(dir, item), { recursive: true, force: true }); }

/** Copy a thing's held test into the project for one run. Returns the files it put there, for `clear`:
 *  a file already there and the same (committed at the gate) is left alone. */
function place(dir, item) {
  const root = holdDir(dir, item);
  const placed = [];
  for (const f of heldFiles(dir, item)) {
    const to = path.join(dir, f), from = path.join(root, f);
    if (fs.existsSync(to) && fs.readFileSync(to, 'utf8') === fs.readFileSync(from, 'utf8')) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    placed.push(f);
  }
  return placed;
}

function clear(dir, placed) {
  for (const f of placed || []) fs.rmSync(path.join(dir, f), { force: true });
}

/** Does the project have any browser test to run right now? */
function hasSpecs(dir) {
  const d = path.join(dir, 'e2e');
  return fs.existsSync(d) && fs.readdirSync(d).some((n) => /\.spec\.[cm]?[jt]sx?$/.test(n));
}

// --- the checks' own settings, and the maker's own tests ---------------------------------------------

const SETTINGS = /^vitest\.config\./;
const UNIT_TEST = /(^|\/)(__tests__|tests?)\/|\.test\.[cm]?[jt]sx?$/;
const SWITCHED_OFF = /\b(it|test|describe)\s*\.\s*(skip|only|todo)\b|\bx(it|test|describe)\s*\(/;

function show(dir, ref) {
  const r = spawnSync('git', ['show', ref], { cwd: dir, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

/** The checks run through the project's own settings, so those are not the maker's to change either: the test
 *  runner's config, and the `scripts` of package.json (its packages are: `build add` writes them). Whatever was
 *  changed is put back as the last commit had it. Returns what it put back. */
function restoreSettings(dir, dirty) {
  const back = [];
  for (const f of dirty.filter((x) => SETTINGS.test(x))) {
    const was = show(dir, 'HEAD:' + f);
    if (was === null) fs.rmSync(path.join(dir, f), { force: true }); else fs.writeFileSync(path.join(dir, f), was);
    back.push(f);
  }
  if (dirty.includes('package.json')) {
    const was = show(dir, 'HEAD:package.json');
    const now = ml.readJson(path.join(dir, 'package.json'), null);
    let before = null;
    try { before = JSON.parse(was); } catch (e) { before = null; }
    if (before && now && JSON.stringify(before.scripts || {}) !== JSON.stringify(now.scripts || {})) {
      now.scripts = before.scripts || {};
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(now, null, 2) + '\n');
      back.push('package.json (scripts)');
    }
  }
  return back;
}

/** Tests of the maker's own that this change switches off (skip, only, todo): the files, for the refusal. */
function switchedOff(dir, dirty) {
  const out = [];
  for (const f of dirty.filter((x) => UNIT_TEST.test(x) && !isProtected(x))) {
    const full = path.join(dir, f);
    if (!fs.existsSync(full)) continue;
    const tracked = spawnSync('git', ['diff', '-U0', 'HEAD', '--', f], { cwd: dir, encoding: 'utf8' });
    const added = show(dir, 'HEAD:' + f) === null ? fs.readFileSync(full, 'utf8')
      : String(tracked.stdout || '').split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
    if (SWITCHED_OFF.test(added.replace(/^\+?\s*\/\/.*$/gm, ''))) out.push(f);
  }
  return out;
}

// --- a test must be able to fail -------------------------------------------------------------------

const LINT = [
  [/\b(test|it|describe)\s*\.\s*(skip|fixme|only|fail)\b/, 'no skip, fixme, only or fail: every test runs and must pass'],
  [/\bwaitForTimeout\s*\(/, 'no fixed waits (waitForTimeout): assert on what the page shows and let it wait'],
  [/networkidle/, 'no networkidle: assert on what the page shows'],
  [/\bpage\s*\.\s*(locator|\$\$?|waitForSelector)\s*\(/, 'find things the way a person does (getByRole, getByLabel, getByText, getByPlaceholder), not by selector'],
  [/\bxpath\s*=|\/\/\*\[/, 'no XPath'],
  [/\b(page\.route|route\.fulfill|addInitScript|page\.evaluate)\s*\(/, 'no faking the app from inside the test (route, evaluate, addInitScript): drive it as a person would'],
  [/\btest\s*\.\s*(setTimeout|slow)\s*\(|\bretries\b/, 'no timeouts or retries set in the test'],
];

/** What is wrong with a test file as written, as a list of sentences; empty when it may run. */
function lint(text) {
  const src = String(text || '');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const out = [];
  for (const [re, why] of LINT) if (re.test(code)) out.push(why);
  const imports = [...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] || m[2]);
  const foreign = imports.filter((m) => m !== '@playwright/test');
  if (foreign.length) out.push('import only from @playwright/test (found: ' + [...new Set(foreign)].join(', ') + ')');
  const tests = (code.match(/^\s*test\s*\(/gm) || []).length;
  if (!tests) out.push('no test( in the file');
  const expects = (code.match(/\bexpect\s*\(/g) || []).length;
  if (tests && expects < tests) out.push('every test needs at least one expect( on what the person sees (' + tests + ' tests, ' + expects + ' expects)');
  if (/\bexpect\s*\([^)]*\)\s*\.\s*(toBeTruthy|toBeDefined)\s*\(\s*\)/.test(code) && expects <= tests) out.push('expect something the person would see (toBeVisible, toHaveText, toHaveURL), not toBeTruthy');
  return out;
}

/** The person's checks that no test in the file is titled with, word for word. A test is the proof of one check, so
 *  the two are tied by the title: case, quote marks, spacing and a closing full stop aside. */
function plainTitle(s) { return String(s || '').toLowerCase().replace(/[\u2018\u2019\u201c\u201d"'`]/g, '').replace(/\s+/g, ' ').replace(/[.!\s]+$/, '').trim(); }
function titles(text) {
  const code = String(text || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...code.matchAll(/^\s*test\s*\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/gm)].map((m) => m[2].replace(/\\(.)/g, '$1'));
}
function uncovered(text, criteria) {
  const have = new Set(titles(text).map(plainTitle));
  return (criteria || []).filter((c) => !have.has(plainTitle(c)));
}

// --- running ------------------------------------------------------------------------------------

function strip(s) { return String(s || '').replace(/\u001b\[[0-9;]*m/g, ''); }

/** A port for this copy's app, so lanes on one computer never share one. */
function portFor(dir) {
  return 3100 + (parseInt(crypto.createHash('sha1').update(path.resolve(dir)).digest('hex').slice(0, 6), 16) % 800);
}

/** Every test in a Playwright JSON report, flat: {file, title, status, error}. */
function flatten(report) {
  const out = [];
  const walk = (suite, file) => {
    const f = suite.file || file;
    for (const s of suite.specs || []) {
      for (const t of s.tests || []) {
        const last = (t.results || [])[(t.results || []).length - 1] || {};
        const failed = (t.results || []).find((r) => r.error || (r.errors || []).length) || last;
        const err = failed.error || (failed.errors || [])[0] || {};
        out.push({ file: String(s.file || f || '').split(path.sep).join('/'), title: s.title, status: t.status || (s.ok ? 'expected' : 'unexpected'), error: strip(err.message || err.value || '') });
      }
    }
    for (const c of suite.suites || []) walk(c, f);
  };
  for (const s of (report && report.suites) || []) walk(s, s.file);
  return out;
}

/**
 * Run the browser tests: all of them, or only `files`. Returns
 *   {tests, passed, failed, flaky, skipped, list}   on a run that produced a report, or
 *   {error}                                          when it produced none (the app did not start, the config is broken).
 * `once` turns retries off: a first failure is the answer (used to see a new test fail before the thing exists).
 */
function run(dir, cfg, o) {
  const opts = o || {};
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hatch-e2e-')), 'report.json');
  const env = Object.assign({}, process.env, {
    PATH: tools.pathWithExtras(), CI: '1', E2E_PORT: String(portFor(dir)),
    PLAYWRIGHT_JSON_OUTPUT_FILE: out, PLAYWRIGHT_JSON_OUTPUT_NAME: out,
  });
  let cmd = cfg.e2e.command;
  if (opts.once) cmd += ' --retries=0';
  for (const f of opts.files || []) cmd += ' "' + f + '"';
  const r = spawnSync(cmd, { cwd: dir, shell: true, encoding: 'utf8', timeout: RUN_MS, env, maxBuffer: 64 * 1024 * 1024 });
  let report = ml.readJson(out, null);
  if (!report) {
    const text = String(r.stdout || '');
    const at = text.indexOf('{');
    if (at >= 0) { try { report = JSON.parse(text.slice(at)); } catch (e) { report = null; } }
  }
  fs.rmSync(path.dirname(out), { recursive: true, force: true });
  if (!report || !Array.isArray(report.suites)) {
    const tail = strip((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-25).join('\n');
    return { error: tail || (r.status === null ? 'the browser tests did not finish in time' : 'the browser tests produced no report') };
  }
  const list = flatten(report);
  const count = (s) => list.filter((t) => t.status === s).length;
  return { tests: list.length, passed: count('expected'), failed: count('unexpected'), flaky: count('flaky'), skipped: count('skipped'), list };
}

/** Did the run pass? Nothing failed, nothing flaky, nothing skipped, and something ran. */
function green(res) { return !res.error && res.tests > 0 && !res.failed && !res.flaky && !res.skipped; }

const WORD = { unexpected: 'failed', flaky: 'flaky (it failed, then passed on a second go)', skipped: 'skipped (a skipped check counts as failed)' };

/** What the maker reads when the browser tests are not green: one record per failing test, and what it may touch. */
function record(res, item) {
  if (res.error) return 'The browser tests could not run.\n\n' + res.error;
  const out = ['The browser tests did not pass. Fix the app; the tests are not yours to change.'];
  for (const t of res.list.filter((x) => x.status !== 'expected')) {
    const owner = itemOf(t.file);
    out.push('', 'THING     ' + (owner || 'the skeleton') + (owner && item && owner !== item ? ' (finished earlier: your change broke it)' : ''),
      'VERDICT   ' + (WORD[t.status] || t.status),
      'CHECK     ' + t.title);
    if (t.error) out.push('EVIDENCE  ' + t.error.trim().split('\n').slice(0, 14).join('\n          '));
    out.push('SCOPE     change only what this thing needs. Nothing under e2e/ and not playwright.config.*');
  }
  if (res.tests === 0) out.push('', 'No browser test ran.');
  return out.join('\n');
}

// --- what the tester returns ---------------------------------------------------------------------

/** {"verdict":"written"} | {"verdict":"none","reason":"…"}: `none` is a thing a browser cannot check
 *  (nothing on a screen changes), said plainly so the person is told to try it by hand. */
function testerReturn(text) {
  let t = String(text || '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1].trim();
  let r;
  try { r = JSON.parse(t); } catch (e) { throw new Invalid('the report is not one JSON block: ' + e.message); }
  if (!r || typeof r !== 'object' || !['written', 'none'].includes(r.verdict)) throw new Invalid('verdict must be written or none');
  if (r.verdict === 'none') {
    if (typeof r.reason !== 'string' || !r.reason.trim()) throw new Invalid('none needs a reason: why a browser cannot check this thing');
    return { verdict: 'none', reason: r.reason.trim().slice(0, REASON_MAX) };
  }
  const stand = (Array.isArray(r.stand_ins) ? r.stand_ins : []).filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().slice(0, 80)).slice(0, 6);
  return { verdict: 'written', stand_ins: stand };
}

module.exports = { titles, uncovered,
  Invalid, PROTECTED, enabled, isProtected, specName, itemOf, holdDir, heldFiles, hold, drop, place, clear, hasSpecs,
  restoreSettings, switchedOff, lint, portFor, flatten, run, green, record, testerReturn,
};

'use strict';
/**
 * lib/build.js — the unattended run: one fresh maker per item, the gate that decides done, the
 * checker when the change warrants it, every event in the project ledger. `hatch.js build` is the
 * only caller; the maker's only way to change state is through the same verbs (verify, commit, add),
 * so the one permission the person gave covers the whole run and the gate cannot be bypassed.
 *
 * Many sessions, many computers, one idea (Delon, 2026-10-27): the person says "build it" anywhere, as
 * often as they like, and Hatch shares the work. Nothing of that is visible; the mechanisms are:
 *   - a claim is the item's branch on the shared copy (GitHub), opened with a dated start commit and
 *     pushed with a lease: whoever pushes the ref first owns the item; a claim untouched for a day is
 *     taken over, and a pick whose run ended or went quiet for a day gives the item back;
 *   - the gate combines before it merges: fetch, rebase the item onto what others merged, run the
 *     checks again, push main with a lease, retry on a race;
 *   - the ledger is the shared truth of what happened: outcomes are flushed from the spool and
 *     committed the moment they happen; run files are unique per run and blobs per content, so two
 *     sessions' records never conflict. An item's status is derived from the ledger, never edited in
 *     spec.json by the build;
 *   - a second session on the same computer gets its own working copy beside the first
 *     (`<home>/Hatch/.work/<slug>-N`, a git worktree on a main-line branch of its own) with its own
 *     run; the first keeps going; "continue" in that window finds the same copy;
 *   - "build <name>" on a computer that has never seen the idea finds the repository in the
 *     person's GitHub account (topic cohdit-hatch) and fetches it into ~/Hatch.
 *
 * State owned here:
 *   - the active run of this working copy (`lib/ledger.js activeRun`, per working copy):
 *     { run, started, skill, session?, beat, open: {ITEM: {branch, fork, …}}, picked: [], stop? }
 *   - `<home>/.cohdit/active.json` → { path, run }: the working copy that is building, so the usage hook
 *     finds the run when Claude Code was opened in another folder.
 * Events go to the spool (shared by the working copies of one project) and are flushed into
 * `.cohdit/ledger/runs/<run>.jsonl` per run at every outcome and at close, then committed.
 *
 * Caps (docs/CONTRACTS.md § Principles 5) come from .cohdit/config.json, written on the first run.
 * Rulings of 2026-10-27: build touches GitHub only (Vercel belongs to share); "build it" builds the whole
 * first version; words and small choices are the maker's to draft or decide, recorded as Hatch's and
 * shown in try; the gate is `build commit`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ml = require('./ledger');
const cz = require('./codes');
const sp = require('./spec');
const doc = require('./doctor');
const tools = require('./tools');
const ls = require('./lessons');
const api = require('./api');

const DEFAULT_CAPS = { items_per_run: 8, usd_per_run: 15, rounds_per_item: 2, minutes_per_item: 40 };
const DEFAULT_VERIFY = 'npm test && npm run build';
const LONG_MS = 9 * 60000;                       // one verify, one scaffold step: under Claude Code's limit for a call
const NET_MS = 120000;                           // one fetch, one push
const RISK_LOW_CHANGES = ['copy', 'style'];      // docs/CONTRACTS.md § Agents: the one risk rule
const RISK_LOW_FILES = 2;
const RAIL_SIGNALS = { personal_details: 'personal', children: 'personal', payments: 'money', uploads: 'uploads', messaging: 'messaging', user_content: 'content' };
const PAID_PACKAGES = ['stripe', 'resend', '@anthropic-ai/sdk', '@vercel/blob', '@neondatabase/serverless'];
const ROLES = ['architect', 'tester', 'analyst', 'owner', 'security', 'privacy', 'cost'];
const QUESTION_MAX = 600;
const ANSWER_MAX = 1200;
const LIVE_MIN = 60;                             // a run whose last call is younger than this belongs to a session still working
const STALE_CLAIM_H = 24;                        // a claim branch untouched this long is taken over
const TOPIC = 'cohdit-hatch';                    // marks the repositories Hatch made, so another computer can find them
const AGENTS = path.join(ml.PLUGIN, 'agents');
const Invalid = sp.Invalid;

// --- files --------------------------------------------------------------------------------------

function cohditDir(dir) { return sp.cohditDir(dir); }
function notesDir(dir) { return path.join(cohditDir(dir), 'notes'); }

function readCfg(dir) {
  const cfg = ml.readJson(path.join(cohditDir(dir), 'config.json'), { v: 1 });
  cfg.caps = Object.assign({}, DEFAULT_CAPS, cfg.caps || {});
  if (!cfg.verify) cfg.verify = DEFAULT_VERIFY;
  return cfg;
}

function saveCfg(dir, cfg) {
  fs.writeFileSync(path.join(cohditDir(dir), 'config.json'), JSON.stringify(cfg, null, 2) + '\n');
}

function level(dir) {
  const cfg = ml.readJson(path.join(cohditDir(dir), 'config.json'), {});
  return cz.LEVELS.includes(cfg.level) ? cfg.level : doc.ensureSettings();
}

/** Long text beside the events: into the spool's blobs, moved to the ledger at flush. Returns the id. */
function blob(dir, text) {
  return ml.writeBlob(String(text).trim() || '(no detail)', dir);
}

/** Validate and spool events. `events` is [[code, fields, item?], …]. Returns the stamped records. */
function emit(dir, run, events) {
  const table = cz.load();
  return events.map(([c, f, i]) => {
    const r = { c, f: cz.coerce(table, c, f), r: run, ts: ml.utcNow() };
    if (i) r.i = i;
    return ml.appendSpool(r, dir);
  });
}

function spoolFile(dir) { return path.join(ml.spoolDir(dir), 'spool.jsonl'); }

/** Move this run's spooled records (and the usage hook's for it) into its run file, with every blob.
 *  Other runs' records stay in the spool: they belong to a session that is still working. */
function flush(dir, run) {
  const file = spoolFile(dir);
  const recs = ml.readJsonl(file).recs;
  const mine = recs.filter((r) => r.r === run);
  const rest = recs.filter((r) => r.r !== run);
  const n = mine.length ? ml.appendRecords(path.join(cohditDir(dir), 'ledger', 'runs', run + '.jsonl'), mine) : 0;
  if (fs.existsSync(file)) {
    if (rest.length) fs.writeFileSync(file, rest.map((r) => ml.dumps(r) + '\n').join(''));
    else fs.unlinkSync(file);
  }
  for (const src of ml.listFiles(path.join(ml.spoolDir(dir), 'blobs'), '.txt')) {
    const dst = path.join(cohditDir(dir), 'ledger', 'blobs', path.basename(src));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
  }
  return n;
}

// --- git ------------------------------------------------------------------------------------------

function git(args, dir, check = true) { return ml.git(args, dir, check); }

/** git with a network timeout and the installers' PATH; {code, out, err}. Never throws. */
function gitNet(args, dir) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: NET_MS, env: Object.assign({}, process.env, { PATH: tools.pathWithExtras(), GIT_TERMINAL_PROMPT: '0' }) });
  return { code: r.status === null ? -1 : r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function hasRemote(dir) { return git(['remote', 'get-url', 'origin'], dir, false) !== null; }
function headSha(dir, ref) { return git(['rev-parse', '--short=8', ref || 'HEAD'], dir, false); }
function fullSha(dir, ref) { return git(['rev-parse', ref || 'HEAD'], dir, false); }
function currentBranch(dir) { return git(['rev-parse', '--abbrev-ref', 'HEAD'], dir, false); }

/** Is this the repository's primary working copy (where `main` may be checked out)? */
function isPrimary(dir) {
  const top = git(['rev-parse', '--show-toplevel'], dir, false);
  return !!top && path.resolve(top) === path.resolve(ml.repoRoot(dir));
}

/** Paths with uncommitted changes outside .cohdit/ — the person's own work, which Hatch never builds over. */
function dirtyPaths(dir) {
  const r = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '-z'], { cwd: dir, encoding: 'utf8' });
  return String(r.stdout || '').split('\0').filter(Boolean).map((l) => l.slice(3)).filter((p) => p && !p.startsWith(ml.COHDIT_DIR + '/'));
}

function fetch(dir) {
  if (!hasRemote(dir)) return false;
  return gitNet(['fetch', '-q', '--prune', 'origin'], dir).code === 0;
}

/** The sha of main as the shared copy has it, or null without a remote. */
function remoteMain(dir) { return hasRemote(dir) ? fullSha(dir, 'refs/remotes/origin/main') : null; }

/** The branch this working copy keeps its main line on: `main` in the primary copy, a branch of its
 *  own in a side copy (git lets one branch be checked out in one working copy only). */
function mainBranch(dir) {
  if (isPrimary(dir)) return 'main';
  return 'hatch/' + path.basename(git(['rev-parse', '--show-toplevel'], dir));
}

/** Everything the maker left uncommitted, outside .cohdit/, is thrown away: the next thing starts
 *  from a clean tree, and the person is never told Hatch's half work is theirs. */
function resetTree(dir) {
  if (fullSha(dir, 'HEAD') === null) return;
  git(['checkout', '-q', '--', '.', ':(exclude)' + ml.COHDIT_DIR], dir, false);
  git(['clean', '-qfd', '-e', ml.COHDIT_DIR], dir, false);
}

/** Stand on this copy's main line, replaying onto the shared main whatever a push lost the race on,
 *  so an outcome committed here is never orphaned. */
function toMain(dir) {
  if (fullSha(dir, 'main') === null && remoteMain(dir) === null) return;            // no commit yet
  const mb = mainBranch(dir);
  if (currentBranch(dir) !== mb) {
    if (fullSha(dir, mb) === null) git(['branch', '-q', mb, remoteMain(dir) || 'main'], dir);
    git(['checkout', '-q', mb], dir);
  }
  const rm = remoteMain(dir);
  if (rm && fullSha(dir, mb) !== rm) rebaseOnto(dir, 'origin/main', mb);
}

/** Rebase `branch` onto `upstream`, carrying uncommitted ledger changes along. A conflict in the
 *  commits aborts (false). A conflict in the carried changes lets the shared copy win: the tree is reset
 *  to the rebased commit and the carried changes are dropped, so no marker ever reaches the ledger. */
function rebaseOnto(dir, upstream, branch) {
  if (git(['rebase', '-q', '--autostash', upstream, branch], dir, false) === null) {
    git(['rebase', '--abort'], dir, false);
    return false;
  }
  if (git(['diff', '--name-only', '--diff-filter=U'], dir, false)) {
    git(['reset', '-q', '--hard'], dir, false);
    git(['stash', 'drop', '-q'], dir, false);
  }
  return true;
}

/** Is `sha` a fast-forward of the shared main as we last saw it? Main is only ever advanced. */
function fastForward(dir, sha) {
  const rm = remoteMain(dir);
  return !rm || git(['merge-base', '--is-ancestor', rm, sha], dir, false) !== null;
}

/** The sha main should be built from: the shared copy's main after a fetch, else the local one. */
function baseSha(dir) {
  fetch(dir);
  return remoteMain(dir) || fullSha(dir, 'main');
}

/** Where a new item starts: this copy's main line, after taking in the shared main. Commits the person
 *  made here and never pushed (a reshaped list, say) are pushed first, so the build never starts from an
 *  older copy than the one on this computer. A main line that cannot be combined with the shared one
 *  falls back to the shared main. Returns { base, push } where push is the PUSH result or null. */
function startBase(dir) {
  fetch(dir);
  toMain(dir);
  const mb = mainBranch(dir);
  const local = fullSha(dir, mb), rm = remoteMain(dir);
  if (!local) return { base: rm, push: null };
  if (!rm) return { base: local, push: null };
  if (local === rm || !fastForward(dir, local)) return { base: rm, push: null };
  const push = landMain(dir);
  return { base: fullSha(dir, mb), push };
}

/** Advance the shared main to `sha`, a fast-forward only: a lease would let a non-fast-forward through and
 *  throw away what others merged. Returns 'ok' | 'rejected' (someone else got there first, or `sha` is not
 *  ahead of main) | 'no_remote'. */
function pushMain(dir, sha, expected) {
  if (!hasRemote(dir)) return 'no_remote';
  if (!fastForward(dir, sha)) return 'rejected';
  const lease = expected ? 'refs/heads/main:' + expected : 'refs/heads/main';
  const r = gitNet(['push', '-q', 'origin', sha + ':refs/heads/main', '--force-with-lease=' + lease], dir);
  if (r.code === 0) { fetch(dir); return 'ok'; }
  return 'rejected';
}

/** Commit everything under .cohdit/ on this copy's main line and push it: fetch, replay onto the shared
 *  main, push, three tries when main keeps moving. Never fails the run: what did not land stays on the
 *  main line for the next landing. Returns the PUSH result or null when nothing changed. */
function commitLedger(dir, message) {
  toMain(dir);
  git(['add', '-A', '--', '.cohdit'], dir, false);
  if (!(git(['status', '--porcelain', '--', '.cohdit'], dir, false) || '').trim()) return null;
  git(['commit', '-q', '-m', message], dir);
  return landMain(dir);
}

/** Push this copy's main line to the shared main. 'ok' | 'rejected' | 'no_remote'. */
function landMain(dir) {
  if (!hasRemote(dir)) return 'no_remote';
  for (let attempt = 0; attempt < 3; attempt++) {
    fetch(dir);
    toMain(dir);
    if (pushMain(dir, fullSha(dir, mainBranch(dir)), remoteMain(dir)) === 'ok') return 'ok';
  }
  return 'rejected';
}

/** Outcome bookkeeping shared by build and try: the run's records into the ledger, committed on the
 *  shared main; the result of that push is itself an event for the next flush. `cur` is the active
 *  run; `said_no_remote` on it keeps "not saved online" to one line per run. */
function land(dir, cur, message) {
  flush(dir, cur.run);
  const result = commitLedger(dir, message);
  if (result && result !== 'no_remote') emit(dir, cur.run, [['PUSH', { branch: 'main', result }]]);
  else if (result === 'no_remote' && !cur.said_no_remote) { emit(dir, cur.run, [['PUSH', { branch: 'main', result }]]); cur.said_no_remote = true; }
}

function agentModel(name) {
  try {
    const m = /^model:\s*(\S+)/m.exec(fs.readFileSync(path.join(AGENTS, name + '.md'), 'utf8'));
    return m ? m[1] : 'inherit';
  } catch (e) { return 'inherit'; }
}

// --- the run -----------------------------------------------------------------------------------

function active(dir) {
  try { return ml.activeRun(dir); } catch (e) { return null; }
}

function saveActive(dir, cur) {
  cur.beat = ml.utcNow();
  ml.setActiveRun(cur, dir);
}

/** Does this run belong to a session that is still at work? */
function isLive(cur) {
  const last = ml.parseTs(cur.beat || cur.started).getTime();
  return (ml.parseTs(ml.utcNow()).getTime() - last) / 60000 < LIVE_MIN;   // Hatch's clock, which tests pin
}

/** The usage hook finds the working copy that is building by the session that made the call, so two
 *  sessions on one computer each pay for their own run; the plain pointer serves a call with no session. */
function setPointer(dir, run, session) {
  fs.mkdirSync(path.dirname(ml.pointerPath()), { recursive: true });
  const body = JSON.stringify({ path: dir, run, session: session || undefined }) + '\n';
  fs.writeFileSync(ml.pointerPath(), body);
  if (session) fs.writeFileSync(ml.pointerPath(session), body);
}

function clearPointer(dir, session) {
  for (const file of [ml.pointerPath()].concat(session ? [ml.pointerPath(session)] : [])) {
    try {
      const p = ml.readJson(file, null);
      if (!p || !dir || p.path === dir) fs.unlinkSync(file);
    } catch (e) { /* already gone */ }
  }
}

/** A run id unique across sessions and computers: `<UTC>-<host>-<6hex>`, the hex counting this
 *  ledger's runs (file order is run order) followed by two random digits, so two computers with one
 *  hostname starting in the same second never share a run file. */
function newRunId(dir) {
  const runsDir = path.join(cohditDir(dir), 'ledger', 'runs');
  const now = ml.utcNow();
  const known = new Set(ml.listFiles(runsDir, '.jsonl').map((f) => path.basename(f, '.jsonl')));
  for (const r of ml.readJsonl(spoolFile(dir)).recs) known.add(r.r);
  let seq = known.size + 1, run;
  do {
    const hex = (seq++).toString(16).padStart(4, '0').slice(-4) + require('crypto').randomBytes(1).toString('hex');
    run = now.replace(/[-:]/g, '') + '-' + ml.host() + '-' + hex;
  } while (known.has(run));
  return run;
}

function runStart(base, skill) {
  const f = { skill: skill || 'build', plugin: ml.pluginVersion(), host: ml.host(), os: ml.osName() };
  if (base) f.base = base;
  const pricesDate = ml.loadPrices().date;
  if (pricesDate) f.prices = pricesDate;
  return f;
}

/** A run that only records why it could not start, for build (default), try or share. `lead` is any
 *  records that explain the stop (a CHECK), placed before it. Written straight to the ledger; the caller
 *  flushes the spool's blobs and commits when the blob must be readable later. */
function stopBefore(dir, cause, extra, skill, lead) {
  const run = newRunId(dir);
  const table = cz.load();
  const recs = [['RUN_START', runStart(null, skill)]].concat(lead || [], [['STOP', Object.assign({ cause }, extra || {})], ['RUN_END', { outcome: 'stopped' }]])
    .map(([c, f]) => ml.stamp({ c, f: cz.coerce(table, c, f), r: run, ts: ml.utcNow() }));
  ml.appendRecords(path.join(cohditDir(dir), 'ledger', 'runs', run + '.jsonl'), recs);
  return { run, stop: recs.find((r) => r.c === 'STOP'), recs };
}

/** A build run that was abandoned (no call for a day): closed as crashed in the ledger, its picks given
 *  back, its claims released. The caller resets the tree, which is Hatch's. */
function abandon(dir, cur) {
  emit(dir, cur.run, [['RUN_END', { outcome: 'crashed' }]]);
  flush(dir, cur.run);
  for (const o of Object.values(cur.open || {})) releaseClaim(dir, o.branch);
  ml.clearActiveRun(dir);
}

// --- items: what the ledger says, what the shared copy says -----------------------------------------

const TERMINAL = ml.SETTLED;

/** Every record of this project: the committed ledger plus the spool (a live run's records). */
function allRecords(dir) {
  return ml.readLedger(cohditDir(dir)).recs.concat(ml.readJsonl(spoolFile(dir)).recs).filter(Boolean);
}

/** Every item's status from the ledger (every run, every session) plus the spool, by the one rule in
 *  lib/ledger.js: a pick holds the item only while its run is alive; a failed try queues it again. */
function itemStatus(dir, spec) {
  return ml.itemStatus(allRecords(dir), spec.items, ml.utcNow());
}

/** What the person saw the last time this thing did not work, or null. The brief carries it. */
function lastFailNote(dir, item) {
  const fails = allRecords(dir).filter((r) => r.c === 'TRY_RESULT' && r.i === item && r.f && r.f.result === 'fail' && r.f.blob)
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  if (!fails.length) return null;
  const text = ml.readBlob(cohditDir(dir), fails[fails.length - 1].f.blob, dir);
  return text ? text.trim() : null;
}

function branchFor(it) {
  return 'item/' + it.id.slice(-3) + '-' + sp.slugify(it.title).slice(0, 30).replace(/-+$/, '');
}

/** Claims on the shared copy: item branch → {sha, age_h}. Empty without a remote. */
function remoteClaims(dir) {
  const out = new Map();
  if (!hasRemote(dir)) return out;
  const lines = (git(['for-each-ref', '--format=%(refname:short) %(objectname) %(committerdate:iso-strict)', 'refs/remotes/origin/item/'], dir, false) || '').split('\n').filter(Boolean);
  for (const l of lines) {
    const [ref, sha, date] = l.split(' ');
    out.set(ref.replace(/^origin\//, ''), { sha, age_h: ml.hoursBetween(ml.parseTs(ml.utcNow()), ml.parseTs(date)) });
  }
  return out;
}

/** The items build may dispatch now: queued or set aside by nobody, not a device check, dependencies
 *  done, and not claimed by a live session elsewhere. */
function candidates(dir, spec, status, claims) {
  const st = status || itemStatus(dir, spec);
  const cl = claims || remoteClaims(dir);
  const done = new Set([...st.entries()].filter(([, s]) => s === 'done' || s === 'tried').map(([id]) => id));
  return spec.items.filter((i) => {
    if (st.get(i.id) !== 'queued' || i.device) return false;
    if (!(i.depends || []).every((d) => done.has(d))) return false;
    const c = cl.get(branchFor(i));
    return !c || c.age_h >= STALE_CLAIM_H;
  });
}

/** The item's branch, on `base`, opened with a dated start commit: the claim's age is the age of that
 *  commit, not of main's tip, and every `build commit` refreshes it. Returns the start commit's sha. */
function startItem(dir, branch, base, item) {
  git(['checkout', '-q', '-B', branch, base], dir);
  git(['commit', '-q', '--allow-empty', '-m', 'Hatch: ' + item + ' started'], dir);
  return fullSha(dir, 'HEAD');
}

/** Claim an item on the shared copy: push its branch with a lease. 'ok' | 'taken' (someone else holds
 *  it) | 'failed' (the shared copy could not be reached) | 'no_remote'. */
function claim(dir, branch, stale) {
  if (!hasRemote(dir)) return 'no_remote';
  const lease = 'refs/heads/' + branch + ':' + (stale ? stale.sha : '');
  const r = gitNet(['push', '-q', 'origin', 'refs/heads/' + branch + ':refs/heads/' + branch, '--force-with-lease=' + lease], dir);
  if (r.code === 0) return 'ok';
  return /\[rejected\]|stale info|fetch first/i.test(r.err) ? 'taken' : 'failed';   // "[remote rejected]" is the server refusing: failed
}

/** Work committed on an item that is set aside is kept, never deleted: its branch is saved as
 *  `kept/<name>` here and on the shared copy (outside `item/`, so it is never read as a claim).
 *  Returns that name, or null when nothing was committed past the start mark. */
function keepWork(dir, o) {
  const from = o.start || o.base;
  if (!from || !fullSha(dir, o.branch)) return null;
  const n = git(['rev-list', '--count', from + '..' + o.branch], dir, false);
  if (!n || n === '0') return null;
  const name = 'kept/' + o.branch.replace(/^item\//, '');
  git(['branch', '-q', '-f', name, o.branch], dir, false);
  if (hasRemote(dir)) gitNet(['push', '-q', '-f', 'origin', 'refs/heads/' + name + ':refs/heads/' + name], dir);
  return name;
}

function releaseClaim(dir, branch) {
  if (hasRemote(dir)) gitNet(['push', '-q', 'origin', '--delete', branch], dir);
}

/** The maker's note for the try checklist, one file per item so sessions never collide. */
function writeNote(dir, item, text) {
  fs.mkdirSync(notesDir(dir), { recursive: true });
  fs.writeFileSync(path.join(notesDir(dir), item + '.txt'), String(text).trim() + '\n');
}

function readNote(dir, item) {
  try { return fs.readFileSync(path.join(notesDir(dir), item + '.txt'), 'utf8').trim() || null; } catch (e) { return null; }
}

// --- scaffold and the shared copy ---------------------------------------------------------------

/** The first version's skeleton, from stack.json's scaffold entry; COHDIT_FAKE_SCAFFOLD writes a stub
 *  so tests never touch the network. Returns true when it ran. */
function scaffold(dir, spec, cfg) {
  if (fs.existsSync(path.join(dir, 'package.json'))) return false;
  const sc = sp.loadStack().scaffold || {};
  if (process.env.COHDIT_FAKE_SCAFFOLD) {
    fs.mkdirSync(path.join(dir, 'app'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: spec.slug, private: true, scripts: { test: 'node -e 0', build: 'node -e 0', dev: 'node server.js' } }, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'app', 'page.tsx'), 'export default function Page() { return null; }\n');
    // a stand-in for the framework's dev server: answers on the port and host it is given
    fs.writeFileSync(path.join(dir, 'server.js'), "const a = process.argv; const port = Number(a[a.indexOf('-p') + 1]); const host = a[a.indexOf('-H') + 1];\n"
      + "if (process.env.COHDIT_FAKE_DEV === 'die') process.exit(1);\n"
      + "require('http').createServer((q, s) => s.end('ok')).listen(port, host, () => console.log('ready on ' + host + ':' + port));\n");
  } else {
    // staged beside the project, on the same volume, so the move into place is a rename and never a copy
    const tmp = fs.mkdtempSync(path.join(path.dirname(dir), '.hatch-scaffold-'));
    const args = (sc.args || []).map((a) => a.replace('{name}', 'app'));
    let r;
    try {
      r = doc.realRun(sc.command || 'npx', args, { cwd: tmp, timeout: LONG_MS });
      if (r.code !== 0) throw new Invalid('scaffold failed: ' + (r.err || r.out).trim().split('\n').slice(-3).join(' '));
      const src = path.join(tmp, 'app');
      for (const name of fs.readdirSync(src)) {
        if (name === '.git') continue;
        const from = path.join(src, name), to = path.join(dir, name);
        if (name === '.gitignore' && fs.existsSync(to)) { fs.appendFileSync(to, fs.readFileSync(from, 'utf8')); continue; }
        if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
        fs.renameSync(from, to);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    const installs = [['--save-dev', sc.test_packages || []], ['--save', sc.packages || []]].filter(([, list]) => list.length);
    for (const [flag, list] of installs) {
      const i = doc.realRun('npm', ['install', flag, '--no-audit', '--no-fund'].concat(list), { cwd: dir, timeout: LONG_MS });
      if (i.code !== 0) throw new Invalid('installing the packages failed: ' + (i.err || '').trim().split('\n').slice(-2).join(' '));
    }
    const pkgFile = path.join(dir, 'package.json');
    const pkg = ml.readJson(pkgFile, {});
    pkg.scripts = Object.assign({}, pkg.scripts, sc.scripts || {});
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
    for (const f of Object.keys(sc.files || {})) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), sc.files[f].split('{name}').join(spec.name));
    }
    const gi = path.join(dir, '.gitignore');
    const have = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
    const missing = (sc.gitignore || []).filter((l) => !have.split('\n').includes(l));
    if (missing.length) fs.appendFileSync(gi, (have && !have.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n');
  }
  if (sc.coverage_min) cfg.coverage_min = sc.coverage_min;
  cfg.verify = cfg.verify || DEFAULT_VERIFY;
  cfg.caps = Object.assign({}, DEFAULT_CAPS, cfg.caps || {});
  saveCfg(dir, cfg);
  git(['add', '-A'], dir);
  git(['commit', '-q', '-m', 'Hatch: the first version, skeleton'], dir);
  return true;
}

/** A private repository in the person's own GitHub account, named after the idea and marked with the
 *  Hatch topic; a taken name gets -2, -3 … Returns 'ok' | 'rejected' | 'no_remote', or null when there
 *  already was a shared copy (nothing to say). */
function ensureRepo(dir, spec, cfg, run) {
  if (hasRemote(dir)) return null;
  const r = run || doc.runner();
  if (doc.probe('gh_auth', r) !== 'ok') return 'no_remote';
  const login = doc.who('gh_auth', r);
  if (!login) return 'no_remote';
  let name = spec.slug, n = 2;
  while (r(doc.gh(), ['repo', 'view', login + '/' + name]).code === 0) name = spec.slug + '-' + n++;
  const c = r(doc.gh(), ['repo', 'create', login + '/' + name, '--private', '--source=.', '--remote=origin', '--push'], { cwd: dir, timeout: LONG_MS });
  if (c.code !== 0) return 'rejected';
  r(doc.gh(), ['repo', 'edit', login + '/' + name, '--add-topic', TOPIC], { cwd: dir, timeout: NET_MS });
  cfg.connectors = Object.assign({}, cfg.connectors, { github: { repo: login + '/' + name } });
  saveCfg(dir, cfg);
  const reg = sp.registry();
  for (const p of reg.projects) if (p.path === dir) p.repo = login + '/' + name;
  sp.saveRegistry(reg);
  return 'ok';
}

/** An idea this computer has never seen: find its repository in the person's account by name and
 *  fetch it into ~/Hatch. Returns the folder, or null when nothing matches. */
function fetchIdea(name, run) {
  const r = run || doc.runner();
  if (doc.probe('gh_auth', r) !== 'ok') return null;
  const login = doc.who('gh_auth', r);
  const list = r(doc.gh(), ['repo', 'list', login, '--topic', TOPIC, '--json', 'name,nameWithOwner,url', '--limit', '200'], { timeout: NET_MS });
  if (list.code !== 0) return null;
  let repos;
  try { repos = JSON.parse(list.out); } catch (e) { return null; }
  const want = sp.slugify(name);
  const hit = repos.find((x) => x.name === want);
  if (!hit) return null;
  const dir = path.join(sp.homeDir(), 'Hatch', hit.name);
  if (!fs.existsSync(dir)) {
    const c = gitNet(['clone', '-q', hit.url, dir], path.join(sp.homeDir()));
    if (c.code !== 0) throw new Invalid('could not fetch ' + hit.nameWithOwner + ': ' + c.err.split('\n').pop());
  }
  const spec = ml.readJson(sp.specPath(dir), null);
  if (!spec) throw new Invalid(hit.nameWithOwner + ' holds no idea');
  const reg = sp.registry();
  reg.projects = reg.projects.filter((p) => p.path !== dir);
  reg.projects.push({ name: spec.name, slug: spec.slug, path: dir, repo: hit.nameWithOwner, created: ml.utcNow() });
  sp.saveRegistry(reg);
  return dir;
}

function workDir() { return path.join(sp.homeDir(), 'Hatch', '.work'); }

/** A second session on this computer: its own working copy of the same idea, beside the first, on a
 *  main-line branch of its own. */
function sideCopy(primary, spec) {
  fs.mkdirSync(workDir(), { recursive: true });
  let n = 2, dir;
  do { dir = path.join(workDir(), spec.slug + '-' + n++); } while (fs.existsSync(dir));
  fetch(primary);
  const at = remoteMain(primary) || fullSha(primary, 'main');
  git(['worktree', 'prune'], primary, false);                     // a copy deleted by hand is forgotten first
  git(['worktree', 'add', '-q', '-B', 'hatch/' + path.basename(dir), dir, at], primary);
  return dir;
}

/** Side copies whose run is over but whose last landing did not reach the shared main (the connection
 *  was down at close): land them now from the primary, then remove them. Never throws. */
function sweepSideCopies(primary, spec) {
  let names = [];
  try { names = fs.readdirSync(workDir()); } catch (e) { return; }
  for (const name of names) {
    if (!name.startsWith(spec.slug + '-')) continue;
    const dir = path.join(workDir(), name);
    try {
      if (ml.repoRoot(dir) !== ml.repoRoot(primary)) continue;
      const cur = active(dir);
      if (cur) {                                                 // a run still open here: alive, or abandoned long ago
        if (ml.hoursBetween(ml.parseTs(ml.utcNow()), ml.parseTs(cur.started)) <= ml.STALE_RUN_H) continue;
        emit(dir, cur.run, [['RUN_END', { outcome: 'crashed' }]]);
        flush(dir, cur.run);
        for (const o of Object.values(cur.open || {})) releaseClaim(dir, o.branch);
        ml.clearActiveRun(dir);
        git(['add', '-A', '--', ml.COHDIT_DIR], dir, false);
        git(['commit', '-q', '-m', 'Hatch: ledger'], dir, false);
      }
      if (landMain(dir) === 'rejected') continue;                // still unreachable: another day
      removeSideCopy(dir);
    } catch (e) { /* not a working copy of this idea */ }
  }
}

/** The side copy this session was already building in, so "continue" in a second window finds its own
 *  run instead of opening a third copy. Null when there is none. */
function findSideCopy(spec, session) {
  if (!session) return null;
  let names = [];
  try { names = fs.readdirSync(workDir()); } catch (e) { return null; }
  for (const name of names) {
    if (!name.startsWith(spec.slug + '-')) continue;
    const dir = path.join(workDir(), name);
    const cur = active(dir);
    if (cur && cur.skill === 'build' && cur.session === session) return dir;
  }
  return null;
}

/** A side copy's job is over: the working copy and its main-line branch go. */
function removeSideCopy(dir) {
  const root = ml.repoRoot(dir);
  const mb = mainBranch(dir);
  git(['worktree', 'remove', '--force', dir], root, false);
  git(['branch', '-q', '-D', mb], root, false);
}

// --- the brief the maker reads -------------------------------------------------------------------

/** The clause from docs/CONTRACTS.md § Refusals, carried in rails.json so an installed plugin has it
 *  (check.sh asserts the two are identical). */
function refusalClause() {
  return cz.loadRails().refusal_clause || 'Cohdit does not build apps in a refused category. State the refusal once, in the fixed sentence, and stop.';
}

function hatchCmd() { return 'node "' + path.join(ml.SCRIPTS, 'hatch.js') + '"'; }

function brief(dir, spec, item, cfg, notes, status, advice) {
  const it = spec.items.find((i) => i.id === item);
  const rails = cz.loadRails().rule || {};
  const stack = sp.loadStack();
  const st = status || itemStatus(dir, spec);
  const H = hatchCmd() + ' build';
  const bug = it.kind === 'bug';
  const out = [];
  out.push('# ' + (bug ? 'Fix one bug' : 'Build one thing') + ': "' + it.title + '" (' + it.id + ')', '');
  out.push('Folder: ' + dir, 'You are on the branch for this thing. Edit files in that folder only.', '');
  out.push('## The idea', spec.name + (spec.for ? ' — for ' + spec.for : '') + (spec.anchor ? '. Worked: ' + spec.anchor : '') + '.');
  if (spec.pitch) out.push(spec.pitch);
  out.push('', bug ? '## The bug, and what must be true once it is fixed' : '## This thing, and how the person will check it');
  for (const c of it.criteria || []) out.push('- ' + c);
  if (bug) out.push('(' + (it.source === 'report' ? 'The person using the app reported this.' : 'The ' + (it.by || 'review') + ' found this on a scan.') + ' Write the failing test first; the fix is the minimum that makes it pass.)');
  if (it.source === 'inferred') out.push('(Hatch inferred this thing from what the person said; keep it minimal.)');
  const tried = lastFailNote(dir, item);
  if (tried) out.push('', '## When they tried it', 'The person tried this thing and said, in their words: ' + tried, 'Make that true as well as the checks above; it is what they will look for first.');
  out.push('', '## The whole first version (for context; build only the thing above)');
  for (const o of spec.items) out.push('- ' + o.id + ' ' + o.title + (st.get(o.id) !== 'queued' ? ' (' + st.get(o.id) + ')' : '') + (o.device ? ' (a device check, not built)' : ''));
  if ((spec.out || []).length) out.push('', 'Not in the first version: ' + spec.out.join(', ') + '.');
  if ((spec.rails || []).length) {
    out.push('', '## Rules attached to this idea');
    for (const r of spec.rails) if (rails[r]) out.push('- ' + r + ': ' + rails[r].build);
  }
  const bank = ls.load();
  const about = [it.title].concat(it.criteria || [], spec.rails || [], [spec.pitch || '', spec.name || '', tried || '']).join(' ');
  const forMaker = ls.select(bank, 'maker', about);
  const forChecker = ls.select(bank, 'checker', about);
  const count = (s) => s.matched.length + s.general.length;
  if (count(forMaker) + count(forChecker)) {
    out.push('', '## Lessons', 'How Cohdit builds. Each one holds like a rule attached.');
    out.push(...ls.lines(forMaker));
    if (count(forChecker)) out.push('', 'For the review (the checker judges these):', ...ls.lines(forChecker));
  }
  out.push('', '## Technology', 'Only what is on this list. Anything else is a decision you do not take: leave it out and say so in `findings`.');
  for (const cap of Object.keys(stack.capabilities || {})) {
    for (const k of Object.keys(stack.capabilities[cap].options || {})) {
      const o = stack.capabilities[cap].options[k];
      out.push('- ' + cap + ': ' + o.name + (o.npm && o.npm.length ? ' (packages: ' + o.npm.join(', ') + ')' : '') + (o.note ? ' — ' + o.note : ''));
    }
  }
  out.push('', '## The only commands you run', 'Everything else you do is reading and editing files. Run each exactly as written, on its own: no `cd` before it, nothing after it, no redirect.');
  out.push('- `' + H + ' verify --dir "' + dir + '"` runs the checks: ' + cfg.verify);
  out.push('- `' + H + ' commit --dir "' + dir + '" -m "<what changed>"` runs the checks and commits only when they pass. This is the only way to commit.');
  out.push('- `' + H + ' add <package> --dir "' + dir + '"` installs a package from the list above. Nothing else can be installed.');
  out.push('', '## Proof', 'Every check is proved by a test you can name in `criteria[].test`: a unit test where one fits, an integration test through the route or the data when the check crosses them. The gate refuses a commit under ' + (cfg.coverage_min || 0) + '% coverage' + (cfg.coverage_min ? '' : ' (not measured on this project)') + '. A problem-report page lives at /report (components/ReportLink.tsx links it); keep the link reachable from every page you add.');
  out.push('', '## Deciding', 'A choice where every option passes the check is yours: take the simplest, record it in `decisions`. Words the person must write: draft them, and say so in `try_note` so they read them when they try it. Block only on a fact about the idea you cannot know, or something you cannot reach.');
  out.push('', '## Asking a colleague', 'Once per thing, when a design question would otherwise be a guess, return `verdict: consult` with `consult: {role, question}`; the role is one of ' + ROLES.join(', ') + '. The answer comes back in this brief and you carry on where you were. Never for a fact only the person knows: that is `blocked`.');
  if (advice) out.push('', '## The ' + advice.role + "'s answer", 'You asked: ' + advice.question, '', advice.answer);
  out.push('', '## Never', refusalClause());
  if (notes && notes.length) {
    out.push('', '## The review asked for these changes');
    for (const n of notes) out.push('- ' + n);
  }
  out.push('', '## Return', 'Your final message is exactly one fenced JSON block, nothing else (docs/CONTRACTS.md § Agents):',
    '```json', '{"verdict":"done|blocked|refused|consult","change":"copy|style|docs|test-only|logic|config|mixed",',
    ' "criteria":[{"n":1,"met":true,"ref":"app/page.tsx:41","test":"app/page.test.tsx:9"}],', ' "blocked":null,', ' "refused":null,', ' "consult":null,',
    ' "decisions":[{"type":"design","choice":"fox_for_x"}],', ' "try_note":null,',
    ' "findings":[{"scope":"in|out","sev":"low|medium|high|critical","text":"…"}]}', '```',
    'Limits the script enforces: `decisions[].choice` is a short slug of letters, digits and `. _ / : @ -`, at most 96 characters, no spaces or punctuation (the detail goes in `findings` or `try_note`). `criteria[].test` is exactly one test file path, optionally `:line`; other files go in `ref`.');
  return out.join('\n') + '\n';
}

/** The whole-project brief every lens reads on a scan: no diff, the project as it stands. */
function scanBrief(dir, spec, cfg) {
  const out = ['# Scan the whole project: "' + spec.name + '"', '', 'Folder: ' + dir, 'There is no diff. Read the project as it stands and judge it through your lens alone.', ''];
  out.push('## The idea', spec.name + (spec.pitch ? ' — ' + spec.pitch : ''), '');
  out.push('## The things it is made of');
  for (const o of spec.items) out.push('- ' + o.id + ' ' + o.title + (o.kind === 'bug' ? ' (a bug already queued)' : ''));
  out.push('', '## Rules attached to this idea');
  const rails = cz.loadRails().rule || {};
  for (const r of spec.rails || []) if (rails[r]) out.push('- ' + r + ': ' + rails[r].build);
  if (!(spec.rails || []).length) out.push('(none)');
  out.push('', '## Return', 'Exactly one fenced JSON block in the checker\'s shape: `{"verdict":"pass|fail","must_fix":[{"n":0,"ref":"path:line","text":"…"}],"nits":0}`.',
    'Each must_fix becomes one bug in the queue, in the words you write: say where, what is wrong, and what fixed looks like, in one sentence a builder can act on. Name only what you would refuse to ship; everything else is a nit.');
  return out.join('\n') + '\n';
}

function briefPath(dir, item) { return path.join(ml.spoolDir(dir), 'brief-' + item + '.md'); }
function diffPath(dir, item) { return path.join(ml.spoolDir(dir), 'diff-' + item + '.patch'); }
function consultPath(dir, item) { return path.join(ml.spoolDir(dir), 'consult-' + item + '.md'); }
function scanPath(dir) { return path.join(ml.spoolDir(dir), 'scan.md'); }
function rolePath(dir, name) { return path.join(ml.spoolDir(dir), 'agent-' + name + '.md'); }

// The rules each read-only agent checks, appended to its instructions.
const AGENT_RULES = { checker: 'baseline', 'lens-security': 'baseline', 'lens-privacy': 'baseline', 'lens-cost': 'baseline', 'lens-compliance': 'domains' };

/** A read-only agent has no Bash to fetch its instructions, so they are written next to the brief:
 *  agent-{name}.md holds its body from Cohdit and the rules file it checks. */
function writeRole(dir, name) {
  const parts = [api.agentText(name).split('${CLAUDE_PLUGIN_ROOT}').join(ml.PLUGIN).trim()];
  const rules = AGENT_RULES[name];
  if (rules) parts.push('## The rules (' + rules + '.json)', '```json\n' + api.dataText(rules).trim() + '\n```');
  fs.writeFileSync(rolePath(dir, name), parts.join('\n\n') + '\n');
  return rolePath(dir, name);
}

/** What the advisor reads: the role, the one question, where the brief is. */
function writeConsult(dir, item, consult) {
  fs.writeFileSync(consultPath(dir, item), ['# A question for the ' + consult.role, '', 'Project: ' + dir, 'Brief: ' + briefPath(dir, item), '', '## The question', consult.question, '',
    '## Return', 'Exactly one fenced JSON block: `{"answer":"…"}`, under ' + ANSWER_MAX + ' characters.'].join('\n') + '\n');
  return consultPath(dir, item);
}

// --- validating what the agents return -----------------------------------------------------------

function parseReturn(text) {
  let t = String(text || '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch (e) { throw new Invalid('the report is not one JSON block: ' + e.message); }
}

// A test path is one file, optionally :line. Brackets and parentheses are Next.js routes ([id], (group)).
const TEST_PATH = /^[\w./@+\[\]()-]+(:\d+)?$/;
const CHOICE = /^[A-Za-z0-9._/:@-]{1,96}$/;

/** A maker that listed several files gets the first; the rest belong in `ref`. */
function firstTestPath(v) {
  return String(v).trim().split(/\s*[;,]\s*/)[0] || '';
}

/** A decision choice is a short slug; a sentence is squeezed into one rather than refused. */
function choiceSlug(v) {
  const t = String(v).trim();
  if (CHOICE.test(t)) return t;
  return t.replace(/[^A-Za-z0-9._/:@-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 96).replace(/_+$/, '');
}

function makerReturn(text) {
  const r = parseReturn(text);
  const codes = cz.load().codes;
  const verdicts = ['done', 'blocked', 'refused', 'consult'];
  if (!r || typeof r !== 'object' || !verdicts.includes(r.verdict)) throw new Invalid('verdict must be one of ' + verdicts.join(', '));
  const changes = ['copy', 'style', 'docs', 'test-only', 'logic', 'config', 'mixed'];
  if (r.verdict === 'done' && !changes.includes(r.change)) throw new Invalid('change must be one of ' + changes.join(', '));
  // Side notes (a test path, findings, decisions) never cost the thing: one that does not fit is dropped
  // and named in `dropped`. Only what decides the outcome (verdict, change, the checks) is refused.
  r.dropped = [];
  if (r.criteria !== undefined && !Array.isArray(r.criteria)) throw new Invalid('criteria must be a list');
  for (const c of r.criteria || []) {
    if (!c || !Number.isInteger(c.n) || typeof c.met !== 'boolean') throw new Invalid('each criterion needs n (int) and met (bool)');
    if (c.test !== undefined && c.test !== null) {
      const t = firstTestPath(c.test);
      if (TEST_PATH.test(t)) c.test = t;
      else { r.dropped.push('criterion ' + c.n + ' test (one file path, optionally :line)'); delete c.test; }
    }
  }
  if (r.verdict === 'consult') {
    const q = r.consult || {};
    if (!ROLES.includes(q.role)) throw new Invalid('consult needs role (' + ROLES.join(', ') + ')');
    if (typeof q.question !== 'string' || !q.question.trim()) throw new Invalid('consult needs a question');
    if (q.question.length > QUESTION_MAX) throw new Invalid('consult question is over ' + QUESTION_MAX + ' characters');
  }
  if (r.verdict === 'blocked') {
    const reasons = codes.BLOCKED.fields.reason.enum;
    if (!r.blocked || !reasons.includes(r.blocked.reason) || typeof r.blocked.text !== 'string') throw new Invalid('blocked needs reason (' + reasons.join(', ') + ') and text');
  }
  if (r.verdict === 'refused') {
    const cats = Object.keys(cz.loadRails().refuse || {});
    if (!cats.includes(r.refused)) throw new Invalid('refused must name the category: ' + cats.join(', '));
  }
  const scopes = codes.FINDING.fields.scope.enum, sevs = codes.FINDING.fields.sev.enum;
  r.findings = (Array.isArray(r.findings) ? r.findings : []).filter((f, i) => {
    if (f && typeof f.text === 'string' && f.text.trim()) {
      if (!scopes.includes(f.scope)) f.scope = 'in';
      if (!sevs.includes(f.sev)) f.sev = 'medium';
      return true;
    }
    r.dropped.push('finding ' + (i + 1) + ' (it needs text)');
    return false;
  });
  const types = codes.DECIDE.fields.type.enum.filter((t) => !['terms', 'hosting', 'scope', 'publish', 'stack'].includes(t));
  r.decisions = (Array.isArray(r.decisions) ? r.decisions : []).filter((d, i) => {
    if (d && types.includes(d.type) && typeof d.choice === 'string') {
      d.choice = choiceSlug(d.choice);
      if (CHOICE.test(d.choice)) return true;
    }
    r.dropped.push('decision ' + (i + 1) + ' (type one of ' + types.join(', ') + '; choice in letters, digits and . _ / : @ -)');
    return false;
  });
  if (r.try_note !== undefined && r.try_note !== null && typeof r.try_note !== 'string') { r.dropped.push('try_note (it must be text)'); delete r.try_note; }
  return r;
}

function checkerReturn(text) {
  const r = parseReturn(text);
  if (!r || !['pass', 'fail'].includes(r.verdict)) throw new Invalid('verdict must be pass or fail');
  if (!Array.isArray(r.must_fix)) throw new Invalid('must_fix must be a list');
  for (const m of r.must_fix) {
    if (!m || typeof m.text !== 'string') throw new Invalid('each must_fix needs text');
    if (m.n !== undefined && !Number.isInteger(m.n)) throw new Invalid('must_fix n is the number of the check');
    if (m.ref !== undefined && m.ref !== null && typeof m.ref !== 'string') throw new Invalid('must_fix ref is text');
  }
  if (!Number.isInteger(r.nits) || r.nits < 0) throw new Invalid('nits must be a count');
  if (r.verdict === 'fail' && !r.must_fix.length) throw new Invalid('a fail needs at least one must_fix');
  return r;
}

function advisorReturn(text) {
  const r = parseReturn(text);
  if (!r || typeof r.answer !== 'string' || !r.answer.trim()) throw new Invalid('the advisor returns {"answer": "…"}');
  if (r.answer.length > ANSWER_MAX) throw new Invalid('the answer is over ' + ANSWER_MAX + ' characters');
  return { answer: r.answer.trim() };
}

/** The one risk rule: low when the change is copy or style in a couple of files; high when it reaches
 *  dependencies or an attached rule; standard otherwise. The signals also say which lenses look
 *  (data/lenses.json): the rule keys attached, paid packages, secrets, the network. */
function risk(change, files, spec, diff, deps) {
  const signals = new Set([change]);
  if (files.some((f) => /(^|\/)package(-lock)?\.json$/.test(f))) signals.add('deps');
  if ((spec.rails || []).length) signals.add('rails');
  for (const r of spec.rails || []) if (RAIL_SIGNALS[r]) signals.add(RAIL_SIGNALS[r]);
  const added = String(diff || '').split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
  if (/process\.env\b/.test(added) || files.some((f) => /(^|\/)\.env/.test(f))) signals.add('env');
  if (/\bfetch\(/.test(added)) signals.add('net');
  if ((deps || []).some((d) => PAID_PACKAGES.includes(d)) || /\b(setInterval|cron)\b/.test(added)) signals.add('paid');
  let tier = 'standard';
  if (RISK_LOW_CHANGES.includes(change) && files.length <= RISK_LOW_FILES && !signals.has('deps')) tier = 'low';
  else if (signals.has('deps') || signals.has('rails')) tier = 'high';
  return { tier, signals: [...signals] };
}

function loadLenses() { return api.dataJson('lenses').lenses || {}; }

/** The lenses a change of this risk goes through, in the data file's order. A low-risk change (words or
 *  style in a couple of files) goes straight to the gate; the scan covers it later. */
function lensesFor(r) {
  if (r.tier === 'low') return [];
  const L = loadLenses();
  return Object.keys(L).filter((name) => (L[name].tiers || []).includes(r.tier) || (L[name].signals || []).some((s) => r.signals.includes(s)));
}

/** The names in the project's package.json dependencies. */
function dependencies(dir) {
  const pkg = ml.readJson(path.join(dir, 'package.json'), {});
  return Object.keys(pkg.dependencies || {});
}

/** The lowest of line and branch coverage from the test run's summary, or null when none was written. */
function coverage(dir) {
  const s = ml.readJson(path.join(dir, 'coverage', 'coverage-summary.json'), null);
  const t = s && s.total;
  if (!t || !t.lines) return null;
  const pcts = [t.lines, t.branches].filter((k) => k && typeof k.pct === 'number').map((k) => k.pct);
  return pcts.length ? Math.floor(Math.min(...pcts)) : null;
}

module.exports = {
  Invalid, DEFAULT_CAPS, DEFAULT_VERIFY, LONG_MS, NET_MS, LIVE_MIN, STALE_CLAIM_H, TOPIC, AGENTS, TERMINAL,
  cohditDir, notesDir, readCfg, saveCfg, level, blob, emit, spoolFile, flush,
  git, gitNet, hasRemote, headSha, fullSha, currentBranch, isPrimary, mainBranch, resetTree, dirtyPaths, fetch, remoteMain, toMain, rebaseOnto, fastForward, baseSha, startBase, keepWork, pushMain, commitLedger, landMain, land, agentModel,
  active, saveActive, isLive, setPointer, clearPointer, newRunId, runStart, stopBefore, abandon,
  allRecords, itemStatus, lastFailNote, branchFor, remoteClaims, candidates, startItem, claim, releaseClaim, writeNote, readNote,
  scaffold, ensureRepo, fetchIdea, workDir, sideCopy, findSideCopy, removeSideCopy, sweepSideCopies, brief, scanBrief, briefPath, diffPath, consultPath, scanPath, rolePath, writeRole, writeConsult, hatchCmd, refusalClause,
  parseReturn, makerReturn, checkerReturn, advisorReturn, risk, loadLenses, lensesFor, dependencies, coverage, ROLES,
};

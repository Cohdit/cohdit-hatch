#!/usr/bin/env node
'use strict';
/**
 * hatch.js — the one script a skill calls, so one permission covers everything Hatch does.
 *
 *   hatch.js setup                      check this computer, fix what Hatch can itself, say what is left
 *   hatch.js doctor                     the checks only; one `name=state` line each; exit 1 if any needs a person
 *   hatch.js wait <name> [--minutes N]  wait for a capability to appear (default 10); exit 3 on timeout
 *   hatch.js connect github|vercel [--switch]
 *                                       start the sign-in in the background; prints code= and url= to relay.
 *                                       --switch signs the current account out first.
 *   hatch.js level [plain|product|tech] show or set how Hatch talks (~/.cohdit/settings.json)
 *   hatch.js idea new <name> [--dir d]  start an idea: folder, draft, registry; begins the dream run
 *   hatch.js idea set [--dir d] --json <patch|->
 *   hatch.js idea change [--dir d] --json <patch|->   (agreed idea: add, edit, decisions, out, open_questions)
 *   hatch.js idea reopen [--dir d]                    (agreed idea: back to the interview, agree again)
 *                                       record what the interview learned; prints the one-line shape so far
 *   hatch.js idea show [--dir d] [--full]
 *                                       the shape so far, or the full read-back (--full)
 *   hatch.js idea agree [--dir d] [--hosting <key>] [--stack a,b]
 *                                       the person said yes: terms, hosting, scope, SPEC; ends the run
 *   hatch.js idea refuse <category> [--dir d]
 *   hatch.js idea terms                 the terms text, for "read me the terms"
 *   hatch.js build open [--dir d | --name n]
 *                                       start (or resume) the unattended run: checks, skeleton, GitHub
 *   hatch.js build next                 pick the next thing; writes the maker's brief (item= brief= on stderr)
 *   hatch.js build verify               run the checks (the maker calls this)
 *   hatch.js build commit -m <msg>      the gate: checks, then commit only on pass (the maker's only way)
 *   hatch.js build add <package>        install one package from stack.json (the maker's only way)
 *   hatch.js build built <ITEM> --return <json|->
 *                                       the maker's report: risk, then the lenses (agents= on stderr), the advisor, or the gate
 *   hatch.js build checked <ITEM> --agent <lens> --return <json|->
 *                                       one lens's report; when every lens asked has reported: gate, fix round, or set aside
 *   hatch.js build advised <ITEM> --return <json|->
 *                                       the advisor's answer; the maker carries on with it in its brief
 *   hatch.js build close                end the run: ledger, digest; next=try
 *   hatch.js fix open [--dir d | --name n]
 *                                       pull the app's problem reports onto the list, then set every lens on the whole project
 *   hatch.js fix found <lens> --return <json|->
 *                                       one lens's findings: each must_fix becomes a bug on the list
 *   hatch.js fix close                  end the run: ledger, digest; next=build when bugs are queued
 *   hatch.js fix every <days|off>       how often a fix run is due; `fix due` says whether one is
 *   hatch.js report add --json <report|->
 *                                       a problem someone told you about: {did, expected, saw}; it joins the list as a bug
 *   hatch.js report pull                the live app's reports, onto the list
 *   hatch.js try start [--dir d | --name n]
 *                                       start the app on this computer, open it, print the checklist
 *   hatch.js try result <which> pass|fail [--note <text|->]
 *                                       one thing's verdict; <which> is its number, id or title
 *   hatch.js try pass                   everything left passes (device checks excepted); ends the try
 *   hatch.js try stop                   end the try as it stands: the app stops, the digest prints
 *   hatch.js share open [--dir d | --name n]
 *                                       the gate (tried? signed in? clean?), the run, the one question
 *   hatch.js share go                   the yes: record it, deploy to production, wait, print the link
 *   hatch.js share wait                 wait again on a deploy still building
 *   hatch.js share later                the no: record it, end the run
 *   hatch.js remember add --json <lesson|->
 *                                       lock one lesson into the bank: {gist, for?, tags?, detail?}; prints its line
 *   hatch.js remember set <L-NNN> --json <patch|->
 *                                       change a lesson; prints its line
 *   hatch.js remember drop <L-NNN>      remove a lesson
 *   hatch.js remember list [--for <reader>]
 *                                       the bank, one line each: what every brief draws on
 *   hatch.js remember show <L-NNN>      the whole lesson
 *   hatch.js leader [--for <reader>] [--expert <slug>]
 *                                       the software leader's knowledge as text (ask: all; dream: --for dream);
 *                                       --expert: another agent the person owns
 *   hatch.js experts [--fresh] [--json] the agents this key has, and those it could add (--json: for playbooks)
 *   hatch.js experts offer <slug>       offer one agent for this idea, once ever per idea; prints the offer and link
 *   hatch.js experts link <slug>        a fresh link to add an agent
 *   hatch.js experts ask <slug> --return -
 *                                       one free question (stdin) to an agent the key does not own
 *   hatch.js experts check              after a purchase: an offered agent now owned joins the idea
 *   hatch.js experts use|stop <slug>    this idea uses an owned agent, or stops (never during a build)
 *   hatch.js experts manage             the billing page link
 *   hatch.js allow                      PreToolUse hook: approves Hatch's own calls and edits in its own folders
 *   hatch.js content skill|agent|data <name>
 *                                       the text, from Cohdit with the access key (lib/api.js); an error line
 *                                       for the person and exit 1 when it cannot
 *   hatch.js key set <key>              store the access key on this computer and prove it; prints ok or why not
 *   hatch.js key status                 ok, missing, or the error code; never prints the key
 *
 * stdout is what the person reads (render.js output, verbatim). stderr carries `key=value` hints
 * for the model: next=<capability> · hint=<word> · level=<level>. The model never writes a sentence
 * about state that did not come from stdout.
 *
 * Setup fixes what it can before it looks: it fetches the GitHub tool into ~/.cohdit/bin when the
 * computer has none (lib/tools.js), fetches the publishing tool through npx, installs the secret
 * guard, and sets a git identity from GitHub once signed in. Its run goes to the machine ledger,
 * ~/.cohdit/ledger/runs/, through the same validation as every other event (docs/CONTRACTS.md
 * § Events). COHDIT_HOME moves ~ for tests. A wait is at most 9 minutes, under Claude Code's limit
 * for one call; the skill repeats it.
 *
 * Exit: 0 ok · 1 something still needs the person · 2 no run · 3 timed out · 5 refused · 11 sign-in did
 * not start · 64 bad call.
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const ml = require('./lib/ledger');
const cz = require('./lib/codes');
const doc = require('./lib/doctor');
const tools = require('./lib/tools');
const sp = require('./lib/spec');
const bd = require('./lib/build');
const tr = require('./lib/try');
const sh = require('./lib/share');
const ls = require('./lib/lessons');
const ld = require('./lib/leader');
const api = require('./lib/api');
const render = require('./render');

const USAGE = fs.readFileSync(__filename, 'utf8').split('/**')[1].split('*/')[0].replace(/^ \* ?/gm, '');
const POLL_MS = 5000;
const WAIT_MAX_MINUTES = 9;
const CONNECT_WAIT_MS = 45000;
const CODE_RE = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/;
const URL_RE = /https:\/\/[^\s'"]+/;

function hint(k, v) {
  process.stderr.write(k + '=' + v + '\n');
}

function fail(message) {
  process.stderr.write('hatch: ' + message + '\n');
  return 64;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** A new run id for a ledger: the 4-hex suffix counts that ledger's runs, so file order is run
 *  order even within one second. */
function newRunId(runsDir, now) {
  let seq = ml.listFiles(runsDir, '.jsonl').length + 1, run;
  do { run = now.replace(/[-:]/g, '') + '-' + ml.host() + '-' + (seq++).toString(16).padStart(4, '0'); } while (fs.existsSync(path.join(runsDir, run + '.jsonl')));
  return run;
}

/** Append validated events to a run file. `events` is [[code, fields], …]. */
function appendEvents(cohditDir, run, events) {
  const table = cz.load();
  const recs = events.map(([c, f]) => ({ c, f: cz.coerce(table, c, f), r: run, ts: ml.utcNow() }));
  ml.appendRecords(path.join(cohditDir, 'ledger', 'runs', run + '.jsonl'), recs);
}

function runStart(skill) {
  const f = { skill, plugin: ml.pluginVersion(), host: ml.host(), os: ml.osName() };
  const pricesDate = ml.loadPrices().date;
  if (pricesDate) f.prices = pricesDate;
  return f;
}

/** Write one finished setup run to the machine ledger. Returns the run id. */
function writeSetupRun(results) {
  const table = cz.load();
  const now = ml.utcNow();
  const dir = path.join(doc.cohditHome(), 'ledger', 'runs');
  const run = newRunId(dir, now);
  const start = runStart('setup');
  const recs = [{ c: 'RUN_START', f: cz.coerce(table, 'RUN_START', start), r: run, ts: now }];
  for (const x of results) {
    const f = { name: x.name, state: x.state };
    if (x.who) f.who = x.who;
    recs.push({ c: 'CHECK', f: cz.coerce(table, 'CHECK', f), r: run, ts: ml.utcNow() });
  }
  recs.push({ c: 'RUN_END', f: cz.coerce(table, 'RUN_END', { outcome: 'ok' }), r: run, ts: ml.utcNow() });
  ml.appendRecords(path.join(dir, run + '.jsonl'), recs);
  return run;
}

async function cmdSetup() {
  const run = doc.runner();
  const level = doc.ensureSettings();
  // What Hatch fixes itself, before it looks: the GitHub tool (its own copy, no admin, no PATH), the
  // publishing tool (fetched by npx), the secret guard, and a git identity once GitHub is signed in.
  if (!process.env.COHDIT_PROBES && doc.probe('gh', run) !== 'ok') await tools.fetchGh();
  run(doc.VERCEL[0], doc.VERCEL.slice(1).concat(['--version']));
  if (!doc.guardInstalled() && doc.installGuard() === 'taken') hint('hint', 'hookspath_taken');
  const results = doc.checks(run);
  if (results.some((x) => x.name === 'gh_auth' && x.state === 'ok')) doc.ensureIdentity(run);
  if (results.some((x) => x.name === 'vercel_auth' && x.state === 'ok')) {
    const teams = doc.teams(run);                                  // for dream: a team is offered only when the tool lists one
    if (teams.length) hint('teams', teams.join(','));
  }
  const id = writeSetupRun(results);
  render.main(['digest', '--cohdit', doc.cohditHome(), '--run', id, '--level', level]);
  hint('level', level);
  const nxt = doc.next(results);
  if (nxt) {
    hint('next', nxt);
    return 1;
  }
  return 0;
}

function cmdDoctor() {
  const results = doc.checks();
  for (const x of results) process.stdout.write(x.name + '=' + x.state + '\n');
  return doc.next(results) ? 1 : 0;
}

function cmdWait(argv) {
  const name = argv[0];
  if (!name || !doc.ORDER.includes(name)) return fail('wait needs one of ' + doc.ORDER.join(', '));
  let minutes = WAIT_MAX_MINUTES;
  const mi = argv.indexOf('--minutes');
  if (mi >= 0) minutes = Number(argv[mi + 1]);
  if (!(minutes > 0)) return fail('--minutes needs a number');
  minutes = Math.min(minutes, WAIT_MAX_MINUTES);
  const run = doc.runner();
  const deadline = Date.now() + minutes * 60000;
  for (;;) {
    if (doc.probe(name, run) === 'ok') {
      process.stdout.write(name + '=ok\n');
      return 0;
    }
    if (Date.now() >= deadline || process.env.COHDIT_PROBES) break;   // under test, one pass is the answer
    sleep(POLL_MS);
  }
  process.stdout.write(name + '=waiting\n');
  hint('hint', name === 'node' || name === 'git' || name === 'gh' ? 'restart' : 'again');
  return 3;
}

/** Start a sign-in in the background, wait for it to print its code or URL, relay them, return. The
 *  command itself keeps running until the browser finishes; `wait <name>_auth` watches for that.
 *  --switch signs the current account out first, so the browser can pick another. */
function cmdConnect(argv) {
  const what = argv[0];
  const run = doc.runner();
  let cmd, args, waitFor;
  if (what === 'github') {
    cmd = doc.gh(); args = ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web']; waitFor = 'gh_auth';
    if (argv.includes('--switch')) {
      const results = doc.checks(run).filter((x) => x.name === 'gh_auth');
      const user = results.length && results[0].who ? ['--user', results[0].who] : [];
      run(cmd, ['auth', 'logout', '--hostname', 'github.com'].concat(user));
    }
  } else if (what === 'vercel') {
    cmd = doc.VERCEL[0]; args = doc.VERCEL.slice(1).concat(['login']); waitFor = 'vercel_auth';
    if (argv.includes('--switch')) run(cmd, doc.VERCEL.slice(1).concat(['logout']));
  } else {
    return fail('connect needs github or vercel');
  }
  const logDir = doc.cohditHome();
  fs.mkdirSync(logDir, { recursive: true });
  const log = path.join(logDir, 'connect-' + what + '.log');
  fs.writeFileSync(log, '');
  if (process.env.COHDIT_PROBES) {                      // tests: the fake runner stands in for the browser
    const r = doc.runner()(cmd, args);
    fs.writeFileSync(log, r.out + r.err);
  } else {
    const fd = fs.openSync(log, 'a');
    const env = Object.assign({}, process.env, { PATH: tools.pathWithExtras() });
    const child = spawn(cmd, args, { detached: true, stdio: ['pipe', fd, fd], env, shell: process.platform === 'win32' && !path.isAbsolute(cmd) });
    child.on('error', (e) => fs.appendFileSync(log, 'hatch: could not start ' + cmd + ': ' + e.message + '\n'));
    child.stdin.end('\n');                               // "Press Enter to open the browser"
    child.unref();
  }
  const deadline = Date.now() + CONNECT_WAIT_MS;
  let text = '';
  for (;;) {
    text = fs.readFileSync(log, 'utf8');
    if (CODE_RE.test(text) || URL_RE.test(text) || /could not start|error|requires/i.test(text)) break;
    if (Date.now() >= deadline || process.env.COHDIT_PROBES) break;
    sleep(1000);
  }
  const code = CODE_RE.exec(text), url = URL_RE.exec(text);
  if (code) process.stdout.write('code=' + code[1] + '\n');
  if (url) process.stdout.write('url=' + url[0] + '\n');
  if (!code && !url) {
    hint('hint', 'signin_not_started');
    hint('log', log);
    return 11;
  }
  hint('wait', waitFor);
  return 0;
}

// --- the idea -----------------------------------------------------------------------------------

function opt(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function hasOpt(argv, name) { return argv.includes(name); }

/** Positional words of argv (everything that is not an option or an option's value). */
function words(argv, valued) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { if (valued.includes(argv[i])) i++; continue; }
    out.push(argv[i]);
  }
  return out;
}

function readPatch(argv) {
  const j = opt(argv, '--json');
  if (j === undefined) throw new sp.Invalid('idea set needs --json <patch> or --json -');
  const text = j === '-' ? fs.readFileSync(0, 'utf8') : j;
  try { return JSON.parse(text); } catch (e) { throw new sp.Invalid('patch is not JSON: ' + e.message); }
}

function showSpec(dir, partial) {
  const level = doc.ensureSettings();
  const args = ['spec', '--cohdit', sp.cohditDir(dir), '--level', level];
  if (partial) args.push('--partial');
  render.main(args);
  const spec = sp.load(dir);
  const local = sp.readLocal(dir);
  local.shown_items = spec.items.map((i) => i.id);
  sp.writeLocal(dir, local);
  const inferred = Object.values(spec.gates).filter((g) => g.source === 'inferred').length + spec.items.filter((i) => i.source === 'inferred').length;
  if (local.dream_run) appendEvents(sp.cohditDir(dir), local.dream_run, [['READBACK', { kind: partial ? 'partial' : 'full', items: spec.items.length, inferred, open: spec.open_questions.length }]]);
  hint('level', level);
}

function cmdIdea(argv) {
  const sub = argv[0];
  const rest = argv.slice(1);
  const VALUED = ['--dir', '--json', '--hosting', '--stack', '--team'];
  try {
    if (sub === 'terms') {
      process.stdout.write(sp.terms().text);
      return 0;
    }
    if (sub === 'new') {
      const name = words(rest, VALUED).join(' ');
      if (!name) return fail('idea new needs a name');
      const { dir, slug } = sp.newProject(name, opt(rest, '--dir'), (args, cwd) => {
        const r = doc.realRun('git', args, { cwd });
        if (r.code !== 0) throw new sp.Invalid('git init failed: ' + r.err.trim());
      });
      const cd = sp.cohditDir(dir);
      const run = newRunId(path.join(cd, 'ledger', 'runs'), ml.utcNow());
      appendEvents(cd, run, [['RUN_START', runStart('dream')]]);
      sp.writeLocal(dir, { dream_run: run, asked: 0, shown_items: [] });
      hint('dir', dir);
      hint('slug', slug);
      return 0;
    }
    const dir = sp.findProject(opt(rest, '--dir'), process.cwd());
    const cd = sp.cohditDir(dir);
    hint('dir', dir);
    if (sub === 'set') {
      const spec = sp.load(dir);
      const asked = sp.applyPatch(spec, readPatch(rest), sp.loadInterview());
      sp.save(dir, spec);
      const local = sp.readLocal(dir);
      if (asked.length && local.dream_run) {
        appendEvents(cd, local.dream_run, asked.map((g) => ['ASK', { goal: g, n: ++local.asked }]));
        sp.writeLocal(dir, local);
      }
      showSpec(dir, true);
      return 0;
    }
    if (sub === 'change' || sub === 'reopen') {
      const spec = sp.load(dir);
      const local = sp.readLocal(dir);
      const run = newRunId(path.join(cd, 'ledger', 'runs'), ml.utcNow());
      const events = [['RUN_START', runStart('dream')]];
      if (sub === 'change') {
        const res = sp.applyChange(spec, readPatch(rest), sp.loadInterview());
        events.push(['DECIDE', { type: 'scope', choice: 'changed', who: 'you' }]);
        events.push(['SPEC', { items: spec.items.length, gates_yes: (spec.rails || []).length, held: spec.open_questions.length }]);
        for (const id of res.added) hint('added', id);
        for (const id of res.edited) hint('edited', id);
        hint('next', 'build');
      } else {
        if (!spec.agreed) throw new sp.Invalid('the idea is not agreed yet; keep going with idea set');
        if (spec.refused) throw new sp.Invalid('refused: ' + spec.refused);
        spec.agreed = false;
        sp.raiseIdFloor(spec, bd.allRecords(dir).map((r) => r.i).filter(Boolean));   // a reshaped list never reuses an id the ledger knows
        events.push(['DECIDE', { type: 'scope', choice: 'reopened', who: 'you' }]);
        hint('next', 'agree');
      }
      events.push(['RUN_END', { outcome: 'ok' }]);
      sp.save(dir, spec);
      appendEvents(cd, run, events);
      sp.writeLocal(dir, Object.assign(local, { dream_run: run, asked: 0, shown_items: [] }));
      showSpec(dir, true);
      return 0;
    }
    if (sub === 'show') {
      showSpec(dir, !hasOpt(rest, '--full'));
      return 0;
    }
    if (sub === 'refuse') {
      const category = words(rest, VALUED)[0];
      const refuse = cz.loadRails().refuse || {};
      if (!refuse[category]) return fail('refuse needs one of ' + Object.keys(refuse).join(', '));
      const spec = sp.load(dir);
      spec.refused = category;
      sp.save(dir, spec);
      const local = sp.readLocal(dir);
      if (local.dream_run) appendEvents(cd, local.dream_run, [['REFUSE', { category }], ['RUN_END', { outcome: 'ok' }]]);
      render.main(['digest', '--cohdit', cd, '--run', local.dream_run, '--level', doc.ensureSettings()]);
      hint('hint', 'refused');
      return 1;
    }
    if (sub === 'agree') {
      const spec = sp.load(dir);
      const problems = sp.agreeProblems(spec);
      const stackParts = (opt(rest, '--stack') || '').split(',').map((x) => x.trim()).filter(Boolean);
      const stack = sp.checkStack(stackParts);
      if (!stack.ok) problems.push('not on my list: ' + stack.off.join(', '));
      const hostingKey = opt(rest, '--hosting');
      const hosting = sp.loadHosting();
      if (hostingKey && !hosting.options[hostingKey]) problems.push('hosting must be one of ' + Object.keys(hosting.options).join(', '));
      const team = opt(rest, '--team');                          // the team's slug, from the publishing tool's own list
      if (team !== undefined && !/^[A-Za-z0-9._-]{1,96}$/.test(team)) problems.push('--team needs the team\'s slug');
      if (hostingKey === 'team' && !team) problems.push('team hosting needs --team <slug>');
      if (team && hostingKey !== 'team') problems.push('--team goes with --hosting team');
      if (problems.length) {
        for (const p of problems) hint('problem', p);
        hint('hint', 'not_ready');
        return 1;
      }
      const t = sp.terms();
      const settings = sp.registry();
      const events = [];
      events.push(['DECIDE', { type: 'terms', choice: 'accepted', who: 'you', v: t.version }]);
      const hKey = hostingKey || hosting.recommended || 'own_free';
      events.push(['DECIDE', { type: 'hosting', choice: hKey, who: hostingKey ? 'you' : 'hatch' }]);
      spec.decisions = spec.decisions.filter((d) => d.type !== 'hosting' && d.type !== 'terms');
      spec.decisions.push({ type: 'hosting', choice: hKey, who: hostingKey ? 'you' : 'hatch' });
      for (const part of stackParts) {
        events.push(['DECIDE', { type: 'stack', choice: part, who: 'you' }]);
        spec.decisions.push({ type: 'stack', choice: part, who: 'you' });
      }
      events.push(['DECIDE', { type: 'scope', choice: 'agreed', who: 'you' }]);
      spec.rails = sp.railsFor(spec);
      spec.terms_v = t.version;
      spec.agreed = true;
      events.push(['SPEC', { items: spec.items.length, gates_yes: spec.rails.length, held: spec.open_questions.length }]);
      events.push(['RUN_END', { outcome: 'ok' }]);
      sp.save(dir, spec);
      const cfg = ml.readJson(path.join(cd, 'config.json'), { v: 1 });
      cfg.hosting = Object.assign({}, (hosting.options[hKey] || {}).config || {}, team ? { scope: team } : {});
      fs.writeFileSync(path.join(cd, 'config.json'), JSON.stringify(cfg, null, 2) + '\n');
      settings.terms_v = t.version;
      sp.saveRegistry(settings);
      const local = sp.readLocal(dir);
      if (local.dream_run) appendEvents(cd, local.dream_run, events);
      render.main(['digest', '--cohdit', cd, '--run', local.dream_run, '--level', doc.ensureSettings()]);
      hint('next', 'build');
      return 0;
    }
    return fail('idea needs one of new, set, change, reopen, show, agree, refuse, terms');
  } catch (e) {
    if (e instanceof sp.Invalid) {
      process.stderr.write('hatch: ' + e.message + '\n');
      hint('hint', e.message.startsWith('two_ideas') ? 'two_ideas' : 'invalid');
      return 64;
    }
    throw e;
  }
}

// --- the build ----------------------------------------------------------------------------------

/** Print rendered lines for records just written, at the level; tech reads the product sentences
 *  (key=value is the events view). The spool is read too: a live run's records are not flushed yet. */
function say(dir, recs, lvl) {
  const c = new render.Ctx({ level: lvl, cohdit: sp.cohditDir(dir), spool: bd.spoolFile(dir) });
  for (const r of recs) {
    const line = c.line(r, lvl === 'tech' ? 'product' : lvl, c.runs.get(r.r) || [r]);
    if (line) process.stdout.write(line + '\n');
  }
}

function sayWord(dir, lvl, key) {
  const w = render.WORDS[lvl === 'tech' ? 'product' : lvl];
  process.stdout.write(w[key] + '\n');
}

/** The project a build phrase means: --dir; --name (this computer's ideas, else the person's GitHub
 *  account); else the usual search. */
function buildDir(rest) {
  const name = opt(rest, '--name');
  if (name) {
    const want = name.trim().toLowerCase();
    const hit = sp.registry().projects.filter((p) => fs.existsSync(sp.specPath(p.path)))
      .find((p) => p.name.toLowerCase() === want || p.slug === want || sp.slugify(name) === p.slug);
    if (hit) return hit.path;
    const fetched = bd.fetchIdea(name, doc.runner());
    if (fetched) { hint('hint', 'fetched'); return fetched; }
    throw new sp.Invalid('no idea called "' + name + '" here or in your GitHub account');
  }
  return sp.findProject(opt(rest, '--dir'), process.cwd());
}

function needRun(dir) {
  const cur = bd.active(dir);
  if (!cur || cur.skill !== 'build') throw new bd.Invalid('no build run here; call build open first');
  return cur;
}

function readReturn(rest) {
  const r = opt(rest, '--return');
  if (r === undefined) throw new bd.Invalid('needs --return <json> or --return -');
  return r === '-' ? fs.readFileSync(0, 'utf8') : r;
}

function stopRun(dir, cur, cause, lvl, extra) {
  const recs = bd.emit(dir, cur.run, [['STOP', Object.assign({ cause }, extra || {})]]);
  cur.stop = cause;
  bd.saveActive(dir, cur);
  say(dir, recs, lvl);
  hint('next', 'close');
}

const land = bd.land;

/** An item is finished without a merge: set aside or refused. */
function setAside(dir, cur, item, lvl, recs) {
  const o = cur.open[item];
  const kept = bd.keepWork(dir, o);                              // committed work is kept, never deleted
  if (kept) hint('kept', kept);
  bd.releaseClaim(dir, o.branch);
  const written = bd.emit(dir, cur.run, recs);
  delete cur.open[item];
  bd.saveActive(dir, cur);
  bd.resetTree(dir);                                             // the maker's half work never reaches the next thing
  bd.toMain(dir);
  bd.git(['branch', '-q', '-D', o.branch], dir, false);
  land(dir, cur, 'Hatch: ' + item + ' set aside');
  say(dir, written.filter((r) => ['BLOCKED', 'REFUSE', 'STOP'].includes(r.c)), lvl);
}

function blocked(dir, cur, item, lvl, reason, text, lead) {
  setAside(dir, cur, item, lvl, (lead || []).concat([['BLOCKED', { reason, blob: bd.blob(dir, text) }, item]]));
  hint('next', 'next');
  return 0;
}

/** The checks, then the coverage the test run wrote against the project's floor: under it, the checks
 *  failed, and the maker is told which test to add. */
function verifyNow(dir, cur, cfg, lvl, quiet) {
  const item = Object.keys(cur.open)[0] || null;
  const t0 = Date.now();
  const env = Object.assign({}, process.env, { PATH: tools.pathWithExtras(), CI: '1' });
  const r = spawnSync(cfg.verify, { cwd: dir, shell: true, encoding: 'utf8', timeout: bd.LONG_MS, env });
  let rc = r.status === null ? 1 : r.status;
  const dur_s = Math.max(0, Math.round((Date.now() - t0) / 1000));
  let tail = ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-60).join('\n');
  const cov = rc === 0 ? bd.coverage(dir) : null;
  if (cov !== null && cfg.coverage_min && cov < cfg.coverage_min) {
    rc = 1;
    tail = 'Coverage is ' + cov + '%; this project requires ' + cfg.coverage_min + '%. Add the test that proves the change, through the path a person takes.';
  }
  const f = { rc, dur_s };
  if (cov !== null) f.cov = cov;
  if (rc !== 0 && tail) f.cmd = bd.blob(dir, tail);
  const recs = bd.emit(dir, cur.run, [['VERIFY', f, item]]);
  say(dir, recs, lvl);
  if (rc !== 0 && tail && !quiet) process.stdout.write(tail + '\n');     // the maker reads why; the skill never prints this
  return rc;
}

/** The gate passed its review: combine with what others merged, check again, advance the shared main,
 *  record DONE. Three tries when main keeps moving. */
function gate(dir, cur, spec, item, lvl, lead) {
  const o = cur.open[item];
  const cfg = bd.readCfg(dir);
  bd.resetTree(dir);                                             // only what passed the gate's commit counts
  let landed = false;
  for (let attempt = 0; attempt < 3 && !landed; attempt++) {
    const base = bd.baseSha(dir);
    if (base && base !== o.base) {
      if (!bd.rebaseOnto(dir, base, o.branch)) {
        if (!o.clashed) return clash(dir, cur, spec, cfg, item, lvl, lead, 'conflict');
        return blocked(dir, cur, item, lvl, 'dependency', "someone else's change conflicts with this one; it can be built again later", lead);
      }
      o.base = base;
      bd.saveActive(dir, cur);
      if (verifyNow(dir, cur, cfg, lvl, true) !== 0) {
        if (!o.clashed) return clash(dir, cur, spec, cfg, item, lvl, lead, 'checks');
        return blocked(dir, cur, item, lvl, 'other', "the checks failed after combining with others' work", lead);
      }
    }
    const sha = bd.fullSha(dir, o.branch);
    if (!bd.hasRemote(dir)) {
      bd.toMain(dir);
      if (bd.git(['merge', '-q', '--ff-only', o.branch], dir, false) === null) return blocked(dir, cur, item, lvl, 'other', 'the finished work could not be merged onto main', lead);
      landed = true;
    } else if (bd.pushMain(dir, sha, base) === 'ok') {
      bd.toMain(dir);
      landed = true;
    }
  }
  if (!landed) return blocked(dir, cur, item, lvl, 'other', 'the shared copy kept changing while this was finishing; it will be tried again', lead);
  const files = (bd.git(['diff', '--name-only', o.base + '..' + o.branch], dir, false) || '').split('\n').filter(Boolean);
  const touches = [...new Set(files.map((f) => (f.includes('/') ? f.split('/')[0] + '/' : f)))].sort();
  const recs = (lead || []).concat([['GATE', { result: 'pass' }, item], ['DONE', { head: bd.headSha(dir, o.branch), touches: touches.join(',') || 'none' }, item]]);
  const written = bd.emit(dir, cur.run, recs);
  bd.releaseClaim(dir, o.branch);
  bd.git(['branch', '-q', '-D', o.branch], dir, false);
  delete cur.open[item];
  bd.saveActive(dir, cur);
  land(dir, cur, 'Hatch: ' + item + ' done');
  say(dir, written.filter((r) => r.c === 'DONE'), lvl);
  hint('next', 'next');
  return 0;
}

/** Another thing reached main while this one was built, and the two clash (the same lines, or checks
 *  that fail together). Once per thing: its work is kept, it starts again on the current main with its
 *  earlier version beside it, and the run narrows to one lane. A second clash sets it aside. */
function clash(dir, cur, spec, cfg, item, lvl, lead, why) {
  const o = cur.open[item];
  narrow(dir, cur);
  const earlier = bd.git(['diff', o.base + '..' + o.branch], dir, false) || '';
  bd.keepWork(dir, o);
  bd.resetTree(dir);
  const base = bd.baseSha(dir);
  o.start = bd.startItem(dir, o.branch, base, item);
  o.base = base;
  o.fork = bd.headSha(dir, base);
  o.clashed = true;
  if (bd.hasRemote(dir)) bd.gitNet(['push', '-q', '-f', 'origin', 'refs/heads/' + o.branch + ':refs/heads/' + o.branch], dir);   // our own claim, restarted
  fs.writeFileSync(bd.diffPath(dir, item), earlier);
  o.notes = ['Another change reached main while this was being built, and the two ' + (why === 'conflict' ? 'change the same lines' : 'fail the checks together')
    + '. Build this thing again on the current main. Your earlier version is the diff at ' + bd.diffPath(dir, item) + ': reuse what still fits.'];
  const written = bd.emit(dir, cur.run, (lead || []).concat([['ROUND', { cause: 'gate' }, item], ['DISPATCH', { agent: 'maker', model: bd.agentModel('maker') }, item]]));
  say(dir, written.filter((x) => x.c === 'ROUND'), lvl);
  dispatchMaker(dir, cur, spec, cfg, item, lvl, o.notes);
  return 0;
}

/** One lane from here on: the lead takes no more lanes and the others stop after what they hold. */
function narrow(dir, cur) {
  const L = bd.laneGroup(dir, cur)[0];
  if (L.cur.narrow) return;
  L.cur.narrow = true;
  bd.saveActive(L.dir, L.cur);
  if (L.cur !== cur && L.dir === dir) cur.narrow = true;
}

/** A lane's job is over: anything it still held goes back on the list (its committed work kept), and
 *  its copy goes. Its records stay in the shared spool for the lead to land. */
function closeLane(dir, cur) {
  for (const item of Object.keys(cur.open || {})) {
    const o = cur.open[item];
    const kept = bd.keepWork(dir, o);
    if (kept) hint('kept', kept);
    bd.releaseClaim(dir, o.branch);
  }
  ml.clearActiveRun(dir);
  bd.removeSideCopy(dir);
  const L = cur.lead ? bd.active(cur.lead) : null;
  if (L && L.lanes) { L.lanes = L.lanes.filter((d) => path.resolve(d) !== path.resolve(dir)); bd.saveActive(cur.lead, L); }
}

function dispatchMaker(dir, cur, spec, cfg, item, lvl, notes, status) {
  const o = cur.open[item];
  o.phase = 'maker';
  bd.saveActive(dir, cur);
  fs.writeFileSync(bd.briefPath(dir, item), bd.brief(dir, spec, item, cfg, notes, status, o.advice));
  hint('item', item);
  hint('brief', bd.briefPath(dir, item));
  hint('next', 'maker');
}

/** The lenses still to report on an item under review; the skill dispatches exactly these. */
function awaitReview(dir, item, o) {
  const left = o.review.expected.filter((a) => !o.review.got[a]);
  for (const a of left) bd.writeRole(dir, a, item);
  hint('item', item); hint('diff', bd.diffPath(dir, item)); hint('agents', left.join(',')); hint('roles', ml.spoolDir(dir)); hint('next', 'review');
}

function awaitAdvisor(dir, item) {
  bd.writeRole(dir, 'advisor');
  hint('item', item); hint('consult', bd.consultPath(dir, item)); hint('roles', ml.spoolDir(dir)); hint('next', 'advisor');
}

/** Is a fix run due by the schedule the person set? */
function fixDue(dir, cfg) {
  const every = (cfg.fix || {}).every_days;
  if (!every) return false;
  const last = bd.allRecords(dir).filter((r) => r.c === 'RUN_START' && r.f && r.f.skill === 'fix').map((r) => r.ts).sort().pop();
  return !last || ml.hoursBetween(ml.parseTs(ml.utcNow()), ml.parseTs(last)) >= every * 24;
}

/** A bug's title from what the person saw: its first sentence, cut at a word, so a pasted error message
 *  does not become the whole title. Their words stay whole in the check. */
function reportTitle(saw) {
  const first = saw.split(/(?<=[.!?])\s+/)[0] || saw;
  if (first.length <= 60) return first;
  const cut = first.slice(0, 59);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 20)).replace(/[\s,;:(-]+$/, '') + '…';
}

/** A report from a person, as a bug: their words whole, and what fixed looks like. */
function reportBug(r) {
  const saw = String(r.saw || '').replace(/\s+/g, ' ').trim();
  const parts = [];
  if (r.did) parts.push('they were ' + String(r.did).trim());
  if (r.expected) parts.push('expected ' + String(r.expected).trim());
  parts.push('saw: ' + saw + (r.page ? ' (at ' + r.page + ')' : ''));
  return { title: reportTitle(saw), criteria: ['Someone using it ' + parts.join('; ') + '. Once fixed, that no longer happens.'], source: 'report', by: 'person' };
}

/** Every report waiting in `.cohdit/reports/` (pulled from the live app's store first) becomes a bug on
 *  the list; the files are removed once in. Returns the new bugs. */
function importReports(dir, cfg) {
  const into = path.join(sp.cohditDir(dir), 'reports');
  sh.pullReports(doc.runner(), dir, cfg, (cfg.hosting || {}).scope || null, into);
  const bugs = [];
  for (const f of ml.listFiles(into, '.json')) {
    const r = ml.readJson(f, null);
    if (r && r.saw) {
      const bug = sp.addBug(dir, reportBug(r));
      if (!bug.twin) bugs.push(bug);
    }
    fs.unlinkSync(f);
  }
  return bugs;
}

/** A report that is not one valid JSON block: one re-ask, then the item is set aside. Returns the exit code. */
function badReport(dir, cur, item, lvl, e) {
  const o = cur.open[item];
  o.contract = (o.contract || 0) + 1;
  process.stderr.write('hatch: ' + e.message + '\n');
  if (o.contract < 2) {
    bd.saveActive(dir, cur);
    bd.emit(dir, cur.run, [['ROUND', { cause: 'contract' }, item]]);
    hint('hint', 'reask');
    return 64;
  }
  return blocked(dir, cur, item, lvl, 'other', 'the report was not one valid JSON block, twice: ' + e.message);
}

/** argv without `name` and its value, wherever they stand. */
function stripOpt(argv, name) {
  const i = argv.indexOf(name);
  return i < 0 ? argv : argv.slice(0, i).concat(argv.slice(i + 2));
}

function cmdBuild(argv) {
  const session = opt(argv, '--session') || null;             // the hook may add it anywhere after `build`
  const args = stripOpt(argv, '--session');
  const sub = args[0];
  const rest = args.slice(1);
  const VALUED = ['--dir', '--name', '--return', '--agent', '-m'];
  try {
    let dir = buildDir(rest);
    let lvl = bd.level(dir);
    hint('level', lvl);
    if (sub === 'open') {
      const spec = sp.load(dir);
      if (spec.refused) {
        hint('dir', dir);
        say(dir, [bd.stopBefore(dir, 'refused').stop], lvl);
        hint('hint', 'refused');
        return 5;
      }
      if (!spec.agreed) { hint('dir', dir); hint('hint', 'not_agreed'); return 1; }
      if (spec.terms_v !== sp.terms().version) {
        hint('dir', dir);
        say(dir, [bd.stopBefore(dir, 'no_terms').stop], lvl);
        hint('hint', 'no_terms');
        return 1;
      }
      const trying = tr.current(dir);
      if (trying) tr.end(dir, trying, 'ok');                     // a try still open here ends first: its app stops, its run closes
      let cur = bd.active(dir);
      if (cur && cur.skill === 'build') {
        const stale = ml.hoursBetween(ml.parseTs(ml.utcNow()), ml.parseTs(cur.started)) > ml.STALE_RUN_H;
        const other = cur.session && session && cur.session !== session && bd.isLive(cur);
        if (stale) {                                             // abandoned: its picks go back, its claims are released
          bd.abandon(dir, cur);
          cur = null;
        } else if (other) {                                      // another session is building here: this one works beside it
          if (!bd.hasRemote(dir)) { sayWord(dir, lvl, 'busy'); hint('hint', 'busy'); return 1; }
          const mine = bd.findSideCopy(spec, session);
          dir = mine || bd.sideCopy(dir, spec);
          lvl = bd.level(dir);
          hint('hint', 'side_copy');
          cur = mine ? bd.active(dir) : null;
          if (cur && cur.skill !== 'build') cur = null;
        }
      } else if (cur) {
        if (cur.skill === 'share' && !sh.pending(dir)) sh.closeIdle(dir, cur);   // a question never answered is not a crash
        cur = null;
      }
      hint('dir', dir);
      const born = bd.fullSha(dir, 'HEAD') !== null;
      const openItems = cur ? Object.keys(cur.open || {}) : [];
      if (born && !openItems.length && /^item\//.test(bd.currentBranch(dir) || '')) {   // a crashed run's half work is Hatch's, not the person's
        bd.resetTree(dir);
        bd.toMain(dir);
      }
      const dirty = born ? bd.dirtyPaths(dir) : [];
      if (dirty.length && !openItems.length) {
        const stop = bd.stopBefore(dir, 'dirty_tree', { blob: bd.blob(dir, dirty.join('\n')) });
        bd.flush(dir, stop.run);                                   // the blob into the ledger; .cohdit only, nothing of theirs touched
        say(dir, [stop.stop], lvl);
        hint('hint', 'dirty_tree');
        return 1;
      }
      const cfg = bd.readCfg(dir);
      if (cur) {
        if (session) cur.session = session;
        bd.saveActive(dir, cur);
        hint('hint', 'resumed');
      } else {
        if (!openItems.length) bd.toMain(dir);
        const run = bd.newRunId(dir);
        cur = { run, started: ml.utcNow(), skill: 'build', session, base: bd.headSha(dir, 'HEAD'), open: {}, picked: [] };
        bd.saveActive(dir, cur);
        bd.emit(dir, run, [['RUN_START', bd.runStart(cur.base || undefined)]]);
      }
      bd.setPointer(dir, cur.run, session);
      if (bd.scaffold(dir, spec, cfg)) hint('hint', 'scaffolded');
      if (bd.isPrimary(dir)) bd.sweepSideCopies(dir, spec);
      if (!cur.remote) {                                         // tried again on every open until the shared copy exists
        const result = bd.ensureRepo(dir, spec, cfg, doc.runner());
        if (result) bd.emit(dir, cur.run, [['PUSH', { branch: 'main', result }]]);
        else if (bd.hasRemote(dir) && !bd.remoteMain(dir)) bd.gitNet(['push', '-q', '-u', 'origin', 'main'], dir);
        cur.remote = result === null || result === 'ok';
        if (result === 'no_remote') cur.said_no_remote = true;
        bd.saveActive(dir, cur);
      }
      if (fixDue(dir, cfg)) hint('hint', 'fix_due');
      if (!cur.lead && cur.remote && bd.hasRemote(dir)) {        // more makers at once, each in a lane of its own; narrowed: no more
        const lanes = bd.openLanes(dir, cur, spec, bd.readCfg(dir), session, cur.narrow ? 1 : bd.laneCount(bd.readCfg(dir), spec, bd.itemStatus(dir, spec)));
        if (lanes.length) hint('lanes', lanes.join(','));
      }
      for (const x of (spec.experts || []).filter((e) => e !== ld.LEADER_SLUG && !ld.pack(e))) {
        process.stdout.write(slugName(x) + ' isn\'t available right now, so this build uses the software leader alone.\n');
      }
      hint('run', cur.run);
      hint('next', 'next');
      return 0;
    }
    const cur = needRun(dir);
    const spec = sp.load(dir);
    const cfg = bd.readCfg(dir);
    hint('dir', dir);
    hint('run', cur.run);
    bd.saveActive(dir, cur);                                     // every call is a heartbeat
    if (sub === 'next') {
      const group = bd.laneGroup(dir, cur), lead = group[0];
      const home = bd.homeDir(dir, cur);
      if (cur.stop || (cur.lead && lead.cur.stop === 'refused')) { hint('next', 'close'); return 0; }
      const open = Object.keys(cur.open);
      if (open.length) {                                         // resuming: the same item, where it was
        const item = open[0], o = cur.open[item];
        if (o.phase === 'review') awaitReview(dir, item, o);
        else if (o.phase === 'advisor') awaitAdvisor(dir, item);
        else {
          if (bd.currentBranch(dir) !== o.branch) bd.git(['checkout', '-q', o.branch], dir);
          dispatchMaker(dir, cur, spec, cfg, item, lvl, o.notes);
        }
        return 0;
      }
      // A lane takes nothing new once the lead stopped, narrowed to one lane, or let it go.
      if (cur.lead && (lead.cur.stop || lead.cur.narrow || !(lead.cur.lanes || []).includes(dir))) { hint('next', 'close'); return 0; }
      const busy = group.some((g) => g.dir !== dir && Object.keys(g.cur.open || {}).length);   // another lane is mid-thing
      const ease = (cause) => {                                  // a cap: lanes finish what they hold; the lead stops last
        if (cur.lead) { hint('next', 'close'); return 0; }
        if (busy) { hint('next', 'wait'); return 0; }
        stopRun(dir, cur, cause, lvl);
        return 0;
      };
      const picks = group.reduce((n, g) => n + (g.cur.picked || []).length, 0);
      if (picks >= cfg.caps.items_per_run) return ease('cap');
      const c = new render.Ctx({ level: lvl, cohdit: sp.cohditDir(home), spool: bd.spoolFile(dir) });
      const u = c.usage(c.runs.get(cur.run) || []);
      if (u.usd !== null && u.usd >= cfg.caps.usd_per_run) return ease('budget');
      const sb = bd.startBase(dir);                              // the shared main and this computer's own unpushed commits
      const base = sb.base;
      if (sb.push) bd.emit(dir, cur.run, [['PUSH', { branch: 'main', result: sb.push }]]);
      let status = bd.itemStatus(home, spec), claims = bd.remoteClaims(dir);
      const held = new Set(group.flatMap((g) => Object.keys(g.cur.open || {})));
      let picked = null, branch = null, start = null;
      for (let tries = 0; tries < 4 && !picked; tries++) {
        const cands = bd.candidates(dir, spec, status, claims).filter((i) => !held.has(i.id));
        if (!cands.length) break;
        const it = cands[0];
        const b = bd.branchFor(it);
        start = bd.startItem(dir, b, base, it.id);
        const res = bd.claim(dir, b, claims.get(b));
        if (res === 'ok' || res === 'no_remote') { picked = it; branch = b; break; }
        bd.toMain(dir);
        bd.git(['branch', '-q', '-D', b], dir, false);
        if (res === 'failed') { stopRun(dir, cur, 'offline', lvl); return 0; }   // the shared copy is out of reach: say so, never build blind
        bd.fetch(dir); claims = bd.remoteClaims(dir);           // taken: someone else got there first
      }
      if (!picked) {
        if (busy) { hint('next', 'wait'); return 0; }            // what is left may need what another lane is building
        if (cur.lead) { hint('next', 'close'); return 0; }
        const elsewhere = spec.items.some((i) => !i.device && !cur.open[i.id]
          && (status.get(i.id) === 'building' || (status.get(i.id) === 'queued' && claims.has(bd.branchFor(i)))));
        if (elsewhere) hint('hint', 'others_building');
        hint('next', 'close');
        return 0;
      }
      cur.open[picked.id] = { branch, base, start, fork: bd.headSha(dir, base), picked_at: ml.utcNow(), rounds: 0, contract: 0, phase: 'maker' };
      cur.picked.push(picked.id);
      const recs = bd.emit(dir, cur.run, [['PICK', { branch, fork: bd.headSha(dir, base) }, picked.id], ['DISPATCH', { agent: 'maker', model: bd.agentModel('maker') }, picked.id]]);
      say(dir, [recs[0]], lvl);
      status.set(picked.id, 'building');
      dispatchMaker(dir, cur, spec, cfg, picked.id, lvl, undefined, status);   // read on the main line, before the branch switch
      return 0;
    }
    if (sub === 'verify') return verifyNow(dir, cur, cfg, lvl) === 0 ? 0 : 1;
    if (sub === 'commit') {
      const msg = opt(rest, '-m');
      if (!msg) return fail('commit needs -m <message>');
      const item = Object.keys(cur.open)[0];
      if (!item) return fail('nothing is being built; there is no branch to commit on');
      if (verifyNow(dir, cur, cfg, lvl) !== 0) { hint('hint', 'checks_failed'); return 1; }
      bd.git(['add', '-A', '--', '.', ':(exclude).cohdit'], dir);
      const staged = (bd.git(['diff', '--cached', '--name-only'], dir, false) || '').split('\n').filter((f) => f && !f.startsWith('.cohdit/'));
      if (!staged.length) { hint('hint', 'nothing_to_commit'); return 1; }
      bd.git(['commit', '-q', '-m', msg], dir);
      if (bd.hasRemote(dir)) bd.gitNet(['push', '-q', 'origin', cur.open[item].branch], dir);   // the claim stays alive and the work is safe
      hint('head', bd.headSha(dir));
      return 0;
    }
    if (sub === 'add') {
      const pkg = words(rest, VALUED)[0];
      if (!pkg) return fail('add needs a package name');
      const allowed = new Set();
      const st = sp.loadStack();
      for (const cap of Object.keys(st.capabilities || {})) for (const k of Object.keys(st.capabilities[cap].options || {})) for (const n of st.capabilities[cap].options[k].npm || []) allowed.add(n);
      if (!allowed.has(pkg) && !pkg.startsWith('@types/')) {
        process.stderr.write('hatch: not on my list: ' + pkg + '\n');
        hint('hint', 'not_on_list');
        return 64;
      }
      if (process.env.COHDIT_FAKE_SCAFFOLD) {
        const f = path.join(dir, 'package.json');
        const p = ml.readJson(f, {});
        p.dependencies = Object.assign({}, p.dependencies, { [pkg]: '*' });
        fs.writeFileSync(f, JSON.stringify(p, null, 2) + '\n');
        return 0;
      }
      const r = doc.realRun('npm', ['install', '--no-audit', '--no-fund', pkg], { cwd: dir, timeout: bd.LONG_MS });
      if (r.code !== 0) { process.stderr.write((r.err || r.out).trim().split('\n').slice(-3).join('\n') + '\n'); return 1; }
      return 0;
    }
    if (sub === 'built' || sub === 'checked' || sub === 'advised') {
      const item = words(rest, VALUED)[0];
      if (!item || !cur.open[item]) return fail(sub + ' needs an open ITEM-NNN (open: ' + (Object.keys(cur.open).join(', ') || 'none') + ')');
      const o = cur.open[item];
      const expects = { built: 'maker', checked: 'review', advised: 'advisor' }[sub];
      if (o.phase !== expects) { hint('hint', 'wrong_phase'); return fail(item + ' is with the ' + o.phase + ', not the ' + expects + '; this report was not expected'); }
      const agent = sub === 'checked' ? (opt(rest, '--agent') || 'checker') : null;
      if (agent && !o.review.expected.includes(agent)) return fail(agent + ' was not asked to review ' + item + ' (asked: ' + o.review.expected.join(', ') + ')');
      if (agent && o.review.got[agent]) return fail(agent + ' already reported on ' + item);
      let r;
      try {
        r = sub === 'built' ? bd.makerReturn(readReturn(rest)) : sub === 'checked' ? bd.checkerReturn(readReturn(rest)) : bd.advisorReturn(readReturn(rest));
      } catch (e) {
        if (!(e instanceof bd.Invalid)) throw e;
        return badReport(dir, cur, item, lvl, e);
      }
      if (sub === 'built') {
        if (r.dropped.length) process.stderr.write('hatch: left out of the report: ' + r.dropped.join('; ') + '\n');
        const lead = [['RETURN', { agent: 'maker', verdict: r.verdict }, item]];
        for (const f of r.findings || []) lead.push(['FINDING', { scope: f.scope, sev: f.sev, blob: bd.blob(dir, f.text) }, item]);
        for (const d of r.decisions || []) lead.push(['DECIDE', { type: d.type, choice: d.choice, who: 'hatch' }, item]);
        if (r.try_note) bd.writeNote(bd.homeDir(dir, cur), item, r.try_note);
        if (r.words) bd.markWords(bd.homeDir(dir, cur), item);
        if (r.verdict === 'refused') {
          cur.stop = 'refused';
          if (cur.lead) { const L = bd.laneGroup(dir, cur)[0]; L.cur.stop = 'refused'; bd.saveActive(L.dir, L.cur); }
          setAside(dir, cur, item, lvl, lead.concat([['REFUSE', { category: r.refused }, item], ['STOP', { cause: 'refused' }, item]]));
          hint('next', 'close');
          return 1;
        }
        if (r.verdict === 'blocked') return blocked(dir, cur, item, lvl, r.blocked.reason, r.blocked.text, lead);
        if (r.verdict === 'consult') {                           // one question per thing; a second is a decision for the person
          if (o.advice) return blocked(dir, cur, item, lvl, 'ambiguous', 'the maker asked a second question: ' + r.consult.question, lead);
          o.consult = r.consult;
          o.phase = 'advisor';
          bd.writeConsult(dir, item, r.consult);
          lead.push(['DISPATCH', { agent: 'advisor', model: bd.agentModel('advisor') }, item]);
          bd.saveActive(dir, cur);
          say(dir, bd.emit(dir, cur.run, lead).filter((x) => x.c === 'DISPATCH'), lvl);
          awaitAdvisor(dir, item);
          return 0;
        }
        const unmet = (r.criteria || []).filter((c) => !c.met).map((c) => c.n);
        if (unmet.length) return blocked(dir, cur, item, lvl, 'other', 'the maker reported done but check ' + unmet.join(', ') + ' is not met', lead);
        const n = Number(bd.git(['rev-list', '--count', (o.start || o.base) + '..' + o.branch], dir, false) || 0);
        if (!n) return blocked(dir, cur, item, lvl, 'other', 'the maker reported done but nothing was committed through the gate', lead);
        const files = (bd.git(['diff', '--name-only', o.base + '..' + o.branch], dir, false) || '').split('\n').filter(Boolean);
        const diff = bd.git(['diff', o.base + '..' + o.branch], dir, false) || '';
        const risk = bd.risk(r.change, files, spec, diff, bd.dependencies(dir));
        lead.push(['RISK', { tier: risk.tier, signals: risk.signals.join(',') }, item]);
        const lenses = bd.lensesFor(risk);
        if (!lenses.length) return gate(dir, cur, spec, item, lvl, lead);
        fs.writeFileSync(bd.diffPath(dir, item), diff);
        for (const a of lenses) lead.push(['DISPATCH', { agent: a, model: bd.agentModel(a) }, item]);
        o.phase = 'review';
        o.review = { expected: lenses, got: {} };
        bd.saveActive(dir, cur);
        const written = bd.emit(dir, cur.run, lead);
        say(dir, written.filter((x) => x.c === 'DISPATCH').slice(0, 1), lvl);   // one line for the whole review, however many lenses
        awaitReview(dir, item, o);
        return 0;
      }
      if (sub === 'advised') {
        o.advice = Object.assign({}, o.consult, { answer: r.answer });
        delete o.consult;
        const written = bd.emit(dir, cur.run, [['RETURN', { agent: 'advisor', verdict: 'answered' }, item], ['ROUND', { cause: 'consult' }, item], ['DISPATCH', { agent: 'maker', model: bd.agentModel('maker') }, item]]);
        say(dir, written.filter((x) => x.c === 'ROUND'), lvl);
        if (bd.currentBranch(dir) !== o.branch) bd.git(['checkout', '-q', o.branch], dir);
        dispatchMaker(dir, cur, spec, cfg, item, lvl, o.notes);
        return 0;
      }
      o.review.got[agent] = { verdict: r.verdict, must_fix: r.must_fix, nits: r.nits };
      bd.saveActive(dir, cur);
      bd.emit(dir, cur.run, [['REVIEW', { must_fix: r.must_fix.length, nits: r.nits, agent }, item], ['RETURN', { agent, verdict: r.verdict }, item]]);
      if (o.review.expected.some((a) => !o.review.got[a])) { awaitReview(dir, item, o); return 0; }
      const got = o.review.got;
      const notes = o.review.expected.flatMap((a) => got[a].must_fix.map((m) => (a === 'checker' ? '' : '[' + a.replace('lens-', '') + '] ') + (m.ref ? m.ref + ': ' : '') + m.text));
      delete o.review;
      if (!notes.length) return gate(dir, cur, spec, item, lvl, []);
      o.rounds += 1;
      if (o.rounds < cfg.caps.rounds_per_item) {
        o.notes = notes;
        bd.git(['checkout', '-q', o.branch], dir);
        const written = bd.emit(dir, cur.run, [['ROUND', { cause: 'review' }, item], ['DISPATCH', { agent: 'maker', model: bd.agentModel('maker') }, item]]);
        say(dir, written.filter((x) => x.c === 'ROUND'), lvl);
        dispatchMaker(dir, cur, spec, cfg, item, lvl, notes);
        return 0;
      }
      return blocked(dir, cur, item, lvl, 'other', 'the review still asked for changes after ' + o.rounds + ' rounds:\n' + notes.join('\n'), [['ROUND', { cause: 'review' }, item]]);   // the last failed round counts too
    }
    if (sub === 'narrow') {                                      // one lane from here: the others finish what they hold
      narrow(dir, cur);
      hint('next', 'next');
      return 0;
    }
    if (sub === 'close') {
      if (cur.lead) { closeLane(dir, cur); hint('next', 'none'); return 0; }
      for (const g of bd.laneGroup(dir, cur).slice(1)) closeLane(g.dir, g.cur);   // what a lane still held goes back on the list
      cur.lanes = [];
      bd.emit(dir, cur.run, [['RUN_END', { outcome: cur.stop ? 'stopped' : 'ok' }]]);
      land(dir, cur, 'Hatch: ledger');
      bd.flush(dir, cur.run);                                    // the push result of the last landing
      const landed = bd.commitLedger(dir, 'Hatch: ledger') !== 'rejected';
      ml.clearActiveRun(dir);
      bd.clearPointer(dir, session || cur.session);
      render.main(['digest', '--cohdit', sp.cohditDir(dir), '--run', cur.run, '--level', lvl]);
      const done = ml.readLedger(sp.cohditDir(dir)).recs.some((r) => r.r === cur.run && r.c === 'DONE');
      if (!bd.isPrimary(dir) && landed) bd.removeSideCopy(dir);  // a copy that could not land is kept and landed by the next open
      hint('next', done ? 'try' : 'none');
      return cur.stop ? 1 : 0;
    }
    return fail('build needs one of open, next, verify, commit, add, built, checked, advised, narrow, close');
  } catch (e) {
    if (e instanceof sp.Invalid || e instanceof bd.Invalid) {
      process.stderr.write('hatch: ' + e.message + '\n');
      hint('hint', e.message.startsWith('no build run') ? 'no_run' : 'invalid');
      return e.message.startsWith('no build run') ? 2 : 64;
    }
    throw e;
  }
}

// --- the try ------------------------------------------------------------------------------------

function tryDigest(dir, run, lvl) {
  render.main(['digest', '--cohdit', sp.cohditDir(dir), '--run', run, '--level', lvl]);
}

/** End the try: digest, then next=share when everything on the list worked, next=build when something
 *  did not, next=none when it was stopped with things unanswered. */
function endTry(dir, t, lvl) {
  tr.end(dir, t, 'ok');
  tryDigest(dir, t.run, lvl);
  const failed = Object.values(t.results || {}).includes('fail');
  const left = t.items.filter((id) => !t.results[id] && !(sp.load(dir).items.find((i) => i.id === id) || {}).device).length;   // a device check never blocks share
  hint('next', failed ? 'build' : left ? 'none' : 'share');
  return failed ? 1 : 0;
}

function recordResult(dir, t, item, result, note, lvl) {
  const f = { result };
  if (result === 'fail') f.blob = bd.blob(dir, note || '(no detail)');
  const recs = bd.emit(dir, t.run, [['TRY_RESULT', f, item]]);
  t.results[item] = result;
  bd.land(dir, t, 'Hatch: ' + item + ' tried');
  tr.save(dir, t);
  say(dir, recs, lvl);
}

/** The app would not start: a stopped try run, its details in the ledger. */
function appStop(dir, lvl, detail) {
  const stop = bd.stopBefore(dir, 'app', { blob: bd.blob(dir, detail) }, 'try');
  bd.flush(dir, stop.run);                                       // the blob into the ledger, where "show me the details" looks
  bd.commitLedger(dir, 'Hatch: ledger');
  say(dir, [stop.stop], lvl);
  hint('hint', 'app');
  return 1;
}

async function cmdTry(argv) {
  const session = opt(argv, '--session') || null;
  const args = stripOpt(argv, '--session');
  const sub = args[0];
  const rest = args.slice(1);
  const VALUED = ['--dir', '--name', '--note'];
  try {
    const dir = buildDir(rest);
    const lvl = bd.level(dir);
    hint('level', lvl);
    hint('dir', dir);
    let spec = sp.load(dir);
    let t = tr.current(dir);
    if (t && tr.isStale(t)) { tr.end(dir, t, 'crashed'); t = null; }
    if (sub === 'start') {
      const build = bd.active(dir);
      if (build && build.skill === 'share' && !sh.pending(dir)) sh.closeIdle(dir, build);   // a question never answered is not a crash
      if (build && build.skill === 'build') {
        const stale = ml.hoursBetween(ml.parseTs(ml.utcNow()), ml.parseTs(build.started)) > ml.STALE_RUN_H;
        if (!stale) { sayWord(dir, lvl, 'stillBuilding'); hint('hint', 'busy'); return 1; }   // paused or live: its half work is not for trying
        bd.abandon(dir, build);                                   // a day old: closed in the ledger
        if (/^item\//.test(bd.currentBranch(dir) || '')) { bd.resetTree(dir); bd.toMain(dir); }   // its half work is Hatch's; the person's own edits on main are never touched
      }
      // A run is fresh until its first record is written: a start cut off while waiting for the app
      // has the app on disk but no RUN_START yet, and must not be taken for a running try.
      const fresh = !t || !bd.allRecords(dir).some((r) => r.r === t.run);
      if (t && !fresh && tr.appAlive(t) && await tr.taken(t.port)) {   // already running: the list again, as it stands
        if (session) { t.session = session; tr.save(dir, t); }
        bd.setPointer(dir, t.run, session);
        render.main(['checklist', '--cohdit', sp.cohditDir(dir), '--level', lvl]);
        hint('run', t.run);
        hint('next', 'results');
        return 0;
      }
      if (t && tr.owns(t)) tools.stopProcess(t.pid);            // alive but not answering, or never recorded: start it afresh
      if (!t || fresh) {
        tr.updateMain(dir);
        spec = sp.load(dir);                                     // titles and notes as the shared copy has them
        const items = tr.toTry(spec, bd.itemStatus(dir, spec));
        if (!items.length) { tr.save(dir, null); sayWord(dir, lvl, 'nothingToTry'); hint('hint', 'nothing'); return 1; }
        t = { run: bd.newRunId(dir), started: ml.utcNow(), items, results: {} };
      }
      if (session) t.session = session;
      const keep = () => tr.save(dir, fresh ? null : Object.assign(t, { pid: undefined }));   // a run that never began is forgotten; a resumed one keeps its answers
      if (!tr.ensurePackages(dir)) { keep(); return appStop(dir, lvl, 'installing the packages failed'); }
      const withLan = t.items.some((id) => (spec.items.find((i) => i.id === id) || {}).device);
      const app = await tr.launch(dir, withLan, (pid, port, boot) => { Object.assign(t, { pid, port, boot }); tr.save(dir, t); });   // known before the wait, so a cut-off call leaves no orphan
      if (app.error) {
        keep();
        hint('log', tr.logTail(dir) ? path.join(ml.spoolDir(dir), 'try.log') : '-');
        return appStop(dir, lvl, app.error);
      }
      if (fresh) {
        bd.emit(dir, t.run, [['RUN_START', bd.runStart(null, 'try')]]);
        if (!bd.active(dir)) ml.setActiveRun({ run: t.run, started: t.started, skill: 'try', session, beat: t.started, open: {} }, dir);
      }
      bd.setPointer(dir, t.run, session);
      Object.assign(t, { pid: app.pid, port: app.port, boot: app.boot, url: app.url, lan: app.lan || undefined });
      const f = { items: t.items, url: t.url };
      if (t.lan) f.lan = t.lan;
      bd.emit(dir, t.run, [['TRY_START', f]]);
      tr.save(dir, t);
      if (!process.env.COHDIT_PROBES) tools.openUrl(t.url);
      render.main(['checklist', '--cohdit', sp.cohditDir(dir), '--level', lvl]);
      hint('run', t.run);
      hint('url', t.url);
      if (t.lan) hint('lan', t.lan);
      hint('next', 'results');
      return 0;
    }
    if (!t) { hint('hint', 'no_run'); process.stderr.write('hatch: nothing is being tried; say "let me try it" first\n'); return 2; }
    hint('run', t.run);
    if (sub === 'result') {
      const [which, result] = words(rest, VALUED);
      if (!['pass', 'fail'].includes(result)) return fail('result needs <which> and pass or fail');
      const item = tr.resolveItem(spec, t.items, which);
      if (!item) { hint('hint', 'which'); return fail('no thing on the list called "' + which + '" (1-' + t.items.length + ', an id or a title)'); }
      let note = opt(rest, '--note');
      if (note === '-') note = fs.readFileSync(0, 'utf8');
      recordResult(dir, t, item, result, (note || '').trim(), lvl);
      const left = t.items.filter((id) => !t.results[id]);
      if (!left.length) return endTry(dir, t, lvl);
      hint('left', String(left.length));
      hint('next', 'results');
      return 0;
    }
    if (sub === 'pass') {
      for (const id of t.items) {
        const it = spec.items.find((i) => i.id === id) || {};
        if (!t.results[id] && !it.device) recordResult(dir, t, id, 'pass', '', lvl);   // a device check passes only when they say so
      }
      return endTry(dir, t, lvl);
    }
    if (sub === 'stop') return endTry(dir, t, lvl);
    return fail('try needs one of start, result, pass, stop');
  } catch (e) {
    if (e instanceof sp.Invalid || e instanceof bd.Invalid) {
      process.stderr.write('hatch: ' + e.message + '\n');
      hint('hint', 'invalid');
      return 64;
    }
    throw e;
  }
}

// --- the share ----------------------------------------------------------------------------------

/** A fixed line from render.js WORDS at the level; tech reads the product words. */
function sayLine(dir, lvl, key, ...args) {
  const w = render.WORDS[lvl === 'tech' ? 'product' : lvl][key];
  process.stdout.write((typeof w === 'function' ? w(...args) : w) + '\n');
}

/** Has the person already said yes to making this idea live? Once per project. */
function publishDecided(dir) {
  return bd.allRecords(dir).some((r) => r.c === 'DECIDE' && r.f && r.f.type === 'publish' && r.f.choice === 'live');
}

function needShare(dir) {
  const cur = bd.active(dir);
  if (!cur || cur.skill !== 'share') throw new bd.Invalid('no share run here; say "share it" first');
  return cur;
}

/** A share that could not start: a run that records only why, its blob in the ledger, the line said. */
function stopNow(dir, lvl, cause, extra, lead) {
  const stop = bd.stopBefore(dir, cause, extra, 'share', lead);
  bd.flush(dir, stop.run);
  bd.commitLedger(dir, 'Hatch: ledger');
  say(dir, stop.recs.filter((r) => r.c === 'CHECK' || r.c === 'STOP'), lvl);
  return 1;
}

/** Changes Hatch did not make: the stop is said and recorded, nothing of theirs is committed or rebased. */
function dirtyStop(dir, lvl) {
  const dirty = bd.dirtyPaths(dir);
  if (!dirty.length) return false;
  const stop = bd.stopBefore(dir, 'dirty_tree', { blob: bd.blob(dir, dirty.join('\n')) }, 'share');
  bd.flush(dir, stop.run);                                        // the blob into the ledger, where "show me the details" looks; .cohdit only
  say(dir, [stop.stop], lvl);
  hint('hint', 'dirty_tree');
  return true;
}

/** End the share run: RUN_END, the ledger landed, the pointers cleared, the digest. */
function endShare(dir, cur, session, lvl, outcome) {
  bd.emit(dir, cur.run, [['RUN_END', { outcome }]]);
  bd.land(dir, cur, 'Hatch: share');
  bd.flush(dir, cur.run);
  bd.commitLedger(dir, 'Hatch: ledger');
  ml.clearActiveRun(dir);
  bd.clearPointer(dir, session || cur.session);
  sh.savePending(dir, null);
  render.main(['digest', '--cohdit', sp.cohditDir(dir), '--run', cur.run, '--level', lvl]);
  hint('next', 'none');
}

/** The deployment settled or not: ready gives the link, error gives the log and a stop, still building
 *  gives next=wait with the run left open. One attempt per run, never a second deploy. */
function settle(dir, cur, session, lvl, cfg, p, elapsedMs) {
  const run = doc.runner();
  const scope = (cfg.hosting || {}).scope || null;
  const insp = sh.wait(run, p.url, scope, sh.minutesLeft(elapsedMs));
  const f = { target: 'vercel', env: 'production', url: p.url };
  if (p.dep) f.dep = p.dep;
  if (insp.state === 'building') {
    const why = sh.giveUp(p, insp);
    sh.savePending(dir, p);
    if (!why) { hint('next', 'wait'); return 3; }
    bd.emit(dir, cur.run, [['STOP', { cause: 'connector', name: 'vercel', blob: bd.blob(dir, why) }]]);   // the deploy may still finish; the link is never half-reported
    endShare(dir, cur, session, lvl, 'stopped');
    return 1;
  }
  if (insp.state === 'ready') {
    const prod = sh.productionUrl(run, p.name, scope, insp, p.prod);
    bd.emit(dir, cur.run, [['DEPLOY', Object.assign({}, f, { state: 'ready' })], ['URL_SHARED', { target: 'vercel', env: 'production', url: prod }]]);
    sh.record(dir, cfg, { url: prod });
    endShare(dir, cur, session, lvl, 'ok');
    hint('url', prod);
    return 0;
  }
  const blob = bd.blob(dir, insp.state === 'canceled' ? 'the deploy was cancelled' : sh.buildLog(run, p.url, scope));
  bd.emit(dir, cur.run, [['DEPLOY', Object.assign({}, f, { state: insp.state })], ['STOP', { cause: 'connector', name: 'vercel', blob }]]);
  endShare(dir, cur, session, lvl, 'stopped');
  return 1;
}

function cmdShare(argv) {
  const session = opt(argv, '--session') || null;
  const args = stripOpt(argv, '--session');
  const sub = args[0];
  const rest = args.slice(1);
  try {
    const dir = buildDir(rest);
    const lvl = bd.level(dir);
    hint('level', lvl);
    hint('dir', dir);
    let spec = sp.load(dir);
    const cfg = bd.readCfg(dir);
    const scope = (cfg.hosting || {}).scope || null;
    if (sub === 'open') {
      if (spec.refused) { say(dir, [bd.stopBefore(dir, 'refused', {}, 'share').stop], lvl); hint('hint', 'refused'); return 5; }
      let cur = bd.active(dir);
      if (cur && cur.skill === 'build') {
        const stale = ml.hoursBetween(ml.parseTs(ml.utcNow()), ml.parseTs(cur.started)) > ml.STALE_RUN_H;
        if (!stale) { sayWord(dir, lvl, 'stillBuilding'); hint('hint', 'busy'); return 1; }   // its half work is not for publishing
        bd.abandon(dir, cur);
        cur = null;
      }
      if (cur && cur.skill === 'share') {                           // a share still open here: an unanswered question, or a deploy the lid interrupted
        if (ml.hoursBetween(ml.parseTs(ml.utcNow()), ml.parseTs(cur.started)) > ml.STALE_RUN_H) {
          bd.abandon(dir, cur);
          sh.savePending(dir, null);
          cur = null;
        } else if (sh.pending(dir)) {
          if (session) cur.session = session;
          bd.saveActive(dir, cur);
          bd.setPointer(dir, cur.run, session);
          hint('run', cur.run);
          hint('next', 'wait');
          return 0;
        }
      } else if (cur) {
        cur = null;                                                 // a try: its app may be open; the gate below decides
      }
      const stopped = (code) => { if (cur) sh.closeIdle(dir, cur, 'stopped'); return code; };   // a question left open does not outlive a stop
      if (/^item\//.test(bd.currentBranch(dir) || '')) { bd.resetTree(dir); bd.toMain(dir); }   // a crashed build's half work is Hatch's
      if (!tr.current(dir)) tr.updateMain(dir);                     // never move main under an app the person is trying
      spec = sp.load(dir);
      Object.assign(cfg, bd.readCfg(dir));                          // as the shared copy has it: another computer may have recorded the project
      const status = bd.itemStatus(dir, spec);
      const built = spec.items.filter((i) => !i.device);
      const untried = built.filter((i) => status.get(i.id) === 'done');
      const tried = built.filter((i) => status.get(i.id) === 'tried');
      if (!tried.length && !untried.length) { sayWord(dir, lvl, 'nothingToShare'); hint('hint', 'nothing'); return stopped(1); }
      if (untried.length) { sayWord(dir, lvl, 'tryFirst'); hint('next', 'try'); return stopped(1); }   // nothing goes live untried: try first
      if (dirtyStop(dir, lvl)) return stopped(1);
      const run = doc.runner();
      if (doc.probe('vercel', run) !== 'ok') { stopNow(dir, lvl, 'offline', { name: 'vercel' }); hint('hint', 'offline'); return stopped(1); }
      if (doc.probe('vercel_auth', run) !== 'ok') { stopNow(dir, lvl, 'no_auth', { name: 'vercel' }); hint('hint', 'no_auth'); return stopped(1); }
      if (scope && doc.probe('vercel_team', run, { scope }) !== 'ok') {
        stopNow(dir, lvl, 'connector', { name: 'vercel', blob: bd.blob(dir, 'not yet a member of the team ' + scope + '; its owner needs to add you') }, [['CHECK', { name: 'vercel_team', state: 'missing' }]]);
        hint('hint', 'team');
        return stopped(1);
      }
      if (!cur) {
        cur = { run: bd.newRunId(dir), started: ml.utcNow(), skill: 'share', session, open: {}, picked: [] };
        bd.saveActive(dir, cur);
        bd.emit(dir, cur.run, [['RUN_START', bd.runStart(null, 'share')]]);
      } else {
        if (session) cur.session = session;
        bd.saveActive(dir, cur);
      }
      bd.setPointer(dir, cur.run, session);
      hint('run', cur.run);
      const name = sh.baseName(cfg, spec);
      const url = ((cfg.connectors || {}).vercel || {}).url || 'https://' + name + '.vercel.app';   // the likely address; the digest prints the real one
      hint('url', url);
      if (publishDecided(dir)) { hint('next', 'go'); return 0; }
      sayLine(dir, lvl, 'publishAsk', url);
      hint('next', 'ask');
      return 0;
    }
    const cur = needShare(dir);
    hint('run', cur.run);
    bd.saveActive(dir, cur);
    if (sub === 'later') {
      bd.emit(dir, cur.run, [['DECIDE', { type: 'publish', choice: 'not_yet', who: 'you' }]]);
      endShare(dir, cur, session, lvl, 'ok');
      return 0;
    }
    if (sub === 'go') {
      const p = sh.pending(dir);
      if (p) return settle(dir, cur, session, lvl, cfg, p);        // a deploy is already on its way: never a second one
      if (bd.dirtyPaths(dir).length) {                              // changed since the question was asked: what goes live is what was tried
        bd.emit(dir, cur.run, [['STOP', { cause: 'dirty_tree', blob: bd.blob(dir, bd.dirtyPaths(dir).join('\n')) }]]);
        endShare(dir, cur, session, lvl, 'stopped');
        hint('hint', 'dirty_tree');
        return 1;
      }
      if (!publishDecided(dir)) bd.emit(dir, cur.run, [['DECIDE', { type: 'publish', choice: 'live', who: 'you' }]]);
      const run = doc.runner();
      const t0 = Date.now();
      sh.ensureIgnore(dir);
      let name = ((cfg.connectors || {}).vercel || {}).project;
      if (!name) {
        const base = sh.baseName(cfg, spec);
        name = sh.freeName(base, sh.takenNames(run, base, scope));
        sh.record(dir, cfg, { project: name });
      }
      sh.ensureReportStore(run, dir, cfg, name, scope);          // where the live app's problem reports go; best effort, the deploy does not wait on it
      const d = sh.deploy(run, dir, name, scope);
      if (!d.ok) {
        bd.emit(dir, cur.run, [['DEPLOY', { target: 'vercel', env: 'production', state: 'error' }], ['STOP', { cause: 'connector', name: 'vercel', blob: bd.blob(dir, d.message) }]]);
        endShare(dir, cur, session, lvl, 'stopped');
        return 1;
      }
      const f = { target: 'vercel', env: 'production', state: 'building', url: d.url };
      if (d.dep) f.dep = d.dep;
      say(dir, bd.emit(dir, cur.run, [['DEPLOY', f]]), lvl);
      const next = { url: d.url, dep: d.dep, prod: d.prod, name };
      sh.savePending(dir, next);
      return settle(dir, cur, session, lvl, cfg, next, Date.now() - t0);
    }
    if (sub === 'wait') {
      const p = sh.pending(dir);
      if (!p) return fail('nothing is being published; say "share it" first');
      return settle(dir, cur, session, lvl, cfg, p);
    }
    return fail('share needs one of open, go, wait, later');
  } catch (e) {
    if (e instanceof sp.Invalid || e instanceof bd.Invalid || e instanceof cz.Invalid) {
      process.stderr.write('hatch: ' + e.message + '\n');
      hint('hint', e.message.startsWith('no share run') ? 'no_run' : 'invalid');
      return e.message.startsWith('no share run') ? 2 : 64;
    }
    throw e;
  }
}

// --- the permission hook --------------------------------------------------------------------------

const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

/** Why a tool call may run without asking, or null. Two shapes only: one plain call of this very
 *  script, and an edit inside a folder Hatch itself created (never under .git, never a secrets file).
 *  Deny rules in the person's settings still win over an allow (Claude Code docs, hooks).
 *
 *  The call: `node "<hatch.js>" build … [2>&1]`, optionally followed by one quoted heredoc that ends the
 *  command (`<<'EOF' … EOF`), whose body the shell never interprets. Nothing may follow the heredoc
 *  operator on its line. In the call itself, `$` and backticks are refused even inside double quotes,
 *  because the shell runs them there; single quotes are literal and may hold anything. */
function allowDecision(h, projects, hatchPath) {
  const tool = h.tool_name;
  const inp = h.tool_input || {};
  if (tool === 'Bash') {
    let cmd = String(inp.command || '');
    if (process.env.CLAUDE_PLUGIN_ROOT) cmd = cmd.split('${CLAUDE_PLUGIN_ROOT}').join(process.env.CLAUDE_PLUGIN_ROOT);
    const hd = /\s<<-?\s*(['"])(\w+)\1[ \t]*\n(?:[\s\S]*\n)?\2[ \t]*\n?$/.exec(cmd);
    const head = (hd ? cmd.slice(0, hd.index) : cmd).replace(/\s+2>&1\s*$/, '');
    const noSingle = head.replace(/'[^']*'/g, "''");
    if (/[`$]/.test(noSingle)) return null;
    const bare = noSingle.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    if (/[\n;|&<>(){}'"]/.test(bare.replace(/''|""/g, ''))) return null;
    const m = /^\s*node\s+(?:"([^"]+)"|'([^']+)'|(\S+))(?:\s|$)/.exec(head);
    if (!m) return null;
    const script = m[1] || m[2] || m[3];
    return path.resolve(script) === path.resolve(hatchPath) ? 'Hatch: its own script, the one permission you gave' : null;
  }
  if (EDIT_TOOLS.includes(tool)) {
    const fp = inp.file_path || inp.notebook_path;
    if (!fp) return null;
    const abs = path.resolve(fp);
    if (abs.split(path.sep).includes('.git') || /(^|[\\/])\.env(\.|$)/.test(abs)) return null;
    for (const p of projects) {
      const root = path.resolve(p);
      if (abs === root || abs.startsWith(root + path.sep)) return 'Hatch: a file inside its own project folder';
    }
  }
  return null;
}

/** A build, try or share call learns which Claude Code session made it, so two sessions on one computer
 *  get their own working copies and the usage hook finds each one's run: the hook adds `--session <id>`. */
function withSession(command, sessionId) {
  if (!sessionId || !/^[A-Za-z0-9._-]{1,96}$/.test(sessionId) || /--session\b/.test(command)) return null;
  const m = /hatch\.js"?'?\s+(?:build|try|share|fix)\s+\w+/.exec(command);    // after the verb, so `build open` still reads as such
  if (!m) return null;
  return command.slice(0, m.index + m[0].length) + ' --session ' + sessionId + command.slice(m.index + m[0].length);
}

function cmdAllow() {
  try {
    const h = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    const projects = sp.registry().projects.map((p) => p.path).concat([path.join(sp.homeDir(), 'Hatch', '.work')]);
    const why = allowDecision(h, projects, __filename);
    if (why) {
      const out = { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: why };
      const updated = h.tool_name === 'Bash' ? withSession((h.tool_input || {}).command || '', h.session_id) : null;
      if (updated) out.updatedInput = Object.assign({}, h.tool_input, { command: updated });
      process.stdout.write(JSON.stringify({ hookSpecificOutput: out }) + '\n');
    }
  } catch (e) { /* a hook never fails the session: no output means the usual prompt */ }
  return 0;
}

function cmdLevel(argv) {
  if (!argv.length) {
    process.stdout.write(doc.ensureSettings() + '\n');
    return 0;
  }
  if (!cz.LEVELS.includes(argv[0])) return fail('level must be one of ' + cz.LEVELS.join(', '));
  doc.setLevel(argv[0]);
  process.stdout.write(argv[0] + '\n');
  return 0;
}

// --- the fix run: reports in, lenses over the whole project, bugs on the list ---------------------

function cmdFix(argv) {
  const session = opt(argv, '--session') || null;
  const args = stripOpt(argv, '--session');
  const sub = args[0];
  const rest = args.slice(1);
  const VALUED = ['--dir', '--name', '--return', '--agent'];
  try {
    const dir = buildDir(rest);
    const lvl = bd.level(dir);
    hint('level', lvl);
    hint('dir', dir);
    const spec = sp.load(dir);
    const cfg = bd.readCfg(dir);
    if (sub === 'every') {
      const v = words(rest, VALUED)[0];
      if (v === 'off') { delete cfg.fix; bd.saveCfg(dir, cfg); sayWord(dir, lvl, 'fixOff'); return 0; }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) return fail('fix every needs a number of days, or off');
      cfg.fix = { every_days: n };
      bd.saveCfg(dir, cfg);
      sayLine(dir, lvl, 'fixEvery', n);
      return 0;
    }
    if (sub === 'due') {
      const due = fixDue(dir, cfg);
      sayWord(dir, lvl, due ? 'fixDue' : 'fixNotDue');
      hint('due', due ? 'yes' : 'no');
      return 0;
    }
    let cur = bd.active(dir);
    if (sub === 'open') {
      if (!spec.agreed) { hint('hint', 'not_agreed'); return 1; }
      if (!fs.existsSync(path.join(dir, 'package.json'))) { sayWord(dir, lvl, 'nothingToFix'); hint('hint', 'nothing'); return 1; }
      if (cur && cur.skill === 'build') {
        if (ml.hoursBetween(ml.parseTs(ml.utcNow()), ml.parseTs(cur.started)) <= ml.STALE_RUN_H) { sayWord(dir, lvl, 'stillBuilding'); hint('hint', 'busy'); return 1; }
        bd.abandon(dir, cur);
        cur = null;
      }
      if (cur && cur.skill === 'fix' && ml.hoursBetween(ml.parseTs(ml.utcNow()), ml.parseTs(cur.started)) <= ml.STALE_RUN_H) {
        if (session) cur.session = session;
        bd.saveActive(dir, cur);
        hint('hint', 'resumed');
      } else {
        if (cur && cur.skill === 'fix') { bd.emit(dir, cur.run, [['RUN_END', { outcome: 'crashed' }]]); bd.flush(dir, cur.run); }
        bd.toMain(dir);
        const run = bd.newRunId(dir);
        cur = { run, started: ml.utcNow(), skill: 'fix', session, open: {}, review: { expected: Object.keys(bd.loadLenses()), got: {} }, bugs: [] };
        bd.saveActive(dir, cur);
        bd.emit(dir, run, [['RUN_START', bd.runStart(null, 'fix')]]);
        const reported = importReports(dir, cfg);
        for (const b of reported) { cur.bugs.push(b.id); bd.emit(dir, run, [['FINDING', { scope: 'in', sev: 'medium', blob: bd.blob(dir, b.criteria[0]) }, b.id]]); }
        bd.saveActive(dir, cur);
        sayLine(dir, lvl, 'reported', reported.length);
      }
      bd.setPointer(dir, cur.run, session);
      fs.writeFileSync(bd.scanPath(dir), bd.scanBrief(dir, sp.load(dir), cfg));
      hint('run', cur.run);
      hint('brief', bd.scanPath(dir));
      const left = cur.review.expected.filter((a) => !cur.review.got[a]);
      for (const a of left) bd.writeRole(dir, a);
      hint('agents', left.join(','));
      hint('roles', ml.spoolDir(dir));
      hint('next', 'scan');
      return 0;
    }
    if (!cur || cur.skill !== 'fix') { hint('hint', 'no_run'); process.stderr.write('hatch: no fix run here; say "fix the bugs" first\n'); return 2; }
    hint('run', cur.run);
    bd.saveActive(dir, cur);
    if (sub === 'found') {
      const agent = opt(rest, '--agent') || words(rest, VALUED)[0];
      if (!cur.review.expected.includes(agent)) return fail('found needs the lens that reported: ' + cur.review.expected.join(', '));
      if (cur.review.got[agent]) return fail(agent + ' already reported');
      let r;
      try { r = bd.checkerReturn(readReturn(rest)); } catch (e) {
        if (!(e instanceof bd.Invalid)) throw e;
        process.stderr.write('hatch: ' + e.message + '\n');
        hint('hint', 'reask');
        return 64;
      }
      cur.review.got[agent] = { verdict: r.verdict, must_fix: r.must_fix.length, nits: r.nits };
      for (const m of r.must_fix) {
        const text = (m.ref ? m.ref + ': ' : '') + m.text;
        const bug = sp.addBug(dir, { title: m.text, criteria: [text], source: 'scan', by: agent });
        if (bug.twin) continue;
        cur.bugs.push(bug.id);
        bd.emit(dir, cur.run, [['FINDING', { scope: 'in', sev: 'high', blob: bd.blob(dir, text) }, bug.id]]);
      }
      bd.saveActive(dir, cur);
      const left = cur.review.expected.filter((a) => !cur.review.got[a]);
      hint('agents', left.join(','));
      hint('next', left.length ? 'scan' : 'close');
      return 0;
    }
    if (sub === 'close') {
      bd.emit(dir, cur.run, [['RUN_END', { outcome: 'ok' }]]);
      bd.land(dir, cur, 'Hatch: fix run');
      bd.flush(dir, cur.run);
      bd.commitLedger(dir, 'Hatch: ledger');
      ml.clearActiveRun(dir);
      bd.clearPointer(dir, session || cur.session);
      render.main(['digest', '--cohdit', sp.cohditDir(dir), '--run', cur.run, '--level', lvl]);
      const queued = [...bd.itemStatus(dir, sp.load(dir)).entries()].some(([id, s]) => s === 'queued' && (sp.load(dir).items.find((i) => i.id === id) || {}).kind === 'bug');
      hint('next', queued ? 'build' : 'none');
      return 0;
    }
    return fail('fix needs one of open, found, close, every, due');
  } catch (e) {
    if (e instanceof sp.Invalid || e instanceof bd.Invalid) {
      process.stderr.write('hatch: ' + e.message + '\n');
      hint('hint', 'invalid');
      return 64;
    }
    throw e;
  }
}

/** A report that reaches Hatch by word of mouth (the person tells it during a try) goes the same way a
 *  report from the live app does: a file in `.cohdit/reports/`, then a bug on the list. */
function cmdReport(argv) {
  const sub = argv[0];
  const rest = argv.slice(1);
  try {
    const dir = buildDir(rest);
    const lvl = bd.level(dir);
    hint('level', lvl);
    hint('dir', dir);
    const cfg = bd.readCfg(dir);
    if (sub === 'add') {
      const j = opt(rest, '--json');
      if (j === undefined) return fail('report add needs --json <report> or --json -');
      let r;
      try { r = JSON.parse(j === '-' ? fs.readFileSync(0, 'utf8') : j); } catch (e) { return fail('report is not JSON: ' + e.message); }
      if (!r || typeof r.saw !== 'string' || !r.saw.trim()) return fail('a report needs saw: what happened, in their words');
      const into = path.join(sp.cohditDir(dir), 'reports');
      fs.mkdirSync(into, { recursive: true });
      r.at = r.at || ml.utcNow();
      fs.writeFileSync(path.join(into, r.at.replace(/[^0-9A-Za-z]/g, '') + '.json'), JSON.stringify(r) + '\n');
    } else if (sub !== 'pull') return fail('report needs one of add, pull');
    const bugs = importReports(dir, cfg);
    sayLine(dir, lvl, 'reported', bugs.length);
    for (const b of bugs) hint('item', b.id);
    return 0;
  } catch (e) {
    if (e instanceof sp.Invalid || e instanceof bd.Invalid) {
      process.stderr.write('hatch: ' + e.message + '\n');
      hint('hint', 'invalid');
      return 64;
    }
    throw e;
  }
}

// --- the lesson bank -----------------------------------------------------------------------------

/** `remember`: the owner's lessons, into the bank the briefs read. stdout is the lesson's line (or the
 *  index); stderr says `id=`, `count=` and `hint=crowded` when a reader's general lessons exceed the cap. */
function cmdRemember(argv) {
  const sub = argv[0];
  const rest = argv.slice(1);
  const VALUED = ['--json', '--for'];
  try {
    const bank = ls.load();
    const id = words(rest, VALUED)[0];
    const patch = () => {
      const j = opt(rest, '--json');
      if (j === undefined) throw new ls.Invalid('remember ' + sub + ' needs --json <lesson> or --json -');
      const text = j === '-' ? fs.readFileSync(0, 'utf8') : j;
      try { return JSON.parse(text); } catch (e) { throw new ls.Invalid('lesson is not JSON: ' + e.message); }
    };
    const done = (l) => {
      ls.save(bank);
      if (l) { process.stdout.write(ls.line(l) + '\n'); hint('id', l.id); }
      hint('count', bank.lessons.length);
      for (const r of ls.crowded(bank)) hint('hint', 'crowded:' + r);
      return 0;
    };
    switch (sub) {
      case 'add': return done(ls.add(bank, patch()));
      case 'set': if (!id) throw new ls.Invalid('remember set needs an id'); return done(ls.set(bank, id, patch()));
      case 'drop': if (!id) throw new ls.Invalid('remember drop needs an id'); ls.drop(bank, id); return done(null);
      case 'show': {
        if (!id) throw new ls.Invalid('remember show needs an id');
        process.stdout.write(JSON.stringify(ls.find(bank, id), null, 2) + '\n');
        return 0;
      }
      case 'list': {
        const reader = opt(rest, '--for');
        if (reader !== undefined && !ls.READERS.includes(reader)) throw new ls.Invalid('--for must be one of ' + ls.READERS.join(', '));
        const lines = ls.index(bank, reader);
        process.stdout.write((lines.length ? lines.join('\n') : 'No lessons yet.') + '\n');
        hint('count', lines.length);
        for (const r of ls.crowded(bank)) hint('hint', 'crowded:' + r);
        return 0;
      }
      default: return fail('remember add|set|drop|list|show');
    }
  } catch (e) {
    if (e instanceof ls.Invalid) return fail(e.message);
    throw e;
  }
}

/** An error line for a person, on stdout, naming the next step. */
function contentError(e) {
  process.stdout.write(api.message(e instanceof api.HatchError ? e.code : 'unavailable') + '\n');
  return 1;
}

/** `leader [--for <reader>] [--expert <slug>]`: the software leader's knowledge as text, for the ask skill
 *  (everything) and dream (`--for dream`); with --expert, an agent the person owns. An error line for the
 *  person and exit 1 when it cannot be fetched. */
function cmdLeader(args) {
  const reader = opt(args, '--for') || 'all';
  const slug = opt(args, '--expert');
  if (slug && slug !== ld.LEADER_SLUG) {
    if (process.env.COHDIT_EXPERTS) {
      const p = ld.pack(slug);
      if (!p) return contentError(new api.HatchError('not_owned'));
      process.stdout.write(ld.forReader(p, reader) + '\n');
      return 0;
    }
    return api.fetchContent('expert', slug).then((text) => {
      let p = null;
      try { p = JSON.parse(text); } catch (e) { /* refused below */ }
      if (!p || !Array.isArray(p.knowledge)) return contentError(new Error('pack is not valid'));
      const out = ld.forReader(p, reader);
      if (!out) return fail(slug + ' has nothing for ' + reader);
      process.stdout.write(out + '\n');
      return 0;
    }, contentError);
  }
  const show = (l) => {
    const text = ld.forReader(l, reader);
    if (!text) return fail('the software leader has nothing for ' + reader);
    process.stdout.write(text + '\n');
    return 0;
  };
  if (process.env.COHDIT_LEADER) return show(ld.load());
  return api.fetchContent('data', 'leader').then((text) => {
    let l = null;
    try { l = JSON.parse(text); } catch (e) { /* refused below */ }
    return l && Array.isArray(l.knowledge) ? show(l) : contentError(new Error('leader is not valid'));
  }, contentError);
}

// --- knowledge agents ----------------------------------------------------------------------------

/** "restaurant-ops" → "Restaurant ops", for an agent whose pack or listing cannot be had. */
function slugName(slug) {
  const t = String(slug).replace(/-/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function ideaDir(args) {
  try { return sp.findProject(opt(args, '--dir'), process.cwd()); } catch (e) { return null; }
}

function building(dir) {
  const cur = bd.active(dir);
  return !!(cur && cur.skill === 'build');
}

/** The idea's agents (`experts`) and the ones Hatch has offered (`offered`), as spec.json holds them. */
function ideaAgents(spec) {
  return { use: (spec && Array.isArray(spec.experts) ? spec.experts : []), offered: (spec && Array.isArray(spec.offered) ? spec.offered : []) };
}

function freeClause(n) { return n === 1 ? '1 free question' : n + ' free questions'; }

/** `experts …`: what the person has, offers, free questions, and the link to add an agent. */
function cmdExperts(argv) {
  const sub = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'list';
  const rest = sub === 'list' ? argv : argv.slice(1);
  const slug = words(rest, ['--dir', '--return'])[0];
  const dir = ideaDir(rest);
  if (dir) hint('dir', dir);
  const spec = dir ? ml.readJson(sp.specPath(dir), null) : null;
  const say = (line) => { process.stdout.write(line + '\n'); return 0; };
  const refuse = (why) => { hint('hint', why); return 3; };
  const needSlug = () => (slug && api.SLUG_RE.test(slug) ? null : fail('experts ' + sub + ' needs an agent\'s short name'));

  if (sub === 'list') {
    return api.me({ fresh: hasOpt(rest, '--fresh') }).then((m) => {
      if (hasOpt(rest, '--json')) return say(JSON.stringify({ experts: m.experts || [], available: m.available || [], idea: spec ? ideaAgents(spec) : null }));
      const mine = (m.experts || []).map((e) => (e.slug === ld.LEADER_SLUG ? e.name + ' (always on)' : e.name));
      say('Your agents: ' + mine.join(', ') + '.');
      if ((m.available || []).length) {
        say('You could add:');
        for (const a of m.available) {
          const bits = [a.price, a.free_left ? freeClause(a.free_left) + ' left' : null].filter(Boolean);
          say('- ' + a.name + (a.pitch ? ': ' + a.pitch : '') + (bits.length ? ' (' + bits.join('; ') + ')' : ''));
        }
      }
      return 0;
    }, contentError);
  }
  if (sub === 'manage') {
    return api.manage().then((r) => say('Your billing page (cancel or change a card): ' + r.url), contentError);
  }
  if (sub === 'offer') {
    const bad = needSlug(); if (bad) return bad;
    if (!spec) return refuse('no_idea');
    const idea = ideaAgents(spec);
    if (idea.offered.includes(slug)) return refuse('offered');
    return api.me({}).then((m) => {
      if ((m.experts || []).some((e) => e.slug === slug)) return refuse('owned');
      const a = (m.available || []).find((x) => x.slug === slug);
      if (!a) return refuse('not_available');
      spec.offered = idea.offered.concat(slug);                  // offered once, even if the link fails
      sp.save(dir, spec);
      const head = 'There\'s an agent for this: ' + a.name + '.' + (a.pitch ? ' ' + a.pitch : '') + (a.price ? ' ' + a.price + ', cancel any time.' : '');
      return api.buyLink(slug).then((r) => {
        hint('url', r.url);
        return say(head + (a.free_left ? ' You can ask it ' + freeClause(a.free_left) + ' first, or add it here: ' : ' Add it here: ') + r.url);
      }, () => say(head + ' Say "add ' + a.name + '" later and I\'ll get you the link.'));
    }, contentError);
  }
  if (sub === 'link') {
    const bad = needSlug(); if (bad) return bad;
    return api.me({}).then((m) => {
      if ((m.experts || []).some((e) => e.slug === slug)) return refuse('owned');
      const a = (m.available || []).find((x) => x.slug === slug);
      if (!a) return refuse('not_available');
      return api.buyLink(slug).then((r) => { hint('url', r.url); return say('Add ' + a.name + ' here: ' + r.url); }, contentError);
    }, contentError);
  }
  if (sub === 'ask') {
    const bad = needSlug(); if (bad) return bad;
    let question;
    try { question = readReturn(rest).trim(); } catch (e) { return fail(e.message); }
    if (!question) return fail('experts ask needs the question on stdin');
    return api.me({}).then((m) => {
      if ((m.experts || []).some((e) => e.slug === slug)) return refuse('owned');
      const a = (m.available || []).find((x) => x.slug === slug);
      const name = a ? a.name : slugName(slug);
      return api.askFree(slug, question).then((r) => {
        say(String(r.answer || '').trim());
        if (r.left > 0) return say(freeClause(r.left) + ' left for ' + name + '.');
        return api.buyLink(slug).then((l) => { hint('url', l.url); return say('That was your last free question for ' + name + '. Add it here: ' + l.url); },
          () => say('That was your last free question for ' + name + '.'));
      }, contentError);
    }, contentError);
  }
  if (sub === 'check') {
    if (!spec || building(dir)) return 0;
    const idea = ideaAgents(spec);
    const waiting = idea.offered.filter((x) => !idea.use.includes(x));
    if (!waiting.length) return 0;
    return api.me({ fresh: true }).then((m) => {
      const now = (m.experts || []).filter((e) => waiting.includes(e.slug));
      if (!now.length) return 0;
      spec.experts = idea.use.concat(now.map((e) => e.slug));
      sp.save(dir, spec);
      for (const e of now) say(e.name + ' is yours now. I\'ll use it for this idea.');
      return 0;
    }, () => 0);                                                  // a check that cannot reach Cohdit says nothing
  }
  if (sub === 'use' || sub === 'stop') {
    const bad = needSlug(); if (bad) return bad;
    if (!spec) return refuse('no_idea');
    if (building(dir)) return refuse('building');
    const idea = ideaAgents(spec);
    if (slug === ld.LEADER_SLUG) return refuse('always_on');
    if (sub === 'stop') {
      spec.experts = idea.use.filter((x) => x !== slug);
      sp.save(dir, spec);
      return 0;
    }
    return api.me({}).then((m) => {
      const e = (m.experts || []).find((x) => x.slug === slug);
      if (!e) return refuse('not_owned');
      if (!idea.use.includes(slug)) { spec.experts = idea.use.concat(slug); sp.save(dir, spec); }
      return 0;
    }, contentError);
  }
  return fail('experts takes list, offer, link, ask, check, use, stop or manage');
}

/** `content <kind> <name>`: the playbook, brief or data, with the plugin's own path filled in
 *  (Claude Code substitutes ${CLAUDE_PLUGIN_ROOT} only in files it loads itself). */
function cmdContent(args) {
  const [kind, name] = args;
  if (!kind || !name) return fail('content needs a kind (skill, agent, data) and a name');
  return api.fetchContent(kind, name).then((text) => {
    process.stdout.write(text.split('${CLAUDE_PLUGIN_ROOT}').join(ml.PLUGIN));
    return 0;
  }, contentError);
}

/** `key set <key>` stores and proves the key; `key status` says ok, missing or the error code.
 *  Neither ever prints the key. */
function cmdKey(args) {
  if (args[0] === 'set') {
    if (!args[1]) return fail('key set needs the key');
    return api.setKey(args[1]).then((code) => {
      process.stdout.write((code === 'ok' ? 'ok' : api.message(code)) + '\n');
      return code === 'ok' ? 0 : 1;
    });
  }
  if (args[0] === 'status') {
    return api.keyStatus().then((code) => {
      process.stdout.write(code + '\n');
      return code === 'ok' ? 0 : 1;
    });
  }
  return fail('key takes set or status');
}

/** Commands that need no Hatch data; every other one loads it first. */
const NO_DATA = new Set(['content', 'key', 'allow', 'experts', undefined]);

/** The other agents an idea uses, fetched before a build's synchronous loaders. One that fails is left out. */
function preloadAgents(argv) {
  if (argv[0] !== 'build' || process.env.COHDIT_EXPERTS) return Promise.resolve();
  const name = opt(argv, '--name');
  const hit = name ? sp.registry().projects.find((p) => p.name.toLowerCase() === name.trim().toLowerCase() || p.slug === sp.slugify(name)) : null;
  const dir = name ? (hit ? hit.path : null) : ideaDir(argv);
  const spec = dir ? ml.readJson(sp.specPath(dir), null) : null;
  const slugs = spec && Array.isArray(spec.experts) ? spec.experts.filter((x) => x !== ld.LEADER_SLUG) : [];
  return slugs.length ? api.preloadExperts(slugs) : Promise.resolve();
}

function main(argv) {
  if (NO_DATA.has(argv[0]) || process.env.HATCH_DEV_DIR) return dispatch(argv);
  const agents = argv[0] === 'build' || argv[0] === 'fix';   // they write the read-only agents' files
  return api.preloadData(agents).then(() => preloadAgents(argv)).then(() => dispatch(argv), contentError);
}

function dispatch(argv) {
  switch (argv[0]) {
    case 'content': return cmdContent(argv.slice(1));
    case 'leader': return cmdLeader(argv.slice(1));
    case 'experts': return cmdExperts(argv.slice(1));
    case 'key': return cmdKey(argv.slice(1));
    case 'setup': return cmdSetup();
    case 'doctor': return cmdDoctor();
    case 'wait': return cmdWait(argv.slice(1));
    case 'connect': return cmdConnect(argv.slice(1));
    case 'level': return cmdLevel(argv.slice(1));
    case 'idea': return cmdIdea(argv.slice(1));
    case 'build': return cmdBuild(argv.slice(1));
    case 'try': return cmdTry(argv.slice(1));
    case 'share': return cmdShare(argv.slice(1));
    case 'fix': return cmdFix(argv.slice(1));
    case 'report': return cmdReport(argv.slice(1));
    case 'remember': return cmdRemember(argv.slice(1));
    case 'allow': return cmdAllow();
    default:
      process.stderr.write(USAGE);
      return 64;
  }
}

if (require.main === module) Promise.resolve(main(process.argv.slice(2))).then((code) => { process.exitCode = code; });
module.exports = { main, writeSetupRun, newRunId, appendEvents, allowDecision, withSession };

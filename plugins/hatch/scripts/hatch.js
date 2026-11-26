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
 *                                       the person said yes: hosting, scope, SPEC; ends the run
 *   hatch.js idea refuse <category> [--dir d]
 *   hatch.js idea terms                 the terms text, for "read me the terms"
 *   hatch.js mock open|show [--dir d]   the mock-up: start (or resume) it, writes the designer's brief (next=designer); show reopens it
 *   hatch.js mock drawn --return <json|->
 *                                       the designer's report: the mock is checked against the list, then opened (next=person)
 *   hatch.js mock change --note <text|->
 *                                       the person's change, in their words; the designer draws again
 *   hatch.js mock agree                 the person signed it off: committed, recorded; build may start
 *   hatch.js build open [--dir d | --name n] [--items N|all] [--only bugs|things] [--for <minutes>] [--budget <dollars>]
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
 *   hatch.js status [--dir d | --name n] [--all]
 *                                       what is left to build and what is waiting on you, from the ledger; --all lists the finished too
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
 *                                       an agent's knowledge as text (ask: all; dream: --for dream): the
 *                                       software leader, or with --expert any agent the person owns
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
 * Setup fixes what it can before it looks: it adds Anthropic's design plugin (the mock-up's designer preloads its
 * skill), fetches the GitHub tool into ~/.cohdit/bin when the
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
const mk = require('./lib/mock');
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
const e2 = require('./lib/e2e');
const mt = require('./lib/metrics');
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
  // Anthropic's design plugin, for the mock-up's designer: added through Claude Code's own command; it is ready from the
  // next Claude session on. Never blocks setup when it cannot be added.
  if (!process.env.COHDIT_PROBES && !doc.designInstalled() && doc.installDesign()) hint('hint', 'design_added');
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
      for (const v of sp.vagueChecks(spec)) hint('vague', v);   // for the interviewer: a check nobody could verify
      return 0;
    }
    if (sub === 'change' || sub === 'reopen') {
      const spec = sp.load(dir);
      const local = sp.readLocal(dir);
      const run = newRunId(path.join(cd, 'ledger', 'runs'), ml.utcNow());
      const events = [['RUN_START', runStart('dream')]];
      if (sub === 'change') {
        const res = sp.applyChange(spec, readPatch(rest), sp.loadInterview(), bd.itemStatus(dir, spec));
        events.push(['DECIDE', { type: 'scope', choice: 'changed', who: 'you' }]);
        events.push(['SPEC', { items: spec.items.length, gates_yes: (spec.rails || []).length, held: spec.open_questions.length }]);
        for (const id of res.added) hint('added', id);
        for (const id of res.edited) hint('edited', id);
        hint('next', spec.items.some((i) => i.mock === 'needed') ? 'mock' : 'build');
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
      const events = [];
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
      spec.agreed = true;
      events.push(['SPEC', { items: spec.items.length, gates_yes: spec.rails.length, held: spec.open_questions.length }]);
      events.push(['RUN_END', { outcome: 'ok' }]);
      sp.save(dir, spec);
      const cfg = ml.readJson(path.join(cd, 'config.json'), { v: 1 });
      cfg.hosting = Object.assign({}, (hosting.options[hKey] || {}).config || {}, team ? { scope: team } : {});
      fs.writeFileSync(path.join(cd, 'config.json'), JSON.stringify(cfg, null, 2) + '\n');
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

// --- the mock-up ----------------------------------------------------------------------------------

/** Has this idea been built from before? An idea that was, before mock-ups existed, is never stopped for one. */
function builtBefore(dir) {
  return bd.allRecords(dir).some((r) => r.c === 'PICK' || r.c === 'DONE');
}

/** A mock-up is owed: before the first build of an idea, and for the things a later, bigger change sent to be drawn. */
function mockNeeded(dir, spec) {
  if ((spec.items || []).some((i) => i.mock === 'needed')) return true;
  return !(spec.mock && spec.mock.agreed) && !builtBefore(dir);
}

function mockUrl(dir) {
  return 'file://' + path.join(mk.root(dir), mk.INDEX).split(path.sep).join('/');
}

/** Hand the drawing to the designer: its brief and its instructions beside the spool. */
function toDesigner(dir, spec, local) {
  // What was already loose in the folder before the designer ran (before the first build, Hatch's own files are not
  // committed yet): only what changes after this, outside mock/, is the designer's and thrown away.
  local.mock_before = bd.dirtyPaths(dir).filter((f) => !f.startsWith(mk.DIR + '/'))
    .map((f) => [f, fs.existsSync(path.join(dir, f)) && fs.statSync(path.join(dir, f)).isFile() ? fs.statSync(path.join(dir, f)).mtimeMs : 0]);
  sp.writeLocal(dir, local);
  fs.writeFileSync(path.join(ml.spoolDir(dir), 'mock-brief.md'), mk.brief(dir, spec, local.mock_notes || [], local.mock_look || null));
  bd.writeRole(dir, 'designer');
  hint('brief', path.join(ml.spoolDir(dir), 'mock-brief.md'));
  hint('roles', ml.spoolDir(dir));
  hint('next', 'designer');
}

function cmdMock(argv) {
  const sub = argv[0];
  const rest = argv.slice(1);
  const VALUED = ['--dir', '--return', '--note'];
  try {
    const dir = sp.findProject(opt(rest, '--dir'), process.cwd());
    const cd = sp.cohditDir(dir);
    const spec = sp.load(dir);
    const local = sp.readLocal(dir);
    hint('dir', dir);
    if (!spec.agreed) { hint('hint', 'not_agreed'); return 1; }
    if (sub === 'open') {
      if (!mockNeeded(dir, spec)) {
        process.stdout.write('The mock-up is signed off. Say "build it" when you\'re ready.\n');
        hint('next', 'build');
        return 0;
      }
      if (!local.mock_run || local.mock_done) {                  // a fresh run; an open one resumes where it was
        const run = newRunId(path.join(cd, 'ledger', 'runs'), ml.utcNow());
        appendEvents(cd, run, [['RUN_START', runStart('mock')], ['MOCK', { state: 'drawing' }]]);
        Object.assign(local, { mock_run: run, mock_done: false, mock_contract: 0, mock_round: 0, mock_drawn: false, mock_notes: [] });
        sp.writeLocal(dir, local);
      }
      if (local.mock_drawn && mk.exists(dir)) {                  // drawn already, waiting on the person
        process.stdout.write('The mock-up is at ' + mockUrl(dir) + '\n');
        hint('next', 'person');
        return 0;
      }
      toDesigner(dir, spec, local);
      return 0;
    }
    if (sub === 'skip' && (!local.mock_run || local.mock_done)) {   // skipped before any drawing began
      local.mock_run = newRunId(path.join(cd, 'ledger', 'runs'), ml.utcNow());
      appendEvents(cd, local.mock_run, [['RUN_START', runStart('mock')]]);
      local.mock_done = false;
      sp.writeLocal(dir, local);
    }
    if (!local.mock_run) return fail('no mock-up started here; call mock open first');
    const run = local.mock_run;
    if (sub === 'drawn') {
      let r;
      try { r = mk.designerReturn(readReturn(rest)); } catch (e) {
        if (!(e instanceof mk.Invalid)) throw e;
        return mockAgain(dir, spec, local, e.message);
      }
      const before = new Map(local.mock_before || []);
      const mtime = (f) => (fs.existsSync(path.join(dir, f)) && fs.statSync(path.join(dir, f)).isFile() ? fs.statSync(path.join(dir, f)).mtimeMs : 0);
      const stray = bd.dirtyPaths(dir).filter((f) => !f.startsWith(mk.DIR + '/') && (!before.has(f) || before.get(f) !== mtime(f)));
      if (stray.length) {                                        // the designer writes only the mock: anything else goes
        for (const f of stray) {                                 // a new file goes; a changed one goes back to what it was
          if (before.has(f) || bd.git(['ls-files', '--error-unmatch', '--', f], dir, false) !== null) bd.git(['checkout', '-q', 'HEAD', '--', f], dir, false);
          else fs.rmSync(path.join(dir, f), { force: true, recursive: true });
        }
        return mockAgain(dir, spec, local, 'write only under ' + mk.DIR + '/; these were thrown away: ' + stray.slice(0, 8).join(', '));
      }
      const problems = mk.problems(dir, spec);
      if (problems.length) return mockAgain(dir, spec, local, problems.join('; '));
      local.mock_look = r.look;
      local.mock_drawn = true;
      local.mock_contract = 0;
      local.mock_round = (local.mock_round || 0) + 1;
      sp.writeLocal(dir, local);
      appendEvents(cd, run, [['MOCK', { state: 'drawn', screens: mk.screens(dir).length, round: local.mock_round }]]);
      if (!process.env.COHDIT_PROBES) tools.openUrl(mockUrl(dir));
      process.stdout.write(r.look + '\n\nThe mock-up is open in your browser: ' + mockUrl(dir) + '\n'
        + 'Click through every screen. This is what you will get. Tell me anything to change, or say "that\'s it" to sign it off.\n');
      hint('next', 'person');
      return 0;
    }
    if (sub === 'show') {
      if (!mk.exists(dir)) { hint('next', 'designer'); return fail('nothing drawn yet'); }
      if (!process.env.COHDIT_PROBES) tools.openUrl(mockUrl(dir));
      process.stdout.write('The mock-up is at ' + mockUrl(dir) + '\n');
      hint('next', 'person');
      return 0;
    }
    if (sub === 'change') {
      const n = opt(rest, '--note');
      const note = (n === '-' ? fs.readFileSync(0, 'utf8') : String(n || '')).replace(/\s+/g, ' ').trim();
      if (!note) return fail('change needs --note <what to change, in their words>');
      local.mock_notes = (local.mock_notes || []).concat([note.slice(0, 1500)]);
      local.mock_drawn = false;
      sp.writeLocal(dir, local);
      appendEvents(cd, run, [['MOCK', { state: 'changed' }]]);
      toDesigner(dir, spec, local);
      return 0;
    }
    if (sub === 'agree') {
      if (!local.mock_drawn || !mk.exists(dir)) { hint('hint', 'not_drawn'); return fail('there is no drawn mock-up to sign off'); }
      const problems = mk.problems(dir, spec);
      if (problems.length) { hint('hint', 'not_drawn'); return fail(problems.join('; ')); }
      // Before the first build the folder has no commit yet: the skeleton's first commit takes the mock-up with everything
      // else. After it, the mock-up is committed on its own, so the build's check for a clean folder still passes.
      if (bd.fullSha(dir, 'HEAD') !== null) {
        bd.git(['add', '--', mk.DIR], dir);
        if ((bd.git(['diff', '--cached', '--name-only'], dir, false) || '').trim()) bd.git(['commit', '-q', '-m', 'Hatch: the signed-off mock-up'], dir);
      }
      for (const i of spec.items) if (i.mock === 'needed') i.mock = 'agreed';
      spec.mock = { agreed: ml.utcNow(), screens: mk.screens(dir).length, look: local.mock_look || (spec.mock && spec.mock.look) || '' };
      sp.save(dir, spec);
      appendEvents(cd, run, [['MOCK', { state: 'agreed', screens: spec.mock.screens }], ['DECIDE', { type: 'design', choice: 'mock', who: 'you' }], ['RUN_END', { outcome: 'ok' }]]);
      local.mock_done = true;
      sp.writeLocal(dir, local);
      hint('next', 'build');
      return 0;
    }
    if (sub === 'skip') {                                        // a later change only: the first mock-up of an idea is never skipped
      const owed = (spec.items || []).filter((i) => i.mock === 'needed');
      if (!owed.length || !((spec.mock && spec.mock.agreed) || builtBefore(dir))) { hint('hint', 'no_skip'); return fail('only the mock-up of a later change can be skipped'); }
      for (const i of owed) i.mock = 'skipped';
      sp.save(dir, spec);
      bd.git(['checkout', '-q', '--', mk.DIR], dir, false);        // a half-drawn change to a signed-off mock goes back
      bd.git(['clean', '-qfd', '--', mk.DIR], dir, false);
      appendEvents(cd, run, [['DECIDE', { type: 'design', choice: 'mock_skipped', who: 'you' }], ['RUN_END', { outcome: 'ok' }]]);
      local.mock_done = true;
      sp.writeLocal(dir, local);
      hint('next', 'build');
      return 0;
    }
    return fail('mock needs one of open, drawn, show, change, agree, skip');
  } catch (e) {
    if (e instanceof sp.Invalid) {
      process.stderr.write('hatch: ' + e.message + '\n');
      hint('hint', 'invalid');
      return 64;
    }
    throw e;
  }
}

/** A mock the script will not show: the designer is asked once more with why; a second time the person is told. */
function mockAgain(dir, spec, local, why) {
  local.mock_contract = (local.mock_contract || 0) + 1;
  sp.writeLocal(dir, local);
  process.stderr.write('hatch: ' + why + '\n');
  if (local.mock_contract < 2) { hint('hint', 'reask'); return 64; }
  local.mock_contract = 0;
  sp.writeLocal(dir, local);
  process.stdout.write('I couldn\'t get the mock-up right this time. Say "show me the mock-up" to have another go.\n');
  hint('hint', 'mock_failed');
  hint('next', 'none');
  return 1;
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

/** What one thing has cost so far at list prices, over every run; null when a model has no known price. */
function spentOn(dir, home, item) {
  const prices = ml.loadPrices();
  let usd = 0;
  for (const r of bd.allRecords(home)) {
    if (r.c !== 'USAGE' || r.i !== item || !r.f || !r.f.models) continue;
    const c = ml.usageCost(r.f.models, prices);
    if (c === null) return null;
    usd += c;
  }
  return usd;
}

/** Mid-thing: the maker's spend so far (usage.js records it at each verify and commit) against the limit for one
 *  thing. Over it, the checks and the gate refuse, and the maker is told to stop and report; its report then sets the
 *  thing aside with reason budget. True when over. */
function overLimit(dir, cur, cfg, item) {
  const o = item && cur.open[item];
  if (!o || o.phase !== 'maker') return false;
  const cost = spentOn(dir, bd.homeDir(dir, cur), item);
  if (o.over || (cost !== null && cost >= cfg.caps.usd_per_item)) {
    if (!o.over) { o.over = true; bd.saveActive(dir, cur); }
    process.stdout.write('This thing has reached the cost limit for one thing (about ' + cfg.caps.usd_per_item + ' dollars at list prices). '
      + 'Stop building it. Return your report now: verdict blocked, reason budget, and in text what is done and what is left.\n');
    hint('hint', 'budget');
    return true;
  }
  return false;
}

/** The second pass: each thing set aside for a reason a fresh builder may get past goes back on the list, once
 *  (caps.restarts), unless it has already cost the limit for one thing. Returns how many went back. */
const RETRIABLE = ['other', 'env'];
function secondPass(dir, home, cur, spec, status, cfg, lvl) {
  const all = bd.allRecords(home);
  let n = 0;
  for (const it of spec.items) {
    if (status.get(it.id) !== 'blocked') continue;
    const mine = all.filter((r) => r.i === it.id);
    const last = mine.filter((r) => r.c === 'BLOCKED').sort((x, y) => (x.ts < y.ts ? -1 : 1)).pop();
    if (!last || !RETRIABLE.includes(last.f.reason)) continue;
    if (mine.filter((r) => r.c === 'ROUND' && r.f.cause === 'restart').length >= cfg.caps.restarts) continue;
    const cost = spentOn(dir, home, it.id);
    if (cost !== null && cost >= cfg.caps.usd_per_item) continue;
    const why = (last.f.blob && ml.readBlob(sp.cohditDir(home), last.f.blob, home)) || 'it was set aside';
    const recs = bd.emit(dir, cur.run, [['ROUND', { cause: 'restart' }, it.id],
      ['TRY_RESULT', { result: 'fail', blob: bd.blob(dir, bd.TRIED_AGAIN + String(why).trim().slice(0, 1500)) }, it.id]]);
    say(dir, recs.filter((r) => r.c === 'ROUND'), lvl);
    n += 1;
  }
  return n;
}

/** An item is finished without a merge: set aside or refused. */
function setAside(dir, cur, item, lvl, recs) {
  const o = cur.open[item];
  e2.drop(dir, item);                                            // its browser test is written again if it is tried again
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
  try { bd.noteSetAside(dir, sp.load(dir), item, reason, text); } catch (e) { /* a lesson never stops a run */ }
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
  if (rc === 0 && e2.enabled(cfg)) {                             // then every browser test, this thing's own held copy among them
    const placed = item ? e2.place(dir, item) : [];
    let res = null;
    try { if (e2.hasSpecs(dir)) res = e2.run(dir, cfg); } finally { e2.clear(dir, placed); }
    if (res) {
      if (!res.error) { f.e2e = res.passed; f.e2e_fail = res.tests - res.passed; }
      if (!e2.green(res)) { rc = 1; f.rc = 1; tail = e2.record(res, item); }
      f.dur_s = Math.max(0, Math.round((Date.now() - t0) / 1000));
    }
  }
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
  if (o.e2e && o.e2e.spec) {                                     // the thing's browser test joins the project now, by the script's hand
    if (bd.currentBranch(dir) !== o.branch) bd.git(['checkout', '-q', o.branch], dir);
    const placed = e2.place(dir, item);
    if (placed.length) {
      bd.git(['add', '--'].concat(placed), dir);
      bd.git(['commit', '-q', '-m', 'Hatch: the browser check for ' + item], dir);
    }
  }
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
  const pf = bd.proof(dir, o.base, o.branch, files);           // what proves this thing: its own new tests, and the coverage of what it touched
  const done = { head: bd.headSha(dir, o.branch), touches: touches.join(',') || 'none', tests: pf.tests };
  if (pf.cov !== null) done.cov = pf.cov;
  if (o.cases) {                                                 // which kinds of case its tests cover; rev 1 = the reviewer checked it
    if (o.cases.tested.length) done.cases = o.cases.tested.join(',');
    if (o.cases.na.length) done.na = o.cases.na.join(',');
    done.rev = o.cases.reviewed ? 1 : 0;
  }
  if (o.e2e) { done.e2e = o.e2e.tests || 0; done.red = o.e2e.red ? 1 : 0; if (o.e2e.weak) done.weak = o.e2e.weak; }   // its browser tests, and whether they were seen to fail first
  const recs = (lead || []).concat([['GATE', { result: 'pass' }, item], ['DONE', done, item]]);
  const written = bd.emit(dir, cur.run, recs);
  bd.releaseClaim(dir, o.branch);
  bd.git(['branch', '-q', '-D', o.branch], dir, false);
  e2.drop(dir, item);
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
  if (Array.isArray(o.commits)) o.commits = [];
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
  fs.writeFileSync(bd.briefPath(dir, item), bd.brief(dir, spec, item, cfg, notes, status, o.advice, o.e2e));
  hint('item', item);
  hint('brief', bd.briefPath(dir, item));
  hint('next', 'maker');
}

/** Before the maker: the tester writes this thing's browser test from the person's checks. */
function dispatchTester(dir, cur, spec, item, status) {
  const o = cur.open[item];
  o.phase = 'tester';
  bd.saveActive(dir, cur);
  if (o.retest) e2.place(dir, item);                             // questioned: the tester reads its own test where it wrote it
  fs.writeFileSync(bd.testerPath(dir, item), bd.testerBrief(dir, spec, item, status, o.retest));
  bd.writeRole(dir, 'tester', item);
  hint('item', item);
  hint('brief', bd.testerPath(dir, item));
  hint('roles', ml.spoolDir(dir));
  hint('next', 'tester');
}

/** The tester is done, one way or the other: on to the maker. */
function toMaker(dir, cur, spec, cfg, item, lvl, lead, notes) {
  bd.resetTree(dir);                                             // nothing the tester left in the folder reaches the maker
  bd.emit(dir, cur.run, lead.concat([['DISPATCH', { agent: 'maker', model: bd.agentModel('maker') }, item]]));
  if (notes) cur.open[item].notes = notes;
  dispatchMaker(dir, cur, spec, cfg, item, lvl, notes);
  return 0;
}

/** The maker says the browser test asks for more than the person's checks ("test: …"). The first time, the tester
 *  reads the test again beside the objection and the checks: it rewrites it, or says why it stands. The second
 *  time, the two disagree and the person decides: the thing is set aside as needing them. */
function questionTest(dir, cur, spec, item, lvl, text, lead) {
  const o = cur.open[item];
  if (o.retest) {
    const tester = o.retest.kept ? 'The tester kept the test: ' + o.retest.kept : 'The tester already rewrote the test once.';
    return blocked(dir, cur, item, lvl, 'ambiguous', 'The builder and the tester disagree about the browser test, so this needs you to decide what the check means.\nThe builder: '
      + text.replace(/^\s*test:\s*/i, '') + '\n' + tester, lead);
  }
  o.retest = { objection: text.replace(/^\s*test:\s*/i, '').trim().slice(0, 1500), kept: null };
  o.tcontract = 0;
  bd.resetTree(dir);                                             // the maker's half work stays committed; nothing loose reaches the tester
  const written = bd.emit(dir, cur.run, lead.concat([['ROUND', { cause: 'test' }, item], ['DISPATCH', { agent: 'tester', model: bd.agentModel('tester') }, item]]));
  say(dir, written.filter((x) => x.c === 'ROUND'), lvl);
  dispatchTester(dir, cur, spec, item);
  return 0;
}

/** The tester read the objection and kept its test: back to the maker, told why. */
function testStands(dir, cur, spec, cfg, item, lvl, reason, lead) {
  const o = cur.open[item];
  o.retest.kept = reason;
  return toMaker(dir, cur, spec, cfg, item, lvl, lead, ['You questioned the browser test. The tester read your objection against the person\'s checks and kept it: '
    + reason + ' Build to it. If you are still sure it asks for more than the checks, return blocked with text starting `test:` once more and the person decides.']);
}

/** A test the script will not take: the tester is asked once more with the reason; a second time the thing is
 *  built without a browser test, and says so wherever it is shown. */
function badTest(dir, cur, spec, cfg, item, lvl, why, lead) {
  const o = cur.open[item];
  o.tcontract = (o.tcontract || 0) + 1;
  bd.resetTree(dir);
  if (o.tcontract < 2) {
    bd.saveActive(dir, cur);
    bd.emit(dir, cur.run, lead.concat([['ROUND', { cause: 'contract' }, item]]));
    process.stderr.write('hatch: ' + why + '\n');
    hint('hint', 'reask');
    return 64;
  }
  if (o.retest) return testStands(dir, cur, spec, cfg, item, lvl, 'the tester could not write a usable new test (' + why + '), so the test stays as it was', lead);
  o.e2e = { none: 'no usable browser test could be written' };
  return toMaker(dir, cur, spec, cfg, item, lvl, lead.concat([['FINDING', { scope: 'in', sev: 'medium', blob: bd.blob(dir, 'No browser test for this thing: ' + why) }, item]]));
}

/** A change to the browser tests or their settings by anyone but the script is put back. Returns what it put back. */
function guardTests(dir, cfg) {
  if (!e2.enabled(cfg)) return [];
  const touched = bd.dirtyPaths(dir).filter(e2.isProtected);
  if (!touched.length) return [];
  for (const f of touched) {
    if (bd.git(['ls-files', '--error-unmatch', '--', f], dir, false) === null) fs.rmSync(path.join(dir, f), { force: true });
    else bd.git(['checkout', '-q', 'HEAD', '--', f], dir, false);
  }
  process.stderr.write('hatch: the browser tests are not yours to change; put back: ' + touched.join(', ') + '\n');
  hint('hint', 'protected');
  return touched;
}

/** The same for what the checks run through, and for the maker's own tests: the test runner's settings and
 *  package.json's scripts are put back, and a change that switches a test off is refused. Returns what stopped it. */
function guardChecks(dir, cfg) {
  if (!e2.enabled(cfg)) return [];
  const dirty = bd.dirtyPaths(dir);
  const back = e2.restoreSettings(dir, dirty);
  if (back.length) process.stderr.write('hatch: how the checks run is not yours to change; put back: ' + back.join(', ') + '. If the thing cannot be built without that, return blocked and say why.\n');
  const off = e2.switchedOff(dir, dirty);
  if (off.length) process.stderr.write('hatch: a test is switched off (skip, only or todo) in: ' + off.join(', ') + '. Every test runs; fix it or remove the switch.\n');
  if (back.length || off.length) hint('hint', 'protected');
  return back.concat(off);
}

/** The lenses still to report on an item under review; the skill dispatches exactly these. */
/** The held browser test, as text after the diff the reviewers read: they judge whether it proves the person's check. */
function heldTestText(dir, item, o) {
  if (!o.e2e || !o.e2e.spec) return '';
  const f = path.join(e2.holdDir(dir, item), o.e2e.spec);
  if (!fs.existsSync(f)) return '';
  return '\n\n# The browser test this thing had to pass: ' + o.e2e.spec + '\n# The builder never saw it and cannot change it. It is not part of the change above.\n\n' + fs.readFileSync(f, 'utf8');
}

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

/** The ids of the things not done yet (queued, building, set aside), for telling a returning bug from a repeated one. */
function notDone(dir) {
  const spec = sp.load(dir);
  const st = bd.itemStatus(dir, spec);
  return new Set(spec.items.filter((i) => !['done', 'tried'].includes(st.get(i.id))).map((i) => i.id));
}

/** Every report waiting in `.cohdit/reports/` (pulled from the live app's store first) becomes a bug on
 *  the list; the files are removed once in. Returns the new bugs. */
function importReports(dir, cfg) {
  const into = path.join(sp.cohditDir(dir), 'reports');
  sh.pullReports(doc.runner(), dir, cfg, (cfg.hosting || {}).scope || null, into);
  const bugs = [];
  bugs.filed = [];                                               // ids of the bugs the person filed in words
  for (const f of ml.listFiles(into, '.json')) {
    const r = ml.readJson(f, null);
    if (r && r.saw) {
      const bug = sp.addBug(dir, reportBug(r), notDone(dir));
      if (!bug.twin) { bugs.push(bug); if (r.filed) bugs.filed.push(bug.id); }
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

/** How much this run takes on: `--items N|all` (a count, or the whole list), `--only bugs|things`, and
 *  how long and how much it may spend: `--for <minutes>` (stop picking new things after that long; what is
 *  in hand finishes) and `--budget <dollars>` (the same, by the run's own spend). With a limit and no count
 *  the run is the whole list: the limit is what ends it. Null when none is given: the project's caps then
 *  bound the run as before. */
function runWant(argv) {
  const raw = opt(argv, '--items'), only = opt(argv, '--only'), mins = opt(argv, '--for'), usd = opt(argv, '--budget');
  if (raw === undefined && only === undefined && mins === undefined && usd === undefined) return null;
  const out = { items: mins !== undefined || usd !== undefined ? null : bd.DEFAULT_ITEMS, only: null, minutes: null, usd: null };
  if (mins !== undefined) {
    if (!/^[1-9]\d{0,3}$/.test(String(mins)) || Number(mins) > 2880) throw new bd.Invalid('--for takes minutes, from 1 to 2880');
    out.minutes = parseInt(mins, 10);
  }
  if (usd !== undefined) {
    if (!/^[1-9]\d{0,3}$/.test(String(usd))) throw new bd.Invalid('--budget takes whole dollars, from 1');
    out.usd = parseInt(usd, 10);
  }
  if (raw !== undefined) {
    if (raw === 'all') out.items = null;
    else if (/^[1-9]\d{0,2}$/.test(String(raw))) out.items = parseInt(raw, 10);
    else throw new bd.Invalid('--items takes a number from 1 or "all"');
  }
  if (only !== undefined) {
    if (only !== 'bugs' && only !== 'things') throw new bd.Invalid('--only takes "bugs" or "things"');
    out.only = only;
  }
  return out;
}

function cmdBuild(argv) {
  const session = opt(argv, '--session') || null;             // the hook may add it anywhere after `build`
  const args = stripOpt(argv, '--session');
  const sub = args[0];
  const rest = args.slice(1);
  const VALUED = ['--dir', '--name', '--return', '--agent', '-m', '--items', '--only', '--for', '--budget'];
  try {
    let dir = buildDir(rest);
    let lvl = bd.level(dir);
    hint('level', lvl);
    if (sub === 'open') {
      const want = runWant(rest);
      const spec = sp.load(dir);
      if (spec.refused) {
        hint('dir', dir);
        say(dir, [bd.stopBefore(dir, 'refused').stop], lvl);
        hint('hint', 'refused');
        return 5;
      }
      if (!spec.agreed) { hint('dir', dir); hint('hint', 'not_agreed'); return 1; }
      if (mockNeeded(dir, spec)) {                               // nothing is built until the person signed off what they will see
        hint('dir', dir);
        process.stdout.write('Before I build anything, you see a mock-up of it. Say "show me the mock-up".\n');
        hint('hint', 'mock_needed');
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
      if (want && !cur.lead) {                                   // the latest ask wins; a count counts from now
        const done = bd.laneGroup(dir, cur).reduce((n, g) => n + (g.cur.picked || []).length, 0);
        cur.want = { items: want.items === null ? null : done + want.items, only: want.only };
        if (want.minutes) cur.want.until = ml.fmtTs(new Date(ml.parseTs(ml.utcNow()).getTime() + want.minutes * 60000));
        if (want.usd) cur.want.usd = want.usd;
        bd.saveActive(dir, cur);
      }
      bd.setPointer(dir, cur.run, session);
      if (bd.scaffold(dir, spec, cfg)) hint('hint', 'scaffolded');
      else if (!Object.keys(cur.open || {}).length) bd.ensureLineCoverage(dir);
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
        const lanes = bd.openLanes(dir, cur, spec, bd.readCfg(dir), session, cur.narrow ? 1 : bd.laneCount(bd.readCfg(dir), spec, bd.itemStatus(dir, spec), cur.want && cur.want.items !== null ? { items: Math.max(1, cur.want.items - (cur.picked || []).length), only: cur.want.only } : cur.want));
        if (lanes.length) hint('lanes', lanes.join(','));
      }
      for (const x of (spec.experts || []).filter((e) => !ld.pack(e))) {
        process.stdout.write(slugName(x) + ' isn\'t available right now, so this build goes on without it.\n');
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
        else if (o.phase === 'tester') {
          if (bd.currentBranch(dir) !== o.branch) bd.git(['checkout', '-q', o.branch], dir);
          dispatchTester(dir, cur, spec, item);
        } else {
          if (bd.currentBranch(dir) !== o.branch) bd.git(['checkout', '-q', o.branch], dir);
          dispatchMaker(dir, cur, spec, cfg, item, lvl, o.notes);
        }
        return 0;
      }
      // A lane takes nothing new once the lead stopped, narrowed to one lane, or let it go.
      if (cur.lead && (lead.cur.stop || lead.cur.narrow || !(lead.cur.lanes || []).includes(dir))) { hint('next', 'close'); return 0; }
      let busy = group.some((g) => g.dir !== dir && Object.keys(g.cur.open || {}).length);   // another lane is mid-thing
      const ease = (cause) => {                                  // a cap: lanes finish what they hold; the lead stops last
        if (cur.lead) { hint('next', 'close'); return 0; }
        if (busy) { hint('next', 'wait'); return 0; }
        stopRun(dir, cur, cause, lvl);
        return 0;
      };
      const picks = group.reduce((n, g) => n + (g.cur.picked || []).length, 0);
      const want = lead.cur.want || null;                        // what the person asked for: a count, or the whole list
      if (want) {
        if (want.items !== null && picks >= want.items) return ease('cap');
        if (want.until && ml.utcNow() >= want.until) return ease('time');
        if (want.usd) {
          const c = new render.Ctx({ level: lvl, cohdit: sp.cohditDir(home), spool: bd.spoolFile(dir) });
          const u = c.usage(c.runs.get(cur.run) || []);
          if (u.usd !== null && u.usd >= want.usd) return ease('budget');
        }
      } else {                                                   // asked for nothing: the project's caps, as before
        if (picks >= cfg.caps.items_per_run) return ease('cap');
        const c = new render.Ctx({ level: lvl, cohdit: sp.cohditDir(home), spool: bd.spoolFile(dir) });
        const u = c.usage(c.runs.get(cur.run) || []);
        if (u.usd !== null && u.usd >= cfg.caps.usd_per_run) return ease('budget');
      }
      const sb = bd.startBase(dir);                              // the shared main and this computer's own unpushed commits
      const base = sb.base;
      if (sb.push) bd.emit(dir, cur.run, [['PUSH', { branch: 'main', result: sb.push }]]);
      let status = bd.itemStatus(home, spec), claims = bd.remoteClaims(dir);
      const held = new Set(group.flatMap((g) => Object.keys(g.cur.open || {})));
      let picked = null, branch = null, start = null;
      for (let tries = 0; tries < 4 && !picked; tries++) {
        let cands = bd.candidates(dir, spec, status, claims).filter((i) => !held.has(i.id) && bd.wanted(want, i));
        // Nothing left to pick and no lane mid-thing: what was set aside for a reason a fresh builder may get past
        // goes back on the list once, with what stopped it. What waited on it can then be built too.
        if (!cands.length && !busy && !cur.lead && secondPass(dir, home, cur, spec, status, cfg, lvl)) {
          status = bd.itemStatus(home, spec);
          cands = bd.candidates(dir, spec, status, claims).filter((i) => !held.has(i.id) && bd.wanted(want, i));
        }
        if (!cands.length) break;
        const it = cands[0];
        const b = bd.branchFor(it);
        try { start = bd.startItem(dir, b, base, it.id); } catch (e) {
          if (!/already (used|checked out)/i.test(String(e && e.message))) throw e;
          held.add(it.id); busy = true; continue;                // another lane on this computer opened it a moment ago
        }
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
      const first = e2.enabled(cfg) ? 'tester' : 'maker';        // with browser checks, the test is written before the thing
      cur.open[picked.id] = { branch, base, start, fork: bd.headSha(dir, base), picked_at: ml.utcNow(), rounds: 0, contract: 0, phase: first, commits: [] };
      cur.picked.push(picked.id);
      const recs = bd.emit(dir, cur.run, [['PICK', { branch, fork: bd.headSha(dir, base) }, picked.id], ['DISPATCH', { agent: first, model: bd.agentModel(first) }, picked.id]]);
      say(dir, [recs[0]], lvl);
      status.set(picked.id, 'building');
      if (first === 'tester') dispatchTester(dir, cur, spec, picked.id, status);
      else dispatchMaker(dir, cur, spec, cfg, picked.id, lvl, undefined, status);   // read on the main line, before the branch switch
      return 0;
    }
    if (sub === 'verify') {
      if (overLimit(dir, cur, cfg, Object.keys(cur.open)[0])) return 1;
      if (guardTests(dir, cfg).length + guardChecks(dir, cfg).length) return 1;
      return verifyNow(dir, cur, cfg, lvl) === 0 ? 0 : 1;
    }
    if (sub === 'commit') {
      const msg = opt(rest, '-m');
      if (!msg) return fail('commit needs -m <message>');
      const item = Object.keys(cur.open)[0];
      if (!item) return fail('nothing is being built; there is no branch to commit on');
      if (cur.open[item].phase === 'tester') return fail('the test for ' + item + ' is still being written; nothing to commit yet');
      if (overLimit(dir, cur, cfg, item)) return 1;
      if (guardTests(dir, cfg).length + guardChecks(dir, cfg).length) return 1;
      if (verifyNow(dir, cur, cfg, lvl) !== 0) { hint('hint', 'checks_failed'); return 1; }
      bd.git(['add', '-A', '--', '.', ':(exclude).cohdit'], dir);
      const staged = (bd.git(['diff', '--cached', '--name-only'], dir, false) || '').split('\n').filter((f) => f && !f.startsWith('.cohdit/'));
      if (!staged.length) { hint('hint', 'nothing_to_commit'); return 1; }
      bd.git(['commit', '-q', '-m', msg], dir);
      if (Array.isArray(cur.open[item].commits)) { cur.open[item].commits.push(bd.fullSha(dir, 'HEAD')); bd.saveActive(dir, cur); }   // the gate's own, by name
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
    if (sub === 'tested') {                                      // the tester's report: its one file is checked, seen to fail, and held
      const item = words(rest, VALUED)[0];
      if (!item || !cur.open[item]) return fail('tested needs an open ITEM-NNN (open: ' + (Object.keys(cur.open).join(', ') || 'none') + ')');
      const o = cur.open[item];
      if (o.phase !== 'tester') { hint('hint', 'wrong_phase'); return fail(item + ' is with the ' + o.phase + ', not the tester; this report was not expected'); }
      let r;
      try { r = e2.testerReturn(readReturn(rest)); } catch (e) {
        if (!(e instanceof e2.Invalid)) throw e;
        return badTest(dir, cur, spec, cfg, item, lvl, e.message, []);
      }
      const lead = [['RETURN', { agent: 'tester', verdict: r.verdict }, item]];
      if (r.verdict === 'stands') {
        if (!o.retest) return badTest(dir, cur, spec, cfg, item, lvl, 'stands is only for a test the builder questioned; write the test', []);
        return testStands(dir, cur, spec, cfg, item, lvl, r.reason, lead);
      }
      if (r.verdict === 'none') {
        o.e2e = { none: r.reason };
        return toMaker(dir, cur, spec, cfg, item, lvl, lead.concat([['FINDING', { scope: 'in', sev: 'low', blob: bd.blob(dir, 'No browser test for this thing: ' + r.reason) }, item]]));
      }
      const want = e2.specName(item);
      const changed = bd.dirtyPaths(dir);
      if (!changed.includes(want)) return badTest(dir, cur, spec, cfg, item, lvl, 'no test was written at ' + want, lead);
      const stray = changed.filter((f) => f !== want);
      if (stray.length) return badTest(dir, cur, spec, cfg, item, lvl, 'write only ' + want + '; these were changed as well and are thrown away: ' + stray.slice(0, 8).join(', '), lead);
      const problems = e2.lint(fs.readFileSync(path.join(dir, want), 'utf8'));
      if (problems.length) return badTest(dir, cur, spec, cfg, item, lvl, 'the test breaks these rules: ' + problems.join('; '), lead);
      const it = spec.items.find((i) => i.id === item);
      const missing = e2.uncovered(fs.readFileSync(path.join(dir, want), 'utf8'), it.criteria);
      if (missing.length) return badTest(dir, cur, spec, cfg, item, lvl, 'each of the person\'s checks needs one test titled with it, word for word. Not found: ' + missing.map((c) => '"' + c + '"').join('; '), lead);
      const env = Object.assign({}, process.env, { PATH: tools.pathWithExtras(), CI: '1' });
      const b = spawnSync(cfg.e2e.build || 'npm run build', { cwd: dir, shell: true, encoding: 'utf8', timeout: bd.LONG_MS, env });
      if (b.status !== 0) return badTest(dir, cur, spec, cfg, item, lvl, 'the app does not build with your test in it: ' + ((b.stdout || '') + (b.stderr || '')).trim().split('\n').slice(-12).join(' | '), lead);
      const res = e2.run(dir, cfg, { files: [want], once: true });
      if (res.error) return badTest(dir, cur, spec, cfg, item, lvl, 'the test could not run: ' + res.error.split('\n').slice(-8).join(' | '), lead);
      if (res.skipped || !res.tests) return badTest(dir, cur, spec, cfg, item, lvl, 'the file has ' + (res.tests ? 'a skipped test' : 'no test that ran'), lead);
      const red = res.failed > 0;
      if (!red && !o.tcontract && !o.retest) return badTest(dir, cur, spec, cfg, item, lvl, 'every test passes before the thing is built, so it tests nothing new. Test what this thing adds', lead);
      e2.hold(dir, item, [want]);
      // A rewrite after the builder started need not fail first, and is not said to have: red is what was seen.
      o.e2e = { spec: want, tests: res.tests, red: red ? 1 : 0, checks: (it.criteria || []).length };
      if (r.stand_ins.length) o.e2e.stand_ins = r.stand_ins;
      return toMaker(dir, cur, spec, cfg, item, lvl, lead, o.retest ? ['You questioned the browser test and the tester rewrote it. Build to the new test: verify shows what it looks for.'] : undefined);
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
        if (r.measured && r.measured.length) bd.writeMeasured(bd.homeDir(dir, cur), item, r.measured);
        if (r.words) bd.markWords(bd.homeDir(dir, cur), item);
        if (r.verdict === 'refused') {
          cur.stop = 'refused';
          if (cur.lead) { const L = bd.laneGroup(dir, cur)[0]; L.cur.stop = 'refused'; bd.saveActive(L.dir, L.cur); }
          setAside(dir, cur, item, lvl, lead.concat([['REFUSE', { category: r.refused }, item], ['STOP', { cause: 'refused' }, item]]));
          hint('next', 'close');
          return 1;
        }
        // Over the limit for one thing, whatever the maker gave as the reason: set aside for cost, so the second pass
        // does not start it again (secondPass skips budget), and status says why.
        if (o.over && r.verdict !== 'done') return blocked(dir, cur, item, lvl, 'budget', 'this thing reached the limit for one thing (about ' + cfg.caps.usd_per_item + ' dollars at list prices) while it was being built' + (r.verdict === 'blocked' ? ':\n' + r.blocked.text : ''), lead);
        if (r.verdict === 'blocked' && /^\s*test:/i.test(r.blocked.text) && o.e2e && o.e2e.spec) return questionTest(dir, cur, spec, item, lvl, r.blocked.text, lead);
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
        o.cases = r.cases ? { tested: r.cases.tested, na: r.cases.na, reviewed: false } : null;   // read at DONE; the checker may take kinds off
        const unmet = (r.criteria || []).filter((c) => !c.met).map((c) => c.n);
        if (unmet.length) return blocked(dir, cur, item, lvl, 'other', 'the maker reported done but check ' + unmet.join(', ') + ' is not met', lead);
        const n = Number(bd.git(['rev-list', '--count', (o.start || o.base) + '..' + o.branch], dir, false) || 0);
        if (!n) return blocked(dir, cur, item, lvl, 'other', 'the maker reported done but nothing was committed through the gate', lead);
        if (Array.isArray(o.commits)) {                          // every commit on the thing is one `build commit` made: nothing reaches main past the checks
          const made = (bd.git(['rev-list', (o.start || o.base) + '..' + o.branch], dir, false) || '').split('\n').filter(Boolean);
          const past = made.filter((sha) => !o.commits.includes(sha));
          if (past.length) return blocked(dir, cur, item, lvl, 'other', past.length + ' commit(s) on this thing were not made through the gate, so the checks never ran on them', lead);
        }
        const files = (bd.git(['diff', '--name-only', o.base + '..' + o.branch], dir, false) || '').split('\n').filter(Boolean);
        const diff = bd.git(['diff', o.base + '..' + o.branch], dir, false) || '';
        const risk = bd.risk(r.change, files, spec, diff, bd.dependencies(dir));
        lead.push(['RISK', { tier: risk.tier, signals: risk.signals.join(',') }, item]);
        const lenses = bd.lensesFor(risk);
        if (!lenses.length) return gate(dir, cur, spec, item, lvl, lead);
        fs.writeFileSync(bd.diffPath(dir, item), diff + heldTestText(dir, item, o) + mk.reviewSection(dir, item));
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
      o.review.got[agent] = { verdict: r.verdict, must_fix: r.must_fix, nits: r.nits, unproved: r.unproved || [] };
      bd.saveActive(dir, cur);
      bd.emit(dir, cur.run, [['REVIEW', { must_fix: r.must_fix.length, nits: r.nits, agent }, item], ['RETURN', { agent, verdict: r.verdict }, item]]);
      if (o.review.expected.some((a) => !o.review.got[a])) { awaitReview(dir, item, o); return 0; }
      const got = o.review.got;
      if (o.cases && got.checker) {                              // the reviewer's word over the builder's own tags
        o.cases.tested = o.cases.tested.filter((k) => !got.checker.unproved.includes(k));
        o.cases.reviewed = true;
      }
      // What a reviewer says against the browser test goes to the person, not the builder: the builder never sees
      // that test and cannot change it. The thing is marked so the person checks it with care.
      const onTest = (m) => /^e2e\//.test(String(m.ref || ''));
      const weak = o.review.expected.flatMap((a) => got[a].must_fix.filter(onTest).map((m) => m.text));
      if (weak.length && o.e2e) {
        o.e2e.weak = (o.e2e.weak || 0) + weak.length;
        bd.emit(dir, cur.run, weak.map((w) => ['FINDING', { scope: 'in', sev: 'medium', blob: bd.blob(dir, 'The browser test may prove less than the check: ' + w) }, item]));
      }
      const notes = o.review.expected.flatMap((a) => got[a].must_fix.filter((m) => !onTest(m)).map((m) => (a === 'checker' ? '' : '[' + a.replace('lens-', '') + '] ') + (m.ref ? m.ref + ': ' : '') + m.text));
      delete o.review;
      if (!notes.length) return gate(dir, cur, spec, item, lvl, []);
      o.rounds += 1;
      const cost = spentOn(dir, bd.homeDir(dir, cur), item);
      if (cost !== null && cost >= cfg.caps.usd_per_item) {
        return blocked(dir, cur, item, lvl, 'budget', 'this thing reached the limit for one thing (about ' + cfg.caps.usd_per_item + ' dollars at list prices) with the review still asking for changes:\n' + notes.join('\n'), [['ROUND', { cause: 'review' }, item]]);
      }
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
    if (sub === 'retry') {                                       // a set-aside thing goes back on the list, with what stopped it
      const spec = sp.load(dir);
      const st = bd.itemStatus(dir, spec);
      const named = words(rest, VALUED);
      const ids = (named.length ? named : spec.items.map((i) => i.id)).filter((id) => st.get(id) === 'blocked');
      if (!ids.length) { hint('hint', 'nothing_set_aside'); hint('next', 'next'); return 0; }
      const all = bd.allRecords(dir);
      for (const id of ids) {
        const last = all.filter((r) => r.c === 'BLOCKED' && r.i === id).sort((x, y) => (x.ts < y.ts ? -1 : 1)).pop();
        const why = (last && last.f && last.f.blob && ml.readBlob(sp.cohditDir(dir), last.f.blob, dir)) || 'it was set aside';
        const recs = bd.emit(dir, cur.run, [['TRY_RESULT', { result: 'fail', blob: bd.blob(dir, bd.TRIED_AGAIN + String(why).trim().slice(0, 1500)) }, id]]);
        say(dir, recs, lvl);
      }
      hint('retried', ids.join(','));
      hint('next', 'next');
      return 0;
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
      shareNumbers(dir, cur.run);
      if (!bd.isPrimary(dir) && landed) bd.removeSideCopy(dir);  // a copy that could not land is kept and landed by the next open
      hint('next', done ? 'try' : 'none');
      return cur.stop ? 1 : 0;
    }
    return fail('build needs one of open, next, verify, commit, add, tested, built, checked, advised, narrow, close');
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
const READ_TOOLS = ['Read', 'Glob', 'Grep'];     // a maker in a second lane works in a side copy outside the session's folder

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
  if (EDIT_TOOLS.includes(tool) || READ_TOOLS.includes(tool)) {
    const fp = inp.file_path || inp.notebook_path || inp.path;
    if (!fp) return null;
    const abs = path.resolve(fp);
    if (abs.split(path.sep).includes('.git') || /(^|[\\/])\.env(\.|$)/.test(abs)) return null;
    for (const p of projects) {
      const root = path.resolve(p);
      if (abs === root || abs.startsWith(root + path.sep)) return READ_TOOLS.includes(tool) ? 'Hatch: reading inside its own project folder' : 'Hatch: a file inside its own project folder';
    }
  }
  return null;
}

/** Why a tool call is refused outright, in every permission mode, or null. Hatch's own records and settings
 *  inside a project (`.cohdit/`: the checks' command and floor live there) change only through the script, so no
 *  edit tool may write them; and the browser tests held away from the maker are neither read nor written. */
function denyDecision(h, projects, home, hatchPath) {
  const tool = h.tool_name;
  const inp = h.tool_input || {};
  // Inside one of Hatch's own agents the hook is told which (`agent_type`, e.g. hatch:maker), and holds it to its job:
  // the maker and the runner run this script and nothing else; the maker writes no browser test; the tester writes
  // only its one. The script checks all of this again on the files themselves, whatever the hook was told.
  const role = /(?:^|:)(maker|runner|tester|designer)$/.exec(String(h.agent_type || ''));
  if (role) {
    const who = role[1];
    if (tool === 'Bash' && (who === 'maker' || who === 'runner') && hatchPath && !allowDecision(h, projects, hatchPath)) return 'Hatch: the ' + who + ' runs Hatch\'s own script, one call at a time, and nothing else';
    const target = inp.file_path || inp.notebook_path;
    if (EDIT_TOOLS.includes(tool) && target) {
      const rel = path.resolve(target).split(path.sep).join('/');
      const test = /\/e2e\/[^/]+$|\/playwright\.config\.[^/]+$/.test(rel);
      if (who === 'maker' && test) return 'Hatch: the browser tests are not the maker\'s to write or change';
      if (who === 'tester' && !/\/e2e\/item-\d+\.spec\.ts$/.test(rel)) return 'Hatch: the tester writes one file, e2e/item-NNN.spec.ts, and nothing else';
      if (who === 'runner') return 'Hatch: the runner edits nothing';
      if (who === 'designer' && !/\/mock\/[^/][^]*$/.test(rel)) return 'Hatch: the designer writes the mock-up, under mock/, and nothing else';
    }
  }
  if (!EDIT_TOOLS.includes(tool) && !READ_TOOLS.includes(tool)) return null;
  const fp = inp.file_path || inp.notebook_path || inp.path;
  if (!fp) return null;
  const abs = path.resolve(fp);
  const held = path.join(path.resolve(home), '.cohdit', 'held');
  if (abs === held || abs.startsWith(held + path.sep)) return 'Hatch: the browser tests are held here until the thing passes them; they are not read or changed before then';
  if (!EDIT_TOOLS.includes(tool)) return null;
  for (const p of projects) {
    const own = path.join(path.resolve(p), ml.COHDIT_DIR);
    if (abs === own || abs.startsWith(own + path.sep)) return 'Hatch: its own records and settings change only through its script';
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
    // Hatch's own agents at work: the heartbeat status reads to tell a quiet build from one whose session went away.
    if (/^hatch:/.test(String(h.agent_type || '')) && h.cwd) ml.touchBeat(h.cwd);
    const no = denyDecision(h, projects, sp.homeDir(), __filename);
    if (no) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: no } }) + '\n');
      return 0;
    }
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
    if (!cur || cur.skill !== 'fix') { hint('hint', 'no_run'); process.stderr.write('hatch: no scan here; say "scan it" first\n'); return 2; }
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
        const bug = sp.addBug(dir, { title: m.text, criteria: [text], source: 'scan', by: agent }, notDone(dir));
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
      r.filed = true;                                            // the person's own: said back as filed, not as a report
      fs.writeFileSync(path.join(into, r.at.replace(/[^0-9A-Za-z]/g, '') + '.json'), JSON.stringify(r) + '\n');
    } else if (sub !== 'pull') return fail('report needs one of add, pull');
    const bugs = importReports(dir, cfg);
    const filed = bugs.filter((b) => bugs.filed.includes(b.id));
    const pulled = bugs.length - filed.length;
    if (sub === 'add') {
      for (const b of filed) sayLine(dir, lvl, 'filed', b.title);
      if (!filed.length) sayLine(dir, lvl, 'filedTwin');
      if (pulled) sayLine(dir, lvl, 'reported', pulled);
      const spec = sp.load(dir), st = bd.itemStatus(dir, spec);
      const waiting = spec.items.filter((i) => i.kind === 'bug' && st.get(i.id) === 'queued').length;
      if (waiting) sayLine(dir, lvl, 'bugsWaiting', waiting);
    } else sayLine(dir, lvl, 'reported', bugs.length);
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

// --- status -------------------------------------------------------------------------------------

/** Where things stand. The list's states come from the ledger (render.js status), never from the
 *  `status` field spec.json was written with. */
function cmdStatus(rest) {
  try {
    const dir = buildDir(rest);
    const lvl = bd.level(dir);
    hint('level', lvl);
    hint('dir', dir);
    render.main(['status', '--cohdit', sp.cohditDir(dir), '--level', lvl].concat(rest.includes('--all') ? ['--all'] : []));
    const spec = sp.load(dir), st = bd.itemStatus(dir, spec);
    const left = spec.items.filter((i) => !i.device && st.get(i.id) === 'queued').length;
    const toTry = spec.items.some((i) => st.get(i.id) === 'done');
    hint('next', left ? 'build' : toTry ? 'try' : 'none');
    if (mt.status() === 'on') mt.flush().catch(() => {});   // numbers left from an offline run
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

// --- anonymous build numbers (lib/metrics.js) ----------------------------------------------------

const METRICS_ASK = 'Hatch can share anonymous numbers about each build (how long it took, how many things finished, '
  + 'how much it cost) so Cohdit can make Hatch better. Never your idea, words, code or files. '
  + 'Say "share my build numbers" to turn it on or "don\'t share" to leave it off. "what do you send" shows exactly what would go.';

/** After a build run closes: send its numbers if the person said yes (in the background, never blocking),
 *  or ask once if they have not been asked. */
function shareNumbers(dir, run) {
  try {
    const st = mt.status();
    if (st === 'ask') { if (mt.askedOnce()) process.stdout.write(METRICS_ASK + '\n'); return; }
    if (st !== 'on') return;
    const c = new render.Ctx({ level: 'tech', cohdit: sp.cohditDir(dir) });
    mt.record(c, run, render).catch(() => {});
  } catch (e) { /* numbers never get in the way of a build */ }
}

/** `scorecard`: how the builds have gone, at the person's level. */
function cmdScorecard(rest) {
  try {
    const dir = buildDir(rest);
    const lvl = bd.level(dir);
    hint('level', lvl);
    render.main(['score', '--cohdit', sp.cohditDir(dir), '--level', lvl]);
    return 0;
  } catch (e) {
    if (e instanceof sp.Invalid || e instanceof bd.Invalid) { process.stderr.write('hatch: ' + e.message + '\n'); return 64; }
    throw e;
  }
}

/** `metrics [on|off|show]`: the person's choice about sharing anonymous build numbers. */
function cmdMetrics(argv) {
  const sub = argv[0];
  if (sub === 'on' || sub === 'off') {
    mt.set(sub);
    process.stdout.write(sub === 'on'
      ? 'Sharing anonymous build numbers is on. Say "don\'t share" to turn it off, "what do you send" to see exactly what goes.\n'
      : 'Sharing build numbers is off. Nothing is sent.\n');
    return 0;
  }
  if (sub === 'show') {
    try {
      const dir = buildDir(argv.slice(1));
      const c = new render.Ctx({ level: 'tech', cohdit: sp.cohditDir(dir) });
      const ended = c.recs.filter((r) => r.c === 'RUN_END').map((r) => r.r).filter((r) => c.recs.some((x) => x.r === r && x.c === 'RUN_START' && x.f.skill === 'build'));
      const p = ended.length ? mt.build(c, ended[ended.length - 1], render) : null;
      if (!p) { process.stdout.write('No finished build yet, so nothing would be sent.\n'); return 0; }
      process.stdout.write('This is everything Hatch would send for your last build. Numbers and fixed labels only:\n' + JSON.stringify(p, null, 2) + '\n');
      process.stdout.write('Status: ' + (mt.status() === 'on' ? 'on, this is sent after each build.' : 'not on, so none of it is sent.') + '\n');
      return 0;
    } catch (e) {
      if (e instanceof sp.Invalid || e instanceof bd.Invalid) { process.stderr.write('hatch: ' + e.message + '\n'); return 64; }
      throw e;
    }
  }
  if (sub === 'send') {
    return mt.flush().then((n) => { process.stdout.write(n + ' sent.\n'); return 0; });
  }
  const st = mt.status();
  process.stdout.write(st === 'on' ? 'Sharing anonymous build numbers: on. "what do you send" shows it; "don\'t share" turns it off.\n'
    : st === 'off' ? 'Sharing anonymous build numbers: off. Nothing is sent.\n' : METRICS_ASK + '\n');
  return 0;
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

/** `leader [--for <reader>] [--expert <slug>]`: an agent's knowledge as text, for the ask skill (everything) and
 *  dream (`--for dream`): the software leader, or with --expert any agent the person owns. An error line for
 *  the person and exit 1 when it cannot be had; a software leader the person does not own says how to add it. */
const LEADER_SLUG = 'software-leader';
function cmdLeader(args) {
  const reader = opt(args, '--for') || 'all';
  const slug = opt(args, '--expert') || LEADER_SLUG;
  const show = (p) => {
    const out = ld.forReader(p, reader);
    if (!out) return fail((p.name || slug) + ' has nothing for ' + reader);
    process.stdout.write(out + '\n');
    return 0;
  };
  const notOwned = () => {
    if (slug !== LEADER_SLUG) return contentError(new api.HatchError('not_owned'));
    process.stdout.write('The software leader isn\'t one of your agents yet. Say "what agents are there" to add it.\n');
    return 1;
  };
  if (process.env.COHDIT_EXPERTS) {
    const p = ld.pack(slug);
    return p ? show(p) : notOwned();
  }
  return api.fetchContent('expert', slug).then((text) => {
    let p = null;
    try { p = JSON.parse(text); } catch (e) { /* refused below */ }
    if (!p || !Array.isArray(p.knowledge)) return contentError(new Error('pack is not valid'));
    return show(p);
  }, (e) => (e instanceof api.HatchError && e.code === 'not_owned' ? notOwned() : contentError(e)));
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
      const mine = (m.experts || []).map((e) => e.name);
      say(mine.length ? 'Your agents: ' + mine.join(', ') + '.' : 'You have no agents yet; Hatch builds with your own model.');
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
  const slugs = spec && Array.isArray(spec.experts) ? spec.experts.filter((x) => typeof x === 'string') : [];
  return slugs.length ? api.preloadExperts(slugs) : Promise.resolve();
}

function main(argv) {
  if (NO_DATA.has(argv[0]) || process.env.HATCH_DEV_DIR) return dispatch(argv);
  const agents = argv[0] === 'build' || argv[0] === 'fix' || argv[0] === 'mock';   // they write the agents' files
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
    case 'mock': return cmdMock(argv.slice(1));
    case 'status': return cmdStatus(argv.slice(1));
    case 'metrics': return cmdMetrics(argv.slice(1));
    case 'scorecard': return cmdScorecard(argv.slice(1));
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
module.exports = { main, writeSetupRun, newRunId, appendEvents, allowDecision, denyDecision, withSession };

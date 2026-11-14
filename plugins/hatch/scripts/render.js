#!/usr/bin/env node
'use strict';
/**
 * render.js — turn the ledger into words. A pure function: same inputs, same bytes.
 *
 *   render.js <view> [--level plain|product|tech] [--cohdit DIR] [--now ISO] [--run ID | --last]
 *             [--item ITEM-NNN] [--since ISO] [--until ISO] [--spool FILE] [--json]
 *
 *   views   spec     the idea read back from its draft (--partial: the one-line shape so far)
 *           status   where things stand: the idea's items, what's live, what it has used, what waits on you
 *           why      what the last (or named) run did, why it stopped, what it is waiting for
 *           digest   the end-of-run summary a skill prints
 *           checklist  what to try, numbered, in the person's own words (the live try's list, else what a try would cover)
 *           events   the run's events, one line each
 *           score    the scorecard (tokens per finished thing, first-pass, review yield, owner load, trust gate)
 *
 * Tokens first, dollars derived. The measured quantity is tokens, read from transcripts; it leads
 * wherever usage is shown. A dollar figure appears only beside it, as "≈ $X at API list price" with
 * the price file's date, so the reader sees how it was reached. Hatch never says what the person
 * was billed — their plan decides that — and no level may say "spent" or "bill".
 *
 * Three levels of language. `plain` for someone with no technical experience, `product` for someone
 * who knows how software gets made but not code, `tech` for a developer. The level comes from
 * --level, else the project's .cohdit/config.json, else the person's ~/.cohdit/settings.json, else
 * plain. The level changes the words, never which facts reach the person.
 *
 * Inputs: <cohdit>/ledger/runs/*.jsonl, <cohdit>/ledger/blobs/*.txt, <cohdit>/spec.json,
 * data/codes.json, data/rails.json, data/prices.json and --now. No clock, no git, no network, no
 * locale. --now defaults to the clock only when not given; tests always pass it. Every sentence a
 * human reads comes from a template in codes.json or from this file's fixed strings — the model
 * never writes any of it. Golden tests in tests/golden/ freeze every view × level × fixture.
 */
const path = require('path');
const ml = require('./lib/ledger');
const api = require('./lib/api');
const cz = require('./lib/codes');

const LIVE_WINDOW_MIN = 20;     // a run with no RUN_END whose last event is older than this is dead
const STEPS_SHOWN = 6;
const TRUST_COVERAGE = 0.95;
const TRUST_UNATTRIBUTED = 0.10;
const DRY_MIN_DISPATCHES = 8;
const CHARS_PER_WORD = 6;       // how `said` characters become the words-per-run figure
const BOOKKEEPING = ['USAGE'];

/** Every fixed string that differs between plain and product. Tech has its own branches. */
const WORDS = {
  plain: {
    status: { queued: 'to do', building: 'building', done: 'done', blocked: 'set aside', held: 'waiting', tried: 'tested', refused: 'refused' },
    busy: 'Hatch is already building this in another window; say "status" there.',
    unknownItem: 'that piece',
    thing: 'thing', things: 'things', session: 'session',
    finished: (ago, d, b, h) => 'Finished ' + ago + ': ' + d + ' done, ' + b + ' set aside, ' + h + ' parked for you.',
    waiting: (n) => 'Waiting on you: ' + plural(n, 'question') + '. Say "status" to see ' + (n === 1 ? 'it' : 'them') + '.',
    details: 'Say "show me the details" for the technical view.',
    noRuns: 'Nothing has run yet. Say "I have an idea" to start.',
    noIdea: 'No idea saved yet. Say "I have an idea" to start.',
    nothingYet: 'Nothing has happened yet.',
    notShared: 'Not shared yet — say "share it" when you want friends to see it.',
    savedOnline: (name) => 'Saved in your GitHub account as ' + name + '.',
    notOnline: 'Not saved online yet; say "set me up" to sign in to GitHub.',
    nextTry: (n) => 'Next: say "let me try it" and check ' + (n === 1 ? 'this one thing' : 'these ' + n + ' things') + ' yourself.',
    toTry: (n) => 'Waiting on you: ' + plural(n, 'thing') + ' to try. Say "let me try it".',
    deviceWord: 'to check',
    used: (tokens, est, n) => 'Claude has used about ' + tokens + ' tokens over ' + plural(n, 'session') + ' (' + est + ').',
    usedRun: (tokens, est) => 'This run used about ' + tokens + ' tokens (' + est + ').',
    waitingHead: (n) => 'Waiting on you: ' + plural(n, 'question') + '.',
    yourAnswer: ' — your answer needed',
    row: { open: 'open', done: 'done', held: 'parked', blocked: 'set aside', refused: 'refused' },
    heldRow: (title, q) => title + ' — needs you: ' + q + ' (say "status" to answer)',
    blockWhy: { dependency: 'needs something else built first', ambiguous: 'needs your decision', access: 'no access to something it needs', env: 'something on this computer is in the way' },
    failedTimes: (n) => 'the checks failed ' + times(n),
    couldntFinish: "couldn't finish it",
    crash: {
      builder: 'the builder', checker: 'the checker',
      neverBack: (who, title) => 'while ' + who + ' was working on "' + title + '" and never reported back.',
      deployError: 'because publishing failed. The details are saved.', deploying: 'while publishing.',
      pushRejected: "because I couldn't save to the shared copy. Your work is safe here.",
      verifyFail: (title) => title ? 'after the checks failed on "' + title + '".' : 'after the checks failed.',
      afterDone: (title) => 'right after finishing "' + title + '".',
      afterThis: (p) => 'right after this: ' + p + '.', early: 'before it got going.',
    },
    setupLeft: (n) => n === 0 ? 'Everything is ready.' : (n === 1 ? 'One thing' : n + ' things') + " left. I'll walk you through " + (n === 1 ? 'it' : 'them one at a time') + '.',
    refusedIdea: (name, phrase) => 'Idea: ' + name + ' — not something Cohdit builds (apps that ' + phrase + ').',
    trying: 'waiting for you to try it',
    stillBuilding: 'Still building; say "status" for where it is up to, and try it once the build has finished.',
    nothingToTry: 'Nothing to try yet. Say "build it".',
    trySay: 'Say "let me try it" to start it on this computer.',
    tryAnswer: 'Say "pass", or say which one didn\'t work and what you saw.',
    wroteWords: (nums) => 'I wrote some of the words in ' + list(nums) + ' myself. Change anything that doesn\'t sound right.',
    onDevice: (lan) => 'on the same wifi, open ' + lan + ' on it (if this computer asks whether to allow connections, say yes); ',
    tried: (n, ok, bad) => n === 0 ? 'Nothing tried yet.' : 'Tried ' + plural(n, 'thing') + ': ' + (bad === 0 ? 'all worked.' : ok + ' worked, ' + bad + " didn't."),
    failRow: "didn't",
    nextFix: 'Next: say "build it" and I\'ll fix it.',
    nextFixAll: 'Next: say "fix all" and I\'ll fix them.',
    nextShare: 'Next: say "share it" when you want friends to see it.',
    tryAgain: 'Say "let me try it" when you\'re ready.',
    publishAsk: (url) => 'Put it live at ' + url + '? Anyone with the link can open it; the code and anything typed into it stay in your accounts.',
    tryFirst: "Nothing goes live until you've tried it.",
    nothingToShare: 'Nothing to share yet. Say "build it".',
    stillToCheck: (titles) => 'Still to check at that link: ' + titles.join(', ') + '.',
    stillToFix: (titles) => 'Not fixed yet: ' + titles.join(', ') + '. Say "build it".',
    ifWrong: 'Something wrong? Say "let me try it" and tell me what you saw.',
    shareRetry: 'Say "share it" to try again, or "show me the details" to see why.',
    shareLater: 'Say "share it" when you\'re ready.',
    found: (n) => n === 0 ? 'Nothing to fix: the scan found no problems and nobody reported any.' : 'Found ' + plural(n, 'thing') + ' to fix:',
    reported: (n) => n === 0 ? 'No new reports.' : plural(n, 'report') + ' from people using it, now on the list to fix.',
    nothingToFix: 'Nothing built yet, so nothing to check. Say "build it".',
    fixEvery: (n) => 'Noted: I\'ll say when a check for problems is due, every ' + (n === 1 ? 'day' : n + ' days') + '. Say "scan it" then.',
    fixOff: 'Noted: no regular check. Say "scan it" whenever you like.',
    fixDue: 'A check for problems is due. Say "scan it".',
    filed: (title) => 'Bug filed: ' + title + '.',
    filedTwin: 'That bug is already on the list.',
    bugsWaiting: (n) => plural(n, 'bug') + ' waiting. Say "fix all" when you want them fixed.',
    fixNotDue: 'No check is due yet.',
  },
  product: {
    status: { queued: 'queued', building: 'building', done: 'done', blocked: 'blocked', held: 'held', tried: 'tested', refused: 'refused' },
    busy: 'Another session is building this project in its own working copy; say "status" there.',
    unknownItem: 'that item',
    thing: 'item', things: 'items', session: 'run',
    finished: (ago, d, b, h) => 'Finished ' + ago + ': ' + d + ' done, ' + b + ' blocked, ' + h + ' held.',
    waiting: (n) => 'Held for you: ' + plural(n, 'question') + '. Say "status" to see ' + (n === 1 ? 'it' : 'them') + '.',
    details: 'Say "technical" for the full event list.',
    noRuns: 'No runs yet. Say "I have an idea" to start.',
    noIdea: 'No spec yet. Say "I have an idea" to start.',
    nothingYet: 'No events yet.',
    notShared: 'Not published yet — say "share it" to deploy.',
    savedOnline: (repo) => 'Pushed to GitHub: ' + repo + '.',
    notOnline: 'No GitHub remote yet; say "set me up" to sign in.',
    nextTry: (n) => 'Next: say "let me try it" to test ' + plural(n, 'item') + '.',
    toTry: (n) => 'Waiting on you: ' + plural(n, 'item') + ' to try. Say "let me try it".',
    deviceWord: 'on device',
    used: (tokens, est, n) => 'Tokens: ' + tokens + ' over ' + plural(n, 'run') + ' ' + est + '.',
    usedRun: (tokens, est) => 'This run: ' + tokens + ' tokens ' + est + '.',
    waitingHead: (n) => 'Held for you: ' + plural(n, 'question') + '.',
    yourAnswer: ' — your decision needed',
    row: { open: 'open', done: 'done', held: 'held', blocked: 'blocked', refused: 'refused' },
    heldRow: (title, q) => title + ' — held: ' + q,
    blockWhy: { dependency: 'depends on something not built yet', ambiguous: 'needs your decision', access: 'missing access', env: 'environment problem on this machine' },
    failedTimes: (n) => 'failed tests ' + times(n),
    couldntFinish: 'builder could not finish',
    crash: {
      builder: 'the builder', checker: 'the reviewer',
      neverBack: (who, title) => 'while ' + who + ' was working on "' + title + '" and never reported back.',
      deployError: 'because the deploy failed. The log is saved.', deploying: 'while deploying.',
      pushRejected: 'because the push was rejected. Your work is safe locally.',
      verifyFail: (title) => title ? 'after tests failed on "' + title + '".' : 'after tests failed.',
      afterDone: (title) => 'right after "' + title + '" was done.',
      afterThis: (p) => 'right after: ' + p + '.', early: 'before it got going.',
    },
    setupLeft: (n) => n === 0 ? 'Everything is ready.' : plural(n, 'item') + ' to fix; one at a time.',
    refusedIdea: (name, phrase) => 'Spec: ' + name + ' — refused (apps that ' + phrase + ').',
    trying: 'waiting for your test results',
    stillBuilding: 'A build is still running; say "status" for where it is, and test once it has finished.',
    nothingToTry: 'Nothing to test yet. Say "build it".',
    trySay: 'Say "let me try it" to run it locally.',
    tryAnswer: 'Say "pass", or name the item that failed and what you saw.',
    wroteWords: (nums) => 'Copy I drafted: ' + list(nums) + '. Edit anything that reads wrong.',
    onDevice: (lan) => 'on the same wifi, open ' + lan + ' on it (if this computer asks whether to allow connections, say yes); ',
    tried: (n, ok, bad) => n === 0 ? 'Nothing tested yet.' : 'Tested ' + plural(n, 'item') + ': ' + (bad === 0 ? 'all passed.' : ok + ' passed, ' + bad + ' failed.'),
    failRow: 'failed',
    nextFix: 'Next: say "build it" to fix it.',
    nextFixAll: 'Next: say "fix all" to fix them.',
    nextShare: 'Next: say "share it" to deploy.',
    tryAgain: 'Say "let me try it" to pick it up again.',
    publishAsk: (url) => 'Put it live at ' + url + '? Anyone with the link can open it; the code and anything typed into it stay in your accounts.',
    tryFirst: 'Nothing is deployed until it has been tested.',
    nothingToShare: 'Nothing to deploy yet. Say "build it".',
    stillToCheck: (titles) => 'Still to check at that link: ' + titles.join(', ') + '.',
    stillToFix: (titles) => 'Not fixed yet: ' + titles.join(', ') + '. Say "build it".',
    ifWrong: 'Something wrong? Say "let me try it" and name what failed.',
    shareRetry: 'Say "share it" to try again, or "show me the details" to see why.',
    shareLater: 'Say "share it" when you\'re ready.',
    found: (n) => n === 0 ? 'Nothing to fix: no findings from the lenses, no reports.' : 'Found ' + plural(n, 'item') + ' to fix:',
    reported: (n) => n === 0 ? 'No new reports.' : plural(n, 'report') + ' pulled from the app, queued as bugs.',
    nothingToFix: 'Nothing built yet. Say "build it".',
    fixEvery: (n) => 'Scan due every ' + plural(n, 'day') + '; "status" and "build it" say when. Say "scan it" then.',
    fixOff: 'No scheduled scan. Say "scan it" when wanted.',
    fixDue: 'A scan is due. Say "scan it".',
    filed: (title) => 'Filed: ' + title + '.',
    filedTwin: 'Already on the list.',
    bugsWaiting: (n) => plural(n, 'bug') + ' queued. "fix all" fixes them.',
    fixNotDue: 'No fix run due yet.',
  },
};

class Ctx {
  constructor(a) {
    this.level = a.level;
    this.w = WORDS[this.level === 'tech' ? 'product' : this.level];
    this.now = ml.parseTs(a.now || ml.utcNow());
    this.cohdit = a.cohdit;
    this.table = cz.load();
    this.rails = cz.loadRails();
    this.prices = ml.loadPrices();
    this.spec = ml.loadSpec(this.cohdit) || {};
    this.config = ml.loadConfig(this.cohdit) || {};
    const { recs, bad } = ml.readLedger(this.cohdit);
    let all = recs;
    if (a.spool) {
      const ids = new Set(recs.map((r) => r.id));
      all = recs.concat(ml.readJsonl(a.spool).recs.filter((r) => !ids.has(r.id)));
    }
    this.badLines = Object.values(bad).reduce((n, v) => n + v.length, 0);
    // Stable order: timestamp, then arrival order — two events in one second keep their sequence.
    this.recs = all
      .map((r, n) => [r && r.ts ? r.ts : '', n, r])
      .filter(([, , r]) => r && typeof r === 'object' && this.table.codes[r.c])
      .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1]))
      .map((x) => x[2]);
    this.runs = new Map();
    for (const r of this.recs) {
      if (!this.runs.has(r.r)) this.runs.set(r.r, []);
      this.runs.get(r.r).push(r);
    }
    this._blobs = new Map();
    // An item's status is what the ledger says happened to it (one rule, lib/ledger.js itemStatus),
    // with spec.json's own status as the floor.
    this.derived = ml.itemStatus(this.recs, this.spec.items || [], this.now);
  }

  statusOf(it) {
    return this.derived.get(it.id) || it.status || 'queued';
  }

  /** The result of the last time this thing was tried, or null. */
  lastTry(i) {
    let last = null;
    for (const r of this.recs) if (r.c === 'TRY_RESULT' && r.i === i) last = r.f.result;
    return last;
  }

  /** The maker's one-line note for the try checklist, from <cohdit>/notes/ITEM.txt; null if none. */
  note(i) {
    try { return require('fs').readFileSync(path.join(this.cohdit, 'notes', i + '.txt'), 'utf8').trim() || null; } catch (e) { return null; }
  }

  /** Did the maker write wording the person should read? Its report says so (notes/ITEM.words); an
   *  older note that says so in its own words counts too. */
  wroteWords(i) {
    if (require('fs').existsSync(path.join(this.cohdit, 'notes', i + '.words'))) return true;
    return /\bI (wrote|drafted)\b[^.]*\b(words?|wording|text|copy)\b/i.test(this.note(i) || '');
  }

  // --- lookups -------------------------------------------------------------------------------
  item(i) {
    for (const it of this.spec.items || []) if (it.id === i) return it;
    return null;
  }

  title(i) {
    const it = this.item(i);
    if (it && it.title) return it.title;
    return this.level === 'tech' ? i : this.w.unknownItem;
  }

  blob(bid) {
    if (!this._blobs.has(bid)) {
      const text = bid ? ml.readBlob(this.cohdit, bid, false) : null;
      this._blobs.set(bid, text && text.trim() ? text.trim().split(/\r?\n/)[0].slice(0, 160) : '(details saved)');
    }
    return this._blobs.get(bid);
  }

  ago(ts) {
    const secs = (this.now.getTime() - ml.parseTs(ts).getTime()) / 1000;
    if (secs < 60) return 'just now';
    const m = Math.floor(secs / 60);
    if (m < 60) return m + ' minute' + (m === 1 ? '' : 's') + ' ago';
    const h = Math.floor(secs / 3600);
    if (h < 48) return h + ' hour' + (h === 1 ? '' : 's') + ' ago';
    return Math.floor(secs / 86400) + ' days ago';
  }

  /** {tokens, kinds, usd, unpriced}: what the USAGE events in recs used, the list-price estimate
   *  of the same, and the models no price is known for. Tokens count even when a model is unpriced. */
  usage(recs) {
    let tokens = 0, usd = 0;
    const kinds = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
    const unpriced = new Set();
    for (const r of recs) {
      if (r.c !== 'USAGE') continue;
      tokens += ml.usageTokens(r.f.models);
      const k = ml.usageKinds(r.f.models);
      for (const key of Object.keys(kinds)) kinds[key] += k[key];
      const c = ml.usageCost(r.f.models, this.prices);
      if (c === null) {
        for (const m of Object.keys(r.f.models)) if (ml.modelPrice(this.prices, m) === null) unpriced.add(m);
      } else {
        usd += c;
      }
    }
    // With an unpriced model in the mix the estimate would undercount, so there is none — never $0.00.
    return { tokens, kinds, usd: unpriced.size ? null : usd, unpriced };
  }

  /** The only way a dollar figure is ever shown: beside tokens, as an estimate that names its basis.
   *  Plain says it in words; product and tech in symbols. */
  est(usd, kind) {
    const plain = (kind || this.level) === 'plain';
    if (usd === null || usd === undefined) return plain ? 'no dollar estimate: a model has no known price' : 'no estimate (a model has no known price)';
    return plain ? 'roughly ' + money(usd) + " at Claude's public API prices" : '≈ ' + money(usd) + ' at API list price';
  }

  rounds(runRecs, i) {
    return runRecs.filter((r) => r.c === 'ROUND' && r.i === i).length;
  }

  /** Everything a template may interpolate for this record, worded for `kind` (default: the level). */
  values(rec, runRecs, kind) {
    const f = rec.f || {};
    const i = rec.i;
    const v = {};
    for (const k of Object.keys(this.table.codes[rec.c].fields)) v[k] = '-';   // absent optional fields
    Object.assign(v, f);
    v.i = i || '-';
    v.item_title = i ? this.title(i) : '?';
    v.ago = this.ago(rec.ts);
    const u = this.usage(runRecs);
    v.tokens = ml.fmtTokens(u.tokens, (kind || this.level) === 'plain');
    v.usd = u.usd === null ? '?' : money(u.usd, true);
    v.rounds = i ? this.rounds(runRecs, i) : 0;
    v.rounds_word = times(v.rounds);
    if ('must_fix' in f) v.must_fix_things = plural(parseInt(f.must_fix, 10), 'thing');
    const bf = cz.blobField(this.table, rec.c);
    v.blob_text = bf && f[bf] ? this.blob(f[bf]) : '';
    if ('category' in f) {
      const cat = (this.rails.refuse || {})[f.category] || {};
      v.category_plain = cat.plain || "fall into a category Cohdit doesn't build";
    }
    return v;
  }

  /** One rendered line for a record at a level (default: the current one); null if hidden. */
  line(rec, kind, runRecs) {
    const k = kind || this.level;
    const tpl = cz.pickTemplate(cz.templateFor(this.table.codes[rec.c], k), rec.f || {});
    if (tpl === null || tpl === undefined) return null;
    return cz.fill(tpl, this.values(rec, runRecs || this.runs.get(rec.r) || [], k));
  }

  // --- run selection -------------------------------------------------------------------------
  selectRun(a) {
    if (a.run) return this.runs.has(a.run) ? a.run : null;
    const starts = this.recs.filter((r) => r.c === 'RUN_START').map((r) => [r.ts, r.r]);
    if (!starts.length) return null;
    const live = starts.filter(([, run]) => this.runState(run)[0] === 'live').map(([, run]) => run);
    if (live.length && !a.last) {
      return live.sort((x, y) => cmp(this.runs.get(x)[0].ts, this.runs.get(y)[0].ts))[live.length - 1];
    }
    return starts.sort((x, y) => cmp(x[0], y[0]) || cmp(x[1], y[1]))[starts.length - 1][1];
  }

  /** [state, lastRec]: stopped | finished | crashed | live. */
  runState(run) {
    const rs = this.runs.get(run);
    const stop = rs.filter((r) => r.c === 'STOP');
    if (stop.length) return ['stopped', stop[stop.length - 1]];
    const end = rs.filter((r) => r.c === 'RUN_END');
    if (end.length) return [end[end.length - 1].f.outcome === 'ok' ? 'finished' : 'crashed', end[end.length - 1]];
    const ageMin = (this.now.getTime() - ml.parseTs(rs[rs.length - 1].ts).getTime()) / 60000;
    const last = signal(rs);
    // A try is the person's time, not Hatch's: it is live until it is a day old, however quiet.
    const window = rs[0].c === 'RUN_START' && rs[0].f.skill === 'try' ? ml.STALE_RUN_H * 60 : LIVE_WINDOW_MIN;
    if (ageMin > window && rs[rs.length - 1].c !== 'BEAT') return ['crashed', last];
    return ['live', last];
  }

  /** HELD items with no later DECIDE on the same item. */
  waiting(recs) {
    const list = recs === undefined ? this.recs : recs;
    const held = new Map(), decided = new Set();
    for (const r of list) {
      if (r.c === 'HELD') held.set(r.i, r);
      else if (r.c === 'DECIDE' && held.has(r.i)) decided.add(r.i);
    }
    return [...held.keys()].filter((i) => !decided.has(i)).map((i) => held.get(i));
  }
}

// --- formatting --------------------------------------------------------------------------------

function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function money(x, bare) {
  if (x === null || x === undefined) return 'n/a';
  const s = x.toFixed(2);
  return bare ? s : '$' + s;
}

function pct(x) {
  return x === null || x === undefined ? 'n/a' : Math.round(x * 100) + '%';
}

function hours(h) {
  if (h === null || h === undefined) return 'n/a';
  return h < 48 ? h.toFixed(1) + 'h' : (h / 24).toFixed(1) + 'd';
}

/** 2 → "2"; 2, 5 → "2 and 5"; 2, 3, 5 → "2, 3 and 5". */
function list(xs) {
  return xs.length < 2 ? String(xs[0]) : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
}

function plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : (many || one + 's'));
}

function times(n) {
  return n === 1 ? 'once' : n === 2 ? 'twice' : n + ' times';
}

function dedupe(seq) {
  const out = [];
  for (const s of seq) if (!out.length || out[out.length - 1] !== s) out.push(s);
  return out;
}

function pad(s, n) {
  return String(s).padEnd(n);
}

function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function lowerFirst(s) {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

function count(rs, code) {
  return rs.filter((r) => r.c === code).length;
}

/** The last event that says what the run was doing — usage receipts don't. */
function signal(rs) {
  for (let k = rs.length - 1; k >= 0; k--) if (!BOOKKEEPING.includes(rs[k].c)) return rs[k];
  return rs[rs.length - 1];
}

function stepPhrase(c, rec, rs) {
  const tpl = cz.pickTemplate(c.table.codes[rec.c].step, rec.f || {});
  return tpl ? cz.fill(tpl, c.values(rec, rs)) : null;
}

/** What a live run is doing now: the last event with a sentence at this level, lower-cased and
 *  without its full stop — 'building "Weekly scoreboard"'. */
function workingPhrase(c, rs) {
  for (let k = rs.length - 1; k >= 0; k--) {
    const r = rs[k];
    if (BOOKKEEPING.includes(r.c) || r.c === 'BEAT' || r.c === 'RUN_START') continue;
    if (r.c === 'DONE') return 'just finished "' + c.title(r.i) + '", picking the next';
    if (r.c === 'TRY_START' || r.c === 'TRY_RESULT') return c.w.trying;
    const line = c.line(r, c.level === 'tech' ? 'product' : c.level, rs);
    if (line) return lowerFirst(line.replace(/\.+$/, ''));
  }
  return 'getting ready';
}

/** Why an item was set aside, for the digest's one-line summary. */
function blockPhrase(c, rec, rs) {
  const why = c.w.blockWhy[rec.f.reason];
  if (why) return why;
  const n = c.rounds(rs, rec.i);
  return n ? c.w.failedTimes(n) : c.w.couldntFinish;
}

/** What a dead run was doing, from its last events — every branch a fixed string. */
function crashPhrase(c, rs, last) {
  const w = c.w.crash;
  if (last.c === 'DISPATCH') return w.neverBack(last.f.agent === 'maker' ? w.builder : w.checker, c.title(last.i));
  if (last.c === 'DEPLOY' && last.f.state === 'error') return w.deployError;
  if (last.c === 'DEPLOY') return w.deploying;
  if (last.c === 'PUSH' && last.f.result === 'rejected') return w.pushRejected;
  if (last.c === 'VERIFY' && last.f.rc !== 0) return w.verifyFail(last.i ? c.title(last.i) : null);
  if (last.c === 'DONE') return w.afterDone(c.title(last.i));
  const phrase = stepPhrase(c, last, rs);
  return phrase ? w.afterThis(phrase) : w.early;
}

// --- views -------------------------------------------------------------------------------------

function viewEvents(c, a) {
  const run = c.selectRun(a);
  let recs = (a.run || a.last || !a.since) ? (c.runs.get(run) || []) : c.recs;
  if (a.since) {
    const since = ml.parseTs(a.since).getTime();
    recs = recs.filter((r) => ml.parseTs(r.ts).getTime() >= since);
  }
  if (a.item) recs = recs.filter((r) => r.i === a.item);
  const out = [];
  for (const r of recs) {
    const line = c.line(r);
    if (line === null) continue;
    // The event list is the raw view: every tech line names its code, even where the tech sentence does not.
    const named = c.level === 'tech' && !line.startsWith(r.c) ? r.c + ' ' + line.trimStart() : line;
    out.push(c.level === 'tech' ? r.ts + '  ' + named : line);
  }
  if (!out.length) out.push(c.level === 'tech' ? 'nothing recorded yet' : c.w.nothingYet);
  return out;
}

function viewWhy(c, a) {
  const run = c.selectRun(a);
  if (!run) return c.level === 'tech' ? ['no runs recorded'] : [c.w.noRuns];
  const rs = c.runs.get(run);
  const start = rs[0].c === 'RUN_START' ? rs[0] : null;
  const skill = start ? start.f.skill : '?';
  const [state, last] = c.runState(run);
  const waiting = c.waiting();
  const out = [];
  const tech = c.level === 'tech';
  const kind = tech ? 'product' : c.level;        // tech reads the same sentences; key=value is the events view
  const done = count(rs, 'DONE'), blocked = count(rs, 'BLOCKED'), held = count(rs, 'HELD');
  if (state === 'stopped') {
    out.push('Stopped ' + c.ago(last.ts) + '. ' + c.line(last, kind, rs));
  } else if (state === 'finished') {
    out.push(skill === 'build' ? c.w.finished(c.ago(last.ts), done, blocked, held) : 'Finished ' + c.ago(last.ts) + '.');
  } else if (state === 'crashed') {
    out.push('Stopped unexpectedly ' + c.ago(last.ts) + ' ' + crashPhrase(c, rs, last));
  } else {
    out.push('Working now: ' + workingPhrase(c, rs) + ' (started ' + c.ago(rs[0].ts) + ').');
  }
  const steps = dedupe(rs.map((r) => stepPhrase(c, r, rs)).filter(Boolean)).slice(-STEPS_SHOWN);
  if (steps.length) out.push('Steps: ' + steps.join(' → ') + '.');
  if (waiting.length) out.push(c.w.waiting(waiting.length) + (tech ? ' (' + waiting.map((w) => w.i).join(', ') + ')' : ''));
  out.push(tech ? 'Run ' + run + ', skill ' + skill + ', last event ' + last.ts + '. Say "show me the events" for the full list.' : c.w.details);
  return out;
}

function viewStatus(c, a) {
  const spec = c.spec;
  const items = spec.items || [];
  const waiting = c.waiting();
  const { tokens, usd, unpriced } = c.usage(c.recs);
  const runs = [...c.runs.keys()].filter(Boolean).sort();
  const shared = c.recs.filter((r) => r.c === 'URL_SHARED');
  const live = runs.filter((run) => c.runState(run)[0] === 'live');
  const lastShared = shared.length ? shared[shared.length - 1] : null;
  if (a.json) {
    return [ml.dumps({
      idea: spec.name === undefined ? null : spec.name,
      items: items.map((i) => ({ id: i.id, title: i.title, status: c.statusOf(i) })),
      waiting: waiting.map((w) => w.i), tokens, est_usd: Math.round(usd * 100) / 100, prices_date: c.prices.date || null, runs: runs.length,
      url: lastShared ? lastShared.f.url : null, shared_at: lastShared ? lastShared.ts : null,
      live_run: live.length ? live[live.length - 1] : null, unpriced: [...unpriced].sort(),
      refused: spec.refused === undefined ? null : spec.refused,
    })];
  }
  const out = [];
  const tech = c.level === 'tech';
  const w = c.w;
  if (!Object.keys(spec).length) return [w.noIdea];
  if (spec.refused) {
    const cat = (c.rails.refuse || {})[spec.refused] || {};
    return [w.refusedIdea(spec.name || 'your idea', cat.plain || 'fall into a refused category')];
  }
  out.push('Idea: ' + (spec.name || 'your idea') + (c.level !== 'plain' ? ' (' + plural(items.length, 'item') + ')' : ''));
  if (live.length) {
    const rs = c.runs.get(live[live.length - 1]);
    out.push('Working now: ' + workingPhrase(c, rs) + ' (started ' + c.ago(rs[0].ts) + ')' + (tech ? ', run ' + live[live.length - 1] : '') + '.');
  }
  for (const i of items) {
    const st = c.statusOf(i);
    const word = i.device && st === 'queued' ? w.deviceWord : (w.status[st] || st || '?');
    out.push('  ' + pad(word, 10) + ' ' + (tech ? i.id + ' ' : '') + i.title + (st === 'held' ? w.yourAnswer : ''));
  }
  if (!items.length) out.push('  Nothing planned yet.');
  if (lastShared) out.push('Live: ' + lastShared.f.url + ' (shared ' + c.ago(lastShared.ts) + ')');
  else out.push(w.notShared);
  if (runs.length && tech) out.push(w.used(ml.fmtTokens(tokens, c.level === 'plain'), c.est(usd), runs.length) + (tech ? ' Prices of ' + (c.prices.date || '?') + (unpriced.size ? '; unpriced: ' + [...unpriced].sort().join(', ') : '') + '.' : ''));
  if (waiting.length) {
    out.push(w.waitingHead(waiting.length));
    for (const h of waiting) out.push('  ' + c.title(h.i) + ' — ' + c.blob(h.f.blob));
  }
  const toTry = items.filter((i) => c.statusOf(i) === 'done').length;
  const trying = live.some((run) => c.runs.get(run)[0].f.skill === 'try');
  if (toTry) out.push(trying ? w.tryAnswer : w.toTry(toTry));
  return out;
}

function viewDigest(c, a) {
  const run = c.selectRun(a);
  if (!run) return c.level === 'tech' ? ['no runs recorded'] : [c.w.noRuns];
  const rs = c.runs.get(run);
  const skill = rs[0].c === 'RUN_START' ? rs[0].f.skill : '?';
  const { tokens, usd } = c.usage(rs);
  const picked = rs.filter((r) => r.c === 'PICK').map((r) => r.i);
  const outcome = new Map();
  for (const r of rs) {
    if (r.c === 'DONE' || r.c === 'BLOCKED' || r.c === 'HELD' || (r.c === 'RETURN' && r.f.verdict === 'refused')) outcome.set(r.i, r);
  }
  const shared = rs.filter((r) => r.c === 'URL_SHARED');
  const lastShared = shared.length ? shared[shared.length - 1] : null;
  const stop = rs.filter((r) => r.c === 'STOP');
  const outcomes = [...outcome.values()];
  const n = (code) => outcomes.filter((r) => r.c === code).length;
  if (skill === 'setup') return setupDigest(c, run, rs);
  const tech = c.level === 'tech';
  const kind = tech ? 'product' : c.level;        // tech reads the same sentences, with ids and heads; key=value is the events view
  const w = c.w;
  const out = [];
  if (skill === 'build') {
    const done = n('DONE');
    out.push('Built ' + done + ' of ' + plural(picked.length, w.thing) + (tech ? ' (run ' + run + ')' : '') + '.');
    for (const i of picked) {
      const r = outcome.get(i);
      const it = c.item(i) || {};
      const crit = (it.criteria && it.criteria.length ? it.criteria : [''])[0];
      const id = tech ? ' (' + i + (r && r.c === 'DONE' ? ', ' + r.f.head : '') + ')' : '';
      if (!r) out.push('  ' + pad(w.row.open, 9) + ' ' + c.title(i) + id);
      else if (r.c === 'DONE') out.push('  ' + pad(w.row.done, 9) + ' ' + c.title(i) + id + (crit ? ' — ' + crit : ''));
      else if (r.c === 'HELD') out.push('  ' + pad(w.row.held, 9) + ' ' + w.heldRow(c.title(i) + id, c.blob(r.f.blob)));
      else if (r.c === 'BLOCKED') out.push('  ' + pad(w.row.blocked, 9) + ' ' + c.title(i) + id + ' — ' + blockPhrase(c, r, rs));
      else out.push('  ' + pad(w.row.refused, 9) + ' ' + c.title(i) + id);
    }
    for (const r of stop) {
      if (!outcome.has(r.i)) out.push(c.line(r, kind, rs));   // an item-level stop is already on its item's line
    }
    const pushes = rs.filter((r) => r.c === 'PUSH');
    const push = pushes.length ? pushes[pushes.length - 1] : null;
    if (push && push.f.result === 'ok') {
      const repo = ((c.config.connectors || {}).github || {}).repo || c.spec.slug || 'your idea';
      out.push(w.savedOnline(c.level === 'plain' ? repo.split('/').pop() : repo));
    } else if (push && push.f.result === 'no_remote') {
      out.push(w.notOnline);
    } else if (push) {
      out.push(c.line(push, kind, rs));
    }
    if (lastShared) out.push('Live: ' + lastShared.f.url);
    if (done && !stop.some((r) => r.f.cause === 'refused')) out.push(w.nextTry(done));
  } else if (skill === 'share') {
    // The link, what is still to check at it, what failed its try and is not rebuilt, what to do if it is
    // wrong; after a failed publish, what to say next; after a no, when to come back.
    for (const r of rs) if (r.c === 'CHECK') out.push(c.line(r, kind, rs));
    const declined = rs.filter((r) => r.c === 'DECIDE' && r.f.type === 'publish' && r.f.choice !== 'live');
    for (const r of declined) out.push(c.line(r, kind, rs));
    if (lastShared) {
      out.push(c.line(lastShared, kind, rs));
      const items = c.spec.items || [];
      const toCheck = items.filter((i) => i.device && c.statusOf(i) === 'queued').map((i) => c.title(i.id));
      if (toCheck.length) out.push(w.stillToCheck(toCheck));
      const toFix = items.filter((i) => !i.device && c.statusOf(i) === 'queued' && c.lastTry(i.id) === 'fail').map((i) => c.title(i.id));
      if (toFix.length) out.push(w.stillToFix(toFix));
      out.push(w.ifWrong);
    }
    for (const r of stop) out.push(c.line(r, kind, rs));
    if (stop.some((r) => r.f.cause === 'connector')) out.push(w.shareRetry);
    if (declined.length && !lastShared && !stop.length) out.push(w.shareLater);
  } else if (skill === 'fix') {
    const found = rs.filter((r) => r.c === 'FINDING');
    out.push(w.found(found.length) + (tech ? ' (run ' + run + ')' : ''));
    for (const r of found) out.push('  ' + c.title(r.i) + (tech ? ' (' + r.i + ')' : ''));
    for (const r of stop) out.push(c.line(r, kind, rs));
    if (found.length) out.push(w.nextFixAll);
  } else if (skill === 'dream') {
    for (const r of rs) if (['SPEC', 'REFUSE', 'HELD', 'DECIDE'].includes(r.c)) out.push(c.line(r, kind, rs));
  } else if (skill === 'try') {
    const results = new Map();
    for (const r of rs) if (r.c === 'TRY_RESULT') results.set(r.i, r);
    const fails = [...results.values()].filter((r) => r.f.result === 'fail');
    out.push(w.tried(results.size, results.size - fails.length, fails.length) + (tech ? ' (run ' + run + ')' : ''));
    for (const r of fails) out.push('  ' + pad(w.failRow, 9) + ' ' + c.title(r.i) + (tech ? ' (' + r.i + ')' : '') + ' — ' + c.blob(r.f.blob));
    for (const r of stop) out.push(c.line(r, kind, rs));
    const ended = rs.some((r) => r.c === 'RUN_END');
    const starts = rs.filter((r) => r.c === 'TRY_START');
    const listed = starts.length ? starts[starts.length - 1].f.items : [];
    const left = listed.filter((i) => !results.has(i) && !(c.item(i) || {}).device).length;   // a device check never blocks share
    if (!ended) out.push(w.tryAnswer);
    else if (fails.length) out.push(w.nextFix);
    else out.push(!results.size || left ? w.tryAgain : w.nextShare);
  } else {
    for (const r of rs) {
      const line = c.line(r, kind, rs);
      if (line && r.c !== 'RUN_START' && r.c !== 'RUN_END') out.push(line);
    }
  }
  if (tokens && c.level === 'tech') out.push(w.usedRun(ml.fmtTokens(tokens, c.level === 'plain'), c.est(usd)));
  return out.length ? out : ['Nothing to report.'];
}

/** The setup digest. Plain and product show one row per thing the person can act on; a tool and its
 *  sign-in are one row (the sign-in row once the tool is there), and Hatch's own two installs appear
 *  only when nothing else is left and they still failed. A re-run shows only what changed since the
 *  previous setup run and what is still not ready. Tech shows every check, every time. */
const ADVISORY = ['guard', 'hook_path'];
const TOOL_OF = { gh_auth: 'gh', vercel_auth: 'vercel', aws_auth: 'aws' };

function setupDigest(c, run, rs) {
  const checks = new Map();
  for (const r of rs) if (r.c === 'CHECK') checks.set(r.f.name, r);
  const all = [...checks.values()];
  const left = all.filter((r) => r.f.state !== 'ok' && !ADVISORY.includes(r.f.name)).length;
  const out = ['Checking your computer…'];
  if (c.level === 'tech') {
    for (const r of all) out.push(c.line(r, 'tech', rs));
    out.push(left === 0 ? 'Everything is ready.' : left + ' left; next=' + all.find((r) => r.f.state !== 'ok' && !ADVISORY.includes(r.f.name)).f.name);
    return out;
  }
  const prev = previousSetup(c, run);
  const same = (r) => prev && prev.has(r.f.name) && prev.get(r.f.name).f.state === r.f.state && prev.get(r.f.name).f.who === r.f.who;
  const hiddenTools = new Set(Object.values(TOOL_OF).filter((t) => checks.has(t) && checks.get(t).f.state === 'ok'));
  for (const r of all) {
    const name = r.f.name;
    if (hiddenTools.has(name)) continue;                                      // the sign-in row speaks for it
    if (name in TOOL_OF && checks.has(TOOL_OF[name]) && checks.get(TOOL_OF[name]).f.state !== 'ok') continue;  // tool row speaks
    if (ADVISORY.includes(name) && (r.f.state === 'ok' || left > 0)) continue;
    if (prev && same(r) && r.f.state === 'ok') continue;
    out.push(c.line(r, c.level, rs));
  }
  out.push(c.w.setupLeft(left));
  return out;
}

/** The setup run before this one, as a name → CHECK map; null if this is the first. */
function previousSetup(c, run) {
  const mine = c.runs.get(run)[0].ts;
  let best = null, seenMine = false;
  for (const [id, recs] of c.runs) {                   // ledger order; a same-second run counts only if it came first
    if (id === run) { seenMine = true; continue; }
    if (!recs.length || recs[0].c !== 'RUN_START' || recs[0].f.skill !== 'setup') continue;
    const earlier = recs[0].ts < mine || (recs[0].ts === mine && !seenMine);
    if (earlier && (!best || recs[0].ts >= best[0].ts)) best = recs;
  }
  if (!best) return null;
  const m = new Map();
  for (const r of best) if (r.c === 'CHECK') m.set(r.f.name, r);
  return m;
}

// --- scorecard ---------------------------------------------------------------------------------

function stageOf(u, firstRound) {
  const agent = u.f.agent || '';
  if (agent === 'orchestrator') return 'orchestrator';
  const fr = firstRound.get(u.i);
  if (fr && ml.parseTs(u.ts).getTime() > fr.getTime()) return 'rework';
  if (agent === 'maker') return 'build';
  if (agent === 'checker' || agent.startsWith('lens-')) return 'check';
  return 'other';
}

function runOf(rs, i) {
  for (const r of rs) if (r.i === i) return r.r;
  return null;
}

function score(c, since, until) {
  const starts = new Map();
  for (const r of c.recs) if (r.c === 'RUN_START') starts.set(r.r, ml.parseTs(r.ts));
  const runs = new Set([...starts.keys()].filter((run) => starts.get(run) >= since && starts.get(run) < until));
  const rs = c.recs.filter((r) => runs.has(r.r));
  const ended = new Set(rs.filter((r) => r.c === 'RUN_END').map((r) => r.r));

  const items = new Map();
  for (const r of rs) {
    const i = r.i;
    if (!i) continue;
    if (!items.has(i)) items.set(i, { codes: new Set(), rounds: 0, reviews: [], agents: new Set(), status: null, firstRound: null, ts: null });
    const it = items.get(i);
    it.codes.add(r.c);
    if (r.c === 'ROUND') {
      it.rounds += 1;
      if (!it.firstRound) it.firstRound = ml.parseTs(r.ts);
    } else if (r.c === 'REVIEW') {
      it.reviews.push(r.f);
    } else if (r.c === 'DISPATCH') {
      it.agents.add(r.f.agent);
    } else if (r.c === 'DONE' || r.c === 'BLOCKED') {
      it.status = r.c.toLowerCase();
      it.ts = ml.parseTs(r.ts);
    } else if (r.c === 'HELD') {
      if (!it.status) it.status = 'held';
    }
  }
  const closed = new Map([...items].filter(([, it]) => it.status));
  const done = new Map([...closed].filter(([, it]) => it.status === 'done'));
  const firstRound = new Map([...items].map(([i, it]) => [i, it.firstRound]));

  // Tokens are the measure; the dollar figures are the same tokens at API list price. An unpriced
  // model still counts its tokens — only its estimate is missing, and the trust gate says so.
  const stages = { orchestrator: 0, build: 0, check: 0, rework: 0, other: 0 };
  const stagesUsd = { orchestrator: 0, build: 0, check: 0, rework: 0, other: 0 };
  const kinds = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  const agents = {}, agentsUsd = {}, unpriced = new Set(), measured = new Set();
  let unattributed = 0, said = 0;
  for (const u of rs.filter((r) => r.c === 'USAGE')) {
    if ((u.f.agent || '') === 'orchestrator') {
      for (const m of Object.values(u.f.models)) said += m.said || 0;
    }
    const tokens = ml.usageTokens(u.f.models);
    const k = ml.usageKinds(u.f.models);
    for (const key of Object.keys(kinds)) kinds[key] += k[key];
    const stage = stageOf(u, firstRound);
    const agent = u.f.agent || 'unknown';
    stages[stage] += tokens;
    agents[agent] = (agents[agent] || 0) + tokens;
    if (agent !== 'orchestrator' && !u.i) unattributed += tokens;
    if (u.i) measured.add(u.i);
    const usd = ml.usageCost(u.f.models, c.prices);
    if (usd === null) {
      for (const m of Object.keys(u.f.models)) if (ml.modelPrice(c.prices, m) === null) unpriced.add(m);
      continue;
    }
    stagesUsd[stage] += usd;
    agentsUsd[agent] = (agentsUsd[agent] || 0) + usd;
  }
  const total = Object.values(stages).reduce((s, x) => s + x, 0);
  // No estimate at all when a model is unpriced: a partial figure would read as the whole.
  const totalUsd = unpriced.size ? null : Object.values(stagesUsd).reduce((s, x) => s + x, 0);
  const nDone = done.size;

  let mustFix = 0;
  for (const it of closed.values()) for (const f of it.reviews) mustFix += f.must_fix || 0;
  const dispatches = rs.filter((r) => r.c === 'DISPATCH' && r.f.agent === 'checker').length;
  const checkTokens = 'checker' in agents ? agents.checker : null;
  const checkUsd = 'checker' in agentsUsd && !unpriced.size ? agentsUsd.checker : null;

  const shared = rs.filter((r) => r.c === 'URL_SHARED').map((r) => ml.parseTs(r.ts));
  const latencies = [];
  for (const it of done.values()) {
    const later = shared.filter((s) => s >= it.ts);
    if (later.length) latencies.push((Math.min(...later.map((d) => d.getTime())) - it.ts.getTime()) / 3600000);
  }
  const waiting = c.waiting(rs);
  const held = count(rs, 'HELD');
  const asked = rs.filter((r) => r.c === 'DECIDE' && r.f.who === 'you').length;
  const defaulted = rs.filter((r) => r.c === 'DECIDE' && r.f.who === 'hatch').length;

  const complete = (i, it) => {
    if (it.status === 'held') return it.codes.has('PICK');
    const need = ['PICK', 'DISPATCH', 'RETURN'].concat(it.status === 'done' ? ['GATE', 'VERIFY'] : []);
    const have = new Set(it.codes);
    if (!have.has('VERIFY')) {
      const run = runOf(rs, i);
      if (rs.some((r) => r.c === 'VERIFY' && !r.i && r.r === run)) have.add('VERIFY');   // a run-level VERIFY counts
    }
    return need.every((k) => have.has(k));
  };
  const evCov = closed.size ? [...closed].filter(([i, it]) => complete(i, it)).length / closed.size : null;
  const built = [...closed].filter(([, it]) => it.codes.has('DISPATCH')).map(([i]) => i);
  const useCov = built.length ? built.filter((i) => measured.has(i)).length / built.length : null;
  const unatt = total ? unattributed / total : 0;
  const stale = [...runs].filter((run) => !ended.has(run) && ml.hoursBetween(c.now, starts.get(run)) > ml.STALE_RUN_H);
  // Two phrasings of the same reasons: tech names the mechanism, plain/product name the consequence.
  const reasons = [], reasonsPlain = [];
  const why = (tech, plain) => { reasons.push(tech); reasonsPlain.push(plain); };
  if (!closed.size) why('no items closed in this window', 'nothing finished yet');
  if (evCov !== null && evCov < TRUST_COVERAGE) why('events ' + Math.round(evCov * 100) + '%', "some steps weren't recorded");
  if (useCov !== null && useCov < TRUST_COVERAGE) why('usage ' + Math.round(useCov * 100) + '%', "some usage wasn't recorded");
  if (unatt > TRUST_UNATTRIBUTED) why('unattributed ' + Math.round(unatt * 100) + '%', "some usage couldn't be assigned");
  if (unpriced.size) why('unpriced models: ' + [...unpriced].sort().join(', '), plural(unpriced.size, 'model has', 'models have') + ' no price');
  if (stale.length) why(stale.length + ' run(s) never ended', plural(stale.length, 'session') + ' never ended');
  if (c.badLines) why(c.badLines + ' unreadable ledger line(s)', plural(c.badLines, 'log line') + " couldn't be read");
  const itemSide = stages.build + stages.check + stages.rework;
  const closedList = [...closed.values()];
  const doneList = [...done.values()];
  return {
    window: { since: ml.fmtTs(since), until: ml.fmtTs(until) },
    runs: runs.size, done: nDone, blocked: closedList.filter((it) => it.status === 'blocked').length,
    held, shared: shared.length,
    trust: { trusted: !reasons.length, reasons, reasons_plain: reasonsPlain, event_coverage: evCov, usage_coverage: useCov, unattributed_share: unatt },
    tokens: {
      total, per_done: nDone ? total / nDone : null,
      per_shared: shared.length ? total / shared.length : null,
      by_stage: stages, by_agent: agents, by_kind: kinds,
    },
    est: {
      basis: 'API list price', prices_date: c.prices.date || null,
      total_usd: totalUsd, per_done_usd: nDone && totalUsd !== null ? totalUsd / nDone : null,
      per_shared_usd: shared.length && totalUsd !== null ? totalUsd / shared.length : null,
      by_stage_usd: totalUsd === null ? null : stagesUsd, by_agent_usd: totalUsd === null ? null : agentsUsd,
    },
    orchestrator_share: total ? stages.orchestrator / total : null,
    rework: {
      first_pass_rate: nDone ? doneList.filter((it) => !it.rounds).length / nDone : null,
      rework_share: itemSide ? stages.rework / itemSide : null,
      rounds: closedList.reduce((s, it) => s + it.rounds, 0),
    },
    review: {
      dispatches, must_fix: mustFix, tokens: checkTokens, est_usd: checkUsd,
      tokens_per_must_fix: checkTokens !== null && mustFix ? checkTokens / mustFix : null,
      dry: dispatches >= DRY_MIN_DISPATCHES && mustFix === 0,
    },
    owner: {
      questions_per_item: nDone ? held / nDone : null,
      median_done_to_shared_h: latencies.length ? median(latencies) : null,
      waiting: waiting.length, asked, defaulted,
      said_chars: said, said_words_per_run: runs.size ? Math.round(said / CHARS_PER_WORD / runs.size) : null,
    },
  };
}

function viewScore(c, a) {
  const until = a.until ? ml.parseTs(a.until) : c.now;
  const since = a.since ? ml.parseTs(a.since) : new Date(Date.UTC(2000, 0, 1));
  const s = score(c, since, until);
  if (a.json) return [ml.dumps(s)];
  const t = s.trust, k = s.tokens, e = s.est, r = s.rework, o = s.owner, rv = s.review;
  const words = (n) => ml.fmtTokens(n, true);
  if (c.level === 'plain') {
    const out = ['Over this period: ' + plural(s.runs, 'building session') + ', ' + plural(s.done, 'thing') + ' finished, '
      + s.blocked + ' set aside, ' + plural(s.shared, 'link') + ' shared.'];
    if (s.done) {
      out.push('Claude used about ' + words(k.total) + ' tokens, about ' + words(k.per_done) + ' per finished thing (' + c.est(e.total_usd) + ').');
      const fp = r.first_pass_rate;
      out.push('Right first time: ' + (fp !== null ? Math.round(fp * s.done) : 0) + ' of ' + s.done + '. Questions for you: ' + s.held + '.');
    } else {
      out.push('Nothing finished yet. Claude has used about ' + words(k.total) + ' tokens so far (' + c.est(e.total_usd) + ').');
    }
    out.push(t.trusted ? 'These numbers are complete.' : 'These numbers are incomplete: ' + t.reasons_plain.join('; ') + '.');
    return out;
  }
  if (c.level === 'product') {
    const out = ['Runs: ' + s.runs + ' · items done: ' + s.done + ' · blocked: ' + s.blocked + ' · held: ' + s.held + ' · published: ' + s.shared];
    if (s.done) {
      out.push('Tokens: ' + ml.fmtTokens(k.total) + ' total, ' + ml.fmtTokens(k.per_done) + ' per item ' + c.est(e.total_usd) + '; first-pass ' + pct(r.first_pass_rate) + '; ' + plural(r.rounds, 'fix round') + '.');
    } else {
      out.push('No items done yet; ' + ml.fmtTokens(k.total) + ' tokens so far ' + c.est(e.total_usd) + '.');
    }
    out.push('Review: ' + rv.must_fix + ' must-fix across ' + plural(rv.dispatches, 'review') + '. Questions for you: ' + o.asked + ' asked, ' + o.defaulted + ' defaulted, ' + o.waiting + ' open.');
    out.push(t.trusted ? 'Measurements complete.' : 'Measurements incomplete: ' + t.reasons_plain.join('; ') + '.');
    return out;
  }
  const w = s.window;
  const out = ['scorecard ' + w.since.slice(0, 10) + ' → ' + w.until.slice(0, 10) + ' · ' + s.runs + ' run(s) · ' + s.done + ' done · '
    + s.blocked + ' blocked · ' + s.held + ' held · ' + s.shared + ' shared'];
  if (t.trusted) {
    out.push('TRUSTED — events ' + pct(t.event_coverage) + ' · usage ' + pct(t.usage_coverage) + ' · unattributed ' + pct(t.unattributed_share));
  } else {
    out.push('UNTRUSTED (' + t.reasons.join('; ') + ') — the numbers below undercount');
  }
  const n = s.done;
  const kd = k.by_kind;
  out.push('tokens ' + ml.fmtTokens(k.total) + '  (input ' + ml.fmtTokens(kd.input) + ' · output ' + ml.fmtTokens(kd.output)
    + ' · cache read ' + ml.fmtTokens(kd.cache_read) + ' · cache write ' + ml.fmtTokens(kd.cache_write) + ')  '
    + c.est(e.total_usd) + (e.prices_date && e.total_usd !== null ? ' of ' + e.prices_date : ''));
  const split = Object.keys(k.by_stage).filter((st) => k.by_stage[st] && n).map((st) => st + ' ' + ml.fmtTokens(k.by_stage[st] / n)).join(' · ');
  out.push('1 tokens per done item   ' + ml.fmtTokens(k.per_done) + '  (' + (split || 'no usage') + ')  ' + c.est(e.per_done_usd));
  out.push('2 orchestrator share     ' + pct(s.orchestrator_share) + '  (of tokens; target < 25%)');
  out.push('3 rework                 first-pass ' + pct(r.first_pass_rate) + ' · ' + pct(r.rework_share) + ' of item tokens after first round · rounds ' + r.rounds);
  const each = rv.tokens_per_must_fix !== null ? ' (' + ml.fmtTokens(rv.tokens_per_must_fix) + ' tokens each)' : '';
  out.push('4 review yield           checker ' + rv.must_fix + ' must-fix / ' + rv.dispatches + ' dispatches' + each + (rv.dry ? ' DRY' : ''));
  const qpi = o.questions_per_item === null ? 'n/a' : o.questions_per_item.toFixed(2);
  out.push('5 owner load             ' + qpi + ' questions per item · asked ' + o.asked + ' · defaulted ' + o.defaulted + ' · done→shared median ' + hours(o.median_done_to_shared_h) + ' · ' + o.waiting + ' waiting');
  out.push('6 tokens per shared link ' + ml.fmtTokens(k.per_shared) + (k.per_shared === null ? '' : '  ' + c.est(e.per_shared_usd)));
  out.push('7 said to you            ' + (o.said_words_per_run === null ? 'n/a' : '≈' + o.said_words_per_run + ' words/run') + '  (' + o.said_chars + ' chars)');
  out.push('-- digest: ' + ml.fmtTokens(k.per_done) + ' tokens/item ' + c.est(e.per_done_usd) + ' · orchestrator ' + pct(s.orchestrator_share) + ' · first-pass ' + pct(r.first_pass_rate) + ' · ' + qpi + ' questions/item');
  return out;
}

// --- the idea, read back from its draft ------------------------------------------------------------

const sp = require('./lib/spec');

/** spec view: the interview's read-back (default) or, with --partial, the one-line shape so far.
 *  Everything comes from <cohdit>/spec.json and the data files; the model adds nothing. */
function viewSpec(c, a) {
  const spec = c.spec;
  const tech = c.level === 'tech';
  if (!spec.name) return [tech ? 'no spec' : c.w.noIdea];
  if (spec.refused) {
    const cat = (c.rails.refuse || {})[spec.refused] || {};
    return [c.w.refusedIdea(spec.name, cat.plain || 'fall into a refused category')];
  }
  const iv = sp.loadInterview();
  const items = spec.items || [];
  const thing = tech ? 'item' : c.w.thing;
  if (a.partial) {
    if (!items.length) return [tech ? 'nothing recorded yet' : 'Nothing written down yet. Go on.'];
    const shown = new Set((ml.readJson(path.join(c.cohdit, 'local.json'), {}).shown_items) || []);
    const added = items.filter((i) => !shown.has(i.id)).map((i) => i.title);
    if (shown.size && added.length && added.length < items.length) {
      return ['Added: ' + added.join(', ') + ". That's " + plural(items.length, thing) + ' so far. Go on.'];
    }
    return [cz.fill((iv.voice || {}).reflect || 'So far: {shape}. Go on.', { shape: items.map((i) => i.title).join(', ') })];
  }
  const out = [];
  const trim = (t) => String(t).replace(/[.!]+$/, '');
  out.push(spec.name + (spec.for ? ' — for ' + trim(spec.for) : '') + (spec.anchor ? '. Worked: ' + trim(spec.anchor) : '') + '.');
  items.forEach((it, n) => {
    const check = (it.criteria || []).join('; ');
    out.push('  ' + (tech ? it.id : String(n + 1)) + ' ' + pad(it.title, 16) + (check ? ' — ' + check : '') + (it.device ? ' (checked when you try it)' : ''));
  });
  if ((spec.out || []).length) out.push('Not in the first version: ' + spec.out.join(', ') + '.');
  const gates = spec.gates || {};
  const gdef = iv.gates || {};
  const norm = (g) => (typeof gates[g] === 'object' ? gates[g] : { value: !!gates[g], source: 'said' });
  const order = Object.keys(gdef).filter((g) => g in gates).concat(Object.keys(gates).filter((g) => !(g in gdef)));
  const inferred = order.filter((g) => norm(g).source === 'inferred');
  const yes = order.filter((g) => norm(g).value);
  if (inferred.length) {
    const phrases = inferred.map((g) => (norm(g).value ? (gdef[g] || {}).assume_yes : (gdef[g] || {}).assume_no) || g);
    out.push((tech ? 'Assumed, not said: ' : "I'm assuming: ") + phrases.join(', ') + '.');
    out.push((iv.readback || {}).ask_about_assumptions || "Anything in what I'm assuming that's wrong?");
  }
  for (const g of yes) {
    const phrase = (gdef[g] || {}).assume_yes || g;
    const rule = ((c.rails.rule || {})[g] || {}).plain || g;
    const tail = c.level === 'plain' ? (gdef.rule_attached_plain || 'so a few extra rules apply; nothing for you to do')
      : cz.fill(gdef.rule_attached_product || 'so a build rule is attached: {rule_plain}', { rule_plain: rule });
    out.push(phrase.charAt(0).toUpperCase() + phrase.slice(1) + ', ' + tail + '.');
  }
  const mine = (spec.decisions || []).filter((d) => d.who !== 'you');
  const yours = (spec.decisions || []).filter((d) => d.who === 'you');
  if (mine.length) {
    out.push(c.level === 'plain' ? 'Decisions I took: ' + mine.length + '. Say "what did you decide" any time.'
      : 'Decisions I took: ' + mine.map((d) => d.type + ': ' + d.choice).join('; ') + '.');
  }
  if (yours.length && c.level !== 'plain') out.push('Your decisions: ' + yours.map((d) => d.type + ': ' + d.choice).join('; ') + '.');
  out.push('Open questions: ' + ((spec.open_questions || []).map(trim).join('; ') || 'none') + '.');
  out.push('Called ' + spec.name + ', in a folder called ' + (spec.slug || sp.slugify(spec.name)) + '; change either by saying so.');
  const hosting = sp.loadHosting();
  const hd = (spec.decisions || []).find((d) => d.type === 'hosting');
  if (!hd || hd.who !== 'you') out.push(hosting.stated || '');
  else out.push('Where it lives: ' + (((hosting.options || {})[hd.choice] || {}).plain || hd.choice) + '.');
  const tv = sp.terms().version;
  const agreedV = ml.userSettings().terms_v;
  out.push(agreedV === tv
    ? '"Yes, that\'s it" also agrees that what you build is yours to answer for (terms, version ' + tv + ').'
    : 'Say yes to agree that what you build is yours to answer for (terms, version ' + tv + '; say "read me the terms").');
  return out.filter((l) => l !== '');
}

// --- the checklist: what to try, in the person's own words ----------------------------------------

// The try standard: below the tech level, a thing on the list is its title and one line of how to try
// it, never longer than TRY_LINE_MAX. The line is the first sentence of the maker's note that is not
// about wording it wrote; that wording is named once, at the end, by item number.
const TRY_LINE_MAX = 100;
const TRY_TITLE_MAX = 48;
const ABOUT_WORDING = /\bI (wrote|drafted)\b|\bmyself\b|\bwording\b|\bplease read\b/i;

function sentences(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z"'(])/).filter(Boolean);
}

/** s cut at a word so it is at most max characters, ending in "…" when cut. */
function cutAt(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), Math.floor(max / 3))).replace(/[\s,;:—(-]+$/, '') + '…';
}

/** One short line from a note or a check: its first sentence not about wording, cut at a word. */
function shortLine(text) {
  const s = sentences(text).find((x) => !ABOUT_WORDING.test(x));
  if (!s) return '';
  return cutAt(s[0].toUpperCase() + s.slice(1), TRY_LINE_MAX);
}

/** A title short enough to read at a glance (a bug's title can be a whole error message). */
function shortTitle(text) {
  return cutAt(String(text || '').replace(/\s+/g, ' ').trim(), TRY_TITLE_MAX);
}

/** checklist view: the live try's address and the things left on its list, numbered as the try
 *  numbered them (the TRY_START event freezes the order), each a short title and one short line of how
 *  to try it; a device check carries the same-wifi address. Without a live try: what a try would cover. */
function viewChecklist(c, a) {
  const w = c.w;
  const tech = c.level === 'tech';
  const items = c.spec.items || [];
  const live = [...c.runs.keys()].filter((run) => {
    const rs = c.runs.get(run);
    return rs[0].c === 'RUN_START' && rs[0].f.skill === 'try' && c.runState(run)[0] === 'live';
  }).sort();
  const run = live.length ? live[live.length - 1] : null;
  const rs = run ? c.runs.get(run) : [];
  const starts = rs.filter((r) => r.c === 'TRY_START');
  const start = starts.length ? starts[starts.length - 1] : null;
  let ids;
  if (start) {
    const answered = new Set(rs.filter((r) => r.c === 'TRY_RESULT').map((r) => r.i));
    ids = start.f.items.filter((i) => !answered.has(i));
  } else {
    const built = items.some((i) => !i.device && ['done', 'tried'].includes(c.statusOf(i)));
    ids = items.filter((i) => (i.device ? built && c.statusOf(i) === 'queued' : c.statusOf(i) === 'done')).map((i) => i.id);
  }
  if (!start && !ids.length) return [w.nothingToTry];
  const out = [];
  if (start) out.push(c.line(start, tech ? 'product' : c.level, rs));
  const order = start ? start.f.items : ids;
  const wrote = [];
  for (const i of ids) {
    const it = c.item(i) || {};
    const n = order.indexOf(i) + 1;
    const device = it.device && start && start.f.lan ? w.onDevice(start.f.lan) : '';
    const note = c.note(i);
    // every level: the title, then one short line of how to try it (the standard: TRY_TITLE_MAX, TRY_LINE_MAX)
    out.push('  ' + n + ' ' + shortTitle(c.title(i)) + (tech ? ' (' + i + ')' : ''));
    const how = shortLine(note) || shortLine((it.criteria || [])[0]) || '?';
    out.push('    ' + (device ? device[0].toUpperCase() + device.slice(1) + how[0].toLowerCase() + how.slice(1) : how));
    if (c.wroteWords(i)) wrote.push(n);
  }
  if (wrote.length) out.push(w.wroteWords(wrote));
  if (!ids.length) out.push(tech ? 'every item has a result' : w.tryAnswer);
  else out.push(start ? w.tryAnswer : w.trySay);
  return out;
}

const VIEWS = { status: viewStatus, why: viewWhy, digest: viewDigest, events: viewEvents, score: viewScore, spec: viewSpec, checklist: viewChecklist };
const USAGE_TEXT = 'usage: render.js <view> [--level plain|product|tech] [--cohdit DIR] [--now ISO] [--run ID | --last] [--item ITEM-NNN] [--since ISO] [--until ISO] [--spool FILE] [--json]\n'
  + 'views: ' + Object.keys(VIEWS).join(' ') + '\n';

function parseArgs(argv) {
  const a = { view: null, level: null, cohdit: null, now: null, run: null, last: false, item: null, since: null, until: null, spool: null, json: false, partial: false };
  const valued = ['level', 'cohdit', 'now', 'run', 'item', 'since', 'until', 'spool'];
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--last' || x === '--json' || x === '--partial') {
      a[x.slice(2)] = true;
    } else if (x.startsWith('--')) {
      const eq = x.indexOf('=');
      const k = eq > 0 ? x.slice(2, eq) : x.slice(2);
      if (!valued.includes(k)) throw new Error('unknown option ' + x);
      const v = eq > 0 ? x.slice(eq + 1) : argv[++i];
      if (v === undefined) throw new Error(x + ' needs a value');
      a[k] = v;
    } else if (a.view === null) {
      a.view = x;
    } else {
      throw new Error('unexpected argument ' + x);
    }
  }
  if (!a.view || !VIEWS[a.view]) throw new Error('view must be one of ' + Object.keys(VIEWS).join(', '));
  if (a.level !== null && !cz.LEVELS.includes(a.level)) throw new Error('--level must be one of ' + cz.LEVELS.join(', '));
  return a;
}

/** --level, else the project's config, else the person's settings, else plain. */
function resolveLevel(a) {
  if (a.level) return a.level;
  for (const src of [ml.loadConfig(a.cohdit), ml.userSettings()]) {
    if (cz.LEVELS.includes(src.level)) return src.level;
  }
  return 'plain';
}

function main(argv) {
  let a;
  try {
    a = parseArgs(argv);
  } catch (e) {
    process.stderr.write('render: ' + e.message + '\n' + USAGE_TEXT);
    return 64;
  }
  if (!a.cohdit) {
    try {
      a.cohdit = path.join(ml.repoRoot(), ml.COHDIT_DIR);
    } catch (e) {
      process.stderr.write('render: not in a git repository and no --cohdit given\n');
      return 2;
    }
  }
  a.level = resolveLevel(a);
  if (!a.spool) {
    // A project's own spool holds the live run's records: status mid-build reads them. Only when the
    // folder above .cohdit is itself the repository, so fixtures and goldens never see one.
    try {
      const top = path.dirname(path.resolve(a.cohdit));
      if (path.resolve(ml.git(['rev-parse', '--show-toplevel'], top)) === top) a.spool = path.join(ml.spoolDir(top), 'spool.jsonl');
    } catch (e) { /* not a repository */ }
  }
  const c = new Ctx(a);
  process.stdout.write(VIEWS[a.view](c, a).join('\n') + '\n');
  return 0;
}

if (require.main === module) {
  api.preloadData().then(() => main(process.argv.slice(2)), (e) => {
    process.stdout.write(api.message(e.code) + '\n');
    return 1;
  }).then((code) => { process.exitCode = code; });
}
module.exports = { Ctx, WORDS, score, VIEWS, parseArgs, resolveLevel, main, shortLine, shortTitle };

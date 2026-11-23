'use strict';
/**
 * lib/metrics.js — anonymous numbers about one finished build run, shared only when the person said yes.
 *
 *   status()          'on' | 'off' | 'ask'   (~/.cohdit/settings.json `metrics`; undecided is 'ask', never 'on')
 *   set('on'|'off')   the person's answer
 *   build(c, run)     the payload for one run: built from the scorecard, field by field
 *   check(payload)    [] when every field is on the allowlist and every value is a number, a flag or a
 *                     fixed label. Anything else is a problem, and a payload with a problem is never sent.
 *   record(c, run)    build, check, queue, and try to send. Never throws, never waits long, never blocks a build.
 *   flush()           send what is queued (kept up to QUEUE_MAX lines when offline)
 *
 * What never goes in: names, titles, file paths, project or idea names, error text, the person's words,
 * the key, the machine id. The server gets a separate random install id, made here, that joins to nothing.
 */
const fs = require('fs');
const path = require('path');
const ml = require('./ledger');
const api = require('./api');

const QUEUE_MAX = 50;
const ENDPOINT = '/metrics';

const NUM = 'num';       // a finite number, 0 to 1e12
const RATE = 'rate';     // a finite number, 0 to 1
const FLAG = 'flag';
const label = (re) => ({ re });
const SCHEMA = {
  v: NUM, id: label(/^[a-f0-9]{16}$/), plugin: label(/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,4}$/),
  os: label(/^(mac|windows|linux|other)$/), outcome: label(/^(ok|stopped|crashed)$/),
  stop: label(/^[a-z_]{1,24}$/),
  done: NUM, blocked: NUM, held: NUM, shared: NUM, minutes: NUM,
  tokens: { total: NUM, orchestrator: NUM, build: NUM, check: NUM, rework: NUM, other: NUM },
  usd: NUM, first_pass: RATE, orchestrator_share: RATE,
  review: { dispatches: NUM, must_fix: NUM },
  owner: { asked: NUM, defaulted: NUM },
  proof: { items: NUM, tests: NUM, cov_avg: NUM, cases_tested: NUM, cases_possible: NUM },
  trust: { ok: FLAG, events: RATE, usage: RATE },
  models: [label(/^claude-[a-z0-9.-]{1,40}$/)],
};

function ok(spec, v) {
  if (v === null) return true;
  if (spec === FLAG) return typeof v === 'boolean';
  if (spec === NUM) return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e12;
  if (spec === RATE) return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  if (spec && spec.re) return typeof v === 'string' && spec.re.test(v);
  return false;
}

/** The problems with a payload; empty means it is only numbers, flags and fixed labels from the allowlist. */
function check(p, schema, at) {
  const sc = schema || SCHEMA, where = at || '';
  const out = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return [where + ' is not an object'];
  for (const k of Object.keys(p)) {
    const spec = sc[k], v = p[k], name = where + k;
    if (spec === undefined) out.push(name + ' is not allowed');
    else if (Array.isArray(spec)) {
      if (!Array.isArray(v) || v.length > 8 || !v.every((x) => ok(spec[0], x))) out.push(name + ' is not a list of allowed labels');
    } else if (spec && typeof spec === 'object' && !spec.re) {
      out.push(...check(v, spec, name + '.'));
    } else if (!ok(spec, v)) out.push(name + ' is not an allowed value');
  }
  return out;
}

// --- consent ---------------------------------------------------------------------------------------

function status() {
  const v = ml.userSettings().metrics;
  return v === 'on' || v === 'off' ? v : 'ask';
}

function set(v) {
  if (v !== 'on' && v !== 'off') throw new Error('metrics is on or off');
  const file = ml.settingsPath();
  const s = ml.readJson(file, {});
  s.metrics = v;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
}

/** Say the question once: true the first time it is asked, false after (the answer, or the asking, is kept). */
function askedOnce() {
  const file = ml.settingsPath();
  const s = ml.readJson(file, {});
  if (s.metrics_asked) return false;
  s.metrics_asked = true;
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n'); } catch (e) { return false; }
  return true;
}

// --- the payload -----------------------------------------------------------------------------------

function idFile() { return path.join(api.home(), 'metrics-id'); }

/** A random id for these numbers alone. It is not the machine id and not the key. */
function installId() {
  try {
    const id = fs.readFileSync(idFile(), 'utf8').trim();
    if (/^[a-f0-9]{16}$/.test(id)) return id;
  } catch (e) { /* made below */ }
  const id = require('crypto').randomBytes(8).toString('hex');
  try { fs.mkdirSync(api.home(), { recursive: true, mode: 0o700 }); fs.writeFileSync(idFile(), id + '\n', { mode: 0o600 }); } catch (e) { return null; }
  return id;
}

function round(n, d) { return n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * Math.pow(10, d)) / Math.pow(10, d); }

/** The numbers for one run. `render` is passed in (render.js requires this tree; it is not required here). */
function build(c, run, render) {
  const recs = c.recs.filter((r) => r.r === run);
  const start = recs.find((r) => r.c === 'RUN_START');
  if (!start) return null;
  const since = ml.parseTs(start.ts);
  const s = render.score(c, since, new Date(c.now.getTime() + 1000), run);
  const end = recs.find((r) => r.c === 'RUN_END');
  const stop = recs.filter((r) => r.c === 'STOP').pop();
  const st = s.tokens.by_stage;
  const done = recs.filter((r) => r.c === 'DONE');
  const cov = done.map((r) => r.f.cov).filter((n) => typeof n === 'number');
  let tested = 0, possible = 0;
  for (const r of done) {
    if (!Array.isArray(r.f.cases)) continue;
    const na = Array.isArray(r.f.na) ? r.f.na.length : 0;
    tested += r.f.cases.length;
    possible += Math.max(0, 6 - na);
  }
  const models = new Set();
  for (const r of recs.filter((x) => x.c === 'USAGE')) for (const m of Object.keys(r.f.models || {})) if (SCHEMA.models[0].re.test(m)) models.add(m);
  const last = end ? ml.parseTs(end.ts) : c.now;
  return {
    v: 1, id: installId(), plugin: /^[0-9.]+$/.test(String(start.f.plugin || '')) ? start.f.plugin : null,
    os: start.f.os || 'other', outcome: end ? end.f.outcome : 'crashed', stop: stop ? stop.f.cause : null,
    done: s.done, blocked: s.blocked, held: s.held, shared: s.shared, minutes: round((last - since) / 60000, 1),
    tokens: { total: st.orchestrator + st.build + st.check + st.rework + st.other, orchestrator: st.orchestrator, build: st.build, check: st.check, rework: st.rework, other: st.other },
    usd: round(s.est.total_usd, 2), first_pass: round(s.rework.first_pass_rate, 3), orchestrator_share: round(s.orchestrator_share, 3),
    review: { dispatches: s.review.dispatches, must_fix: s.review.must_fix },
    owner: { asked: s.owner.asked, defaulted: s.owner.defaulted },
    proof: {
      items: done.length, tests: done.reduce((n, r) => n + (r.f.tests || 0), 0),
      cov_avg: cov.length ? Math.round(cov.reduce((a, b) => a + b, 0) / cov.length) : null, cases_tested: tested, cases_possible: possible,
    },
    trust: { ok: s.trust.trusted, events: round(s.trust.event_coverage, 3), usage: round(s.trust.usage_coverage, 3) },
    models: [...models].sort().slice(0, 8),
  };
}

// --- queue and send --------------------------------------------------------------------------------

function queueFile() { return path.join(api.home(), 'metrics-queue.jsonl'); }

function queued() {
  try { return fs.readFileSync(queueFile(), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { return []; }
}

function writeQueue(list) {
  try {
    fs.mkdirSync(api.home(), { recursive: true, mode: 0o700 });
    if (!list.length) { try { fs.unlinkSync(queueFile()); } catch (e) { /* none */ } return; }
    fs.writeFileSync(queueFile(), list.slice(-QUEUE_MAX).map((p) => JSON.stringify(p)).join('\n') + '\n', { mode: 0o600 });
  } catch (e) { /* nothing to keep it in: it is dropped */ }
}

/** Send what is queued, oldest first; stop at the first one Cohdit does not take. Returns how many went. */
async function flush() {
  if (status() !== 'on') return 0;
  let sent = 0;
  const list = queued().filter((p) => !check(p).length);
  for (; sent < list.length; sent++) if (!(await api.send(ENDPOINT, list[sent]))) break;
  writeQueue(list.slice(sent));
  return sent;
}

/** After a run ends: only when the person said yes. Never throws. */
async function record(c, run, render) {
  try {
    if (status() !== 'on') return 'off';
    const p = build(c, run, render);
    if (!p) return 'none';
    if (check(p).length) return 'refused';
    const list = queued();
    if (!list.some((q) => q.id === p.id && q.minutes === p.minutes && q.tokens.total === p.tokens.total && q.done === p.done)) list.push(p);
    writeQueue(list);
    await flush();
    return 'ok';
  } catch (e) { return 'error'; }
}

module.exports = { SCHEMA, QUEUE_MAX, ENDPOINT, status, set, askedOnce, build, check, queued, flush, record, installId };

'use strict';
/**
 * lib/share.js — the one yes and the deploy. Vercel lives here and nowhere else: the project's name,
 * the deploy, the wait, the build log, the public address. `hatch.js share` is the only caller.
 *
 * Rulings of 2026-10-28: one question once per project, printed by the script with the likely address
 * and what becomes public (the app; the code and anything typed into it stay in the person's accounts);
 * no extra warning for a gate; nothing asked about who gets the link first, the digest says it; after a
 * failed publish the person is told to say "share it" again or "show me the details", one attempt per
 * run; share stops on changes Hatch did not make, as build does.
 *
 * The publishing tool is run through npx (lib/doctor.js VERCEL) and goes through the same runner as every
 * probe, so tests stub it (COHDIT_PROBES). Under Claude Code the tool detects an agent and is
 * non-interactive by itself; `--json` is passed anyway so the answer has one shape everywhere. Hatch holds
 * no token: the tool keeps its own sign-in from setup.
 *
 * The project is created by the deploy itself (`--create-if-missing`, the only non-interactive way), named
 * after the GitHub copy when there is one, else the idea's slug; a name already in the person's scope gets
 * -2, -3. The name and the public address are recorded in `.cohdit/config.json` `connectors.vercel`, which
 * travels with the idea, so a second computer deploys to the same project without a `.vercel` folder.
 *
 * Only the production address is ever handed back. Under Vercel's default protection the deployment's own
 * address asks for a Vercel login; the production address is public.
 */
const fs = require('fs');
const path = require('path');
const doc = require('./doctor');
const bd = require('./build');
const sp = require('./spec');

const WAIT_MIN = 8;                             // minutes one call may wait on a deployment, under Claude Code's limit for a call
const MAX_WAITS = 4;                            // calls a deploy may stay "building" before it is a stop (about half an hour)
const MAX_UNREADABLE = 2;                       // consecutive answers the tool could not give before it is a stop
const LOG_TAIL = 60;
const IGNORE_FILE = '.vercelignore';
const IGNORE = '.cohdit\n.env\n.env.*\ncoverage\n';     // never uploaded: the ledger, any secrets file, the test run's coverage
const REPORT_PREFIX = 'reports/';               // where the scaffold's /api/report route saves in the store

function vc(run, args, opts) {
  return run(doc.VERCEL[0], doc.VERCEL.slice(1).concat(args), opts);
}

function scoped(args, scope) {
  return scope ? args.concat(['--scope', scope]) : args;
}

function parseJson(text) {
  try { return JSON.parse(String(text || '').trim()); } catch (e) { return null; }
}

/** The name the Vercel project should have: the one recorded, else the GitHub copy's, else the slug. */
function baseName(cfg, spec) {
  const c = (cfg.connectors || {}).vercel || {};
  if (c.project) return c.project;
  const repo = ((cfg.connectors || {}).github || {}).repo || '';
  return repo.includes('/') ? repo.split('/')[1] : spec.slug;
}

/** Project names already in the person's scope that start with `base`. Empty when the tool cannot say. */
function takenNames(run, base, scope) {
  const r = vc(run, scoped(['project', 'ls', '--json', '--limit', '100', '--filter', base], scope));
  const j = r.code === 0 ? parseJson(r.out) : null;
  const list = j ? (Array.isArray(j) ? j : j.projects || []) : [];
  return new Set(list.map((p) => p && p.name).filter(Boolean));
}

/** `base`, or `base-2`, `base-3` … the first not taken. */
function freeName(base, taken) {
  let name = base, n = 2;
  while (taken.has(name)) name = base + '-' + n++;
  return name;
}

/** The deploy's answer, in either of the tool's two JSON shapes (agent wrapper or bare). */
function parseDeploy(text) {
  const j = parseJson(text);
  if (!j || typeof j !== 'object') return null;
  if (j.status && j.status !== 'ok' && !j.deployment) return { ok: false, message: j.message || j.reason || 'the publishing tool refused' };
  const d = j.deployment || j;
  if (!d.url) return null;
  return { ok: true, url: withScheme(d.url), dep: d.id || undefined, prod: d.productionUrl ? withScheme(d.productionUrl) : null, state: stateOf(d.readyState) };
}

/** Start one production deploy and return at once: {ok, url, dep, prod, state} or {ok:false, message}. */
function deploy(run, dir, name, scope) {
  const args = scoped(['deploy', '--prod', '--yes', '--project', name, '--create-if-missing', '--no-wait', '--json'], scope);
  const r = vc(run, args, { cwd: dir, timeout: bd.LONG_MS });
  const parsed = parseDeploy(r.out);
  if (r.code === 0 && parsed && parsed.ok) return parsed;
  const message = (parsed && parsed.message) || tail(r.err + '\n' + r.out) || (r.code === null ? 'the publishing tool could not be started' : 'the publishing tool failed');
  return { ok: false, message };
}

/** DEPLOY.state for the tool's readyState. Anything not terminal is still building. */
function stateOf(readyState) {
  const s = String(readyState || '').toUpperCase();
  if (s === 'READY') return 'ready';
  if (s === 'ERROR') return 'error';
  if (s === 'CANCELED') return 'canceled';
  return 'building';
}

/** Wait on the deployment for up to `minutes`. {state, aliases, unreadable, err}: a timeout is 'building'; an
 *  answer with no JSON at all is 'building' too but marked unreadable, so the caller can give up after a few. */
function wait(run, url, scope, minutes) {
  const m = Math.max(1, Math.min(WAIT_MIN, Math.round(minutes || WAIT_MIN)));
  const r = vc(run, scoped(['inspect', url, '--wait', '--timeout', m + 'm', '--json'], scope), { timeout: bd.LONG_MS });
  const j = parseJson(r.out);
  const unreadable = !j && r.code !== 0;
  return { state: stateOf(j && j.readyState), aliases: j && Array.isArray(j.aliases) ? j.aliases : [], unreadable, err: unreadable ? tail(r.err + '\n' + r.out) : '' };
}

/** How many minutes of an eight-minute call are left after `elapsedMs`; never under one. */
function minutesLeft(elapsedMs) {
  return Math.max(1, WAIT_MIN - Math.floor((elapsedMs || 0) / 60000));
}

/** Has this deploy been waited on too long or answered unreadably too often to go on? Mutates the pending
 *  record's counters; returns the reason to stop, or null. */
function giveUp(p, insp) {
  p.waits = (p.waits || 0) + 1;
  p.unreadable = insp.unreadable ? (p.unreadable || 0) + 1 : 0;
  if (p.unreadable >= MAX_UNREADABLE) return 'the publishing tool could not say how the deploy was going:\n' + (insp.err || '(no answer)');
  if (p.waits >= MAX_WAITS) return 'the deploy was still building after ' + p.waits + ' waits; it may finish on its own, say "share it" again later';
  return null;
}

/** The last lines of the deployment's build log, for the blob. */
function buildLog(run, url, scope) {
  const r = vc(run, scoped(['inspect', url, '--logs'], scope), { timeout: bd.LONG_MS });
  return tail(r.out + '\n' + r.err) || 'the build failed; the publishing tool kept no log';
}

function tail(text) {
  return String(text || '').trim().split('\n').filter((l) => l.trim()).slice(-LOG_TAIL).join('\n');
}

/** The public address: the deployment's first alias (the production domain), else what the tool lists
 *  for the project, else the conventional one. */
function productionUrl(run, name, scope, insp, prodFromDeploy) {
  if (prodFromDeploy) return withScheme(prodFromDeploy);
  const alias = (insp && insp.aliases || []).find(Boolean);
  if (alias) return withScheme(alias);
  const r = vc(run, scoped(['project', 'ls', '--json', '--filter', name], scope));
  const j = r.code === 0 ? parseJson(r.out) : null;
  const hit = ((j && (Array.isArray(j) ? j : j.projects)) || []).find((p) => p && p.name === name);
  if (hit && hit.latestProductionUrl && hit.latestProductionUrl !== '--') return withScheme(hit.latestProductionUrl);
  return 'https://' + name + '.vercel.app';
}

/** The tool gives some addresses bare; the ledger's url type wants a scheme. */
function withScheme(u) {
  const s = String(u).trim();
  return /^https?:\/\//.test(s) ? s : 'https://' + s;
}

/** The ledger, the spec and any secrets file never travel with a deploy. Written once and committed on
 *  the main line, so the next build finds a clean tree. Returns true when it wrote the file. */
function ensureIgnore(dir) {
  const file = path.join(dir, IGNORE_FILE);
  if (fs.existsSync(file)) return false;
  fs.writeFileSync(file, IGNORE);
  bd.git(['add', '--', IGNORE_FILE], dir, false);
  if (bd.git(['commit', '-q', '-m', 'Hatch: publish settings'], dir, false) === null) {   // no identity, a hook: never leave it to trip the next gate
    bd.git(['reset', '-q', '--', IGNORE_FILE], dir, false);
    try { fs.unlinkSync(file); } catch (e) { /* already gone */ }
    return false;
  }
  return true;
}

/** A share run left open with nothing on its way (a question never answered): closed in the ledger, so
 *  build or try can start and `why` never calls it a crash. */
function closeIdle(dir, cur, outcome) {
  bd.emit(dir, cur.run, [['RUN_END', { outcome: outcome || 'ok' }]]);
  bd.flush(dir, cur.run);
  const active = bd.active(dir);
  if (active && active.run === cur.run) require('./ledger').clearActiveRun(dir);
  bd.clearPointer(dir, cur.session);
  savePending(dir, null);
}

/** Link the folder to the project so the blob tool can act on it (`.vercel/` is gitignored by the scaffold). */
function link(run, dir, name, scope) {
  return vc(run, scoped(['link', '--yes', '--project', name], scope), { cwd: dir, timeout: bd.NET_MS }).code === 0;
}

/** A private store for the app's problem reports, connected to the project once and recorded in config
 *  as `connectors.vercel.reports`. 'ok' | 'exists' | 'failed'. */
function ensureReportStore(run, dir, cfg, name, scope) {
  if (((cfg.connectors || {}).vercel || {}).reports) return 'exists';
  if (!link(run, dir, name, scope)) return 'failed';
  const store = name + '-reports';
  const r = vc(run, scoped(['blob', 'create-store', store, '--access', 'private', '--yes'], scope), { cwd: dir, timeout: bd.NET_MS });
  if (r.code !== 0) return 'failed';
  record(dir, cfg, { reports: store });
  return 'ok';
}

/** Every report the live app saved under reports/: downloaded into `into`, then deleted from the store so
 *  each is eaten once. Returns the files; [] when there is no store or the tool cannot be reached. */
function pullReports(run, dir, cfg, scope, into) {
  const c = (cfg.connectors || {}).vercel || {};
  if (!c.reports || !c.project || !link(run, dir, c.project, scope)) return [];
  const ls = vc(run, scoped(['blob', 'list', '--prefix', REPORT_PREFIX, '--limit', '1000'], scope), { cwd: dir, timeout: bd.NET_MS });
  if (ls.code !== 0) return [];
  const names = [...new Set(ls.out.match(/reports\/[\w.-]+\.json/g) || [])];
  fs.mkdirSync(into, { recursive: true });
  const files = [];
  for (const n of names) {
    const file = path.join(into, path.basename(n));
    const g = vc(run, scoped(['blob', 'get', n, '--access', 'private', '--output', file], scope), { cwd: dir, timeout: bd.NET_MS });
    if (g.code !== 0 || !fs.existsSync(file)) continue;
    files.push(file);
    vc(run, scoped(['blob', 'del', n], scope), { cwd: dir, timeout: bd.NET_MS });
  }
  return files;
}

/** The project's name and address as config and the registry remember them. */
function record(dir, cfg, fields) {
  cfg.connectors = Object.assign({}, cfg.connectors, { vercel: Object.assign({}, (cfg.connectors || {}).vercel, fields) });
  bd.saveCfg(dir, cfg);
  const reg = sp.registry();
  for (const p of reg.projects) if (p.path === dir) Object.assign(p, fields);
  sp.saveRegistry(reg);
}

/** The deployment a share run is waiting on, kept per working copy in local.json. */
function pending(dir) {
  return sp.readLocal(dir).share || null;
}

function savePending(dir, p) {
  const local = sp.readLocal(dir);
  if (p) local.share = p; else delete local.share;
  sp.writeLocal(dir, local);
}

module.exports = {
  WAIT_MIN, MAX_WAITS, MAX_UNREADABLE, IGNORE_FILE, IGNORE, REPORT_PREFIX, vc, scoped, parseJson, baseName, takenNames, freeName, parseDeploy, deploy, stateOf, wait, minutesLeft, giveUp, buildLog, tail,
  productionUrl, withScheme, ensureIgnore, record, pending, savePending, closeIdle, link, ensureReportStore, pullReports,
};

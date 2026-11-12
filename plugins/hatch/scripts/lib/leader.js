'use strict';
/**
 * leader.js — the software leader: the owner's whole knowledge, fetched from Cohdit as data `leader`.
 * Builds are decided against it: every maker brief carries the values and trade-off calls, the advisor
 * carries all of it, and the checker and each lens carry the rules of their own areas.
 *
 * The file is {v, name, sha, values[], calls[], limits[], knowledge[{id, domain, rule, why?, unless?,
 * example?}], reads{reader: [domain]}}. It is optional: when it cannot be had, the sections are left out
 * and the build goes on as before.
 *
 * COHDIT_LEADER=<file> moves it (tests).
 */
const ml = require('./ledger');
const api = require('./api');

/** The leader, or null when it cannot be had (an older content service, Cohdit unreachable). */
function load() {
  try {
    const l = process.env.COHDIT_LEADER ? ml.readJson(process.env.COHDIT_LEADER, null) : api.dataJson('leader');
    return l && Array.isArray(l.knowledge) ? l : null;
  } catch (e) {
    return null;
  }
}

function list(xs) { return (xs || []).filter((x) => typeof x === 'string' && x.trim()); }

function rule(k) {
  const out = ['- ' + k.rule];
  if (k.why) out.push('  Why: ' + k.why);
  if (k.unless) out.push('  Unless: ' + k.unless);
  if (k.example) out.push('  Example: ' + k.example);
  return out;
}

/** The values and the trade-off calls: how Cohdit decides, for every brief. */
function core(l) {
  if (!l) return [];
  const out = [];
  if (list(l.values).length) out.push('Values:', ...list(l.values).map((v) => '- ' + v));
  if (list(l.calls).length) {
    if (out.length) out.push('');
    out.push('Trade-off calls (each names its one exception):', ...list(l.calls).map((c) => '- ' + c));
  }
  return out;
}

/** The rules of the given domains, grouped by domain; all of them when domains is null. */
function rules(l, domains) {
  if (!l) return [];
  const pick = (l.knowledge || []).filter((k) => k && k.rule && (domains === null || domains.includes(k.domain)));
  const by = new Map();
  for (const k of pick) { if (!by.has(k.domain)) by.set(k.domain, []); by.get(k.domain).push(k); }
  const out = [];
  for (const d of [...by.keys()].sort()) out.push('', '### ' + d[0].toUpperCase() + d.slice(1), ...[].concat(...by.get(d).map(rule)));
  return out;
}

/** What one reader carries: the core, then its domains' rules. 'all' (advisor, ask) adds the limits and every rule. */
function forReader(l, reader) {
  if (!l) return '';
  const all = reader === 'all' || reader === 'advisor';
  const domains = all ? null : ((l.reads || {})[reader] || []);
  const out = core(l);
  if (all && list(l.limits).length) out.push('', 'Where the leader does not advise:', ...list(l.limits).map((x) => '- ' + x));
  const r = rules(l, domains);
  if (r.length) out.push('', 'Rules' + (all ? '' : ' for this review') + ':', ...r);
  return out.join('\n').trim();
}

module.exports = { load, core, rules, forReader };

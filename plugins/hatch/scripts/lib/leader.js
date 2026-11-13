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
 * Other knowledge agents come as packs of the same shape plus {slug, kind: software|domain, field}: an
 * idea uses the ones in spec.json `experts` (the person owns them). Their calls and the rules that match one
 * thing join the brief and the checker; the advisor carries each whole. A pack that cannot be had is left out.
 *
 * COHDIT_LEADER=<file> moves the leader, COHDIT_EXPERTS=<dir> the packs (<dir>/<slug>.json) (tests).
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

const LEADER_SLUG = 'software-leader';

/** One pack by slug, or null: tests' folder, else what api preloaded (or the dev folder). */
function pack(slug) {
  if (slug === LEADER_SLUG) {
    const own = process.env.COHDIT_EXPERTS ? null : api.expertJson(slug);
    return own && Array.isArray(own.knowledge) ? own : load();
  }
  let p = null;
  try {
    p = process.env.COHDIT_EXPERTS ? ml.readJson(require('path').join(process.env.COHDIT_EXPERTS, slug + '.json'), null) : api.expertJson(slug);
  } catch (e) { p = null; }
  return p && Array.isArray(p.knowledge) ? Object.assign({ slug }, p) : null;
}

/** The packs an idea uses besides the leader, in the spec's order; those that cannot be had are skipped. */
function used(spec) {
  const slugs = ((spec && spec.experts) || []).filter((s) => typeof s === 'string' && s !== LEADER_SLUG);
  return slugs.map(pack).filter(Boolean);
}

const STOP = new Set('a an and are as at be but by can do for from has have how if in into is it its no not of on or so that the their them then there they this to was we what when which who will with you your'.split(' '));
function words(text) {
  return new Set(String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
}

/** The domain rules that best match one thing's words, max across every pack together, best first
 *  (ties keep pack order, then file order). [{pack, rules: [rule]}] in pack order, packs with none left out. */
function matched(packs, text, max) {
  const want = words(text);
  const limit = max === undefined ? 12 : max;
  const scored = [];
  (packs || []).forEach((p, pi) => (p.knowledge || []).forEach((k, ki) => {
    if (!k || !k.rule) return;
    const have = words([k.rule, k.domain, ...(Array.isArray(k.tags) ? k.tags : [])].join(' '));
    let score = 0;
    for (const w of have) if (want.has(w)) score++;
    if (score) scored.push({ pi, ki, score, k });
  }));
  scored.sort((a, b) => b.score - a.score || a.pi - b.pi || a.ki - b.ki);
  const keep = scored.slice(0, limit);
  return (packs || []).map((p, pi) => ({ pack: p, rules: keep.filter((x) => x.pi === pi).sort((a, b) => b.score - a.score || a.ki - b.ki).map((x) => x.k) }))
    .filter((g) => g.rules.length);
}

/** Rule lines for a matched group. */
function ruleLines(rs) { return [].concat(...rs.map(rule)); }

module.exports = { LEADER_SLUG, load, core, rules, forReader, pack, used, matched, ruleLines };

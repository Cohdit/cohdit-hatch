'use strict';
/**
 * leader.js — knowledge agents' packs: an expert's whole knowledge, fetched from Cohdit as `expert/<slug>`.
 * An idea uses the packs in spec.json `experts` (the person owns them; the software leader is one of them).
 * Builds are decided against them: every maker brief carries each pack's values and trade-off calls and the
 * rules that match the thing, the advisor carries each whole, and the checker and each lens carry the rules
 * of their own areas. With no packs, the build goes on with the person's own model alone.
 *
 * A pack is {v, name, sha, slug, kind: software|domain, field, values[], calls[], limits[], knowledge[{id,
 * domain, rule, why?, unless?, example?}], reads{reader: [domain]}}. A pack that cannot be had is left out.
 *
 * COHDIT_EXPERTS=<dir> moves the packs (<dir>/<slug>.json) (tests).
 */
const ml = require('./ledger');
const api = require('./api');

function list(xs) { return (xs || []).filter((x) => typeof x === 'string' && x.trim()); }

function rule(k) {
  const out = ['- ' + k.rule];
  if (k.why) out.push('  Why: ' + k.why);
  if (k.unless) out.push('  Unless: ' + k.unless);
  if (k.example) out.push('  Example: ' + k.example);
  return out;
}

/** The values and the trade-off calls: how this agent decides, for every brief. */
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
  if (all && list(l.limits).length) out.push('', 'Where ' + (l.name || 'this agent') + ' does not advise:', ...list(l.limits).map((x) => '- ' + x));
  const r = rules(l, domains);
  if (r.length) out.push('', 'Rules' + (all ? '' : ' for this review') + ':', ...r);
  return out.join('\n').trim();
}

/** One pack by slug, or null: tests' folder, else what api preloaded (or the dev folder). */
function pack(slug) {
  let p = null;
  try {
    p = process.env.COHDIT_EXPERTS ? ml.readJson(require('path').join(process.env.COHDIT_EXPERTS, slug + '.json'), null) : api.expertJson(slug);
  } catch (e) { p = null; }
  return p && Array.isArray(p.knowledge) ? Object.assign({ slug }, p) : null;
}

/** The packs an idea uses, in the spec's order; those that cannot be had are skipped. */
function used(spec) {
  const slugs = ((spec && spec.experts) || []).filter((s) => typeof s === 'string');
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

module.exports = { core, rules, forReader, pack, used, matched, ruleLines };

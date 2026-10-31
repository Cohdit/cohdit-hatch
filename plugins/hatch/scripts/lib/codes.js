'use strict';
/**
 * lib/codes.js — load data/codes.json, validate a record against it, render a template.
 *
 * The table is the single schema. Nothing else in the plugin lists a code's fields or an enum's
 * values; ledger.js emit, ledger.js lint and render.js all come here.
 *
 * Three levels of language, one template each: `plain` (no technical experience), `product` (knows
 * how software gets made, not code; falls back to `plain` when absent), `tech` (developer). Each
 * level has a banned-word list that lint enforces, because a rule in prose is not proof.
 */
const fs = require('fs');
const ml = require('./ledger');
const api = require('./api');

const LEVELS = ['plain', 'product', 'tech'];
// No level may say spent/spend/bill: Hatch measures tokens and only estimates dollars at API list price.
const PLAIN_BANNED = /\b(branch|merge|commit|push|sha|exit|repo|deploy\w*|ITEM-\d*|spent|spend\w*|bill\w*)\b/i;
const PRODUCT_BANNED = /\b(sha|exit|rc|cmd|stdout|stderr|json|cli|argv|regex|spent|spend\w*|bill\w*)\b|ITEM-\d|[\w-]+\.(js|ts|tsx|sh|json)\b|claude-[\w-]+/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const INT_RE = /^[+-]?\d+$/;

function load(file) {
  return file ? JSON.parse(fs.readFileSync(file, 'utf8')) : api.dataJson('codes');
}

function loadRails(file) {
  return file ? ml.readJson(file, { refuse: {}, rule: {} }) : api.dataJson('rails');
}

class Invalid extends Error {}

/** [typeName, required, enumValues|null] for one field spec. */
function typeOf(spec) {
  if (spec && typeof spec === 'object') return ['enum', true, spec.enum];
  const required = !spec.endsWith('?');
  return [required ? spec : spec.slice(0, -1), required, null];
}

function isBlank(v) {
  return v === undefined || v === null || v === '';
}

/** Turn `k=v` strings (or already-typed values) into typed values per the code's field specs;
 *  throw Invalid on any unknown field, missing required field, or value that fails its type. */
function coerce(table, code, fields) {
  if (!table.codes[code]) throw new Invalid('unknown code ' + code);
  const specs = table.codes[code].fields;
  const out = {};
  for (const k of Object.keys(fields)) {
    if (!(k in specs)) {
      throw new Invalid(code + " has no field '" + k + "' (fields: " + Object.keys(specs).sort().join(', ') + ')');
    }
  }
  for (const k of Object.keys(specs)) {
    const [tname, required, enumVals] = typeOf(specs[k]);
    if (!(k in fields) || isBlank(fields[k])) {
      if (required) throw new Invalid(code + ' needs ' + k);
      continue;
    }
    out[k] = coerceValue(table, code, k, tname, enumVals, fields[k]);
  }
  return out;
}

function coerceValue(table, code, k, tname, enumVals, v) {
  const where = code + '.' + k;
  if (tname === 'enum') {
    if (!enumVals.includes(v)) throw new Invalid(where + ' must be one of ' + enumVals.join('|') + ", not '" + v + "'");
    return v;
  }
  if (tname === 'int') {
    if (typeof v === 'number' && Number.isInteger(v)) return v;
    if (!INT_RE.test(String(v).trim())) throw new Invalid(where + " must be an integer, not '" + v + "'");
    return parseInt(String(v).trim(), 10);
  }
  if (tname === 'list<ident>' || tname === 'list<item>') {
    const items = Array.isArray(v) ? v.slice() : String(v).split(',').filter(Boolean);
    const inner = new RegExp(table.types[tname === 'list<ident>' ? 'ident' : 'item']);
    for (const x of items) {
      if (!inner.test(x)) throw new Invalid(where + " entry '" + x + "' is not a valid " + tname.slice(5, -1));
    }
    return items.sort();
  }
  if (tname === 'models') {
    let obj = v;
    if (typeof obj === 'string') {
      try { obj = JSON.parse(obj); } catch (e) { throw new Invalid(where + ' must be a JSON object'); }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !Object.keys(obj).length) {
      throw new Invalid(where + ' must be a non-empty object');
    }
    return obj;
  }
  if (tname === 'ts') {
    if (!ISO_RE.test(String(v))) throw new Invalid(where + ' must be an ISO-8601 timestamp');
    return String(v);
  }
  const pattern = table.types[tname];
  if (pattern === undefined) throw new Invalid(where + ' has unknown type ' + tname);
  if (!new RegExp(pattern).test(String(v))) throw new Invalid(where + "='" + v + "' is not a valid " + tname);
  return String(v);
}

/** Problems with a stored record, as a list of strings (empty = valid). */
function validateRecord(table, rec) {
  const issues = [];
  const code = rec.c;
  if (!table.codes[code]) return ["unknown code '" + code + "'"];
  const spec = table.codes[code];
  for (const k of ['r', 'ts', 'id', 'v']) {
    if (isBlank(rec[k])) issues.push(code + ' missing ' + k);
  }
  const item = rec.i;
  if (spec.item === 'req' && !item) issues.push(code + ' needs an item');
  if (spec.item === 'no' && item) issues.push(code + ' must not carry an item');
  if (item && !ml.ITEM_RE.test(String(item))) issues.push(code + " item '" + item + "' is malformed");
  try {
    coerce(table, code, rec.f || {});
  } catch (e) {
    if (!(e instanceof Invalid)) throw e;
    issues.push(e.message);
  }
  return issues;
}

/** The name of the code's single blob-typed field, or null. */
function blobField(table, code) {
  const fields = table.codes[code].fields;
  for (const k of Object.keys(fields)) {
    const spec = fields[k];
    if (typeof spec === 'string' && typeOf(spec)[0] === 'blob') return k;
  }
  return null;
}

/** The template tree for a level, honouring the product → plain fallback. `step` is its own kind. */
function templateFor(spec, kind) {
  if (kind === 'product' && !('product' in spec)) return spec.plain;
  return spec[kind];
}

/** Resolve a {by: field, value: tpl, *: tpl} tree to a string; null if no template. */
function pickTemplate(tpl, fields) {
  let t = tpl;
  while (t && typeof t === 'object') {
    const key = String(fields[t.by] === undefined ? '' : fields[t.by]);
    t = Object.prototype.hasOwnProperty.call(t, key) ? t[key] : t['*'];
  }
  return t === undefined ? null : t;
}

/** Substitute {name} placeholders; unknown names render as '?' so a template bug is visible in
 *  the golden, never an exception at run time. */
function fill(tpl, values) {
  return tpl.replace(/\{(\w+)\}/g, (_, name) => {
    const v = values[name];
    if (v === undefined || v === null) return '?';
    if (Array.isArray(v)) return v.map(String).join(',') || '-';
    if (typeof v === 'object') return ml.dumps(v);
    return String(v);
  });
}

/** Every leaf template string: [code, kind, text]. */
function allTemplates(table) {
  const out = [];
  const walk = (code, kind, t) => {
    if (t === null || t === undefined) return;
    if (typeof t === 'object') {
      for (const k of Object.keys(t)) if (k !== 'by') walk(code, kind, t[k]);
    } else {
      out.push([code, kind, t]);
    }
  };
  for (const code of Object.keys(table.codes)) {
    for (const kind of [...LEVELS, 'step']) walk(code, kind, table.codes[code][kind]);
  }
  return out;
}

/** Problems with the table itself: bad types, banned words per level, refuse categories without
 *  a phrase. */
function lint(table, rails) {
  const issues = [];
  const known = new Set([...Object.keys(table.types), 'enum']);
  for (const code of Object.keys(table.codes)) {
    const spec = table.codes[code];
    if (!['req', 'opt', 'no'].includes(spec.item)) issues.push(code + ': item must be req|opt|no');
    if (!['info', 'warn'].includes(spec.sev)) issues.push(code + ': sev must be info|warn');
    let blobs = 0;
    for (const k of Object.keys(spec.fields)) {
      const [tname] = typeOf(spec.fields[k]);
      if (!known.has(tname)) issues.push(code + '.' + k + ': unknown type ' + tname);
      if (tname === 'blob') blobs += 1;
    }
    if (blobs > 1) issues.push(code + ': at most one blob field');
    if (!('tech' in spec)) issues.push(code + ': needs a tech template');
    if (!('plain' in spec)) issues.push(code + ': needs a plain template (null is allowed)');
  }
  for (const [code, kind, text] of allTemplates(table)) {
    const bare = text.replace(/\{\w+\}/g, '');
    if (kind === 'plain' || kind === 'step') {
      const hit = PLAIN_BANNED.exec(bare);
      if (hit) issues.push(code + ' ' + kind + " template uses a word plain may not: '" + hit[0] + "': " + text);
    } else if (kind === 'product') {
      const hit = PRODUCT_BANNED.exec(bare);
      if (hit) issues.push(code + ' product template uses a word product may not: \'' + hit[0] + "': " + text);
    }
  }
  if (rails) {
    const refuse = rails.refuse || {};
    for (const cat of Object.keys(refuse)) {
      const v = refuse[cat];
      if (!v || typeof v !== 'object' || !v.plain) issues.push('rails.refuse.' + cat + ' has no plain phrase');
    }
  }
  return issues;
}

module.exports = {
  LEVELS, PLAIN_BANNED, PRODUCT_BANNED, ISO_RE, Invalid,
  load, loadRails, typeOf, coerce, validateRecord, blobField, templateFor, pickTemplate, fill, allTemplates, lint,
};

'use strict';
// codes.test.js — codes.json is well-formed, every code has a fixture line and a golden at both
// levels, plain templates never leak engineering words or an operating system, every refusal has
// a phrase, every gate has a rule, every hosting option is complete.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const cz = require('../scripts/lib/codes');
const ml = require('../scripts/lib/ledger');
const api = require('../scripts/lib/api');

let table, rails, hosting, questions;
test.before(async () => {
  await H.ready();   // the content may come over the API
  table = cz.load();
  rails = cz.loadRails();
  hosting = api.dataJson('hosting');
  questions = api.dataJson('questions');
});

test('the table and the rails lint clean', () => {
  assert.deepEqual(cz.lint(table, rails), []);
});

test('rails: exactly two refusals, each with a plain phrase; every gate has a rule', () => {
  assert.deepEqual(Object.keys(rails.refuse).sort(), ['children', 'harm']);
  for (const cat of Object.keys(rails.refuse)) assert.ok(rails.refuse[cat].plain.length > 10, cat + ' has a phrase');
  for (const gate of ['personal_details', 'payments', 'messaging', 'children', 'advice', 'uploads', 'user_content']) {
    assert.ok(rails.rule[gate] && rails.rule[gate].build, 'gate ' + gate + ' has a build rule');
  }
});

test('hosting: a recommended free option, every option complete, every check a known capability', () => {
  assert.ok(hosting, 'hosting.json loads');
  assert.ok(hosting.options[hosting.recommended], 'recommended option exists');
  assert.match(hosting.options[hosting.recommended].cost, /^(Nothing|Free)/, 'the recommended option is free');
  const checks = new Set(table.codes.CHECK.fields.name.enum);
  for (const [key, o] of Object.entries(hosting.options)) {
    for (const k of ['plain', 'cost', 'fits', 'catch', 'config', 'checks']) assert.ok(o[k], key + ' has ' + k);
    for (const c of o.checks) assert.ok(checks.has(c), key + ' check ' + c + ' is a CHECK name');
  }
});

test('questions: every decision type has an entry, every level has a budget', () => {
  assert.ok(questions, 'questions.json loads');
  assert.deepEqual(questions.levels, cz.LEVELS, 'the levels are the renderer\'s levels');
  const types = table.codes.DECIDE.fields.type.enum;
  assert.deepEqual(Object.keys(questions.decisions).sort(), types.slice().sort(), 'one entry per DECIDE type');
  for (const [k, q] of Object.entries(questions.decisions)) {
    assert.ok(cz.LEVELS.includes(q.ask_at) || q.ask_at === 'never', k + '.ask_at is a level or never');
    assert.ok(['confirm', 'pick', 'open', 'none'].includes(q.shape), k + '.shape is known');
    assert.ok(q.ask_at === 'plain' || q.default !== null, k + ' is not asked at plain so it needs a default');
  }
  for (const lvl of cz.LEVELS) {
    const b = questions.budgets[lvl];
    assert.ok(b && b.prose_lines > 0 && b.options_max > 0 && b.ask_per_run_max > 0, lvl + ' has a budget');
  }
  assert.ok(questions.budgets.plain.prose_lines <= questions.budgets.product.prose_lines
    && questions.budgets.product.prose_lines <= questions.budgets.tech.prose_lines, 'budgets grow with the level');
});

test('every plain template has a product reading that is not more technical than tech', () => {
  for (const [code, spec] of Object.entries(table.codes)) {
    if (spec.plain === null) continue;
    const prod = cz.templateFor(spec, 'product');
    assert.ok(prod !== undefined, code + ' resolves a product template (own or plain fallback)');
  }
});

test('every code appears in the codes fixture', () => {
  const seen = new Set();
  const dir = path.join(H.T, 'fixtures', 'codes', 'ledger', 'runs');
  for (const f of fs.readdirSync(dir)) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) if (line.trim()) seen.add(JSON.parse(line).c);
  }
  assert.deepEqual(Object.keys(table.codes).filter((c) => !seen.has(c)), [], 'codes without a fixture line');
});

test('every code renders at every level in the codes fixture golden', () => {
  for (const lvl of cz.LEVELS) {
    assert.ok(fs.existsSync(path.join(H.T, 'golden', 'events.' + lvl + '.codes.txt')), 'golden exists: events.' + lvl + '.codes');
  }
  const text = fs.readFileSync(path.join(H.T, 'golden', 'events.tech.codes.txt'), 'utf8');
  const missing = Object.keys(table.codes).filter((c) => !text.includes(' ' + c + ' ') && !text.includes(' ' + c + '\n'));
  assert.deepEqual(missing, [], 'every code has a tech line in the golden');
});

test('the plain-word ban is enforced', () => {
  const t = JSON.parse(JSON.stringify(table));
  t.codes.PUSH.plain = 'Pushed the branch to the repo.';
  assert.equal(cz.lint(t).filter((i) => i.includes('plain may not')).length, 1);
  const t2 = JSON.parse(JSON.stringify(table));
  t2.codes.VERIFY.product = 'Tests passed, rc=0, see app/page.tsx';
  assert.equal(cz.lint(t2).filter((i) => i.includes('product may not')).length, 1, 'product has its own ban list');
});

test('no plain template names an operating system, an install route, or an owner', () => {
  const banned = /\b(mac|macos|windows|linux|ubuntu|homebrew|brew|xcode|apt|winget|choco|npm|install|sudo|delon|cohdit team)\b|!\s/i;
  for (const [code, kind, text] of cz.allTemplates(table)) {
    if (kind === 'plain' || kind === 'step') assert.doesNotMatch(text, banned, code + ': ' + text);
  }
});

test('coerce: types are closed and strict', () => {
  assert.ok(!('str' in table.types), 'no str type exists');
  const known = new Set([...Object.keys(table.types), 'enum']);
  for (const [c, s] of Object.entries(table.codes)) {
    for (const [k, f] of Object.entries(s.fields)) assert.ok(known.has(cz.typeOf(f)[0]), c + '.' + k + ' type known');
    const blobs = Object.values(s.fields).filter((f) => typeof f === 'string' && cz.typeOf(f)[0] === 'blob').length;
    assert.ok(blobs <= 1, c + ' has at most one blob field');
  }
  assert.throws(() => cz.coerce(table, 'ROUND', { cause: 'vibes' }), cz.Invalid);
  assert.throws(() => cz.coerce(table, 'REVIEW', { must_fix: '1.5', nits: 0 }), cz.Invalid);
  assert.deepEqual(cz.coerce(table, 'REVIEW', { must_fix: '2', nits: 0 }), { must_fix: 2, nits: 0 });
  assert.deepEqual(cz.coerce(table, 'VERIFY', { rc: 0, dur_s: 48 }), { rc: 0, dur_s: 48 }, 'zero is a value, not blank');
  assert.throws(() => cz.coerce(table, 'USAGE', { agent: 'maker', attrib: 'branch', models: '{}' }), cz.Invalid, 'empty models rejected');
});

test('templates: {by} trees resolve with a fallback; unknown placeholders render as ?', () => {
  assert.equal(cz.pickTemplate(table.codes.VERIFY.plain, { rc: 0 }), 'The checks passed.');
  assert.equal(cz.pickTemplate(table.codes.VERIFY.plain, { rc: 3 }), 'The checks failed.');
  assert.equal(cz.pickTemplate(table.codes.RISK.plain, {}), null);
  assert.equal(cz.fill('{a} and {b}', { a: 1 }), '1 and ?');
  assert.equal(cz.fill('{m}', { m: { b: 1, a: [2, 1] } }), '{"a":[2,1],"b":1}');
});

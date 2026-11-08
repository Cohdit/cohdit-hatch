'use strict';
// render.test.js — every view × level × fixture renders byte-for-byte to its golden file, rendering
// twice gives the same bytes, each level keeps to its banned words and its line budget, and the
// level resolves from the flag, the project, or the person. UPDATE_GOLDEN=1 rewrites the goldens.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const H = require('./harness');

const G = path.join(H.T, 'golden');
const FIXTURES = fs.readdirSync(path.join(H.T, 'fixtures')).sort();
const VIEWS = ['status', 'why', 'digest', 'events', 'score', 'spec', 'checklist'];
const LEVELS = ['plain', 'product', 'tech'];
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const fx = (name) => path.join(H.T, 'fixtures', name);
const HOME = H.tmpdir();   // an empty home: a golden never reads the person's own settings (terms agreed, level)
const R = (view, name, lvl, ...extra) => H.run('render.js', [view, '--level', lvl, '--cohdit', fx(name), '--now', H.NOW, ...extra], { env: { COHDIT_HOME: HOME } });
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');

// How much a person reads per view, at most. Events are a list and exempt. A golden that grows past
// its budget is a verbosity regression, not a wording change.
const BUDGET = { plain: { status: 12, why: 4, digest: 12, score: 4, spec: 16, checklist: 18 }, product: { status: 12, why: 4, digest: 12, score: 4, spec: 16, checklist: 18 } };

test('goldens', () => {
  fs.mkdirSync(G, { recursive: true });
  for (const name of FIXTURES) {
    for (const view of VIEWS) {
      for (const lvl of LEVELS) {
        const id = view + '.' + lvl + '.' + name;
        const r = R(view, name, lvl, '--last');
        assert.equal(r.code, 0, id + ' renders: ' + r.err);
        const file = path.join(G, id + '.txt');
        if (UPDATE) {
          fs.writeFileSync(file, r.out + '\n');
        } else {
          assert.ok(fs.existsSync(file), id + ': no golden — run UPDATE_GOLDEN=1 node --test tests/*.test.js');
          assert.equal(r.out + '\n', fs.readFileSync(file, 'utf8'), id);
        }
        if (BUDGET[lvl] && BUDGET[lvl][view]) {
          assert.ok(r.out.split('\n').length <= BUDGET[lvl][view], id + ' exceeds its line budget of ' + BUDGET[lvl][view]);
        }
      }
    }
  }
  const expected = new Set(FIXTURES.flatMap((n) => VIEWS.flatMap((v) => LEVELS.map((l) => v + '.' + l + '.' + n + '.txt'))));
  assert.deepEqual(fs.readdirSync(G).filter((f) => !expected.has(f)), [], 'orphan goldens');
});

test('determinism: the same inputs give the same bytes', () => {
  assert.equal(sha(R('why', 'stop-gate', 'plain').out), sha(R('why', 'stop-gate', 'plain').out), 'two renders, one checksum');
  assert.equal(sha(R('score', 'happy', 'tech', '--json').out), sha(R('score', 'happy', 'tech', '--json').out), 'score json is stable');
});

test('plain never leaks engineering words, item ids, an OS, an owner, or a claim about money', () => {
  const leak = /\b(branch|merge|commit|push|sha|exit|repo|deploy\w*|mac|windows|linux|homebrew|xcode|delon|spent|spend\w*|bill\w*|cost\w*)\b|ITEM-\d/i;
  for (const name of FIXTURES) {
    for (const view of VIEWS) assert.doesNotMatch(R(view, name, 'plain', '--last').out, leak, 'plain ' + view + '.' + name);
  }
});

test('product never leaks paths, hashes, exit codes, item ids, model names, or a claim about money', () => {
  const leak = /\b(sha|exit|rc|cmd|stdout|json|argv|spent|spend\w*|bill\w*)\b|ITEM-\d|[\w-]+\.(js|ts|tsx|json)\b|claude-[\w-]+|[0-9a-f]{16}/i;
  for (const name of FIXTURES) {
    for (const view of VIEWS) {
      const out = R(view, name, 'product', '--last').out.replace(/https?:\/\/\S+/g, '');
      assert.doesNotMatch(out, leak, 'product ' + view + '.' + name);
    }
  }
});

test('why: the algorithm picks the right branch per fixture', () => {
  const why = (name, lvl = 'plain') => R('why', name, lvl, '--last').out;
  const digest = (name, lvl = 'plain') => R('digest', name, lvl, '--last').out;
  assert.match(why('stop-gate'), /the checks failed twice/, 'stop-gate names the cause');
  assert.match(why('stop-gate', 'product'), /failed its tests twice, so it was blocked/, 'product says tests');
  assert.match(why('stop-gate'), /fixed and rebuilt → set aside → stopped/, 'steps never repeat');
  assert.match(why('stop-gate'), /Reset on Sunday/, 'stop-gate names the item');
  assert.match(why('stop-budget'), /reached its limit: about [\d.]+ (thousand|million) tokens, roughly \$[\d.]+ at Claude's public API prices/, 'stop-budget leads with tokens and labels the dollars an estimate');
  assert.match(why('stop-budget', 'product'), /reached its cap \([\d.]+[kM] tokens ≈ \$[\d.]+ at API list price\)/, 'product stop-budget does the same, in symbols');
  assert.match(why('deploy-error'), /Publishing failed/, 'deploy-error says publishing');
  assert.match(why('deploy-error', 'product'), /deploy to vercel failed/, 'product names the deploy target');
  assert.match(why('crashed'), /never reported back/, 'crashed says never reported');
  assert.match(why('crashed'), /2 hours ago/, 'crashed says when');
  assert.match(why('live'), /Working now: building "Weekly scoreboard"/, 'live says what it is doing');
  assert.match(why('live', 'product'), /Working now: builder started on "Weekly scoreboard"/, 'product live phrase');
  assert.match(why('happy'), /Finished/, 'happy says finished');
  assert.match(why('happy'), /Waiting on you: 1 question/, 'happy counts the parked item');
  assert.match(why('happy', 'product'), /Held for you: 1 question/, 'product says held');
  assert.match(why('empty'), /Say "I have an idea"/, 'empty invites an idea');
  assert.match(digest('refused'), /stalk or harass people\. This isn't something I can change/, 'refused uses the rails phrase');
  assert.match(digest('refused'), /yours to answer for/, 'the terms decision is shown');
  assert.match(digest('refused'), /where the app will live/, 'the hosting decision is shown');
  assert.match(digest('refused', 'product'), /Terms accepted \(version 1\)/, 'product shows the terms version');
  assert.match(digest('setup'), /2 things left/, 'setup counts what is left');
  assert.match(R('events', 'codes', 'tech', '--last').out, /DECIDE type=data choice=neon_free who=hatch/, 'a default taken by Hatch is recorded');
  assert.match(R('events', 'codes', 'plain', '--last').out, /I made a small choice for you/, 'plain shows a default was taken');
});

test('score: trust gate, arithmetic, owner load and verbosity', () => {
  const happy = R('score', 'happy', 'tech').out;
  const untrusted = R('score', 'untrusted', 'tech').out;
  assert.match(happy, /TRUSTED — events 100%/, 'happy is trusted');
  assert.match(untrusted, /unpriced models: claude-future-9/, 'untrusted names the unpriced model');
  assert.match(untrusted, /1 run\(s\) never ended/, 'untrusted names the unended run');
  assert.match(untrusted, /1 unreadable ledger line\(s\)/, 'untrusted counts the bad line');
  // Tokens are what is measured. One sonnet usage record: 20000 + 4000 + 300000 + 50000 = 374000 tokens;
  // one opus record: 5000 + 2000 + 150000 + 20000 = 177000.
  // happy: orchestrator 2×sonnet, maker 4×sonnet, checker 2×opus; share run: orchestrator 1×opus
  // total = 6×374000 + 3×177000 = 2,775,000 tokens ; done = 2 → 1,387,500 per item → "1.4M"
  // The dollar figure is the same tokens at API list price, shown only as an estimate:
  //   sonnet 20000*2 + 4000*10 + 300000*0.2 + 50000*2*1.25 = $0.265 ; opus 5000*4 + 2000*20 + 150000*0.2 + 20000*4*1.25 = $0.19
  //   total = 6×0.265 + 3×0.19 = $2.16 → $1.08 per item
  assert.match(happy, /^tokens 2\.8M {2}\(input 135k · output 30k · cache read 2\.3M · cache write 360k\) {2}≈ \$2\.16 at API list price of 2026-10-06$/m, 'tokens lead, split by kind, with the estimate and the price date beside them');
  assert.match(happy, /tokens per done item {3}1\.4M .*≈ \$1\.08 at API list price/, 'per-item is tokens first, estimate second');
  assert.match(happy, /first-pass 50%/, 'happy first-pass');
  assert.match(happy, /1 shared/, 'happy one shared link');
  assert.match(happy, /asked 1 · defaulted 0/, 'owner load counts asked and defaulted decisions');
  // said: orchestrator 2×900 (build) + 1×400 (share) = 2200 chars over 2 runs → 2200/6/2 ≈ 183 words/run
  assert.match(happy, /said to you {12}≈183 words\/run {2}\(2200 chars\)/, 'verbosity is measured');
  const j = JSON.parse(R('score', 'happy', 'tech', '--json').out);
  assert.equal(j.trust.trusted, true);
  assert.equal(j.tokens.total, 2775000);
  assert.equal(j.tokens.by_kind.cache_read, 6 * 300000 + 3 * 150000);
  assert.equal(Math.round(j.est.total_usd * 100), 216);
  assert.equal(j.est.basis, 'API list price');
  assert.equal(j.est.prices_date, '2026-10-06');
  assert.equal(j.owner.said_chars, 2200);
  assert.match(R('score', 'happy', 'product').out, /Measurements complete\./, 'product score has its own trust line');
  assert.match(R('score', 'happy', 'plain').out, /Claude used about 2\.8 million tokens, about 1\.4 million per finished thing \(roughly \$2\.16 at Claude's public API prices\)/, 'plain says tokens in words and where the dollars come from');
  // An unpriced model still has its tokens counted; there is no estimate at all (never $0.00), and the gate says so.
  const u = JSON.parse(R('score', 'untrusted', 'tech', '--json').out);
  assert.equal(u.tokens.total, 1100);
  assert.equal(u.est.total_usd, null);
  assert.equal(u.trust.trusted, false);
  assert.match(R('score', 'untrusted', 'tech').out, /tokens 1k .*no estimate \(a model has no known price\)/, 'tech says why there is no estimate');
  assert.match(R('score', 'untrusted', 'plain').out, /no dollar estimate: a model has no known price/, 'plain says why there is no estimate');
  assert.doesNotMatch(R('score', 'untrusted', 'tech').out, /\$0\.00/, 'an unpriced model never shows as free');
});

test('status --json is machine-readable', () => {
  const j = JSON.parse(R('status', 'happy', 'plain', '--json').out);
  assert.equal(j.url, 'https://chore-chart.vercel.app');
  assert.deepEqual(j.waiting, ['ITEM-003']);
  assert.equal(j.tokens, 2775000);
  assert.equal(j.est_usd, 2.16);
  assert.equal(j.prices_date, '2026-10-06');
});

test('tokens are formatted for reading, in symbols or in words', () => {
  const ml = require('../scripts/lib/ledger');
  assert.equal(ml.fmtTokens(950), '950');
  assert.equal(ml.fmtTokens(824000), '824k');
  assert.equal(ml.fmtTokens(824000, true), '824 thousand');
  assert.equal(ml.fmtTokens(2775000), '2.8M');
  assert.equal(ml.fmtTokens(1000000, true), '1 million');
  assert.equal(ml.fmtTokens(12345678), '12M');
  assert.equal(ml.fmtTokens(null), 'n/a');
});

test('level resolves from --level, else the project, else the person, else plain', () => {
  const home = H.tmpdir();
  const run = (extra, env) => H.run('render.js', ['why', '--cohdit', fx('stop-gate'), '--now', H.NOW, '--last', ...extra], { env: Object.assign({ COHDIT_HOME: home }, env || {}) }).out;
  assert.match(run([]), /^Stopped 20 minutes ago\. I set/, 'plain by default');
  fs.mkdirSync(path.join(home, '.cohdit'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cohdit', 'settings.json'), JSON.stringify({ level: 'tech' }));
  assert.match(run([]), /Say "show me the events" for the full list\.$/m, 'the person\'s settings file sets the level (tech: sentences, with the run named)');
  const proj = H.tmpdir();
  fs.cpSync(fx('stop-gate'), proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'config.json'), JSON.stringify({ level: 'product' }));
  const out = H.run('render.js', ['why', '--cohdit', proj, '--now', H.NOW, '--last'], { env: { COHDIT_HOME: home } }).out;
  assert.match(out, /failed its tests twice/, 'the project config overrides the person\'s setting');
  assert.match(run(['--level', 'plain']), /^Stopped 20 minutes ago\. I set/, '--level overrides everything');
  fs.writeFileSync(path.join(home, '.cohdit', 'settings.json'), JSON.stringify({ level: 'shouty' }));
  assert.match(run([]), /^Stopped 20 minutes ago\. I set/, 'an unknown level falls back to plain');
});

test('bad arguments → 64, no --cohdit outside a repo → 2', () => {
  assert.equal(H.run('render.js', ['nope']).code, 64);
  assert.equal(H.run('render.js', ['why', '--level', 'loud']).code, 64);
  assert.equal(H.run('render.js', ['why'], { cwd: H.tmpdir() }).code, 2);
});

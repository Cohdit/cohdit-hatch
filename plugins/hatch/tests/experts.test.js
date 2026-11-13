'use strict';
// experts.test.js — knowledge agents beside the software leader: the `expert` content kind and the JSON calls
// (lib/api.js), the `experts` commands against a stub server, and the brief and roles carrying the agents an
// idea uses. The agents and their knowledge here are made up; real packs are private.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const H = require('./harness');
const api = require('../scripts/lib/api');
const ld = require('../scripts/lib/leader');
const bd = require('../scripts/lib/build');
const ml = require('../scripts/lib/ledger');

const HATCH = path.join(__dirname, '..', 'scripts', 'hatch.js');
const KEY = ['hk', 'sub_test1.'].join('_') + 'a'.repeat(32);

const PACK = (name, knowledge, calls) => ({ v: 1, name, sha: 'x', values: [], calls: calls || [], limits: [], knowledge, reads: {}, kind: 'domain', field: 'f' });
const BAKERY = PACK('Bakery operations', [
  { id: 'A-001', domain: 'orders', rule: 'Take a deposit on every custom cake order.' },
  { id: 'A-002', domain: 'stock', rule: 'Count flour weekly.' },
  { id: 'A-003', domain: 'orders', rule: 'Confirm the pickup time for each cake order by message.' },
], ['Fresh vs cheap: fresh, unless it is bread for staff.']);

let server, port, state, hits;
test.before(async () => {
  await H.ready();
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      const r = state.route(req.method, req.url.replace('/api/hatch/v1', ''), body ? JSON.parse(body) : null);
      res.writeHead(r.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.json));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
});
test.after(() => server.close());

const ME = () => ({
  experts: [{ slug: 'software-leader', name: 'Software leader', field: 'building software' }],
  available: [
    { slug: 'bakery-ops', name: 'Bakery operations', field: 'running a bakery', pitch: 'Knows orders, deposits and stock.', price: '$9 a month', free_left: 5 },
    { slug: 'payroll', name: 'Payroll', field: 'payroll', pitch: '', price: null, free_left: 0 },
  ],
});
function standard() {
  return {
    me: ME(),
    left: 4,
    buy: { status: 200, json: { url: 'https://example.test/buy?t=abc' } },
    route(method, url, body) {
      if (url.startsWith('/me')) return { json: this.me };
      if (url === '/buy-link') return this.buy;
      if (url === '/manage') return { json: { url: 'https://example.test/billing' } };
      if (url.startsWith('/ask/')) return this.ask ? this.ask(body) : { json: { answer: 'Take a deposit. ' + body.question, left: this.left } };
      return { status: 404, json: { error: 'not_found' } };
    },
  };
}

const ENV = ['HOME', 'USERPROFILE', 'HATCH_API', 'HATCH_KEY', 'HATCH_DEV_DIR', 'COHDIT_HOME'];
let saved;
test.beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hatch-experts-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.COHDIT_HOME = home;
  process.env.HATCH_API = 'http://127.0.0.1:' + port + '/api/hatch/v1';
  process.env.HATCH_KEY = KEY;
  delete process.env.HATCH_DEV_DIR;
  state = standard();
  hits = [];
});
test.afterEach(() => {
  for (const k of ENV) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
});

/** hatch.js in a child, async so the stub server in this process can answer it. */
function hatch(args, input, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [HATCH, ...args], { env: Object.assign({}, process.env, env || {}) });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out: out.replace(/\n$/, ''), err }));
    p.stdin.end(input || '');
  });
}

/** A project folder with an agreed idea. */
function idea(extra) {
  const dir = H.tmpdir();
  fs.mkdirSync(path.join(dir, '.cohdit'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.cohdit', 'spec.json'), JSON.stringify(Object.assign({ v: 1, name: 'Cakes', slug: 'cakes', items: [], agreed: true }, extra || {})));
  return dir;
}
const specOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.cohdit', 'spec.json'), 'utf8'));

async function code(p) {
  try { await p; } catch (e) { return e.code; }
  return 'resolved';
}

// --- lib/api.js -----------------------------------------------------------------------------------

test('a pack is fetched by slug, cached, and must be JSON; odd names never reach the server', async () => {
  state.route = (m, url) => (url === '/expert/bakery-ops' ? { json: BAKERY } : { status: 404, json: { error: 'not_found' } });
  assert.deepEqual(JSON.parse(await api.fetchContent('expert', 'bakery-ops')), BAKERY);
  assert.ok(fs.existsSync(api.cacheFile('expert', 'bakery-ops')));
  for (const bad of ['../data/leader', 'Bakery', 'a'.repeat(30), '']) assert.equal(await code(api.fetchContent('expert', bad)), 'not_found', bad);
  assert.equal(hits.length, 1);
});

test('not_owned drops only that pack; the rest of the cache stays', async () => {
  const seed = (kind, name, text) => { const f = api.cacheFile(kind, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); const t = (Date.now() - 11 * 60000) / 1000; fs.utimesSync(f, t, t); };
  seed('expert', 'bakery-ops', JSON.stringify(BAKERY));
  seed('skill', 'dream', '# dream');
  state.route = () => ({ status: 403, json: { error: 'not_owned' } });
  assert.equal(await code(api.fetchContent('expert', 'bakery-ops')), 'not_owned');
  assert.equal(fs.existsSync(api.cacheFile('expert', 'bakery-ops')), false);
  assert.ok(fs.existsSync(api.cacheFile('skill', 'dream')));
  assert.equal(api.message('not_owned'), 'You don\'t have that agent. Say "what agents are there" to see it.');
});

test('the JSON calls send the key, POST their body, and map each refusal to its code', async () => {
  assert.deepEqual(await api.me({ fresh: true }), ME());
  assert.equal(hits[0].url, '/api/hatch/v1/me?fresh=1');
  await api.buyLink('bakery-ops');
  assert.deepEqual([hits[1].method, hits[1].body], ['POST', { slug: 'bakery-ops' }]);
  for (const [status, error, want] of [[402, 'no_free_left', 'no_free_left'], [409, 'owned', 'owned'], [429, 'daily_limit', 'daily_limit'], [502, 'ask_failed', 'ask_failed'],
    [403, 'not_owned', 'not_owned'], [403, 'revoked', 'revoked'], [401, 'bad_key', 'bad_key'], [503, 'unavailable', 'unavailable']]) {
    state.ask = () => ({ status, json: { error } });
    assert.equal(await code(api.askFree('bakery-ops', 'q')), want, String(status));
  }
  process.env.HATCH_API = 'http://127.0.0.1:1/api/hatch/v1';
  assert.equal(await code(api.me()), 'unavailable');
  delete process.env.HATCH_KEY;
  assert.equal(await code(api.me()), 'missing');
});

// --- hatch.js experts -----------------------------------------------------------------------------

test('experts lists what the person has and could add; --json carries the idea too', async () => {
  const r = await hatch(['experts']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, ['Your agents: Software leader (always on).', 'You could add:',
    '- Bakery operations: Knows orders, deposits and stock. ($9 a month; 5 free questions left)', '- Payroll'].join('\n'));
  const dir = idea({ experts: [], offered: ['payroll'] });
  const j = await hatch(['experts', '--json', '--dir', dir]);
  assert.deepEqual(JSON.parse(j.out).idea, { use: [], offered: ['payroll'] });
  state.route = () => ({ status: 403, json: { error: 'inactive' } });
  const bad = await hatch(['experts']);
  assert.equal(bad.code, 1);
  assert.equal(bad.out, api.message('inactive'));
});

test('an offer is made once per idea, recorded before the link, and names the price and free questions', async () => {
  const dir = idea();
  const r = await hatch(['experts', 'offer', 'bakery-ops', '--dir', dir]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'There\'s an agent for this: Bakery operations. Knows orders, deposits and stock. $9 a month, cancel any time. You can ask it 5 free questions first, or add it here: https://example.test/buy?t=abc');
  assert.match(r.err, /url=https:\/\/example\.test\/buy/);
  assert.deepEqual(specOf(dir).offered, ['bakery-ops']);
  const again = await hatch(['experts', 'offer', 'bakery-ops', '--dir', dir]);
  assert.deepEqual([again.code, again.out], [3, '']);
  assert.match(again.err, /hint=offered/);
  assert.match((await hatch(['experts', 'offer', 'software-leader', '--dir', dir])).err, /hint=owned/);
  assert.match((await hatch(['experts', 'offer', 'nobody', '--dir', dir])).err, /hint=not_available/);

  const dir2 = idea();
  state.buy = { status: 503, json: { error: 'unavailable' } };
  const nolink = await hatch(['experts', 'offer', 'bakery-ops', '--dir', dir2]);
  assert.equal(nolink.out, 'There\'s an agent for this: Bakery operations. Knows orders, deposits and stock. $9 a month, cancel any time. Say "add Bakery operations" later and I\'ll get you the link.');
  assert.deepEqual(specOf(dir2).offered, ['bakery-ops'], 'a failed link still counts as the one offer');
});

test('a free question prints the answer and what is left; the last one carries the link; owned agents are refused', async () => {
  const q = await hatch(['experts', 'ask', 'bakery-ops', '--return', '-'], 'Do I need a deposit?\n');
  assert.equal(q.code, 0, q.err);
  assert.equal(q.out, 'Take a deposit. Do I need a deposit?\n4 free questions left for Bakery operations.');
  state.left = 0;
  const last = await hatch(['experts', 'ask', 'bakery-ops', '--return', '-'], 'And stock?');
  assert.equal(last.out.split('\n').pop(), 'That was your last free question for Bakery operations. Add it here: https://example.test/buy?t=abc');
  state.ask = () => ({ status: 402, json: { error: 'no_free_left' } });
  const none = await hatch(['experts', 'ask', 'bakery-ops', '--return', '-'], 'More?');
  assert.deepEqual([none.code, none.out], [1, 'That was your last free question for this agent.']);
  const own = await hatch(['experts', 'ask', 'software-leader', '--return', '-'], 'q');
  assert.equal(own.code, 3);
  assert.match(own.err, /hint=owned/);
});

test('check: an offered agent now owned joins the idea, once; nothing to say otherwise', async () => {
  const dir = idea({ offered: ['bakery-ops'] });
  assert.deepEqual(await hatch(['experts', 'check', '--dir', dir]).then((r) => [r.code, r.out]), [0, '']);
  state.me = { experts: ME().experts.concat({ slug: 'bakery-ops', name: 'Bakery operations', field: 'f' }), available: [] };
  const r = await hatch(['experts', 'check', '--dir', dir]);
  assert.equal(r.out, 'Bakery operations is yours now. I\'ll use it for this idea.');
  assert.deepEqual(specOf(dir).experts, ['bakery-ops']);
  assert.equal((await hatch(['experts', 'check', '--dir', dir])).out, '', 'already in use');
  assert.ok(hits.filter((h) => h.url === '/api/hatch/v1/me?fresh=1').length >= 2, 'check asks for a fresh answer');
});

test('use and stop edit the idea, need the agent owned, and never change a build under way', async () => {
  const dir = idea();
  state.me = { experts: ME().experts.concat({ slug: 'bakery-ops', name: 'Bakery operations', field: 'f' }), available: [] };
  assert.equal((await hatch(['experts', 'use', 'bakery-ops', '--dir', dir])).code, 0);
  assert.deepEqual(specOf(dir).experts, ['bakery-ops']);
  assert.match((await hatch(['experts', 'use', 'payroll', '--dir', dir])).err, /hint=not_owned/);
  assert.match((await hatch(['experts', 'use', 'software-leader', '--dir', dir])).err, /hint=always_on/);
  H.git(['init', '-q', '-b', 'main'], dir);
  bd.saveActive(dir, { run: 'r1', started: ml.utcNow(), skill: 'build', open: {}, picked: [] });
  const busy = await hatch(['experts', 'stop', 'bakery-ops', '--dir', dir]);
  assert.equal(busy.code, 3);
  assert.match(busy.err, /hint=building/);
  ml.clearActiveRun(dir);
  assert.equal((await hatch(['experts', 'stop', 'bakery-ops', '--dir', dir])).code, 0);
  assert.deepEqual(specOf(dir).experts, []);
});

test('manage prints the billing page', async () => {
  assert.equal((await hatch(['experts', 'manage'])).out, 'Your billing page (cancel or change a card): https://example.test/billing');
});

// --- the brief, the roles and leader --expert ------------------------------------------------------

function withPacks(packs, fn) {
  const d = H.tmpdir();
  for (const [slug, p] of Object.entries(packs)) fs.writeFileSync(path.join(d, slug + '.json'), JSON.stringify(p));
  const prev = process.env.COHDIT_EXPERTS;
  process.env.COHDIT_EXPERTS = d;
  if (saved.HATCH_DEV_DIR !== undefined) process.env.HATCH_DEV_DIR = saved.HATCH_DEV_DIR;   // the brief reads the real data
  try { return fn(d); } finally { if (prev === undefined) delete process.env.COHDIT_EXPERTS; else process.env.COHDIT_EXPERTS = prev; }
}

test('matched: best rules first, one budget across every pack, deterministic', () => {
  const other = PACK('Cafe', [{ id: 'A-001', domain: 'orders', rule: 'Print each cake order ticket.' }, { id: 'A-002', domain: 'music', rule: 'Keep it quiet.' }]);
  const g = ld.matched([BAKERY, other], 'a custom cake order with a deposit', 12);
  assert.deepEqual(g.map((x) => [x.pack.name, x.rules.map((r) => r.id)]), [['Bakery operations', ['A-001', 'A-003']], ['Cafe', ['A-001']]]);
  const two = ld.matched([BAKERY, other], 'a custom cake order with a deposit', 2);
  assert.deepEqual(two.map((x) => x.rules.length), [2], 'the budget is shared: the best two, both from the bakery');
  assert.deepEqual(ld.matched([BAKERY], 'nothing alike here', 12), []);
});

test('the brief carries the idea\'s agents only when it uses them; the checker and advisor get their part', () => {
  const dir = H.mkrepo();
  fs.mkdirSync(ml.spoolDir(dir), { recursive: true });
  const item = { id: 'ITEM-001', title: 'Order a custom cake', criteria: ['pay a deposit for the cake order'], source: 'said', status: 'queued' };
  const spec = { v: 1, name: 'Cakes', slug: 'cakes', rails: [], items: [item], agreed: true };
  const st = new Map([['ITEM-001', 'queued']]);
  withPacks({ 'bakery-ops': BAKERY }, () => {
    const plain = bd.brief(dir, spec, 'ITEM-001', { verify: 'npm test' }, null, st);
    assert.doesNotMatch(plain, /knows about this business/, 'no agents used: the brief is as before');
    const used = Object.assign({}, spec, { experts: ['bakery-ops', 'missing-one'] });
    const brief = bd.brief(dir, used, 'ITEM-001', { verify: 'npm test' }, null, st);
    assert.match(brief, /## What Bakery operations knows about this business\nCalls:\n- Fresh vs cheap/);
    assert.ok(brief.includes('Take a deposit on every custom cake order.') && !brief.includes('Count flour weekly.'));
    fs.mkdirSync(path.join(dir, '.cohdit'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.cohdit', 'spec.json'), JSON.stringify(used));
    const checker = fs.readFileSync(bd.writeRole(dir, 'checker', 'ITEM-001'), 'utf8');
    assert.match(checker, /## Bakery operations's rules for this thing\n\n- Take a deposit/);
    const advisor = fs.readFileSync(bd.writeRole(dir, 'advisor'), 'utf8');
    assert.ok(advisor.includes('## Bakery operations') && advisor.includes('Count flour weekly.'));
  });
});

test('leader --expert prints an owned agent; an unknown one is not owned', () => {
  withPacks({ 'bakery-ops': BAKERY }, (d) => {
    const r = H.run('hatch.js', ['leader', '--expert', 'bakery-ops'], { env: { COHDIT_EXPERTS: d } });
    assert.equal(r.code, 0, r.err);
    assert.ok(r.out.includes('Count flour weekly.'));
    const no = H.run('hatch.js', ['leader', '--expert', 'nobody'], { env: { COHDIT_EXPERTS: d } });
    assert.deepEqual([no.code, no.out], [1, api.message('not_owned')]);
  });
});

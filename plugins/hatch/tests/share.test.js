'use strict';
// share.test.js — hatch.js share: the gate (nothing built, something untried, a build live, changes Hatch did
// not make, not signed in, not on the team), the one question once per project, a no, the yes with one
// production deploy and the wait on it, the link handed back as the production address, a failed build as
// one stop with the log and no second attempt, a deploy still building across two calls, the project named
// after the GitHub copy and reused on later shares, the ledger landed. The publishing tool is answered
// from COHDIT_PROBES; the fake scaffold's dev server stands in for the app when a try is needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const sh = require('../scripts/lib/share');
const hatch = require('../scripts/hatch');

const ITEMS = [
  { title: 'Letter grid', criteria: ['open it; you see all 26 letters, big'] },
  { title: 'Tap to hear', criteria: ['tap a letter; you hear it'] },
  { title: 'On the iPad', criteria: ['open it on the iPad'], device: true, source: 'inferred' },
];
const GATES = { personal_details: false, payments: false, messaging: false, children: { value: true, source: 'said' }, advice: false, uploads: false, user_content: false };
const OK = { code: 0, out: 'ok\n' };
const VC = 'npx -y vercel@latest ';
const DEP_URL = 'https://abc-friends-priya-k.vercel.app';
const DEPLOY_ARGS = (name) => VC + 'deploy --prod --yes --project ' + name + ' --create-if-missing --no-wait --json';
const DEPLOY_OUT = (url, prod) => JSON.stringify({ status: 'ok', deployment: { id: 'dpl_8f3k2', url, productionUrl: prod || null, readyState: 'QUEUED', target: 'production' } });
const INSPECT_ARGS = (url) => VC + 'inspect ' + url + ' --wait --timeout 8m --json';

/** A home whose publishing tool answers as the real one does: signed in, no projects yet, one deploy that
 *  becomes ready. `extra` overrides or adds answers. */
function home(extra = {}) {
  const d = H.mkrepo();
  const probes = {
    'gh --version': OK, 'gh auth status': { code: 1 },
    [VC + '--version']: { code: 0, out: 'Vercel CLI 65.2.0\n' },
    [VC + 'whoami']: { code: 0, out: 'priya-k\n' },
    [VC + 'project ls --json --limit 100 --filter abc-friends']: { code: 0, out: JSON.stringify({ projects: [], pagination: {} }) },
    [DEPLOY_ARGS('abc-friends')]: { code: 0, out: DEPLOY_OUT(DEP_URL) },
    [INSPECT_ARGS(DEP_URL)]: { code: 0, out: JSON.stringify({ id: 'dpl_8f3k2', url: 'abc-friends-priya-k.vercel.app', readyState: 'READY', aliases: ['abc-friends.vercel.app', 'abc-friends-priya-k.vercel.app'] }) },
  };
  Object.assign(probes, extra);
  fs.writeFileSync(path.join(d, 'probes.json'), JSON.stringify(probes));
  return { dir: d, env: { COHDIT_HOME: d, GIT_CONFIG_GLOBAL: path.join(d, 'gitconfig'), COHDIT_PROBES: path.join(d, 'probes.json'), COHDIT_FAKE_SCAFFOLD: '1', COHDIT_PORT_FROM: '3300' }, probes };   // its own port range: try.test.js runs beside it
}

function setProbes(h, extra) {
  Object.assign(h.probes, extra);
  fs.writeFileSync(path.join(h.dir, 'probes.json'), JSON.stringify(h.probes));
}

const run = (h, args, input, env) => H.run('hatch.js', args, { env: Object.assign({}, h.env, env || {}), input, cwd: h.dir });
const hintOf = (r, k) => { const m = new RegExp('^' + k + '=(.*)$', 'm').exec(r.err); return m ? m[1] : null; };
const B = (h, dir, args, input) => run(h, ['build'].concat(args, ['--dir', dir]), input);
const T = (h, dir, args) => run(h, ['try'].concat(args, ['--dir', dir]));
const S = (h, dir, args) => run(h, ['share'].concat(args, ['--dir', dir]));
const R = (h, dir, view, lvl, ...extra) => H.run('render.js', [view, '--level', lvl, '--cohdit', path.join(dir, '.cohdit'), ...extra], { env: h.env }).out;
const DONE = (change = 'copy') => JSON.stringify({ verdict: 'done', change, criteria: [{ n: 1, met: true, ref: 'app/page.tsx:1' }], blocked: null, findings: [] });
const cfgOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.cohdit', 'config.json'), 'utf8'));

/** An agreed idea, every non-device thing built through the gate. */
function builtIdea(h, name = 'ABC Friends', items = ITEMS) {
  const n = run(h, ['idea', 'new', name]);
  const dir = hintOf(n, 'dir');
  assert.equal(run(h, ['idea', 'set', '--dir', dir, '--json', JSON.stringify({ items, gates: GATES })]).code, 0);
  assert.equal(run(h, ['idea', 'agree', '--dir', dir]).code, 0);
  assert.equal(B(h, dir, ['open']).code, 0);
  for (;;) {
    const nx = B(h, dir, ['next']);
    if (hintOf(nx, 'next') !== 'maker') break;
    const item = hintOf(nx, 'item');
    fs.writeFileSync(path.join(dir, 'app', item + '.txt'), item + '\n');
    assert.equal(B(h, dir, ['commit', '-m', item]).code, 0);
    assert.match(B(h, dir, ['built', item, '--return', DONE()]).out, /^Done: /m);
  }
  assert.equal(B(h, dir, ['close']).code, 0);
  return dir;
}

/** The person tries everything built and it works (the device check stays open). */
function triedIdea(h, name, items) {
  const dir = builtIdea(h, name, items);
  const s = T(h, dir, ['start']);
  assert.equal(s.code, 0, s.err);
  const p = T(h, dir, ['pass']);
  assert.equal(p.code, 0, p.err);
  assert.equal(hintOf(p, 'next'), 'share');
  return dir;
}

test('names and answers: the GitHub copy\'s name, a free one when taken, both JSON shapes of a deploy, the states', () => {
  assert.equal(sh.baseName({ connectors: { github: { repo: 'priya-k/abc-friends-2' } } }, { slug: 'abc-friends' }), 'abc-friends-2', 'named after the online copy');
  assert.equal(sh.baseName({ connectors: { vercel: { project: 'kept' } } }, { slug: 'abc-friends' }), 'kept', 'a recorded name wins');
  assert.equal(sh.baseName({}, { slug: 'abc-friends' }), 'abc-friends');
  assert.equal(sh.freeName('abc-friends', new Set(['abc-friends', 'abc-friends-2'])), 'abc-friends-3');
  assert.equal(sh.freeName('abc-friends', new Set()), 'abc-friends');
  const wrapped = sh.parseDeploy(DEPLOY_OUT('https://x-y.vercel.app', 'https://x.vercel.app'));
  assert.deepEqual(wrapped, { ok: true, url: 'https://x-y.vercel.app', dep: 'dpl_8f3k2', prod: 'https://x.vercel.app', state: 'building' });
  const bare = sh.parseDeploy(JSON.stringify({ id: 'dpl_1', url: 'x-y.vercel.app', readyState: 'READY' }));
  assert.equal(bare.url, 'https://x-y.vercel.app', 'a bare answer gets its scheme');
  assert.equal(bare.state, 'ready');
  assert.deepEqual(sh.parseDeploy(JSON.stringify({ status: 'error', reason: 'not_authorized', message: 'Please log in' })), { ok: false, message: 'Please log in' });
  assert.equal(sh.parseDeploy('Error: something\n'), null);
  assert.equal(sh.stateOf('ERROR'), 'error'); assert.equal(sh.stateOf('CANCELED'), 'canceled'); assert.equal(sh.stateOf('BUILDING'), 'building'); assert.equal(sh.stateOf(undefined), 'building');
  const fake = () => ({ code: 0, out: JSON.stringify({ projects: [{ name: 'abc-friends', latestProductionUrl: 'https://abc-friends-x.vercel.app' }] }) });
  assert.equal(sh.productionUrl(fake, 'abc-friends', null, { aliases: ['abc-friends.vercel.app'] }, null), 'https://abc-friends.vercel.app', 'the first alias is the production domain');
  assert.equal(sh.productionUrl(fake, 'abc-friends', null, { aliases: [] }, null), 'https://abc-friends-x.vercel.app', 'else what the tool lists for the project');
  assert.equal(sh.productionUrl(() => ({ code: 1, out: '' }), 'abc-friends', null, { aliases: [] }, null), 'https://abc-friends.vercel.app', 'else the conventional address');
  assert.equal(sh.productionUrl(fake, 'abc-friends', null, {}, 'https://given.vercel.app'), 'https://given.vercel.app', 'the deploy\'s own answer first');
  assert.equal(sh.productionUrl(fake, 'abc-friends', null, {}, 'given.vercel.app'), 'https://given.vercel.app', 'a bare address gets its scheme, whichever source');
  assert.equal(sh.productionUrl(() => ({ code: 0, out: JSON.stringify({ projects: [{ name: 'abc-friends', latestProductionUrl: 'abc-friends-x.vercel.app' }] }) }), 'abc-friends', null, {}, null), 'https://abc-friends-x.vercel.app');
  assert.equal(sh.parseDeploy(DEPLOY_OUT('x-y.vercel.app', 'x.vercel.app')).prod, 'https://x.vercel.app');
  assert.equal(sh.minutesLeft(0), 8); assert.equal(sh.minutesLeft(3 * 60000), 5); assert.equal(sh.minutesLeft(9 * 60000), 1);
  const p = {};
  assert.equal(sh.giveUp(p, { unreadable: false }), null); assert.equal(sh.giveUp(p, { unreadable: true, err: 'no' }), null);
  assert.match(sh.giveUp(p, { unreadable: true, err: 'Error: not found' }), /could not say how the deploy was going:\nError: not found/, 'two unreadable answers in a row');
  const q = { waits: 3 };
  assert.match(sh.giveUp(q, { unreadable: false }), /still building after 4 waits/, 'the fourth wait is the last');
  assert.deepEqual(sh.scoped(['x'], 'team-a'), ['x', '--scope', 'team-a']);
  assert.deepEqual(sh.scoped(['x'], null), ['x']);
});

test('the gate: nothing built, something untried, a build live, changes Hatch did not make', () => {
  const h = home();
  const n = run(h, ['idea', 'new', 'ABC Friends']);
  const dir = hintOf(n, 'dir');
  run(h, ['idea', 'set', '--dir', dir, '--json', JSON.stringify({ items: ITEMS, gates: GATES })]);
  run(h, ['idea', 'agree', '--dir', dir]);
  const none = S(h, dir, ['open']);
  assert.equal(none.code, 1);
  assert.equal(none.out, 'Nothing to share yet. Say "build it".');
  assert.equal(hintOf(none, 'hint'), 'nothing');
  B(h, dir, ['open']);
  const busy = S(h, dir, ['open']);
  assert.equal(busy.code, 1);
  assert.equal(hintOf(busy, 'hint'), 'busy');
  assert.match(busy.out, /^Still building/);
  B(h, dir, ['next']);
  fs.writeFileSync(path.join(dir, 'app', 'ITEM-001.txt'), 'grid\n');
  B(h, dir, ['commit', '-m', 'grid']);
  B(h, dir, ['built', 'ITEM-001', '--return', DONE()]);
  B(h, dir, ['close']);
  const untried = S(h, dir, ['open']);
  assert.equal(untried.code, 1);
  assert.equal(untried.out, "Nothing goes live until you've tried it.", 'the handoff line is the script\'s');
  assert.equal(hintOf(untried, 'next'), 'try');
  assert.ok(!fs.existsSync(path.join(dir, '.cohdit', 'ledger', 'runs')) || !fs.readdirSync(path.join(dir, '.cohdit', 'ledger', 'runs')).some((f) => /share/.test(fs.readFileSync(path.join(dir, '.cohdit', 'ledger', 'runs', f), 'utf8').split('\n')[0])), 'no share run is recorded for a handoff');
  T(h, dir, ['start']);
  T(h, dir, ['pass']);
  fs.appendFileSync(path.join(dir, 'app', 'page.tsx'), '// mine\n');
  const dirty = S(h, dir, ['open']);
  assert.equal(dirty.code, 1);
  assert.equal(dirty.out, 'I stopped because the project has changes I didn\'t make. Say "show me the details".');
  assert.equal(hintOf(dirty, 'hint'), 'dirty_tree');
  assert.match(R(h, dir, 'why', 'plain', '--last'), /^Stopped just now\. I stopped because the project has changes/m, 'the stop is a share run in the ledger');
  H.git(['commit', '-q', '-am', 'mine'], dir);
  const ok = S(h, dir, ['open']);
  assert.equal(ok.code, 0, ok.err);
  assert.equal(hintOf(ok, 'next'), 'ask');
});

test('the one question, a no, the yes, one deploy, the link; a later share asks nothing and reuses the project', () => {
  const h = home();
  const dir = triedIdea(h);
  const o = S(h, dir, ['open']);
  assert.equal(o.code, 0, o.err);
  assert.equal(o.out, 'Put it live at https://abc-friends.vercel.app? Anyone with the link can open it; the code and anything typed into it stay in your accounts.');
  assert.equal(hintOf(o, 'next'), 'ask');
  assert.equal(hintOf(o, 'url'), 'https://abc-friends.vercel.app');
  const later = S(h, dir, ['later']);
  assert.equal(later.code, 0, later.err);
  assert.equal(later.out, ['You chose not to make it live yet.', 'Say "share it" when you\'re ready.'].join('\n'));
  assert.equal(hintOf(later, 'next'), 'none');
  assert.equal(H.git(['status', '--porcelain'], dir), '', 'the run is in the committed ledger');
  const o2 = S(h, dir, ['open']);
  assert.equal(hintOf(o2, 'next'), 'ask', 'a no does not settle it; the question returns');
  const go = S(h, dir, ['go']);
  assert.equal(go.code, 0, go.err + go.out);
  assert.equal(go.out, [
    'Publishing…',
    'Live: https://abc-friends.vercel.app — send it to whoever should try it first.',
    'Still to check at that link: On the iPad.',
    'Something wrong? Say "let me try it" and tell me what you saw.',
  ].join('\n'));
  assert.equal(hintOf(go, 'url'), 'https://abc-friends.vercel.app');
  assert.equal(hintOf(go, 'next'), 'none');
  const cfg = cfgOf(dir);
  assert.deepEqual(cfg.connectors.vercel, { project: 'abc-friends', url: 'https://abc-friends.vercel.app' });
  assert.equal(fs.readFileSync(path.join(dir, '.vercelignore'), 'utf8'), sh.IGNORE, 'the ledger and any secrets file never travel');
  assert.equal(H.git(['status', '--porcelain'], dir), '', 'the ignore file and the ledger are committed');
  assert.ok(!JSON.parse(fs.readFileSync(path.join(dir, '.cohdit', 'local.json'), 'utf8')).share, 'nothing pending');
  const events = R(h, dir, 'events', 'tech', '--last');
  for (const code of ['RUN_START', 'DECIDE', 'DEPLOY', 'URL_SHARED', 'RUN_END']) assert.match(events, new RegExp('  ' + code + ' '), code);
  assert.match(events, /DEPLOY vercel production state=building url=https:\/\/abc-friends-priya-k\.vercel\.app dep=dpl_8f3k2/);
  assert.match(events, /URL_SHARED vercel production https:\/\/abc-friends\.vercel\.app/);
  assert.doesNotMatch(go.out, /priya-k/, 'the deployment\'s own address is never handed back');
  const status = R(h, dir, 'status', 'plain');
  assert.match(status, /^Live: https:\/\/abc-friends\.vercel\.app \(shared just now\)$/m);
  assert.match(status, /^  tested     Letter grid$/m);
  assert.match(status, /^  to check   On the iPad$/m);
  const reg = JSON.parse(fs.readFileSync(path.join(h.dir, '.cohdit', 'settings.json'), 'utf8'));
  assert.equal(reg.projects[0].url, 'https://abc-friends.vercel.app');
  // a week later, after a fix and a try: no question, the same project, the same link
  setProbes(h, { [VC + 'project ls --json --limit 100 --filter abc-friends']: { code: 1, out: '' } });   // the list is never asked for again
  const o3 = S(h, dir, ['open']);
  assert.equal(o3.code, 0, o3.err);
  assert.equal(o3.out, '', 'nothing to ask');
  assert.equal(hintOf(o3, 'next'), 'go');
  const go2 = S(h, dir, ['go']);
  assert.equal(go2.code, 0, go2.err + go2.out);
  assert.match(go2.out, /^Live: https:\/\/abc-friends\.vercel\.app/m);
  assert.equal(cfgOf(dir).connectors.vercel.project, 'abc-friends');
  const digestTech = R(h, dir, 'digest', 'tech', '--last');
  assert.match(digestTech, /^Live on production: https:\/\/abc-friends\.vercel\.app$/m);
  assert.match(digestTech, /^Something wrong\? Say "let me try it" and name what failed\.$/m);
});

test('a taken name gets -2 on the publishing side only; a team scope is passed and its membership checked first', () => {
  const h = home({
    [VC + 'project ls --json --limit 100 --filter abc-friends']: { code: 0, out: JSON.stringify({ projects: [{ name: 'abc-friends', latestProductionUrl: 'https://abc-friends.vercel.app' }] }) },
    [VC + 'teams ls --json']: { code: 0, out: JSON.stringify({ teams: [{ id: 'team_1', slug: 'cohdit', name: 'Cohdit' }] }) },
    [VC + 'project ls --json --limit 100 --filter abc-friends --scope cohdit']: { code: 0, out: JSON.stringify({ projects: [{ name: 'abc-friends' }] }) },
    [DEPLOY_ARGS('abc-friends-2') + ' --scope cohdit']: { code: 0, out: DEPLOY_OUT('https://abc-friends-2-cohdit.vercel.app') },
    [INSPECT_ARGS('https://abc-friends-2-cohdit.vercel.app') + ' --scope cohdit']: { code: 0, out: JSON.stringify({ readyState: 'READY', aliases: ['abc-friends-2.vercel.app'] }) },
  });
  const n = run(h, ['idea', 'new', 'ABC Friends']);
  const dir = hintOf(n, 'dir');
  run(h, ['idea', 'set', '--dir', dir, '--json', JSON.stringify({ items: ITEMS.slice(0, 1), gates: GATES })]);
  const noSlug = run(h, ['idea', 'agree', '--dir', dir, '--hosting', 'team']);
  assert.equal(noSlug.code, 1);
  assert.match(noSlug.err, /team hosting needs --team <slug>/);
  const a = run(h, ['idea', 'agree', '--dir', dir, '--hosting', 'team', '--team', 'other-team']);
  assert.equal(a.code, 0, a.err);
  assert.equal(cfgOf(dir).hosting.scope, 'other-team', 'the slug the person was found on, never a placeholder');
  B(h, dir, ['open']); B(h, dir, ['next']);
  fs.writeFileSync(path.join(dir, 'app', 'ITEM-001.txt'), 'grid\n');
  B(h, dir, ['commit', '-m', 'grid']); B(h, dir, ['built', 'ITEM-001', '--return', DONE()]); B(h, dir, ['close']);
  T(h, dir, ['start']); T(h, dir, ['pass']);
  const notMember = S(h, dir, ['open']);
  assert.equal(notMember.code, 1);
  assert.equal(notMember.out, ['  Vercel team not yet — the team\'s owner needs to add you', 'Publishing failed, so I stopped. The details are saved.'].join('\n'));
  assert.equal(hintOf(notMember, 'hint'), 'team');
  const cfg = cfgOf(dir); cfg.hosting.scope = 'cohdit';
  fs.writeFileSync(path.join(dir, '.cohdit', 'config.json'), JSON.stringify(cfg, null, 2) + '\n');
  H.git(['commit', '-q', '-am', 'team'], dir);
  const o = S(h, dir, ['open']);
  assert.equal(o.code, 0, o.err);
  const go = S(h, dir, ['go']);
  assert.equal(go.code, 0, go.err + go.out);
  assert.match(go.out, /^Live: https:\/\/abc-friends-2\.vercel\.app/m, 'the real address, read back from the tool');
  assert.equal(cfgOf(dir).connectors.vercel.project, 'abc-friends-2');
});

test('not signed in is a stop that points at setup; the tool out of reach is a stop with the reason saved', () => {
  const h = home({ [VC + 'whoami']: { code: 1, out: '', err: 'Error: not logged in' } });
  const dir = triedIdea(h, 'ABC Friends', ITEMS.slice(0, 1));
  const o = S(h, dir, ['open']);
  assert.equal(o.code, 1);
  assert.equal(o.out, 'I stopped because you\'re not signed in to vercel. Say "set me up".');
  assert.equal(hintOf(o, 'hint'), 'no_auth');
  setProbes(h, { [VC + '--version']: { code: null, out: '' } });
  const off = S(h, dir, ['open']);
  assert.equal(off.code, 1);
  assert.equal(off.out, 'I stopped because I couldn\'t fetch the publishing tool. Check the connection and say "share it" again.');
  assert.equal(hintOf(off, 'hint'), 'offline');
  assert.match(R(h, dir, 'events', 'tech', '--last'), /STOP cause=offline item=- name=vercel blob=-/);
});

test('a failed build is one stop with the log and no second attempt; the next "share it" is one more', () => {
  const h = home({
    [INSPECT_ARGS(DEP_URL)]: { code: 0, out: JSON.stringify({ id: 'dpl_8f3k2', readyState: 'ERROR' }) },
    [VC + 'inspect ' + DEP_URL + ' --logs']: { code: 0, out: 'Running "npm run build"\nError: Command "npm run build" exited with 1\n./app/page.tsx:12:5 Type error: Property \'chores\' does not exist\n' },
  });
  const dir = triedIdea(h, 'ABC Friends', ITEMS.slice(0, 2));
  S(h, dir, ['open']);
  const go = S(h, dir, ['go']);
  assert.equal(go.code, 1, go.err);
  assert.equal(go.out, [
    'Publishing…',
    'Publishing failed, so I stopped. The details are saved.',
    'Say "share it" to try again, or "show me the details" to see why.',
  ].join('\n'));
  assert.equal(hintOf(go, 'next'), 'none');
  const events = R(h, dir, 'events', 'tech', '--last');
  assert.equal((events.match(/DEPLOY vercel production state=building/g) || []).length, 1, 'one attempt');
  assert.match(events, /DEPLOY vercel production state=error/);
  assert.match(events, /STOP cause=connector item=- name=vercel blob=([0-9a-f]{16})/);
  const bid = /blob=([0-9a-f]{16})/.exec(events)[1];
  assert.match(fs.readFileSync(path.join(dir, '.cohdit', 'ledger', 'blobs', bid + '.txt'), 'utf8'), /Property 'chores' does not exist/, 'the build log is the blob, in the ledger');
  assert.match(R(h, dir, 'why', 'plain', '--last'), /^Stopped just now\. Publishing failed, so I stopped\./m);
  assert.match(R(h, dir, 'status', 'plain'), /^Not shared yet/m, 'no half-live link');
  assert.equal(hintOf(S(h, dir, ['open']), 'next'), 'go', 'the yes stands; a second "share it" is one more attempt');
  setProbes(h, { [INSPECT_ARGS(DEP_URL)]: { code: 0, out: JSON.stringify({ readyState: 'READY', aliases: ['abc-friends.vercel.app'] }) } });
  const go2 = S(h, dir, ['go']);
  assert.equal(go2.code, 0, go2.err + go2.out);
  assert.match(go2.out, /^Live: https:\/\/abc-friends\.vercel\.app/m);
  assert.match(R(h, dir, 'status', 'plain'), /^Live: https:\/\/abc-friends\.vercel\.app/m);
});

test('a deploy still building: the call ends with next=wait, the run stays open, "wait" finishes it; a deploy that would not start', () => {
  const h = home({ [INSPECT_ARGS(DEP_URL)]: { code: 1, out: JSON.stringify({ id: 'dpl_8f3k2', readyState: 'BUILDING' }) } });
  const dir = triedIdea(h, 'ABC Friends', ITEMS.slice(0, 1));
  S(h, dir, ['open']);
  const go = S(h, dir, ['go']);
  assert.equal(go.code, 3, go.err);
  assert.equal(go.out, 'Publishing…');
  assert.equal(hintOf(go, 'next'), 'wait');
  const pending = JSON.parse(fs.readFileSync(path.join(dir, '.cohdit', 'local.json'), 'utf8')).share;
  assert.equal(pending.url, DEP_URL);
  const again = S(h, dir, ['wait']);
  assert.equal(again.code, 3);
  const reopen = S(h, dir, ['open']);
  assert.equal(hintOf(reopen, 'next'), 'wait', '"share it" while a deploy is on its way waits for it, never starts a second');
  const goAgain = S(h, dir, ['go']);
  assert.equal(goAgain.code, 3, 'so does "go"');
  setProbes(h, { [INSPECT_ARGS(DEP_URL)]: { code: 0, out: JSON.stringify({ readyState: 'READY', aliases: ['abc-friends.vercel.app'] }) } });
  const done = S(h, dir, ['wait']);
  assert.equal(done.code, 0, done.err);
  assert.match(done.out, /^Live: https:\/\/abc-friends\.vercel\.app/m);
  assert.equal((R(h, dir, 'events', 'tech', '--last').match(/DEPLOY vercel production state=building/g) || []).length, 1, 'one deploy across three calls');
  // another idea: the deploy itself is refused
  const h2 = home({ [DEPLOY_ARGS('abc-friends')]: { code: 1, out: JSON.stringify({ status: 'error', reason: 'not_authorized', message: 'Please log in to continue' }) } });
  const dir2 = triedIdea(h2, 'ABC Friends', ITEMS.slice(0, 1));
  S(h2, dir2, ['open']);
  const bad = S(h2, dir2, ['go']);
  assert.equal(bad.code, 1);
  assert.equal(bad.out, ['Publishing failed, so I stopped. The details are saved.', 'Say "share it" to try again, or "show me the details" to see why.'].join('\n'));
  const events = R(h2, dir2, 'events', 'tech', '--last');
  assert.match(events, /DEPLOY vercel production state=error url=- dep=-/);
  const bid = /blob=([0-9a-f]{16})/.exec(events)[1];
  assert.equal(fs.readFileSync(path.join(dir2, '.cohdit', 'ledger', 'blobs', bid + '.txt'), 'utf8'), 'Please log in to continue');
});

test('share after a fail goes ahead and names the thing; the hook carries the session for share calls', () => {
  const h = home();
  const dir = builtIdea(h, 'ABC Friends', ITEMS);
  T(h, dir, ['start']);
  assert.equal(T(h, dir, ['result', '2', 'fail', '--note', 'no sound']).code, 0);
  assert.equal(T(h, dir, ['pass']).code, 1);
  const o = S(h, dir, ['open']);
  assert.equal(hintOf(o, 'next'), 'ask', 'a failed thing is to do again; it never blocks the share');
  const go = S(h, dir, ['go']);
  assert.equal(go.code, 0, go.err + go.out);
  assert.match(go.out, /^Not fixed yet: Tap to hear\. Say "build it"\.$/m);
  assert.match(go.out, /^Still to check at that link: On the iPad\.$/m);
  const hatchPath = path.join(H.S, 'hatch.js');
  assert.equal(hatch.withSession('node "' + hatchPath + '" share open --dir x', 'sess-1'), 'node "' + hatchPath + '" share open --session sess-1 --dir x');
  const s = run(h, ['share', 'open', '--dir', dir, '--session', 'sess-9']);
  assert.equal(s.code, 0, s.err);
  assert.equal(JSON.parse(fs.readFileSync(path.join(h.dir, '.cohdit', 'active.sess-9.json'), 'utf8')).path, dir, 'the usage pointer per session');
  S(h, dir, ['later']);
});

test('the gate holds at the moment of the deploy: a change made after the question stops the run, nothing is uploaded', () => {
  const h = home();
  const dir = triedIdea(h, 'ABC Friends', ITEMS.slice(0, 1));
  assert.equal(hintOf(S(h, dir, ['open']), 'next'), 'ask');
  fs.appendFileSync(path.join(dir, 'app', 'page.tsx'), '// mine, after the question\n');
  const go = S(h, dir, ['go']);
  assert.equal(go.code, 1);
  assert.equal(go.out, 'I stopped because the project has changes I didn\'t make. Say "show me the details".');
  assert.equal(hintOf(go, 'hint'), 'dirty_tree');
  const events = R(h, dir, 'events', 'tech', '--last');
  assert.doesNotMatch(events, /DEPLOY|DECIDE type=publish/, 'no yes recorded, no deploy');
  assert.match(events, /STOP cause=dirty_tree/);
  assert.match(events, /RUN_END outcome=stopped/, 'the run is closed, not left for a later "yes"');
  assert.equal(S(h, dir, ['go']).code, 2, 'nothing is open any more');
  // a question left open is closed, not called a crash, when the next skill starts
  H.git(['commit', '-q', '-am', 'mine'], dir);
  const o = S(h, dir, ['open']);
  const runId = hintOf(o, 'run');
  assert.equal(hintOf(o, 'next'), 'ask');
  assert.equal(B(h, dir, ['open']).code, 0);
  assert.match(R(h, dir, 'events', 'tech', '--run', runId), /RUN_END outcome=ok/, 'the unanswered share run is closed by the build');
  B(h, dir, ['close']);
  const o2 = S(h, dir, ['open']);
  assert.equal(hintOf(o2, 'next'), 'ask');
  assert.equal(T(h, dir, ['start']).code, 1, 'nothing to try');
  assert.match(R(h, dir, 'events', 'tech', '--run', hintOf(o2, 'run')), /RUN_END outcome=ok/, 'and by a try');
  assert.equal(S(h, dir, ['open']).code, 0);
  S(h, dir, ['later']);
  const fresh = run(h, ['idea', 'new', 'Tracker']);
  run(h, ['idea', 'refuse', 'harm', '--dir', hintOf(fresh, 'dir')]);
  const refused = S(h, hintOf(fresh, 'dir'), ['open']);
  assert.equal(refused.code, 5);
  assert.match(refused.out, /^I can't build this idea\./);
  const noPending = S(h, dir, ['wait']);
  assert.equal(noPending.code, 2, 'no run, nothing to wait for');
});

test('a wait that gets no answer twice, or runs past four waits, is a stop; a cancelled deploy is a stop; a bare production address gets its scheme', () => {
  const h = home({ [INSPECT_ARGS(DEP_URL)]: { code: 1, out: '', err: 'Error: The deployment "abc-friends-priya-k.vercel.app" was not found' } });
  const dir = triedIdea(h, 'ABC Friends', ITEMS.slice(0, 1));
  S(h, dir, ['open']);
  const go = S(h, dir, ['go']);
  assert.equal(go.code, 3, 'one unreadable answer is still "building"');
  const w = S(h, dir, ['wait']);
  assert.equal(w.code, 1, 'two in a row is a stop');
  assert.equal(w.out, ['Publishing failed, so I stopped. The details are saved.', 'Say "share it" to try again, or "show me the details" to see why.'].join('\n'));
  const events = R(h, dir, 'events', 'tech', '--last');
  const bid = /STOP cause=connector item=- name=vercel blob=([0-9a-f]{16})/.exec(events)[1];
  assert.match(fs.readFileSync(path.join(dir, '.cohdit', 'ledger', 'blobs', bid + '.txt'), 'utf8'), /was not found/, 'the tool\'s own words are the blob');
  assert.ok(!JSON.parse(fs.readFileSync(path.join(dir, '.cohdit', 'local.json'), 'utf8')).share, 'nothing pending');
  // still building, four times
  setProbes(h, { [INSPECT_ARGS(DEP_URL)]: { code: 1, out: JSON.stringify({ readyState: 'BUILDING' }) } });
  S(h, dir, ['open']);
  assert.equal(S(h, dir, ['go']).code, 3);
  assert.equal(S(h, dir, ['wait']).code, 3);
  assert.equal(S(h, dir, ['wait']).code, 3);
  const last = S(h, dir, ['wait']);
  assert.equal(last.code, 1, 'the fourth wait gives up');
  assert.match(last.out, /^Publishing failed, so I stopped/m);
  // cancelled
  setProbes(h, { [INSPECT_ARGS(DEP_URL)]: { code: 0, out: JSON.stringify({ readyState: 'CANCELED' }) } });
  S(h, dir, ['open']);
  const c = S(h, dir, ['go']);
  assert.equal(c.code, 1);
  assert.match(R(h, dir, 'events', 'tech', '--last'), /DEPLOY vercel production state=canceled/);
  // a bare production address from the deploy itself
  setProbes(h, { [DEPLOY_ARGS('abc-friends')]: { code: 0, out: DEPLOY_OUT(DEP_URL, 'abc-friends.vercel.app') }, [INSPECT_ARGS(DEP_URL)]: { code: 0, out: JSON.stringify({ readyState: 'READY' }) } });
  S(h, dir, ['open']);
  const ok = S(h, dir, ['go']);
  assert.equal(ok.code, 0, ok.err + ok.out);
  assert.match(ok.out, /^Live: https:\/\/abc-friends\.vercel\.app/m);
  assert.match(R(h, dir, 'events', 'tech', '--last'), /URL_SHARED vercel production https:\/\/abc-friends\.vercel\.app/);
});

test('--team goes with team hosting only; setup names the teams the person is on', () => {
  const h = home({ [VC + 'teams ls --json']: { code: 0, out: JSON.stringify({ teams: [{ id: 't1', slug: 'cohdit' }, { id: 't2', slug: 'school' }] }) } });
  const n = run(h, ['idea', 'new', 'ABC Friends']);
  const dir = hintOf(n, 'dir');
  run(h, ['idea', 'set', '--dir', dir, '--json', JSON.stringify({ items: ITEMS.slice(0, 1), gates: GATES })]);
  const wrong = run(h, ['idea', 'agree', '--dir', dir, '--hosting', 'own_free', '--team', 'cohdit']);
  assert.equal(wrong.code, 1);
  assert.match(wrong.err, /--team goes with --hosting team/);
  const setup = run(h, ['setup']);
  assert.equal(hintOf(setup, 'teams'), 'cohdit,school', 'dream offers a team only when the tool lists one');
});

test('the share skill: short, one script, one question, the handoff to try, the public address only', (t) => {
  const skill = H.playbook('skill', 'share');
  if (!skill) return t.skip('no content folder in HATCH_DEV_DIR');
  assert.ok(skill.split('\n').length <= 100, 'skill is ' + skill.split('\n').length + ' lines');
  assert.match(skill, /hatch\.js" share/);
  assert.match(skill, /CONTRACTS\.md/);
  assert.match(skill, /try/);
  assert.doesNotMatch(skill, /new chat/i);
  assert.doesNotMatch(skill, /vercel (login|link|deploy)/i, 'the skill never types the tool\'s commands');
});

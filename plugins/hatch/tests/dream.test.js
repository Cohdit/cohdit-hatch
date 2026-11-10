'use strict';
// dream.test.js — hatch.js idea: the draft the interview writes, the shape lines, the read-back, the
// agreement, the refusal. Home and git config are isolated as in setup.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const sp = require('../scripts/lib/spec');

// In-process loaders read content synchronously; fetch it first when it comes over the API.
test.before(() => H.ready());

function home() {
  const d = H.mkrepo();
  return { dir: d, env: { COHDIT_HOME: d, GIT_CONFIG_GLOBAL: path.join(d, 'gitconfig') } };
}

const ITEMS = [
  { title: 'Letter grid', criteria: ['open it; you see all 26 letters, big'] },
  { title: 'Tap to hear', criteria: ['tap a letter; you hear it'] },
  { title: 'Animal picture', criteria: ['tap a letter; you see the animal and its name'] },
];
const GATES = { personal_details: { value: false, source: 'inferred' }, payments: { value: false, source: 'inferred' }, messaging: { value: false, source: 'inferred' },
  children: { value: true, source: 'said' }, advice: { value: false, source: 'inferred' }, uploads: { value: false, source: 'inferred' }, user_content: { value: false, source: 'inferred' } };

function idea(h, args, input) {
  return H.run('hatch.js', ['idea'].concat(args), { env: h.env, input });
}

function newIdea(h, name) {
  const r = idea(h, ['new', name]);
  assert.equal(r.code, 0, r.err);
  return /^dir=(.*)$/m.exec(r.err)[1];
}

test('idea new: a folder under ~/Hatch, a git repo, a draft, a registry entry, a dream run started', () => {
  const h = home();
  const dir = newIdea(h, 'ABC Friends');
  assert.equal(path.basename(dir), 'abc-friends');
  assert.ok(fs.existsSync(path.join(dir, '.git')));
  const spec = JSON.parse(fs.readFileSync(path.join(dir, '.cohdit', 'spec.json'), 'utf8'));
  assert.equal(spec.agreed, false);
  assert.deepEqual(spec.items, []);
  const reg = JSON.parse(fs.readFileSync(path.join(h.dir, '.cohdit', 'settings.json'), 'utf8'));
  assert.equal(reg.projects[0].slug, 'abc-friends');
  assert.equal(fs.readdirSync(path.join(dir, '.cohdit', 'ledger', 'runs')).length, 1);
  const again = newIdea(h, 'ABC Friends');
  assert.equal(path.basename(again), 'abc-friends-2', 'a taken folder gets a suffix');
});

test('idea set: the shape line after each chunk, then only what was added', () => {
  const h = home();
  const dir = newIdea(h, 'ABC Friends');
  const a = idea(h, ['set', '--dir', dir, '--json', '-'], JSON.stringify({ items: ITEMS, asked: ['walk'] }));
  assert.equal(a.code, 0, a.err);
  assert.equal(a.out, 'So far: Letter grid, Tap to hear, Animal picture. Go on.');
  const b = idea(h, ['set', '--dir', dir, '--json', JSON.stringify({ items: ITEMS.concat([{ title: 'On the iPad', criteria: ['open it on the iPad'], device: true, source: 'inferred' }]) })]);
  assert.equal(b.out, "Added: On the iPad. That's 4 things so far. Go on.");
  const bad = idea(h, ['set', '--dir', dir, '--json', JSON.stringify({ items: Array.from({ length: 9 }, (_, i) => ({ title: 't' + i })) })]);
  assert.equal(bad.code, 64);
  assert.match(bad.err, /^hint=two_ideas$/m);
  const unknown = idea(h, ['set', '--dir', dir, '--json', JSON.stringify({ gates: { teapot: true } })]);
  assert.equal(unknown.code, 64);
  assert.match(unknown.err, /unknown gate teapot/);
});

test('read-back: items in their words, the assumptions block, the rule line, the stated hosting, the explicit terms line first time', () => {
  const h = home();
  const dir = newIdea(h, 'ABC Friends');
  idea(h, ['set', '--dir', dir, '--json', JSON.stringify({ for: 'Maya, 4', anchor: 'she asks to play it again', items: ITEMS, out: ['scores'], gates: GATES, decisions: [{ type: 'design', choice: 'name_then_sound', who: 'hatch' }] })]);
  const r = idea(h, ['show', '--dir', dir, '--full']);
  assert.equal(r.code, 0, r.err);
  const lines = r.out.split('\n');
  assert.equal(lines[0], 'ABC Friends — for Maya, 4. Worked: she asks to play it again.');
  assert.match(lines[1], /^  1 Letter grid\s+— open it; you see all 26 letters, big$/);
  assert.equal(lines[4], 'Not in the first version: scores.');
  assert.equal(lines[5], "I'm assuming: nothing is kept about anyone, no money, no emails or texts, no advice of the health, legal or money kind, no files or photos going in, nobody sees anyone else's input.");
  assert.equal(lines[6], "Anything in what I'm assuming that's wrong?");
  assert.equal(lines[7], 'Children use it, so a few extra rules apply; nothing for you to do.');
  assert.equal(lines[8], 'Decisions I took: 1. Say "what did you decide" any time.');
  assert.equal(lines[9], 'Open questions: none.');
  assert.equal(lines[10], 'Called ABC Friends, in a folder called abc-friends; change either by saying so.');
  assert.match(lines[11], /free plan meant for personal use/);
  assert.match(lines[12], /^Say yes to agree that what you build is yours to answer for \(terms, version \d+; say "read me the terms"\)\.$/);
  assert.equal(lines.length, 13);
  assert.doesNotMatch(r.out, /requirement|criteria|empty state|spec\b/i);
});

test('agree: terms, hosting as Hatch\'s choice, scope, SPEC; the second idea on the computer folds the terms line', () => {
  const h = home();
  const dir = newIdea(h, 'ABC Friends');
  const early = idea(h, ['agree', '--dir', dir]);
  assert.equal(early.code, 1);
  assert.match(early.err, /^problem=nothing to build yet$/m);
  assert.match(early.err, /^problem=not yet known: /m);
  idea(h, ['set', '--dir', dir, '--json', JSON.stringify({ items: ITEMS, gates: GATES })]);
  const r = idea(h, ['agree', '--dir', dir]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, ['You agreed that what you build is yours to answer for.',
    'I picked the free place for the app to live. Say "change where it lives" to choose differently.',
    'You settled what is in and what is out.', 'Saved your idea with 3 things to build.'].join('\n'));
  assert.match(r.err, /^next=build$/m);
  const spec = JSON.parse(fs.readFileSync(path.join(dir, '.cohdit', 'spec.json'), 'utf8'));
  assert.equal(spec.agreed, true);
  assert.deepEqual(spec.rails, ['children']);
  assert.equal(spec.terms_v, sp.terms().version);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.cohdit', 'config.json'), 'utf8'));
  assert.equal(cfg.hosting.provider, 'vercel');
  const locked = idea(h, ['set', '--dir', dir, '--json', '{"out":["x"]}']);
  assert.equal(locked.code, 64, 'an agreed idea is not edited in place');
  // second idea on the same computer: terms already agreed at this version
  const dir2 = newIdea(h, 'Sound Steps');
  idea(h, ['set', '--dir', dir2, '--json', JSON.stringify({ items: ITEMS.slice(0, 1), gates: GATES })]);
  const rb = idea(h, ['show', '--dir', dir2, '--full']);
  assert.match(rb.out.split('\n').pop(), /^"Yes, that's it" also agrees that what you build is yours to answer for \(terms, version \d+\)\.$/);
  const yours = idea(h, ['agree', '--dir', dir2, '--hosting', 'own_paid', '--stack', 'nextjs,vercel']);
  assert.equal(yours.code, 0, yours.err);
  assert.match(yours.out, /^You chose where the app will live\.$/m);
  assert.match(yours.out, /^You chose the technology; I checked it against my list\.$/m);
  const off = idea(h, ['agree', '--dir', newIdea(h, 'Third'), '--stack', 'rails']);
  assert.match(off.err, /^problem=not on my list: rails$/m);
});

test('change: an agreed idea takes small changes (add, edit queued, decisions, out) and refuses big ones; reopen goes back to the interview', () => {
  const h = home();
  const dir = newIdea(h, 'Changeable');
  idea(h, ['set', '--dir', dir, '--json', JSON.stringify({ items: ITEMS, gates: GATES })]);
  assert.equal(idea(h, ['change', '--dir', dir, '--json', '{"out":["x"]}']).code, 64, 'not agreed yet');
  assert.equal(idea(h, ['agree', '--dir', dir]).code, 0);
  const specFile = path.join(dir, '.cohdit', 'spec.json');
  const read = () => JSON.parse(fs.readFileSync(specFile, 'utf8'));
  const r = idea(h, ['change', '--dir', dir, '--json', JSON.stringify({
    add: [{ title: 'Quiz', criteria: ['open Quiz; you see a letter to find'] }],
    edit: [{ id: 'ITEM-001', title: 'Bigger letter grid' }],
    decisions: [{ type: 'design', choice: 'large-print', who: 'you' }],
    out: ['sign in'],
  })]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /^added=ITEM-004$/m);
  assert.match(r.err, /^edited=ITEM-001$/m);
  assert.match(r.err, /^next=build$/m);
  let spec = read();
  assert.equal(spec.agreed, true);
  assert.equal(spec.items.length, 4);
  assert.equal(spec.items[0].title, 'Bigger letter grid');
  assert.equal(spec.items[3].status, 'queued');
  assert.deepEqual(spec.out, ['sign in']);
  assert.ok(spec.decisions.some((d) => d.type === 'design' && d.choice === 'large-print'));
  const events = fs.readdirSync(path.join(dir, '.cohdit', 'ledger', 'runs')).map((f) => fs.readFileSync(path.join(dir, '.cohdit', 'ledger', 'runs', f), 'utf8')).join('');
  assert.match(events, /"choice":"changed"/);
  // big changes and locked decisions are refused, and nothing is written
  for (const bad of [{ gates: { payments: true } }, { shape: 'runs' }, { items: [] }, { decisions: [{ type: 'hosting', choice: 'own_paid' }] }, { edit: [{ id: 'ITEM-999', title: 'x' }] }, { add: [{ title: 'No check' }] }]) {
    const x = idea(h, ['change', '--dir', dir, '--json', JSON.stringify(bad)]);
    assert.equal(x.code, 64, JSON.stringify(bad));
  }
  assert.match(idea(h, ['change', '--dir', dir, '--json', '{"gates":{"payments":true}}']).err, /^hint=invalid$/m);
  assert.deepEqual(read(), spec, 'a refused change writes nothing');
  // a built thing cannot be edited in place
  spec.items[1].status = 'done';
  fs.writeFileSync(specFile, JSON.stringify(spec));
  assert.equal(idea(h, ['change', '--dir', dir, '--json', '{"edit":[{"id":"ITEM-002","title":"y"}]}']).code, 64);
  // the cap is eight
  const many = Array.from({ length: 5 }, (_, i) => ({ title: 'T' + i, criteria: ['c'] }));
  assert.match(idea(h, ['change', '--dir', dir, '--json', JSON.stringify({ add: many })]).err, /^hint=two_ideas$/m);
  // reopen: back to the interview, set works again, agree closes it
  assert.equal(idea(h, ['reopen', '--dir', dir]).code, 0);
  assert.equal(read().agreed, false);
  assert.equal(idea(h, ['set', '--dir', dir, '--json', '{"gates":{"payments":true}}']).code, 0);
  assert.equal(idea(h, ['agree', '--dir', dir]).code, 0);
  assert.equal(read().agreed, true);
  assert.equal(idea(h, ['reopen', '--dir', newIdea(h, 'Fresh')]).code, 64, 'only an agreed idea reopens');
});

test('refuse: one fixed sentence, the run ends, build will not start', () => {
  const h = home();
  const dir = newIdea(h, 'Tracker');
  const r = idea(h, ['refuse', 'harm', '--dir', dir]);
  assert.equal(r.code, 1);
  assert.match(r.out, /^Cohdit doesn't build apps that are designed to physically hurt, threaten, stalk or harass people\. This isn't something I can change or make an exception for\.$/m);
  const spec = JSON.parse(fs.readFileSync(path.join(dir, '.cohdit', 'spec.json'), 'utf8'));
  assert.equal(spec.refused, 'harm');
  assert.equal(idea(h, ['refuse', 'rude', '--dir', dir]).code, 64);
});

test('idea terms prints the terms; idea finds the newest project when no --dir is given', () => {
  const h = home();
  assert.match(idea(h, ['terms']).out, /^# Terms — version \d+/);
  const none = idea(h, ['show']);
  assert.equal(none.code, 64);
  assert.match(none.err, /no idea yet/);
  newIdea(h, 'Only One');
  const r = idea(h, ['show']);
  assert.equal(r.out, 'Nothing written down yet. Go on.');
});

test('the dream skill: short, one script, the refusal clause, the interview file, no new chat, no questionnaire words', (t) => {
  const skill = H.playbook('skill', 'dream');
  if (!skill) return t.skip('no content folder in HATCH_DEV_DIR');
  assert.ok(skill.split('\n').length <= 100, 'skill is ' + skill.split('\n').length + ' lines');
  assert.match(skill, /hatch\.js" idea/);
  assert.match(skill, /content data interview/);
  assert.match(skill, /CONTRACTS\.md/);
  assert.match(skill, /Cohdit does not build apps in a refused category/);
  assert.doesNotMatch(skill, /new chat/i);
  assert.doesNotMatch(skill, /seven gates on one screen|say the numbers/i);
  const iv = sp.loadInterview();
  assert.equal(iv.voice.opener, 'Go on then, what is it?');
  for (const g of Object.keys(iv.gates)) if (!g.startsWith('rule_attached') && !g.startsWith('_')) assert.ok(iv.gates[g].ask && iv.gates[g].assume_no && iv.gates[g].assume_yes, g);
});

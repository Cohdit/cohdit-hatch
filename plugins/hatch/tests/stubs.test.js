'use strict';
// The plugin ships thin stubs: frontmatter, then the fetch, nothing else (docs/THIN-CLIENT.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const api = require('../scripts/lib/api');

const ROOT = path.join(__dirname, '..');

function stub(kind, name) {
  return 'Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/hatch.js" content ' + kind + ' ' + name + '`.\n'
    + 'If it prints an error line, show that line to the person word for word and stop.\n'
    + 'Otherwise follow the printed instructions exactly as if they were this file.\n';
}

function body(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = /^---\n[\s\S]*?\n---\n\n([\s\S]*)$/.exec(text);
  assert.ok(m, file + ' has frontmatter then a blank line');
  return m[1];
}

test('every skill is its frontmatter and the stub; setup asks for the key first', () => {
  for (const name of api.NAMES.skill) {
    const b = body(path.join(ROOT, 'skills', name, 'SKILL.md'));
    if (name === 'setup') {
      assert.match(b, /key status`/);
      assert.match(b, /key set <the key>`/);
      assert.match(b, /stored on this\s+computer only/);
      assert.ok(b.endsWith('\n\nThen r' + stub('skill', 'setup').slice(1)), 'setup ends with the stub');
    } else {
      assert.equal(b, stub('skill', name), name);
    }
  }
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'skills')).sort(), [...api.NAMES.skill].sort());
});

// A read-only agent has no Bash: hatch.js writes its instructions next to the brief.
function readOnlyStub(name) {
  return 'Read `agent-' + name + '.md` first, whole: it is in the folder of the file your prompt names (the brief,\n'
    + 'the scan brief or the consult file). Follow it exactly as if it were this file.\n'
    + 'If it is not there, your final message is the one line `agent-' + name + '.md is missing` and nothing else.\n';
}

test('every agent is its frontmatter and a stub: the maker fetches, the read-only ones read their file', () => {
  for (const name of api.NAMES.agent) {
    const want = api.READ_ONLY.includes(name) ? readOnlyStub(name) : stub('agent', name);
    assert.equal(body(path.join(ROOT, 'agents', name + '.md')), want, name);
  }
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'agents')).sort(), api.NAMES.agent.map((n) => n + '.md').sort());
});

test('a read-only agent has no Bash, so it is never asked to fetch', () => {
  for (const name of api.READ_ONLY) {
    const text = fs.readFileSync(path.join(ROOT, 'agents', name + '.md'), 'utf8');
    assert.match(text, /^tools: Read, Glob, Grep$/m, name);
  }
});

test('the only key prefix in the plugin is the shape regex', () => {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (l.includes('hk' + '_')) hits.push(path.relative(ROOT, f).split(path.sep).join('/') + ':' + (i + 1) + ': ' + l.trim()); });
    }
  };
  walk(ROOT);
  assert.equal(hits.length, 1, hits.join('\n'));
  assert.match(hits[0], /^scripts\/lib\/api\.js:\d+: const KEY_RE = /);
  assert.ok(hits[0].endsWith('/' + api.KEY_RE.source + '/;'));
});

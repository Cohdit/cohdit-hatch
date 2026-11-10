#!/usr/bin/env node
'use strict';
/**
 * ip-guard.js — this repo is public; the playbooks, agent briefs, data, lessons and maintainer docs are
 * not. They live in cohdit-hatch-private (hatch-content/, docs/). Fails, naming each file, when:
 *
 *   1. a tracked file is not on the public list below;
 *   2. a skill or agent in the plugin is more than a thin stub;
 *   3. a file carries a customer's mark (48 spaces/tabs at a line end: a copied cache file);
 *   4. a file holds an access key or a Stripe key;
 *   5. with the content beside this repo (HATCH_DEV_DIR or ../cohdit-hatch-private/hatch-content), any line of
 *      it of 60+ characters appears here (front matter excepted: the stubs share it).
 *
 * Checks staged files when called with --staged (the pre-commit hook), else every tracked file.
 * Prints only paths and line numbers, never the matched text.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = [
  /^\.claude-plugin\/marketplace\.json$/,
  /^\.github\/workflows\/[\w.-]+\.yml$/,
  /^\.githooks\/[\w-]+$/,
  /^\.gitattributes$/, /^\.gitignore$/,
  /^(README|CHANGELOG|CLAUDE|LICENSE)(\.md)?$/,
  /^docs\/TERMS\.md$/,
  /^scripts\/(check\.sh|ip-guard\.js|repos\.sh)$/,
  /^tasks\/backlog-loop\.config\.json$/,   // settings only; the backlog itself lives in cohdit-hatch-private/tasks
  /^plugins\/hatch\/\.claude-plugin\/plugin\.json$/,
  /^plugins\/hatch\/(hooks|scripts|templates|tests)\//,
  /^plugins\/hatch\/skills\/[\w-]+\/SKILL\.md$/,
  /^plugins\/hatch\/agents\/[\w-]+\.md$/,
  /^plugins\/hatch\/data\/secret-patterns\.txt$/,
];
const STUB_MAX_LINES = 20;
const MARK = /[ \t]{48}$/;
// Built from parts so this file does not trip its own check.
const KEYS = [new RegExp('hk' + '_sub_[A-Za-z0-9]+\\.[A-Za-z0-9_-]{32}'), new RegExp('\\b[sr]k_(live|test)' + '_[A-Za-z0-9]{16,}')];
const SELF = 'scripts/ip-guard.js';

function git(args) { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }); }

function files(staged) {
  const out = staged ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']) : git(['ls-files', '-z']);
  return out.split('\0').filter(Boolean);
}

function read(file, staged) {
  try {
    return staged ? execFileSync('git', ['show', ':' + file], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 })
      : fs.readFileSync(path.join(ROOT, file), 'utf8');
  } catch (e) {
    return null;
  }
}

function bodyLines(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return lines;
  const end = lines.indexOf('---', 1);
  return end < 0 ? lines : lines.slice(end + 1);
}

/** Every line of 60+ characters in the private content, outside front matter. */
function contentLines() {
  const env = process.env.HATCH_DEV_DIR;
  const dir = env && fs.existsSync(path.join(env, 'data', 'codes.json')) ? env : path.join(ROOT, '..', 'cohdit-hatch-private', 'hatch-content');
  if (!fs.existsSync(dir)) return null;
  const docs = path.join(dir, '..', 'docs', 'hatch');
  const set = new Set();
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else for (const l of bodyLines(fs.readFileSync(p, 'utf8'))) { const t = l.trim(); if (t.length >= 60) set.add(t); }
    }
  };
  walk(dir);
  walk(docs);
  return set;
}

function main() {
  const staged = process.argv.includes('--staged');
  const list = files(staged);
  const content = contentLines();
  const problems = [];
  for (const f of list) {
    if (!PUBLIC.some((re) => re.test(f))) {
      problems.push(`${f}: not on the public list. Playbooks, data, lessons and notes go in cohdit-hatch-private.`);
      continue;
    }
    const text = read(f, staged);
    if (text == null || text.includes('\0')) continue;
    const lines = text.split('\n');
    if (/^plugins\/hatch\/(skills\/[\w-]+\/SKILL|agents\/[\w-]+)\.md$/.test(f) && lines.length > STUB_MAX_LINES) {
      problems.push(`${f}: ${lines.length} lines; the plugin keeps stubs only (limit ${STUB_MAX_LINES}). The body goes in cohdit-hatch-private/hatch-content.`);
    }
    if (f === SELF) continue;
    const body = new Set(bodyLines(text));
    lines.forEach((l, i) => {
      const at = `${f}:${i + 1}`;
      if (MARK.test(l)) problems.push(`${at}: carries a customer's mark (copied from a Hatch cache).`);
      if (KEYS.some((re) => re.test(l))) problems.push(`${at}: holds a key.`);
      if (content && body.has(l) && content.has(l.trim())) problems.push(`${at}: copies a line of the private content.`);
    });
  }
  if (problems.length) {
    for (const p of problems) console.log('  FAIL  ' + p);
    console.log(`ip-guard: ${problems.length} problem(s)${content ? '' : ' (content not beside this repo: line copies not checked)'}`);
    process.exit(1);
  }
  console.log(`ip-guard: ${list.length} files clean${content ? ', no content lines copied' : ' (content not beside this repo: line copies not checked)'}`);
}

main();

'use strict';
/**
 * lib/tools.js — the one file that knows where tools live on a kind of computer.
 *
 * Everything else in Hatch speaks in capabilities (docs/CONTRACTS.md § Principles, 8). This file
 * exists so that the person is never sent to a download page or asked to restart for a tool Hatch
 * can place itself:
 *
 *   extraDirs()           where installers put node, git and gh, so a tool installed a minute ago
 *                         is found even though the window that launched Claude Code still has its
 *                         old PATH. Appended to PATH for every child process Hatch starts.
 *   ghCmd()               the GitHub tool to run: Hatch's own copy under ~/.cohdit/bin if present,
 *                         else whatever PATH has.
 *   fetchGh(run)          download the GitHub tool's current release for this machine into
 *                         ~/.cohdit/bin and return its path; null if it could not. No admin rights,
 *                         no PATH change, no restart. The archive is opened with `tar`, which every
 *                         supported platform ships.
 *   openUrl(url)          open an address in the person's default browser; false if nothing opened.
 *   stopProcess(pid)      stop a process try started, with everything under it.
 *
 * check.sh's "no operating-system names" lint excludes this file on purpose.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const GH_RELEASES = 'https://github.com/cli/cli/releases';
const FETCH_TIMEOUT_MS = 180000;

function homeDir() {
  return process.env.COHDIT_HOME || os.homedir();
}

function binDir() {
  return path.join(homeDir(), '.cohdit', 'bin');
}

function exe(name) {
  return process.platform === 'win32' ? name + '.exe' : name;
}

/** Directories installers use that an already-open window may not have on PATH yet. Only those
 *  that exist. */
function extraDirs() {
  const p = process.platform;
  let dirs = [binDir()];
  if (p === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const local = process.env.LOCALAPPDATA || '';
    dirs = dirs.concat([
      path.join(pf, 'nodejs'), path.join(pf, 'Git', 'cmd'), path.join(pf, 'GitHub CLI'),
      local && path.join(local, 'Programs', 'nodejs'), local && path.join(local, 'Programs', 'Git', 'cmd'),
    ].filter(Boolean));
  } else if (p === 'darwin') {
    dirs = dirs.concat(['/usr/local/bin', '/opt/homebrew/bin']);
  } else {
    dirs = dirs.concat(['/usr/local/bin', path.join(homeDir(), '.local', 'bin')]);
  }
  return dirs.filter((d) => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } });
}

/** PATH with the extra directories appended, for child processes. */
function pathWithExtras(env) {
  const e = env || process.env;
  const sep = process.platform === 'win32' ? ';' : ':';
  const have = (e.PATH || e.Path || '').split(sep).filter(Boolean);
  const add = extraDirs().filter((d) => !have.some((h) => path.resolve(h) === path.resolve(d)));
  return have.concat(add).join(sep);
}

function ghCmd() {
  const own = path.join(binDir(), exe('gh'));
  return fs.existsSync(own) ? own : 'gh';
}

/** The release asset GitHub publishes for this kind of machine, e.g. gh_2.80.0_macOS_arm64.zip. */
function ghAsset(tag, platform, arch) {
  const v = String(tag).replace(/^v/, '');
  const osPart = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macOS' : 'linux';
  const archPart = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'amd64' : null;
  if (!archPart) return null;
  const ext = platform === 'linux' ? '.tar.gz' : '.zip';
  return { file: 'gh_' + v + '_' + osPart + '_' + archPart + ext, dir: 'gh_' + v + '_' + osPart + '_' + archPart, tag: 'v' + v };
}

/** GET with redirects. Resolves {status, headers, body?} — body only when `toFile` is not given. */
function get(url, toFile, hops) {
  return new Promise((resolve, reject) => {
    if ((hops || 0) > 8) return reject(new Error('too many redirects'));
    const req = https.get(url, { headers: { 'user-agent': 'cohdit-hatch' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), toFile, (hops || 0) + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' for ' + url)); }
      if (toFile) {
        const out = fs.createWriteStream(toFile);
        res.pipe(out);
        out.on('finish', () => resolve({ status: 200 }));
        out.on('error', reject);
      } else {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { body += d; });
        res.on('end', () => resolve({ status: 200, body }));
      }
    });
    req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });
}

/** The current release tag, from the redirect GitHub answers for /releases/latest. */
function latestTag(url, hops) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'cohdit-hatch' } }, (res) => {
      res.resume();
      const loc = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
        const m = /\/tag\/(v[\d.]+)$/.exec(loc);
        if (m) return resolve(m[1]);
        if ((hops || 0) < 4) return resolve(latestTag(new URL(loc, url).toString(), (hops || 0) + 1));
      }
      reject(new Error('no release tag in ' + res.statusCode + ' ' + (loc || '')));
    });
    req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });
}

/** Download and unpack the GitHub tool into ~/.cohdit/bin. Returns the path, or null. Never throws. */
async function fetchGh() {
  try {
    const asset = ghAsset(await latestTag(GH_RELEASES + '/latest'), process.platform, process.arch);
    if (!asset) return null;
    const tmp = path.join(homeDir(), '.cohdit', 'tmp');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const archive = path.join(tmp, asset.file);
    await get(GH_RELEASES + '/download/' + asset.tag + '/' + asset.file, archive);
    const r = spawnSync('tar', ['-xf', archive, '-C', tmp], { encoding: 'utf8', timeout: FETCH_TIMEOUT_MS });
    if (r.status !== 0) return null;
    const got = path.join(tmp, asset.dir, 'bin', exe('gh'));
    if (!fs.existsSync(got)) return null;
    fs.mkdirSync(binDir(), { recursive: true });
    const dest = path.join(binDir(), exe('gh'));
    fs.copyFileSync(got, dest);
    if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
    fs.rmSync(tmp, { recursive: true, force: true });
    return dest;
  } catch (e) {
    return null;
  }
}

/** The person's default browser, on the address. Never throws; false when nothing opened. */
function openUrl(url) {
  const p = process.platform;
  const [cmd, args] = p === 'darwin' ? ['open', [url]] : p === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    return spawnSync(cmd, args, { stdio: 'ignore', timeout: 15000 }).status === 0;
  } catch (e) {
    return false;
  }
}

/** Stop a process try started and everything under it (the shell, the app), so no server is left
 *  behind. try starts it detached, in a process group of its own. Never throws. */
function stopProcess(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 15000 });
    else process.kill(-pid, 'SIGTERM');
  } catch (e) {
    try { process.kill(pid, 'SIGTERM'); } catch (e2) { /* already gone */ }
  }
}

module.exports = { binDir, extraDirs, pathWithExtras, ghCmd, ghAsset, fetchGh, exe, openUrl, stopProcess };

#!/usr/bin/env node
/*
 * XClaudeUsage automated installer.
 *
 * Cross-platform (Windows / macOS / Linux). Single Node.js file, no npm
 * dependencies. Run with:
 *
 *     node install.js
 *
 * or directly from the web:
 *
 *     curl -fsSL https://raw.githubusercontent.com/SrDarf/XClaudeUsage/main/install.js | node
 *
 * Behavior is documented in README.md (section "Quick install (automated)").
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const readline = require('node:readline');
const crypto = require('node:crypto');

const REPO_RAW_BASE =
  'https://raw.githubusercontent.com/SrDarf/XClaudeUsage/main';
const HOOK_FILES = ['xclaude-usage.js', 'xclaude-record.js'];
const HOOK_TIMEOUT = 10;

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const HOOKS_DIR = path.join(CLAUDE_DIR, 'hooks');
const DATA_DIR = path.join(CLAUDE_DIR, 'data');
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');
const CLOUD_CONFIG_PATH = path.join(DATA_DIR, 'xclaude-cloud.json');

const BASE_EVENTS = ['Stop', 'SubagentStop'];
const CLOUD_EVENTS = ['Stop', 'SubagentStop', 'SubagentStart', 'PostToolUse'];

// --- pretty output (matches the claude-accounts installer: terracotta accent) ---
// IMPORTANT: every non-ASCII glyph below is written as a \uXXXX escape on purpose.
// The source file must stay pure ASCII so it survives being piped to node by
// PowerShell, whose Windows 5.1 $OutputEncoding is ASCII and would turn literal
// UTF-8 glyphs into '?' BEFORE node parses them. Node decodes the escapes at
// runtime and renders them to the console via the Unicode API (WriteConsoleW),
// independent of the console codepage (so no chcp dance is needed).
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const fancy = process.stdout.isTTY === true; // box/pointer glyphs only suit a real console
const C = {
  accent: (s) => (useColor ? `\x1b[38;2;215;119;87m${s}\x1b[0m` : s),
  bold: (s) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  green: (s) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
};
// Unicode glyphs on a console, ASCII fallbacks when output is redirected.
// Built from char codes (not literals) so this source file stays pure ASCII.
const u = (cp) => String.fromCharCode(cp);
const G = fancy
  ? { dot: u(0x2022), check: u(0x2713), cross: u(0x2717), barOn: u(0x2588), barOff: u(0x2591), ptr: u(0x276F), up: u(0x2191), down: u(0x2193), mid: u(0x00B7), ell: u(0x2026) }
  : { dot: '*', check: '+', cross: 'x', barOn: '#', barOff: '-', ptr: '>', up: 'up', down: 'dn', mid: '|', ell: '...' };

// The selector hides the cursor and puts the console in raw mode; guarantee both
// are restored on EVERY exit path (normal, throw, top-level abort, SIGINT).
let cursorHidden = false;
function restoreConsole() {
  try { if (cursorHidden && process.stdout.isTTY) process.stdout.write('\x1b[?25h'); } catch (_) {}
  cursorHidden = false;
  try { if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false); } catch (_) {}
}
process.on('exit', restoreConsole);
process.on('SIGINT', () => { restoreConsole(); process.exit(130); });
process.on('SIGTERM', () => { restoreConsole(); process.exit(143); });

function logo() {
  console.log(`\n  ${C.accent(C.bold('XClaudeUsage'))} ${C.dim('installer')}\n`);
}
function step(msg) { console.log(`  ${C.accent(G.dot)} ${msg}`); }
function done(msg) { console.log(`  ${C.green(G.check)} ${msg}`); }
function progress(cur, total, label) {
  const w = 24;
  const ratio = total ? cur / total : 0;
  const filled = Math.round(ratio * w);
  const barStr = C.accent(G.barOn.repeat(filled)) + C.dim(G.barOff.repeat(w - filled));
  const pct = String(Math.round(ratio * 100)).padStart(3);
  if (process.stdout.isTTY) {
    process.stdout.write(`\r  ${barStr} ${pct}%  ${C.dim(label)}\x1b[K`);
    if (cur >= total) process.stdout.write('\n');
  } else if (cur >= total) {
    console.log(`  fetched ${total} files`);
  }
}

function abort(msg) {
  restoreConsole();
  console.error(`\n  ${C.accent(G.cross)} ${msg}\n`);
  process.exit(1);
}
function fail(msg) {
  console.error(`  ${C.accent(G.cross)} ${msg}`);
}

function nodeMajorMinor() {
  const m = process.version.match(/^v(\d+)\.(\d+)/);
  if (!m) return [0, 0];
  return [Number(m[1]), Number(m[2])];
}

function hookCommand(scriptName) {
  const hookPath = path.join(HOOKS_DIR, scriptName).split(path.sep).join('/');
  return `node "${hookPath}"`;
}

function isXClaudeCommand(obj, scriptName) {
  return Boolean(
    obj && typeof obj === 'object' && typeof obj.command === 'string' &&
      obj.command.includes(scriptName),
  );
}

function atomicWrite(destPath, body) {
  const tmp = `${destPath}.write-${process.pid}`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, destPath);
}

function httpRequest(url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers }, (res) => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        res.resume();
        resolve(httpRequest(res.headers.location, { method, headers }));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Persist GitHub raw ETags so we can short-circuit downloads with
// If-None-Match. The CDN ETag is opaque (Fastly-internal, not derivable from
// the file contents), so we have to remember what we saw last time.
const ETAGS_PATH = path.join(DATA_DIR, 'xclaude-installer-etags.json');

function loadETags() {
  if (!fs.existsSync(ETAGS_PATH)) return {};
  try {
    const obj = JSON.parse(fs.readFileSync(ETAGS_PATH, 'utf8'));
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (_) {
    return {};
  }
}

function saveETags(etags) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ETAGS_PATH, JSON.stringify(etags, null, 2) + '\n');
}

async function checkConnectivity() {
  try {
    const r = await httpRequest(`${REPO_RAW_BASE}/${HOOK_FILES[0]}`, {
      method: 'HEAD',
    });
    if (r.statusCode !== 200) {
      abort(
        `cannot reach GitHub (HTTP ${r.statusCode}). Check your connection and try again.`,
      );
    }
  } catch (e) {
    abort(`cannot reach GitHub: ${e.message}. Check your connection.`);
  }
}

async function downloadFile(url, destPath, prevETag) {
  // Send If-None-Match so GitHub's CDN can answer 304 (no body) when the file
  // hasn't changed since we last saw it. Only valid if the local file still
  // exists - otherwise we genuinely need the body, even if the ETag matches.
  const headers = {};
  if (prevETag && fs.existsSync(destPath)) {
    headers['If-None-Match'] = prevETag;
  }
  const r = await httpRequest(url, { headers });
  const newETag =
    (r.headers && (r.headers.etag || r.headers.ETag)) || prevETag || null;
  if (r.statusCode === 304) {
    return { skipped: true, etag: newETag };
  }
  if (r.statusCode !== 200) {
    throw new Error(`HTTP ${r.statusCode} for ${url}`);
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  atomicWrite(destPath, r.body);
  return { skipped: false, etag: newETag };
}

function readSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  let raw;
  try {
    raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
  } catch (e) {
    abort(`cannot read ${SETTINGS_PATH}: ${e.message}`);
  }
  if (raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      abort(`${SETTINGS_PATH} does not contain a JSON object at the top level.`);
    }
    return parsed;
  } catch (e) {
    abort(
      `${SETTINGS_PATH} is not valid JSON (${e.message}). Fix it manually before running this installer.`,
    );
  }
}

function writeSettingsIfChanged(obj) {
  const body = `${JSON.stringify(obj, null, 2)}\n`;
  let originalBody = null;
  if (fs.existsSync(SETTINGS_PATH)) {
    try { originalBody = fs.readFileSync(SETTINGS_PATH, 'utf8'); } catch (_) {}
  }
  if (originalBody === body) return { changed: false, backup: null };
  let backup = null;
  if (originalBody !== null) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backup = `${SETTINGS_PATH}.backup-${stamp}`;
    fs.copyFileSync(SETTINGS_PATH, backup);
  }
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  atomicWrite(SETTINGS_PATH, body);
  return { changed: true, backup };
}

function ensureXClaudeStatusline(settings) {
  const desired = { type: 'command', command: hookCommand('xclaude-usage.js') };
  const existing = settings.statusLine;
  if (existing === undefined || existing === null) {
    settings.statusLine = desired;
    return { action: 'created' };
  }
  if (isXClaudeCommand(existing, 'xclaude-usage.js')) {
    settings.statusLine = { ...existing, ...desired };
    return { action: 'updated' };
  }
  abort(
    `a non-XClaude statusLine is already configured in ${SETTINGS_PATH}. ` +
      `Refusing to overwrite it. Remove or rename it manually, then re-run the installer.`,
  );
}

function ensureXClaudeHooks(settings, events) {
  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }
  const desiredEntry = {
    type: 'command',
    command: hookCommand('xclaude-record.js'),
    timeout: HOOK_TIMEOUT,
  };
  const summary = {};
  for (const event of events) {
    const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    let touched = false;
    for (const group of list) {
      if (!group || !Array.isArray(group.hooks)) continue;
      for (let i = 0; i < group.hooks.length; i++) {
        if (isXClaudeCommand(group.hooks[i], 'xclaude-record.js')) {
          group.hooks[i] = { ...group.hooks[i], ...desiredEntry };
          touched = true;
        }
      }
    }
    if (!touched) {
      list.push({ hooks: [desiredEntry] });
      summary[event] = 'added';
    } else {
      summary[event] = 'updated';
    }
    settings.hooks[event] = list;
  }
  return summary;
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a)));
}

async function askRequired(rl, name, question, validate) {
  for (;;) {
    const answer = (await ask(rl, question)).trim();
    if (!answer) {
      fail(`${name} cannot be empty.`);
      continue;
    }
    const error = validate ? validate(answer) : null;
    if (error) {
      fail(error);
      continue;
    }
    return answer;
  }
}

function readExistingCloudConfig() {
  if (!fs.existsSync(CLOUD_CONFIG_PATH)) return null;
  try {
    const raw = fs.readFileSync(CLOUD_CONFIG_PATH, 'utf8');
    const obj = JSON.parse(raw);
    if (
      obj && typeof obj === 'object' &&
      typeof obj.libsql_url === 'string' && obj.libsql_url &&
      typeof obj.auth_token === 'string' && obj.auth_token &&
      typeof obj.device_id === 'string' && obj.device_id &&
      (obj.libsql_url.startsWith('libsql://') || obj.libsql_url.startsWith('https://'))
    ) {
      return {
        libsql_url: obj.libsql_url,
        auth_token: obj.auth_token,
        device_id: obj.device_id,
      };
    }
  } catch (_) {
    // fall through; treat as missing
  }
  return null;
}

function maskToken(token) {
  if (!token || token.length <= 12) return '***';
  return `${token.slice(0, 8)}${G.ell}${token.slice(-4)} (${token.length} chars)`;
}

async function askEnableCloud(io) {
  if (rawCapable) {
    return select(
      'Turso cloud sync (aggregate usage across machines)?',
      [
        { label: `No   ${C.dim('- single device (default)')}`, value: false },
        { label: `Yes  ${C.dim('- sync across machines')}`, value: true },
      ],
    );
  }
  // stdin is the piped script (not a raw TTY): fall back to a y/N line prompt
  // read from the opened console (io = CONIN$/CONOUT$ or /dev/tty), which is the
  // real keyboard even under `irm|node`.
  const rl = readline.createInterface({ input: io.input, output: io.output, terminal: true });
  try {
    const ans = (await ask(rl, 'Enable Turso cloud sync for multi-device aggregation? [y/N]: '))
      .trim().toLowerCase();
    return ans === 'y' || ans === 'yes';
  } finally {
    rl.close();
  }
}

async function promptCloud(io) {
  if (!(await askEnableCloud(io))) {
    return { enabled: false };
  }

  const rl = readline.createInterface({ input: io.input, output: io.output, terminal: true });
  try {
    const existing = readExistingCloudConfig();
    if (existing) {
      console.log(
        `\nFound an existing cloud config at ${CLOUD_CONFIG_PATH}:\n` +
          `  libsql_url: ${existing.libsql_url}\n` +
          `  auth_token: ${maskToken(existing.auth_token)}\n` +
          `  device_id:  ${existing.device_id}\n`,
      );
      const reuse = (await ask(rl, 'Use this existing config? [Y/n]: ')).trim().toLowerCase();
      if (reuse === '' || reuse === 'y' || reuse === 'yes') {
        return { enabled: true, ...existing };
      }
    }

    console.log(
      '\nYou must have already created the Turso database (see the manual\n' +
        'instructions in README.md, section "Multi-device sync"). The installer\n' +
        'will NOT create the database for you - it only stores the credentials.\n',
    );
    const libsql_url = await askRequired(
      rl, 'libsql_url', 'libsql_url (libsql://... or https://...): ',
      (v) => (v.startsWith('libsql://') || v.startsWith('https://'))
        ? null
        : 'libsql_url must start with libsql:// or https://',
    );
    const auth_token = await askRequired(rl, 'auth_token', 'auth_token: ');
    const device_id = await askRequired(rl, 'device_id', 'device_id (e.g. luka-laptop): ');
    return { enabled: true, libsql_url, auth_token, device_id };
  } finally {
    rl.close();
  }
}

function writeCloudConfig(cloud) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const body = `${JSON.stringify(
    {
      libsql_url: cloud.libsql_url,
      auth_token: cloud.auth_token,
      device_id: cloud.device_id,
    },
    null,
    2,
  )}\n`;
  // Skip rewriting an identical file to avoid bumping mtime needlessly.
  if (fs.existsSync(CLOUD_CONFIG_PATH)) {
    try {
      if (fs.readFileSync(CLOUD_CONFIG_PATH, 'utf8') === body) {
        return { skipped: true };
      }
    } catch (_) {}
  }
  atomicWrite(CLOUD_CONFIG_PATH, body);
  return { skipped: false };
}

// Open the controlling terminal for LINE input that works even when stdin is the
// piped script (`curl|node` / `irm|node`). POSIX: /dev/tty. Windows: CONIN$ (in)
// and CONOUT$ (out) -- `\\.\CON` opened "r+" throws EINVAL and a bare `CONIN$`
// resolves against cwd, so use the `\\.\` device form. These plain fs streams give
// line input (readline) under a pipe; raw arrow-key input is NOT reliable on them
// on Windows, so the arrow selector uses process.stdin instead (see rawCapable).
//
// We NEVER destroy these streams: readline's echo writes are async (dispatched to
// the libuv threadpool) and tearing the stream down mid-drain throws
// ERR_STREAM_DESTROYED. The fds are reaped by process.exit() at the end of main().
function openConsole() {
  let input;
  let output;
  if (process.platform === 'win32') {
    input = fs.createReadStream('', { fd: fs.openSync('\\\\.\\CONIN$', 'r'), autoClose: false });
    output = fs.createWriteStream('', { fd: fs.openSync('\\\\.\\CONOUT$', 'w'), autoClose: false });
  } else {
    input = fs.createReadStream('', { fd: fs.openSync('/dev/tty', 'r'), autoClose: false });
    output = fs.createWriteStream('', { fd: fs.openSync('/dev/tty', 'w'), autoClose: false });
  }
  input.on('error', () => {});
  output.on('error', () => {});
  return { input, output };
}

function getConsole() {
  try {
    return openConsole();
  } catch (e) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      return { input: process.stdin, output: process.stdout };
    }
    abort(
      `this installer is interactive and needs a terminal. Cannot open the console: ${e.message}. ` +
        `As a fallback, download it first and run \`node install.js\` directly.`,
    );
  }
}

// True only when stdin is a real attached console TTY (download-then-run, or a
// direct `node install.js`). Raw arrow-key input is impossible when stdin is the
// pipe carrying the script (`irm|node`), so the selector is gated on this.
const rawCapable = process.stdin.isTTY === true
  && process.stdout.isTTY === true
  && typeof process.stdin.setRawMode === 'function';

// Arrow-key selector (rawCapable only), matching the claude-accounts menu: accent
// pointer, up/down to move, enter to pick, esc = default, Ctrl-C aborts. Reads raw
// keys from process.stdin and renders to process.stdout (neither is ever destroyed).
function select(title, items) {
  const input = process.stdin;
  const out = process.stdout;
  return new Promise((resolve) => {
    let idx = 0;
    let height = 0;
    const render = () => {
      const lines = ['', `  ${C.accent(C.bold(title))}`, ''];
      items.forEach((it, i) => {
        const sel = i === idx;
        const ptr = sel ? C.accent(G.ptr) : ' ';
        const label = sel ? C.accent(C.bold(it.label)) : it.label;
        lines.push(`  ${ptr} ${label}`);
      });
      lines.push('');
      lines.push(`  ${C.dim(`${G.up}/${G.down} ${G.mid} enter ${G.mid} esc`)}`);
      if (height > 0) out.write(`\x1b[${height}A`);
      out.write(lines.map((l) => `\r\x1b[2K${l}`).join('\n'));
      height = lines.length - 1;
    };
    const cleanup = () => {
      out.write(`\x1b[${height + 1}B\r\x1b[?25h\n`);
      cursorHidden = false;
      try { input.setRawMode(false); } catch (_) {}
      input.pause();
      input.removeListener('data', onData);
    };
    const onData = (buf) => {
      const s = buf.toString('utf8');
      if (s === '\x1b[A' || s === 'k') { idx = (idx - 1 + items.length) % items.length; render(); }
      else if (s === '\x1b[B' || s === 'j') { idx = (idx + 1) % items.length; render(); }
      else if (s === '\r' || s === '\n') { cleanup(); resolve(items[idx].value); }
      else if (s === '\x1b') { cleanup(); resolve(items[0].value); }
      else if (s === '\x03') { cleanup(); process.exit(130); }
    };
    out.write('\x1b[?25l');
    cursorHidden = true;
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
    render();
  });
}

async function main() {
  logo();
  const [maj, min] = nodeMajorMinor();
  if (maj < 18) {
    abort(`Node.js >= 18 required (found ${process.version}).`);
  }
  if (maj < 22 || (maj === 22 && min < 5)) {
    step(
      C.dim(`Node ${process.version} works but lacks node:sqlite - statusline runs in ` +
        `legacy single-session mode. Upgrade to Node 22.5+ for full features.`),
    );
  }

  step('checking GitHub connectivity...');
  await checkConnectivity();

  step('reading settings.json...');
  const settings = readSettings();

  if (settings.statusLine !== undefined && !isXClaudeCommand(settings.statusLine, 'xclaude-usage.js')) {
    abort(
      `a non-XClaude statusLine is already configured in ${SETTINGS_PATH}. ` +
        `Refusing to overwrite it. Remove or rename it manually, then re-run.`,
    );
  }

  // Console fds (CONIN$/CONOUT$ or /dev/tty) are left open and reaped by
  // process.exit at the end -- never destroyed (avoids ERR_STREAM_DESTROYED).
  const io = getConsole();
  const cloud = await promptCloud(io);

  const events = cloud.enabled ? CLOUD_EVENTS : BASE_EVENTS;

  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  const etags = loadETags();
  const downloadResults = {};
  let etagsChanged = false;
  step('downloading hooks...');
  progress(0, HOOK_FILES.length, 'starting...');
  let fetched = 0;
  for (const fname of HOOK_FILES) {
    const url = `${REPO_RAW_BASE}/${fname}`;
    const dest = path.join(HOOKS_DIR, fname);
    const result = await downloadFile(url, dest, etags[fname]);
    downloadResults[fname] = result.skipped ? 'up to date' : 'downloaded';
    if (result.etag && result.etag !== etags[fname]) {
      etags[fname] = result.etag;
      etagsChanged = true;
    }
    fetched += 1;
    progress(fetched, HOOK_FILES.length, fname);
  }
  if (etagsChanged) saveETags(etags);
  done('hooks installed');

  let cloudResult = null;
  if (cloud.enabled) {
    cloudResult = writeCloudConfig(cloud);
    done(`cloud config ${cloudResult.skipped ? 'unchanged' : 'written'}`);
  }

  const statusResult = ensureXClaudeStatusline(settings);
  const hooksResult = ensureXClaudeHooks(settings, events);
  const settingsResult = writeSettingsIfChanged(settings);
  if (settingsResult.changed && settingsResult.backup) {
    done(`settings.json updated ${C.dim(`(backup: ${path.basename(settingsResult.backup)})`)}`);
  } else if (settingsResult.changed) {
    done('settings.json created');
  } else {
    done('settings.json already up to date');
  }

  // detail lines (dim, indented under the checks above)
  const summary = [];
  if (settingsResult.changed) {
    summary.push(`statusLine ${statusResult.action}`);
    for (const [ev, action] of Object.entries(hooksResult)) summary.push(`hook ${ev} ${action}`);
  }
  for (const [fname, action] of Object.entries(downloadResults)) summary.push(`${fname} ${action}`);
  summary.push(`cloud sync ${cloud.enabled ? 'enabled' : 'disabled'}`);
  for (const line of summary) console.log(`    ${C.dim(line)}`);

  console.log(`\n  ${C.green(G.check)} ${C.bold('done! restart Claude Code in a fresh session to pick up the changes.')}`);
  console.log(`  ${C.dim('Tip: install right before starting a brand-new session - see the "First-run tip" in README.md.')}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    abort(e && e.stack ? e.stack : String(e));
  });

#!/usr/bin/env node
'use strict';

// Configures Codex's built-in footer. Plugins cannot draw their own TUI widgets,
// but these native items are refreshed by Codex for every interactive session.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const configPath = path.join(os.homedir(), '.codex', 'config.toml');
const value = 'status_line = ["model-with-reasoning", "context-remaining", "five-hour-limit", "weekly-limit", "used-tokens", "git-branch", "current-dir"]';

function updateConfig(text) {
  const header = /^\[tui\][ \t]*\r?$/m;
  const match = header.exec(text);
  if (!match) {
    const prefix = text && !text.endsWith('\n') ? '\n' : '';
    return `${text}${prefix}\n[tui]\n${value}\n`;
  }

  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const nextTable = rest.search(/^\[[^\]]+\][ \t]*\r?$/m);
  const end = nextTable < 0 ? text.length : start + nextTable;
  const block = text.slice(start, end);
  const statusLine = /^status_line[ \t]*=[^\r\n]*(?:\r?\n)?/m;
  const replacement = `${value}\n`;
  const updated = statusLine.test(block)
    ? block.replace(statusLine, replacement)
    : `\n${replacement}${block.replace(/^\r?\n/, '')}`;
  return text.slice(0, start) + updated + text.slice(end);
}

try {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  let current = '';
  try { current = fs.readFileSync(configPath, 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const updated = updateConfig(current);
  if (updated !== current) {
    const temporary = `${configPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, updated, { mode: 0o600 });
    fs.renameSync(temporary, configPath);
  }
  console.log('XCodexUsage: footer configured. Restart Codex or open a new session to apply it.');
} catch (error) {
  console.error(`XCodexUsage: could not configure ${configPath}: ${error.message}`);
  process.exitCode = 1;
}

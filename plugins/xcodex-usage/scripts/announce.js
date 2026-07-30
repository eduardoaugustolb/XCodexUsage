#!/usr/bin/env node
'use strict';

// SessionStart and Stop hook. Its output is always valid JSON, including when
// a transcript cannot be read; Codex requires that from Stop hooks.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const dataDir = path.join(os.homedir(), '.codex', 'data', 'xcodex-usage');
const snapshotsPath = path.join(dataDir, 'snapshots.json');

process.stdout.on('error', () => { process.exitCode = 0; });
process.stdin.on('error', () => { process.exitCode = 0; });
process.on('uncaughtException', () => { process.exit(0); });
process.on('unhandledRejection', () => { process.exit(0); });

function newestSnapshot(transcriptPath) {
  if (!transcriptPath) return null;
  let body;
  try { body = fs.readFileSync(transcriptPath, 'utf8'); } catch { return null; }

  let newest = null;
  for (const line of body.split('\n')) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'event_msg' || entry.payload?.type !== 'token_count') continue;
      const usage = entry.payload.info?.total_token_usage;
      if (!usage) continue;
      newest = {
        timestamp: entry.timestamp,
        usage,
        context_window: entry.payload.info?.model_context_window || null,
        rate_limits: entry.payload.rate_limits || null,
      };
    } catch {}
  }
  return newest;
}

function newestSavedSnapshot() {
  try {
    const state = JSON.parse(fs.readFileSync(snapshotsPath, 'utf8'));
    return Object.values(state.snapshots || {}).reduce((newest, snapshot) => (
      !newest || String(snapshot.timestamp) > String(newest.timestamp) ? snapshot : newest
    ), null);
  } catch {
    return null;
  }
}

function saveSnapshot(transcriptPath, snapshot) {
  if (!transcriptPath || !snapshot) return;
  try {
    let state;
    try { state = JSON.parse(fs.readFileSync(snapshotsPath, 'utf8')); } catch { state = { snapshots: {} }; }
    if (!state.snapshots || typeof state.snapshots !== 'object') state.snapshots = {};
    state.snapshots[transcriptPath] = { ...snapshot, recorded_at: new Date().toISOString() };
    fs.mkdirSync(dataDir, { recursive: true });
    const temp = `${snapshotsPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n');
    fs.renameSync(temp, snapshotsPath);
  } catch {
    // Persisting a cache must never interfere with a completed turn.
  }
}

function countdown(epoch) {
  const seconds = Math.max(0, Number(epoch) - Math.floor(Date.now() / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d${String(hours).padStart(2, '0')}h` : `${hours}h${String(minutes).padStart(2, '0')}m`;
}

function panel(snapshot) {
  const quota = snapshot.rate_limits?.primary;
  const quotaWindow = Number(quota?.window_minutes) || 0;
  const quotaText = quotaWindow ? `quota: ${Math.round(quotaWindow / 1440)}d ${Math.round(Number(quota.used_percent) || 0)}%` : 'quota: n/a';
  const resetText = quota?.resets_at ? `reset: ${countdown(quota.resets_at)}` : 'reset: n/a';
  const total = Number(snapshot.usage?.total_tokens) || 0;
  const contextWindow = Number(snapshot.context_window) || 0;
  const contextText = contextWindow ? `context: ${Math.min(100, Math.round(total / contextWindow * 100))}%` : 'context: n/a';
  const body = `${quotaText} | ${resetText} | ${contextText}`;
  const width = Math.max(52, body.length + 4);
  const line = `+${'-'.repeat(width - 2)}+`;
  // The TUI writes the hook label immediately before this message. Keep a
  // leading newline so the top border never shares the label's line.
  return ['', line, '| XCODEX USAGE'.padEnd(width - 1) + '|', `| ${body.padEnd(width - 4)} |`, line].join('\n');
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const hook = JSON.parse(input || '{}');
    const liveSnapshot = newestSnapshot(hook.transcript_path);
    const snapshot = liveSnapshot || newestSavedSnapshot();
    if (hook.hook_event_name === 'Stop') saveSnapshot(hook.transcript_path, liveSnapshot);
    process.stdout.write(JSON.stringify(snapshot ? { continue: true, systemMessage: panel(snapshot) } : { continue: true }));
  } catch {
    try { process.stdout.write(JSON.stringify({ continue: true })); } catch {}
  }
});

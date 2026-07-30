#!/usr/bin/env node
'use strict';

// Receives Codex hook JSON on stdin.  The transcript already contains the
// authoritative token_count events, so we only persist its newest snapshot.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const dataDir = path.join(os.homedir(), '.codex', 'data', 'xcodex-usage');
const snapshotsPath = path.join(dataDir, 'snapshots.json');

function newestSnapshot(transcriptPath) {
  if (!transcriptPath) return null;
  let body;
  try { body = fs.readFileSync(transcriptPath, 'utf8'); } catch { return null; }

  let newest = null;
  for (const line of body.split('\n')) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'event_msg' || entry.payload?.type !== 'token_count') continue;
      const info = entry.payload.info?.total_token_usage;
      if (!info) continue;
      newest = {
        timestamp: entry.timestamp,
        usage: info,
        context_window: entry.payload.info?.model_context_window || null,
        rate_limits: entry.payload.rate_limits || null,
      };
    } catch {}
  }
  return newest;
}

function atomicWrite(file, value) {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temp, file);
}

function countdown(epoch) {
  const seconds = Math.max(0, Number(epoch) - Math.floor(Date.now() / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d${String(hours).padStart(2, '0')}h` : `${hours}h${String(minutes).padStart(2, '0')}m`;
}

function stopMessage(snapshot) {
  const total = Number(snapshot.usage?.total_tokens) || 0;
  const contextWindow = Number(snapshot.context_window) || 0;
  const context = contextWindow ? `contexto:${Math.min(100, Math.round(total / contextWindow * 100))}%` : null;
  const quota = snapshot.rate_limits?.primary;
  const quotaWindow = Number(quota?.window_minutes) || 0;
  const quotaLabel = quotaWindow ? `cota:${Math.round(quotaWindow / 1440)}d ${Math.round(Number(quota.used_percent) || 0)}%` : null;
  const reset = quota?.resets_at ? `reset:${countdown(quota.resets_at)}` : null;
  return ['XCodexUsage', quotaLabel, reset, context].filter(Boolean).join(' · ');
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const hook = JSON.parse(input || '{}');
    const transcriptPath = hook.transcript_path;
    const snapshot = newestSnapshot(transcriptPath);
    if (!snapshot) return;

    fs.mkdirSync(dataDir, { recursive: true });
    let state = { snapshots: {} };
    try { state = JSON.parse(fs.readFileSync(snapshotsPath, 'utf8')); } catch {}
    if (!state || typeof state !== 'object') state = { snapshots: {} };
    if (!state.snapshots || typeof state.snapshots !== 'object') state.snapshots = {};
    state.snapshots[transcriptPath] = { ...snapshot, recorded_at: new Date().toISOString() };
    atomicWrite(snapshotsPath, state);

    // Stop hook output is rendered by Codex as a UI warning.  Do not emit it
    // for every tool call: PostToolUse runs too often for a useful status read.
    if (hook.hook_event_name === 'Stop') {
      process.stdout.write(JSON.stringify({ systemMessage: stopMessage(snapshot) }));
    }
  } catch {
    // Hooks must never interrupt a Codex turn.
  }
});

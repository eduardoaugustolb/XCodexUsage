#!/usr/bin/env node
'use strict';

// Receives Codex hook JSON on stdin. The transcript already contains the
// authoritative token_count events, so this hook only persists its newest
// snapshot. Rendering is deliberately handled by announce.js: persistence
// must never compete with a Stop hook that Codex is waiting to display.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const dataDir = path.join(os.homedir(), '.codex', 'data', 'xcodex-usage');
const snapshotsPath = path.join(dataDir, 'snapshots.json');

// Codex may finish consuming hook output while the process is flushing it.
// Treat a broken output pipe as a successful no-op; a telemetry hook must
// never make the agent turn fail.
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

function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(snapshotsPath, 'utf8'));
    return state && typeof state === 'object' ? state : { snapshots: {} };
  } catch {
    return { snapshots: {} };
  }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const hook = JSON.parse(input || '{}');
    const transcriptPath = hook.transcript_path;
    const liveSnapshot = newestSnapshot(transcriptPath);
    if (!liveSnapshot) return;
    const state = loadState();

    if (!state.snapshots || typeof state.snapshots !== 'object') state.snapshots = {};
    fs.mkdirSync(dataDir, { recursive: true });
    state.snapshots[transcriptPath] = { ...liveSnapshot, recorded_at: new Date().toISOString() };
    atomicWrite(snapshotsPath, state);
  } catch {
    // Hooks must never interrupt a Codex turn.
  }
});

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
      newest = { timestamp: entry.timestamp, usage: info, rate_limits: entry.payload.rate_limits || null };
    } catch {}
  }
  return newest;
}

function atomicWrite(file, value) {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temp, file);
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
  } catch {
    // Hooks must never interrupt a Codex turn.
  }
});

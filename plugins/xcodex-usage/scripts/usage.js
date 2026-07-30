#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const statePath = path.join(os.homedir(), '.codex', 'data', 'xcodex-usage', 'snapshots.json');

function formatTokens(value) {
  const n = Number(value) || 0;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function countdown(epoch) {
  const seconds = Math.max(0, Number(epoch) - Math.floor(Date.now() / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d${String(hours).padStart(2, '0')}h` : `${hours}h${String(minutes).padStart(2, '0')}m`;
}

let state;
try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {
  console.log('XCodexUsage: nenhum snapshot ainda. Termine uma interação do Codex primeiro.');
  process.exit(0);
}

const snapshots = Object.values(state.snapshots || {});
if (!snapshots.length) {
  console.log('XCodexUsage: nenhum snapshot ainda.');
  process.exit(0);
}

const totals = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 };
let latest = null;
for (const snapshot of snapshots) {
  for (const key of Object.keys(totals)) totals[key] += Number(snapshot.usage?.[key]) || 0;
  if (!latest || String(snapshot.timestamp) > String(latest.timestamp)) latest = snapshot;
}

const quota = latest?.rate_limits?.primary;
const percent = quota?.used_percent;
const filled = Number.isFinite(percent) ? Math.min(10, Math.floor(percent / 10)) : 0;
const bar = `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
const reset = quota?.resets_at ? ` · reinicia:${countdown(quota.resets_at)}` : '';

console.log([
  `Codex │ ${bar} ${Number.isFinite(percent) ? `${Math.round(percent)}%` : 'quota indisponível'}${reset}`,
  `sessões:${snapshots.length}`,
  `entrada:${formatTokens(totals.input_tokens)}`,
  `cache:${formatTokens(totals.cached_input_tokens)}`,
  `saída:${formatTokens(totals.output_tokens)}`,
  `raciocínio:${formatTokens(totals.reasoning_output_tokens)}`,
].join(' │ '));

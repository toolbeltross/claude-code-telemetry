#!/usr/bin/env node
/**
 * Progress Tracker — appends timestamped session stats to docs/supervisory-log.md
 *
 * Called by the Stop hook after each Claude response.
 * Reads stdin JSON + fetches /api/snapshot for session stats.
 * Appends a one-line summary: timestamp, session ID, turn, cost, context %.
 *
 * Usage: node progress-tracker.js "$CLAUDE_SESSION_ID"
 * Stdin: JSON from Claude Code Stop hook
 */

import { readFile, appendFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const LOG_PATH = resolve(PROJECT_ROOT, 'docs', 'supervisory-log.md');
import { apiUrl } from '../server/config.js';
const SNAPSHOT_URL = apiUrl('/api/snapshot');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    // If no stdin after 500ms, resolve with empty
    setTimeout(() => resolve(data), 500);
  });
}

async function main() {
  const sessionIdArg = process.argv[2] || '';

  // Read stdin JSON from Stop hook
  const raw = await readStdin();
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch {}
  const sessionId = (sessionIdArg && !sessionIdArg.startsWith('$') ? sessionIdArg : parsed.session_id) || 'unknown';

  // Fetch live session stats from telemetry server
  let liveData = null;
  try {
    const resp = await fetch(SNAPSHOT_URL);
    if (resp.ok) {
      const snapshot = await resp.json();
      // Find the live session matching this session ID
      if (snapshot.liveSessions?.[sessionId]) {
        liveData = snapshot.liveSessions[sessionId];
      }
    }
  } catch {
    // Server may not be running — that's OK, we still log what we can
  }

  // Build log entry
  const now = new Date();
  const ts = now.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const sid = sessionId.slice(0, 8);
  const turn = liveData?._turnCount ?? '?';
  const cost = liveData?.cost?.total_cost_usd?.toFixed(2) ?? '?';
  const ctxPct = liveData?.context_window?.used_percentage ?? '?';
  const model = liveData?.model?.display_name || liveData?.model?.id || '?';
  const toolCount = liveData?._toolCount ?? '?';

  const entry = `\n- **${ts}** | \`${sid}\` | Turn ${turn} | $${cost} | Context ${ctxPct}% | ${model} | ${toolCount} tools`;

  // Append to supervisory log
  try {
    await appendFile(LOG_PATH, entry + '\n', 'utf-8');
  } catch (err) {
    // Log file may not exist yet — create it with header
    if (err.code === 'ENOENT') {
      const header = `# Supervisory Agent Log\n\nAppend-only log of supervisory agent findings.\n\n---\n\n## Session Progress\n`;
      try {
        const { mkdir } = await import('fs/promises');
        await mkdir(dirname(LOG_PATH), { recursive: true });
        await appendFile(LOG_PATH, header + entry + '\n', 'utf-8');
      } catch {}
    }
  }
}

main().catch(() => process.exit(0));  // Never fail — don't block Claude

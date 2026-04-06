#!/usr/bin/env node
/**
 * Enhanced Claude Code Statusline
 * ================================
 * 2-line status bar with context tracking, cost, agents, git, and session info.
 * Forwards data to telemetry server, then outputs formatted ANSI lines.
 *
 * Line 1: [Model] [Context Bar %%] [Cost] [Duration] [Lines +/-]
 * Line 2: [Session] [Agent] [Git Branch] [Working Dir]
 *
 * Context bar is color-coded by threshold:
 *   Green  < 50%  |  Yellow 50-69%  |  Red 70-89%  |  Blinking Red 90%+
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { BASE_URL, STATUSLINE_TIMEOUT_MS, DEFAULT_CONTEXT_WINDOW_SIZE, IDLE_MARKER_PATH, resolveContextWindowSize } from '../server/config.js';

const TIMEOUT = STATUSLINE_TIMEOUT_MS;

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  blink:   '\x1b[5m',
  // Foreground
  black:   '\x1b[30m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
  // Bright foreground
  bRed:    '\x1b[91m',
  bGreen:  '\x1b[92m',
  bYellow: '\x1b[93m',
  bBlue:   '\x1b[94m',
  bCyan:   '\x1b[96m',
  bWhite:  '\x1b[97m',
  // Background
  bgRed:   '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow:'\x1b[43m',
};

// ── Read stdin ────────────────────────────────────────────────────────────────
function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    setTimeout(() => resolve(data), 2000);
  });
}

// ── Fire-and-forget POST to telemetry server ─────────────────────────────────
function postTelemetry(payload) {
  try {
    const body = JSON.stringify(payload);
    const req = http.request(
      `${BASE_URL}/api/status`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: TIMEOUT },
      (res) => res.resume()
    );
    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
    req.write(body);
    req.end();
  } catch {}
}

// ── Formatting helpers ───────────────────────────────────────────────────────
function contextBar(pct, width = 20) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = Math.round(p * width / 100);
  const empty = width - filled;

  let color;
  if (p >= 90)      color = `${C.blink}${C.bRed}`;
  else if (p >= 70) color = C.red;
  else if (p >= 50) color = C.yellow;
  else              color = C.green;

  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
  return `${color}${bar}${C.reset} ${color}${p}%${C.reset}`;
}

function formatCost(usd) {
  if (usd == null || usd === 0) return `${C.dim}$0.00${C.reset}`;
  if (usd < 0.01) return `${C.green}<$0.01${C.reset}`;
  if (usd < 1)    return `${C.green}$${usd.toFixed(2)}${C.reset}`;
  if (usd < 5)    return `${C.yellow}$${usd.toFixed(2)}${C.reset}`;
  return `${C.red}$${usd.toFixed(2)}${C.reset}`;
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

function formatLines(added, removed) {
  const parts = [];
  if (added > 0)   parts.push(`${C.green}+${added}${C.reset}`);
  if (removed > 0) parts.push(`${C.red}-${removed}${C.reset}`);
  return parts.length ? parts.join('/') : '';
}

function formatTokens(n) {
  if (!n || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function shortSessionId(id) {
  if (!id) return '';
  return id.slice(0, 8);
}

function shortenPath(p, maxLen = 30) {
  if (!p) return '';
  // Normalize separators
  p = p.replace(/\\/g, '/');
  if (p.length <= maxLen) return p;
  const parts = p.split('/');
  if (parts.length <= 2) return '...' + p.slice(-maxLen + 3);
  // Keep first and last segments, abbreviate middle
  const first = parts[0] || parts[1];
  const last = parts[parts.length - 1];
  return `${first}/.../${last}`;
}

function modelBadge(name, id) {
  const display = name || id || '?';
  if (id?.includes('opus'))   return `${C.bold}${C.magenta}${display}${C.reset}`;
  if (id?.includes('sonnet')) return `${C.bold}${C.bCyan}${display}${C.reset}`;
  if (id?.includes('haiku'))  return `${C.bold}${C.bGreen}${display}${C.reset}`;
  return `${C.bold}${C.white}${display}${C.reset}`;
}

function contextSizeLabel(size) {
  if (!size) return '200K';
  const k = Math.round(size / 1000);
  if (k >= 1000) return `${(k / 1000).toFixed(0)}M`;
  return `${k}K`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const raw = await readStdin();

try {
  const d = JSON.parse(raw);

  // Forward to telemetry (non-blocking)
  postTelemetry(d);

  // ── Extract fields ────────────────────────────────────────────────────────
  const model      = d.model?.display_name || '';
  const modelId    = d.model?.id || '';
  const cost       = d.cost?.total_cost_usd ?? 0;
  const durationMs = d.cost?.total_duration_ms ?? 0;
  const apiMs      = d.cost?.total_api_duration_ms ?? 0;
  const linesAdd   = d.cost?.total_lines_added ?? 0;
  const linesRm    = d.cost?.total_lines_removed ?? 0;
  const ctxPct     = d.context_window?.used_percentage ?? 0;
  const modelName  = d.model?.display_name || '';
  const ctxSize    = resolveContextWindowSize(d.context_window?.context_window_size, modelName);
  const inTokens   = d.context_window?.total_input_tokens ?? 0;
  const outTokens  = d.context_window?.total_output_tokens ?? 0;
  const curIn      = d.context_window?.current_usage?.input_tokens ?? 0;
  const curOut     = d.context_window?.current_usage?.output_tokens ?? 0;
  const cacheRead  = d.context_window?.current_usage?.cache_read_input_tokens ?? 0;
  const cacheWrite = d.context_window?.current_usage?.cache_creation_input_tokens ?? 0;
  const sessionId  = d.session_id || '';
  const agentName  = d.agent?.name || '';
  const vimMode    = d.vim?.mode || '';
  const cwd        = d.workspace?.current_dir || d.cwd || '';
  const version    = d.version || '';
  const over200k   = d.exceeds_200k_tokens ?? false;

  // ── Idle detection: check if Stop hook wrote a marker for this session ───
  let isIdle = false;
  try {
    const marker = readFileSync(IDLE_MARKER_PATH, 'utf-8').trim();
    isIdle = !sessionId || marker === sessionId;
  } catch {}

  // ── LINE 1: Model | Context | Cost | Duration | Lines ────────────────────
  const parts1 = [];

  // Idle/waiting indicator
  if (isIdle) parts1.push(`${C.bYellow}\u23F8 WAITING${C.reset}`);

  // Model badge
  parts1.push(modelBadge(model, modelId));

  // Context bar with token count
  const ctxLabel = `${C.dim}ctx${C.reset}`;
  const tokenInfo = `${C.dim}${formatTokens(inTokens + outTokens)}/${contextSizeLabel(ctxSize)}${C.reset}`;
  parts1.push(`${ctxLabel} ${contextBar(ctxPct)} ${tokenInfo}`);

  // Cost
  parts1.push(formatCost(cost));

  // Duration
  const dur = formatDuration(durationMs);
  if (dur) parts1.push(`${C.dim}${dur}${C.reset}`);

  // Lines changed
  const lines = formatLines(linesAdd, linesRm);
  if (lines) parts1.push(lines);

  // Over 200K warning
  if (over200k) parts1.push(`${C.blink}${C.bgRed}${C.bWhite} EXTENDED ${C.reset}`);

  // ── LINE 2: Session | Agent | Vim | Cache | Dir ──────────────────────────
  const parts2 = [];

  // Session ID
  const sid = shortSessionId(sessionId);
  if (sid) parts2.push(`${C.dim}sid:${sid}${C.reset}`);

  // Agent name
  if (agentName) parts2.push(`${C.bCyan}agent:${agentName}${C.reset}`);

  // Vim mode
  if (vimMode) {
    const vColor = vimMode === 'NORMAL' ? C.blue : C.green;
    parts2.push(`${vColor}${vimMode}${C.reset}`);
  }

  // Cache efficiency (if we have cache data)
  if (cacheRead > 0 || cacheWrite > 0) {
    const totalCache = cacheRead + cacheWrite;
    const totalInput = curIn + cacheRead + cacheWrite;
    const cacheRatio = totalInput > 0 ? Math.round((cacheRead / totalInput) * 100) : 0;
    parts2.push(`${C.dim}cache:${cacheRatio}%${C.reset}`);
  }

  // API time ratio (what % of wall clock was API calls)
  if (apiMs > 0 && durationMs > 0) {
    const apiRatio = Math.round((apiMs / durationMs) * 100);
    parts2.push(`${C.dim}api:${apiRatio}%${C.reset}`);
  }

  // Version
  if (version) parts2.push(`${C.dim}v${version}${C.reset}`);

  // Working directory (shortened)
  if (cwd) parts2.push(`${C.dim}${shortenPath(cwd)}${C.reset}`);

  // ── Output ────────────────────────────────────────────────────────────────
  const line1 = parts1.join(`${C.dim} | ${C.reset}`);
  const line2 = parts2.join(`${C.dim} | ${C.reset}`);

  process.stdout.write(line1 + '\n' + line2);

} catch {
  // Fallback: minimal output
  process.stdout.write('Claude Code');
}

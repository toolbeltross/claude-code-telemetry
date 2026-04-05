/**
 * Centralized configuration for claude-code-telemetry.
 *
 * All hardcoded values live here. Import named constants from this module
 * instead of scattering magic numbers across the codebase.
 *
 * Environment variable overrides are applied where noted.
 */
import { join } from 'path';
import { homedir } from 'os';

// ── Server ───────────────────────────────────────────────────────────────────

export const PORT = parseInt(process.env.CLAUDE_TELEMETRY_PORT || process.env.PORT, 10) || 7890;
export const BASE_URL = `http://localhost:${PORT}`;
export const WS_URL = `ws://localhost:${PORT}/ws`;
export const VITE_DEV_PORT = 5173;

// ── File Paths ───────────────────────────────────────────────────────────────

const HOME = process.env.HOME || process.env.USERPROFILE || homedir();

export const CLAUDE_JSON_PATH = join(HOME, '.claude.json');
export const STATS_CACHE_PATH = join(HOME, '.claude', 'stats-cache.json');
export const CREDENTIALS_PATH = join(HOME, '.claude', '.credentials.json');

// ── Limits ───────────────────────────────────────────────────────────────────

export const MAX_TOOL_EVENTS = 200;
export const MAX_TURN_HISTORY = 50;
export const MAX_SUBAGENT_HISTORY = 50;
export const MAX_PROMPT_HISTORY = 10;
export const MAX_CONTEXT_HISTORY = 20;
export const DEFAULT_CONTEXT_WINDOW_SIZE = 200_000;

// ── Pruning ──────────────────────────────────────────────────────────────────

/** Stale session prune threshold (idle terminals may still be live) */
export const STALE_SESSION_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Force-refresh prune threshold (aggressive, for manual refresh button) */
export const FORCE_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

// ── Polling / Timing ─────────────────────────────────────────────────────────

/** chokidar polling interval for .claude.json / stats-cache.json */
export const FILE_POLL_INTERVAL_MS = 3000;

/** chokidar awaitWriteFinish stabilityThreshold */
export const WRITE_STABILITY_MS = 1000;

/** chokidar awaitWriteFinish pollInterval */
export const WRITE_POLL_MS = 500;

/** WebSocket heartbeat ping interval */
export const WS_HEARTBEAT_MS = 30_000;

/** Statusline POST timeout */
export const STATUSLINE_TIMEOUT_MS = 1200;

/** Hook forwarder POST timeout */
export const HOOK_FORWARDER_TIMEOUT_MS = 1500;

// ── Plan Detector ────────────────────────────────────────────────────────────

/** How often to re-read credentials file */
export const CREDENTIALS_POLL_MS = 5 * 60 * 1000;

/** How often to poll the Anthropic usage API */
export const USAGE_POLL_MS = 60 * 1000;

/** Maximum backoff for usage polling on errors */
export const MAX_POLL_INTERVAL_MS = 5 * 60 * 1000;

/** Claude Code OAuth client ID (public, not a secret) */
export const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

// ── Failure Store ────────────────────────────────────────────────────────────

/** Persistent JSONL log of tool failures, validation blocks, and bash errors */
export const FAILURE_LOG_PATH = join(HOME, '.claude', 'telemetry-failures.jsonl');

/** Maximum failure records kept in memory (tail of the JSONL file) */
export const MAX_FAILURE_CACHE = 1000;

/** Maximum results returned by failure query endpoints */
export const MAX_FAILURE_QUERY_RESULTS = 200;

// ── Idle Detection ───────────────────────────────────────────────────────────

/** Marker file written by Stop hook, read by statusline, cleared by UserPromptSubmit */
export const IDLE_MARKER_PATH = join(HOME, '.claude', '.telemetry-idle');

// ── Convenience helpers ──────────────────────────────────────────────────────

export function apiUrl(path = '') {
  return `${BASE_URL}${path}`;
}

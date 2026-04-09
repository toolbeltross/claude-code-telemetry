import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { FAILURE_LOG_PATH, MAX_FAILURE_CACHE, MAX_FAILURE_QUERY_RESULTS } from './config.js';

/**
 * Persistent failure store backed by a JSONL file.
 *
 * - Append-only writes (safe on Windows/OneDrive)
 * - In-memory cache of the last N records for fast queries
 * - Loaded from disk on server start so data survives restarts
 */
export class FailureStore {
  constructor(filePath = FAILURE_LOG_PATH) {
    this.filePath = filePath;
    this.cache = []; // most recent last
    this.maxCache = MAX_FAILURE_CACHE;
    /** @type {((record: object) => void) | null} */
    this.onAppend = null; // callback for store integration
  }

  /** Load existing JSONL file into memory cache */
  load() {
    if (!existsSync(this.filePath)) {
      console.log(`[failure-store] No existing file at ${this.filePath} — starting fresh`);
      return;
    }
    try {
      const content = readFileSync(this.filePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          this.cache.push(JSON.parse(line));
        } catch {
          // skip malformed lines
        }
      }
      // Keep only the tail
      if (this.cache.length > this.maxCache) {
        this.cache = this.cache.slice(-this.maxCache);
      }
      console.log(`[failure-store] Loaded ${this.cache.length} failure records`);
    } catch (err) {
      console.error(`[failure-store] Error loading: ${err.message}`);
    }
  }

  /** Append a failure record to JSONL and in-memory cache */
  append({ sessionId, toolName, eventType, error, toolInput, cwd }) {
    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      isoTime: new Date().toISOString(),
      sessionId: sessionId || '',
      toolName: toolName || 'unknown',
      eventType: eventType || 'post_tool_use_failure',
      error: typeof error === 'string' ? error.slice(0, 2000) : String(error || 'Unknown error'),
      toolInput: toolInput ?? null,
      cwd: cwd || '',
    };

    // Persist to disk
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      appendFileSync(this.filePath, JSON.stringify(record) + '\n', 'utf-8');
    } catch (err) {
      console.error(`[failure-store] Write error: ${err.message}`);
    }

    // Update cache
    this.cache.push(record);
    if (this.cache.length > this.maxCache) {
      this.cache = this.cache.slice(-this.maxCache);
    }

    // Notify listener (store.js emits event)
    if (this.onAppend) this.onAppend(record);

    return record;
  }

  /** Query failures with optional filters */
  query({ sessionId, toolName, since, limit } = {}) {
    let results = this.cache;

    if (sessionId) {
      results = results.filter(r => r.sessionId === sessionId);
    }
    if (toolName) {
      results = results.filter(r => r.toolName === toolName);
    }
    if (since) {
      results = results.filter(r => r.timestamp >= since);
    }

    // Most recent first
    results = [...results].reverse();

    const max = Math.min(limit || MAX_FAILURE_QUERY_RESULTS, MAX_FAILURE_QUERY_RESULTS);
    return results.slice(0, max);
  }

  /** Frequency analysis across cached failures */
  getPatterns() {
    const byTool = {};
    const byError = {};
    const bySession = {};

    for (const r of this.cache) {
      byTool[r.toolName] = (byTool[r.toolName] || 0) + 1;

      // Normalize error messages (first 100 chars) for grouping
      const errKey = (r.error || '').slice(0, 100);
      if (errKey) {
        byError[errKey] = (byError[errKey] || 0) + 1;
      }

      if (r.sessionId) {
        bySession[r.sessionId] = (bySession[r.sessionId] || 0) + 1;
      }
    }

    return {
      byTool,
      byError,
      bySession,
      total: this.cache.length,
    };
  }

  /** Summary digest for a time period */
  getDigest(since = Date.now() - 24 * 60 * 60 * 1000) {
    const recent = this.cache.filter(r => r.timestamp >= since);
    const sessions = new Set(recent.map(r => r.sessionId).filter(Boolean));

    // Top failing tool
    const toolCounts = {};
    for (const r of recent) {
      toolCounts[r.toolName] = (toolCounts[r.toolName] || 0) + 1;
    }
    const topTool = Object.entries(toolCounts).sort((a, b) => b[1] - a[1])[0] || null;

    // Top error
    const errCounts = {};
    for (const r of recent) {
      const key = (r.error || '').slice(0, 100);
      if (key) errCounts[key] = (errCounts[key] || 0) + 1;
    }
    const topError = Object.entries(errCounts).sort((a, b) => b[1] - a[1])[0] || null;

    return {
      since: new Date(since).toISOString(),
      totalFailures: recent.length,
      uniqueSessions: sessions.size,
      topFailingTool: topTool ? { name: topTool[0], count: topTool[1] } : null,
      topError: topError ? { message: topError[0], count: topError[1] } : null,
      byTool: toolCounts,
      recentFailures: recent.slice(-10).reverse(),
    };
  }

  /** Get the N most recent failures */
  getRecentFailures(n = 20) {
    return this.cache.slice(-n).reverse();
  }
}
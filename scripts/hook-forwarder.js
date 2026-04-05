#!/usr/bin/env node
/**
 * Hook forwarder — reads JSON from stdin, POSTs to telemetry server.
 * Works cross-platform (no curl/jq/bash dependency).
 *
 * Usage:
 *   StatusLine:  echo '{"model":...}' | node hook-forwarder.js status
 *   ToolEvent:   node hook-forwarder.js tool <tool_name> <session_id> [event_type]
 */
import http from 'http';
import { appendFileSync, readFileSync, writeFileSync, unlinkSync, openSync, fstatSync, readSync, closeSync, mkdirSync } from 'fs';
import { appendFile } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { BASE_URL, HOOK_FORWARDER_TIMEOUT_MS, DEFAULT_CONTEXT_WINDOW_SIZE, IDLE_MARKER_PATH, apiUrl } from '../server/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const LOG_FILE = join(PROJECT_ROOT, 'hook-debug.log');
const SUPERVISORY_LOG_PATH = resolve(PROJECT_ROOT, 'docs', 'supervisory-log.md');
const SNAPSHOT_URL = apiUrl('/api/snapshot');
const TIMEOUT = HOOK_FORWARDER_TIMEOUT_MS;

function debugLog(msg) {
  try { appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

function post(path, data) {
  return new Promise((resolve) => {
    const body = JSON.stringify(data);
    const req = http.request(
      `${BASE_URL}${path}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: TIMEOUT },
      (res) => { res.resume(); resolve(); }
    );
    req.on('error', () => resolve()); // silently fail if server not running
    req.on('timeout', () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve) => {
    const req = http.request(
      `${BASE_URL}${path}`,
      { method: 'GET', timeout: TIMEOUT },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

/** Append a one-line progress entry to docs/supervisory-log.md (absorbed from progress-tracker.js) */
async function appendProgressEntry(sessionId) {
  try {
    const snapshot = await get('/api/snapshot');
    if (!snapshot) return;
    const liveData = snapshot.liveSessions?.[sessionId];
    const now = new Date();
    const ts = now.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    const sid = (sessionId || 'unknown').slice(0, 8);
    const turn = liveData?._turnCount ?? '?';
    const cost = liveData?.cost?.total_cost_usd?.toFixed(2) ?? '?';
    const ctxPct = liveData?.context_window?.used_percentage ?? '?';
    const model = liveData?.model?.display_name || liveData?.model?.id || '?';
    const toolCount = liveData?._toolCount ?? '?';
    const entry = `\n- **${ts}** | \`${sid}\` | Turn ${turn} | $${cost} | Context ${ctxPct}% | ${model} | ${toolCount} tools`;
    try {
      await appendFile(SUPERVISORY_LOG_PATH, entry + '\n', 'utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        const header = `# Supervisory Agent Log\n\nAppend-only log of supervisory agent findings.\n\n---\n\n## Session Progress\n`;
        try {
          mkdirSync(dirname(SUPERVISORY_LOG_PATH), { recursive: true });
          await appendFile(SUPERVISORY_LOG_PATH, header + entry + '\n', 'utf-8');
        } catch {}
      }
    }
    debugLog(`progress-entry: ${sid} turn=${turn} cost=$${cost} ctx=${ctxPct}%`);
  } catch (e) {
    debugLog(`progress-entry error: ${e.message}`);
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    // Timeout in case stdin never closes
    setTimeout(() => resolve(data), 2000);
  });
}

/** Read the tail of a file (last N bytes) efficiently without reading the entire file */
function readTail(filePath, maxBytes = 65536) {
  const fd = openSync(filePath, 'r');
  try {
    const stat = fstatSync(fd);
    const fileSize = stat.size;
    const readStart = Math.max(0, fileSize - maxBytes);
    const readLength = fileSize - readStart;
    const buf = Buffer.alloc(readLength);
    readSync(fd, buf, 0, readLength, readStart);
    return { content: buf.toString('utf-8'), isPartial: readStart > 0 };
  } finally {
    closeSync(fd);
  }
}

/**
 * Parse transcript JSONL to extract token usage, model, and cost.
 * Optimized: reads only the last 64KB of the file. For context window and model,
 * the last usage entry is sufficient. For cost, sums all usage entries in the tail
 * chunk (accurate for most sessions; statusLine provides authoritative cost data
 * in environments that support it).
 */
function parseTranscript(transcriptPath) {
  if (!transcriptPath) return null;
  try {
    const startMs = Date.now();
    const { content, isPartial } = readTail(transcriptPath);
    const lines = content.split('\n');
    let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0;
    let lastInput = 0, lastOutput = 0, lastCacheRead = 0, lastCacheWrite = 0;
    let model = '', modelId = '';
    const modelCosts = {}; // model -> { input, output, cacheRead, cacheWrite }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      let entry;
      // First line of a partial read may be truncated — skip parse failures
      try { entry = JSON.parse(line); } catch { continue; }
      const msg = entry.message;
      if (!msg || !msg.usage) continue;
      const u = msg.usage;
      const inp = u.input_tokens || 0;
      const out = u.output_tokens || 0;
      const cr = u.cache_read_input_tokens || 0;
      const cw = u.cache_creation_input_tokens || 0;
      totalInput += inp;
      totalOutput += out;
      totalCacheRead += cr;
      totalCacheWrite += cw;
      // Track last message's usage (= current context window fill)
      lastInput = inp; lastOutput = out; lastCacheRead = cr; lastCacheWrite = cw;
      if (msg.model) {
        modelId = msg.model;
        if (modelId.includes('opus')) model = 'Opus';
        else if (modelId.includes('sonnet')) model = 'Sonnet';
        else if (modelId.includes('haiku')) model = 'Haiku';
        else model = modelId;
        if (!modelCosts[modelId]) modelCosts[modelId] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, count: 0 };
        modelCosts[modelId].input += inp;
        modelCosts[modelId].output += out;
        modelCosts[modelId].cacheRead += cr;
        modelCosts[modelId].cacheWrite += cw;
        modelCosts[modelId].count++;
      }
    }

    // Estimate cost (rough per-model pricing per 1M tokens)
    const pricing = {
      opus: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
      sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      haiku: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    };
    let totalCost = 0;
    for (const [mid, usage] of Object.entries(modelCosts)) {
      const tier = mid.includes('opus') ? 'opus' : mid.includes('sonnet') ? 'sonnet' : mid.includes('haiku') ? 'haiku' : 'sonnet';
      const p = pricing[tier];
      totalCost += (usage.input / 1e6) * p.input + (usage.output / 1e6) * p.output +
                   (usage.cacheRead / 1e6) * p.cacheRead + (usage.cacheWrite / 1e6) * p.cacheWrite;
    }

    const contextSize = DEFAULT_CONTEXT_WINDOW_SIZE;
    // Context fill = last API call's input side (what was sent to the model)
    const lastContextUsed = lastInput + lastCacheRead + lastCacheWrite;
    const fillPct = Math.min(100, Math.round(lastContextUsed / contextSize * 100));

    const elapsed = Date.now() - startMs;
    debugLog(`transcript parse: ${elapsed}ms, partial=${isPartial}, lines=${lines.length}`);

    return {
      model: { id: modelId, display_name: model },
      cost: { total_cost_usd: Math.round(totalCost * 10000) / 10000 },
      context_window: {
        total_input_tokens: lastContextUsed,
        total_output_tokens: totalOutput,
        context_window_size: contextSize,
        used_percentage: fillPct,
        current_usage: {
          input_tokens: totalInput,
          output_tokens: totalOutput,
          cache_read_input_tokens: totalCacheRead,
          cache_creation_input_tokens: totalCacheWrite,
        },
      },
      _modelCosts: modelCosts,
      _partial: isPartial,
    };
  } catch (e) {
    debugLog(`transcript parse error: ${e.message}`);
    return null;
  }
}

const mode = process.argv[2];

debugLog(`mode=${mode} args=${process.argv.slice(3).join(' ')}`);

if (mode === 'status') {
  // StatusLine: read JSON from stdin, forward to /api/status, output formatted line
  const raw = await readStdin();
  debugLog(`status raw length=${raw.length} snippet=${raw.slice(0, 200)}`);
  try {
    const input = JSON.parse(raw);
    // Fire POST and GET in parallel — snapshot gives us turns, velocity, agents
    const [, snapshot] = await Promise.all([
      post('/api/status', input),
      get('/api/snapshot').catch(() => null),
    ]);
    const sessionId = input.session_id || '';
    const live = snapshot?.liveSessions?.[sessionId] || {};

    // Output formatted status line for Claude Code
    // -- Extract data from statusline JSON --
    const modelFull = input.model?.display_name || '?';
    const model = modelFull.replace(/\s*\(.*\)/, '');  // "Opus 4.6 (1M context)" → "Opus 4.6"
    const cost = (input.cost?.total_cost_usd || 0).toFixed(2);
    const ctxPct = Math.round(input.context_window?.used_percentage || 0);
    const ctxWindowSize = input.context_window?.context_window_size || DEFAULT_CONTEXT_WINDOW_SIZE;
    const ctxSizeK = Math.round(ctxWindowSize / 1000);
    const curUsage = input.context_window?.current_usage;
    const inputTokens = curUsage?.input_tokens || 0;
    const cacheRead = curUsage?.cache_read_input_tokens || 0;
    const cacheWrite = curUsage?.cache_creation_input_tokens || 0;
    const usedTokensK = Math.round((inputTokens + cacheRead + cacheWrite) / 1000);
    const cwd = input.workspace?.current_dir || '';
    const dirName = cwd.split(/[/\\]/).filter(Boolean).pop() || '';
    const durationMs = input.cost?.total_duration_ms || 0;
    const mins = Math.floor(durationMs / 60000);
    const secs = Math.floor((durationMs % 60000) / 1000);
    const linesAdded = input.cost?.total_lines_added || 0;
    const linesRemoved = input.cost?.total_lines_removed || 0;
    const exceeds200k = input.exceeds_200k_tokens || false;

    // -- Extract enriched data from telemetry snapshot --
    const turnCount = live._turnCount || 0;
    const tokensPerTurn = live._tokensPerTurn || 0;
    const estTurnsLeft = live._estimatedTurnsRemaining || (tokensPerTurn > 0 ? Math.floor((ctxWindowSize - usedTokensK * 1000) / tokensPerTurn) : 0);
    const toolCount = live._toolCount || 0;
    const lastTool = live._lastTool || '';
    const activeAgents = live._activeSubagents ? Object.keys(live._activeSubagents).length : 0;
    const agentNames = live._activeSubagents ? Object.values(live._activeSubagents).map(a => a.type || a.description || '?').join(', ') : '';
    const compactCount = live._compactEvents?.length || 0;

    // Cache hit ratio from current usage
    const totalCacheTokens = cacheRead + cacheWrite;
    const cacheHitPct = totalCacheTokens > 0 ? Math.round(cacheRead / totalCacheTokens * 100) : 0;

    // Git branch (fast fail, 500ms timeout)
    let branch = '';
    try {
      const { execSync } = await import('child_process');
      branch = execSync('git branch --show-current 2>/dev/null', { cwd: cwd || undefined, timeout: 500, encoding: 'utf-8' }).trim();
    } catch {}

    // Worktree indicator
    const worktree = input.worktree?.name || '';

    // -- ANSI palette --
    const RST = '\x1b[0m';
    const BOLD = '\x1b[1m';
    const DIM = '\x1b[2m';
    const CYAN = '\x1b[36m';
    const GREEN = '\x1b[32m';
    const YELLOW = '\x1b[33m';
    const RED = '\x1b[31m';
    const MAGENTA = '\x1b[35m';
    const WHITE = '\x1b[37m';
    const BLUE = '\x1b[34m';

    // -- Context bar: 25 chars, smooth unicode, tri-color zones --
    const barWidth = 25;
    const filled = Math.round(ctxPct * barWidth / 100);
    const greenZone = Math.round(barWidth * 0.7);
    const yellowZone = Math.round(barWidth * 0.9);
    let bar = '';
    for (let i = 0; i < barWidth; i++) {
      if (i < filled) {
        const color = i < greenZone ? GREEN : i < yellowZone ? YELLOW : RED;
        bar += `${color}━${RST}`;
      } else {
        bar += `${DIM}─${RST}`;
      }
    }
    const ctxColor = ctxPct >= 90 ? RED : ctxPct >= 70 ? YELLOW : GREEN;
    const ctxWarn = ctxPct >= 90 ? `${RED}!!${RST} ` : ctxPct >= 70 ? `${YELLOW}! ${RST} ` : '   ';

    // -- Line 1: Model | Cost | Duration | Git | Dir | Lines --
    let line1 = `${BOLD}${CYAN}${model}${RST}`;
    line1 += ` ${DIM}|${RST} ${GREEN}$${cost}${RST}`;
    line1 += ` ${DIM}|${RST} ${DIM}${mins}m${secs}s${RST}`;
    if (branch) line1 += ` ${DIM}|${RST} ${MAGENTA}${branch}${RST}`;
    if (worktree) line1 += ` ${DIM}[wt:${worktree}]${RST}`;
    if (dirName && dirName !== 'rossb') line1 += ` ${DIM}|${RST} ${WHITE}${dirName}${RST}`;
    if (linesAdded || linesRemoved) line1 += ` ${GREEN}+${linesAdded}${RST}${RED}-${linesRemoved}${RST}`;
    process.stdout.write(line1 + '\n');

    // -- Line 2: Context bar + tokens + est turns + cache --
    let line2 = `${ctxWarn}${bar} ${ctxColor}${BOLD}${ctxPct}%${RST}`;
    line2 += ` ${DIM}${usedTokensK}K/${ctxSizeK}K${RST}`;
    if (estTurnsLeft > 0) {
      const turnsColor = estTurnsLeft <= 3 ? RED : estTurnsLeft <= 8 ? YELLOW : GREEN;
      line2 += ` ${DIM}|${RST} ${turnsColor}~${estTurnsLeft} turns left${RST}`;
    }
    if (cacheHitPct > 0) line2 += ` ${DIM}| cache ${cacheHitPct}%${RST}`;
    if (exceeds200k) line2 += ` ${RED}${BOLD}[EXT]${RST}`;
    if (compactCount > 0) line2 += ` ${DIM}[${compactCount}x compact]${RST}`;
    process.stdout.write(line2 + '\n');

    // -- Line 3 (conditional): Agents + Turn velocity + Tools --
    let line3parts = [];
    if (turnCount > 0) line3parts.push(`${DIM}T${turnCount}${RST}`);
    if (tokensPerTurn > 0) line3parts.push(`${DIM}${Math.round(tokensPerTurn / 1000)}K/turn${RST}`);
    if (toolCount > 0) line3parts.push(`${BLUE}${toolCount} tools${RST}${lastTool ? ` ${DIM}(${lastTool})${RST}` : ''}`);
    if (activeAgents > 0) line3parts.push(`${CYAN}${BOLD}${activeAgents} agent${activeAgents > 1 ? 's' : ''}${RST}${agentNames ? ` ${DIM}(${agentNames})${RST}` : ''}`);
    if (line3parts.length > 0) process.stdout.write(line3parts.join(` ${DIM}|${RST} `) + '\n');
  } catch {
    process.stdout.write('Claude Code');
  }
} else if (mode === 'tool') {
  // PostToolUse: forward tool event
  // CLI args from env vars may not expand on Windows, so fall back to stdin JSON
  const argToolName = process.argv[3] || '';
  const argSessionId = process.argv[4] || '';
  const eventType = process.argv[5] || 'post_tool_use';
  const raw = await readStdin();
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch {}
  const toolName = argToolName && !argToolName.startsWith('$') ? argToolName : (parsed.tool_name || 'unknown');
  const sessionId = argSessionId && !argSessionId.startsWith('$') ? argSessionId : (parsed.session_id || '');
  const cwd = parsed.cwd || '';
  const transcriptPath = parsed.transcript_path || '';
  debugLog(`tool: name=${toolName} session=${sessionId?.slice(0,8)} cwd=${cwd}`);
  try { unlinkSync(IDLE_MARKER_PATH); } catch {}
  // Post tool event (include agent_id/agent_type when tool fires inside a subagent)
  const toolPost = post('/api/hooks', {
    tool_name: toolName,
    tool_input: parsed.tool_input || parsed,
    session_id: sessionId,
    event_type: eventType,
    cwd,
    agent_id: parsed.agent_id || '',
    agent_type: parsed.agent_type || '',
  });
  // Also parse transcript and post live session data (for desktop app which lacks statusLine)
  let statusPost = Promise.resolve();
  if (transcriptPath && sessionId) {
    const txData = parseTranscript(transcriptPath);
    if (txData) {
      const statusPayload = {
        session_id: sessionId,
        ...txData,
        workspace: { current_dir: cwd },
      };
      statusPost = post('/api/status', statusPayload);
      debugLog(`status-from-transcript: ctx=${txData.context_window.used_percentage}% cost=$${txData.cost.total_cost_usd}`);
    }
  }
  await Promise.all([toolPost, statusPost]);
} else if (mode === 'tool-failure') {
  // PostToolUseFailure: forward with error
  const argToolName = process.argv[3] || '';
  const argSessionId = process.argv[4] || '';
  const raw = await readStdin();
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch {}
  const toolName = argToolName && !argToolName.startsWith('$') ? argToolName : (parsed.tool_name || 'unknown');
  const sessionId = argSessionId && !argSessionId.startsWith('$') ? argSessionId : (parsed.session_id || '');
  await post('/api/hooks', {
    tool_name: toolName,
    tool_input: parsed.tool_input || parsed,
    session_id: sessionId,
    event_type: 'post_tool_use_failure',
    success: false,
    error: parsed.error || 'Unknown error',
    cwd: parsed.cwd || '',
    transcript_path: parsed.transcript_path || '',
    agent_id: parsed.agent_id || '',
    agent_type: parsed.agent_type || '',
  });
} else if (mode === 'stop') {
  // Stop hook: mark turn end + write idle marker + append progress entry
  const raw = await readStdin();
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch {}
  const sessionId = parsed.session_id || process.argv[3] || '';
  debugLog(`stop: session=${sessionId?.slice(0, 8)}`);
  try { writeFileSync(IDLE_MARKER_PATH, sessionId); } catch {}
  await post('/api/turn-end', {
    session_id: sessionId,
    stop_hook_active: parsed.stop_hook_active ?? true,
  });
  // Append progress entry (absorbed from progress-tracker.js)
  await appendProgressEntry(sessionId);
} else if (mode === 'compact') {
  // PreCompact hook: forward compact event
  const raw = await readStdin();
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch {}
  const sessionId = parsed.session_id || process.argv[3] || '';
  debugLog(`compact: session=${sessionId?.slice(0, 8)} trigger=${parsed.trigger || 'auto'}`);
  await post('/api/compact', {
    session_id: sessionId,
    trigger: parsed.trigger || 'auto',
  });
} else if (mode === 'subagent-start') {
  // SubagentStart hook: forward subagent start
  // Note: official schema only provides agent_id, agent_type, session_id, transcript_path, cwd
  // description and model are NOT in the SubagentStart payload (always empty)
  const raw = await readStdin();
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch {}
  const sessionId = parsed.session_id || process.argv[3] || '';
  debugLog(`subagent-start: session=${sessionId?.slice(0, 8)} type=${parsed.agent_type || '?'} id=${parsed.agent_id || '?'}`);
  await post('/api/subagent', {
    session_id: sessionId,
    action: 'start',
    agent_id: parsed.agent_id || `agent-${Date.now()}`,
    agent_type: parsed.agent_type || 'unknown',
  });
} else if (mode === 'subagent-stop') {
  // SubagentStop hook: forward subagent stop + parse transcript for token/model metrics
  const raw = await readStdin();
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch {}
  const sessionId = parsed.session_id || process.argv[3] || '';
  const transcriptPath = parsed.agent_transcript_path || '';

  // Parse the subagent's transcript JSONL for token usage, model, cost, and turn count
  let transcriptMetrics = {};
  if (transcriptPath) {
    try {
      const txData = parseTranscript(transcriptPath);
      if (txData) {
        // Count turns (assistant messages with usage) from last 64KB of transcript
        let turnCount = 0;
        try {
          const { content } = readTail(transcriptPath);
          for (const line of content.split('\n')) {
            if (!line.trim()) continue;
            try {
              const entry = JSON.parse(line);
              if (entry.message?.role === 'assistant' && entry.message?.usage) turnCount++;
            } catch {}
          }
        } catch {}

        transcriptMetrics = {
          model: txData.model,
          cost: txData.cost,
          tokens: {
            input: txData.context_window?.current_usage?.input_tokens || 0,
            output: txData.context_window?.current_usage?.output_tokens || 0,
            cacheRead: txData.context_window?.current_usage?.cache_read_input_tokens || 0,
            cacheWrite: txData.context_window?.current_usage?.cache_creation_input_tokens || 0,
            total: (txData.context_window?.current_usage?.input_tokens || 0) +
                   (txData.context_window?.current_usage?.output_tokens || 0),
          },
          turns: turnCount || null,
        };
        debugLog(`subagent-transcript: model=${txData.model?.display_name || '?'} cost=$${txData.cost?.total_cost_usd || 0} tokens=${transcriptMetrics.tokens.total} turns=${turnCount}`);
      }
    } catch (e) {
      debugLog(`subagent-transcript error: ${e.message}`);
    }
  }

  debugLog(`subagent-stop: session=${sessionId?.slice(0, 8)} id=${parsed.agent_id || '?'} transcript=${transcriptPath ? 'yes' : 'no'}`);
  await post('/api/subagent', {
    session_id: sessionId,
    action: 'stop',
    agent_id: parsed.agent_id || '',
    agent_type: parsed.agent_type || 'unknown',
    last_assistant_message: parsed.last_assistant_message || '',
    agent_transcript_path: transcriptPath,
    _transcriptMetrics: transcriptMetrics,
  });
} else if (mode === 'user-prompt') {
  // UserPromptSubmit hook: capture current prompt + clear idle marker
  const raw = await readStdin();
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch {}
  const sessionId = parsed.session_id || process.argv[3] || '';
  const promptText = parsed.prompt || parsed.content || parsed.message || '';
  debugLog(`user-prompt: session=${sessionId?.slice(0, 8)} len=${promptText.length}`);
  try { unlinkSync(IDLE_MARKER_PATH); } catch {}
  await post('/api/prompt', {
    session_id: sessionId,
    prompt: promptText,
  });
} else if (mode === 'config-change') {
  // ConfigChange hook: log when settings are modified
  const raw = await readStdin();
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch {}
  const sessionId = parsed.session_id || process.argv[3] || '';
  debugLog(`config-change: session=${sessionId?.slice(0, 8)}`);
  await post('/api/config-change', {
    session_id: sessionId,
    config_path: parsed.config_path || '',
    changes: parsed.changes || {},
  });
} else if (mode === 'task-completed') {
  // TaskCompleted hook: log task completions
  const raw = await readStdin();
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch {}
  const sessionId = parsed.session_id || process.argv[3] || '';
  debugLog(`task-completed: session=${sessionId?.slice(0, 8)} task=${parsed.task_id || '?'}`);
  await post('/api/task-completed', {
    session_id: sessionId,
    task_id: parsed.task_id || '',
    task_description: parsed.task_description || '',
    status: parsed.status || 'completed',
  });
}

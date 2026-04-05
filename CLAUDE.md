# Claude Code Telemetry Dashboard

Real-time monitoring dashboard for Claude Code CLI sessions. Built for **real-time oversight of Claude's decisions** so you can intervene when things go wrong.

**Information priority order:**
1. Context Window — runway remaining, velocity, turns left
2. Agents — how many active, what they're doing, what models they use
3. Tool Activity — what tools are firing, successes/failures, real-time feed
4. Turns / Performance — velocity, cost per turn
5. Cost / Model / Duration — LAST

## Quick Start

### Global install (recommended for users)
```bash
npm install -g claude-code-telemetry
claude-telemetry setup   # configures hooks + installs skills
claude-telemetry start   # starts server on :7890
```

### Local dev (for contributors)
```bash
npm install
npm run dev          # Vite on :5173, API on :7890
npm run setup-hooks  # Required: enables live tool feed, validation, prompt capture, agents
```

## Architecture

- **Backend**: Express + WebSocket + chokidar file watchers on port 7890
- **Frontend**: React 19 + Vite + Tailwind CSS v4 + Recharts
- **Data**: Reads `~/.claude.json` and `~/.claude/stats-cache.json` (no database)
- **Real-time**: WebSocket broadcasts file changes and hook events to all connected clients
- **Hooks**: Claude Code hooks POST tool events, prompts, agent activity, and live session status
- **Validation**: PreToolUse hook catches wrong-tool usage (cat→Read, grep→Grep, echo>→Write) before execution (deterministic, no LLM cost)
- **Supervisory Agent**: Stop agent hook (future) for deep response review; rules enforced via CLAUDE.md conventions
- **Failure Store**: Persistent JSONL log (`~/.claude/telemetry-failures.jsonl`) with in-memory cache, query API, and pattern analysis

## Data Flow

```
~/.claude.json ──┐
                 ├─→ chokidar (3s poll) → parser.js → store.js → broadcaster.js → WebSocket → React
stats-cache.json─┘

Claude Code hooks:
  PreToolUse:Bash ──→ tool-validator.js (deterministic) → BLOCK or ALLOW
  PostToolUse     ──→ hook-forwarder.js → POST /api/hooks → store.addToolEvent() → WebSocket → ToolActivity
  PostToolUseFailure──→ hook-forwarder.js → POST /api/hooks → store.addToolEvent() + failureStore.append()
                       → telemetry-failures.jsonl (persistent) → WebSocket → FailureHistory
  Stop            ──→ hook-forwarder.js → POST /api/turn-end → store.recordTurnEnd() → idle detection
                      + agent hook (future) + progress-tracker.js
  UserPromptSubmit──→ hook-forwarder.js → POST /api/prompt → store.updatePrompt() → WebSocket → CurrentPrompt
  SubagentStart   ──→ hook-forwarder.js → POST /api/subagent → store.addSubagent() → WebSocket → SubagentTracker
  SubagentStop    ──→ hook-forwarder.js → POST /api/subagent → store.removeSubagent() → WebSocket → SubagentTracker
  statusLine      ──→ hook-forwarder.js → POST /api/status → store.updateLiveSession() → WebSocket → live tabs
  SessionStart    ──→ start-bg.js (auto-start telemetry server)
  PreCompact      ──→ hook-forwarder.js → POST /api/compact → store.recordCompact()
```

## Directory Structure

```
bin/
  claude-telemetry.js   — Unified CLI entry point (setup, start, dev, status, telemetry queries)

server/
  index.js          — Express server, routes, port 7890
  parser.js         — Parses .claude.json & stats-cache.json into dashboard state
  store.js          — In-memory EventEmitter store (sessions, stats, toolEvents, liveSessions, prompts)
  broadcaster.js    — WebSocket server on /ws, broadcasts store events
  watchers.js       — chokidar file watchers (3s polling for Windows/OneDrive)
  hook-receiver.js  — Express router for POST /api/hooks, /api/status, /api/prompt, /api/subagent, GET /api/failures/*
  failure-store.js  — Persistent JSONL failure store with in-memory cache, query engine, pattern analysis

src/
  App.jsx           — Main layout: header, tab bar (overview + live + file sessions), content, footer
  main.jsx          — React entry point
  index.css         — Tailwind theme (dark), custom scrollbar, pulse-dot animation

  hooks/
    useDashboardData.js   — Central state (useReducer + WebSocket): sessions, stats, toolEvents, sessionActivity
    useWebSocket.js       — WebSocket connection with auto-reconnect (3s delay)
    usePictureInPicture.js — Document PiP API with HMR style sync + popup fallback

  components/
    OverviewTab.jsx       — Summary cards + daily activity chart + hourly heatmap + recent sessions table
    SessionTab.jsx        — Session detail layout (priority order: context → perf → tools+agents → turns → cost → prompt)
    ContextWindow.jsx     — Token fill gauge + breakdown (input/output/cache read/write) + cache hit ratio
    CurrentPrompt.jsx     — Shows current prompt being answered (active/completed state, env-aware fallback)
    SubagentTracker.jsx   — (legacy, no longer imported) Agent console kept on disk for reference
    ToolActivity.jsx      — Live tool event feed with timestamps, status dots, tool tooltips, validation blocks, failure filter toggle
    FailureHistory.jsx    — Persistent failure tracking panel with expandable details, pattern badges, cross-session view
    TurnTracker.jsx       — Per-turn cost, velocity, estimated turns remaining
    TurnCostChart.jsx     — Chart of cost per turn over time
    ModelBreakdown.jsx    — Donut chart: cost per model (explains subagent model selection)
    CurrentSession.jsx    — Model, duration, cost, lines changed (live or file-based)
    PerformanceMetrics.jsx — CLI frame timing: FPS, p50/p95/p99, avg/min/max
    DailyActivity.jsx     — Bar chart: messages/sessions/tools per day
    HourlyHeatmap.jsx     — Hour-of-day intensity heatmap
    MetricCard.jsx        — Reusable label+value card with tooltip support
scripts/
  setup-hooks.js              — Configures all Claude Code hooks in ~/.claude/settings.json
  install-skills.js           — Installs /telemetry and /telemetry-setup Claude Code skills
  hook-forwarder.js           — Cross-platform hook forwarder (reads stdin JSON, POSTs to server)
  start-bg.js                 — Background server starter (auto-starts on session via hooks)
  tool-validator.js            — Layer 1 deterministic bash command checker (blocks cat→Read, grep→Grep, etc.)
  supervisory-agent-prompt.md — Reference prompt for the supervisory agent (user rules, evaluation criteria)
  telemetry-cli.js            — Standalone CLI for inline telemetry stats
  failure-digest.js           — Generates markdown failure summaries (standalone or via `claude-telemetry digest`)

docs/
  user-requirements.md        — Verbatim user messages + extracted requirements
  supervisory-log.md          — Append-only log for supervisory agent findings
```

## SessionTab Layout (priority order)

```
Row 1: ContextWindow (9col) + ModelBreakdownMini (3col) — most important: token fill, runway, velocity
Row 2: PerformanceMetrics      — CLI frame timing (moved up from Row 6)
Row 3: ToolActivity (7col) | TurnCostChart + AgentActivity (5col) — agents merged with live timers + expandable results
Row 4: TurnTracker             — per-turn cost, velocity, turns remaining
Row 5: CurrentSession          — cost/model/duration (low priority)
Row 6: CurrentPrompt           — bottom, environment-dependent (shows "not available" when hook unsupported)
```

SubagentTracker is no longer imported (file kept on disk). Its features (live elapsed timers, expandable results) are merged into AgentActivity.

## Key Data Shapes

### Session object (from parser.js)
```javascript
{
  sessionId, projectPath, projectName,  // identifiers
  cost, duration, durationMs,           // summary
  primaryModel, primaryModelId,         // model info
  models: [{ id, name, inputTokens, outputTokens, cacheRead, cacheWrite, cost }],
  tokens: { input, output, cacheRead, cacheWrite, total },
  linesAdded, linesRemoved,             // code changes
  fps, performance,                     // CLI rendering metrics
  apiDuration, toolDuration             // timing
}
```

### Store state (from store.js → WebSocket → useDashboardData)
```javascript
{
  currentSession,     // Top session (highest cost)
  sessions: [],       // All project sessions sorted by cost desc
  stats,              // Aggregated stats from stats-cache.json
  toolEvents: [],     // Last 200 tool events (from hooks)
  liveSessions: {},   // Map: sessionId → live status data (from hooks)
  sessionActivity: {},// Map: sessionId → 'processing' | 'idle' (event-driven)
  timestamp           // Last update
}
```

### Live session properties (on liveSessions[id])
```javascript
{
  session_id, model, cost, context_window, workspace,
  _lastSeen,              // Timestamp of last event (pruned after 2 hours of inactivity)
  _toolCount, _lastTool,  // Tool event counters
  _turnCount, _turnHistory, _tokensPerTurn, _estimatedTurnsRemaining,
  _costDelta, _lastTurnCostDelta,
  _contextHistory, _contextWarning,
  _modelSwitches, _currentModel,
  _compactEvents, _lastCompactAt,
  _activeSubagents: { [agentId]: { type, description, model, startedAt, _toolCount, _lastTool } },
  _subagentHistory: [{ agentId, type, description, model, modelId, startedAt, endedAt, durationMs,
                       lastMessage, transcriptPath, toolCount, lastTool, tokens, cost, turns }],
  _currentPrompt,         // Current prompt text (from UserPromptSubmit hook)
  _promptHistory: [{ text, ts }],  // Last 10 prompts
}
```

## Tab System

- **Overview tab**: Always visible. Shows aggregate stats, charts, and recent sessions table.
- **Live session tabs**: From Claude Code hooks. Green pulsing dot = processing (tool events flowing), blue solid dot = idle (turn ended). Pruned after 2 hours of no events.
- **File session tabs** (gray dot): From `.claude.json` parser. Auto-populated on load. Also openable by clicking rows in the Recent Sessions table.

## Idle Detection

Event-driven (not timer-based):
- `TOOL_EVENT` with a session ID → session marked `'processing'` (green pulsing dot)
- `TURN_END` → session marked `'idle'` (blue solid dot)
- `PROMPT_UPDATE` → session marked `'processing'` (user submitted new prompt)
- Fallback: cost-change tracking for sessions without event hooks (60s threshold)

## Supervisory Agent

**Layer 1 — Deterministic** (`scripts/tool-validator.js`, PreToolUse:Bash command hook):
- Blocks: `cat`→Read, `head`/`tail`→Read, `grep`/`rg`→Grep, `find`→Glob, `sed`→Edit, `awk`→Edit, `echo`/`printf` with `>`→Write
- Allows: git, npm, node, docker, and all legitimate bash commands
- Exit 2 = block, exit 0 = allow. Timeout: 5s.

**Layer 2 — Removed** (was PreToolUse:Bash prompt hook):
- Removed: 95% redundant with Layer 1. Layer 1 expanded to cover echo/printf redirect.
- Saved $1.68-3.72 per session + 2-5s latency per Bash command.

**Layer 3a — Removed** (was Stop prompt hook):
- Removed: rules enforced via CLAUDE.md conventions instead (additive-only, no deviation, correct tools, no flip-flop, priority order).
- Saved $6.30-13.95 per session + 3-15s latency per turn.

**Layer 3b — Deep Review** (Stop agent hook, FUTURE):
- Multi-turn agent (when Claude Code ships agent hook support)
- Can read `docs/user-requirements.md`, analyze code diffs
- Can append findings to `docs/supervisory-log.md`
- Zero cost until Claude Code supports agent hook type

## Tooltips

All metric labels have `title` tooltips explaining the term. Tooltips are on:
- Panel titles (Current Session, Context Window, Performance, Model Breakdown, Tool Activity, Daily Activity, Hourly Activity, Agents, Current Prompt)
- MetricCard labels (Model, Duration, Cost, Lines Changed, Total Sessions, Total Messages, First Session)
- Token stats (Input, Output, Cache Read, Cache Write, Cache hit ratio)
- Performance metrics (FPS, Frames, p50, p95, p99, Avg, Min, Max)
- Tool names in ToolActivity (Read: "Reads file contents", Bash: "Executes shell commands", etc.)
- Status dots (green=success, red=fail, amber=blocked by validation)
- Model Breakdown header (explains subagent model selection)
- Table headers in Recent Sessions (Project, Session, Model, Cost, Duration)

## Hooks Format (Important)

Claude Code hooks in `~/.claude/settings.json` use **matcher + hooks array** format:

```json
{
  "PostToolUse": [
    {
      "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "..." }]
    }
  ]
}
```

**Not** flat command objects. See `scripts/setup-hooks.js` for the full configuration.

Hook types: `command` (run a script), `prompt` (single-turn LLM check), `agent` (multi-turn LLM agent).

## API Endpoints

```
POST /api/hooks      — Tool events (from PostToolUse/PostToolUseFailure hooks)
POST /api/status     — Live session data (from statusLine hook)
POST /api/turn-end   — Turn boundaries (from Stop hook)
POST /api/compact    — Compaction events (from PreCompact hook)
POST /api/subagent   — Agent start/stop (from SubagentStart/SubagentStop hooks)
POST /api/prompt     — Current prompt text (from UserPromptSubmit hook)
GET  /api/snapshot   — Full state snapshot (used by CLI)
GET  /api/failures          — Query failure history (session, tool, time range)
GET  /api/failures/patterns — Failure frequency analysis (by tool, by error, by session)
GET  /api/failures/digest   — Failure summary for time period (default: 24h)
WS   /ws             — WebSocket for real-time updates (includes failureEvent type)
```

## CLI — `claude-telemetry` (bin/claude-telemetry.js)

Unified entry point. Installed globally via `npm install -g claude-code-telemetry`.

```
claude-telemetry setup        — run setup-hooks.js + install-skills.js
claude-telemetry start        — start server (foreground)
claude-telemetry start --bg   — start server (background via start-bg.js)
claude-telemetry dev          — start server + vite dev (requires devDependencies)
claude-telemetry status       — hit /api/health to check if running
```

Telemetry query subcommands (passthrough to `scripts/telemetry-cli.js`):

```
claude-telemetry              — session summary (default)
claude-telemetry digest       — failure digest (last 24h, stdout)
claude-telemetry digest --append — append digest to supervisory-log.md
claude-telemetry sessions     — all sessions sorted by cost
claude-telemetry costs        — cost breakdown by model
claude-telemetry context      — context window details
claude-telemetry activity     — daily activity (last 14 days)
claude-telemetry session <n>  — details for project <n>
```

### CLI Output Example

```
=== projectname (live) ===
Context: 45% | 90K/200K | ~12 turns left     ← most important
Agents: 2 active (Explore, Plan) | 3 completed
Tools: 47 (last: Read)
Turn: 8 | Velocity: 11K/turn
$4.28 | Opus | 15m                             ← least important
```

## Theme

Dark theme with monospace fonts. Key Tailwind colors:
- `accent` (#8b5cf6 purple) — Opus, primary highlights, agents
- `blue` (#60a5fa) — Sonnet, input tokens, idle sessions
- `cyan` (#22d3ee) — Haiku, cache tokens, active agent count
- `green` (#34d399) — live/processing indicators, output tokens, success dots
- `amber` (#fbbf24) — cache write, lines changed, validation blocks, warnings
- `red` (#f87171) — errors, p99 latency, high context usage, failures

## Project Rules (IMPORTANT)

- **ADDITIVE ONLY**: Never remove existing functionality. Add to it. Improve it. Don't replace.
- **Both approaches**: If something works via hooks AND via file parsing, keep BOTH.
- **All environments**: User runs Claude in CLI, VS Code, Desktop, WSL, iOS, web, PowerShell, bash, coworker sessions.
- **Real-time first**: Everything should update live via WebSocket. File-based data is fallback only.
- **Legends & tooltips on everything**: Every dot, color, icon, label needs a tooltip.

## Installation Modes

- **Global install**: `npm install -g claude-code-telemetry` → use `claude-telemetry` commands
- **Local dev**: `git clone` + `npm install` → use `npm run` scripts
- Generated `/telemetry-setup` SKILL.md includes absolute paths resolved at install time (by design — needed so the skill can find the package wherever it was installed)

## Known Issues / TODO

- Context window uses 200K limit for file-based sessions (model-specific lookup exists but all current models are 200K)
- Build warning: bundle >500KB (Recharts is large) — could code-split
- Supervisory agent (Stop hook type "agent") requires Claude Code to support agent hook type
- Not yet published to npm — `npm publish` when ready

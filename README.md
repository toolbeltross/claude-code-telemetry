# Claude Code Telemetry Dashboard

Real-time monitoring dashboard for Claude Code CLI sessions. See what Claude is doing, how much context remains, which agents are active, and what tools are firing — all in a live web UI.

## Features

- **Context Window** — token fill gauge, runway remaining, velocity, estimated turns left
- **Agent Tracker** — active subagents with type, model, description, elapsed time
- **Tool Activity** — live feed of every tool call with timestamps, success/failure dots
- **Turn Tracking** — per-turn cost, velocity, cost chart over time
- **Model Breakdown** — cost per model donut chart
- **Performance Metrics** — CLI frame timing (FPS, p50/p95/p99)
- **Supervisory Agent** — 3-layer validation system (deterministic + LLM + deep review)
- **Cross-platform** — works with CLI, VS Code, Desktop, WSL, PowerShell, bash

## Quick Install

```bash
npm install -g claude-code-telemetry
claude-telemetry setup    # configures hooks + installs /telemetry skill
claude-telemetry start    # starts dashboard server on :7890
```

Then open http://localhost:7890 in your browser.

## Alternative: Clone & Dev

```bash
git clone https://github.com/rossb/claude-code-telemetry.git
cd claude-code-telemetry
npm install
npm run setup-hooks       # configure Claude Code hooks
npm run install-skills    # install /telemetry skill
npm run dev               # Vite on :5173, API on :7890
```

## Requirements

- Node.js 18+
- Claude Code CLI installed

## What `setup` Does

1. **Hooks** — Registers 10 Claude Code hooks in `~/.claude/settings.json`:
   - `SessionStart` — auto-starts the telemetry server in the background
   - `PreToolUse:Bash` — validates tool usage (blocks `cat` when `Read` should be used, etc.)
   - `PostToolUse` / `PostToolUseFailure` — forwards tool events to the dashboard
   - `Stop` — marks turn boundaries + runs supervisory agent review
   - `PreCompact` — detects context compaction events
   - `SubagentStart` / `SubagentStop` — tracks agent lifecycle
   - `UserPromptSubmit` — captures what question Claude is answering
   - `statusLine` — sends live session data (cost, context, model)

2. **Skills** — Installs `/telemetry` and `/telemetry-setup` as Claude Code skills

## Usage

### Web Dashboard

Start the server and open http://localhost:7890:

```bash
claude-telemetry start          # foreground
claude-telemetry start --bg     # background (auto-starts via hooks too)
```

### CLI Queries

```bash
claude-telemetry                # session summary (default)
claude-telemetry sessions       # all sessions sorted by cost
claude-telemetry costs          # cost breakdown by model
claude-telemetry context        # context window details
claude-telemetry activity       # daily activity (last 14 days)
claude-telemetry session <name> # details for a specific project
claude-telemetry status         # check if server is running
```

### Inline Skill

Inside any Claude Code session, type `/telemetry` to get an inline summary without leaving the conversation.

## Architecture

```
~/.claude.json ──┐
                 ├─→ chokidar file watchers → parser → store → WebSocket → React UI
stats-cache.json─┘

Claude Code hooks → hook-forwarder.js → POST to server → store → WebSocket → React UI
```

- **Backend**: Express + WebSocket + chokidar on port 7890
- **Frontend**: React 19 + Vite + Tailwind CSS v4 + Recharts
- **Data**: Reads `~/.claude.json` and `~/.claude/stats-cache.json` (no database)
- **Hooks**: Claude Code hooks POST tool events, prompts, agent activity to the server

## Troubleshooting

**`npm start` fails on Windows**
The `cross-env NODE_ENV=production` syntax can fail on cmd.exe. Use `npm run dev` or `node server/index.js` directly.

**VS Code panel hooks not firing**
Known Anthropic bug with the graphical panel. Run `claude` in the VS Code integrated terminal as a workaround.

**WSL + Windows dual setup**
Hooks are filesystem-specific. Run `claude-telemetry setup` from both WSL and Windows terminals to cover both environments.

**Server won't start (port in use)**
Another instance may be running. Use `claude-telemetry status` to check, or kill the existing process on port 7890.

## License

MIT

# User Requirements — Telemetry Dashboard

Verbatim user messages that define what this project should do and how Claude should behave.
This file is a reference for supervisory agents and future development.

---

## MSG 1 — Core Requirements (Real-Time Oversight)

> why one instead of the other. you flip back and forth. i use claude desktop, claude cli, claude ext for vscode, bash claude, terminal claude, powershell claude, ios claude, pc claude, cowork, claude wsl, claude online chat, claude api. you need to consider all the environments and build ideal solutions for each. i want as much useful information as i can have realtime as i work in a session. I told you in my previous prompt that you had omitted an important things That would help me manage my sessions. Look at the interface Why do I need session stats as the second item there? This is the end of the session. I could give a **** what I want is, how many agents are employed? What are they doing? What tools are they using? How do I make it so that they don't make a mistake the next time. I see you use the incorrect tool every time I ask you to do something. Only did then find the correct tool moments later Why do you keep trying the incorrect tool when the correct tool you just used I want a dashboard that helps me keep you in check. I need it to be real time. I want to watch your decisions as they're getting made. I want to watch the usage as it goes by so that I can press escape as quickly as possible to prevent you from going down the wrong path which you do often. I need this to be understood in permanent global memory, because you keep forgetting our purpose. I am after real time session based stats. I want to know what the question is that you're answering. I want to know what sub agency you've used to deploy to make that **** the dollars. The cost means nothing to me. Why the **** is that the 2nd line in there? I want your performance stats. I want the number of lines. I don't even give a **** about duration. I don't give a **** about the model The whole session line is not what I'm after. I want performance. I want context. I want tool activity. I want agents. Where the **** is the agent section that I told you you omitted?

---

## MSG 2 — Memory, Research, Agent Console

> Why the **** are you trying to write to memory without checking with me as to what you're going to write, what's in memory now? What are you adding? How is it related to what I just asked you for? Do you agree with this as a right thing to ask. Have you done any real background research out in the world as to how to handle these kinds of things and anthropic has tremendous amounts of information available to it? You have just made a bunch of **** up and just are going to go do it when I press go. You need to go look at what are the best practices as defined by anthropic for claude in those environments. This thing where it says never remove existing working functionality. Add to it, improve it. Don't replace or flip flop between approaches. Keep both when two approaches work. Okay, but are you sure that's the right way to do it? You need to go do some analysis and you need to make sure that that statement is refined in memory such that it does not cause other problems later. As a matter of fact, what you should have done in this state when I asked you to do this, you should have brought up the entirety of memory. What it does, what might be conflicting, and help me refine what you're going to add to it Stop acting like a child. You need to do proper analysis, real research I've already asked you to get the **** session out of the way. I could give a **** I want context. I want performance. I want tool activity. I want agents. I want some agents. I want to watch it go by and I want it as real time as you can make it in all of the ways that I use Claude, not just in the CLI, not just Claude Desktop, but every place I listed You need to refine all your **** before you present it to me. You're in planning mode, and you were the smartest LLM on the planet. Why the **** are you like an infant, like acting like an unprofessional **** college graduate intern that just showed up for the job? You have access to all information. Go **** find out what the very latest guidance is from anthropic go find out with the very latest super smart developers are doing and refine your **** plans. Refine your ideas. Why the **** have you not suggested agents in some agents that should be brought to bear to solve my problem? Why are you waiting for me to say this? And I did. I told you, you're there's glaring omissions from the latest guidance anthropic, and you still don't have a **** agent console in this list. Why? What is it that's got you so **** myopically focused on the wrong things? Like, go out and figure out, what do I need to know to manage session context properly

---

## MSG 3 — Read Comprehension Failure

> reread what is said and the answer To the previous questions are there. Have you run out of context or something? I know you haven't, but you're acting the moron like you haven't heard **** that I've said. You were giving terrible answers. What model are you using? Why are you like this

---

## MSG 4 — Additive Only, No Removals

> I'm sick of your low effort and your lack of memory... Don't remove what you did before. Add to it, add, add, add. I don't want you to redo everything. I want you to make it better

---

## MSG 5 — Legends, Model Breakdown Explanation

> I had you put tool tips on all of the labels in the app. What the **** does the green light mean? The red title for each entry in tool activity? There's no legend... Model breakdown, for example. How are there more than one model in there? I've only selected opus...

---

## MSG 6 — Build a Validation Agent

> I want you to go back through this entire thread and any other thread that you might have access to and take a look at what you've done. I want you to build an agent that ensures that you don't do stupid **** again

---

## MSG 7 — Global Rules, Check Every Time

> Stop saying you have everything. You don't know ****... You need to check with me every **** time... If you come off of exactly what I ask you to you stop and you **** ask me. Repeat that back to me. Make sure that's in memory. Global memory. Not just for this project, but every **** project.

---

## MSG 8 — Supervisory Anthropic Expert Agent

> Write these ideas to a file so that we can create agents that can oversee all of this. In particular I would like an agent that takes the text of all of my comments, takes the context that you can provide, and can examine everything that I do, or you do from the perspective of an expert in Anthropic documentation. I essentially want an Anthropic agent that sits over the top of what I'm doing and gets better as time goes by.

---

## Extracted Requirements

### Dashboard Priority Order (SessionTab layout)
1. Context Window + Models (Row 1 — most critical: token fill, runway, velocity, model cost split)
2. Performance (Row 2 — CLI frame timing: FPS, latency percentiles)
3. Tool Activity + Agents + Turn Cost Chart (Row 3 — real-time tool feed, agent tracker, per-turn cost)
4. Turns (Row 4 — per-turn cost, velocity, remaining turns)
5. Session / Cost / Model / Duration (Row 5 — LAST, low priority summary)
6. Current Prompt (Row 6 — bottom, environment-dependent)

### Environments That Must Be Supported
- Claude CLI (terminal, bash, PowerShell, WSL)
- Claude Desktop (PC, macOS)
- Claude for VS Code (extension)
- Claude iOS
- Claude web (online chat)
- Claude API
- Claude Cowork

### Rules for Claude
1. ADDITIVE ONLY — never remove working functionality, add to it, improve it
2. CHECK BEFORE DEVIATING — if going off what was asked, STOP and ASK first
3. GLOBAL MEMORY — rules apply to ALL projects, not just telemetry
4. DO REAL RESEARCH — check Anthropic docs, check what smart devs do, don't make things up
5. SHOW MEMORY BEFORE WRITING — bring up entirety of memory, identify conflicts, help refine
6. USE CORRECT TOOLS — Read not cat, Grep not grep, Glob not find. First time, every time
7. DON'T FLIP-FLOP — pick one approach, refine it, don't keep switching

### Agents to Build
1. **Validation Agent** (PreToolUse) — catches wrong tool usage before execution ✅ DONE
2. **Supervisory Agent** (Anthropic Expert) — watches all activity, knows Anthropic docs, catches mistakes, improves over time ✅ Layer 3a DONE (prompt hook on Stop), Layer 3b PENDING (agent hook, blocked on Claude Code support)

---

## Implementation Status (updated 2026-03-08)

### Complete
- [x] Real-time dashboard with WebSocket updates
- [x] Context Window with token fill gauge, breakdown, cache hit ratio
- [x] Tool Activity live feed with timestamps, status dots, tool tooltips
- [x] Agent tracking (active/completed with elapsed timers, expandable results)
- [x] Turn tracking with velocity, cost/tokens per turn, estimated turns remaining
- [x] Model Breakdown donut chart (explains subagent model selection)
- [x] Performance metrics (FPS, frame timing percentiles)
- [x] Current Prompt display (environment-aware fallback)
- [x] Idle detection (event-driven: tool events → processing, turn end → idle)
- [x] Supervisory agent Layer 1: deterministic tool validator (PreToolUse:Bash)
- [x] Supervisory agent Layer 2: LLM semantic check (PreToolUse:Bash prompt hook)
- [x] Supervisory agent Layer 3a: response review (Stop prompt hook, 5 core rules)
- [x] Max Plan-Aware Usage: OAuth plan detection, usage polling (60s, 429 backoff, token refresh)
- [x] PlanUsage gauges: 5hr/7day/Sonnet utilization bars, reset timers, staleness badges
- [x] displayMode toggle: all components switch between tokens/cost for Max users
- [x] Overview tab: Daily Token Consumption chart (stacked by model) for Max users
- [x] Portable npm package (bin/claude-telemetry.js, setup/start/dev/status CLI)
- [x] 10 hooks registered (SessionStart, PreToolUse:Bash, PostToolUse, PostToolUseFailure, Stop, PreCompact, SubagentStart, SubagentStop, UserPromptSubmit, statusLine)
- [x] Tooltips and legends on all sections, labels, dots, colors

### Pending
- [ ] npm publish to registry
- [ ] Supervisory agent Layer 3b (agent hook on Stop — blocked on Claude Code support)
- [ ] Build optimization (bundle >500KB, Recharts code-split)
- [ ] Setup wizard for new users (interactive credential + hook configuration)

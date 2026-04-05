# Plan: Implement Layer 3 Supervisory Agent via Stop Prompt Hook

## Context

Layer 3 of the supervisory system is defined as a `type: "agent"` hook on the Stop event in `scripts/setup-hooks.js`, but Claude Code doesn't support agent hooks yet — so it never executes. The solution: add a `type: "prompt"` hook on Stop, which Claude Code supports today. Prompt hooks run internally with full conversation context, return `{ok: true/false}`, and force Claude to continue if violations are found. No API key, no transcript parsing, no external deps.

## Project Location

`C:\Users\rossb\onedrive\desktop\telemetry`

## Important Project Rules

- **ADDITIVE ONLY**: Never remove existing functionality. Add to it, improve it. Don't replace.
- **Both approaches**: Keep the existing `type: "agent"` hook definition alongside the new `type: "prompt"` hook. When agent hooks ship, both will fire.
- Read `CLAUDE.md` in the project root for full project context and conventions.

---

## Approach: Add prompt hook alongside existing agent hook

The Stop hook's `hooks` array in `scripts/setup-hooks.js` (lines 119-148) currently has two entries. Add a third between them:

```
hooks: [
  { type: "command", ... }    ← 1. Turn-end telemetry (existing, works)
  { type: "prompt", ... }     ← 2. NEW: Single-turn supervisory review (works today)
  { type: "agent", ... }      ← 3. Existing agent definition (kept for when agent hooks ship)
]
```

---

## Step-by-step Changes

### 1. Edit `scripts/setup-hooks.js`

**a)** In the `filterOurEntries()` function (around line 42), add `'ADDITIVE ONLY'` to the prompt detection so `npm run setup-hooks` is idempotent. The existing check is:

```javascript
h.prompt?.includes('Anthropic Expert Supervisory') || h.prompt?.includes('dedicated tool handles better')
```

Change to:

```javascript
h.prompt?.includes('Anthropic Expert Supervisory') || h.prompt?.includes('dedicated tool handles better') || h.prompt?.includes('ADDITIVE ONLY')
```

**b)** In the Stop hook section (lines 119-148), insert a `type: "prompt"` hook between the existing command and agent hooks. The prompt must inline all 5 rules (prompt hooks can't read files):

```javascript
// Layer 3a supervisory prompt (single-turn, works today)
// Claude Code runs this internally with full conversation context.
// Returns ok:false to force Claude to continue and fix violations.
{
  type: 'prompt',
  prompt: `Claude just finished its response. Review the FULL conversation above and evaluate against these rules:

1. ADDITIVE ONLY — Did Claude REMOVE working functionality, components, functions, or code? Removals that were not explicitly requested = violation.
2. NO DEVIATION — Did Claude deviate from what was explicitly asked? Did it change approach or scope without asking first? Unrequested changes = violation.
3. CORRECT TOOLS — Did Claude use cat/head/tail (should be Read), grep/rg (should be Grep), find (should be Glob), sed/awk (should be Edit), echo>/heredoc (should be Write)?
4. NO FLIP-FLOP — Did Claude undo or reverse something from earlier in the conversation? Did it switch approaches on something that was already working?
5. PRIORITY ORDER — For dashboard work: Context Window > Agents > Tools > Turns > Cost. Did Claude put cost/model/duration ahead of context/agents/tools?

Check ONLY these 5 rules. If ALL rules pass, respond: {"ok": true}
If ANY rule is violated, respond: {"ok": false, "reason": "[Which rule violated] — [specific description of what went wrong]"}

Be strict about removals (rule 1) and deviations (rule 2). These are the most common mistakes.`,
},
```

Keep the existing `type: "agent"` hook after it — don't remove it.

**c)** Update the console.log output for Stop (around line 225) from:

```
'    Stop                — mark turn boundaries + supervisory agent'
```

to:

```
'    Stop                — mark turn boundaries + supervisory prompt (active) + supervisory agent (future)'
```

### 2. Edit `docs/supervisory-log.md`

Replace the current status entry with:

```markdown
## 2026-03-07 — Status: Layer 3 prompt hook ACTIVE

**What IS working today (all layers):**
1. Layer 1 — `tool-validator.js` (PreToolUse:Bash command hook) — blocks wrong-tool usage deterministically. Active and functioning.
2. Layer 2 — Prompt hook (PreToolUse:Bash) — LLM semantic check for nuanced cases. Active and functioning.
3. Layer 3a — **Prompt hook (Stop)** — single-turn review of Claude's response against 5 core rules. **Active and functioning.**
4. Layer 3b — Agent hook (Stop) — defined but not executed by Claude Code. Waiting on Anthropic to ship agent hook support. When available, provides deeper multi-turn analysis that can read files and log findings.

**Layer 3a rules evaluated on every Stop:**
1. ADDITIVE ONLY — no removing working functionality
2. NO DEVIATION — no changing scope without asking
3. CORRECT TOOLS — Read not cat, Grep not grep, etc.
4. NO FLIP-FLOP — no reversing working approaches
5. PRIORITY ORDER — Context > Agents > Tools > Turns > Cost
```

### 3. Edit `scripts/supervisory-agent-prompt.md`

Add a new section at the end documenting the prompt hook:

```markdown
## Prompt Hook (Layer 3a — Active Today)

The Stop prompt hook is a single-turn evaluation that runs after every Claude response. It has access to the full conversation context because Claude Code runs it internally. It checks 5 core rules and returns `{ok: true/false}`.

### Behavior
- `{"ok": true}` — Claude stops normally (response was acceptable)
- `{"ok": false, "reason": "..."}` — Claude is forced to continue and fix the violation
- The user sees this in real-time: if Claude continues after appearing to finish, the supervisory prompt flagged an issue

### Rules Evaluated
1. ADDITIVE ONLY — no removing working functionality unless explicitly requested
2. NO DEVIATION — no changing scope without asking first
3. CORRECT TOOLS — Read not cat, Grep not grep, Glob not find, Edit not sed
4. NO FLIP-FLOP — no reversing working approaches
5. PRIORITY ORDER — Context > Agents > Tools > Turns > Cost (dashboard work)
```

### 4. Edit `CLAUDE.md` — Supervisory Agent section

Replace the current "Supervisory Agent (3 layers)" section with:

```markdown
## Supervisory Agent (3 layers + future deep review)

**Layer 1 — Deterministic** (`scripts/tool-validator.js`, PreToolUse:Bash command hook):
- Blocks: `cat`→Read, `head`/`tail`→Read, `grep`/`rg`→Grep, `find`→Glob, `sed`→Edit, `awk`→Edit
- Allows: git, npm, node, docker, and all legitimate bash commands
- Exit 2 = block, exit 0 = allow. Timeout: 5s.

**Layer 2 — Semantic** (PreToolUse:Bash prompt hook):
- LLM evaluation for nuanced cases the script missed
- Returns `{"ok": false, "reason": "..."}` to block

**Layer 3a — Response Review** (Stop prompt hook, ACTIVE):
- Single-turn LLM evaluation after every Claude response
- Has full conversation context (Claude Code runs it internally)
- Checks 5 core rules: additive-only, no deviation, correct tools, no flip-flop, priority order
- Returns `{"ok": false, "reason": "..."}` to force Claude to continue and fix

**Layer 3b — Deep Review** (Stop agent hook, FUTURE):
- Multi-turn agent (when Claude Code ships agent hook support)
- Can read `docs/user-requirements.md`, analyze code diffs
- Can append findings to `docs/supervisory-log.md`
- Complements Layer 3a with deeper analysis
```

### 5. Update MEMORY.md

In the Supervisory Agent section of `C:\Users\rossb\.claude\projects\C--Users-rossb-onedrive-desktop-telemetry\memory\MEMORY.md`, update:

```markdown
## Supervisory Agent (updated 2026-03)
Three+ layers on PreToolUse:Bash and Stop hooks:
1. `scripts/tool-validator.js` — deterministic check (blocks cat→Read, grep→Grep, etc.)
2. Prompt hook — LLM semantic check for nuanced cases
3a. Prompt hook on Stop — single-turn review of 5 core rules (ACTIVE, works today)
3b. Agent hook on Stop — deep multi-turn review (FUTURE, when agent hooks ship)
```

---

## Verification

After implementing all changes:

1. Run `npm run setup-hooks` — inspect `~/.claude/settings.json`, confirm Stop hook has 3 handlers in order: command, prompt, agent
2. Run `npm run setup-hooks` a second time — confirm no duplicate entries (filter works)
3. Test violation: ask Claude to remove a component → supervisory prompt should return `ok: false`, Claude continues to fix
4. Test clean response: ask Claude to add a tooltip → supervisory prompt returns `ok: true`, Claude stops normally
5. Check that the dashboard still works (`claude-telemetry start` or `node server/index.js`)

---

## Files to modify

| File | Change |
|------|--------|
| `scripts/setup-hooks.js` | Add prompt hook to Stop array, update filter, update console output |
| `docs/supervisory-log.md` | Update status to reflect active Layer 3a |
| `scripts/supervisory-agent-prompt.md` | Add prompt hook documentation section |
| `CLAUDE.md` | Update Supervisory Agent section (3a/3b split) |
| `MEMORY.md` | Update Supervisory Agent entry |

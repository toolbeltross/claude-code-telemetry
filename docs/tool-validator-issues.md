# Tool Validator Issues — 2026-03-11

## Context
PreToolUse:Bash had two hooks: deterministic `tool-validator.js` (Layer 1) and a prompt hook (Layer 2).
Both were disabled during session due to blocking legitimate operations.

## Issues Observed

### 1. Layer 1 (tool-validator.js) — False positives
- Blocked `cat package.json | head -5` (flagged cat→Read). Correct behavior per rules,
  but blocked the *entire parallel tool call group*, cancelling unrelated Grep and git log calls.
- This cascade effect makes even correct blocks destructive to workflow.

### 2. Layer 2 (prompt hook) — Overly aggressive
- Blocked `choco install gh -y` — flagged as "should use a dedicated tool" when there is no
  dedicated tool for system package installation. This is a clear false positive.
- Blocked elevated PowerShell `Start-Process` for the same install — prompt hook
  interpreted a legitimate sysadmin command as wrong-tool usage.
- The prompt hook was supposed to have been removed (CLAUDE.md says "Layer 2 — Removed:
  95% redundant with Layer 1") but was still active in settings.json.

### 3. Cascade cancellation
- When any hook in a parallel tool call group errors, ALL parallel calls are cancelled.
- This means a false positive on one Bash call kills unrelated Agent/Grep/Read calls
  that were running in parallel.

## Resolution
- Disabled both PreToolUse hooks in `~/.claude/settings.json`
- Layer 1 concept is sound but needs: allowlist for install commands (choco, winget, apt, brew),
  and ideally should not cascade-cancel parallel calls.
- Layer 2 prompt hook should remain removed per CLAUDE.md — it was accidentally left in settings.

## Recommendations
- [ ] Fix Layer 1 to allowlist package managers: choco, winget, apt, brew, pip, npm install -g
- [ ] Re-enable Layer 1 only after fixing cascade issue (Claude Code platform concern)
- [ ] Ensure setup-hooks.js does NOT re-add the Layer 2 prompt hook
- [ ] Add integration test: run tool-validator against common false-positive commands

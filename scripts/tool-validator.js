#!/usr/bin/env node
/**
 * Tool Validator — Layer 1 deterministic check for PreToolUse:Bash hook.
 * Reads stdin JSON, checks tool_input.command against wrong-tool patterns.
 * Exit 2 = BLOCK the tool call (stderr explains why).
 * Exit 0 = allow (legitimate bash use).
 */

// Read stdin
let data = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => { data += chunk; });
process.stdin.on('end', () => {
  let command = '';
  try {
    const parsed = JSON.parse(data);
    command = parsed.tool_input?.command || '';
  } catch {
    // Can't parse — allow through
    process.exit(0);
  }

  if (!command) {
    process.exit(0);
  }

  // Normalize: trim, collapse whitespace
  const cmd = command.trim();

  // Extract the first "word" (the actual command being run)
  // Handle pipes: check first command in pipeline
  const firstCmd = cmd.split(/[|;]/)
    .map(s => s.trim())
    .filter(Boolean)[0] || '';

  // Get base command name (strip path, handle env vars like VAR=val cmd)
  let baseParts = firstCmd.split(/\s+/);
  // Skip env var assignments (KEY=VAL ...)
  while (baseParts.length > 0 && baseParts[0].includes('=') && !baseParts[0].startsWith('-')) {
    baseParts.shift();
  }
  const baseCmd = baseParts[0] || '';
  const cmdName = baseCmd.replace(/^.*[\\/]/, ''); // strip path

  // Patterns that should use dedicated tools instead of Bash
  const VIOLATIONS = [
    {
      pattern: /^cat$/,
      test: () => {
        // cat is OK for heredocs (cat <<), concatenation (multiple files), /dev/null
        if (cmd.includes('<<') || cmd.includes('/dev/null')) return false;
        // cat with single file = should use Read
        return true;
      },
      message: 'Use the Read tool instead of `cat` to read file contents.',
    },
    {
      pattern: /^head$/,
      test: () => true,
      message: 'Use the Read tool (with offset/limit) instead of `head`.',
    },
    {
      pattern: /^tail$/,
      test: () => {
        // tail -f is legitimate (following logs)
        if (cmd.includes('-f') || cmd.includes('--follow')) return false;
        return true;
      },
      message: 'Use the Read tool (with offset/limit) instead of `tail`.',
    },
    {
      pattern: /^(grep|egrep|fgrep|rg|ripgrep)$/,
      test: () => true,
      message: 'Use the Grep tool instead of grep/rg for content search.',
    },
    {
      pattern: /^find$/,
      test: () => {
        // find with -exec (doing actions) is legitimate bash
        if (cmd.includes('-exec') || cmd.includes('-delete')) return false;
        // find for just listing/searching = should use Glob
        return true;
      },
      message: 'Use the Glob tool instead of `find` for file search.',
    },
    {
      pattern: /^sed$/,
      test: () => {
        // sed -i (in-place editing) = should use Edit
        if (cmd.includes('-i')) return true;
        // sed for stream processing in pipes is legitimate
        if (cmd.includes('|')) return false;
        return true;
      },
      message: 'Use the Edit tool instead of `sed` for file editing.',
    },
    {
      pattern: /^awk$/,
      test: () => {
        // awk for editing files = should use Edit
        // awk in pipes for data processing is often legitimate
        if (cmd.includes('|')) return false;
        return true;
      },
      message: 'Use the Edit tool instead of `awk` for file editing.',
    },
    {
      pattern: /^(echo|printf)$/,
      test: () => {
        // Block echo/printf with file redirect, allow pipes and bare echo
        if (cmd.includes('>') && !cmd.includes('|')) return true;
        return false;
      },
      message: 'Use the Write tool instead of echo/printf with file redirect.',
    },
  ];

  // Allowlist: commands that are always legitimate bash use
  const ALLOWLIST = /^(git|npm|npx|node|python|pip|docker|docker-compose|cargo|go|make|cmake|mvn|gradle|yarn|pnpm|bun|deno|brew|apt|yum|dnf|pacman|curl|wget|ssh|scp|rsync|tar|zip|unzip|gzip|chmod|chown|mkdir|rmdir|cp|mv|ln|touch|which|where|whoami|hostname|uname|env|export|source|cd|pwd|ls|kill|pkill|ps|top|htop|systemctl|service|nc|ncat|openssl|certbot|terraform|kubectl|helm|az|aws|gcloud)$/;

  if (ALLOWLIST.test(cmdName)) {
    process.exit(0);
  }

  // Check violations
  for (const v of VIOLATIONS) {
    if (v.pattern.test(cmdName) && v.test()) {
      process.stderr.write(`[tool-validator] BLOCKED: ${v.message}\n`);
      process.exit(2);
    }
  }

  // Not in allowlist, not a violation — allow through
  process.exit(0);
});

// Timeout safety
setTimeout(() => process.exit(0), 4000);

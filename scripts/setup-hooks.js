import { readFile, writeFile, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { homedir, platform } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const START_BG_SCRIPT = join(PROJECT_ROOT, 'scripts', 'start-bg.js').replace(/\\/g, '/');
const HOOK_FORWARDER = join(PROJECT_ROOT, 'scripts', 'hook-forwarder.js').replace(/\\/g, '/');
const TOOL_VALIDATOR_V2 = join(PROJECT_ROOT, 'scripts', 'tool-validator-v2.js').replace(/\\/g, '/');

// Detect WSL: Node on WSL reports platform 'linux' but the filesystem may be mounted via /mnt/
const IS_WSL = platform() === 'linux' && !!process.env.WSL_DISTRO_NAME;

import { PORT, BASE_URL } from '../server/config.js';

const HOOK_URL = `${BASE_URL}/api/hooks`;
const STATUS_URL = `${BASE_URL}/api/status`;

// --- CLI flags ---
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE_STATUSLINE = args.includes('--statusline') || args.includes('--force-statusline');
const targetIdx = args.indexOf('--target');
const TARGET = targetIdx >= 0 ? args[targetIdx + 1] : null; // 'rossb', 'Ross Here', or 'all'

/**
 * Classify existing statusLine config.
 * @param {object} settings — parsed settings.json
 * @returns {'ours' | 'customized' | 'none'}
 */
function classifyStatusline(settings) {
  const cmd = settings?.statusLine?.command || '';
  if (!cmd) return 'none';
  const ourMarkers = ['hook-forwarder', 'statusline-standalone', 'claude-telemetry', 'claude-code-telemetry'];
  if (ourMarkers.some(m => cmd.includes(m))) return 'ours';
  return 'customized';
}

/** Resolve settings.json path for a given user profile name */
function settingsPathForProfile(profileName) {
  if (!profileName) return join(homedir(), '.claude', 'settings.json');
  // On Windows, user profiles are at C:/Users/<name>/.claude/settings.json
  if (platform() === 'win32') {
    const userDir = join(dirname(homedir()), profileName);
    return join(userDir, '.claude', 'settings.json');
  }
  return join(homedir(), '.claude', 'settings.json');
}

/** Get list of target settings paths to write */
function getTargetPaths() {
  if (!TARGET || TARGET === 'all') {
    // Write to both known profiles on this machine
    const paths = [join(homedir(), '.claude', 'settings.json')];
    // On Windows, try the other profile
    if (platform() === 'win32') {
      const currentUser = homedir().split(/[\\/]/).pop();
      const otherProfiles = ['Ross Here', 'rossb'].filter(p => p !== currentUser);
      for (const p of otherProfiles) {
        const otherPath = settingsPathForProfile(p);
        if (existsSync(dirname(otherPath))) paths.push(otherPath);
      }
    }
    return TARGET === 'all' ? paths : [paths[0]]; // default = current user only
  }
  return [settingsPathForProfile(TARGET)];
}

/** Build the canonical hook configuration */
function buildHookConfig(existingSettings) {
  const settings = { ...existingSettings };
  if (!settings.hooks) settings.hooks = {};

  // Helper: filter out our telemetry entries from an existing hook array
  function filterOurEntries(arr, marker) {
    if (!Array.isArray(arr)) return [];
    return arr.filter((entry) => {
      if (entry.hooks) {
        return !entry.hooks.some((h) =>
          h.command?.includes(marker) || h.command?.includes(HOOK_URL) || h.command?.includes(STATUS_URL) ||
          h.command?.includes('progress-tracker') || h.command?.includes('statusline.js') ||
          h.prompt?.includes('Anthropic Expert Supervisory') || h.prompt?.includes('dedicated tool handles better') ||
          h.prompt?.includes('ADDITIVE ONLY') || h.prompt?.includes('supervisory quality gate') ||
          h.prompt?.includes('Subagent did not complete') ||
          h.type === 'agent'
        );
      }
      if (entry.command?.includes(marker) || entry.command?.includes(HOOK_URL)) return false;
      return true;
    });
  }

  // --- SessionStart: auto-start telemetry server ---
  settings.hooks.SessionStart = [
    ...filterOurEntries(settings.hooks.SessionStart, 'start-bg.js'),
    { hooks: [{ type: 'command', command: `node "${START_BG_SCRIPT}" > /dev/null 2>&1 || true` }] },
  ];

  // --- PostToolUse: forward tool events ---
  settings.hooks.PostToolUse = [
    ...filterOurEntries(settings.hooks.PostToolUse, 'hook-forwarder'),
    { hooks: [{ type: 'command', command: `node "${HOOK_FORWARDER}" tool "$CLAUDE_TOOL_NAME" "$CLAUDE_SESSION_ID" post_tool_use` }] },
  ];

  // --- PostToolUseFailure: forward tool failures ---
  settings.hooks.PostToolUseFailure = [
    ...filterOurEntries(settings.hooks.PostToolUseFailure, 'hook-forwarder'),
    { hooks: [{ type: 'command', command: `node "${HOOK_FORWARDER}" tool-failure "$CLAUDE_TOOL_NAME" "$CLAUDE_SESSION_ID"` }] },
  ];

  // --- PreToolUse:Bash — Layer 1 environment-aware validation (v2) ---
  // Uses contextAddition (SUGGEST) instead of exit 2 (BLOCK) for wrong-tool patterns.
  // Prevents cascade cancellation of parallel tool calls.
  settings.hooks.PreToolUse = [
    ...filterOurEntries(settings.hooks.PreToolUse, 'tool-validator'),
    {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: `node "${TOOL_VALIDATOR_V2}"`, timeout: 5 }],
    },
  ];

  // --- Stop: turn boundary telemetry ---
  // Progress tracking is absorbed into hook-forwarder's stop mode.
  // Supervisory rules enforced via CLAUDE.md conventions (no agent hook needed).
  settings.hooks.Stop = [
    ...filterOurEntries(settings.hooks.Stop, 'hook-forwarder'),
    {
      hooks: [
        { type: 'command', command: `node "${HOOK_FORWARDER}" stop "$CLAUDE_SESSION_ID"` },
      ],
    },
  ];

  // --- PreCompact: detect context compaction ---
  settings.hooks.PreCompact = [
    ...filterOurEntries(settings.hooks.PreCompact, 'hook-forwarder'),
    { hooks: [{ type: 'command', command: `node "${HOOK_FORWARDER}" compact "$CLAUDE_SESSION_ID"` }] },
  ];

  // --- SubagentStart: track spawned subagents ---
  settings.hooks.SubagentStart = [
    ...filterOurEntries(settings.hooks.SubagentStart, 'hook-forwarder'),
    { hooks: [{ type: 'command', command: `node "${HOOK_FORWARDER}" subagent-start "$CLAUDE_SESSION_ID"` }] },
  ];

  // --- SubagentStop: telemetry ---
  settings.hooks.SubagentStop = [
    ...filterOurEntries(settings.hooks.SubagentStop, 'hook-forwarder'),
    {
      hooks: [
        { type: 'command', command: `node "${HOOK_FORWARDER}" subagent-stop "$CLAUDE_SESSION_ID"` },
      ],
    },
  ];

  // --- UserPromptSubmit: capture current prompt ---
  settings.hooks.UserPromptSubmit = [
    ...filterOurEntries(settings.hooks.UserPromptSubmit, 'hook-forwarder'),
    { hooks: [{ type: 'command', command: `node "${HOOK_FORWARDER}" user-prompt "$CLAUDE_SESSION_ID"` }] },
  ];

  // --- ConfigChange: log settings modifications ---
  settings.hooks.ConfigChange = [
    ...filterOurEntries(settings.hooks.ConfigChange || [], 'hook-forwarder'),
    { hooks: [{ type: 'command', command: `node "${HOOK_FORWARDER}" config-change "$CLAUDE_SESSION_ID"` }] },
  ];

  // --- TaskCompleted: log task completions ---
  settings.hooks.TaskCompleted = [
    ...filterOurEntries(settings.hooks.TaskCompleted || [], 'hook-forwarder'),
    { hooks: [{ type: 'command', command: `node "${HOOK_FORWARDER}" task-completed "$CLAUDE_SESSION_ID"` }] },
  ];

  // --- StatusLine: Node.js forwarder (cross-platform) ---
  const slClass = classifyStatusline(existingSettings);
  if (slClass === 'customized' && !FORCE_STATUSLINE) {
    // Preserve user's custom statusline — don't overwrite
    settings.statusLine = existingSettings.statusLine;
  } else {
    settings.statusLine = { type: 'command', command: `node "${HOOK_FORWARDER}" status` };
  }

  return settings;
}

async function deployToPath(settingsPath) {
  let settings = {};
  try {
    const raw = await readFile(settingsPath, 'utf-8');
    settings = JSON.parse(raw);
  } catch {
    console.log(`  No existing ${settingsPath}, creating new.`);
  }

  const updated = buildHookConfig(settings);

  // Report statusline classification
  const slClass = classifyStatusline(settings);
  if (slClass === 'customized' && !FORCE_STATUSLINE) {
    console.log(`  StatusLine: custom detected — "${settings.statusLine.command}"`);
    console.log(`  Skipping — your statusline config preserved. Use --statusline to override.`);
  } else if (slClass === 'customized' && FORCE_STATUSLINE) {
    console.log(`  StatusLine: overriding custom config (--statusline flag)`);
  } else {
    console.log(`  StatusLine: ${slClass === 'none' ? 'installed' : 'updated'}`);
  }

  if (DRY_RUN) {
    console.log(`\n  [DRY RUN] Would write to: ${settingsPath}`);
    console.log(`  Hook events: ${Object.keys(updated.hooks).join(', ')}`);
    return;
  }

  // Backup before writing
  if (existsSync(settingsPath)) {
    const backupPath = settingsPath + '.bak';
    await copyFile(settingsPath, backupPath);
    console.log(`  Backup: ${backupPath}`);
  }

  await writeFile(settingsPath, JSON.stringify(updated, null, 2));
  console.log(`  Written: ${settingsPath}`);
}

async function main() {
  const targets = getTargetPaths();
  console.log(`\nSetup hooks v2 — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}${TARGET ? ` (target: ${TARGET})` : ''}`);
  console.log('');

  for (const path of targets) {
    console.log(`Profile: ${path}`);
    await deployToPath(path);
    console.log('');
  }

  console.log('  Endpoints:');
  console.log('    Tool events:     ' + HOOK_URL);
  console.log('    Status line:     ' + STATUS_URL);
  console.log(`    Turn-end:        ${BASE_URL}/api/turn-end`);
  console.log(`    Compact:         ${BASE_URL}/api/compact`);
  console.log(`    Subagent:        ${BASE_URL}/api/subagent`);
  console.log(`    Prompt:          ${BASE_URL}/api/prompt`);
  console.log(`    Config change:   ${BASE_URL}/api/config-change`);
  console.log(`    Task completed:  ${BASE_URL}/api/task-completed`);
  console.log('');
  console.log('  Hooks registered:');
  console.log('    SessionStart         — auto-start telemetry server');
  console.log('    PreToolUse:Bash      — environment-aware validation v2 (suggest via contextAddition)');
  console.log('    PostToolUse          — forward tool events');
  console.log('    PostToolUseFailure   — forward tool failures');
  console.log('    Stop                 — turn boundary telemetry');
  console.log('    PreCompact           — detect context compaction');
  console.log('    SubagentStart        — track subagent spawns');
  console.log('    SubagentStop         — telemetry');
  console.log('    UserPromptSubmit     — capture current prompt');
  console.log('    ConfigChange         — log settings modifications');
  console.log('    TaskCompleted        — log task completions');
  console.log('    statusLine           — live session data (cost, context, model)');
  console.log('');

  if (IS_WSL) {
    console.log('  [WSL] Detected WSL environment. Paths use WSL filesystem.');
    console.log('  [WSL] To also cover Windows-native, run: node scripts/setup-hooks.js --target all');
    console.log('');
  } else if (platform() === 'win32') {
    console.log('  [Windows] To deploy to both profiles: node scripts/setup-hooks.js --target all');
    console.log('');
  }

  console.log('  If the telemetry server is not running, all POSTs silently fail.');
  if (DRY_RUN) console.log('\n  Re-run without --dry-run to apply changes.');
}

main().catch(console.error);

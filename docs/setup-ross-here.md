# Telemetry Dashboard Setup — Ross Here

The dashboard now supports multiple users on the same machine via a per-user port.
rossb uses port 7890 (default). You will use port 7891.

## Step 1: Set your port

Add this to your shell profile (`~/.bashrc` or `~/.bash_profile`):

```bash
export CLAUDE_TELEMETRY_PORT=7891
```

Then reload your shell:

```bash
source ~/.bashrc
```

## Step 2: Install dependencies (if not already done)

From the project directory:

```bash
cd /c/Users/rossb/OneDrive/Workspace/Code/claude-telemetry
npm install
```

## Step 3: Run setup

This writes hooks to YOUR `~/.claude/settings.json` (not rossb's):

```bash
node scripts/setup-hooks.js
```

## Step 4: Start the server

```bash
node server/index.js
```

Or in the background:

```bash
node scripts/start-bg.js
```

Your server will run on port 7891. The dashboard is at `http://localhost:7891`.

## How it works

- Each user's hooks (in `~/.claude/settings.json`) call `hook-forwarder.js`
- `hook-forwarder.js` reads `CLAUDE_TELEMETRY_PORT` at runtime to know which port to POST to
- Each user's server reads their own `~/.claude.json` and `~/.claude/stats-cache.json`
- No shared state, no port conflicts

## Ports

| User      | Port | Env var needed? |
|-----------|------|-----------------|
| rossb     | 7890 | No (default)    |
| Ross Here | 7891 | Yes             |

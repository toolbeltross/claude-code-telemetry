import { EventEmitter } from 'events';
import {
  MAX_TOOL_EVENTS, MAX_TURN_HISTORY, MAX_SUBAGENT_HISTORY,
  MAX_PROMPT_HISTORY, MAX_CONTEXT_HISTORY, DEFAULT_CONTEXT_WINDOW_SIZE,
  STALE_SESSION_MS, FORCE_REFRESH_MS,
} from './config.js';
import { FailureStore } from './failure-store.js';

class Store extends EventEmitter {
  constructor() {
    super();
    this.failureStore = new FailureStore();
    this.failureStore.onAppend = (record) => this.emit('failureEvent', record);
    this.data = {
      currentSession: null,
      sessions: [],
      stats: null,
      toolEvents: [],
      liveSessions: {},
      planInfo: { planType: null, displayMode: 'cost', usage: null, usageSource: null, usageTimestamp: null, lastUpdated: null },
      timestamp: Date.now(),
    };
  }

  /** Update from file parse results */
  update(parsed) {
    const changed = {};

    if (parsed.currentSession) {
      this.data.currentSession = parsed.currentSession;
      changed.currentSession = parsed.currentSession;
    }

    if (parsed.stats) {
      this.data.stats = parsed.stats;
      changed.stats = parsed.stats;
    }

    if (parsed.sessions) {
      this.data.sessions = parsed.sessions;
      changed.sessions = parsed.sessions;
    }

    this.data.timestamp = Date.now();
    changed.timestamp = this.data.timestamp;

    this.emit('update', changed);
  }

  /** Add a tool event from hooks */
  addToolEvent(event) {
    const toolEvent = {
      id: Date.now() + Math.random().toString(36).slice(2, 6),
      timestamp: Date.now(),
      tool: event.tool_name || event.tool || 'unknown',
      input: event.tool_input || event.input || '',
      session: event.session_id || '',
      agentId: event.agent_id || null,
      agentType: event.agent_type || null,
      type: event.event_type || 'tool_call',
      success: event.success !== false,
      error: event.error || null,
    };
    // If the session_id is missing at top level but exists in tool_input (Windows env var issue)
    if (!toolEvent.session && typeof toolEvent.input === 'object' && toolEvent.input?.session_id) {
      toolEvent.session = toolEvent.input.session_id;
    }

    this.data.toolEvents.unshift(toolEvent);
    if (this.data.toolEvents.length > MAX_TOOL_EVENTS) {
      this.data.toolEvents = this.data.toolEvents.slice(0, MAX_TOOL_EVENTS);
    }

    this.emit('toolEvent', toolEvent);

    // Track per-agent tool count if tool fired inside a subagent
    if (toolEvent.agentId && toolEvent.session) {
      const session = this.data.liveSessions[toolEvent.session];
      if (session) {
        const agent = session._activeSubagents?.[toolEvent.agentId];
        if (agent) {
          agent._toolCount = (agent._toolCount || 0) + 1;
          agent._lastTool = toolEvent.tool;
          // Emit update so UI refreshes agent tool counts in real time
          this.emit('subagentUpdate', {
            sessionId: toolEvent.session,
            action: 'toolEvent',
            agentId: toolEvent.agentId,
            activeSubagents: session._activeSubagents,
            subagentHistory: session._subagentHistory || [],
          });
        }
      }
    }

    // Derive a live session from tool events if no statusLine data exists
    // This ensures sessions show as "live" even when statusLine hook isn't firing
    if (toolEvent.session) {
      const id = toolEvent.session;
      const existing = this.data.liveSessions[id];
      if (!existing || !existing._fromStatusLine) {
        const cwd = event.cwd || existing?.workspace?.current_dir || '';
        const projectName = cwd ? cwd.split(/[\\/]/).pop() : '';
        const sessionData = {
          ...(existing || {}),
          session_id: id,
          _lastSeen: Date.now(),
          _fromToolEvents: true,
          _toolCount: (existing?._toolCount || 0) + 1,
          _lastTool: toolEvent.tool,
          workspace: { current_dir: cwd },
        };
        // Add model info if we don't have it yet (try to extract from project's file data)
        if (!sessionData.model) {
          sessionData.model = { display_name: 'Active' };
        }
        if (!sessionData.cost) {
          sessionData.cost = { total_cost_usd: 0 };
        }
        this.data.liveSessions[id] = sessionData;
        this.emit('liveSession', { id, data: sessionData });
      } else {
        // Update _lastSeen and tool count on existing statusLine-derived session
        existing._lastSeen = Date.now();
        existing._toolCount = (existing._toolCount || 0) + 1;
        existing._lastTool = toolEvent.tool;
        this.emit('liveSession', { id, data: existing });
      }
    }
  }

  /** Update live session data from statusLine POST */
  updateLiveSession(data) {
    const id = data.session_id || 'unknown';
    const existing = this.data.liveSessions[id] || {};
    data._lastSeen = Date.now();
    data._startedAt = existing._startedAt || Date.now();
    data._fromStatusLine = true;
    // Preserve tool count from derived sessions
    if (existing._toolCount) data._toolCount = existing._toolCount;
    if (existing._lastTool) data._lastTool = existing._lastTool;

    // --- Delta tracking ---
    const newCost = data.cost?.total_cost_usd ?? 0;
    const prevCost = existing._prevCost ?? newCost;
    const costDelta = newCost - prevCost;
    // Accumulate cost since last turn end (reset by recordTurnEnd)
    data._costDelta = (existing._costDelta ?? 0) + (costDelta > 0 ? costDelta : 0);
    data._prevCost = newCost;

    // Context velocity tracking
    const newCtxPct = data.context_window?.used_percentage ?? 0;
    const ctxHistory = [...(existing._contextHistory || [])];
    ctxHistory.push({ pct: newCtxPct, ts: Date.now() });
    if (ctxHistory.length > MAX_CONTEXT_HISTORY) ctxHistory.shift();
    data._contextHistory = ctxHistory;

    // Context warning thresholds
    data._contextWarning = newCtxPct > 90 ? 'critical' : newCtxPct > 80 ? 'approaching' : null;

    // Detect model switches
    const newModel = data.model?.display_name || data.model?.id || '';
    const prevModel = existing._currentModel || '';
    const switches = [...(existing._modelSwitches || [])];
    if (prevModel && newModel && prevModel !== newModel) {
      switches.push({ from: prevModel, to: newModel, ts: Date.now() });
    }
    data._modelSwitches = switches;
    data._currentModel = newModel;

    // Preserve turn tracking state from recordTurnEnd
    data._turnCount = existing._turnCount ?? 0;
    data._turnHistory = existing._turnHistory || [];
    data._tokensPerTurn = existing._tokensPerTurn ?? 0;
    data._estimatedTurnsRemaining = existing._estimatedTurnsRemaining ?? null;
    data._lastTurnCostDelta = existing._lastTurnCostDelta ?? 0;

    // Preserve compact tracking state
    data._compactEvents = existing._compactEvents || [];
    data._lastCompactAt = existing._lastCompactAt ?? null;

    // Preserve subagent tracking state
    data._activeSubagents = existing._activeSubagents || {};
    data._subagentHistory = existing._subagentHistory || [];

    // Preserve prompt tracking state
    data._currentPrompt = existing._currentPrompt || null;
    data._promptHistory = existing._promptHistory || [];

    // Preserve per-model token counts (from hook-forwarder transcript parsing)
    if (!data._modelCosts && existing._modelCosts) data._modelCosts = existing._modelCosts;

    this.data.liveSessions[id] = data;
    this.emit('liveSession', { id, data });
  }

  /** Remove live sessions not seen in the last `maxAgeMs` */
  pruneStale(maxAgeMs = STALE_SESSION_MS) {
    const cutoff = Date.now() - maxAgeMs;
    let changed = false;
    for (const [id, sess] of Object.entries(this.data.liveSessions)) {
      if ((sess._lastSeen || 0) < cutoff) {
        delete this.data.liveSessions[id];
        changed = true;
      }
    }
    if (changed) {
      this.data.timestamp = Date.now();
      this.emit('update', { liveSessions: this.data.liveSessions, timestamp: this.data.timestamp });
    }
  }

  /** Manual refresh: aggressively prune sessions not seen recently */
  forceRefresh() {
    const cutoff = Date.now() - FORCE_REFRESH_MS;
    let pruned = 0;
    for (const [id, sess] of Object.entries(this.data.liveSessions)) {
      if ((sess._lastSeen || 0) < cutoff) {
        delete this.data.liveSessions[id];
        pruned++;
      }
    }
    this.data.timestamp = Date.now();
    // Always emit update so frontend gets fresh state (even if no sessions pruned)
    this.emit('update', { liveSessions: this.data.liveSessions, timestamp: this.data.timestamp });
    return { pruned, remaining: Object.keys(this.data.liveSessions).length };
  }

  /** Record a turn end from Stop hook */
  recordTurnEnd(sessionId, data) {
    const id = sessionId || 'unknown';
    const session = this.data.liveSessions[id];
    if (!session) return;

    session._lastSeen = Date.now();
    session._turnCount = (session._turnCount || 0) + 1;
    const turnCost = session._costDelta || 0;
    session._lastTurnCostDelta = turnCost;

    // Snapshot context percentage at turn end
    const ctxPct = session.context_window?.used_percentage ?? 0;
    const totalTokens = session.context_window?.total_input_tokens ?? 0;

    const history = session._turnHistory || [];
    history.push({
      turn: session._turnCount,
      cost: turnCost,
      ctxPct,
      tokens: totalTokens,
      ts: Date.now(),
      compact: false,
    });
    if (history.length > MAX_TURN_HISTORY) history.shift();
    session._turnHistory = history;

    // Reset accumulator for next turn
    session._costDelta = 0;

    // Compute average tokens per turn from context history deltas
    if (history.length >= 2) {
      const tokenDeltas = [];
      for (let i = 1; i < history.length; i++) {
        if (!history[i].compact && !history[i - 1].compact) {
          const delta = history[i].tokens - history[i - 1].tokens;
          if (delta > 0) tokenDeltas.push(delta);
        }
      }
      if (tokenDeltas.length > 0) {
        session._tokensPerTurn = Math.round(tokenDeltas.reduce((a, b) => a + b, 0) / tokenDeltas.length);
        const contextLimit = session.context_window?.context_window_size ?? DEFAULT_CONTEXT_WINDOW_SIZE;
        const remaining = contextLimit - totalTokens;
        session._estimatedTurnsRemaining = session._tokensPerTurn > 0
          ? Math.max(0, Math.round(remaining / session._tokensPerTurn))
          : null;
      }
    }

    const turnData = {
      sessionId: id,
      turn: session._turnCount,
      cost: turnCost,
      ctxPct,
      tokensPerTurn: session._tokensPerTurn,
      turnsRemaining: session._estimatedTurnsRemaining,
    };

    this.emit('turnEnd', turnData);
  }

  /** Record a compact event from PreCompact hook */
  recordCompact(sessionId, data) {
    const id = sessionId || 'unknown';
    const session = this.data.liveSessions[id];
    if (!session) return;

    session._lastSeen = Date.now();
    const ctxPct = session.context_window?.used_percentage ?? 0;
    const event = {
      ts: Date.now(),
      trigger: data.trigger || 'auto',
      ctxPct,
    };

    const events = session._compactEvents || [];
    events.push(event);
    session._compactEvents = events;
    session._lastCompactAt = Date.now();

    // Mark in turn history
    const history = session._turnHistory || [];
    history.push({
      turn: session._turnCount || 0,
      cost: 0,
      ctxPct,
      tokens: session.context_window?.total_input_tokens ?? 0,
      ts: Date.now(),
      compact: true,
      trigger: event.trigger,
    });
    if (history.length > MAX_TURN_HISTORY) history.shift();
    session._turnHistory = history;

    this.emit('compactEvent', { sessionId: id, ...event });
  }

  /** Update current prompt from UserPromptSubmit hook */
  updatePrompt(sessionId, promptText) {
    const id = sessionId || 'unknown';
    const session = this.data.liveSessions[id];
    if (!session) return;

    session._lastSeen = Date.now();
    session._currentPrompt = promptText;
    const history = session._promptHistory || [];
    history.push({ text: promptText, ts: Date.now() });
    if (history.length > MAX_PROMPT_HISTORY) history.shift();
    session._promptHistory = history;

    this.emit('promptUpdate', { sessionId: id, prompt: promptText, history });
  }

  /** Add a subagent from SubagentStart hook */
  addSubagent(sessionId, data) {
    const id = sessionId || 'unknown';
    let session = this.data.liveSessions[id];

    // Auto-create live session if it doesn't exist yet
    // (SubagentStart can fire before statusLine or tool events)
    if (!session) {
      session = {
        session_id: id,
        _lastSeen: Date.now(),
        _startedAt: Date.now(),
        _fromSubagentEvent: true,
        _activeSubagents: {},
        _subagentHistory: [],
        model: { display_name: 'Active' },
        cost: { total_cost_usd: 0 },
        workspace: { current_dir: data.cwd || '' },
      };
      this.data.liveSessions[id] = session;
      this.emit('liveSession', { id, data: session });
    }

    session._lastSeen = Date.now();
    const agentId = data.agent_id || `agent-${Date.now()}`;
    if (!session._activeSubagents) session._activeSubagents = {};
    session._activeSubagents[agentId] = {
      type: data.agent_type || 'unknown',
      description: data.description || '',
      model: data.model || '',
      startedAt: Date.now(),
      _toolCount: 0,
      _lastTool: '',
    };

    this.emit('subagentUpdate', {
      sessionId: id,
      action: 'start',
      agentId,
      activeSubagents: session._activeSubagents,
      subagentHistory: session._subagentHistory || [],
    });
  }

  /** Remove a subagent from SubagentStop hook */
  removeSubagent(sessionId, data) {
    const id = sessionId || 'unknown';
    let session = this.data.liveSessions[id];
    if (!session) {
      // Session may not exist if SubagentStart was missed — create minimal session
      session = {
        session_id: id,
        _lastSeen: Date.now(),
        _startedAt: Date.now(),
        _fromSubagentEvent: true,
        _activeSubagents: {},
        _subagentHistory: [],
        model: { display_name: 'Active' },
        cost: { total_cost_usd: 0 },
        workspace: { current_dir: data.cwd || '' },
      };
      this.data.liveSessions[id] = session;
      this.emit('liveSession', { id, data: session });
    }

    session._lastSeen = Date.now();
    const agentId = data.agent_id || '';
    const active = session._activeSubagents || {};
    const agent = active[agentId];

    const history = session._subagentHistory || [];
    const metrics = data._transcriptMetrics || {};

    if (agent) {
      // Move from active to history with full details + transcript metrics
      history.push({
        agentId,
        type: agent.type,
        description: agent.description || '',
        model: metrics.model?.display_name || agent.model || '',
        modelId: metrics.model?.id || '',
        startedAt: agent.startedAt,
        endedAt: Date.now(),
        durationMs: Date.now() - agent.startedAt,
        lastMessage: data.last_assistant_message || '',
        transcriptPath: data.agent_transcript_path || '',
        toolCount: agent._toolCount || 0,
        lastTool: agent._lastTool || '',
        tokens: metrics.tokens || null,
        cost: metrics.cost?.total_cost_usd || null,
        turns: metrics.turns || null,
      });
      delete active[agentId];
    } else {
      // SubagentStart was missed — create history entry from stop data + transcript
      history.push({
        agentId,
        type: data.agent_type || 'unknown',
        description: '',
        model: metrics.model?.display_name || '',
        modelId: metrics.model?.id || '',
        startedAt: null,
        endedAt: Date.now(),
        durationMs: null,
        lastMessage: data.last_assistant_message || '',
        transcriptPath: data.agent_transcript_path || '',
        toolCount: 0,
        lastTool: '',
        tokens: metrics.tokens || null,
        cost: metrics.cost?.total_cost_usd || null,
        turns: metrics.turns || null,
      });
    }
    if (history.length > MAX_SUBAGENT_HISTORY) history.shift();
    session._subagentHistory = history;
    session._activeSubagents = active;

    this.emit('subagentUpdate', {
      sessionId: id,
      action: 'stop',
      agentId,
      activeSubagents: session._activeSubagents,
      subagentHistory: session._subagentHistory,
    });
  }

  /** Record a config change from ConfigChange hook */
  recordConfigChange(sessionId, data) {
    const id = sessionId || 'unknown';
    const session = this.data.liveSessions[id];
    if (!session) return;

    session._lastSeen = Date.now();
    const events = session._configChanges || [];
    events.push({
      ts: Date.now(),
      config_path: data.config_path || '',
      changes: data.changes || {},
    });
    // Keep last 20 config changes per session
    if (events.length > 20) events.shift();
    session._configChanges = events;

    this.emit('configChange', { sessionId: id, event: events[events.length - 1] });
  }

  /** Record a task completion from TaskCompleted hook */
  recordTaskCompleted(sessionId, data) {
    const id = sessionId || 'unknown';
    const session = this.data.liveSessions[id];
    if (!session) return;

    session._lastSeen = Date.now();
    const tasks = session._completedTasks || [];
    tasks.push({
      ts: Date.now(),
      task_id: data.task_id || '',
      task_description: data.task_description || '',
      status: data.status || 'completed',
    });
    // Keep last 50 task completions per session
    if (tasks.length > 50) tasks.shift();
    session._completedTasks = tasks;

    this.emit('taskCompleted', { sessionId: id, task: tasks[tasks.length - 1] });
  }

  /** Update plan info (type, display mode, usage) from plan-detector */
  updatePlanInfo(info) {
    this.data.planInfo = { ...this.data.planInfo, ...info, lastUpdated: Date.now() };
    this.emit('planInfo', this.data.planInfo);
  }

  /** Get full snapshot for initial load */
  getSnapshot() {
    return { ...this.data };
  }
}

export const store = new Store();

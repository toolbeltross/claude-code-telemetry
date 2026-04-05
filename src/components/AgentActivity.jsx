import { useState, useEffect, useMemo } from 'react';
import InfoIcon, { Legend } from './InfoIcon';

const TYPE_COLORS = {
  Explore: 'text-cyan',
  Plan: 'text-accent',
  Bash: 'text-red',
  'general-purpose': 'text-blue',
  'statusline-setup': 'text-gray-400',
  'claude-code-guide': 'text-green',
  'research-analyst': 'text-amber',
  'security-specialist': 'text-red',
  'performance-analyst': 'text-cyan',
  'compatibility-analyst': 'text-green',
  'pdf-extractor': 'text-amber',
  'excel-writer': 'text-blue',
  'facilitator': 'text-accent',
  'supervisor': 'text-red',
};

const TYPE_BG_COLORS = {
  Explore: 'bg-cyan/10 border-cyan/30',
  Plan: 'bg-accent/10 border-accent/30',
  Bash: 'bg-red/10 border-red/30',
  'general-purpose': 'bg-blue/10 border-blue/30',
  'claude-code-guide': 'bg-green/10 border-green/30',
};

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function friendlyModel(model) {
  if (!model) return '';
  const m = typeof model === 'string' ? model : model.display_name || model.id || '';
  if (m.includes('opus') || m.includes('Opus')) return 'Opus';
  if (m.includes('sonnet') || m.includes('Sonnet')) return 'Sonnet';
  if (m.includes('haiku') || m.includes('Haiku')) return 'Haiku';
  return m;
}

function formatTokens(n) {
  if (!n && n !== 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m${rem}s`;
}

function formatCost(cost) {
  if (!cost && cost !== 0) return '';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

/** Active agent — green pulsing dot, live elapsed timer, real-time tool count */
function ActiveAgentRow({ agentId, agent }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.round((Date.now() - agent.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [agent.startedAt]);

  const color = TYPE_COLORS[agent.type] || 'text-gray-300';
  const bgColor = TYPE_BG_COLORS[agent.type] || 'bg-gray-800/50 border-gray-700';
  const toolCount = agent._toolCount || 0;
  const lastTool = agent._lastTool || '';

  return (
    <div className={`rounded border px-2 py-1.5 ${bgColor}`}>
      {/* Header line: status + type + elapsed + tools */}
      <div className="flex items-center gap-1.5 text-xs flex-wrap">
        <span
          className="inline-block w-2 h-2 rounded-full bg-green animate-pulse-dot shrink-0"
          title="Agent is actively running"
        />
        <span className={`font-bold shrink-0 ${color}`} title={`Agent type: ${agent.type}`}>
          {agent.type}
        </span>
        <span className="text-gray-400 font-mono shrink-0" title="Elapsed time">
          {formatDuration(elapsed * 1000)}
        </span>
        {toolCount > 0 && (
          <span className="text-blue text-[10px] shrink-0" title={`Tools used: ${toolCount}${lastTool ? ` (last: ${lastTool})` : ''}`}>
            {toolCount} tools
          </span>
        )}
        {lastTool && (
          <span className="text-gray-500 text-[10px] shrink-0" title="Most recent tool call">
            ({lastTool})
          </span>
        )}
        <span className="text-gray-600 font-mono text-[10px] ml-auto shrink-0" title="Agent ID">
          {(agentId || '').slice(-8)}
        </span>
      </div>
      {/* Start time */}
      {agent.startedAt && (
        <div className="text-[10px] text-gray-500 mt-0.5">
          Started {formatTime(agent.startedAt)}
        </div>
      )}
    </div>
  );
}

/** Completed agent — gray dot, final stats: model, tokens, cost, tools, duration */
function CompletedAgentRow({ agent }) {
  const [expanded, setExpanded] = useState(false);
  const color = TYPE_COLORS[agent.type] || 'text-gray-300';
  const modelLabel = friendlyModel(agent.model || agent.modelId);
  const hasMessage = !!agent.lastMessage;
  const tokens = agent.tokens;
  const totalTokens = tokens ? (tokens.input + tokens.output) : 0;

  return (
    <div className="rounded border border-gray-800 bg-gray-900/50 px-2 py-1.5">
      {/* Header line: status + type + model + duration */}
      <div
        className={`flex items-center gap-1.5 text-xs flex-wrap ${hasMessage ? 'cursor-pointer' : ''}`}
        onClick={() => hasMessage && setExpanded(!expanded)}
        title={hasMessage ? 'Click to expand/collapse result' : ''}
      >
        <span
          className="inline-block w-2 h-2 rounded-full bg-gray-600 shrink-0"
          title="Agent completed"
        />
        <span className={`font-bold shrink-0 ${color}`} title={`Agent type: ${agent.type}`}>
          {agent.type}
        </span>
        {modelLabel && (
          <span
            className="text-[10px] px-1.5 py-0 rounded-full bg-gray-800 text-gray-400 border border-gray-700 shrink-0"
            title={`Model: ${agent.modelId || agent.model || modelLabel}`}
          >
            {modelLabel}
          </span>
        )}
        {agent.durationMs > 0 && (
          <span className="text-gray-500 shrink-0" title="Duration">
            {formatDuration(agent.durationMs)}
          </span>
        )}
        {hasMessage && (
          <span className="text-gray-600 shrink-0 ml-auto">{expanded ? '\u25B2' : '\u25BC'}</span>
        )}
      </div>

      {/* Stats line: tokens + cost + tools + turns */}
      <div className="flex items-center gap-2 text-[10px] text-gray-500 mt-0.5 flex-wrap">
        {agent.startedAt && (
          <span title="Start time">{formatTime(agent.startedAt)}</span>
        )}
        {totalTokens > 0 && (
          <span title={`Input: ${formatTokens(tokens.input)} | Output: ${formatTokens(tokens.output)} | Cache Read: ${formatTokens(tokens.cacheRead)} | Cache Write: ${formatTokens(tokens.cacheWrite)}`}>
            <span className="text-blue">{formatTokens(tokens.input)}</span>
            <span className="text-gray-600">/</span>
            <span className="text-green">{formatTokens(tokens.output)}</span>
            {' '}tok
          </span>
        )}
        {agent.cost > 0 && (
          <span className="text-amber" title={`Cost: $${agent.cost.toFixed(4)}`}>
            {formatCost(agent.cost)}
          </span>
        )}
        {agent.toolCount > 0 && (
          <span title={`Tools used: ${agent.toolCount}${agent.lastTool ? ` (last: ${agent.lastTool})` : ''}`}>
            {agent.toolCount} tools
          </span>
        )}
        {agent.turns > 0 && (
          <span title="Number of model turns (API calls)">
            {agent.turns} turns
          </span>
        )}
        <span className="text-gray-600 font-mono ml-auto" title="Agent ID">
          {(agent.agentId || '').slice(-8)}
        </span>
      </div>

      {/* Expandable result */}
      {expanded && agent.lastMessage && (
        <div className="mt-1.5 p-2 bg-gray-950 rounded text-gray-400 text-[11px] font-mono whitespace-pre-wrap max-h-40 overflow-y-auto border border-gray-800">
          {agent.lastMessage}
        </div>
      )}
    </div>
  );
}

export default function AgentActivity({ liveSession }) {
  const active = liveSession?._activeSubagents || {};
  const history = liveSession?._subagentHistory || [];

  const activeEntries = Object.entries(active);
  const totalCompleted = history.length;

  // Total tokens across all completed agents
  const totalTokens = useMemo(() => {
    return history.reduce((sum, a) => {
      if (a.tokens) return sum + (a.tokens.input || 0) + (a.tokens.output || 0);
      return sum;
    }, 0);
  }, [history]);

  const totalCost = useMemo(() => {
    return history.reduce((sum, a) => sum + (a.cost || 0), 0);
  }, [history]);

  // Completed entries in reverse chronological order
  const completedEntries = useMemo(() => {
    return history.slice().reverse();
  }, [history]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-2 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 shrink-0 inline-flex items-center gap-1.5" title="Subagents spawned by Claude. Each runs in its own context with a cheaper model.">
          Agents <InfoIcon>
            <div className="space-y-1.5">
              <p>Subagents spawned by Claude. Each runs in its own context. Token/cost data is extracted from agent transcripts on completion.</p>
              <div className="flex flex-wrap gap-x-1 gap-y-0.5">
                <Legend color="bg-cyan" label="Explore" />
                <Legend color="bg-accent" label="Plan" />
                <Legend color="bg-red" label="Bash" />
                <Legend color="bg-blue" label="General" />
                <Legend color="bg-green" label="Guide" />
                <Legend color="bg-amber" label="Research" />
              </div>
              <div className="flex flex-wrap gap-x-1 gap-y-0.5">
                <Legend color="bg-green" label="active (pulsing)" />
                <Legend color="bg-gray-600" label="completed" />
              </div>
              <p className="text-[10px] text-gray-500">Tool counts update in real time via agent_id on hook events. Token/cost data requires transcript parsing (available on completion).</p>
            </div>
          </InfoIcon>
        </h2>
        <span className="text-xs font-mono text-cyan" title="Currently running agents">
          {activeEntries.length} active
        </span>
        {totalCompleted > 0 && (
          <span className="text-[11px] text-gray-500" title="Number of completed subagents">
            {totalCompleted} done
          </span>
        )}
        {totalTokens > 0 && (
          <span className="text-[10px] text-gray-500" title={`Total tokens across all completed agents: ${totalTokens.toLocaleString()}`}>
            {formatTokens(totalTokens)} tok
          </span>
        )}
        {totalCost > 0 && (
          <span className="text-[10px] text-amber" title={`Total agent cost: $${totalCost.toFixed(4)}`}>
            {formatCost(totalCost)}
          </span>
        )}
      </div>

      {activeEntries.length === 0 && completedEntries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-500 text-xs">No agent events yet</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto space-y-1 max-h-80">
          {/* Active agents — always on top with live timers */}
          {activeEntries.map(([id, agent]) => (
            <ActiveAgentRow key={id} agentId={id} agent={agent} />
          ))}

          {/* Completed agents — remain visible with final stats */}
          {completedEntries.map((agent, i) => (
            <CompletedAgentRow key={agent.agentId || i} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}

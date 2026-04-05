import InfoIcon, { Legend } from './InfoIcon';

export default function ContextWindow({ session, liveSession }) {
  const live = liveSession?.context_window;
  const liveData = liveSession; // full live session for delta tracking

  if (!session?.tokens && !live) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-2 h-full flex flex-col justify-center">
        <span className="text-xs text-gray-400">CONTEXT WINDOW: No data</span>
      </div>
    );
  }

  // Prefer live statusLine data when available
  if (live) {
    const fillPct = live.used_percentage ?? 0;
    const contextLimit = live.context_window_size ?? 200000;
    const totalInput = live.total_input_tokens ?? 0;
    const usage = live.current_usage || {};
    const input = usage.input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    const cacheHit = cacheRead > 0 ? ((cacheRead / (cacheRead + input || 1)) * 100).toFixed(1) : null;
    const barColor = fillPct > 80 ? 'bg-red' : fillPct > 50 ? 'bg-amber' : 'bg-accent';

    // Compute compaction base: context level right after last compaction
    const compactPct = getCompactionBasePct(liveSession);
    const newContentPct = Math.max(0, fillPct - compactPct);
    const compactCount = (liveSession?._compactEvents || []).length;
    const lastCompact = liveSession?._lastCompactAt;
    const compactAgo = lastCompact ? Math.round((Date.now() - lastCompact) / 1000) : null;

    return (
      <div className="bg-gray-900 border-2 border-green/40 rounded-lg px-4 py-2 h-full flex flex-col justify-center">
        {/* Row 1: Label + gauge bar + fill stats */}
        <div className="flex items-center gap-4" title="Percentage of the model's context window currently used">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 shrink-0 inline-flex items-center gap-1.5">Context <InfoIcon>
              <div className="space-y-1.5">
                <p>How much of the model's context window is filled. At ~95%, Claude auto-compacts (summarizes) the conversation.</p>
                <div className="flex flex-wrap gap-x-1 gap-y-0.5"><Legend color="bg-accent" label="&lt;50%" /><Legend color="bg-amber" label="50-80%" /><Legend color="bg-red" label="&gt;80%" /></div>
                {compactPct > 0 && <div className="flex flex-wrap gap-x-1 gap-y-0.5"><Legend color="context-compacted" label="compacted" /><Legend color={barColor} label="new content" /></div>}
                <div className="flex flex-wrap gap-x-1 gap-y-0.5"><Legend color="bg-blue" label="uncached" /><Legend color="bg-green" label="output" /><Legend color="bg-cyan" label="cache read" /><Legend color="bg-amber" label="cache write" /></div>
              </div>
            </InfoIcon></span>
          <div className="flex-1 min-w-0">
            <div className="h-4 rounded-full bg-gray-800 overflow-hidden relative">
              {compactPct > 0 ? (
                <div className="h-full flex" style={{ width: `${fillPct}%` }}>
                  <div
                    className="h-full context-compacted-bar transition-all duration-500"
                    style={{ width: `${(compactPct / fillPct) * 100}%` }}
                    title={`Compacted context: ${compactPct.toFixed(1)}% — summarized content from previous conversation`}
                  />
                  <div
                    className={`h-full transition-all duration-500 ${barColor}`}
                    style={{ width: `${(newContentPct / fillPct) * 100}%` }}
                    title={`New content since last compaction: ${newContentPct.toFixed(1)}%`}
                  />
                </div>
              ) : (
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                  style={{ width: `${fillPct}%` }}
                />
              )}
              <span
                className="absolute top-0 bottom-0 w-px bg-amber/50"
                style={{ left: '80%' }}
                title="80% — high usage warning threshold"
              />
              <span
                className="absolute top-0 bottom-0 w-px bg-red/50"
                style={{ left: '95%' }}
                title="95% — critical / auto-compact threshold"
              />
            </div>
          </div>
          <span className="text-xs text-gray-400 shrink-0">{formatTokens(totalInput)} / {formatTokens(contextLimit)}</span>
          <span className={`text-2xl font-mono font-bold shrink-0 ${fillPct > 80 ? 'text-red' : fillPct > 60 ? 'text-amber' : 'text-gray-200'}`}>{fillPct}%</span>
        </div>
        {/* Row 2: Token breakdown — all horizontal, label above value */}
        <div className="flex items-center gap-4 mt-1">
          <StackedStat label="Uncached" value={formatTokens(input)} color="text-blue" tooltip="Uncached input tokens for the current API call — tokens not served from cache. Low values with high cache read = good cache efficiency." />
          <StackedStat label="Output" value={formatTokens(output)} color="text-green" tooltip="Tokens generated by the model (responses and code)" />
          <span className="text-gray-700">{'\u2502'}</span>
          <StackedStat label="Cache Read" value={formatTokens(cacheRead)} color="text-cyan" tooltip="Tokens reused from cache — 90% cheaper than new input" />
          <StackedStat label="Cache Write" value={formatTokens(cacheWrite)} color="text-amber" tooltip="Tokens written to cache for future reuse" />
          {cacheHit && <StackedStat label="Cache Hit" value={`${cacheHit}%`} color="text-cyan" tooltip="Ratio of cached vs uncached input tokens — higher means lower cost" />}
          <span className="text-gray-700">{'\u2502'}</span>
          <StackedStat
            label="Compacted"
            value={compactCount > 0 ? `${compactCount}x${compactPct > 0 ? ` (${compactPct.toFixed(0)}%)` : ''}` : '\u2014'}
            color={compactCount > 0 ? 'text-amber' : 'text-gray-600'}
            tooltip={compactCount > 0
              ? `Context has been auto-compacted ${compactCount} time(s) this session.${compactPct > 0 ? ` Compacted content occupies ~${compactPct.toFixed(1)}% of context window.` : ''}${compactAgo !== null ? ` Last: ${compactAgo < 60 ? compactAgo + 's' : Math.round(compactAgo / 60) + 'm'} ago.` : ''}`
              : 'No compactions yet this session. At ~95% context, Claude auto-compacts (summarizes) the conversation to free space.'}
          />
        </div>
        {/* Row 3: Velocity, turns remaining, warnings */}
        <VelocityRow liveData={liveData} />
      </div>
    );
  }

  // Fallback to file-based session data
  const { input, output, cacheRead, cacheWrite } = session.tokens;
  const contextLimit = getContextLimit(session.primaryModelId);
  const effectiveTokens = input;
  const fillPct = Math.min((effectiveTokens / contextLimit) * 100, 100);
  const barColor = fillPct > 80 ? 'bg-red' : fillPct > 50 ? 'bg-amber' : 'bg-accent';
  const cacheHit = cacheRead > 0 ? ((cacheRead / (cacheRead + input || 1)) * 100).toFixed(1) : null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-2 h-full flex flex-col justify-center">
      <div className="flex items-center gap-4" title="Percentage of the model's context window used by input tokens">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 shrink-0 inline-flex items-center gap-1.5">Context <InfoIcon>
              <div className="space-y-1.5">
                <p>How much of the model's context window is filled. At ~95%, Claude auto-compacts (summarizes) the conversation.</p>
                <div className="flex flex-wrap gap-x-1 gap-y-0.5"><Legend color="bg-accent" label="&lt;50%" /><Legend color="bg-amber" label="50-80%" /><Legend color="bg-red" label="&gt;80%" /></div>
                <div className="flex flex-wrap gap-x-1 gap-y-0.5"><Legend color="bg-blue" label="uncached" /><Legend color="bg-green" label="output" /><Legend color="bg-cyan" label="cache read" /><Legend color="bg-amber" label="cache write" /></div>
              </div>
            </InfoIcon></span>
        <div className="flex-1 min-w-0">
          <div className="h-4 rounded-full bg-gray-800 overflow-hidden relative">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${fillPct}%` }}
            />
            <span
              className="absolute top-0 bottom-0 w-px bg-amber/50"
              style={{ left: '80%' }}
              title="80% — high usage warning threshold"
            />
            <span
              className="absolute top-0 bottom-0 w-px bg-red/50"
              style={{ left: '95%' }}
              title="95% — critical / auto-compact threshold"
            />
          </div>
        </div>
        <span className="text-xs text-gray-400 shrink-0">{formatTokens(effectiveTokens)} / {formatTokens(contextLimit)}</span>
        <span className="text-2xl font-mono font-bold text-gray-200 shrink-0">{fillPct.toFixed(0)}%</span>
      </div>
      <div className="flex items-center gap-4 mt-1">
        <StackedStat label="Uncached" value={formatTokens(input)} color="text-blue" tooltip="Uncached input tokens for this API call — tokens not served from cache" />
        <StackedStat label="Output" value={formatTokens(output)} color="text-green" tooltip="Tokens generated by the model" />
        <span className="text-gray-700">{'\u2502'}</span>
        <StackedStat label="Cache Read" value={formatTokens(cacheRead)} color="text-cyan" tooltip="Tokens reused from cache — 90% cheaper than new input" />
        <StackedStat label="Cache Write" value={formatTokens(cacheWrite)} color="text-amber" tooltip="Tokens written to cache for future reuse" />
        {cacheHit && <StackedStat label="Cache Hit" value={`${cacheHit}%`} color="text-cyan" tooltip="Ratio of cached vs uncached input tokens — higher means lower cost" />}
      </div>
    </div>
  );
}

/**
 * Compute the context percentage occupied by compacted (summarized) content.
 * Looks at _turnHistory for the last compaction event and the first non-compact
 * entry after it — that entry's ctxPct is the "compaction base" (the summarized
 * portion of context that carries forward).
 */
function getCompactionBasePct(liveSession) {
  if (!liveSession) return 0;
  const history = liveSession._turnHistory;
  const compactEvents = liveSession._compactEvents;
  if (!compactEvents?.length) return 0;

  // Find the last compact entry in turn history
  if (!history?.length) return 0;
  let lastCompactIdx = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].compact) {
      lastCompactIdx = i;
      break;
    }
  }
  if (lastCompactIdx < 0) return 0;

  // The first non-compact entry after the last compaction shows the post-compact level
  for (let i = lastCompactIdx + 1; i < history.length; i++) {
    if (!history[i].compact) {
      return history[i].ctxPct;
    }
  }

  // No turns after compaction yet — estimate from context drop
  // The compaction typically reduces context to ~40-60% of what it was
  // Use a conservative estimate: current fill is mostly compacted content
  const preCompactPct = history[lastCompactIdx].ctxPct;
  const currentPct = liveSession.context_window?.used_percentage ?? 0;
  // If current is less than pre-compact, compaction just happened — most of current is compacted
  if (currentPct < preCompactPct) {
    return currentPct;
  }
  return 0;
}

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function StackedStat({ label, value, color, tooltip }) {
  return (
    <div className="flex flex-col items-center" title={tooltip}>
      <span className="text-[10px] uppercase tracking-wider text-gray-500 leading-none">{label}</span>
      <span className={`text-sm font-bold font-mono leading-tight ${color}`}>{value}</span>
    </div>
  );
}

function CacheGroup({ cacheRead, cacheWrite, cacheHit }) {
  return (
    <div className="flex items-center gap-3" title="Cache tokens — read from cache saves cost, write to cache enables future savings">
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-gray-500 leading-none mb-0.5">Cache</span>
        <div className="flex items-center gap-0.5" title="Tokens reused from cache — 90% cheaper than new input">
          <span className="text-[10px] text-gray-500">r</span>
          <span className="text-sm font-bold font-mono text-cyan leading-tight">{formatTokens(cacheRead)}</span>
        </div>
        <div className="flex items-center gap-0.5" title="Tokens written to cache for future reuse">
          <span className="text-[10px] text-gray-500">w</span>
          <span className="text-sm font-bold font-mono text-amber leading-tight">{formatTokens(cacheWrite)}</span>
        </div>
      </div>
      {cacheHit && (
        <div className="flex flex-col items-center" title="Ratio of cached vs uncached input tokens — higher means lower cost">
          <span className="text-[10px] uppercase tracking-wider text-gray-500 leading-none">Hit</span>
          <span className="text-sm font-bold font-mono text-cyan leading-tight">{cacheHit}%</span>
        </div>
      )}
    </div>
  );
}

function InlineStat({ label, value, color, tooltip }) {
  return (
    <div className="flex items-center gap-1.5" title={tooltip}>
      <span className="text-[10px] uppercase tracking-wider text-gray-400">{label}</span>
      <span className={`text-sm font-bold font-mono ${color}`}>{value}</span>
    </div>
  );
}

function VelocityRow({ liveData }) {
  if (!liveData) return null;
  const warning = liveData._contextWarning;
  const tokPerTurn = liveData._tokensPerTurn;
  const turnsLeft = liveData._estimatedTurnsRemaining;

  // Don't render if nothing to show
  if (!warning && !tokPerTurn) return null;

  return (
    <div className="flex items-center gap-4 mt-1">
      {tokPerTurn > 0 && (
        <InlineStat
          label="Velocity"
          value={`~${formatTokens(tokPerTurn)}/turn`}
          color="text-gray-300"
          tooltip="Average tokens consumed per turn — used to estimate remaining turns"
        />
      )}
      {turnsLeft !== null && turnsLeft !== undefined && (
        <InlineStat
          label="Turns Left"
          value={`~${turnsLeft}`}
          color={turnsLeft <= 3 ? 'text-red' : turnsLeft <= 8 ? 'text-amber' : 'text-gray-300'}
          tooltip="Estimated turns remaining before hitting context window limit"
        />
      )}
      {warning === 'critical' && (
        <span className="text-[10px] uppercase font-bold tracking-wider text-red bg-red/10 px-2 py-0.5 rounded" title="Context window is over 90% full — compaction imminent">
          Critical
        </span>
      )}
      {warning === 'approaching' && (
        <span className="text-[10px] uppercase font-bold tracking-wider text-amber bg-amber/10 px-2 py-0.5 rounded" title="Context window is over 80% full">
          High Usage
        </span>
      )}
    </div>
  );
}

function getContextLimit(modelId) {
  if (!modelId) return 200000;
  // All current Claude models use 200K. Update when new limits ship.
  const limits = {
    'claude-opus-4': 200000,
    'claude-sonnet-4': 200000,
    'claude-haiku-4': 200000,
  };
  const match = Object.entries(limits).find(([k]) => modelId.includes(k));
  return match ? match[1] : 200000;
}

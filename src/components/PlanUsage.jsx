import InfoIcon, { Legend } from './InfoIcon';

export default function PlanUsage({ planInfo }) {
  if (!planInfo || planInfo.displayMode !== 'tokens') return null;

  const { usage, tierName, usageSource, usageTimestamp } = planInfo;

  // Show tier badge even without usage data (plan detected but API hasn't responded yet)
  const hasUsage = usage && (usage.fiveHour || usage.sevenDay || usage.sevenDaySonnet || usage.extraUsage);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-2">
      <div className="flex items-center gap-5 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 inline-flex items-center gap-1.5" title={`Plan usage for ${tierName || 'Max'} — rolling windows reset automatically`}>
          Plan <InfoIcon>
            <div className="space-y-1.5">
              <p>{tierName || 'Max'} plan usage. 5hr = rolling message limit. 7-day = weekly cap. At 100% you're blocked until reset (or Extra Usage kicks in).</p>
              <div className="flex flex-wrap gap-x-1 gap-y-0.5"><Legend color="bg-green" label="low" /><Legend color="bg-amber" label="medium" /><Legend color="bg-red" label="high" /></div>
            </div>
          </InfoIcon>
          {tierName && <span className="text-[10px] text-accent font-mono ml-1">{tierName}</span>}
        </span>

        {hasUsage ? (
          <>
            {usage.fiveHour && (
              <UsageGauge
                label="5hr"
                utilization={usage.fiveHour.utilization}
                resetsAt={usage.fiveHour.resets_at}
                tooltip="Rolling 5-hour message window — resets continuously"
              />
            )}

            {usage.sevenDay && (
              <UsageGauge
                label="7day"
                utilization={usage.sevenDay.utilization}
                resetsAt={usage.sevenDay.resets_at}
                tooltip="Rolling 7-day overall usage limit"
              />
            )}

            {usage.sevenDaySonnet && (
              <UsageGauge
                label="Sonnet 7d"
                utilization={usage.sevenDaySonnet.utilization}
                resetsAt={usage.sevenDaySonnet.resets_at}
                tooltip="Separate 7-day limit for Sonnet models (independent of Opus limit)"
              />
            )}

            {usage.extraUsage && (
              <div className="flex items-center gap-1.5" title={usage.extraUsage.is_enabled ? `Extra Usage enabled — metered at API rates${usage.extraUsage.monthly_limit ? `, cap: $${usage.extraUsage.monthly_limit}` : ''}` : 'Extra Usage disabled — blocked when limits hit'}>
                <span className="text-[10px] uppercase text-gray-400">Extra</span>
                <span className={`text-[11px] font-mono ${usage.extraUsage.is_enabled ? 'text-amber' : 'text-gray-500'}`}>
                  {usage.extraUsage.is_enabled ? 'ON' : 'OFF'}
                </span>
                {usage.extraUsage.is_enabled && usage.extraUsage.used_credits != null && (
                  <span className="text-[10px] font-mono text-gray-400">${usage.extraUsage.used_credits.toFixed(2)}</span>
                )}
              </div>
            )}

            {/* Staleness indicators */}
            {usageSource === 'cached' && (
              <span className="text-[9px] text-amber/60 font-mono" title="Usage data may be stale — API rate limited, serving cached values">
                cached
              </span>
            )}
            {usageTimestamp && formatAge(usageTimestamp) && (
              <span className="text-[9px] text-gray-600 font-mono" title={`Last updated: ${new Date(usageTimestamp).toLocaleTimeString()}`}>
                {formatAge(usageTimestamp)}
              </span>
            )}
          </>
        ) : (
          <span className="text-[10px] text-gray-500 font-mono" title="Waiting for usage data from Anthropic API — may take a moment after server start">
            fetching usage…
          </span>
        )}
      </div>
    </div>
  );
}

function UsageGauge({ label, utilization, resetsAt, tooltip }) {
  const pct = Math.round(utilization ?? 0);
  const color = pct >= 80 ? 'text-red' : pct >= 50 ? 'text-amber' : 'text-green';
  const barColor = pct >= 80 ? 'bg-red' : pct >= 50 ? 'bg-amber' : 'bg-green';
  const resetStr = resetsAt ? formatReset(resetsAt) : '';

  return (
    <div className="flex items-center gap-2" title={tooltip}>
      <span className="text-[10px] uppercase text-gray-400">{label}</span>
      <div className="w-20 h-1.5 bg-gray-700 rounded-full overflow-hidden" title={`${pct}% of ${label} window used`}>
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className={`text-[11px] font-mono ${color}`}>{pct}%</span>
      {resetStr && <span className="text-[10px] text-gray-500" title={`Resets in ${resetStr}`}>{resetStr}</span>}
    </div>
  );
}

function formatReset(isoStr) {
  try {
    const resetDate = new Date(isoStr);
    const now = new Date();
    const diffMs = resetDate - now;
    if (diffMs <= 0) return 'resetting';
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  } catch {
    return '';
  }
}

function formatAge(timestamp) {
  if (!timestamp) return '';
  const ago = Date.now() - timestamp;
  if (ago < 60000) return ''; // Don't show if less than 1 minute old
  const mins = Math.floor(ago / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}
import { useState } from 'react';
import InfoIcon, { Legend } from './InfoIcon';

const TOOL_COLORS = {
  Read: 'text-blue',
  Write: 'text-green',
  Edit: 'text-amber',
  Bash: 'text-red',
  Glob: 'text-cyan',
  Grep: 'text-cyan',
  Agent: 'text-accent',
};

function formatTime(ts) {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function getToolColor(name) {
  return TOOL_COLORS[name] || 'text-gray-300';
}

export default function FailureHistory({ failureEvents, failurePatterns, sessionId }) {
  const [expanded, setExpanded] = useState(null);

  // Filter by session if provided
  const filtered = sessionId
    ? failureEvents.filter(e => e.sessionId === sessionId)
    : failureEvents;

  const total = failurePatterns?.total ?? filtered.length;
  const topTool = failurePatterns?.byTool
    ? Object.entries(failurePatterns.byTool).sort((a, b) => b[1] - a[1])[0]
    : null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-2 h-full flex flex-col">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 shrink-0 inline-flex items-center gap-1.5" title="Persistent log of tool failures, validation blocks, and bash errors — survives server restarts">
          Failures
          {total > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-red/20 text-red rounded-full font-mono">
              {total}
            </span>
          )}
          <InfoIcon>
            <div className="space-y-1.5">
              <p>Persistent failure tracking across all sessions. Data survives server restarts.</p>
              <div className="flex flex-wrap gap-x-1 gap-y-0.5">
                <Legend color="bg-red" label="tool failure" />
                <Legend color="bg-amber" label="validation block" />
              </div>
              <p className="text-[10px] text-gray-500">Query API: /api/failures, /api/failures/patterns, /api/failures/digest</p>
            </div>
          </InfoIcon>
        </h2>
        {topTool && (
          <span className="text-[10px] text-gray-500 ml-auto" title={`Most failing tool (all time): ${topTool[0]} with ${topTool[1]} failures`}>
            top: <span className={getToolColor(topTool[0])}>{topTool[0]}</span> ({topTool[1]})
          </span>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-500 text-sm">No failures recorded</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto space-y-1 max-h-48">
          {filtered.map((event, i) => {
            const isBlock = event.eventType === 'validation_block';
            const dotColor = isBlock ? 'bg-amber' : 'bg-red';
            const errorText = event.error || 'Unknown error';
            const isExpanded = expanded === i;

            return (
              <div
                key={event.id || i}
                className={`text-xs py-0.5 rounded hover:bg-gray-800/50 transition-colors cursor-pointer ${isBlock ? 'bg-amber/5' : ''}`}
                onClick={() => setExpanded(isExpanded ? null : i)}
              >
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <span className="text-gray-500 font-mono shrink-0 text-[11px]" title={event.isoTime || new Date(event.timestamp).toISOString()}>
                    {formatTime(event.timestamp)}
                  </span>
                  <span
                    className={`inline-block w-2 h-2 rounded-full shrink-0 ${dotColor}`}
                    title={isBlock ? 'Blocked by validation' : 'Tool call failed'}
                  />
                  <span className={`font-semibold shrink-0 ${getToolColor(event.toolName)}`}>
                    {event.toolName}
                  </span>
                  <span className={`truncate ${isBlock ? 'text-amber' : 'text-red/80'}`}>
                    {errorText.slice(0, 80)}{errorText.length > 80 ? '...' : ''}
                  </span>
                  {event.sessionId && (
                    <span className="text-gray-600 font-mono text-[10px] shrink-0 ml-auto" title={`Session: ${event.sessionId}`}>
                      {event.sessionId.slice(0, 8)}
                    </span>
                  )}
                </div>
                {isExpanded && (
                  <div className="mt-1 ml-6 p-2 bg-gray-800/50 rounded text-[11px] space-y-1">
                    <div className="text-gray-400">
                      <span className="text-gray-500">Error: </span>
                      <span className="text-red/90 break-all">{errorText}</span>
                    </div>
                    {event.cwd && (
                      <div className="text-gray-500">
                        <span>CWD: </span>{event.cwd}
                      </div>
                    )}
                    {event.toolInput && typeof event.toolInput === 'object' && (
                      <div className="text-gray-500 break-all">
                        <span>Input: </span>
                        {event.toolInput.command || event.toolInput.file_path || event.toolInput.pattern || JSON.stringify(event.toolInput).slice(0, 200)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
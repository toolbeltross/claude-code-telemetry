import { useState } from 'react';
import InfoIcon, { Legend } from './InfoIcon';

export default function CurrentPrompt({ liveSession }) {
  const [expanded, setExpanded] = useState(false);

  if (!liveSession) return null;

  const prompt = liveSession._currentPrompt || null;
  const history = liveSession._promptHistory || [];
  const lastCompleted = history.length > 1 ? history[history.length - 2] : null;

  // Determine if Claude is actively processing (has a current prompt and is still working)
  const isActive = !!prompt;
  const displayText = prompt || lastCompleted?.text || null;

  if (!displayText) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 inline-flex items-center gap-1.5" title="The current question or instruction Claude is working on">
            Current Prompt <InfoIcon>
              <div className="space-y-1.5">
                <p>Shows what question Claude is currently answering. Captured via UserPromptSubmit hook.</p>
                <div className="flex flex-wrap gap-x-1 gap-y-0.5"><Legend color="bg-green" label="active" /><Legend color="bg-gray-600" label="completed" /></div>
              </div>
            </InfoIcon>
          </span>
          <span className="text-xs text-gray-600">Prompt capture not available in this environment</span>
        </div>
      </div>
    );
  }

  const truncated = displayText.length > 200 && !expanded;
  const shown = truncated ? displayText.slice(0, 200) + '...' : displayText;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 inline-flex items-center gap-1.5" title="The current question or instruction Claude is working on">
          Current Prompt <InfoIcon>
            <div className="space-y-1.5">
              <p>Shows what question Claude is currently answering. Captured via UserPromptSubmit hook.</p>
              <div className="flex flex-wrap gap-x-1 gap-y-0.5"><Legend color="bg-green" label="active" /><Legend color="bg-gray-600" label="completed" /></div>
            </div>
          </InfoIcon>
        </span>
        {isActive ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-green" title="Claude is actively processing this prompt">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green animate-pulse-dot" />
            Active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-gray-500" title="Claude has finished processing this prompt">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-600" />
            Completed
          </span>
        )}
        {history.length > 1 && (
          <span className="text-[10px] text-gray-600" title="Total number of prompts submitted in this session">{history.length} prompts</span>
        )}
      </div>
      <div
        className={`text-sm font-mono cursor-pointer ${isActive ? 'text-gray-200' : 'text-gray-500'}`}
        onClick={() => setExpanded(!expanded)}
        title={truncated ? 'Click to expand' : displayText.length > 200 ? 'Click to collapse' : ''}
      >
        {shown}
      </div>
    </div>
  );
}

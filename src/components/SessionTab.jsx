import CurrentSession from './CurrentSession';
import ContextWindow from './ContextWindow';
import ToolActivity from './ToolActivity';
import FailureHistory from './FailureHistory';
import ModelBreakdownMini from './ModelBreakdownMini';
import AgentActivity from './AgentActivity';
import PerformanceMetrics from './PerformanceMetrics';
import TurnTracker from './TurnTracker';
import TurnCostChart from './TurnCostChart';
import CurrentPrompt from './CurrentPrompt';
import PlanUsage from './PlanUsage';

export default function SessionTab({ sessionId, liveSession, session, toolEvents, failureEvents, failurePatterns, planInfo }) {
  const filtered = toolEvents.filter((e) => e.session === sessionId);
  const displayMode = planInfo?.displayMode || 'cost';

  return (
    <div className="flex flex-col gap-2">
      {/* Row 1: Context Window + Mini Model Breakdown */}
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-9">
          <ContextWindow session={session} liveSession={liveSession} />
        </div>
        <div className="col-span-3">
          <ModelBreakdownMini session={session} liveSession={liveSession} displayMode={displayMode} />
        </div>
      </div>

      {/* Row 1.5: Plan Usage — Max users only (5hr/7day utilization gauges) */}
      <PlanUsage planInfo={planInfo} />

      {/* Row 2: Performance metrics */}
      <PerformanceMetrics session={session} />

      {/* Row 3: Tool Activity | Agent Activity (equal width — agents are priority #2) */}
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-6">
          <ToolActivity events={filtered} />
        </div>
        <div className="col-span-6">
          <AgentActivity liveSession={liveSession} />
        </div>
      </div>

      {/* Row 3.5: Failure History — persistent failure tracking across sessions */}
      <FailureHistory failureEvents={failureEvents} failurePatterns={failurePatterns} sessionId={sessionId} />

      {/* Row 4: Turn tracker | Turn Cost Chart */}
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-7">
          <TurnTracker liveSession={liveSession} displayMode={displayMode} />
        </div>
        <div className="col-span-5">
          <TurnCostChart liveSession={liveSession} displayMode={displayMode} />
        </div>
      </div>

      {/* Row 5: Session stats — cost/model/duration last (user priority) */}
      <CurrentSession session={session} liveSession={liveSession} displayMode={displayMode} />

      {/* Row 6: Current Prompt — bottom, environment-dependent */}
      <CurrentPrompt liveSession={liveSession} />
    </div>
  );
}

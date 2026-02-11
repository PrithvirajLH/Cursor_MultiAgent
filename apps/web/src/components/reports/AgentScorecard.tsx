import type { AgentPerformanceResponse } from '../../api/client';

export function AgentScorecard({ data }: { data: AgentPerformanceResponse['data'] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-slate-500 py-4">No agent activity in the selected range.</p>
    );
  }
  return (
    <div className="w-full max-w-full min-w-0 overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-600">
            <th className="pb-2 pr-4 font-medium">Agent</th>
            <th className="pb-2 pr-4 font-medium text-right">Resolved</th>
            <th className="pb-2 pr-4 font-medium text-right">Avg resolution (h)</th>
            <th className="pb-2 pr-4 font-medium text-right">First responses</th>
            <th className="pb-2 font-medium text-right">Avg first response (h)</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.userId} className="border-b border-slate-100">
              <td className="py-3 pr-4 font-medium text-slate-900">
                {row.name || row.email || row.userId}
              </td>
              <td className="py-3 pr-4 text-right text-slate-700">{row.ticketsResolved}</td>
              <td className="py-3 pr-4 text-right text-slate-700">
                {row.avgResolutionHours != null ? row.avgResolutionHours : '—'}
              </td>
              <td className="py-3 pr-4 text-right text-slate-700">{row.firstResponses}</td>
              <td className="py-3 text-right text-slate-700">
                {row.avgFirstResponseHours != null ? row.avgFirstResponseHours : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

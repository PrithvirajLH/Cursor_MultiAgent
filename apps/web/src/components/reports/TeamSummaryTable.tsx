type TeamRow = { id: string; name: string; open: number; resolved: number; total: number };

export function TeamSummaryTable({ data }: { data: TeamRow[] }) {
  if (data.length === 0) {
    return (
      <div className="py-6 text-sm text-slate-500">
        No team summary available for the selected range.
      </div>
    );
  }
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm" aria-label="Team summary">
        <caption className="sr-only">Team summary</caption>
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-600">
            <th className="pb-2 pr-3 font-medium">Team</th>
            <th className="pb-2 pr-3 font-medium text-right">Open</th>
            <th className="pb-2 pr-3 font-medium text-right">Closed</th>
            <th className="pb-2 font-medium text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.id} className="border-b border-slate-100">
              <td className="py-2 pr-3 font-medium text-slate-900">{row.name}</td>
              <td className="py-2 pr-3 text-right text-slate-700">{row.open}</td>
              <td className="py-2 pr-3 text-right text-slate-700">{row.resolved}</td>
              <td className="py-2 text-right text-slate-900 font-semibold">{row.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

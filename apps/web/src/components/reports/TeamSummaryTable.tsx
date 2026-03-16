type TeamRow = {
  id: string;
  name: string;
  open: number;
  resolved: number;
  total: number;
};

export function TeamSummaryTable({ data }: { data: TeamRow[] }) {
  if (data.length === 0) {
    return (
      <div className="py-6 text-sm text-muted-foreground">
        No team summary available for the selected range.
      </div>
    );
  }
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm" aria-label="Team summary">
        <caption className="sr-only">Team summary</caption>
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="pb-2 pr-3 font-medium">Team</th>
            <th className="pb-2 pr-3 font-medium text-right">Open</th>
            <th className="pb-2 pr-3 font-medium text-right">Closed</th>
            <th className="pb-2 font-medium text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.id} className="border-b border-border/50">
              <td className="py-2 pr-3 font-medium text-foreground">
                {row.name}
              </td>
              <td className="py-2 pr-3 text-right text-foreground/80">
                {row.open}
              </td>
              <td className="py-2 pr-3 text-right text-foreground/80">
                {row.resolved}
              </td>
              <td className="py-2 text-right text-foreground font-semibold">
                {row.total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

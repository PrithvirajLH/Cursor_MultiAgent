import { cn } from "@/lib/utils";

export function TicketsTableSkeleton({
  showCheckbox = true,
  rowCount = 8,
  className,
}: {
  showCheckbox?: boolean;
  rowCount?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-[0_4px_15px_rgb(0,0,0,0.04)] ring-1 ring-slate-100",
        className,
      )}
      aria-hidden
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px]">
          <thead className="border-b border-slate-100 bg-white">
            <tr>
              {showCheckbox ? (
                <th className="w-12 px-6 py-4 text-left">
                  <div className="h-4 w-4 rounded-sm skeleton-shimmer" />
                </th>
              ) : null}
              <th className="px-6 py-4 text-left">
                <div className="h-3 w-8 rounded skeleton-shimmer" />
              </th>
              <th className="px-6 py-4 text-left">
                <div className="h-3 w-14 rounded skeleton-shimmer" />
              </th>
              <th className="px-6 py-4 text-left">
                <div className="h-3 w-16 rounded skeleton-shimmer" />
              </th>
              <th className="px-6 py-4 text-left">
                <div className="h-3 w-14 rounded skeleton-shimmer" />
              </th>
              <th className="px-6 py-4 text-left">
                <div className="h-3 w-12 rounded skeleton-shimmer" />
              </th>
              <th className="px-6 py-4 text-left">
                <div className="h-3 w-14 rounded skeleton-shimmer" />
              </th>
              <th className="px-6 py-4 text-left">
                <div className="h-3 w-12 rounded skeleton-shimmer" />
              </th>
              <th className="px-6 py-4 text-left">
                <div className="h-3 w-8 rounded skeleton-shimmer" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {Array.from({ length: rowCount }).map((_, index) => (
              <tr key={index} className="bg-white">
                {showCheckbox ? (
                  <td className="px-6 py-4">
                    <div className="h-4 w-4 rounded-sm skeleton-shimmer" />
                  </td>
                ) : null}
                <td className="px-6 py-4">
                  <div className="h-4 w-16 rounded skeleton-shimmer" />
                </td>
                <td className="px-6 py-4">
                  <div className="space-y-1.5">
                    <div className="h-4 w-64 rounded skeleton-shimmer" />
                    <div className="h-3.5 w-48 rounded skeleton-shimmer" />
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="h-4 w-24 rounded skeleton-shimmer" />
                </td>
                <td className="px-6 py-4">
                  <div className="h-6 w-12 rounded-full skeleton-shimmer" />
                </td>
                <td className="px-6 py-4">
                  <div className="h-6 w-24 rounded-full skeleton-shimmer" />
                </td>
                <td className="px-6 py-4">
                  <div className="h-4 w-28 rounded skeleton-shimmer" />
                </td>
                <td className="px-6 py-4">
                  <div className="h-4 w-20 rounded skeleton-shimmer" />
                </td>
                <td className="px-6 py-4">
                  <div className="h-6 w-16 rounded-full skeleton-shimmer" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

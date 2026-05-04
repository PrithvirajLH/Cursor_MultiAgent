interface TicketRowSkeletonProps {
  rows?: number;
  showCheckbox?: boolean;
}

/**
 * Animated skeleton placeholder rows for the tickets table.
 * Matches the column structure of TicketsTable so layout doesn't jump
 * when real data arrives.
 */
export function TicketRowSkeleton({ rows = 8, showCheckbox = true }: TicketRowSkeletonProps) {
  return (
    <div className="flex-1 overflow-hidden" style={{ backgroundColor: 'var(--c-surface)' }}>
      <table className="w-full text-[12px] border-collapse">
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <tr key={i}>
              {showCheckbox ? (
                <td className="py-2 px-2.5 border-b" style={{ borderColor: 'var(--c-divider)', width: 28 }}>
                  <Bar w={14} />
                </td>
              ) : null}
              <td className="py-2 px-2.5 border-b" style={{ borderColor: 'var(--c-divider)', width: 18 }}>
                <Bar w={12} />
              </td>
              <td className="py-2 px-2.5 border-b" style={{ borderColor: 'var(--c-divider)', width: 88 }}>
                <Bar w={70} />
              </td>
              <td className="py-2 px-2.5 border-b" style={{ borderColor: 'var(--c-divider)' }}>
                <Bar w="70%" />
              </td>
              <td className="py-2 px-2.5 border-b" style={{ borderColor: 'var(--c-divider)', width: 150 }}>
                <Bar w={120} />
              </td>
              <td className="py-2 px-2.5 border-b" style={{ borderColor: 'var(--c-divider)', width: 110 }}>
                <Bar w={70} />
              </td>
              <td className="py-2 px-2.5 border-b" style={{ borderColor: 'var(--c-divider)', width: 90 }}>
                <Bar w={70} />
              </td>
              <td className="py-2 px-2.5 border-b" style={{ borderColor: 'var(--c-divider)', width: 88 }}>
                <Bar w={50} />
              </td>
              <td className="py-2 px-2.5 border-b" style={{ borderColor: 'var(--c-divider)', width: 140 }}>
                <Bar w={120} />
              </td>
              <td className="py-2 px-2.5 border-b" style={{ borderColor: 'var(--c-divider)', width: 70 }}>
                <Bar w={40} />
              </td>
              <td className="py-2 px-2.5 border-b" style={{ borderColor: 'var(--c-divider)', width: 24 }}>
                <Bar w={14} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bar({ w }: { w: number | string }) {
  return (
    <span
      className="inline-block rounded-sm animate-pulse"
      style={{
        width: typeof w === 'number' ? `${w}px` : w,
        height: 8,
        backgroundColor: 'var(--c-surface-3)',
      }}
    />
  );
}

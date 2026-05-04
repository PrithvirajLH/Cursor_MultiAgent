import { Icn, I, Avatar } from '../atoms';
import { TopbarSearch } from './TopbarSearch';

interface AppTopbarProps {
  crumbs: string[];
}

export function AppTopbar({ crumbs }: AppTopbarProps) {
  return (
    <header
      className="flex items-center h-10 px-3.5 gap-3.5 flex-none border-b"
      style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
    >
      <nav className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--c-fg-4)' }} aria-label="Breadcrumb">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <Icn d={I.chevR} s={11} />}
              <span style={{ color: last ? 'var(--c-fg)' : 'var(--c-fg-4)', fontWeight: last ? 600 : 400 }}>{c}</span>
            </span>
          );
        })}
      </nav>

      <div className="flex-1" />

      <TopbarSearch />

      <button
        className="inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded text-[12px] font-medium border"
        style={{
          backgroundColor: 'var(--c-surface)',
          color: 'var(--c-fg-2)',
          borderColor: 'var(--c-border-strong)',
        }}
      >
        <Icn d={I.plus} s={11} /> New ticket
      </button>

      <div className="relative">
        <Icn d={I.bell} s={15} />
        <span
          className="absolute -top-0.5 -right-0.5 w-[7px] h-[7px] rounded-full border-[1.5px]"
          style={{ backgroundColor: 'var(--c-red)', borderColor: 'white' }}
        />
      </div>

      <Avatar name="EM" tone="f" />
    </header>
  );
}

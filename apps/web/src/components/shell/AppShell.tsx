import type { ReactNode } from 'react';
import { AppSidebar } from './AppSidebar';
import { AppTopbar } from './AppTopbar';

interface AppShellProps {
  crumbs: string[];
  children: ReactNode;
}

export function AppShell({ crumbs, children }: AppShellProps) {
  return (
    <div
      className="w-full h-screen flex"
      style={{ backgroundColor: 'var(--c-bg)', color: 'var(--c-fg)' }}
    >
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <AppTopbar crumbs={crumbs} />
        {children}
      </div>
    </div>
  );
}

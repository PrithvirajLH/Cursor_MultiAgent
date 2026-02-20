import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

export function useSidebarState() {
  const location = useLocation();

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('sidebar-collapsed') === 'true';
  });

  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 1023px)').matches;
  });

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileAdminSidebarOpen, setMobileAdminSidebarOpen] = useState(false);
  const [adminSidebarDismissed, setAdminSidebarDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(max-width: 1023px)');
    const sync = () => setIsMobileViewport(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!isMobileViewport) {
      setMobileSidebarOpen(false);
      setMobileAdminSidebarOpen(false);
    }
  }, [isMobileViewport]);

  useEffect(() => {
    setMobileSidebarOpen(false);
    setMobileAdminSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('sidebar-collapsed', String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  return {
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    isMobileViewport,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    mobileAdminSidebarOpen,
    setMobileAdminSidebarOpen,
    adminSidebarDismissed,
    setAdminSidebarDismissed,
  } as const;
}

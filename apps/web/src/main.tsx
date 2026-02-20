import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ErrorBoundary, AppCrashFallback } from './components/ErrorBoundary';
import { ToastProvider } from './contexts/ToastContext';
import { TicketDataInvalidationProvider } from './contexts/TicketDataInvalidationContext';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Avoid overly aggressive refetching, but keep data reasonably fresh.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1
    }
  }
});

createRoot(container).render(
  <React.StrictMode>
    {/* Top-level boundary – catches fatal errors in providers / router.
        Uses inline styles (AppCrashFallback) since Tailwind may not be loaded. */}
    <ErrorBoundary fallback={(props) => <AppCrashFallback {...props} />}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <TicketDataInvalidationProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </TicketDataInvalidationProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

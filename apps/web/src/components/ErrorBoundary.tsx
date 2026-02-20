import { Component, type ErrorInfo, type ReactNode } from 'react';

/* ——————————————————————————————————————————————————————————————
 * ErrorBoundary – generic React error boundary (class component)
 *
 * React requires error boundaries to be class components
 * (there is no hooks equivalent for componentDidCatch).
 *
 * Two usage levels:
 *   1. Top-level   – wraps the entire provider tree in main.tsx
 *   2. Route-level – wraps <Suspense><Routes>...</Routes></Suspense>
 * —————————————————————————————————————————————————————————————— */

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback UI. Receives reset callback and the error. */
  fallback?: (props: { error: Error; reset: () => void }) => ReactNode;
  /** Called when an error is caught – e.g. for logging / telemetry. */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Caught:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback({ error: this.state.error, reset: this.reset });
      }
      return <DefaultFallback error={this.state.error} reset={this.reset} />;
    }
    return this.props.children;
  }
}

/* ——— Default fallback UI ——————————————————————————————————— */

function DefaultFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-8 text-center shadow-lg">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-7 w-7 text-red-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>

        <h2 className="mb-2 text-lg font-semibold text-slate-900">
          Something went wrong
        </h2>
        <p className="mb-6 text-sm text-slate-600">
          An unexpected error occurred. You can try again or reload the page.
        </p>

        {/* Show error message in dev for easier debugging */}
        {import.meta.env.DEV && error?.message && (
          <pre className="mb-6 max-h-32 overflow-auto rounded-lg bg-red-50 p-3 text-left text-xs text-red-800">
            {error.message}
          </pre>
        )}

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/30 focus-visible:ring-offset-1"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/30 focus-visible:ring-offset-1"
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}

/* ——— Top-level fallback (for main.tsx) ——————————————————————
 * This is used when the entire provider tree errors – no React
 * context or router is available, so keep it self-contained.
 * ————————————————————————————————————————————————————————————— */

export function AppCrashFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        padding: '1rem',
      }}
    >
      <div
        style={{
          maxWidth: '28rem',
          width: '100%',
          borderRadius: '1rem',
          border: '1px solid #fecaca',
          backgroundColor: '#fff',
          padding: '2rem',
          textAlign: 'center',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,.1)',
        }}
      >
        <div
          style={{
            width: '3.5rem',
            height: '3.5rem',
            margin: '0 auto 1rem',
            borderRadius: '50%',
            backgroundColor: '#fee2e2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.5rem',
          }}
          aria-hidden="true"
        >
          !
        </div>

        <h1 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#0f172a', margin: '0 0 .5rem' }}>
          Application Error
        </h1>
        <p style={{ fontSize: '.875rem', color: '#475569', margin: '0 0 1.5rem' }}>
          The application encountered a critical error and could not recover. Please reload the page.
        </p>

        {import.meta.env.DEV && error?.message && (
          <pre
            style={{
              maxHeight: '6rem',
              overflow: 'auto',
              borderRadius: '.5rem',
              backgroundColor: '#fef2f2',
              padding: '.75rem',
              textAlign: 'left',
              fontSize: '.75rem',
              color: '#991b1b',
              margin: '0 0 1.5rem',
            }}
          >
            {error.message}
          </pre>
        )}

        <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={reset}
            style={{
              height: '2.5rem',
              padding: '0 1.25rem',
              borderRadius: '.75rem',
              border: 'none',
              backgroundColor: '#2563eb',
              color: '#fff',
              fontSize: '.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              height: '2.5rem',
              padding: '0 1.25rem',
              borderRadius: '.75rem',
              border: '1px solid #e2e8f0',
              backgroundColor: '#fff',
              color: '#334155',
              fontSize: '.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}

/* ——— Route-level fallback (for App.tsx) ————————————————————
 * Has access to React context and router, so can offer
 * "Go to Dashboard" navigation.
 * ————————————————————————————————————————————————————————————— */

export function RouteErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-8 text-center shadow-lg">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-7 w-7 text-red-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>

        <h2 className="mb-2 text-lg font-semibold text-slate-900">
          This page ran into an error
        </h2>
        <p className="mb-6 text-sm text-slate-600">
          Something went wrong while loading this section. The rest of the app is still working.
        </p>

        {import.meta.env.DEV && error?.message && (
          <pre className="mb-6 max-h-32 overflow-auto rounded-lg bg-red-50 p-3 text-left text-xs text-red-800">
            {error.message}
          </pre>
        )}

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/30 focus-visible:ring-offset-1"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/30 focus-visible:ring-offset-1"
          >
            Go to Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}

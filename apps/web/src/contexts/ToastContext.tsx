import { createContext, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  createdAt: number;
}

const AUTO_DISMISS_MS = 5000;

export interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

interface ToastContextValue {
  toasts: ToastItem[];
  toast: ToastApi;
  removeToast: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

function generateId() {
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    const existing = timeoutsRef.current.get(id);
    if (existing) {
      clearTimeout(existing);
      timeoutsRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (type: ToastType, message: string) => {
      const id = generateId();
      const item: ToastItem = { id, message, type, createdAt: Date.now() };
      setToasts((prev) => [...prev, item]);

      const timeoutId = setTimeout(() => {
        removeToast(id);
        timeoutsRef.current.delete(id);
      }, AUTO_DISMISS_MS);
      timeoutsRef.current.set(id, timeoutId);
    },
    [removeToast]
  );

  const toast: ToastApi = useMemo(
    () => ({
      success: (message: string) => addToast('success', message),
      error: (message: string) => addToast('error', message),
      warning: (message: string) => addToast('warning', message),
      info: (message: string) => addToast('info', message)
    }),
    [addToast]
  );

  const value: ToastContextValue = useMemo(
    () => ({ toasts, toast, removeToast }),
    [toasts, toast, removeToast]
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

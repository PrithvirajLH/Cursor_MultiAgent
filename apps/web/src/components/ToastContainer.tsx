import { useContext } from 'react';
import { ToastContext } from '../contexts/ToastContext';
import { Toast } from './Toast';

export function ToastContainer() {
  const context = useContext(ToastContext);
  if (!context) return null;
  const { toasts, removeToast } = context;
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex max-w-sm flex-col gap-2"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <Toast
          key={t.id}
          id={t.id}
          message={t.message}
          type={t.type}
          onDismiss={removeToast}
        />
      ))}
    </div>
  );
}

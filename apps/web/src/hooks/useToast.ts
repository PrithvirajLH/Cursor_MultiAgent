import { useContext } from 'react';
import { ToastContext } from '../contexts/ToastContext';
import type { ToastApi } from '../contexts/ToastContext';

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context.toast;
}

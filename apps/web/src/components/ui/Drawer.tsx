import React, { useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';

interface DrawerProps {
    open: boolean;
    onClose: () => void;
    title: string;
    description?: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    width?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const widths = {
    sm: 'sm:w-[400px]',
    md: 'sm:w-[500px]',
    lg: 'sm:w-[600px]',
    xl: 'sm:w-[800px]',
    full: 'w-full sm:w-[calc(100%-2rem)]',
};

export function Drawer({
    open,
    onClose,
    title,
    description,
    children,
    footer,
    width = 'md',
}: DrawerProps) {
    const dialogRef = useRef<HTMLDivElement>(null);

    // Focus trap
    const handleFocusTrap = useCallback((e: KeyboardEvent) => {
        if (e.key !== 'Tab' || !dialogRef.current) return;
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
            if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        } else {
            if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }, []);

    useEffect(() => {
        if (!open) return;

        // Prevent body scrolling
        const originalStyle = window.getComputedStyle(document.body).overflow;
        document.body.style.overflow = 'hidden';

        document.addEventListener('keydown', handleFocusTrap);

        // Auto-focus the dialog
        const timer = window.setTimeout(() => dialogRef.current?.focus(), 50);

        return () => {
            document.body.style.overflow = originalStyle;
            document.removeEventListener('keydown', handleFocusTrap);
            window.clearTimeout(timer);
        };
    }, [open, handleFocusTrap]);

    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm"
                        onClick={onClose}
                        aria-hidden="true"
                    />

                    <div
                        className="fixed inset-y-0 right-0 z-50 flex max-w-full"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="drawer-title"
                    >
                        <motion.div
                            initial={{ x: '100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '100%' }}
                            transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
                            className={`w-screen ${widths[width]} flex h-full flex-col bg-white shadow-2xl`}
                            ref={dialogRef}
                            tabIndex={-1}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                    e.preventDefault();
                                    onClose();
                                }
                            }}
                        >
                            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                                <div>
                                    <h2 id="drawer-title" className="text-lg font-semibold text-slate-900">
                                        {title}
                                    </h2>
                                    {description && (
                                        <p className="mt-1 text-sm text-slate-500">
                                            {description}
                                        </p>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    aria-label="Close panel"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            <div className="relative flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
                                {children}
                            </div>
                            {footer && (
                                <div className="border-t border-slate-200 bg-slate-50/80 backdrop-blur-sm px-6 py-4">
                                    {footer}
                                </div>
                            )}
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
}

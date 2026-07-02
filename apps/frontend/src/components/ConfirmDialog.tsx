import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean; // red confirm button for destructive actions
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Promise-based confirm dialog. Usage:
 *   const confirm = useConfirm();
 *   if (await confirm({ title: 'Delete this?', danger: true })) { ... }
 * Replaces window.confirm() with an in-app modal styled like the app's other modals.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    setOpts(options);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const close = useCallback((result: boolean) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setOpts(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <div className="mov" onClick={() => close(false)}>
          <div className="mod" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <h3>{opts.title}</h3>
            {opts.message && (
              <p style={{ fontSize: '.8rem', color: '#475569', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
                {opts.message}
              </p>
            )}
            <div className="mbtns">
              <button className="bcancel" onClick={() => close(false)}>
                {opts.cancelLabel || 'Cancel'}
              </button>
              <button
                className={opts.danger ? 'bdanger' : 'bok'}
                onClick={() => close(true)}
                autoFocus
              >
                {opts.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
}

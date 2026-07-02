import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Button } from './ui/button';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Promise-based in-app confirm dialog for the admin panel.
 * Usage: const confirm = useAdminConfirm();
 *        if (await confirm({ title: 'Log out?' })) { ... }
 */
export function AdminConfirmProvider({ children }: { children: ReactNode }) {
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
        <div
          className="fixed inset-0 z-[4000] flex items-center justify-center bg-black/50 px-4"
          onClick={() => close(false)}
        >
          <div
            className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-foreground m-0">{opts.title}</h3>
            {opts.message && (
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed whitespace-pre-line">
                {opts.message}
              </p>
            )}
            <div className="flex gap-2 mt-5">
              <Button variant="outline" className="flex-1" onClick={() => close(false)}>
                {opts.cancelLabel || 'Cancel'}
              </Button>
              <Button
                variant={opts.danger ? 'destructive' : 'default'}
                className="flex-1"
                onClick={() => close(true)}
                autoFocus
              >
                {opts.confirmLabel || 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useAdminConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useAdminConfirm must be used within an AdminConfirmProvider');
  return ctx;
}

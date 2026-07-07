import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react';
import { cn } from '../admin/lib/utils';

export type ToastVariant = 'success' | 'error' | 'warning';

export interface ToastOptions {
  /** How long (ms) before it auto-dismisses. Pass 0 to keep it until closed. */
  duration?: number;
}

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastApi {
  show: (message: string, variant: ToastVariant, opts?: ToastOptions) => void;
  success: (message: string, opts?: ToastOptions) => void;
  error: (message: string, opts?: ToastOptions) => void;
  warning: (message: string, opts?: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION = 4500;
// Errors and warnings linger longer so they can be read; success is transient.
const DURATION_BY_VARIANT: Record<ToastVariant, number> = {
  success: 3500,
  warning: 6000,
  error: 7000,
};

const VARIANT_STYLES: Record<
  ToastVariant,
  { icon: typeof CheckCircle2; ring: string; iconColor: string }
> = {
  success: { icon: CheckCircle2, ring: 'border-green-500/30', iconColor: 'text-green-500' },
  warning: { icon: AlertTriangle, ring: 'border-amber-500/30', iconColor: 'text-amber-500' },
  error: { icon: XCircle, ring: 'border-destructive/30', iconColor: 'text-destructive' },
};

/**
 * App-wide toast notifications. Usage:
 *   const toast = useToast();
 *   toast.success('User saved');
 *   toast.error('This user is referenced by existing records and cannot be deleted.');
 *   toast.warning('This user has recorded findings; their work is preserved.');
 * Toasts stack top-right and auto-dismiss (errors/warnings linger longer).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const show = useCallback(
    (message: string, variant: ToastVariant, opts?: ToastOptions) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, message, variant }]);
      const duration = opts?.duration ?? DURATION_BY_VARIANT[variant] ?? DEFAULT_DURATION;
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
    },
    [dismiss],
  );

  const api: ToastApi = {
    show,
    success: (m, o) => show(m, 'success', o),
    error: (m, o) => show(m, 'error', o),
    warning: (m, o) => show(m, 'warning', o),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 w-[min(92vw,22rem)] pointer-events-none"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((t) => {
          const s = VARIANT_STYLES[t.variant];
          const Icon = s.icon;
          return (
            <div
              key={t.id}
              role={t.variant === 'error' ? 'alert' : 'status'}
              className={cn(
                'pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-card text-card-foreground shadow-lg px-3.5 py-3',
                'animate-in slide-in-from-top-2 fade-in duration-200',
                s.ring,
              )}
            >
              <Icon size={18} className={cn('mt-0.5 shrink-0', s.iconColor)} />
              <p className="text-sm leading-snug flex-1 break-words">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 -mr-1 -mt-0.5 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                aria-label="Dismiss"
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

import { cn } from '../../lib/utils';

export function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
        active ? 'bg-emerald-500/15 text-emerald-700' : 'bg-muted text-muted-foreground'
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', active ? 'bg-emerald-500' : 'bg-muted-foreground')} />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-muted text-foreground border border-border">
      {children}
    </span>
  );
}

import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type Status = 'negotiation' | 'approved' | 'confirmed' | 'action' | 'sent';

const statusStyle: Record<Status, string> = {
  negotiation: 'border-[#B8860B]/50 text-[#8a6508] bg-transparent',
  action: 'border-[#7d2828]/45 text-[#7d2828] bg-transparent',
  sent: 'border-border text-muted-foreground bg-transparent',
  approved: 'border-primary/50 text-primary bg-transparent',
  confirmed: 'border-primary bg-primary text-primary-foreground',
};

const statusLabel: Record<Status, string> = {
  negotiation: 'In negotiation',
  action: 'Action required',
  sent: 'Option sent',
  approved: 'Model approved',
  confirmed: 'Confirmed',
};

export function StatusPill({ status, className }: { status: Status; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'rounded-full px-2.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] transition-colors duration-500',
        statusStyle[status],
        className,
      )}
    >
      {statusLabel[status]}
    </Badge>
  );
}

/** Application window chrome that mirrors the product header. */
export function AppWindow({
  children,
  className,
  right = 'Help · Logout',
}: {
  children: ReactNode;
  className?: string;
  right?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-card shadow-[0_28px_60px_-24px_rgba(17,17,17,0.22),0_2px_8px_rgba(17,17,17,0.05)]',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="label text-[9.5px] tracking-[0.18em]">Index Casting</span>
        <span className="label text-[9px] tracking-[0.14em] text-muted-foreground">{right}</span>
      </div>
      {children}
    </div>
  );
}

export function SampleNote({ className }: { className?: string }) {
  return (
    <p className={cn('font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground', className)}>
      Sample data
    </p>
  );
}

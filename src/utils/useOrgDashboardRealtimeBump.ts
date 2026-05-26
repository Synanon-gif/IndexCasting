import { useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { createDebouncedScheduler } from './debouncedScheduler';

export type OrgDashboardRealtimeBumpArgs = {
  /** When false, no channel is opened. */
  enabled: boolean;
  organizationId: string | null | undefined;
  /** Agency workspace: filter option_requests by agency_id. */
  agencyId?: string | null;
  onBump: () => void;
  debounceMs?: number;
};

/**
 * Org-scoped Realtime → debounced dashboard refetch.
 * Keeps summary chips fresh while the user stays on Dashboard (Messages tab
 * unmounts per-conversation subscriptions).
 */
export function useOrgDashboardRealtimeBump({
  enabled,
  organizationId,
  agencyId,
  onBump,
  debounceMs = 500,
}: OrgDashboardRealtimeBumpArgs): void {
  const onBumpRef = useRef(onBump);
  onBumpRef.current = onBump;

  useEffect(() => {
    const orgId = organizationId?.trim();
    if (!enabled || !orgId) return;

    const { schedule, clear } = createDebouncedScheduler(() => onBumpRef.current(), debounceMs);

    const channelName = agencyId?.trim()
      ? `dashboard-sync-agency-${orgId}-${agencyId.trim()}`
      : `dashboard-sync-client-${orgId}`;

    let channel = supabase.channel(channelName);

    if (agencyId?.trim()) {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'option_requests',
          filter: `agency_id=eq.${agencyId.trim()}`,
        },
        () => schedule(),
      );
    } else {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'option_requests',
          filter: `organization_id=eq.${orgId}`,
        },
        () => schedule(),
      );
    }

    channel = channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () =>
        schedule(),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, () =>
        schedule(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'manual_invoices',
          filter: `organization_id=eq.${orgId}`,
        },
        () => schedule(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_calendar_events',
          filter: `organization_id=eq.${orgId}`,
        },
        () => schedule(),
      );

    channel.subscribe();

    return () => {
      clear();
      void supabase.removeChannel(channel);
    };
  }, [enabled, organizationId, agencyId, debounceMs]);
}

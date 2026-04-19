import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';
import { uiCopy } from '../../constants/uiCopy';
import {
  adminGetHealthOverview,
  adminListSystemEvents,
  type AdminHealthCheck,
  type AdminHealthCheckStatus,
  type AdminHealthOverview,
  type AdminHealthSeverity,
  type AdminInvariantViolation,
  type AdminSystemEvent,
} from '../../services/adminSupabase';

type EventLevelFilter = 'all' | 'warn' | 'error';

/**
 * Admin observability tab — read-only consolidated view of:
 *   • Health-check status (sorted: failures first; surfaced from `system_health_checks`)
 *   • Invariant violations (active vs. resolved)
 *   • 24h event-level histogram + recent event stream (`system_events`)
 *
 * Server-side `get_admin_health_overview` enforces `assert_is_admin()`. RLS on
 * `system_events` restricts reads to admins, so the event-stream query is safe
 * to run without an additional client gate.
 */
export const AdminHealthEventsView: React.FC = () => {
  const [overview, setOverview] = useState<AdminHealthOverview | null>(null);
  const [events, setEvents] = useState<AdminSystemEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState<EventLevelFilter>('warn');

  const load = useCallback(async () => {
    setError(null);
    const [ov, ev] = await Promise.all([
      adminGetHealthOverview(),
      adminListSystemEvents({
        limit: 100,
        level: eventFilter === 'error' ? 'error' : eventFilter === 'warn' ? 'warn' : null,
      }),
    ]);
    if (!ov) {
      setError(uiCopy.adminHealth.loadFailed);
    }
    setOverview(ov);
    setEvents(ev);
  }, [eventFilter]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    // Auto-refresh every 60s while the tab is mounted; cheap (single RPC + bounded read).
    const id = setInterval(() => {
      if (cancelled) return;
      load();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const overall = useMemo<AdminHealthCheckStatus>(() => {
    const checks = overview?.checks ?? [];
    if (checks.length === 0) return 'unknown';
    if (checks.some((c) => c.status === 'down')) return 'down';
    if (checks.some((c) => c.status === 'degraded')) return 'degraded';
    if (checks.some((c) => c.status === 'unknown')) return 'unknown';
    return 'ok';
  }, [overview]);

  const activeViolations = useMemo(
    () => (overview?.violations ?? []).filter((v) => v.resolved_at == null),
    [overview],
  );
  const resolvedViolations = useMemo(
    () => (overview?.violations ?? []).filter((v) => v.resolved_at != null),
    [overview],
  );

  const totalEvents24h = useMemo(() => {
    const counts = overview?.event_counts_24h ?? {};
    return Object.values(counts).reduce((sum, n) => sum + (Number(n) || 0), 0);
  }, [overview]);

  if (loading) {
    return (
      <View style={styles.centerArea}>
        <ActivityIndicator size="large" color={colors.textPrimary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.scrollArea} contentContainerStyle={{ paddingBottom: 80 }}>
      {/* ── Overview banner ─────────────────────────────────────────────── */}
      <View
        style={[
          styles.overviewBanner,
          { backgroundColor: bannerBgColor(overall), borderColor: bannerBorderColor(overall) },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.overviewLabel}>{overallLabel(overall)}</Text>
          {overview?.generated_at && (
            <Text style={styles.overviewMeta}>
              {uiCopy.adminHealth.lastUpdated}: {formatTimestamp(overview.generated_at)}
            </Text>
          )}
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={handleRefresh} disabled={refreshing}>
          <Text style={styles.refreshBtnLabel}>
            {refreshing ? uiCopy.adminHealth.refreshing : uiCopy.adminHealth.refreshBtn}
          </Text>
        </TouchableOpacity>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* ── Health checks ───────────────────────────────────────────────── */}
      <Text style={styles.sectionTitle}>{uiCopy.adminHealth.sectionHealthChecks}</Text>
      {(overview?.checks ?? []).length === 0 ? (
        <Text style={styles.emptyText}>{uiCopy.adminHealth.noChecks}</Text>
      ) : (
        (overview?.checks ?? []).map((c) => <HealthCheckRow key={c.name} check={c} />)
      )}

      {/* ── Invariant violations ────────────────────────────────────────── */}
      <Text style={styles.sectionTitle}>{uiCopy.adminHealth.sectionViolations}</Text>
      <Text style={styles.subSectionTitle}>
        {uiCopy.adminHealth.activeViolations} ({activeViolations.length})
      </Text>
      {activeViolations.length === 0 ? (
        <Text style={styles.emptyOk}>{uiCopy.adminHealth.noViolationsActive}</Text>
      ) : (
        activeViolations.map((v) => <ViolationRow key={v.id} v={v} />)
      )}
      {resolvedViolations.length > 0 && (
        <>
          <Text style={[styles.subSectionTitle, { marginTop: spacing.md }]}>
            {uiCopy.adminHealth.resolvedViolations} ({resolvedViolations.length})
          </Text>
          {resolvedViolations.slice(0, 10).map((v) => (
            <ViolationRow key={v.id} v={v} resolved />
          ))}
        </>
      )}
      {activeViolations.length === 0 && resolvedViolations.length === 0 && (
        <Text style={styles.emptyText}>{uiCopy.adminHealth.noViolationsAtAll}</Text>
      )}

      {/* ── 24h trend ───────────────────────────────────────────────────── */}
      <Text style={styles.sectionTitle}>{uiCopy.adminHealth.sectionEvents}</Text>
      <View style={styles.trendCard}>
        <Text style={styles.trendTotalLabel}>
          {uiCopy.adminHealth.eventsTotal}:{' '}
          <Text style={styles.trendTotalValue}>{totalEvents24h}</Text>
        </Text>
        <View style={styles.trendRow}>
          {(['debug', 'info', 'warn', 'error', 'fatal'] as const).map((lvl) => {
            const n = Number(overview?.event_counts_24h?.[lvl] ?? 0);
            return (
              <View key={lvl} style={styles.trendCell}>
                <Text style={[styles.trendCellLabel, { color: levelColor(lvl) }]}>
                  {lvl.toUpperCase()}
                </Text>
                <Text style={styles.trendCellValue}>{n}</Text>
              </View>
            );
          })}
        </View>
        {totalEvents24h === 0 && (
          <Text style={styles.emptyText}>{uiCopy.adminHealth.noEvents}</Text>
        )}
      </View>

      {/* ── Event stream ────────────────────────────────────────────────── */}
      <View style={styles.eventStreamHeader}>
        <Text style={styles.subSectionTitle}>{uiCopy.adminHealth.recentEventStream}</Text>
        <View style={styles.eventFilterRow}>
          {(['all', 'warn', 'error'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterPill, eventFilter === f && styles.filterPillActive]}
              onPress={() => setEventFilter(f)}
            >
              <Text
                style={[styles.filterPillLabel, eventFilter === f && styles.filterPillLabelActive]}
              >
                {f === 'all'
                  ? uiCopy.adminHealth.eventLevelAll
                  : f === 'warn'
                    ? uiCopy.adminHealth.eventLevelWarn
                    : uiCopy.adminHealth.eventLevelError}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      {events.length === 0 ? (
        <Text style={styles.emptyText}>{uiCopy.adminHealth.noEventStream}</Text>
      ) : (
        events.map((e) => <EventRow key={e.id} event={e} />)
      )}
    </ScrollView>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

const HealthCheckRow: React.FC<{ check: AdminHealthCheck }> = ({ check }) => {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = check.details && Object.keys(check.details).length > 0;
  return (
    <TouchableOpacity
      activeOpacity={hasDetails ? 0.7 : 1}
      onPress={() => hasDetails && setExpanded((v) => !v)}
      style={[styles.checkCard, { borderLeftColor: statusBorderColor(check.status) }]}
    >
      <View style={styles.checkHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.checkName}>{check.display_name || check.name}</Text>
          {check.description && <Text style={styles.checkDesc}>{check.description}</Text>}
        </View>
        <StatusBadge status={check.status} />
      </View>
      <View style={styles.checkMetaRow}>
        <SeverityBadge severity={check.severity} />
        <View
          style={[
            styles.tagBadge,
            { backgroundColor: check.is_public ? colors.surfaceWarm : colors.surfaceAlt },
          ]}
        >
          <Text style={styles.tagBadgeText}>
            {check.is_public ? uiCopy.adminHealth.publicBadge : uiCopy.adminHealth.privateBadge}
          </Text>
        </View>
        {check.category && (
          <View style={styles.tagBadge}>
            <Text style={styles.tagBadgeText}>{check.category}</Text>
          </View>
        )}
        <Text style={styles.checkTimestamps}>
          {uiCopy.adminHealth.checkLastRun}: {formatTimestamp(check.last_run_at)}
          {' · '}
          {uiCopy.adminHealth.checkLastOk}: {formatTimestamp(check.last_ok_at)}
        </Text>
      </View>
      {expanded && hasDetails && (
        <View style={styles.detailsBox}>
          <Text style={styles.detailsText}>{JSON.stringify(check.details, null, 2)}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const ViolationRow: React.FC<{ v: AdminInvariantViolation; resolved?: boolean }> = ({
  v,
  resolved,
}) => {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = v.details && Object.keys(v.details).length > 0;
  return (
    <TouchableOpacity
      activeOpacity={hasDetails ? 0.7 : 1}
      onPress={() => hasDetails && setExpanded((x) => !x)}
      style={[
        styles.violationCard,
        {
          borderLeftColor: resolved ? colors.successLight : severityBorderColor(v.severity),
          opacity: resolved ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.checkHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.checkName}>{v.check_name}</Text>
          <Text style={styles.checkDesc}>
            {uiCopy.adminHealth.violationDetectedAt}: {formatTimestamp(v.detected_at)}
            {resolved &&
              v.resolved_at &&
              ` · ${uiCopy.adminHealth.violationResolvedAt}: ${formatTimestamp(v.resolved_at)}`}
          </Text>
        </View>
        <SeverityBadge severity={v.severity} />
      </View>
      {v.count_or_value != null && (
        <Text style={styles.violationCountText}>
          {uiCopy.adminHealth.violationCountValue}: {v.count_or_value}
        </Text>
      )}
      {expanded && hasDetails && (
        <View style={styles.detailsBox}>
          <Text style={styles.detailsText}>{JSON.stringify(v.details, null, 2)}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const EventRow: React.FC<{ event: AdminSystemEvent }> = ({ event }) => {
  const [expanded, setExpanded] = useState(false);
  const hasPayload = event.payload && Object.keys(event.payload).length > 0;
  return (
    <TouchableOpacity
      activeOpacity={hasPayload ? 0.7 : 1}
      onPress={() => hasPayload && setExpanded((x) => !x)}
      style={[styles.eventRow, { borderLeftColor: levelColor(event.level) }]}
    >
      <View style={styles.eventHeaderRow}>
        <Text style={[styles.eventLevel, { color: levelColor(event.level) }]}>
          {event.level.toUpperCase()}
        </Text>
        <Text style={styles.eventTime}>{formatTimestamp(event.created_at)}</Text>
      </View>
      <Text style={styles.eventName}>
        {event.source ? `${event.source} · ` : ''}
        {event.event}
      </Text>
      {event.message && <Text style={styles.eventMessage}>{event.message}</Text>}
      {expanded && hasPayload && (
        <View style={styles.detailsBox}>
          <Text style={styles.detailsText}>{JSON.stringify(event.payload, null, 2)}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const StatusBadge: React.FC<{ status: AdminHealthCheckStatus }> = ({ status }) => (
  <View style={[styles.statusBadge, { backgroundColor: statusBgColor(status) }]}>
    <Text style={[styles.statusBadgeText, { color: statusTextColor(status) }]}>
      {statusLabel(status)}
    </Text>
  </View>
);

const SeverityBadge: React.FC<{ severity: AdminHealthSeverity }> = ({ severity }) => (
  <View style={[styles.tagBadge, { backgroundColor: severityBgColor(severity) }]}>
    <Text style={[styles.tagBadgeText, { color: severityTextColor(severity) }]}>
      {severityLabel(severity)}
    </Text>
  </View>
);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (color + label maps)
// ─────────────────────────────────────────────────────────────────────────────

function overallLabel(s: AdminHealthCheckStatus): string {
  if (s === 'ok') return uiCopy.adminHealth.overallOk;
  if (s === 'degraded') return uiCopy.adminHealth.overallDegraded;
  if (s === 'down') return uiCopy.adminHealth.overallDown;
  return uiCopy.adminHealth.overallUnknown;
}
function statusLabel(s: AdminHealthCheckStatus): string {
  if (s === 'ok') return uiCopy.adminHealth.statusOk;
  if (s === 'degraded') return uiCopy.adminHealth.statusDegraded;
  if (s === 'down') return uiCopy.adminHealth.statusDown;
  return uiCopy.adminHealth.statusUnknown;
}
function severityLabel(s: AdminHealthSeverity): string {
  if (s === 'critical') return uiCopy.adminHealth.severityCritical;
  if (s === 'warning') return uiCopy.adminHealth.severityWarning;
  return uiCopy.adminHealth.severityInfo;
}
function bannerBgColor(s: AdminHealthCheckStatus): string {
  if (s === 'ok') return '#E8F5E9';
  if (s === 'degraded') return '#FFF8E1';
  if (s === 'down') return '#FDECEA';
  return colors.surfaceAlt;
}
function bannerBorderColor(s: AdminHealthCheckStatus): string {
  if (s === 'ok') return colors.success;
  if (s === 'degraded') return colors.warning;
  if (s === 'down') return colors.error;
  return colors.borderLight;
}
function statusBorderColor(s: AdminHealthCheckStatus): string {
  if (s === 'ok') return colors.success;
  if (s === 'degraded') return colors.warning;
  if (s === 'down') return colors.error;
  return colors.borderLight;
}
function statusBgColor(s: AdminHealthCheckStatus): string {
  if (s === 'ok') return '#E8F5E9';
  if (s === 'degraded') return '#FFF8E1';
  if (s === 'down') return '#FDECEA';
  return colors.surfaceAlt;
}
function statusTextColor(s: AdminHealthCheckStatus): string {
  if (s === 'ok') return colors.success;
  if (s === 'degraded') return colors.warningDark;
  if (s === 'down') return colors.errorDark;
  return colors.textSecondary;
}
function severityBgColor(s: AdminHealthSeverity): string {
  if (s === 'critical') return '#FDECEA';
  if (s === 'warning') return '#FFF8E1';
  return colors.surfaceAlt;
}
function severityTextColor(s: AdminHealthSeverity): string {
  if (s === 'critical') return colors.errorDark;
  if (s === 'warning') return colors.warningDark;
  return colors.textSecondary;
}
function severityBorderColor(s: AdminHealthSeverity): string {
  if (s === 'critical') return colors.error;
  if (s === 'warning') return colors.warning;
  return colors.borderLight;
}
function levelColor(level: string): string {
  if (level === 'fatal' || level === 'error') return colors.error;
  if (level === 'warn') return colors.warning;
  if (level === 'info') return colors.textPrimary;
  return colors.textSecondary;
}
function formatTimestamp(ts: string | null): string {
  if (!ts) return uiCopy.adminHealth.never;
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scrollArea: { flex: 1, paddingHorizontal: spacing.md },
  centerArea: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  overviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    marginTop: spacing.md,
    borderRadius: 8,
    borderLeftWidth: 4,
  },
  overviewLabel: {
    ...typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
    fontSize: 16,
  },
  overviewMeta: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  refreshBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.textPrimary,
    borderRadius: 6,
  },
  refreshBtnLabel: {
    color: colors.surface,
    ...typography.label,
    fontSize: 11,
  },
  errorBanner: {
    backgroundColor: '#FDECEA',
    padding: spacing.sm,
    marginTop: spacing.sm,
    borderRadius: 6,
    borderLeftWidth: 4,
    borderLeftColor: colors.error,
  },
  errorText: { color: colors.errorDark, ...typography.body, fontSize: 13 },
  sectionTitle: {
    ...typography.label,
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  subSectionTitle: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    fontSize: 13,
  },
  emptyText: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: 'italic',
    paddingVertical: spacing.sm,
  },
  emptyOk: {
    ...typography.body,
    fontSize: 13,
    color: colors.success,
    paddingVertical: spacing.sm,
  },
  checkCard: {
    backgroundColor: colors.surface,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
  },
  checkHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  checkName: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
    fontSize: 14,
  },
  checkDesc: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  checkMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  checkTimestamps: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    marginLeft: 'auto',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  statusBadgeText: {
    ...typography.label,
    fontSize: 10,
  },
  tagBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.surfaceAlt,
  },
  tagBadgeText: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  detailsBox: {
    marginTop: spacing.xs,
    padding: spacing.xs,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 4,
  },
  detailsText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: colors.textPrimary,
  },
  violationCard: {
    backgroundColor: colors.surface,
    padding: spacing.sm,
    marginBottom: spacing.xs,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
  },
  violationCountText: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
  },
  trendCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  trendTotalLabel: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  trendTotalValue: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  trendRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  trendCell: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    padding: spacing.sm,
    borderRadius: 4,
    alignItems: 'center',
  },
  trendCellLabel: {
    ...typography.label,
    fontSize: 10,
  },
  trendCellValue: {
    ...typography.body,
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 2,
  },
  eventStreamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  eventFilterRow: {
    flexDirection: 'row',
    gap: 4,
  },
  filterPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  filterPillActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  filterPillLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  filterPillLabelActive: {
    color: colors.surface,
  },
  eventRow: {
    backgroundColor: colors.surface,
    padding: spacing.sm,
    marginBottom: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
  },
  eventHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eventLevel: {
    ...typography.label,
    fontSize: 10,
  },
  eventTime: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
  },
  eventName: {
    ...typography.body,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: 2,
  },
  eventMessage: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
});

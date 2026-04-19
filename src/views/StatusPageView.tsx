import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import { navigatePublicPath } from '../utils/publicLegalRoutes';
import { supabase } from '../../lib/supabase';
import {
  overallLabel,
  overallColor,
  formatLastUpdated,
  isPublicHealthSummary,
  type OverallStatus,
  type PublicHealthSummary,
} from './statusPageHelpers';

/**
 * Public live status page (/status). Polls public.get_public_health_summary()
 * every 60 seconds and shows aggregated platform health.
 *
 * The RPC is provisioned by the observability migrations
 * (`obs-migration-foundation` / `obs-migration-cron`). Until those have run on a
 * given environment the RPC returns an error and this page renders a graceful
 * "status temporarily unavailable" state instead of crashing.
 *
 * No authentication is required — the RPC is SECURITY DEFINER and exposes only
 * the subset of system_health_checks where `public_visible = true`.
 *
 * Pure presentation helpers (status → label, status → color, formatting,
 * payload-shape validation) live in `./statusPageHelpers` and are unit-tested
 * separately.
 */

const POLL_INTERVAL_MS = 60_000;

export const StatusPageView: React.FC = () => {
  const [summary, setSummary] = useState<PublicHealthSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadFailed, setLoadFailed] = useState<boolean>(false);

  const fetchSummary = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_public_health_summary');
      if (error) {
        // RPC may not yet be deployed in this environment (observability migration pending).
        // Render the graceful unavailable state — the route itself stays valid.
        setLoadFailed(true);
        return;
      }
      const payload = Array.isArray(data) ? data[0] : data;
      if (isPublicHealthSummary(payload)) {
        setSummary(payload);
        setLoadFailed(false);
      } else {
        setLoadFailed(true);
      }
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSummary();
    const id = setInterval(() => {
      void fetchSummary();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchSummary]);

  const overall: OverallStatus = summary?.overall_status ?? 'unknown';
  const checks = summary?.checks ?? [];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigatePublicPath('/trust')}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={uiCopy.trust.statusBackToTrust}
        >
          <Text style={styles.backLabel}>{uiCopy.trust.statusBackToTrust}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{uiCopy.trust.statusTitle}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>{uiCopy.trust.statusSubtitle}</Text>

        <View style={[styles.banner, { backgroundColor: overallColor(overall) }]}>
          <Text style={styles.bannerLabel}>{overallLabel(overall)}</Text>
          {summary?.last_updated && (
            <Text style={styles.bannerMeta}>
              {uiCopy.trust.statusLastUpdated}: {formatLastUpdated(summary.last_updated)}
            </Text>
          )}
        </View>

        {loading && !summary && (
          <View style={styles.loaderRow}>
            <ActivityIndicator size="small" color={colors.textPrimary} />
            <Text style={styles.loaderLabel}>{uiCopy.trust.statusLoading}</Text>
          </View>
        )}

        {loadFailed && <Text style={styles.failNotice}>{uiCopy.trust.statusLoadFailed}</Text>}

        {!loading && !loadFailed && checks.length === 0 && (
          <Text style={styles.failNotice}>{uiCopy.trust.statusEmpty}</Text>
        )}

        {checks.length > 0 && (
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.cell, styles.cellHeader, styles.colCheck]}>
                {uiCopy.trust.statusCheckHeader}
              </Text>
              <Text style={[styles.cell, styles.cellHeader, styles.colStatus]}>
                {uiCopy.trust.statusCheckStatus}
              </Text>
              <Text style={[styles.cell, styles.cellHeader, styles.colLastRun]}>
                {uiCopy.trust.statusCheckLastRun}
              </Text>
            </View>
            {checks.map((c) => (
              <View key={c.name} style={styles.tableRow}>
                <Text style={[styles.cell, styles.cellPrimary, styles.colCheck]}>
                  {c.display_name || c.name}
                </Text>
                <View style={[styles.cell, styles.colStatus]}>
                  <View style={[styles.statusPill, { backgroundColor: overallColor(c.status) }]}>
                    <Text style={styles.statusPillLabel}>{overallLabel(c.status)}</Text>
                  </View>
                </View>
                <Text style={[styles.cell, styles.colLastRun]}>
                  {formatLastUpdated(c.last_run_at)}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.contactNote}>{uiCopy.trust.statusContactNote}</Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    minWidth: 140,
  },
  backLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  title: {
    ...typography.heading,
    fontSize: 18,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    minWidth: 140,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xl,
    maxWidth: 760,
    alignSelf: 'center',
    width: '100%',
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  banner: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: 6,
    marginBottom: spacing.lg,
  },
  bannerLabel: {
    ...typography.label,
    fontSize: 14,
    color: colors.surface,
  },
  bannerMeta: {
    ...typography.body,
    fontSize: 12,
    color: colors.surface,
    marginTop: spacing.xs,
    opacity: 0.9,
  },
  loaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  loaderLabel: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
  },
  failNotice: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginBottom: spacing.lg,
  },
  table: {
    marginBottom: spacing.lg,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  cell: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    paddingHorizontal: spacing.xs,
  },
  cellHeader: {
    ...typography.label,
    fontSize: 11,
    color: colors.textPrimary,
  },
  cellPrimary: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  colCheck: { flex: 4 },
  colStatus: { flex: 2 },
  colLastRun: { flex: 3 },
  statusPill: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  statusPillLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.surface,
  },
  contactNote: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: spacing.lg,
    textAlign: 'center',
  },
});

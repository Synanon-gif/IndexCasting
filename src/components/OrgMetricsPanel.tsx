/**
 * OrgMetricsPanel (Owner-only)
 *
 * Displays aggregated option metrics: total options, confirmed, conversion rate.
 * Only rendered for organization owners — the RPC also enforces this server-side.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import { getOrgMetrics, type OrgMetrics } from '../services/orgMetricsSupabase';

interface Props {
  orgId: string;
  userRole: string;
}

export const OrgMetricsPanel: React.FC<Props> = ({ orgId, userRole }) => {
  const [metrics, setMetrics] = useState<OrgMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const copy = uiCopy.dashboard;

  const load = useCallback(async () => {
    if (userRole !== 'owner') return;
    setLoading(true);
    setError(false);
    const result = await getOrgMetrics(orgId);
    if (!result) {
      setError(true);
    } else {
      setMetrics(result);
    }
    setLoading(false);
  }, [orgId, userRole]);

  useEffect(() => {
    void load();
  }, [load]);

  if (userRole !== 'owner') return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{copy.orgMetricsTitle}</Text>

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
          <Text style={styles.loadingText}>{copy.orgMetricsLoading}</Text>
        </View>
      )}

      {error && !loading && (
        <Text style={styles.errorText}>{copy.orgMetricsError}</Text>
      )}

      {metrics && !loading && (
        <View style={styles.metricsRow}>
          <MetricCard label={copy.orgMetricsTotalOptions} value={String(metrics.total_options)} />
          <MetricCard label={copy.orgMetricsConfirmed} value={String(metrics.confirmed_options)} accent />
          <MetricCard
            label={copy.orgMetricsConversion}
            value={`${metrics.conversion_rate}%`}
            accent={metrics.conversion_rate >= 50}
          />
        </View>
      )}
    </View>
  );
};

const MetricCard: React.FC<{ label: string; value: string; accent?: boolean }> = ({
  label,
  value,
  accent,
}) => (
  <View style={styles.card}>
    <Text style={[styles.cardValue, accent && styles.cardValueAccent]}>{value}</Text>
    <Text style={styles.cardLabel}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  errorText: {
    fontSize: 13,
    color: '#dc2626',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  card: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  cardValue: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  cardValueAccent: {
    color: colors.accentGreen,
  },
  cardLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});

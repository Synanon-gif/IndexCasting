import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import {
  getMyAgencyStorageUsage,
  formatStorageBytes,
  getStorageUsagePercent,
  AGENCY_STORAGE_LIMIT_BYTES,
  type AgencyStorageUsage,
} from '../services/agencyStorageSupabase';

type Props = {
  /** Set to true to force a re-fetch (e.g. after an upload or deletion). */
  refreshTrigger?: number;
};

export const AgencyStorageWidget: React.FC<Props> = ({ refreshTrigger }) => {
  const [usage, setUsage] = useState<AgencyStorageUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await getMyAgencyStorageUsage();
      setUsage(data);
      if (!data) setError(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshTrigger]);

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.sectionTitle}>{uiCopy.storage.title}</Text>
        <ActivityIndicator size="small" color={colors.accentGreen} style={{ marginTop: spacing.sm }} />
      </View>
    );
  }

  if (error || !usage) {
    return (
      <View style={styles.container}>
        <Text style={styles.sectionTitle}>{uiCopy.storage.title}</Text>
        <Text style={styles.errorText}>{uiCopy.storage.loadError}</Text>
        <TouchableOpacity onPress={() => void load()} style={styles.retryBtn}>
          <Text style={styles.retryLabel}>{uiCopy.common.retry}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const usedBytes = usage.used_bytes ?? 0;

  // Unlimited mode: show a simple label instead of a progress bar.
  if (usage.is_unlimited) {
    return (
      <View style={styles.container}>
        <Text style={styles.sectionTitle}>{uiCopy.storage.title}</Text>
        <View style={styles.row}>
          <Text style={styles.usageLabel}>{uiCopy.storage.used}</Text>
          <Text style={styles.usageValue}>{formatStorageBytes(usedBytes)}</Text>
        </View>
        <View style={styles.unlimitedBadge}>
          <Text style={styles.unlimitedBadgeText}>{uiCopy.storage.unlimitedStorage}</Text>
        </View>
      </View>
    );
  }

  const limitBytes = usage.effective_limit_bytes ?? usage.limit_bytes ?? AGENCY_STORAGE_LIMIT_BYTES;
  const percent = getStorageUsagePercent(usedBytes, limitBytes);
  const isWarning = percent >= 80 && percent < 95;
  const isCritical = percent >= 95;

  const barColor = isCritical
    ? '#B91C1C'   // red
    : isWarning
    ? '#B45309'   // amber
    : colors.buttonOptionGreen;

  const warningText = isCritical
    ? uiCopy.storage.warning95
    : isWarning
    ? uiCopy.storage.warning80
    : null;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>{uiCopy.storage.title}</Text>

      <View style={styles.row}>
        <Text style={styles.usageLabel}>
          {uiCopy.storage.used}
        </Text>
        <Text style={[styles.usageValue, isCritical && styles.critical, isWarning && styles.warning]}>
          {formatStorageBytes(usedBytes)}{' '}
          <Text style={styles.limitText}>
            {uiCopy.storage.of} {formatStorageBytes(limitBytes)}
          </Text>
        </Text>
      </View>

      {/* Progress bar */}
      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width: `${Math.min(100, percent).toFixed(1)}%` as any, backgroundColor: barColor },
          ]}
        />
      </View>

      <Text style={styles.percentText}>{percent.toFixed(0)}% used</Text>

      {warningText ? (
        <View style={[styles.warningBadge, isCritical && styles.criticalBadge]}>
          <Text style={[styles.warningBadgeText, isCritical && styles.criticalBadgeText]}>
            {warningText}
          </Text>
        </View>
      ) : null}

      {isCritical ? (
        <View style={styles.limitReachedBox}>
          <Text style={styles.limitReachedTitle}>{uiCopy.storage.limitReached}</Text>
          <Text style={styles.limitReachedDetail}>{uiCopy.storage.limitReachedDetail}</Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.label,
    marginBottom: spacing.sm,
    color: colors.textPrimary,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.xs,
  },
  usageLabel: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
  },
  usageValue: {
    ...typography.body,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  limitText: {
    fontWeight: '400',
    color: colors.textSecondary,
  },
  warning: {
    color: '#B45309',
  },
  critical: {
    color: '#B91C1C',
  },
  barTrack: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
  },
  percentText: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'right',
    marginBottom: spacing.xs,
  },
  warningBadge: {
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  criticalBadge: {
    backgroundColor: '#FEE2E2',
  },
  warningBadgeText: {
    ...typography.body,
    fontSize: 12,
    color: '#92400E',
  },
  criticalBadgeText: {
    color: '#991B1B',
  },
  limitReachedBox: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 10,
    padding: spacing.sm,
    backgroundColor: '#FFF5F5',
  },
  limitReachedTitle: {
    ...typography.label,
    fontSize: 11,
    color: '#B91C1C',
    marginBottom: 2,
  },
  limitReachedDetail: {
    ...typography.body,
    fontSize: 12,
    color: '#7F1D1D',
  },
  errorText: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  retryBtn: {
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
  },
  retryLabel: {
    ...typography.body,
    fontSize: 12,
    color: colors.accentGreen,
    textDecorationLine: 'underline',
  },
  unlimitedBadge: {
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: '#D1FAE5',
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  unlimitedBadgeText: {
    ...typography.label,
    fontSize: 12,
    color: '#065F46',
  },
});

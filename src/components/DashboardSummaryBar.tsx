/**
 * DashboardSummaryBar
 *
 * Displays three key metrics at the top of the agency/client dashboard:
 *   Open Requests | Unread Messages | Today's Events
 *
 * Each chip is clickable and navigates to the relevant tab.
 * Shows a loading skeleton while data is fetching.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import { getDashboardSummary, type DashboardSummary } from '../services/dashboardSupabase';

interface Props {
  orgId: string;
  userId: string;
  onPressRequests?: () => void;
  onPressMessages?: () => void;
  onPressCalendar?: () => void;
}

export const DashboardSummaryBar: React.FC<Props> = ({
  orgId,
  userId,
  onPressRequests,
  onPressMessages,
  onPressCalendar,
}) => {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const copy = uiCopy.dashboard;

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getDashboardSummary(orgId, userId);
    setSummary(result);
    setLoading(false);
  }, [orgId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
        <Text style={styles.loadingText}>{copy.summaryLoading}</Text>
      </View>
    );
  }

  const chips: Array<{
    label: string;
    count: number;
    onPress?: () => void;
    highlight?: boolean;
  }> = [
    {
      label: copy.summaryOpenRequests,
      count: summary?.open_option_requests ?? 0,
      onPress: onPressRequests,
      highlight: (summary?.open_option_requests ?? 0) > 0,
    },
    {
      label: copy.summaryUnread,
      count: summary?.unread_threads ?? 0,
      onPress: onPressMessages,
      highlight: (summary?.unread_threads ?? 0) > 0,
    },
    {
      label: copy.summaryToday,
      count: summary?.today_events ?? 0,
      onPress: onPressCalendar,
    },
  ];

  return (
    <View style={styles.container}>
      {chips.map((chip, _idx) => (
        <TouchableOpacity
          key={chip.label}
          style={[styles.chip, chip.highlight && styles.chipHighlight]}
          onPress={chip.onPress}
          disabled={!chip.onPress}
          activeOpacity={chip.onPress ? 0.7 : 1}
        >
          <Text style={[styles.count, chip.highlight && styles.countHighlight]}>
            {chip.count}
          </Text>
          <Text style={styles.label}>{chip.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
  },
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipHighlight: {
    backgroundColor: '#1a1a1a',
    borderColor: '#1a1a1a',
  },
  count: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    lineHeight: 24,
  },
  countHighlight: {
    color: '#ffffff',
  },
  label: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
    textAlign: 'center',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});

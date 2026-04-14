import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { getAgencyModels } from '../services/apiService';
import { AgencyRecruitingView } from '../views/AgencyRecruitingView';
import { BookingChatView } from '../views/BookingChatView';
import { useAuth } from '../context/AuthContext';
import { uiCopy } from '../constants/uiCopy';

type AgencyModel = {
  id: string;
  name: string;
  traction: number;
  visibility: {
    commercial: boolean;
    highFashion: boolean;
  };
};

type AgencyDashboardScreenProps = {
  onBackToRoleSelection?: () => void;
};

export const AgencyDashboardScreen: React.FC<AgencyDashboardScreenProps> = ({
  onBackToRoleSelection,
}) => {
  const { profile } = useAuth();
  const [items, setItems] = useState<AgencyModel[]>([]);
  const [showRecruiting, setShowRecruiting] = useState(false);
  const [openRecruitingBookingThreadId, setOpenRecruitingBookingThreadId] = useState<string | null>(
    null,
  );

  // profile.agency_id is the only safe lookup — no email-match, no agencies[0] fallback.
  // It is loaded via get_my_org_context() (SECURITY DEFINER, org-scoped) on every login.
  const currentAgencyId = profile?.agency_id ?? '';

  useEffect(() => {
    if (!currentAgencyId) return;
    let cancelled = false;
    getAgencyModels(currentAgencyId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((data: any) => {
        if (cancelled) return;
        setItems(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data.map((m: any) => ({
            id: m.id,
            name: m.name,
            traction: m.traction ?? 0,
            visibility: {
              commercial: m.isVisibleCommercial ?? true,
              highFashion: m.isVisibleFashion ?? false,
            },
          })),
        );
      })
      .catch((e) => console.error('[AgencyDashboard] getAgencyModels error:', e));
    return () => {
      cancelled = true;
    };
  }, [currentAgencyId]);

  if (!currentAgencyId) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>{uiCopy.common.noAgencyContext}</Text>
        </View>
      </View>
    );
  }

  if (showRecruiting) {
    return (
      <>
        <AgencyRecruitingView
          onBack={() => setShowRecruiting(false)}
          agencyId={currentAgencyId}
          onOpenBookingChat={(threadId) => setOpenRecruitingBookingThreadId(threadId)}
        />
        {openRecruitingBookingThreadId != null && (
          <BookingChatView
            threadId={openRecruitingBookingThreadId}
            fromRole="agency"
            onClose={() => setOpenRecruitingBookingThreadId(null)}
          />
        )}
      </>
    );
  }

  return (
    <View style={styles.container}>
      {onBackToRoleSelection && (
        <TouchableOpacity
          style={styles.backRow}
          onPress={onBackToRoleSelection}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backLabel}>Logout</Text>
        </TouchableOpacity>
      )}
      <Text style={styles.label}>Agency workspace</Text>
      <Text style={styles.heading}>Traction</Text>

      <TouchableOpacity style={styles.recruitingEntry} onPress={() => setShowRecruiting(true)}>
        <Text style={styles.recruitingEntryLabel}>Recruiting</Text>
        <Text style={styles.recruitingEntryHint}>Review model applications</Text>
      </TouchableOpacity>

      <View style={styles.list}>
        {items.map((m) => (
          <View key={m.id} style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.name}>{m.name}</Text>
              <Text style={styles.traction}>{m.traction} swipes</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  emptyStateText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  backArrow: {
    fontSize: 22,
    color: colors.textPrimary,
  },
  backLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  heading: {
    ...typography.heading,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  recruitingEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  recruitingEntryLabel: {
    ...typography.label,
    color: colors.textPrimary,
  },
  recruitingEntryHint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  rowLeft: {
    flex: 1,
    gap: 2,
  },
  name: {
    ...typography.body,
    color: colors.textPrimary,
  },
  traction: {
    ...typography.body,
    color: colors.textSecondary,
  },
});

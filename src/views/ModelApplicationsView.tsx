/**
 * Für Models ohne zugeordneten Model-Eintrag: „My Applications“ + Apply as Model.
 * Nach Login/Sign-up als Model sichtbar, bis eine Agentur die Bewerbung annimmt.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { getApplicationsForApplicant } from '../services/applicationsSupabase';
import type { SupabaseApplication } from '../services/applicationsSupabase';
import { ApplyFormView } from './ApplyFormView';

type ModelApplicationsViewProps = {
  applicantUserId: string;
  onBackToRoleSelection: () => void;
};

function toStatusLabel(status: string): string {
  if (status === 'pending') return 'Pending';
  if (status === 'accepted') return 'Accepted';
  if (status === 'rejected') return 'Declined';
  return status;
}

function statusColor(status: string): string {
  if (status === 'accepted') return colors.accentGreen;
  if (status === 'rejected') return colors.textSecondary;
  return '#F9A825';
}

export const ModelApplicationsView: React.FC<ModelApplicationsViewProps> = ({
  applicantUserId,
  onBackToRoleSelection,
}) => {
  const [applications, setApplications] = useState<SupabaseApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [showApplyForm, setShowApplyForm] = useState(false);

  const load = () => {
    setLoading(true);
    getApplicationsForApplicant(applicantUserId).then((list) => {
      setApplications(list);
      setLoading(false);
    });
  };

  useEffect(() => {
    load();
  }, [applicantUserId]);

  if (showApplyForm) {
    return (
      <ApplyFormView
        onBack={() => {
          setShowApplyForm(false);
          load();
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backRow} onPress={onBackToRoleSelection} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <Text style={styles.backArrow}>←</Text>
        <Text style={styles.backLabel}>Logout</Text>
      </TouchableOpacity>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg }}>
        <Text style={styles.brand}>INDEX CASTING</Text>
      </View>
      <Text style={styles.heading}>My Applications</Text>
      <Text style={styles.subtitle}>Apply to agencies. When accepted, you will be linked to that agency.</Text>

      <TouchableOpacity style={styles.applyBtn} onPress={() => setShowApplyForm(true)}>
        <Text style={styles.applyBtnLabel}>+ Apply as Model</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator size="small" color={colors.textPrimary} style={{ marginTop: spacing.lg }} />
      ) : applications.length === 0 ? (
        <Text style={styles.meta}>No applications yet. Tap „Apply as Model“ to submit one.</Text>
      ) : (
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {applications.map((app) => (
            <View key={app.id} style={styles.card}>
              <Text style={styles.name}>{[app.first_name, app.last_name].filter(Boolean).join(' ')}</Text>
              <Text style={styles.meta}>{app.height} cm · {app.city ?? '—'}</Text>
              <View style={[styles.badge, { backgroundColor: statusColor(app.status) }]}>
                <Text style={styles.badgeLabel}>{toStatusLabel(app.status)}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  backArrow: { fontSize: 24, color: colors.textPrimary, marginRight: spacing.sm },
  backLabel: { ...typography.label, color: colors.textSecondary },
  brand: { ...typography.heading, fontSize: 16, color: colors.textPrimary },
  heading: { ...typography.heading, fontSize: 20, color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { ...typography.body, fontSize: 12, color: colors.textSecondary, marginBottom: spacing.lg },
  applyBtn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.textPrimary,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  applyBtnLabel: { ...typography.label, color: colors.textPrimary },
  list: { flex: 1 },
  card: {
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  name: { ...typography.label, color: colors.textPrimary, marginBottom: 4 },
  meta: { ...typography.body, fontSize: 12, color: colors.textSecondary, marginBottom: 8 },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
  },
  badgeLabel: { ...typography.label, fontSize: 10, color: '#fff' },
});

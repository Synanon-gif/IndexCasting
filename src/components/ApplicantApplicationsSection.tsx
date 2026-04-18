/**
 * Shared section that renders an applicant's model applications:
 * - List of submitted applications with status badge + agency name + chat button
 * - Delete button for `pending` / `rejected` / `representation_ended`
 * - "An agency wants to represent you" banner with Accept / Decline actions for
 *   `pending_model_confirmation`
 *
 * Used in both `ModelApplicationsView` (model has no `models` row yet) and
 * `ModelProfileScreen` (model already has a `models` row but a fresh global
 * application can still arrive). Single source of truth for the UI.
 *
 * Chat opening is delegated to the parent via `onChatOpen` so each host can
 * open the chat in the way that fits its layout (modal, dedicated tab, …).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  Alert,
  Platform,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { getApplicationsForApplicant, deleteApplication } from '../services/applicationsSupabase';
import type { SupabaseApplication } from '../services/applicationsSupabase';
import {
  refreshApplications,
  confirmApplicationByModel,
  rejectApplicationByModel,
  subscribeApplications,
} from '../store/applicationsStore';
import { getAgencyChatDisplayById } from '../services/agenciesSupabase';
import { uiCopy } from '../constants/uiCopy';
import { useModelAgency } from '../context/ModelAgencyContext';

export type ApplicantApplicationsSectionProps = {
  /** Auth user id of the applicant. */
  applicantUserId: string;
  /**
   * Compact mode: hides the heading row and tightens spacing for embedding
   * inside an existing screen (e.g. `ModelProfileScreen` Home tab).
   */
  compact?: boolean;
  /**
   * Called when the user taps the chat button on an application.
   * The parent decides how to render the chat (inline modal, dedicated tab, …).
   */
  onChatOpen?: (threadId: string, agencyName: string | undefined, agencyId: string | null) => void;
  /**
   * Called after applications are loaded so the parent can react (e.g. set
   * `applicantHasApplications` flags). The list is already de-duplicated by
   * Supabase and sorted by created_at desc.
   */
  onApplicationsLoaded?: (apps: SupabaseApplication[]) => void;
};

function toStatusLabel(status: string): string {
  if (status === 'pending') return uiCopy.modelApplications.statusPending;
  if (status === 'pending_model_confirmation')
    return uiCopy.modelApplications.statusRepresentationRequest;
  if (status === 'accepted') return uiCopy.modelApplications.statusAccepted;
  if (status === 'representation_ended') return uiCopy.modelApplications.statusRepresentationEnded;
  if (status === 'rejected') return uiCopy.modelApplications.statusDeclined;
  return status;
}

function statusColor(status: string): string {
  if (status === 'accepted') return colors.accentGreen;
  if (status === 'rejected') return colors.textSecondary;
  if (status === 'representation_ended') return colors.textSecondary;
  if (status === 'pending_model_confirmation') return colors.warningDark;
  return '#F9A825';
}

/**
 * Resolves the display agency name from a PostgREST-embedded application row.
 * Prefers the agency that accepted (accepted_agency, joined on accepted_by_agency_id)
 * over the originally targeted agency (agencies, joined on agency_id) so that
 * global applications (agency_id = NULL) show the correct accepting agency name.
 */
function embeddedAgencyName(app: SupabaseApplication): string | undefined {
  const accepted = app.accepted_agency;
  if (accepted != null) {
    if (Array.isArray(accepted)) {
      const name = (accepted[0] as { name?: string } | undefined)?.name;
      if (name) return name;
    } else if (accepted.name) {
      return accepted.name;
    }
  }
  const ag = app.agencies;
  if (ag == null) return undefined;
  if (Array.isArray(ag)) return (ag[0] as { name?: string } | undefined)?.name;
  return ag.name;
}

export const ApplicantApplicationsSection: React.FC<ApplicantApplicationsSectionProps> = ({
  applicantUserId,
  compact = false,
  onChatOpen,
  onApplicationsLoaded,
}) => {
  const { reload: reloadModelAgencies } = useModelAgency();

  const [applications, setApplications] = useState<SupabaseApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [agencyNames, setAgencyNames] = useState<Record<string, string>>({});
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDeleteApp, setPendingDeleteApp] = useState<SupabaseApplication | null>(null);

  const load = (signal?: { cancelled: boolean }): void => {
    setLoading(true);
    setLoadError(false);
    getApplicationsForApplicant(applicantUserId)
      .then(async (list) => {
        if (signal?.cancelled) return;
        setApplications(list);
        setLoading(false);
        if (onApplicationsLoaded) {
          try {
            onApplicationsLoaded(list);
          } catch (e) {
            console.error('ApplicantApplicationsSection onApplicationsLoaded threw:', e);
          }
        }
        const map: Record<string, string> = {};
        for (const a of list) {
          if (!a.agency_id) continue;
          const n = embeddedAgencyName(a)?.trim();
          if (n) map[a.agency_id] = n;
        }
        const allIds = [...new Set(list.map((x) => x.agency_id).filter(Boolean))] as string[];
        for (const id of allIds) {
          if (signal?.cancelled) break;
          if (map[id]) continue;
          try {
            const row = await getAgencyChatDisplayById(id);
            if (row?.name) map[id] = row.name;
          } catch {
            /* ignore — fallback name will be used */
          }
        }
        if (!signal?.cancelled) setAgencyNames(map);
      })
      .catch((e) => {
        console.error('ApplicantApplicationsSection load error:', e);
        if (!signal?.cancelled) {
          setLoading(false);
          setLoadError(true);
        }
      });
  };

  // Keep latest `load` accessible from store-subscription callback without
  // adding it to the effect dependency array (would re-subscribe on every render).
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const signal = { cancelled: false };
    load(signal);
    return () => {
      signal.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicantUserId]);

  // Defense-in-depth: re-fetch from server whenever the applications store
  // notifies (e.g. after agency-side accept, model-side confirm/reject, delete).
  // This keeps the banner + status badges in sync across all flows even if the
  // mutation happened in a different component or surface.
  useEffect(() => {
    const unsub = subscribeApplications(() => {
      loadRef.current();
    });
    return unsub;
  }, []);

  const runConfirmedDelete = async (app: SupabaseApplication): Promise<void> => {
    if (
      app.status !== 'pending' &&
      app.status !== 'rejected' &&
      app.status !== 'representation_ended'
    ) {
      return;
    }
    setDeletingId(app.id);
    const ok = await deleteApplication(app.id, applicantUserId);
    setDeletingId(null);
    if (ok) {
      setApplications((prev) => prev.filter((x) => x.id !== app.id));
      await refreshApplications();
      load();
    } else if (Platform.OS === 'web') {
      Alert.alert(
        uiCopy.modelApplications.deleteFailedTitle,
        uiCopy.modelApplications.deleteFailedBody,
      );
    } else {
      Alert.alert(uiCopy.alerts.deleteFailed, uiCopy.alerts.tryAgain);
    }
  };

  const handleDeleteApplication = (app: SupabaseApplication): void => {
    if (
      app.status !== 'pending' &&
      app.status !== 'rejected' &&
      app.status !== 'representation_ended'
    ) {
      return;
    }
    if (Platform.OS === 'web') {
      setPendingDeleteApp(app);
      return;
    }
    Alert.alert(
      uiCopy.modelApplications.deleteConfirmTitle,
      uiCopy.modelApplications.deleteConfirmBody,
      [
        { text: uiCopy.common.cancel, style: 'cancel' },
        {
          text: uiCopy.modelApplications.deleteConfirmAction,
          style: 'destructive',
          onPress: () => void runConfirmedDelete(app),
        },
      ],
    );
  };

  const handleConfirmRepresentation = async (appId: string): Promise<void> => {
    setConfirmingId(appId);
    const result = await confirmApplicationByModel(appId, applicantUserId);
    setConfirmingId(null);
    if (result) {
      await reloadModelAgencies();
      await refreshApplications();
      load();
    } else {
      Alert.alert(uiCopy.common.error, uiCopy.modelApplications.confirmRepresentationError);
    }
  };

  const handleRejectRepresentation = async (appId: string): Promise<void> => {
    setRejectingId(appId);
    const ok = await rejectApplicationByModel(appId, applicantUserId);
    setRejectingId(null);
    if (ok) {
      await refreshApplications();
      load();
    } else {
      Alert.alert(uiCopy.common.error, uiCopy.modelApplications.declineRepresentationError);
    }
  };

  if (loading) {
    return (
      <ActivityIndicator
        size="small"
        color={colors.textPrimary}
        style={{ marginTop: compact ? spacing.sm : spacing.lg }}
      />
    );
  }

  if (applications.length === 0) {
    return (
      <Text style={styles.meta}>
        {loadError ? uiCopy.modelApplications.loadErrorState : uiCopy.modelApplications.emptyState}
      </Text>
    );
  }

  return (
    <>
      <ScrollView
        style={compact ? undefined : styles.list}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!compact}
      >
        {applications.map((app) => (
          <View key={app.id} style={styles.card}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>
                  {[app.first_name, app.last_name].filter(Boolean).join(' ')}
                </Text>
                <Text style={styles.meta}>
                  {app.height} cm · {app.city ?? '—'}
                </Text>
                {app.agency_id && (
                  <Text style={styles.meta}>
                    Agency:{' '}
                    {embeddedAgencyName(app)?.trim() ||
                      agencyNames[app.agency_id] ||
                      uiCopy.common.unknownAgency}
                  </Text>
                )}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: 4,
                    flexWrap: 'wrap',
                  }}
                >
                  <View style={[styles.badge, { backgroundColor: statusColor(app.status) }]}>
                    <Text style={styles.badgeLabel}>{toStatusLabel(app.status)}</Text>
                  </View>
                  {app.recruiting_thread_id && onChatOpen && (
                    <TouchableOpacity
                      style={styles.chatBtn}
                      onPress={() => {
                        const name =
                          embeddedAgencyName(app)?.trim() ||
                          (app.agency_id ? agencyNames[app.agency_id] : undefined);
                        onChatOpen(app.recruiting_thread_id as string, name, app.agency_id ?? null);
                      }}
                    >
                      <Text style={styles.chatBtnLabel}>Chat</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {app.status === 'representation_ended' && (
                  <View
                    style={[
                      styles.confirmationBanner,
                      { backgroundColor: colors.surface, borderColor: colors.border },
                    ]}
                  >
                    <Text style={styles.confirmationBannerSubtitle}>
                      {uiCopy.model.representationEndedApplyHint}
                    </Text>
                  </View>
                )}

                {app.status === 'pending_model_confirmation' && (
                  <View style={styles.confirmationBanner}>
                    <Text style={styles.confirmationBannerTitle}>
                      {embeddedAgencyName(app)?.trim() ||
                        (app.agency_id ? agencyNames[app.agency_id] : null) ||
                        'An agency'}{' '}
                      wants to represent you
                    </Text>
                    <Text style={styles.confirmationBannerSubtitle}>
                      Accept to join their portfolio, or decline.
                    </Text>
                    <View style={styles.confirmationBannerActions}>
                      <TouchableOpacity
                        style={styles.confirmationAcceptBtn}
                        onPress={() => void handleConfirmRepresentation(app.id)}
                        disabled={confirmingId === app.id || rejectingId === app.id}
                      >
                        <Text style={styles.confirmationAcceptLabel}>
                          {confirmingId === app.id ? 'Confirming…' : 'Accept Representation'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.confirmationDeclineBtn}
                        onPress={() => void handleRejectRepresentation(app.id)}
                        disabled={confirmingId === app.id || rejectingId === app.id}
                      >
                        <Text style={styles.confirmationDeclineLabel}>
                          {rejectingId === app.id ? 'Declining…' : 'Decline'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
              {(app.status === 'pending' ||
                app.status === 'rejected' ||
                app.status === 'representation_ended') && (
                <TouchableOpacity
                  onPress={() => handleDeleteApplication(app)}
                  disabled={deletingId === app.id}
                  style={styles.deleteBtn}
                >
                  <Text style={styles.deleteBtnLabel}>
                    {deletingId === app.id ? '…' : 'Delete'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
      </ScrollView>

      {Platform.OS === 'web' && pendingDeleteApp != null && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setPendingDeleteApp(null)}
        >
          <View style={styles.confirmOverlay}>
            <View style={styles.confirmCard}>
              <Text style={styles.confirmTitle}>{uiCopy.modelApplications.deleteConfirmTitle}</Text>
              <Text style={styles.confirmBody}>{uiCopy.modelApplications.deleteConfirmBody}</Text>
              <View style={styles.confirmRow}>
                <TouchableOpacity
                  style={styles.confirmBtnGhost}
                  onPress={() => setPendingDeleteApp(null)}
                >
                  <Text style={styles.confirmBtnGhostLabel}>{uiCopy.common.cancel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmBtnDanger}
                  onPress={() => {
                    const a = pendingDeleteApp;
                    setPendingDeleteApp(null);
                    void runConfirmedDelete(a);
                  }}
                >
                  <Text style={styles.confirmBtnDangerLabel}>
                    {uiCopy.modelApplications.deleteConfirmAction}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  list: { flex: 1 },
  card: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.xs,
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
  chatBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.buttonOptionGreen,
  },
  chatBtnLabel: { ...typography.label, fontSize: 11, color: colors.surface },
  deleteBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.buttonSkipRed,
  },
  deleteBtnLabel: { ...typography.label, fontSize: 11, color: colors.buttonSkipRed },
  confirmationBanner: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 10,
    backgroundColor: '#FFF3E0',
    borderWidth: 1,
    borderColor: colors.warningDark,
  },
  confirmationBannerTitle: {
    ...typography.label,
    fontSize: 12,
    color: '#BF360C',
    marginBottom: 2,
  },
  confirmationBannerSubtitle: {
    ...typography.body,
    fontSize: 11,
    color: colors.warningDark,
    marginBottom: spacing.sm,
  },
  confirmationBannerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  confirmationAcceptBtn: {
    flex: 1,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.accentGreen,
    alignItems: 'center',
  },
  confirmationAcceptLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.surface,
  },
  confirmationDeclineBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.buttonSkipRed,
    alignItems: 'center',
  },
  confirmationDeclineLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.buttonSkipRed,
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: spacing.sm,
  },
  confirmCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
  },
  confirmTitle: {
    ...typography.heading,
    fontSize: 17,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  confirmBody: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  confirmRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  confirmBtnGhost: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  confirmBtnGhostLabel: { ...typography.label, color: colors.textSecondary },
  confirmBtnDanger: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    backgroundColor: colors.buttonSkipRed,
  },
  confirmBtnDangerLabel: { ...typography.label, color: colors.surface },
});

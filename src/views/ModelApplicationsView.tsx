/**
 * Für Models ohne zugeordneten Model-Eintrag: „My Applications“ + Apply as Model.
 * Tabs: Applications, Messages (Recruiting-Chats mit Agenturen), Settings.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Modal, Alert, TextInput } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { getApplicationsForApplicant, deleteApplication, updateApplicationsProfileForApplicant } from '../services/applicationsSupabase';
import { refreshApplications } from '../store/applicationsStore';
import type { SupabaseApplication } from '../services/applicationsSupabase';
import { getThread } from '../services/recruitingChatSupabase';
import { getAgencyById } from '../services/agenciesSupabase';
import { ApplyFormView } from './ApplyFormView';
import { BookingChatView } from './BookingChatView';

type ModelApplicationsViewProps = {
  applicantUserId: string;
  onBackToRoleSelection: () => void;
};

type Tab = 'applications' | 'messages' | 'settings';

type MessageRow = {
  threadId: string;
  applicationId: string;
  modelName: string;
  agencyName: string;
  status: string;
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
  const [tab, setTab] = useState<Tab>('applications');
  const [chatThreadId, setChatThreadId] = useState<string | null>(null);
  const [messagesList, setMessagesList] = useState<MessageRow[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [agencyNames, setAgencyNames] = useState<Record<string, string>>({});
  const [profileDraft, setProfileDraft] = useState<{
    firstName: string;
    lastName: string;
    height: string;
    city: string;
    hair: string;
    instagram: string;
  } | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const load = () => {
    setLoading(true);
    getApplicationsForApplicant(applicantUserId).then((list) => {
      setApplications(list);
      setLoading(false);
      const ids = Array.from(new Set(list.map((a) => a.agency_id).filter(Boolean))) as string[];
      if (ids.length) {
        Promise.all(ids.map(async (id) => [id, (await getAgencyById(id))?.name ?? 'Agency'] as [string, string]))
          .then((entries) => {
            setAgencyNames((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
          });
      }
    });
  };

  useEffect(() => {
    load();
  }, [applicantUserId]);

  useEffect(() => {
    if (!applications.length) return;
    const a = applications[0];
    setProfileDraft({
      firstName: a.first_name ?? '',
      lastName: a.last_name ?? '',
      height: a.height ? String(a.height) : '',
      city: a.city ?? '',
      hair: a.hair_color ?? '',
      instagram: a.instagram_link ?? '',
    });
  }, [applications]);

  const handleSaveProfile = async () => {
    if (!profileDraft) return;
    const heightNum = profileDraft.height.trim() ? Number(profileDraft.height.trim()) : undefined;
    setSavingProfile(true);
    const ok = await updateApplicationsProfileForApplicant(applicantUserId, {
      first_name: profileDraft.firstName.trim() || undefined,
      last_name: profileDraft.lastName.trim() || undefined,
      height: typeof heightNum === 'number' && !Number.isNaN(heightNum) ? heightNum : undefined,
      city: profileDraft.city.trim() || null,
      hair_color: profileDraft.hair.trim() || null,
      instagram_link: profileDraft.instagram.trim() || null,
    });
    setSavingProfile(false);
    if (ok) {
      await refreshApplications();
      load();
    }
  };

  useEffect(() => {
    if (tab !== 'messages' || applications.length === 0) return;
    const withThread = applications.filter((a) => a.recruiting_thread_id);
    if (withThread.length === 0) {
      setMessagesList([]);
      return;
    }
    setMessagesLoading(true);
    Promise.all(
      withThread.map(async (app) => {
        const thread = app.recruiting_thread_id ? await getThread(app.recruiting_thread_id) : null;
        const agencyName = thread?.agency_id
          ? (await getAgencyById(thread.agency_id))?.name ?? 'Agency'
          : 'Agency';
        return {
          threadId: app.recruiting_thread_id!,
          applicationId: app.id,
          modelName: [app.first_name, app.last_name].filter(Boolean).join(' ') || 'Model',
          agencyName,
          status: app.status,
        };
      })
    ).then(setMessagesList).finally(() => setMessagesLoading(false));
  }, [tab, applications]);

  const handleDeleteApplication = (app: SupabaseApplication) => {
    if (app.status !== 'pending' && app.status !== 'rejected') return;
    Alert.alert(
      'Bewerbung löschen',
      'Möchtest du diese Bewerbung wirklich löschen? Du kannst danach neu bewerben.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            setDeletingId(app.id);
            const ok = await deleteApplication(app.id, applicantUserId);
            setDeletingId(null);
            if (ok) {
              await refreshApplications();
              load();
            }
          },
        },
      ]
    );
  };

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
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
        <Text style={styles.brand}>INDEX CASTING</Text>
      </View>

      <View style={{ flex: 1 }}>
        {tab === 'applications' && (
          <>
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
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.name}>{[app.first_name, app.last_name].filter(Boolean).join(' ')}</Text>
                        <Text style={styles.meta}>{app.height} cm · {app.city ?? '—'}</Text>
                        {app.agency_id && (
                          <Text style={styles.meta}>
                            Agency: {agencyNames[app.agency_id] ?? 'Agency'}
                          </Text>
                        )}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                          <View style={[styles.badge, { backgroundColor: statusColor(app.status) }]}>
                            <Text style={styles.badgeLabel}>{toStatusLabel(app.status)}</Text>
                          </View>
                          {app.recruiting_thread_id && (
                            <TouchableOpacity
                              style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 8, backgroundColor: colors.buttonOptionGreen }}
                              onPress={() => setChatThreadId(app.recruiting_thread_id!)}
                            >
                              <Text style={{ ...typography.label, fontSize: 11, color: colors.surface }}>Chat</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                      {(app.status === 'pending' || app.status === 'rejected') && (
                        <TouchableOpacity
                          onPress={() => handleDeleteApplication(app)}
                          disabled={deletingId === app.id}
                          style={styles.deleteBtn}
                        >
                          <Text style={styles.deleteBtnLabel}>{deletingId === app.id ? '…' : 'Delete'}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </>
        )}

        {tab === 'messages' && (
          <ScrollView style={{ flex: 1 }}>
            <Text style={styles.heading}>Messages</Text>
            <Text style={styles.subtitle}>Chats mit Agenturen, die auf deine Bewerbung reagiert haben.</Text>
            {messagesLoading ? (
              <ActivityIndicator size="small" color={colors.textPrimary} style={{ marginTop: spacing.lg }} />
            ) : messagesList.length === 0 ? (
              <Text style={styles.meta}>Noch keine Nachrichten von Agenturen.</Text>
            ) : (
              messagesList.map((row) => (
                <TouchableOpacity
                  key={row.threadId}
                  style={styles.card}
                  onPress={() => setChatThreadId(row.threadId)}
                >
                  <Text style={styles.name}>{row.agencyName}</Text>
                  <Text style={styles.meta}>{row.modelName} · {toStatusLabel(row.status)}</Text>
                  <Text style={[styles.meta, { marginTop: 4, color: colors.buttonOptionGreen }]}>Chat öffnen</Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        )}

        {tab === 'settings' && (
          <ScrollView style={{ flex: 1 }}>
            <Text style={styles.heading}>Settings</Text>
            {profileDraft ? (
              <>
                <Text style={styles.subtitle}>Stammdaten für deine Bewerbungen.</Text>
                <View style={styles.settingsField}>
                  <Text style={styles.settingsLabel}>First name</Text>
                  <TextInput
                    value={profileDraft.firstName}
                    onChangeText={(v) => setProfileDraft((p) => p ? { ...p, firstName: v } : p)}
                    style={styles.settingsInput}
                  />
                </View>
                <View style={styles.settingsField}>
                  <Text style={styles.settingsLabel}>Last name</Text>
                  <TextInput
                    value={profileDraft.lastName}
                    onChangeText={(v) => setProfileDraft((p) => p ? { ...p, lastName: v } : p)}
                    style={styles.settingsInput}
                  />
                </View>
                <View style={styles.settingsField}>
                  <Text style={styles.settingsLabel}>Height (cm)</Text>
                  <TextInput
                    value={profileDraft.height}
                    onChangeText={(v) => setProfileDraft((p) => p ? { ...p, height: v } : p)}
                    keyboardType="number-pad"
                    style={styles.settingsInput}
                  />
                </View>
                <View style={styles.settingsField}>
                  <Text style={styles.settingsLabel}>City</Text>
                  <TextInput
                    value={profileDraft.city}
                    onChangeText={(v) => setProfileDraft((p) => p ? { ...p, city: v } : p)}
                    style={styles.settingsInput}
                  />
                </View>
                <View style={styles.settingsField}>
                  <Text style={styles.settingsLabel}>Hair color</Text>
                  <TextInput
                    value={profileDraft.hair}
                    onChangeText={(v) => setProfileDraft((p) => p ? { ...p, hair: v } : p)}
                    style={styles.settingsInput}
                  />
                </View>
                <View style={styles.settingsField}>
                  <Text style={styles.settingsLabel}>Instagram</Text>
                  <TextInput
                    value={profileDraft.instagram}
                    onChangeText={(v) => setProfileDraft((p) => p ? { ...p, instagram: v } : p)}
                    style={styles.settingsInput}
                  />
                </View>
                <TouchableOpacity style={styles.applyBtn} onPress={handleSaveProfile} disabled={savingProfile}>
                  <Text style={styles.applyBtnLabel}>{savingProfile ? 'Saving…' : 'Save changes'}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.meta}>Noch keine Bewerbungen. Lege zuerst eine Bewerbung an, um Stammdaten zu bearbeiten.</Text>
            )}
            <TouchableOpacity style={[styles.applyBtn, { marginTop: spacing.lg }]} onPress={onBackToRoleSelection}>
              <Text style={styles.applyBtnLabel}>Logout</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>

      <View style={styles.bottomBar}>
        <View style={styles.tabRow}>
          <TouchableOpacity style={styles.tabItem} onPress={() => setTab('applications')}>
            <Text style={[styles.tabLabel, tab === 'applications' && styles.tabLabelActive]}>Applications</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabItem} onPress={() => setTab('messages')}>
            <Text style={[styles.tabLabel, tab === 'messages' && styles.tabLabelActive]}>Messages</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabItem} onPress={() => setTab('settings')}>
            <Text style={[styles.tabLabel, tab === 'settings' && styles.tabLabelActive]}>Settings</Text>
          </TouchableOpacity>
        </View>
      </View>

      {chatThreadId != null && (
        <BookingChatView threadId={chatThreadId} fromRole="model" onClose={() => setChatThreadId(null)} />
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
  deleteBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.buttonSkipRed,
  },
  deleteBtnLabel: { ...typography.label, fontSize: 11, color: colors.buttonSkipRed },
  bottomBar: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  tabRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  tabItem: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  tabLabel: { ...typography.label, color: colors.textSecondary },
  tabLabelActive: { color: colors.accentGreen },
  settingsField: {
    marginBottom: spacing.md,
  },
  settingsLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  settingsInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    fontSize: 12,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
});

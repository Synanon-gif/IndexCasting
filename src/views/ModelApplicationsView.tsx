/**
 * Für Models ohne zugeordneten Model-Eintrag: „My Applications“ + Apply as Model.
 * Tabs: Applications, Messages (Recruiting-Chats mit Agenturen), Settings.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, typography } from '../theme/theme';
import { flexFillColumn, flexFillScrollWebWithMinHeight } from '../theme/chatLayout';
import { updateApplicationsProfileForApplicant } from '../services/applicationsSupabase';
import { FILTER_COUNTRIES, ETHNICITY_OPTIONS } from '../utils/modelFilters';
import { refreshApplications } from '../store/applicationsStore';
import type { SupabaseApplication } from '../services/applicationsSupabase';
import { getAgencyChatDisplayById } from '../services/agenciesSupabase';
import { ApplyFormView } from './ApplyFormView';
import { BookingChatView } from './BookingChatView';
import { ApplicantApplicationsSection } from '../components/ApplicantApplicationsSection';
import { uiCopy } from '../constants/uiCopy';
import { BOTTOM_TAB_BAR_HEIGHT } from '../navigation/bottomTabNavigation';

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
  if (status === 'pending') return uiCopy.modelApplications.statusPending;
  if (status === 'pending_model_confirmation')
    return uiCopy.modelApplications.statusRepresentationRequest;
  if (status === 'accepted') return uiCopy.modelApplications.statusAccepted;
  if (status === 'representation_ended') return uiCopy.modelApplications.statusRepresentationEnded;
  if (status === 'rejected') return uiCopy.modelApplications.statusDeclined;
  return status;
}

/**
 * Resolves the display agency name from a PostgREST-embedded application row.
 * Prefers the agency that accepted (accepted_agency, joined on accepted_by_agency_id)
 * over the originally targeted agency (agencies, joined on agency_id) so that
 * global applications (agency_id = NULL) show the correct accepting agency name.
 */
function embeddedAgencyName(app: SupabaseApplication): string | undefined {
  // Try accepted_agency first (set when an agency accepted a global application)
  const accepted = app.accepted_agency;
  if (accepted != null) {
    if (Array.isArray(accepted)) {
      const name = (accepted[0] as { name?: string } | undefined)?.name;
      if (name) return name;
    } else if (accepted.name) {
      return accepted.name;
    }
  }
  // Fall back to the originally targeted agency
  const ag = app.agencies;
  if (ag == null) return undefined;
  if (Array.isArray(ag)) return (ag[0] as { name?: string } | undefined)?.name;
  return ag.name;
}

export const ModelApplicationsView: React.FC<ModelApplicationsViewProps> = ({
  applicantUserId,
  onBackToRoleSelection,
}) => {
  const insets = useSafeAreaInsets();
  const { height: modelAppWinH } = useWindowDimensions();
  const webMessagesScrollStyle = useMemo(
    () => flexFillScrollWebWithMinHeight(modelAppWinH, insets.top, insets.bottom, 'default'),
    [modelAppWinH, insets.top, insets.bottom],
  );
  const bottomTabInset = BOTTOM_TAB_BAR_HEIGHT + insets.bottom;
  // Applications state is owned by ApplicantApplicationsSection (single source of truth
  // for the list UI + accept/decline/delete actions). The Section reports loaded rows
  // back via `onApplicationsLoaded` so Settings tab (profileDraft) and Messages tab
  // (recruiting threads per application) stay in sync without a second fetch.
  const [applications, setApplications] = useState<SupabaseApplication[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [tab, setTab] = useState<Tab>('applications');
  const [chatOpen, setChatOpen] = useState<{
    threadId: string;
    agencyName?: string;
    applicationAgencyId?: string | null;
  } | null>(null);
  const [messagesList, setMessagesList] = useState<MessageRow[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [profileDraft, setProfileDraft] = useState<{
    firstName: string;
    lastName: string;
    height: string;
    city: string;
    hair: string;
    countryCode: string;
    ethnicity: string;
    instagram: string;
  } | null>(null);
  const [settingsCountryQuery, setSettingsCountryQuery] = useState('');
  const [settingsCountryDropdownOpen, setSettingsCountryDropdownOpen] = useState(false);
  const [settingsEthnicityDropdownOpen, setSettingsEthnicityDropdownOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    void refreshApplications();
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
      countryCode: a.country_code ?? '',
      ethnicity: a.ethnicity ?? '',
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
      country_code: profileDraft.countryCode || null,
      ethnicity: profileDraft.ethnicity || null,
      instagram_link: profileDraft.instagram.trim() || null,
    });
    setSavingProfile(false);
    if (ok) {
      await refreshApplications();
      // Force ApplicantApplicationsSection to re-load so the new profile defaults
      // are reflected in the embedded application list (and propagate back via
      // onApplicationsLoaded for the Settings/Messages tabs).
      setReloadKey((k) => k + 1);
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
        const agencyName =
          embeddedAgencyName(app)?.trim() ||
          (app.agency_id ? (await getAgencyChatDisplayById(app.agency_id))?.name : undefined) ||
          uiCopy.common.unknownAgency;
        return {
          threadId: app.recruiting_thread_id!,
          applicationId: app.id,
          modelName:
            [app.first_name, app.last_name].filter(Boolean).join(' ') || uiCopy.common.unknownModel,
          agencyName,
          status: app.status,
        };
      }),
    )
      .then(setMessagesList)
      .finally(() => setMessagesLoading(false));
  }, [tab, applications]);

  if (showApplyForm) {
    return (
      <ApplyFormView
        onBack={() => {
          setShowApplyForm(false);
          // Force ApplicantApplicationsSection to re-fetch so a freshly submitted
          // application becomes visible immediately in the Applications tab.
          setReloadKey((k) => k + 1);
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topShell}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <TouchableOpacity
          onPress={onBackToRoleSelection}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={{ ...typography.headingCompact, fontSize: 11, color: colors.textSecondary }}>
            Logout
          </Text>
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1, minHeight: 0 }}>
        {tab === 'applications' && (
          <>
            <Text style={styles.heading}>My Applications</Text>
            <Text style={styles.subtitle}>
              Apply to agencies. When accepted, you will be linked to that agency.
            </Text>

            {applications.some((a) => a.status === 'representation_ended') ? (
              <Text style={[styles.meta, { marginBottom: spacing.sm }]}>
                {uiCopy.model.representationEndedApplyHint}
              </Text>
            ) : null}

            <TouchableOpacity style={styles.applyBtn} onPress={() => setShowApplyForm(true)}>
              <Text style={styles.applyBtnLabel}>+ Apply as Model</Text>
            </TouchableOpacity>

            <ApplicantApplicationsSection
              key={reloadKey}
              applicantUserId={applicantUserId}
              onApplicationsLoaded={setApplications}
              onChatOpen={(threadId, agencyName, agencyId) =>
                setChatOpen({
                  threadId,
                  agencyName,
                  applicationAgencyId: agencyId,
                })
              }
            />
          </>
        )}

        {tab === 'messages' && (
          <View style={flexFillColumn}>
            <Text style={styles.heading}>Messages</Text>
            <Text style={[styles.subtitle, { marginBottom: spacing.sm }]}>
              {uiCopy.model.chatsSubtitle}
            </Text>
            {messagesLoading ? (
              <ActivityIndicator
                size="small"
                color={colors.textPrimary}
                style={{ marginTop: spacing.lg }}
              />
            ) : messagesList.length === 0 ? (
              <Text style={styles.meta}>{uiCopy.model.noAgencyMessages}</Text>
            ) : (
              <ScrollView
                style={webMessagesScrollStyle}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
                contentContainerStyle={{ paddingBottom: spacing.md }}
              >
                {messagesList.map((row) => (
                  <TouchableOpacity
                    key={row.threadId}
                    style={styles.card}
                    onPress={() => {
                      const app = applications.find((a) => a.recruiting_thread_id === row.threadId);
                      setChatOpen({
                        threadId: row.threadId,
                        agencyName: row.agencyName,
                        applicationAgencyId: app?.agency_id ?? null,
                      });
                    }}
                  >
                    <Text style={styles.name}>{row.agencyName}</Text>
                    <Text style={styles.meta}>
                      {row.modelName} · {toStatusLabel(row.status)}
                    </Text>
                    <Text style={[styles.meta, { marginTop: 4, color: colors.buttonOptionGreen }]}>
                      {uiCopy.model.openChat}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {tab === 'settings' && (
          <ScrollView style={{ flex: 1 }}>
            <Text style={styles.heading}>Settings</Text>
            {profileDraft ? (
              <>
                <Text style={styles.subtitle}>{uiCopy.model.applicationDefaultsSubtitle}</Text>
                <View style={styles.settingsField}>
                  <Text style={styles.settingsLabel}>First name</Text>
                  <TextInput
                    value={profileDraft.firstName}
                    onChangeText={(v) => setProfileDraft((p) => (p ? { ...p, firstName: v } : p))}
                    style={styles.settingsInput}
                  />
                </View>
                <View style={styles.settingsField}>
                  <Text style={styles.settingsLabel}>Last name</Text>
                  <TextInput
                    value={profileDraft.lastName}
                    onChangeText={(v) => setProfileDraft((p) => (p ? { ...p, lastName: v } : p))}
                    style={styles.settingsInput}
                  />
                </View>
                <View style={styles.settingsField}>
                  <Text style={styles.settingsLabel}>Height (cm)</Text>
                  <TextInput
                    value={profileDraft.height}
                    onChangeText={(v) => setProfileDraft((p) => (p ? { ...p, height: v } : p))}
                    keyboardType="number-pad"
                    style={styles.settingsInput}
                  />
                </View>
                <View style={styles.settingsField}>
                  <Text style={styles.settingsLabel}>City</Text>
                  <TextInput
                    value={profileDraft.city}
                    onChangeText={(v) => setProfileDraft((p) => (p ? { ...p, city: v } : p))}
                    style={styles.settingsInput}
                  />
                </View>

                {/* Country */}
                <View style={styles.settingsField}>
                  <Text style={styles.settingsLabel}>Country</Text>
                  {profileDraft.countryCode ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={styles.settingsChip}>
                        <Text style={styles.settingsChipLabel}>
                          {FILTER_COUNTRIES.find((c) => c.code === profileDraft.countryCode)
                            ?.label ?? profileDraft.countryCode}
                        </Text>
                        <TouchableOpacity
                          onPress={() => {
                            setProfileDraft((p) => (p ? { ...p, countryCode: '' } : p));
                            setSettingsCountryQuery('');
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={styles.settingsChipRemove}>×</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <View>
                      <TextInput
                        value={settingsCountryQuery}
                        onChangeText={(v) => {
                          setSettingsCountryQuery(v);
                          setSettingsCountryDropdownOpen(true);
                          setSettingsEthnicityDropdownOpen(false);
                        }}
                        onFocus={() => {
                          setSettingsCountryDropdownOpen(true);
                          setSettingsEthnicityDropdownOpen(false);
                        }}
                        placeholder="Search country…"
                        placeholderTextColor={colors.textSecondary}
                        style={styles.settingsInput}
                      />
                      {settingsCountryDropdownOpen && (
                        <View style={styles.settingsDropdown}>
                          <ScrollView
                            keyboardShouldPersistTaps="handled"
                            nestedScrollEnabled
                            showsVerticalScrollIndicator
                            style={{ maxHeight: 160 }}
                          >
                            {FILTER_COUNTRIES.filter(
                              (c) =>
                                !settingsCountryQuery.trim() ||
                                c.label
                                  .toLowerCase()
                                  .includes(settingsCountryQuery.toLowerCase()) ||
                                c.code.toLowerCase().includes(settingsCountryQuery.toLowerCase()),
                            ).map((c, i, arr) => (
                              <TouchableOpacity
                                key={c.code}
                                style={[
                                  styles.settingsDropdownItem,
                                  i < arr.length - 1 && {
                                    borderBottomWidth: 1,
                                    borderBottomColor: colors.border,
                                  },
                                ]}
                                onPress={() => {
                                  setProfileDraft((p) => (p ? { ...p, countryCode: c.code } : p));
                                  setSettingsCountryQuery('');
                                  setSettingsCountryDropdownOpen(false);
                                }}
                              >
                                <Text style={styles.settingsDropdownItemText}>{c.label}</Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </View>
                      )}
                    </View>
                  )}
                </View>

                {/* Ethnicity */}
                <View style={styles.settingsField}>
                  <Text style={styles.settingsLabel}>Ethnicity</Text>
                  {profileDraft.ethnicity ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={styles.settingsChip}>
                        <Text style={styles.settingsChipLabel}>{profileDraft.ethnicity}</Text>
                        <TouchableOpacity
                          onPress={() => setProfileDraft((p) => (p ? { ...p, ethnicity: '' } : p))}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={styles.settingsChipRemove}>×</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <View>
                      <TouchableOpacity
                        style={[styles.settingsInput, { justifyContent: 'center' }]}
                        onPress={() => {
                          setSettingsEthnicityDropdownOpen((o) => !o);
                          setSettingsCountryDropdownOpen(false);
                        }}
                      >
                        <Text
                          style={{ ...typography.body, fontSize: 12, color: colors.textSecondary }}
                        >
                          Select ethnicity…
                        </Text>
                      </TouchableOpacity>
                      {settingsEthnicityDropdownOpen && (
                        <View style={styles.settingsDropdown}>
                          <ScrollView
                            keyboardShouldPersistTaps="handled"
                            nestedScrollEnabled
                            showsVerticalScrollIndicator
                            style={{ maxHeight: 160 }}
                          >
                            {ETHNICITY_OPTIONS.map((eth, i) => (
                              <TouchableOpacity
                                key={eth}
                                style={[
                                  styles.settingsDropdownItem,
                                  i < ETHNICITY_OPTIONS.length - 1 && {
                                    borderBottomWidth: 1,
                                    borderBottomColor: colors.border,
                                  },
                                ]}
                                onPress={() => {
                                  setProfileDraft((p) => (p ? { ...p, ethnicity: eth } : p));
                                  setSettingsEthnicityDropdownOpen(false);
                                }}
                              >
                                <Text style={styles.settingsDropdownItemText}>{eth}</Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </View>
                      )}
                    </View>
                  )}
                </View>

                <View style={styles.settingsField}>
                  <Text style={styles.settingsLabel}>Hair color</Text>
                  <TextInput
                    value={profileDraft.hair}
                    onChangeText={(v) => setProfileDraft((p) => (p ? { ...p, hair: v } : p))}
                    style={styles.settingsInput}
                  />
                </View>
                <View style={styles.settingsField}>
                  <Text style={styles.settingsLabel}>Instagram</Text>
                  <TextInput
                    value={profileDraft.instagram}
                    onChangeText={(v) => setProfileDraft((p) => (p ? { ...p, instagram: v } : p))}
                    style={styles.settingsInput}
                  />
                </View>
                <TouchableOpacity
                  style={styles.applyBtn}
                  onPress={handleSaveProfile}
                  disabled={savingProfile}
                >
                  <Text style={styles.applyBtnLabel}>
                    {savingProfile ? 'Saving…' : 'Save changes'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.meta}>{uiCopy.model.noApplicationsYet}</Text>
            )}
            <TouchableOpacity
              style={[styles.applyBtn, { marginTop: spacing.lg }]}
              onPress={onBackToRoleSelection}
            >
              <Text style={styles.applyBtnLabel}>Logout</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom || spacing.sm }]}>
        <View style={styles.tabRow}>
          <TouchableOpacity style={styles.tabItem} onPress={() => setTab('applications')}>
            <Text style={[styles.tabLabel, tab === 'applications' && styles.tabLabelActive]}>
              {uiCopy.modelApplications.tab_applications}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabItem} onPress={() => setTab('messages')}>
            <Text style={[styles.tabLabel, tab === 'messages' && styles.tabLabelActive]}>
              {uiCopy.modelApplications.tab_messages}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.tabItem} onPress={() => setTab('settings')}>
            <Text style={[styles.tabLabel, tab === 'settings' && styles.tabLabelActive]}>
              {uiCopy.modelApplications.tab_settings}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {chatOpen != null && (
        <BookingChatView
          threadId={chatOpen.threadId}
          fromRole="model"
          initialAgencyName={chatOpen.agencyName}
          applicationAgencyId={chatOpen.applicationAgencyId}
          onClose={() => setChatOpen(null)}
          presentation="insetAboveBottomNav"
          bottomInset={bottomTabInset}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  topShell: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    marginBottom: spacing.xs,
  },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  backArrow: { fontSize: 24, color: colors.textPrimary, marginRight: spacing.sm },
  backLabel: { ...typography.label, color: colors.textSecondary },
  brand: { ...typography.headingCompact, color: colors.textPrimary },
  heading: {
    ...typography.heading,
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
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
  settingsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.textPrimary,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  settingsChipLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.surface,
  },
  settingsChipRemove: {
    ...typography.label,
    fontSize: 14,
    color: colors.surface,
    lineHeight: 16,
  },
  settingsDropdown: {
    marginTop: spacing.xs,
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 16,
    overflow: 'hidden',
  },
  settingsDropdownItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  settingsDropdownItemText: {
    ...typography.body,
    fontSize: 12,
    color: colors.textPrimary,
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
});

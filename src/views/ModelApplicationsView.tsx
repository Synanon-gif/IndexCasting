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
  Modal,
  Alert,
  TextInput,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, typography } from '../theme/theme';
import { flexFillColumn, flexFillScrollWebWithMinHeight } from '../theme/chatLayout';
import {
  getApplicationsForApplicant,
  deleteApplication,
  updateApplicationsProfileForApplicant,
} from '../services/applicationsSupabase';
import { FILTER_COUNTRIES, ETHNICITY_OPTIONS } from '../utils/modelFilters';
import {
  refreshApplications,
  confirmApplicationByModel,
  rejectApplicationByModel,
} from '../store/applicationsStore';
import type { SupabaseApplication } from '../services/applicationsSupabase';
import { getAgencyChatDisplayById } from '../services/agenciesSupabase';
import { ApplyFormView } from './ApplyFormView';
import { BookingChatView } from './BookingChatView';
import { uiCopy } from '../constants/uiCopy';
import { BOTTOM_TAB_BAR_HEIGHT } from '../navigation/bottomTabNavigation';
import { useModelAgency } from '../context/ModelAgencyContext';

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
  if (status === 'rejected') return uiCopy.modelApplications.statusDeclined;
  return status;
}

function statusColor(status: string): string {
  if (status === 'accepted') return colors.accentGreen;
  if (status === 'rejected') return colors.textSecondary;
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
  const { reload: reloadModelAgencies } = useModelAgency();
  const insets = useSafeAreaInsets();
  const { height: modelAppWinH } = useWindowDimensions();
  const webMessagesScrollStyle = useMemo(
    () => flexFillScrollWebWithMinHeight(modelAppWinH, insets.top, insets.bottom, 'default'),
    [modelAppWinH, insets.top, insets.bottom],
  );
  const bottomTabInset = BOTTOM_TAB_BAR_HEIGHT + insets.bottom;
  const [applications, setApplications] = useState<SupabaseApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [tab, setTab] = useState<Tab>('applications');
  const [chatOpen, setChatOpen] = useState<{
    threadId: string;
    agencyName?: string;
    applicationAgencyId?: string | null;
  } | null>(null);
  const [pendingDeleteApp, setPendingDeleteApp] = useState<SupabaseApplication | null>(null);
  const [messagesList, setMessagesList] = useState<MessageRow[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [agencyNames, setAgencyNames] = useState<Record<string, string>>({});
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
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

  const load = (signal?: { cancelled: boolean }) => {
    setLoading(true);
    setLoadError(false);
    getApplicationsForApplicant(applicantUserId)
      .then(async (list) => {
        if (signal?.cancelled) return;
        setApplications(list);
        setLoading(false);
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
            /* ignore */
          }
        }
        if (!signal?.cancelled) setAgencyNames(map);
      })
      .catch((e) => {
        console.error('ModelApplicationsView load error:', e);
        if (!signal?.cancelled) {
          setLoading(false);
          setLoadError(true);
        }
      });
  };

  useEffect(() => {
    const signal = { cancelled: false };
    load(signal);
    return () => {
      signal.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicantUserId]);

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
        const agencyName =
          embeddedAgencyName(app)?.trim() ||
          (app.agency_id ? (await getAgencyChatDisplayById(app.agency_id))?.name : undefined) ||
          'Agency';
        return {
          threadId: app.recruiting_thread_id!,
          applicationId: app.id,
          modelName: [app.first_name, app.last_name].filter(Boolean).join(' ') || 'Model',
          agencyName,
          status: app.status,
        };
      }),
    )
      .then(setMessagesList)
      .finally(() => setMessagesLoading(false));
  }, [tab, applications]);

  const runConfirmedDelete = async (app: SupabaseApplication) => {
    if (app.status !== 'pending' && app.status !== 'rejected') return;
    setDeletingId(app.id);
    const ok = await deleteApplication(app.id, applicantUserId);
    setDeletingId(null);
    if (ok) {
      setApplications((prev) => prev.filter((x) => x.id !== app.id));
      setMessagesList((prev) => prev.filter((x) => x.applicationId !== app.id));
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

  const handleDeleteApplication = (app: SupabaseApplication) => {
    if (app.status !== 'pending' && app.status !== 'rejected') return;
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

  const handleConfirmRepresentation = async (appId: string) => {
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

  const handleRejectRepresentation = async (appId: string) => {
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

            <TouchableOpacity style={styles.applyBtn} onPress={() => setShowApplyForm(true)}>
              <Text style={styles.applyBtnLabel}>+ Apply as Model</Text>
            </TouchableOpacity>

            {loading ? (
              <ActivityIndicator
                size="small"
                color={colors.textPrimary}
                style={{ marginTop: spacing.lg }}
              />
            ) : applications.length === 0 ? (
              <Text style={styles.meta}>
                {loadError
                  ? uiCopy.modelApplications.loadErrorState
                  : uiCopy.modelApplications.emptyState}
              </Text>
            ) : (
              <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
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
                              'Agency'}
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
                          <View
                            style={[styles.badge, { backgroundColor: statusColor(app.status) }]}
                          >
                            <Text style={styles.badgeLabel}>{toStatusLabel(app.status)}</Text>
                          </View>
                          {app.recruiting_thread_id && (
                            <TouchableOpacity
                              style={{
                                paddingVertical: 4,
                                paddingHorizontal: 10,
                                borderRadius: 8,
                                backgroundColor: colors.buttonOptionGreen,
                              }}
                              onPress={() =>
                                setChatOpen({
                                  threadId: app.recruiting_thread_id!,
                                  agencyName:
                                    embeddedAgencyName(app)?.trim() ||
                                    (app.agency_id ? agencyNames[app.agency_id] : undefined),
                                  applicationAgencyId: app.agency_id,
                                })
                              }
                            >
                              <Text
                                style={{ ...typography.label, fontSize: 11, color: colors.surface }}
                              >
                                Chat
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>

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
                                  {confirmingId === app.id
                                    ? 'Confirming…'
                                    : 'Accept Representation'}
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
                      {(app.status === 'pending' || app.status === 'rejected') && (
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
            )}
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

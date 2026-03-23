import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Image,
  Linking,
  Alert,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import countries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';
import { colors, spacing, typography } from '../theme/theme';
import { showAppAlert } from '../utils/crossPlatformAlert';
import { useAuth } from '../context/AuthContext';
import { getAgencyModels, updateModelVisibility } from '../services/apiService';
import {
  getOptionRequests,
  subscribe,
  getMessages,
  addMessage,
  getRequestByThreadId,
  getRequestStatus,
  setRequestStatus,
  loadOptionRequestsForAgency,
  refreshOptionRequestInCache,
  loadMessagesForThread,
  agencyAcceptClientPriceStore,
  agencyCounterOfferStore,
  agencyRejectClientPriceStore,
  type OptionRequest,
  type ChatStatus,
} from '../store/optionRequests';
import { AgencyRecruitingView } from './AgencyRecruitingView';
import {
  getModelsForAgencyFromSupabase,
  removeModelFromAgency,
  agencyLinkModelToUser,
  type SupabaseModel,
} from '../services/modelsSupabase';
import { BookingChatView } from './BookingChatView';
import { getRecruitingThreadsForAgency, type RecruitingThread } from '../store/recruitingChats';
import {
  ensureClientAgencyChat,
  listB2BConversationsForOrganization,
  getB2BConversationTitleForViewer,
} from '../services/b2bOrgChatSupabase';
import type { Conversation } from '../services/messengerSupabase';
import { getApplicationById } from '../store/applicationsStore';
import { OrgMessengerInline } from '../components/OrgMessengerInline';
import { AgencySettingsTab } from '../components/AgencySettingsTab';
// Recruiting chats (BookingChatView) live under Messages → Recruiting chats.
import {
  getPhotosForModel,
  upsertPhotosForModel,
  syncPortfolioToModel,
  syncPolaroidsToModel,
  uploadModelPhoto,
} from '../services/modelPhotosSupabase';
import { getTerritoriesForModel, upsertTerritoriesForModel } from '../services/territoriesSupabase';
import { supabase } from '../../lib/supabase';
import {
  ensureAgencyOrganization,
  getOrganizationIdForAgency,
  listOrganizationMembers,
  listInvitationsForOrganization,
  createOrganizationInvitation,
  buildOrganizationInviteUrl,
  getMyAgencyMemberRole,
  type InvitationRow,
} from '../services/organizationsInvitationsSupabase';
import {
  listClientOrganizationsForAgencyDirectory,
  type ClientOrganizationDirectoryRow,
} from '../services/clientOrganizationsDirectorySupabase';
import { getAgencies, type Agency } from '../services/agenciesSupabase';
import { createGuestLink, getGuestLinksForAgency, buildGuestUrl, deactivateGuestLink, type GuestLink } from '../services/guestLinksSupabase';
import {
  getCalendarEntriesForAgency,
  type AgencyCalendarItem,
  updateBookingDetails,
  appendSharedBookingNote,
  type SharedBookingNote,
} from '../services/calendarSupabase';
import { updateOptionRequestSchedule } from '../services/optionRequestsSupabase';
import {
  getManualEventsForOwner,
  insertManualEvent,
  updateManualEvent,
  deleteManualEvent,
  MANUAL_EVENT_COLORS,
  type UserCalendarEvent,
} from '../services/userCalendarEventsSupabase';
import { MonthCalendarView, type CalendarDayEvent } from '../components/MonthCalendarView';
import { ScreenScrollView } from '../components/ScreenScrollView';
import { uiCopy } from '../constants/uiCopy';

const STATUS_LABELS: Record<ChatStatus, string> = {
  in_negotiation: 'In negotiation',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
};

const STATUS_COLORS: Record<ChatStatus, string> = {
  in_negotiation: '#B8860B',
  confirmed: colors.buttonOptionGreen,
  rejected: colors.textSecondary,
};

// ISO country names for the territories multi-select.
// Keep names in English for UI consistency.
countries.registerLocale(enLocale as any);
const ISO_COUNTRY_NAMES: Record<string, string> = countries.getNames('en', { select: 'official' }) as any;

type AgencyTab =
  | 'dashboard'
  | 'myModels'
  | 'clients'
  | 'messages'
  | 'calendar'
  | 'recruiting'
  | 'bookers'
  | 'guestLinks'
  | 'settings';

type AgencyModel = {
  id: string;
  name: string;
  traction: number;
  isVisibleCommercial: boolean;
  isVisibleFashion: boolean;
};

type AgencyControllerViewProps = {
  onBackToRoleSelection: () => void;
};

export const AgencyControllerView: React.FC<AgencyControllerViewProps> = ({
  onBackToRoleSelection,
}) => {
  const { signOut, profile, session } = useAuth();
  const [tab, setTab] = useState<AgencyTab>('dashboard');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [models, setModels] = useState<AgencyModel[]>([]);
  const [fullModels, setFullModels] = useState<SupabaseModel[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [agencyOrganizationId, setAgencyOrganizationId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<
    Awaited<ReturnType<typeof listOrganizationMembers>>
  >([]);
  const [pendingInvites, setPendingInvites] = useState<InvitationRow[]>([]);
  const [agencyTeamIsOwner, setAgencyTeamIsOwner] = useState(false);
  const [calendarItems, setCalendarItems] = useState<AgencyCalendarItem[]>([]);
  const [manualCalendarEvents, setManualCalendarEvents] = useState<UserCalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [selectedCalendarItem, setSelectedCalendarItem] = useState<AgencyCalendarItem | null>(null);
  const [selectedManualEvent, setSelectedManualEvent] = useState<UserCalendarEvent | null>(null);
  const [showAddManualEvent, setShowAddManualEvent] = useState(false);
  const [newEventForm, setNewEventForm] = useState({
    date: '',
    start_time: '09:00',
    end_time: '17:00',
    title: '',
    note: '',
    color: MANUAL_EVENT_COLORS[0],
  });
  const [agencyNotesDraft, setAgencyNotesDraft] = useState('');
  const [agencySharedNoteDraft, setAgencySharedNoteDraft] = useState('');
  const [savingAgencySharedNote, setSavingAgencySharedNote] = useState(false);
  const [savingManualEvent, setSavingManualEvent] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [bookingScheduleDraft, setBookingScheduleDraft] = useState({
    date: '',
    start_time: '09:00',
    end_time: '17:00',
  });
  const [savingBookingSchedule, setSavingBookingSchedule] = useState(false);
  const [manualEventEditDraft, setManualEventEditDraft] = useState({
    title: '',
    date: '',
    start_time: '09:00',
    end_time: '17:00',
    note: '',
    color: MANUAL_EVENT_COLORS[0],
  });
  const [savingManualEventEdit, setSavingManualEventEdit] = useState(false);
  const [bookingChatThreads, setBookingChatThreads] = useState<RecruitingThread[]>([]);
  const [openBookingThreadId, setOpenBookingThreadId] = useState<string | null>(null);
  /** After starting a chat from Clients, open Messages with this thread. */
  const [pendingB2BChat, setPendingB2BChat] = useState<{ conversationId: string; title: string } | null>(null);
  const currentAgency = useMemo(() => {
    if (!agencies.length) return null;
    const pe = profile?.email?.trim().toLowerCase();
    if (pe) {
      const hit = agencies.find((a) => a.email?.trim().toLowerCase() === pe);
      if (hit) return hit;
    }
    return agencies[0];
  }, [agencies, profile?.email]);

  const currentAgencyId = currentAgency?.id ?? '';

  useEffect(() => {
    getAgencies().then(setAgencies);
  }, []);

  useEffect(() => {
    if (!currentAgencyId) return;
    getAgencyModels(currentAgencyId).then((data: any[]) => {
      setModels(data.map((m: any) => ({
        id: m.id, name: m.name, traction: m.traction ?? 0,
        isVisibleCommercial: m.isVisibleCommercial ?? false,
        isVisibleFashion: m.isVisibleFashion ?? false,
      })));
    });
    getModelsForAgencyFromSupabase(currentAgencyId).then(setFullModels);
    loadOptionRequestsForAgency(currentAgencyId);
  }, [currentAgencyId]);

  const loadAgencyTeam = async () => {
    if (!currentAgencyId) return;
    const pe = profile?.email?.trim().toLowerCase();
    const ae = currentAgency?.email?.trim().toLowerCase();
    let oid: string | null = null;
    if (pe && ae && pe === ae) {
      oid = await ensureAgencyOrganization(currentAgencyId);
    }
    if (!oid) oid = await getOrganizationIdForAgency(currentAgencyId);
    setAgencyOrganizationId(oid);
    const mem = await getMyAgencyMemberRole(currentAgencyId);
    setAgencyTeamIsOwner(mem?.member_role === 'owner');
    if (oid) {
      setTeamMembers(await listOrganizationMembers(oid));
      setPendingInvites(await listInvitationsForOrganization(oid));
    } else {
      setTeamMembers([]);
      setPendingInvites([]);
    }
  };

  useEffect(() => {
    if (currentAgencyId) void loadAgencyTeam();
  }, [currentAgencyId, profile?.email]);

  /** Re-load roster when opening My Models (e.g. after accepting an application in Recruiting). */
  useEffect(() => {
    if (tab === 'myModels' && currentAgencyId) {
      getModelsForAgencyFromSupabase(currentAgencyId).then(setFullModels);
      getAgencyModels(currentAgencyId).then((data: any[]) => {
        setModels(data.map((m: any) => ({
          id: m.id, name: m.name, traction: m.traction ?? 0,
          isVisibleCommercial: m.isVisibleCommercial ?? false,
          isVisibleFashion: m.isVisibleFashion ?? false,
        })));
      });
    }
  }, [tab, currentAgencyId]);

  const loadAgencyCalendar = async () => {
    if (!currentAgencyId) return;
    setCalendarLoading(true);
    try {
      const [items, manual] = await Promise.all([
        getCalendarEntriesForAgency(currentAgencyId),
        getManualEventsForOwner(currentAgencyId, 'agency'),
      ]);
      setCalendarItems(items);
      setManualCalendarEvents(manual);
    } finally {
      setCalendarLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'calendar' && currentAgencyId) {
      loadAgencyCalendar();
    }
  }, [tab, currentAgencyId]);

  useEffect(() => {
    if (!selectedCalendarItem) return;
    const o = selectedCalendarItem.option;
    const ce = selectedCalendarItem.calendar_entry;
    const d = (ce?.date || o.requested_date || '').toString().slice(0, 10);
    setBookingScheduleDraft({
      date: d,
      start_time: (ce?.start_time ?? o.start_time ?? '09:00').toString().slice(0, 5),
      end_time: (ce?.end_time ?? o.end_time ?? '17:00').toString().slice(0, 5),
    });
  }, [selectedCalendarItem?.option.id]);

  useEffect(() => {
    if (!selectedManualEvent) return;
    setManualEventEditDraft({
      title: selectedManualEvent.title,
      date: selectedManualEvent.date,
      start_time: selectedManualEvent.start_time ?? '09:00',
      end_time: selectedManualEvent.end_time ?? '17:00',
      note: selectedManualEvent.note ?? '',
      color: selectedManualEvent.color,
    });
  }, [selectedManualEvent?.id]);

  /** Recruiting threads for Messages → Recruiting chats (Supabase). */
  const refreshBookingThreads = useCallback(() => {
    if (!currentAgencyId) return;
    const uid = session?.user?.id;
    getMyAgencyMemberRole(currentAgencyId).then((m) => {
      const filterBooker = m?.member_role === 'booker' && uid ? uid : undefined;
      return getRecruitingThreadsForAgency(currentAgencyId, { createdByUserId: filterBooker });
    }).then(setBookingChatThreads);
  }, [currentAgencyId, session?.user?.id]);

  useEffect(() => {
    if (tab === 'messages' && currentAgencyId) {
      refreshBookingThreads();
    }
  }, [tab, currentAgencyId, refreshBookingThreads]);

  const agencyBottomTabs = useMemo(
    () => {
      const all: { key: AgencyTab; label: string }[] = [
        { key: 'dashboard', label: 'Dashboard' },
        { key: 'myModels', label: 'My Models' },
        { key: 'clients', label: 'Clients' },
        { key: 'messages', label: 'Messages' },
        { key: 'calendar', label: 'Calendar' },
        { key: 'recruiting', label: 'Recruiting' },
        { key: 'bookers', label: 'Team' },
        { key: 'guestLinks', label: 'Guest Links' },
        { key: 'settings', label: uiCopy.agencySettings.tabLabel },
      ];
      return agencyTeamIsOwner ? all : all.filter((t) => t.key !== 'settings');
    },
    [agencyTeamIsOwner],
  );

  useEffect(() => {
    if (tab === 'settings' && !agencyTeamIsOwner) {
      setTab('dashboard');
    }
  }, [tab, agencyTeamIsOwner]);

  const openAgencyBookingChat = (threadId: string) => {
    refreshBookingThreads();
    setOpenBookingThreadId(threadId);
  };

  const clearPendingB2BChat = useCallback(() => setPendingB2BChat(null), []);

  return (
    <View style={s.container}>
      <TouchableOpacity style={s.backRow} onPress={onBackToRoleSelection} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <Text style={s.backArrow}>←</Text>
        <Text style={s.backLabel}>Logout</Text>
      </TouchableOpacity>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={s.brand}>INDEX CASTING</Text>
        <TouchableOpacity
          onPress={() => {
            const subject = encodeURIComponent('Help Request – Agency – Casting Index');
            const body = encodeURIComponent('Hello Casting Index Team,\n\nI need help with:\n\n');
            Linking.openURL(`mailto:admin@castingindex.com?subject=${subject}&body=${body}`);
          }}
        >
          <Text style={{ ...typography.label, fontSize: 12, color: colors.textSecondary }}>Help</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
      {tab === 'dashboard' && (
        <DashboardTab models={models} />
      )}

      {tab === 'recruiting' && (
        currentAgencyId ? (
          <AgencyRecruitingView
            onBack={() => setTab('dashboard')}
            agencyId={currentAgencyId}
            onOpenBookingChat={openAgencyBookingChat}
          />
        ) : (
          <Text style={[s.metaText, { marginTop: spacing.md }]}>No agency assigned.</Text>
        )
      )}

      {tab === 'myModels' && (
        <MyModelsTab
          models={fullModels}
          agencyId={currentAgencyId}
          onRefresh={() => getModelsForAgencyFromSupabase(currentAgencyId).then(setFullModels)}
        />
      )}

      {tab === 'clients' && currentAgencyId ? (
        <AgencyClientsTab
          agencyId={currentAgencyId}
          currentUserId={session?.user?.id ?? null}
          onChatStarted={(conversationId, title) => {
            setPendingB2BChat({ conversationId, title });
            setTab('messages');
          }}
        />
      ) : tab === 'clients' ? (
        <Text style={[s.metaText, { marginTop: spacing.md }]}>No agency assigned.</Text>
      ) : null}

      {tab === 'messages' && (
        <AgencyMessagesTab
          recruitingThreads={bookingChatThreads}
          onRefreshRecruitingThreads={refreshBookingThreads}
          onOpenRecruitingThread={(threadId) => {
            refreshBookingThreads();
            setOpenBookingThreadId(threadId);
          }}
          agencyId={currentAgencyId || null}
          currentUserId={session?.user?.id ?? null}
          pendingOpenB2BChat={pendingB2BChat}
          onPendingB2BChatConsumed={clearPendingB2BChat}
        />
      )}

      {tab === 'calendar' && (
        <AgencyCalendarTab
          items={calendarItems}
          manualEvents={manualCalendarEvents}
          loading={calendarLoading}
          onRefresh={loadAgencyCalendar}
          onOpenDetails={(item) => {
            setSelectedCalendarItem(item);
            setSelectedManualEvent(null);
            setAgencySharedNoteDraft('');
            const existing =
              (item.calendar_entry?.booking_details as any)?.agency_notes ?? '';
            setAgencyNotesDraft(existing);
          }}
          onOpenManualEvent={(ev) => {
            setSelectedManualEvent(ev);
            setSelectedCalendarItem(null);
          }}
          onAddEvent={() => setShowAddManualEvent(true)}
        />
      )}

        {tab === 'bookers' && (
          <OrganizationTeamTab
            organizationId={agencyOrganizationId}
            canInvite={agencyTeamIsOwner}
            members={teamMembers}
            invitations={pendingInvites}
            onRefresh={() => void loadAgencyTeam()}
          />
        )}

        {tab === 'guestLinks' && (
        <GuestLinksTab
          agencyId={currentAgencyId}
          agencyEmail={currentAgency?.email ?? ''}
          agencyName={currentAgency?.name ?? ''}
          models={fullModels}
        />
      )}

      {tab === 'settings' && agencyTeamIsOwner && (
        <>
          <AgencySettingsTab
            agency={currentAgency}
            organizationId={agencyOrganizationId}
            onSaved={() => {
              void getAgencies().then(setAgencies);
            }}
          />
          <ScreenScrollView>
            <View style={{ marginTop: spacing.md, marginBottom: spacing.lg }}>
              <Text style={s.sectionLabel}>{uiCopy.accountDeletion.sectionTitle}</Text>
              <Text style={[s.metaText, { marginBottom: spacing.sm }]}>{uiCopy.accountDeletion.description}</Text>
              <TouchableOpacity
                onPress={() => {
                  Alert.alert(
                    uiCopy.accountDeletion.confirmTitle,
                    uiCopy.accountDeletion.confirmMessage,
                    [
                      { text: uiCopy.common.cancel, style: 'cancel' },
                      {
                        text: uiCopy.accountDeletion.button,
                        style: 'destructive',
                        onPress: async () => {
                          setDeletingAccount(true);
                          const { requestAccountDeletion } = await import('../services/accountSupabase');
                          const res = await requestAccountDeletion();
                          setDeletingAccount(false);
                          if (res.ok) {
                            await signOut();
                            return;
                          }
                          if (res.reason === 'not_owner') {
                            Alert.alert(uiCopy.common.error, uiCopy.accountDeletion.ownerOnly);
                          } else {
                            Alert.alert(uiCopy.common.error, uiCopy.accountDeletion.failed);
                          }
                        },
                      },
                    ]
                  );
                }}
                disabled={deletingAccount}
                style={{ borderRadius: 999, borderWidth: 1, borderColor: '#e74c3c', paddingVertical: spacing.sm, alignItems: 'center' }}
              >
                <Text style={{ ...typography.label, fontSize: 12, color: '#e74c3c' }}>
                  {deletingAccount ? uiCopy.accountDeletion.buttonWorking : uiCopy.accountDeletion.button}
                </Text>
              </TouchableOpacity>
            </View>
          </ScreenScrollView>
        </>
      )}
      </View>

      <View style={s.bottomBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.tabRow}
        >
          {agencyBottomTabs.map((t) => (
            <TouchableOpacity key={t.key} onPress={() => setTab(t.key)} style={s.tabItem}>
              <Text style={[s.tabLabel, tab === t.key && s.tabLabelActive]}>{t.label}</Text>
              {tab === t.key && <View style={s.tabUnderline} />}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {openBookingThreadId != null && (
        <BookingChatView
          threadId={openBookingThreadId}
          fromRole="agency"
          onClose={() => setOpenBookingThreadId(null)}
        />
      )}

      {selectedCalendarItem && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.08)',
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: spacing.lg,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: 520,
              maxHeight: '90%',
              borderRadius: 18,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              padding: spacing.lg,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: spacing.sm,
              }}
            >
              <Text style={s.sectionLabel}>Booking details</Text>
              <TouchableOpacity
                onPress={() => {
                  setSelectedCalendarItem(null);
                  setAgencyNotesDraft('');
                  setAgencySharedNoteDraft('');
                }}
              >
                <Text style={s.backLabel}>Close</Text>
              </TouchableOpacity>
            </View>
            {selectedCalendarItem && (() => {
              const { option, calendar_entry } = selectedCalendarItem;
              const entryType = calendar_entry?.entry_type;
              let kind: 'Option' | 'Job' | 'Casting' = 'Option';
              if (entryType === 'booking') kind = 'Job';
              if (entryType === 'casting' || entryType === 'gosee') kind = 'Casting';
              const date = calendar_entry?.date ?? option.requested_date;
              const start =
                calendar_entry?.start_time ?? option.start_time ?? undefined;
              const end =
                calendar_entry?.end_time ?? option.end_time ?? undefined;
              return (
                <View style={{ marginBottom: spacing.md }}>
                  <Text style={s.modelName}>
                    {kind} · {option.model_name ?? 'Model'}
                  </Text>
                  <Text style={s.metaText}>
                    {option.client_name ?? 'Client'}
                  </Text>
                  <Text style={s.metaText}>
                    {date}
                    {start ? ` · ${start}${end ? `–${end}` : ''}` : ''}
                  </Text>
                </View>
              );
            })()}
            <View style={{ marginBottom: spacing.md }}>
              <Text style={s.sectionLabel}>{uiCopy.calendar.reschedule}</Text>
              <Text style={[s.metaText, { marginBottom: spacing.sm }]}>
                {uiCopy.calendar.rescheduleHelpAgency}
              </Text>
              <Text style={{ ...typography.label, marginBottom: 4 }}>Date (YYYY-MM-DD)</Text>
              <TextInput
                value={bookingScheduleDraft.date}
                onChangeText={(t) => setBookingScheduleDraft((p) => ({ ...p, date: t }))}
                placeholderTextColor={colors.textSecondary}
                style={s.editInput}
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...typography.label, marginBottom: 4 }}>From</Text>
                  <TextInput
                    value={bookingScheduleDraft.start_time}
                    onChangeText={(t) => setBookingScheduleDraft((p) => ({ ...p, start_time: t }))}
                    placeholderTextColor={colors.textSecondary}
                    style={s.editInput}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...typography.label, marginBottom: 4 }}>To</Text>
                  <TextInput
                    value={bookingScheduleDraft.end_time}
                    onChangeText={(t) => setBookingScheduleDraft((p) => ({ ...p, end_time: t }))}
                    placeholderTextColor={colors.textSecondary}
                    style={s.editInput}
                  />
                </View>
              </View>
              <TouchableOpacity
                onPress={async () => {
                  if (!selectedCalendarItem || !currentAgencyId || !bookingScheduleDraft.date.trim()) return;
                  setSavingBookingSchedule(true);
                  try {
                    const ok = await updateOptionRequestSchedule(selectedCalendarItem.option.id, {
                      requested_date: bookingScheduleDraft.date.trim(),
                      start_time: bookingScheduleDraft.start_time.trim() || null,
                      end_time: bookingScheduleDraft.end_time.trim() || null,
                    });
                    if (ok) {
                      await loadAgencyCalendar();
                      loadOptionRequestsForAgency(currentAgencyId);
                      const items = await getCalendarEntriesForAgency(currentAgencyId);
                      const next = items.find((x) => x.option.id === selectedCalendarItem.option.id);
                      if (next) setSelectedCalendarItem(next);
                      Alert.alert(uiCopy.common.success, uiCopy.alerts.scheduleUpdated);
                    } else {
                      Alert.alert(uiCopy.common.error, uiCopy.alerts.scheduleSaveFailed);
                    }
                  } finally {
                    setSavingBookingSchedule(false);
                  }
                }}
                style={[
                  s.saveBtn,
                  { marginTop: spacing.sm, alignSelf: 'flex-end', opacity: savingBookingSchedule ? 0.6 : 1 },
                ]}
                disabled={savingBookingSchedule}
              >
                <Text style={s.saveBtnLabel}>{savingBookingSchedule ? uiCopy.common.saving : uiCopy.calendar.saveSchedule}</Text>
              </TouchableOpacity>
            </View>
            {selectedCalendarItem.calendar_entry ? (
              <View style={{ marginBottom: spacing.md }}>
                <Text style={s.sectionLabel}>Shared notes</Text>
                <Text style={[s.metaText, { marginBottom: spacing.sm }]}>
                  Visible to client and model. Minimise personal data (GDPR).
                </Text>
                <ScrollView style={{ maxHeight: 120, marginBottom: spacing.sm }}>
                  {(
                    (selectedCalendarItem.calendar_entry?.booking_details as { shared_notes?: SharedBookingNote[] } | null)
                      ?.shared_notes ?? []
                  ).map((n, i) => (
                    <View
                      key={`${n.at}-${i}`}
                      style={{
                        marginBottom: spacing.xs,
                        padding: spacing.sm,
                        backgroundColor: colors.border,
                        borderRadius: 8,
                      }}
                    >
                      <Text style={{ ...typography.label, fontSize: 9, color: colors.textSecondary }}>
                        {n.role} · {new Date(n.at).toLocaleString('en-GB')}
                      </Text>
                      <Text style={{ ...typography.body, fontSize: 12, color: colors.textPrimary }}>{n.text}</Text>
                    </View>
                  ))}
                </ScrollView>
                <TextInput
                  value={agencySharedNoteDraft}
                  onChangeText={setAgencySharedNoteDraft}
                  multiline
                  placeholder="Add a note for everyone on this booking…"
                  placeholderTextColor={colors.textSecondary}
                  style={[s.editInput, { minHeight: 72, textAlignVertical: 'top', borderRadius: 12 }]}
                />
                <TouchableOpacity
                  onPress={async () => {
                    if (!selectedCalendarItem || !agencySharedNoteDraft.trim() || !currentAgencyId) return;
                    setSavingAgencySharedNote(true);
                    try {
                      const ok = await appendSharedBookingNote(
                        selectedCalendarItem.option.id,
                        'agency',
                        agencySharedNoteDraft,
                      );
                      if (ok) {
                        setAgencySharedNoteDraft('');
                        await loadAgencyCalendar();
                        const items = await getCalendarEntriesForAgency(currentAgencyId);
                        const next = items.find((x) => x.option.id === selectedCalendarItem.option.id);
                        if (next) setSelectedCalendarItem(next);
                      }
                    } finally {
                      setSavingAgencySharedNote(false);
                    }
                  }}
                  style={[
                    s.saveBtn,
                    { marginTop: spacing.sm, alignSelf: 'flex-end', opacity: savingAgencySharedNote ? 0.6 : 1 },
                  ]}
                  disabled={savingAgencySharedNote}
                >
                  <Text style={s.saveBtnLabel}>
                    {savingAgencySharedNote ? 'Posting…' : 'Post shared note'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <Text style={s.sectionLabel}>Agency notes (internal)</Text>
            <TextInput
              value={agencyNotesDraft}
              onChangeText={setAgencyNotesDraft}
              multiline
              placeholder="Notes visible for client and model…"
              placeholderTextColor={colors.textSecondary}
              style={[
                s.editInput,
                {
                  height: 120,
                  textAlignVertical: 'top',
                  borderRadius: 12,
                },
              ]}
            />
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'flex-end',
                gap: spacing.sm,
                marginTop: spacing.lg,
              }}
            >
              <TouchableOpacity
                onPress={() => {
                  setSelectedCalendarItem(null);
                  setAgencyNotesDraft('');
                  setAgencySharedNoteDraft('');
                }}
                style={[s.filterPill, { paddingHorizontal: spacing.md }]}
              >
                <Text style={s.filterPillLabel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  if (!selectedCalendarItem) return;
                  setSavingNotes(true);
                  try {
                    await updateBookingDetails(
                      selectedCalendarItem.option.id,
                      { agency_notes: agencyNotesDraft },
                      'agency',
                    );
                    await loadAgencyCalendar();
                    setSelectedCalendarItem(null);
                    setAgencyNotesDraft('');
                  } finally {
                    setSavingNotes(false);
                  }
                }}
                style={[
                  s.saveBtn,
                  {
                    paddingHorizontal: spacing.lg,
                    alignSelf: 'auto',
                    opacity: savingNotes ? 0.6 : 1,
                  },
                ]}
                disabled={savingNotes}
              >
                <Text style={s.saveBtnLabel}>
                  {savingNotes ? 'Saving…' : 'Save notes'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {showAddManualEvent && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.08)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg }]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowAddManualEvent(false)} />
          <View style={{ width: '100%', maxWidth: 400, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.lg }}>
            <Text style={s.sectionLabel}>Add event</Text>
            <TextInput placeholder="Title" value={newEventForm.title} onChangeText={(t) => setNewEventForm((f) => ({ ...f, title: t }))} placeholderTextColor={colors.textSecondary} style={s.editInput} />
            <Text style={{ ...typography.label, marginTop: spacing.sm, marginBottom: 4 }}>Date (YYYY-MM-DD)</Text>
            <TextInput placeholder="2025-03-15" value={newEventForm.date} onChangeText={(d) => setNewEventForm((f) => ({ ...f, date: d }))} placeholderTextColor={colors.textSecondary} style={s.editInput} />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.label, marginBottom: 4 }}>From</Text>
                <TextInput value={newEventForm.start_time} onChangeText={(t) => setNewEventForm((f) => ({ ...f, start_time: t }))} placeholderTextColor={colors.textSecondary} style={s.editInput} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.label, marginBottom: 4 }}>To</Text>
                <TextInput value={newEventForm.end_time} onChangeText={(t) => setNewEventForm((f) => ({ ...f, end_time: t }))} placeholderTextColor={colors.textSecondary} style={s.editInput} />
              </View>
            </View>
            <Text style={{ ...typography.label, marginTop: spacing.sm, marginBottom: 4 }}>Note (private)</Text>
            <TextInput
              value={newEventForm.note}
              onChangeText={(t) => setNewEventForm((f) => ({ ...f, note: t }))}
              multiline
              placeholderTextColor={colors.textSecondary}
              style={[s.editInput, { minHeight: 64, textAlignVertical: 'top', borderRadius: 12 }]}
            />
            <Text style={{ ...typography.label, marginTop: spacing.sm, marginBottom: 4 }}>Color</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {MANUAL_EVENT_COLORS.map((c) => (
                <TouchableOpacity key={c} onPress={() => setNewEventForm((f) => ({ ...f, color: c }))} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c, borderWidth: newEventForm.color === c ? 2 : 0, borderColor: colors.textPrimary }} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <TouchableOpacity style={[s.filterPill, { flex: 1 }]} onPress={() => setShowAddManualEvent(false)}>
                <Text style={s.filterPillLabel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.saveBtn, { flex: 1 }]}
                disabled={!newEventForm.title.trim() || !newEventForm.date.trim() || savingManualEvent}
                onPress={async () => {
                  if (!currentAgencyId) return;
                  setSavingManualEvent(true);
                  let calOrg = agencyOrganizationId;
                  if (!calOrg) {
                    const pe = profile?.email?.trim().toLowerCase();
                    const ae = currentAgency?.email?.trim().toLowerCase();
                    if (pe && ae && pe === ae) {
                      calOrg = await ensureAgencyOrganization(currentAgencyId);
                    }
                    if (!calOrg) calOrg = await getOrganizationIdForAgency(currentAgencyId);
                  }
                  const { data: calUser } = await supabase.auth.getUser();
                  const result = await insertManualEvent({
                    owner_id: currentAgencyId,
                    owner_type: 'agency',
                    organization_id: calOrg,
                    created_by: calUser.user?.id ?? null,
                    ...newEventForm,
                  });
                  setSavingManualEvent(false);
                  if (result.ok) {
                    await loadAgencyCalendar();
                    setShowAddManualEvent(false);
                    setNewEventForm({
                      date: '',
                      start_time: '09:00',
                      end_time: '17:00',
                      title: '',
                      note: '',
                      color: MANUAL_EVENT_COLORS[0],
                    });
                  } else {
                    Alert.alert(
                      'Calendar',
                      result.errorMessage || uiCopy.alerts.calendarNotSaved,
                    );
                  }
                }}
              >
                <Text style={s.saveBtnLabel}>{savingManualEvent ? 'Adding…' : 'Add'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {selectedManualEvent && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.08)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg }]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setSelectedManualEvent(null)} />
          <View style={{ width: '100%', maxWidth: 400, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.lg }}>
            <Text style={s.sectionLabel}>{uiCopy.clientWeb.editEvent}</Text>
            <Text style={{ ...typography.label, marginTop: spacing.sm, marginBottom: 4 }}>Title</Text>
            <TextInput
              value={manualEventEditDraft.title}
              onChangeText={(t) => setManualEventEditDraft((p) => ({ ...p, title: t }))}
              placeholderTextColor={colors.textSecondary}
              style={s.editInput}
            />
            <Text style={{ ...typography.label, marginTop: spacing.sm, marginBottom: 4 }}>Date (YYYY-MM-DD)</Text>
            <TextInput
              value={manualEventEditDraft.date}
              onChangeText={(t) => setManualEventEditDraft((p) => ({ ...p, date: t }))}
              placeholderTextColor={colors.textSecondary}
              style={s.editInput}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.label, marginBottom: 4 }}>From</Text>
                <TextInput
                  value={manualEventEditDraft.start_time}
                  onChangeText={(t) => setManualEventEditDraft((p) => ({ ...p, start_time: t }))}
                  placeholderTextColor={colors.textSecondary}
                  style={s.editInput}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.label, marginBottom: 4 }}>To</Text>
                <TextInput
                  value={manualEventEditDraft.end_time}
                  onChangeText={(t) => setManualEventEditDraft((p) => ({ ...p, end_time: t }))}
                  placeholderTextColor={colors.textSecondary}
                  style={s.editInput}
                />
              </View>
            </View>
            <Text style={{ ...typography.label, marginTop: spacing.sm, marginBottom: 4 }}>Note (private)</Text>
            <TextInput
              value={manualEventEditDraft.note}
              onChangeText={(t) => setManualEventEditDraft((p) => ({ ...p, note: t }))}
              multiline
              placeholderTextColor={colors.textSecondary}
              style={[s.editInput, { minHeight: 72, textAlignVertical: 'top', borderRadius: 12 }]}
            />
            <Text style={{ ...typography.label, marginTop: spacing.sm, marginBottom: 4 }}>Color</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {MANUAL_EVENT_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setManualEventEditDraft((p) => ({ ...p, color: c }))}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: c,
                    borderWidth: manualEventEditDraft.color === c ? 2 : 0,
                    borderColor: colors.textPrimary,
                  }}
                />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, flexWrap: 'wrap' }}>
              <TouchableOpacity
                style={[s.saveBtn, { flex: 1, minWidth: 120, opacity: savingManualEventEdit ? 0.6 : 1 }]}
                disabled={savingManualEventEdit || !manualEventEditDraft.title.trim()}
                onPress={async () => {
                  if (!selectedManualEvent) return;
                  setSavingManualEventEdit(true);
                  try {
                    const ok = await updateManualEvent(selectedManualEvent.id, {
                      title: manualEventEditDraft.title.trim(),
                      date: manualEventEditDraft.date.trim(),
                      start_time: manualEventEditDraft.start_time.trim() || null,
                      end_time: manualEventEditDraft.end_time.trim() || null,
                      note: manualEventEditDraft.note.trim() || null,
                      color: manualEventEditDraft.color,
                    });
                    if (ok) {
                      await loadAgencyCalendar();
                      setSelectedManualEvent(null);
                      Alert.alert(uiCopy.common.success, uiCopy.alerts.calendarEntryUpdated);
                    } else {
                      Alert.alert(uiCopy.common.error, uiCopy.alerts.calendarSaveFailed);
                    }
                  } finally {
                    setSavingManualEventEdit(false);
                  }
                }}
              >
                <Text style={s.saveBtnLabel}>{savingManualEventEdit ? '…' : 'Save'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.filterPill, { flex: 1, minWidth: 100 }]}
                onPress={async () => {
                  if (!selectedManualEvent) return;
                  if (await deleteManualEvent(selectedManualEvent.id)) {
                    await loadAgencyCalendar();
                    setSelectedManualEvent(null);
                  }
                }}
              >
                <Text style={[s.filterPillLabel, { color: colors.buttonSkipRed }]}>Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.filterPill, { flex: 1, minWidth: 100 }]} onPress={() => setSelectedManualEvent(null)}>
                <Text style={s.filterPillLabel}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

const DashboardTab: React.FC<{ models: AgencyModel[] }> = ({ models }) => (
  <ScreenScrollView>
    <Text style={s.sectionLabel}>Traction</Text>
    <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
      {models.map((m) => (
        <View key={m.id} style={s.tractionRow}>
          <Text style={s.modelName}>{m.name}</Text>
          <Text style={s.metaText}>{m.traction} swipes</Text>
        </View>
      ))}
      {models.length === 0 && <Text style={s.metaText}>No models yet.</Text>}
    </View>
  </ScreenScrollView>
);

type AgencyCalendarTabProps = {
  items: AgencyCalendarItem[];
  manualEvents: UserCalendarEvent[];
  loading: boolean;
  onRefresh: () => void;
  onOpenDetails: (item: AgencyCalendarItem) => void;
  onOpenManualEvent: (ev: UserCalendarEvent) => void;
  onAddEvent: () => void;
};

const AgencyCalendarTab: React.FC<AgencyCalendarTabProps> = ({
  items,
  manualEvents,
  loading,
  onRefresh,
  onOpenDetails,
  onOpenManualEvent,
  onAddEvent,
}) => {
  const [modelQuery, setModelQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const now = new Date();
  const [calendarMonth, setCalendarMonth] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarDayEvent[]> = {};
    manualEvents.forEach((ev) => {
      if (!map[ev.date]) map[ev.date] = [];
      map[ev.date].push({ id: ev.id, color: ev.color, title: ev.title, kind: 'manual' });
    });
    items.forEach((item) => {
      const date = item.calendar_entry?.date ?? item.option.requested_date ?? '';
      if (!date) return;
      if (!map[date]) map[date] = [];
      const entryType = item.calendar_entry?.entry_type;
      let color = '#1565C0';
      if (entryType === 'booking') color = colors.buttonSkipRed;
      else if (entryType === 'casting' || entryType === 'gosee') color = colors.textSecondary;
      map[date].push({
        id: item.option.id,
        color,
        title: item.option.model_name ?? 'Model',
        kind: entryType ?? 'option',
      });
    });
    return map;
  }, [items, manualEvents]);

  const filtered = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    return items.filter((item) => {
      const name = (item.option.model_name || '').toLowerCase();
      if (q && !name.includes(q)) return false;
      const date = item.calendar_entry?.date ?? item.option.requested_date;
      if (fromDate && date < fromDate) return false;
      if (toDate && date > toDate) return false;
      return true;
    });
  }, [items, modelQuery, fromDate, toDate]);

  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) =>
        (a.option.requested_date || '').localeCompare(
          b.option.requested_date || '',
        ),
      ),
    [filtered],
  );

  const sortedManual = useMemo(
    () =>
      [...manualEvents].sort((a, b) => {
        const d = (a.date || '').localeCompare(b.date || '');
        if (d !== 0) return d;
        return (a.start_time || '').localeCompare(b.start_time || '');
      }),
    [manualEvents],
  );

  const renderBadge = (item: AgencyCalendarItem) => {
    const { option, calendar_entry } = item;
    const entryType = calendar_entry?.entry_type;
    let kind: 'Option' | 'Job' | 'Casting' = 'Option';
    if (entryType === 'booking') kind = 'Job';
    if (entryType === 'casting' || entryType === 'gosee') kind = 'Casting';
    const isJobConfirmed = calendar_entry?.status === 'booked';

    let color = '#1565C0'; // options in blue
    if (kind === 'Job' && isJobConfirmed) {
      color = colors.buttonSkipRed;
    } else if (kind === 'Casting' && option.status === 'confirmed') {
      color = colors.textSecondary;
    }

    const label =
      kind === 'Job'
        ? 'Job'
        : kind === 'Casting'
        ? 'Casting'
        : option.status === 'confirmed'
        ? 'Option (confirmed)'
        : 'Option (pending)';

    return (
      <View
        style={{
          borderRadius: 999,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
          backgroundColor: color,
        }}
      >
        <Text
          style={{
            ...typography.label,
            fontSize: 10,
            color: '#fff',
          }}
        >
          {label}
        </Text>
      </View>
    );
  };

  return (
    <ScreenScrollView>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: spacing.sm,
        }}
      >
        <Text style={s.sectionLabel}>Calendar</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <TouchableOpacity style={s.filterPill} onPress={onAddEvent}>
            <Text style={s.filterPillLabel}>+ Add event</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.filterPill} onPress={onRefresh}>
            <Text style={s.filterPillLabel}>
              {loading ? 'Loading…' : 'Refresh'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: spacing.sm,
          marginBottom: spacing.md,
        }}
      >
        <View style={{ flex: 1, minWidth: 160 }}>
          <Text style={s.metaText}>Filter by model</Text>
          <TextInput
            value={modelQuery}
            onChangeText={setModelQuery}
            placeholder="Model name…"
            placeholderTextColor={colors.textSecondary}
            style={s.editInput}
          />
        </View>
        <View style={{ width: 120 }}>
          <Text style={s.metaText}>From</Text>
          <TextInput
            value={fromDate}
            onChangeText={setFromDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textSecondary}
            style={s.editInput}
          />
        </View>
        <View style={{ width: 120 }}>
          <Text style={s.metaText}>To</Text>
          <TextInput
            value={toDate}
            onChangeText={setToDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textSecondary}
            style={s.editInput}
          />
        </View>
      </View>

      <MonthCalendarView
        year={calendarMonth.year}
        month={calendarMonth.month}
        eventsByDate={eventsByDate}
        onSelectDay={setSelectedDate}
        onPrevMonth={() => setCalendarMonth((m) => (m.month === 0 ? { year: m.year - 1, month: 11 } : { year: m.year, month: m.month - 1 }))}
        onNextMonth={() => setCalendarMonth((m) => (m.month === 11 ? { year: m.year + 1, month: 0 } : { year: m.year, month: m.month + 1 }))}
      />

      {selectedDate && (
        <View style={[s.modelRow, { marginBottom: spacing.sm }]}>
          <Text style={s.sectionLabel}>Tag: {selectedDate}</Text>
          <TouchableOpacity style={[s.filterPill, { alignSelf: 'flex-start', marginTop: spacing.xs }]} onPress={onAddEvent}>
            <Text style={s.filterPillLabel}>+ Event on this day</Text>
          </TouchableOpacity>
          {(eventsByDate[selectedDate] ?? []).length === 0 ? (
            <Text style={s.metaText}>No entries on this day.</Text>
          ) : (
            (eventsByDate[selectedDate] ?? []).map((ev) => (
              <TouchableOpacity
                key={ev.id}
                style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, paddingVertical: 4 }}
                onPress={() => {
                  const manual = manualEvents.find((e) => e.id === ev.id);
                  if (manual) onOpenManualEvent(manual);
                  else {
                    const item = items.find((i) => (i.calendar_entry?.date ?? i.option.requested_date) === selectedDate && i.option.id === ev.id);
                    if (item) onOpenDetails(item);
                  }
                }}
              >
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ev.color, marginRight: spacing.sm }} />
                <Text style={s.metaText}>{ev.title}</Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      )}

      {sorted.length === 0 && sortedManual.length === 0 && !loading && (
        <Text style={s.metaText}>No calendar entries yet.</Text>
      )}

        {sortedManual.map((ev) => (
          <TouchableOpacity
            key={ev.id}
            style={s.modelRow}
            onPress={() => onOpenManualEvent(ev)}
          >
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ev.color || '#888' }} />
              <View style={{ flex: 1 }}>
                <Text style={s.modelName}>{ev.title} · {ev.date}</Text>
                <Text style={s.metaText}>
                  {ev.start_time || '—'}{ev.end_time ? ` – ${ev.end_time}` : ''}
                  {ev.note ? ` · ${ev.note}` : ''}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}
        {sorted.map((item) => {
          const { option, calendar_entry } = item;
          const date = calendar_entry?.date ?? option.requested_date;
          const start =
            calendar_entry?.start_time ?? option.start_time ?? undefined;
          const end =
            calendar_entry?.end_time ?? option.end_time ?? undefined;
          return (
            <TouchableOpacity
              key={option.id}
              style={s.modelRow}
              onPress={() => onOpenDetails(item)}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.modelName}>
                  {option.model_name ?? 'Model'} · {date}
                </Text>
                <Text style={s.metaText}>
                  {option.client_name ?? 'Client'}
                  {start ? ` · ${start}${end ? `–${end}` : ''}` : ''}
                </Text>
              </View>
              {renderBadge(item)}
            </TouchableOpacity>
          );
        })}
    </ScreenScrollView>
  );
};

const MyModelsTab: React.FC<{
  models: SupabaseModel[];
  agencyId: string;
  onRefresh: () => void;
}> = ({ models, agencyId, onRefresh }) => {
  const [selectedModel, setSelectedModel] = useState<SupabaseModel | null>(null);
  const [countryFilter, setCountryFilter] = useState('');
  const [editField, setEditField] = useState<Record<string, string>>({});

  const [showAddForm, setShowAddForm] = useState(false);
  const [addFields, setAddFields] = useState<Record<string, string>>({});
  const [addLoading, setAddLoading] = useState(false);

  const [showMediaslideInput, setShowMediaslideInput] = useState(false);
  const [showNetwalkInput, setShowNetwalkInput] = useState(false);
  const [mediaslideKey, setMediaslideKey] = useState(() =>
    typeof window !== 'undefined' ? window.localStorage.getItem('ci_mediaslide_api_key') ?? '' : ''
  );
  const [netwalkKey, setNetwalkKey] = useState(() =>
    typeof window !== 'undefined' ? window.localStorage.getItem('ci_netwalk_api_key') ?? '' : ''
  );
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const [polasSource, setPolasSource] = useState<'mediaslide' | 'netwalk' | 'manual'>('manual');
  const [modelPhotos, setModelPhotos] = useState<Array<{ id?: string; url: string; visible: boolean }>>([]);
  const [polaroidPhotos, setPolaroidPhotos] = useState<Array<{ id?: string; url: string; visible: boolean }>>([]);
  const [newPhotoUrl, setNewPhotoUrl] = useState('');
  const [newPolaroidUrl, setNewPolaroidUrl] = useState('');
  const [showPolasOnProfile, setShowPolasOnProfile] = useState(true);

  const [territoryCountryCodes, setTerritoryCountryCodes] = useState<string[]>([]);
  const [territorySearch, setTerritorySearch] = useState('');

  const countries = useMemo(() =>
    Array.from(new Set(models.map((m) => m.country || m.city || 'Unknown').filter(Boolean))).sort(),
    [models]
  );

  const isoCountryList = useMemo(() => {
    const list = Object.entries(ISO_COUNTRY_NAMES)
      .map(([code, name]) => ({ code: code.toUpperCase(), name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, []);

  const visibleIsoCountries = useMemo(() => {
    const q = territorySearch.trim().toLowerCase();
    if (!q) return isoCountryList.slice(0, 40);
    return isoCountryList
      .filter((c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
      .slice(0, 40);
  }, [isoCountryList, territorySearch]);

  const filtered = useMemo(() => {
    if (!countryFilter) return models;
    return models.filter((m) => (m.country || m.city || '') === countryFilter);
  }, [models, countryFilter]);

  useEffect(() => {
    if (!selectedModel) {
      setModelPhotos([]);
      setPolaroidPhotos([]);
      setTerritoryCountryCodes([]);
      return;
    }
    void getPhotosForModel(selectedModel.id, 'portfolio').then((photos) => {
      setModelPhotos(photos.map((p) => ({ id: p.id, url: p.url, visible: p.visible })));
    });
    void getPhotosForModel(selectedModel.id, 'polaroid').then((photos) => {
      setPolaroidPhotos(photos.map((p) => ({ id: p.id, url: p.url, visible: p.visible })));
    });
    void getTerritoriesForModel(selectedModel.id).then((rows) => {
      setTerritoryCountryCodes(rows.map((r) => r.country_code.toUpperCase()));
    });
  }, [selectedModel?.id]);

  const handleAddModel = async () => {
    const name = addFields.name?.trim();
    if (!name || !agencyId) return;
    setAddLoading(true);
    try {
      const emailTrim = addFields.email?.trim() || null;
      const { data: created, error } = await supabase
        .from('models')
        .insert({
          agency_id: agencyId,
          name,
          email: emailTrim,
          agency_relationship_status: emailTrim ? 'pending_link' : 'active',
          agency_relationship_ended_at: null,
          height: addFields.height ? parseInt(addFields.height, 10) : null,
          bust: addFields.bust ? parseInt(addFields.bust, 10) : null,
          waist: addFields.waist ? parseInt(addFields.waist, 10) : null,
          hips: addFields.hips ? parseInt(addFields.hips, 10) : null,
          city: addFields.city || null,
          country: addFields.country || null,
          hair_color: addFields.hair_color || null,
          eye_color: addFields.eye_color || null,
        })
        .select()
        .single();
      if (error) throw error;
      setAddFields({});
      setShowAddForm(false);
      onRefresh();
      if (created) setSelectedModel(created as SupabaseModel);
    } finally {
      setAddLoading(false);
    }
  };

  const saveApiKey = (provider: 'mediaslide' | 'netwalk', key: string) => {
    const storageKey = provider === 'mediaslide' ? 'ci_mediaslide_api_key' : 'ci_netwalk_api_key';
    if (typeof window !== 'undefined') window.localStorage.setItem(storageKey, key);
    if (provider === 'mediaslide') { setMediaslideKey(key); setShowMediaslideInput(false); }
    else { setNetwalkKey(key); setShowNetwalkInput(false); }
  };

  const handleSync = () => {
    setSyncFeedback('Sync initiated...');
    setTimeout(() => setSyncFeedback(null), 3000);
  };

  const handleSaveModel = async () => {
    if (!selectedModel) return;
    const visiblePortfolio = modelPhotos.filter((p) => p.visible);
    if (visiblePortfolio.length === 0) {
      Alert.alert(uiCopy.modelRoster.portfolioRequiredTitle, uiCopy.modelRoster.portfolioRequiredBody);
      return;
    }
    const updates: any = {};
    if (editField.name !== undefined) updates.name = editField.name;
    if (editField.email !== undefined) updates.email = editField.email.trim() || null;
    if (editField.height !== undefined) updates.height = parseInt(editField.height, 10);
    if (editField.bust !== undefined) updates.bust = parseInt(editField.bust, 10);
    if (editField.waist !== undefined) updates.waist = parseInt(editField.waist, 10);
    if (editField.hips !== undefined) updates.hips = parseInt(editField.hips, 10);
    if (editField.legs_inseam !== undefined) updates.legs_inseam = parseInt(editField.legs_inseam, 10);
    if (editField.hair_color !== undefined) updates.hair_color = editField.hair_color;
    if (editField.eye_color !== undefined) updates.eye_color = editField.eye_color;
    if (editField.city !== undefined) updates.city = editField.city;
    if (editField.country !== undefined) updates.country = editField.country;
    if (editField.current_location !== undefined) updates.current_location = editField.current_location;
    if (editField.is_visible_commercial !== undefined) updates.is_visible_commercial = editField.is_visible_commercial === 'true';
    if (editField.is_visible_fashion !== undefined) updates.is_visible_fashion = editField.is_visible_fashion === 'true';
    updates.show_polas_on_profile = showPolasOnProfile;

    await supabase.from('models').update(updates).eq('id', selectedModel.id);

    const photoPayload = modelPhotos.map((p, index) => ({
      id: p.id,
      url: p.url,
      sort_order: index,
      visible: p.visible,
      source: null,
      api_external_id: null,
      photo_type: 'portfolio' as const,
    }));
    const polaroidPayload = polaroidPhotos.map((p, index) => ({
      id: p.id,
      url: p.url,
      sort_order: index,
      visible: p.visible,
      source: null,
      api_external_id: null,
      photo_type: 'polaroid' as const,
    }));
    await upsertPhotosForModel(selectedModel.id, [...photoPayload, ...polaroidPayload]);
    await syncPortfolioToModel(
      selectedModel.id,
      modelPhotos.filter((p) => p.visible).map((p) => p.url),
    );
    await syncPolaroidsToModel(
      selectedModel.id,
      polaroidPhotos.filter((p) => p.visible).map((p) => p.url),
    );

    // Persist representation territories (agency ↔ model ↔ country).
    await upsertTerritoriesForModel(selectedModel.id, agencyId, territoryCountryCodes);

    setSelectedModel(null);
    setEditField({});
    onRefresh();
  };

  const movePhoto = (idx: number, dir: number) => {
    const next = [...modelPhotos];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setModelPhotos(next);
  };
  const movePolaroid = (idx: number, dir: number) => {
    const next = [...polaroidPhotos];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setPolaroidPhotos(next);
  };
  const togglePhotoVisibility = (photo: { id?: string; url: string; visible: boolean }, idx: number) => {
    const next = [...modelPhotos];
    next[idx] = { ...photo, visible: !photo.visible };
    setModelPhotos(next);
  };
  const togglePolaroidVisibility = (photo: { id?: string; url: string; visible: boolean }, idx: number) => {
    const next = [...polaroidPhotos];
    next[idx] = { ...photo, visible: !photo.visible };
    setPolaroidPhotos(next);
  };
  const addPhoto = () => {
    if (!newPhotoUrl.trim()) return;
    setModelPhotos([...modelPhotos, { url: newPhotoUrl.trim(), visible: true }]);
    setNewPhotoUrl('');
  };

  const setCoverPhoto = (idx: number) => {
    if (idx <= 0 || idx >= modelPhotos.length) return;
    const next = [...modelPhotos];
    const [cover] = next.splice(idx, 1);
    next.unshift(cover);
    setModelPhotos(next);
  };

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [linkAccountEmail, setLinkAccountEmail] = useState('');
  const [linkAccountLoading, setLinkAccountLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const polaroidFileInputRef = useRef<HTMLInputElement | null>(null);

  const handlePhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target?.files ?? []);
    if (files.length === 0 || !selectedModel) return;
    const imageFiles = files.filter((f) => f.type?.startsWith('image/'));
    if (imageFiles.length === 0) return;
    e.target.value = '';
    setUploadingPhoto(true);
    try {
      const uploadedUrls: string[] = [];
      for (const file of imageFiles) {
        const url = await uploadModelPhoto(selectedModel.id, file);
        if (url) uploadedUrls.push(url);
      }
      if (uploadedUrls.length) {
        setModelPhotos((prev) => [...prev, ...uploadedUrls.map((url) => ({ url, visible: true }))]);
      }
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handlePolaroidFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target?.files ?? []);
    if (files.length === 0 || !selectedModel) return;
    const imageFiles = files.filter((f) => f.type?.startsWith('image/'));
    if (imageFiles.length === 0) return;
    e.target.value = '';
    setUploadingPhoto(true);
    try {
      const uploadedUrls: string[] = [];
      for (const file of imageFiles) {
        const url = await uploadModelPhoto(selectedModel.id, file);
        if (url) uploadedUrls.push(url);
      }
      if (uploadedUrls.length) {
        setPolaroidPhotos((prev) => [...prev, ...uploadedUrls.map((url) => ({ url, visible: true }))]);
      }
    } finally {
      setUploadingPhoto(false);
    }
  };

  const pickFromLibrary = async (target: 'portfolio' | 'polaroid') => {
    if (!selectedModel) return;
    if (Platform.OS === 'web') {
      if (target === 'portfolio') fileInputRef.current?.click();
      else polaroidFileInputRef.current?.click();
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to upload images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsMultipleSelection: true,
    });
    if (result.canceled || !result.assets?.length) return;
    setUploadingPhoto(true);
    try {
      for (const asset of result.assets) {
        const res = await fetch(asset.uri);
        const blob = await res.blob();
        const url = await uploadModelPhoto(selectedModel.id, blob);
        if (url) {
          if (target === 'portfolio') {
            setModelPhotos((prev) => [...prev, { url, visible: true }]);
          } else {
            setPolaroidPhotos((prev) => [...prev, { url, visible: true }]);
          }
        }
      }
    } finally {
      setUploadingPhoto(false);
    }
  };

  if (selectedModel) {
    const ef = (field: string, fallback: any) => editField[field] ?? String(fallback ?? '');
    const needsAccountLink = !selectedModel.user_id;
    return (
      <ScreenScrollView>
        <TouchableOpacity onPress={() => { setSelectedModel(null); setEditField({}); }} style={{ marginBottom: spacing.md }}>
          <Text style={s.backLabel}>← Back to models</Text>
        </TouchableOpacity>
        <Text style={s.heading}>{selectedModel.name}</Text>
        {[
          { key: 'name', label: 'Name', val: selectedModel.name },
          { key: 'email', label: 'Model email', val: selectedModel.email ?? '' },
          { key: 'height', label: 'Height (cm)', val: selectedModel.height },
          { key: 'bust', label: 'Chest', val: selectedModel.bust ?? selectedModel.chest },
          { key: 'waist', label: 'Waist', val: selectedModel.waist },
          { key: 'hips', label: 'Hips', val: selectedModel.hips },
          { key: 'legs_inseam', label: 'Legs inseam', val: selectedModel.legs_inseam },
          { key: 'hair_color', label: 'Hair color', val: selectedModel.hair_color },
          { key: 'eye_color', label: 'Eye color', val: selectedModel.eye_color },
          { key: 'city', label: 'City', val: selectedModel.city },
          { key: 'country', label: 'Country', val: selectedModel.country },
          { key: 'current_location', label: 'Current location', val: selectedModel.current_location },
        ].map(({ key, label, val }) => (
          <View key={key} style={{ marginBottom: spacing.sm }}>
            <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary }}>{label}</Text>
            <TextInput
              value={ef(key, val)}
              onChangeText={(v) => setEditField((prev) => ({ ...prev, [key]: v }))}
              style={s.editInput}
              placeholderTextColor={colors.textSecondary}
            />
          </View>
        ))}
        <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary, marginTop: spacing.sm }}>Visibility</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 4, marginBottom: spacing.lg }}>
          <TouchableOpacity
            style={[s.visPill, (ef('is_visible_commercial', selectedModel.is_visible_commercial) === 'true' || (editField.is_visible_commercial === undefined && selectedModel.is_visible_commercial)) && s.visPillActive]}
            onPress={() => setEditField((prev) => ({ ...prev, is_visible_commercial: prev.is_visible_commercial === 'true' || (prev.is_visible_commercial === undefined && selectedModel.is_visible_commercial) ? 'false' : 'true' }))}
          >
            <Text style={[s.visPillLabel, (ef('is_visible_commercial', selectedModel.is_visible_commercial) === 'true' || (editField.is_visible_commercial === undefined && selectedModel.is_visible_commercial)) && s.visPillLabelActive]}>Commercial</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.visPill, (ef('is_visible_fashion', selectedModel.is_visible_fashion) === 'true' || (editField.is_visible_fashion === undefined && selectedModel.is_visible_fashion)) && s.visPillActive]}
            onPress={() => setEditField((prev) => ({ ...prev, is_visible_fashion: prev.is_visible_fashion === 'true' || (prev.is_visible_fashion === undefined && selectedModel.is_visible_fashion) ? 'false' : 'true' }))}
          >
            <Text style={[s.visPillLabel, (ef('is_visible_fashion', selectedModel.is_visible_fashion) === 'true' || (editField.is_visible_fashion === undefined && selectedModel.is_visible_fashion)) && s.visPillLabelActive]}>Fashion</Text>
          </TouchableOpacity>
        </View>

        {/* Model Photos Management */}
        <View style={{ marginTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
          <Text style={s.sectionLabel}>{uiCopy.modelRoster.portfolioTitle}</Text>
          <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm }}>
            {uiCopy.modelRoster.portfolioHint}
          </Text>

          {/* Polas API connection */}
          <View style={{ marginBottom: spacing.md }}>
            <Text style={{ ...typography.label, fontSize: 11, color: colors.textSecondary, marginBottom: 4 }}>
              Polas Source
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity
                style={[s.apiBtn, polasSource === 'mediaslide' && { borderColor: colors.accent }]}
                onPress={() => setPolasSource('mediaslide')}
              >
                <Text style={s.apiBtnLabel}>Mediaslide</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.apiBtn, polasSource === 'netwalk' && { borderColor: colors.accent }]}
                onPress={() => setPolasSource('netwalk')}
              >
                <Text style={s.apiBtnLabel}>Netwalk</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.apiBtn, polasSource === 'manual' && { borderColor: colors.accent }]}
                onPress={() => setPolasSource('manual')}
              >
                <Text style={s.apiBtnLabel}>Manual</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ ...typography.body, fontSize: 10, color: colors.textSecondary, marginTop: 4 }}>
              {polasSource === 'manual' ? 'Upload photos manually' : `Photos synced from ${polasSource} API`}
            </Text>
          </View>

          {/* Photo list with reorder and Set as cover */}
          <Text style={{ ...typography.label, fontSize: 11, color: colors.textSecondary, marginBottom: 4 }}>
            {modelPhotos.length} image(s) — first = cover
          </Text>
          {modelPhotos.map((photo, idx) => (
            <View key={photo.id || `photo-${idx}`} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              {typeof Image !== 'undefined' && photo.url ? (
                <Image source={{ uri: photo.url }} style={{ width: 40, height: 40, borderRadius: 4, marginRight: 8, backgroundColor: colors.border }} resizeMode="cover" />
              ) : null}
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.body, fontSize: 11 }} numberOfLines={1}>{photo.url ? (photo.url.length > 50 ? photo.url.slice(0, 47) + '…' : photo.url) : `Photo ${idx + 1}`}</Text>
                <Text style={{ ...typography.label, fontSize: 9, color: photo.visible ? colors.buttonOptionGreen : colors.textSecondary }}>
                  {uiCopy.modelRoster.visibleInClientSwipe}: {photo.visible ? uiCopy.common.yes : uiCopy.common.no}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                {idx > 0 && (
                  <TouchableOpacity onPress={() => setCoverPhoto(idx)} style={[s.filterPill, { paddingHorizontal: 6, paddingVertical: 2 }]}>
                    <Text style={[s.filterPillLabel, { fontSize: 10 }]}>Cover</Text>
                  </TouchableOpacity>
                )}
                {idx === 0 && <Text style={{ ...typography.label, fontSize: 9, color: colors.buttonOptionGreen }}>Cover</Text>}
                <TouchableOpacity onPress={() => movePhoto(idx, -1)} disabled={idx === 0}>
                  <Text style={{ fontSize: 16, color: idx === 0 ? colors.textSecondary : colors.textPrimary }}>↑</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => movePhoto(idx, 1)} disabled={idx === modelPhotos.length - 1}>
                  <Text style={{ fontSize: 16, color: idx === modelPhotos.length - 1 ? colors.textSecondary : colors.textPrimary }}>↓</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => togglePhotoVisibility(photo, idx)}>
                  <Text style={{ fontSize: 14 }}>{photo.visible ? '👁' : '🚫'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          {/* Upload and URL */}
          {polasSource === 'manual' && (
            <View style={{ marginTop: spacing.sm }}>
              {typeof window !== 'undefined' && (
                <>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    ref={fileInputRef}
                    onChange={handlePhotoFile}
                    style={{ display: 'none' }}
                  />
                  <TouchableOpacity
                    onPress={() => fileInputRef.current?.click()}
                    disabled={uploadingPhoto}
                    style={[s.apiBtn, { marginBottom: 8 }]}
                  >
                    <Text style={s.apiBtnLabel}>{uploadingPhoto ? 'Uploading…' : '+ Upload photo'}</Text>
                  </TouchableOpacity>
                </>
              )}
              {Platform.OS !== 'web' && (
                <TouchableOpacity
                  onPress={() => void pickFromLibrary('portfolio')}
                  disabled={uploadingPhoto}
                  style={[s.apiBtn, { marginBottom: 8 }]}
                >
                  <Text style={s.apiBtnLabel}>
                    {uploadingPhoto ? 'Uploading…' : uiCopy.modelRoster.pickFromLibrary}
                  </Text>
                </TouchableOpacity>
              )}
              <TextInput
                value={newPhotoUrl}
                onChangeText={setNewPhotoUrl}
                placeholder="Or paste photo URL"
                placeholderTextColor={colors.textSecondary}
                style={[s.editInput, { height: 36 }]}
              />
              <TouchableOpacity onPress={addPhoto} style={[s.apiBtn, { marginTop: 4 }]}>
                <Text style={s.apiBtnLabel}>+ Add URL</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={{ marginTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
            <Text style={s.sectionLabel}>{uiCopy.modelRoster.polaroidsTitle}</Text>
            <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm }}>
              {uiCopy.modelRoster.polaroidsHint}
            </Text>
            {polaroidPhotos.map((photo, idx) => (
              <View
                key={photo.id || `pola-${idx}`}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}
              >
                {typeof Image !== 'undefined' && photo.url ? (
                  <Image
                    source={{ uri: photo.url }}
                    style={{ width: 40, height: 40, borderRadius: 4, marginRight: 8, backgroundColor: colors.border }}
                    resizeMode="cover"
                  />
                ) : null}
                <View style={{ flex: 1 }}>
                  <Text style={{ ...typography.body, fontSize: 11 }} numberOfLines={1}>
                    {photo.url ? (photo.url.length > 50 ? photo.url.slice(0, 47) + '…' : photo.url) : `Polaroid ${idx + 1}`}
                  </Text>
                  <Text style={{ ...typography.label, fontSize: 9, color: photo.visible ? colors.buttonOptionGreen : colors.textSecondary }}>
                    {uiCopy.modelRoster.visibleInClientSwipe}: {photo.visible ? uiCopy.common.yes : uiCopy.common.no}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                  <TouchableOpacity onPress={() => movePolaroid(idx, -1)} disabled={idx === 0}>
                    <Text style={{ fontSize: 16, color: idx === 0 ? colors.textSecondary : colors.textPrimary }}>↑</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => movePolaroid(idx, 1)} disabled={idx === polaroidPhotos.length - 1}>
                    <Text style={{ fontSize: 16, color: idx === polaroidPhotos.length - 1 ? colors.textSecondary : colors.textPrimary }}>↓</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => togglePolaroidVisibility(photo, idx)}>
                    <Text style={{ fontSize: 14 }}>{photo.visible ? '👁' : '🚫'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            {polasSource === 'manual' && (
              <View style={{ marginTop: spacing.sm }}>
                {typeof window !== 'undefined' && (
                  <>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      ref={polaroidFileInputRef}
                      onChange={handlePolaroidFile}
                      style={{ display: 'none' }}
                    />
                    <TouchableOpacity
                      onPress={() => polaroidFileInputRef.current?.click()}
                      disabled={uploadingPhoto}
                      style={[s.apiBtn, { marginBottom: 8 }]}
                    >
                      <Text style={s.apiBtnLabel}>{uploadingPhoto ? 'Uploading…' : '+ Upload polaroid'}</Text>
                    </TouchableOpacity>
                  </>
                )}
                {Platform.OS !== 'web' && (
                  <TouchableOpacity
                    onPress={() => void pickFromLibrary('polaroid')}
                    disabled={uploadingPhoto}
                    style={[s.apiBtn, { marginBottom: 8 }]}
                  >
                    <Text style={s.apiBtnLabel}>
                      {uploadingPhoto ? 'Uploading…' : `${uiCopy.modelRoster.pickFromLibrary} (polaroid)`}
                    </Text>
                  </TouchableOpacity>
                )}
                <TextInput
                  value={newPolaroidUrl}
                  onChangeText={setNewPolaroidUrl}
                  placeholder={uiCopy.modelRoster.addPolaroidUrlPlaceholder}
                  placeholderTextColor={colors.textSecondary}
                  style={[s.editInput, { height: 36 }]}
                />
                <TouchableOpacity
                  onPress={() => {
                    if (!newPolaroidUrl.trim()) return;
                    setPolaroidPhotos((prev) => [...prev, { url: newPolaroidUrl.trim(), visible: true }]);
                    setNewPolaroidUrl('');
                  }}
                  style={[s.apiBtn, { marginTop: 4 }]}
                >
                  <Text style={s.apiBtnLabel}>+ Add polaroid URL</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Territories of Representation */}
          <View style={{ marginTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
            <Text style={s.sectionLabel}>{uiCopy.modelRoster.territoriesTitle}</Text>
            <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm }}>
              {uiCopy.modelRoster.territoriesHint}
            </Text>

            <TextInput
              value={territorySearch}
              onChangeText={setTerritorySearch}
              placeholder={uiCopy.modelRoster.territoriesSearchPlaceholder}
              placeholderTextColor={colors.textSecondary}
              style={[s.editInput, { height: 36, marginBottom: spacing.sm }]}
              autoCapitalize="characters"
            />

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm }}>
              {territoryCountryCodes.length === 0 ? (
                <Text style={s.metaText}>{uiCopy.modelRoster.noTerritoriesSelected}</Text>
              ) : (
                territoryCountryCodes.map((code) => (
                  <TouchableOpacity
                    key={code}
                    onPress={() => setTerritoryCountryCodes((prev) => prev.filter((c) => c !== code))}
                    style={[
                      s.filterPill,
                      {
                        backgroundColor: colors.buttonOptionGreen,
                        opacity: 0.9,
                        borderWidth: 1,
                        borderColor: colors.buttonOptionGreen,
                      },
                    ]}
                  >
                    <Text style={[s.filterPillLabel, { fontSize: 10, color: '#fff' }]}>{code}</Text>
                  </TouchableOpacity>
                ))
              )}
            </View>

            <ScrollView style={{ maxHeight: 200 }}>
              {visibleIsoCountries.map((c) => {
                const active = territoryCountryCodes.includes(c.code);
                return (
                  <TouchableOpacity
                    key={c.code}
                    onPress={() => {
                      setTerritoryCountryCodes((prev) => {
                        if (prev.includes(c.code)) return prev.filter((x) => x !== c.code);
                        return [...prev, c.code];
                      });
                    }}
                    style={[
                      s.filterPill,
                      {
                        backgroundColor: active ? colors.buttonOptionGreen : colors.surface,
                        opacity: 1,
                        borderWidth: 1,
                        borderColor: active ? colors.buttonOptionGreen : colors.border,
                      },
                    ]}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        s.filterPillLabel,
                        {
                          fontSize: 10,
                          color: active ? '#fff' : colors.textPrimary,
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {c.name} ({c.code})
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Show on profile toggle */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, gap: spacing.sm }}>
            <TouchableOpacity onPress={() => setShowPolasOnProfile(!showPolasOnProfile)} style={[s.apiBtn, showPolasOnProfile && { borderColor: colors.accent }]}>
              <Text style={s.apiBtnLabel}>{showPolasOnProfile ? '✓ Show polas on profile' : 'Show polas on profile'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {needsAccountLink && (
          <View style={{ marginTop: spacing.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface }}>
            <Text style={s.sectionLabel}>Link app account</Text>
            <Text style={[s.metaText, { marginBottom: spacing.sm }]}>
              If this profile was created via Mediaslide/Netwalk or manually, connect the model’s registered Casting Index email so they get the full model dashboard (calendar, options, chats).
            </Text>
            <TextInput
              value={linkAccountEmail}
              onChangeText={setLinkAccountEmail}
              placeholder="Model signup email (same as profile)"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              keyboardType="email-address"
              style={[s.editInput, { marginBottom: spacing.sm }]}
            />
            <TouchableOpacity
              style={[s.saveBtn, { opacity: linkAccountLoading ? 0.6 : 1 }]}
              disabled={linkAccountLoading}
              onPress={async () => {
                const em = linkAccountEmail.trim();
                if (!em) {
                  Alert.alert('Email required', 'Enter the email the model used to register.');
                  return;
                }
                setLinkAccountLoading(true);
                try {
                  const ok = await agencyLinkModelToUser(selectedModel.id, agencyId, em);
                  if (ok) {
                    setLinkAccountEmail('');
                    Alert.alert('Linked', 'The model account is now connected to this profile.');
                    onRefresh();
                    const refreshed = await getModelsForAgencyFromSupabase(agencyId);
                    const m = refreshed.find((x) => x.id === selectedModel.id);
                    if (m) setSelectedModel(m);
                  } else {
                    Alert.alert(
                      'Could not link',
                      'No model-role user with that email was found, or the email does not match. The model must sign up first; you can also rely on automatic link when their profile email matches this roster email.',
                    );
                  }
                } finally {
                  setLinkAccountLoading(false);
                }
              }}
            >
              <Text style={s.saveBtnLabel}>{linkAccountLoading ? 'Linking…' : 'Link account'}</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity onPress={handleSaveModel} style={s.saveBtn}>
          <Text style={s.saveBtnLabel}>Save changes</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{ marginTop: spacing.xl, paddingVertical: spacing.sm, borderRadius: 8, borderWidth: 1, borderColor: '#e74c3c', alignItems: 'center' }}
          onPress={() => {
            Alert.alert(
              'End representation',
              'Soft-remove: the model disappears from My Models and client discovery. Past options, jobs and billing history stay in the system. Territories for this model are cleared. Continue?',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'End representation',
                  style: 'destructive',
                  onPress: async () => {
                    const ok = await removeModelFromAgency(selectedModel.id, agencyId);
                    if (ok) {
                      setSelectedModel(null);
                      setEditField({});
                      onRefresh();
                    }
                  },
                },
              ]
            );
          }}
        >
          <Text style={{ ...typography.label, fontSize: 12, color: '#e74c3c' }}>End representation (soft-remove)</Text>
        </TouchableOpacity>
      </ScreenScrollView>
    );
  }

  return (
    <ScreenScrollView>
      {/* API Import Section */}
      <View style={s.apiSection}>
        <Text style={s.sectionLabel}>API Import</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
          <TouchableOpacity style={s.apiBtn} onPress={() => setShowMediaslideInput((v) => !v)}>
            <Text style={s.apiBtnLabel}>Connect Mediaslide</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.apiBtn} onPress={() => setShowNetwalkInput((v) => !v)}>
            <Text style={s.apiBtnLabel}>Connect Netwalk</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm }}>
          <Text style={s.metaText}>Mediaslide: {mediaslideKey ? 'Connected' : 'Not connected'}</Text>
          <Text style={s.metaText}>Netwalk: {netwalkKey ? 'Connected' : 'Not connected'}</Text>
        </View>
        {showMediaslideInput && (
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, alignItems: 'center' }}>
            <TextInput
              value={mediaslideKey}
              onChangeText={setMediaslideKey}
              placeholder="Mediaslide API Key"
              placeholderTextColor={colors.textSecondary}
              style={[s.editInput, { flex: 1 }]}
            />
            <TouchableOpacity style={s.apiConnectBtn} onPress={() => saveApiKey('mediaslide', mediaslideKey)}>
              <Text style={s.saveBtnLabel}>Connect</Text>
            </TouchableOpacity>
          </View>
        )}
        {showNetwalkInput && (
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, alignItems: 'center' }}>
            <TextInput
              value={netwalkKey}
              onChangeText={setNetwalkKey}
              placeholder="Netwalk API Key"
              placeholderTextColor={colors.textSecondary}
              style={[s.editInput, { flex: 1 }]}
            />
            <TouchableOpacity style={s.apiConnectBtn} onPress={() => saveApiKey('netwalk', netwalkKey)}>
              <Text style={s.saveBtnLabel}>Connect</Text>
            </TouchableOpacity>
          </View>
        )}
        {(mediaslideKey || netwalkKey) && (
          <TouchableOpacity style={[s.saveBtn, { alignSelf: 'flex-start', paddingHorizontal: spacing.lg }]} onPress={handleSync}>
            <Text style={s.saveBtnLabel}>Sync Models</Text>
          </TouchableOpacity>
        )}
        {syncFeedback && <Text style={{ ...typography.body, fontSize: 12, color: colors.accentGreen, marginTop: spacing.xs }}>{syncFeedback}</Text>}
      </View>

      <Text style={s.sectionLabel}>My Models</Text>
      <View style={{ flexDirection: 'row', gap: 4, marginBottom: spacing.md, flexWrap: 'wrap' }}>
        <TouchableOpacity style={[s.filterPill, !countryFilter && s.filterPillActive]} onPress={() => setCountryFilter('')}>
          <Text style={[s.filterPillLabel, !countryFilter && s.filterPillLabelActive]}>All</Text>
        </TouchableOpacity>
        {countries.map((c) => (
          <TouchableOpacity key={c} style={[s.filterPill, countryFilter === c && s.filterPillActive]} onPress={() => setCountryFilter(c)}>
            <Text style={[s.filterPillLabel, countryFilter === c && s.filterPillLabelActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Add Model Manually */}
      <TouchableOpacity style={[s.apiBtn, { alignSelf: 'flex-start', marginBottom: spacing.md }]} onPress={() => setShowAddForm((v) => !v)}>
        <Text style={s.apiBtnLabel}>{showAddForm ? 'Cancel' : '+ Add Model Manually'}</Text>
      </TouchableOpacity>
      {showAddForm && (
        <View style={s.addFormContainer}>
          {([
            { key: 'name', label: 'Name *', placeholder: 'Full name' },
            { key: 'email', label: 'Model email (they sign up with this)', placeholder: 'model@example.com' },
            { key: 'height', label: 'Height (cm)', placeholder: '175' },
            { key: 'bust', label: 'Bust / Chest', placeholder: '86' },
            { key: 'waist', label: 'Waist', placeholder: '62' },
            { key: 'hips', label: 'Hips', placeholder: '89' },
            { key: 'city', label: 'City', placeholder: 'Berlin' },
            { key: 'country', label: 'Country', placeholder: 'Germany' },
            { key: 'hair_color', label: 'Hair color', placeholder: 'Brown' },
            { key: 'eye_color', label: 'Eye color', placeholder: 'Blue' },
          ] as const).map(({ key, label, placeholder }) => (
            <View key={key} style={{ marginBottom: spacing.sm }}>
              <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary }}>{label}</Text>
              <TextInput
                value={addFields[key] ?? ''}
                onChangeText={(v) => setAddFields((prev) => ({ ...prev, [key]: v }))}
                placeholder={placeholder}
                placeholderTextColor={colors.textSecondary}
                style={s.editInput}
                keyboardType={['height', 'bust', 'waist', 'hips'].includes(key) ? 'numeric' : key === 'email' ? 'email-address' : 'default'}
              />
            </View>
          ))}
          <TouchableOpacity
            style={[s.saveBtn, (!addFields.name?.trim() || addLoading) && { opacity: 0.4 }]}
            onPress={handleAddModel}
            disabled={!addFields.name?.trim() || addLoading}
          >
            <Text style={s.saveBtnLabel}>{addLoading ? 'Adding...' : 'Add Model'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {filtered.map((m) => (
        <TouchableOpacity key={m.id} style={s.modelRow} onPress={() => setSelectedModel(m)}>
          <View style={{ flex: 1 }}>
            <Text style={s.modelName}>{m.name}</Text>
            <Text style={s.metaText}>{m.city ?? '—'} · H{m.height} C{m.bust ?? m.chest ?? '—'} W{m.waist ?? '—'} H{m.hips ?? '—'}</Text>
            {(m.agency_relationship_status === 'pending_link' || (!m.user_id && m.email)) && (
              <Text style={{ ...typography.label, fontSize: 9, color: '#B8860B', marginTop: 2 }}>Pending app account link</Text>
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {m.is_visible_commercial && <View style={s.visTag}><Text style={s.visTagLabel}>C</Text></View>}
            {m.is_visible_fashion && <View style={[s.visTag, { borderColor: colors.accentBrown }]}><Text style={[s.visTagLabel, { color: colors.accentBrown }]}>F</Text></View>}
          </View>
          <Text style={{ fontSize: 14, color: colors.textSecondary, marginLeft: spacing.sm }}>›</Text>
        </TouchableOpacity>
      ))}
      {filtered.length === 0 && <Text style={s.metaText}>No models found.</Text>}
    </ScreenScrollView>
  );
};

type AgencyClientsTabProps = {
  agencyId: string;
  currentUserId: string | null;
  onChatStarted: (conversationId: string, title: string) => void;
};

const AgencyClientsTab: React.FC<AgencyClientsTabProps> = ({
  agencyId,
  currentUserId,
  onChatStarted,
}) => {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<ClientOrganizationDirectoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!agencyId) {
      setRows([]);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    const t = setTimeout(() => {
      void listClientOrganizationsForAgencyDirectory(agencyId, search).then((list) => {
        if (!cancelled) {
          setRows(list);
          setLoading(false);
        }
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, agencyId]);

  const startChat = async (clientOrganizationId: string, title: string) => {
    if (!currentUserId) {
      showAppAlert(uiCopy.alerts.signInRequired, uiCopy.b2bChat.signInToChatGeneric);
      return;
    }
    setActionId(clientOrganizationId);
    try {
      const r = await ensureClientAgencyChat({
        clientOrganizationId,
        agencyId,
        actingUserId: currentUserId,
      });
      if (!r.ok) {
        showAppAlert(uiCopy.b2bChat.chatFailedTitle, r.reason || uiCopy.b2bChat.chatFailedGeneric);
        return;
      }
      onChatStarted(r.conversationId, title);
    } finally {
      setActionId(null);
    }
  };

  return (
    <ScreenScrollView>
      <Text style={s.sectionLabel}>{uiCopy.b2bChat.clientsSectionTitle}</Text>
      <Text style={[s.metaText, { marginBottom: spacing.sm }]}>{uiCopy.b2bChat.clientsSectionSubtitle}</Text>
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder={uiCopy.b2bChat.clientsSearchPlaceholder}
        placeholderTextColor={colors.textSecondary}
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 10,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          marginBottom: spacing.md,
          ...typography.body,
          fontSize: 14,
          color: colors.textPrimary,
        }}
      />
      {loading ? <Text style={s.metaText}>{uiCopy.common.loading}</Text> : null}
      {rows.map((row) => {
        const label = row.name?.trim() || row.id.slice(0, 8);
        const sub = row.organization_type ? row.organization_type.replace(/_/g, ' ') : '';
        return (
          <View
            key={row.id}
            style={[s.modelRow, { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }]}
          >
            <View style={{ flex: 1, minWidth: 160 }}>
              <Text style={s.modelName}>{label}</Text>
              <Text style={s.metaText}>{sub}</Text>
            </View>
            <TouchableOpacity
              style={[s.filterPill, { backgroundColor: colors.buttonOptionGreen, opacity: actionId === row.id ? 0.6 : 1 }]}
              disabled={actionId === row.id}
              onPress={() => void startChat(row.id, label)}
            >
              <Text style={[s.filterPillLabel, { color: '#fff' }]}>{uiCopy.b2bChat.startChat}</Text>
            </TouchableOpacity>
          </View>
        );
      })}
      {!loading && rows.length === 0 ? <Text style={s.metaText}>{uiCopy.b2bChat.clientsEmpty}</Text> : null}
    </ScreenScrollView>
  );
};

type AgencyMessagesTabProps = {
  recruitingThreads: RecruitingThread[];
  onRefreshRecruitingThreads: () => void;
  onOpenRecruitingThread: (threadId: string) => void;
  agencyId: string | null;
  currentUserId: string | null;
  pendingOpenB2BChat: { conversationId: string; title: string } | null;
  onPendingB2BChatConsumed: () => void;
};

const AgencyMessagesTab: React.FC<AgencyMessagesTabProps> = ({
  recruitingThreads,
  onRefreshRecruitingThreads,
  onOpenRecruitingThread,
  agencyId,
  currentUserId,
  pendingOpenB2BChat,
  onPendingB2BChatConsumed,
}) => {
  const [messagesSection, setMessagesSection] = useState<'optionRequests' | 'recruiting' | 'clientRequests'>('clientRequests');
  const [b2bConversations, setB2bConversations] = useState<Conversation[]>([]);
  const [agencyOrgIdB2b, setAgencyOrgIdB2b] = useState<string | null>(null);
  const [b2bTitles, setB2bTitles] = useState<Record<string, string>>({});
  const [guestLinksForChat, setGuestLinksForChat] = useState<GuestLink[]>([]);
  const [modelsForShare, setModelsForShare] = useState<{ id: string; name: string }[]>([]);
  const [activeConnectionChatId, setActiveConnectionChatId] = useState<string | null>(null);
  const [activeConnectionChatTitle, setActiveConnectionChatTitle] = useState('');
  const [requests, setRequests] = useState(getOptionRequests());
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [agencyCounterInput, setAgencyCounterInput] = useState('');
  const [msgFilter, setMsgFilter] = useState<'current' | 'archived' | 'applications'>('current');
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try { const raw = window.localStorage.getItem('ci_agency_archived'); return raw ? new Set(JSON.parse(raw)) : new Set(); }
    catch { return new Set(); }
  });

  useEffect(() => {
    setRequests(getOptionRequests());
    const unsub = subscribe(() => setRequests(getOptionRequests()));
    return unsub;
  }, []);

  useEffect(() => {
    if (messagesSection === 'recruiting') {
      onRefreshRecruitingThreads();
    }
  }, [messagesSection, onRefreshRecruitingThreads]);

  useEffect(() => {
    if (!agencyId) {
      setAgencyOrgIdB2b(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      // Booker/employee: RPC fails (email mismatch) — org id still exists; resolve by agency_id.
      let oid = await ensureAgencyOrganization(agencyId);
      if (!oid) oid = await getOrganizationIdForAgency(agencyId);
      if (!cancelled) setAgencyOrgIdB2b(oid);
    })();
    return () => {
      cancelled = true;
    };
  }, [agencyId]);

  const refreshB2bList = useCallback(() => {
    if (!agencyOrgIdB2b) return;
    void listB2BConversationsForOrganization(agencyOrgIdB2b).then(setB2bConversations);
  }, [agencyOrgIdB2b]);

  useEffect(() => {
    refreshB2bList();
  }, [refreshB2bList, messagesSection]);

  useEffect(() => {
    if (!agencyOrgIdB2b || b2bConversations.length === 0) {
      setB2bTitles({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      b2bConversations.map(async (c) => {
        const t = await getB2BConversationTitleForViewer({
          conversation: c,
          viewerOrganizationId: agencyOrgIdB2b,
        });
        return [c.id, t] as const;
      }),
    ).then((pairs) => {
      if (cancelled) return;
      const m: Record<string, string> = {};
      pairs.forEach(([id, t]) => {
        m[id] = t;
      });
      setB2bTitles(m);
    });
    return () => {
      cancelled = true;
    };
  }, [b2bConversations, agencyOrgIdB2b]);

  useEffect(() => {
    if (!pendingOpenB2BChat?.conversationId) return;
    setMessagesSection('clientRequests');
    setActiveConnectionChatId(pendingOpenB2BChat.conversationId);
    setActiveConnectionChatTitle(pendingOpenB2BChat.title);
    onPendingB2BChatConsumed();
    refreshB2bList();
  }, [pendingOpenB2BChat?.conversationId, onPendingB2BChatConsumed, refreshB2bList, pendingOpenB2BChat?.title]);

  useEffect(() => {
    if (messagesSection !== 'clientRequests') {
      setActiveConnectionChatId(null);
    }
  }, [messagesSection]);

  useEffect(() => {
    if (!agencyId || !activeConnectionChatId) {
      setGuestLinksForChat([]);
      setModelsForShare([]);
      return;
    }
    void getGuestLinksForAgency(agencyId).then(setGuestLinksForChat);
    void getModelsForAgencyFromSupabase(agencyId).then((rows) =>
      setModelsForShare(rows.map((m) => ({ id: m.id, name: m.name }))),
    );
  }, [agencyId, activeConnectionChatId]);

  useEffect(() => {
    if (selectedThreadId) {
      refreshOptionRequestInCache(selectedThreadId);
      loadMessagesForThread(selectedThreadId);
    }
  }, [selectedThreadId]);

  const toggleArchive = (threadId: string) => {
    setArchivedIds((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId); else next.add(threadId);
      if (typeof window !== 'undefined') window.localStorage.setItem('ci_agency_archived', JSON.stringify([...next]));
      return next;
    });
  };

  const visible = requests.filter((r) =>
    msgFilter === 'archived' ? archivedIds.has(r.threadId) : !archivedIds.has(r.threadId)
  );

  const request = selectedThreadId ? getRequestByThreadId(selectedThreadId) : null;
  const messages = selectedThreadId ? getMessages(selectedThreadId) : [];
  const status = request ? getRequestStatus(request.threadId) ?? request.status : null;
  const finalStatus = request?.finalStatus;
  const clientPriceStatus = request?.clientPriceStatus;
  const agencyCounterPrice = request?.agencyCounterPrice;
  const currency = request?.currency ?? 'EUR';

  const sendMessage = () => {
    const text = chatInput.trim();
    if (!text || !selectedThreadId) return;
    addMessage(selectedThreadId, 'agency', text);
    setChatInput('');
  };

  return (
    <ScreenScrollView>
      <Text style={s.sectionLabel}>Messages</Text>
      <Text style={[s.metaText, { marginBottom: spacing.sm }]}>{uiCopy.b2bChat.messagesIntroAgency}</Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md }}>
        {(['clientRequests', 'recruiting', 'optionRequests'] as const).map((key) => (
          <TouchableOpacity
            key={key}
            style={[s.filterPill, messagesSection === key && s.filterPillActive]}
            onPress={() => setMessagesSection(key)}
          >
            <Text style={[s.filterPillLabel, messagesSection === key && s.filterPillLabelActive]}>
              {key === 'optionRequests'
                ? uiCopy.b2bChat.tabOptionRequests
                : key === 'recruiting'
                  ? uiCopy.b2bChat.tabRecruiting
                  : uiCopy.b2bChat.tabB2BChatsAgencyView}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {messagesSection === 'clientRequests' ? (
        <View style={{ marginBottom: spacing.lg }}>
          {!agencyId ? (
            <Text style={s.metaText}>{uiCopy.b2bChat.noAgencyContext}</Text>
          ) : (
            <>
              <Text style={[s.metaText, { marginBottom: spacing.sm, fontWeight: '600' }]}>
                {uiCopy.b2bChat.tabB2BChatsAgencyView}
              </Text>
              {b2bConversations.length === 0 ? (
                <Text style={s.metaText}>{uiCopy.b2bChat.noClientChatsYetAgency}</Text>
              ) : (
                b2bConversations.map((c) => (
                  <View
                    key={c.id}
                    style={[s.modelRow, { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }]}
                  >
                    <View style={{ flex: 1, minWidth: 160 }}>
                      <Text style={s.modelName}>{b2bTitles[c.id] ?? uiCopy.b2bChat.chatPartnerFallback}</Text>
                      <Text style={s.metaText}>{new Date(c.updated_at).toLocaleString()}</Text>
                    </View>
                    <TouchableOpacity
                      style={[s.filterPill, s.filterPillActive]}
                      onPress={() => {
                        setActiveConnectionChatId(c.id);
                        setActiveConnectionChatTitle(b2bTitles[c.id] ?? uiCopy.b2bChat.chatPartnerFallback);
                      }}
                    >
                      <Text style={[s.filterPillLabel, s.filterPillLabelActive]}>{uiCopy.b2bChat.openConversation}</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
              {activeConnectionChatId ? (
                <OrgMessengerInline
                  conversationId={activeConnectionChatId}
                  headerTitle={activeConnectionChatTitle}
                  viewerUserId={currentUserId}
                  agencyId={agencyId}
                  guestLinks={guestLinksForChat}
                  modelsForShare={modelsForShare}
                />
              ) : null}
            </>
          )}
        </View>
      ) : messagesSection === 'recruiting' ? (
        <View style={{ marginBottom: spacing.lg }}>
          <Text style={[s.metaText, { marginBottom: spacing.md }]}>
            When you start a chat or accept an application from Recruiting, the thread appears here (and leaves the pending swipe queue). Same candidates are listed under Recruiting → My list until accepted.
          </Text>
          {recruitingThreads.length === 0 ? (
            <Text style={s.metaText}>No recruiting chats yet. Start a chat from Recruiting or accept an application.</Text>
          ) : (
            recruitingThreads.map((thread) => {
              const application = getApplicationById(thread.applicationId);
              const thumbUri = application?.images?.closeUp || application?.images?.profile || application?.images?.fullBody;
              return (
                <TouchableOpacity
                  key={thread.id}
                  style={s.bookingChatRow}
                  onPress={() => onOpenRecruitingThread(thread.id)}
                >
                  <View style={s.bookingChatThumbWrap}>
                    {thumbUri ? (
                      <Image source={{ uri: thumbUri }} style={s.bookingChatThumb} resizeMode="contain" />
                    ) : (
                      <View style={[s.bookingChatThumb, s.bookingChatThumbPlaceholder]}>
                        <Text style={s.bookingChatThumbPlaceholderText} numberOfLines={1}>{thread.modelName}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[s.modelName, { flex: 1, marginLeft: spacing.sm }]} numberOfLines={1}>{thread.modelName}</Text>
                  <Text style={s.backLabel}>Chat</Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      ) : messagesSection === 'optionRequests' ? (
        <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
        <Text style={[s.sectionLabel, { fontSize: 14 }]}>Option request threads</Text>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {(['current', 'archived'] as const).map((f) => (
            <TouchableOpacity key={f} style={[s.filterPill, msgFilter === f && s.filterPillActive]} onPress={() => setMsgFilter(f)}>
              <Text style={[s.filterPillLabel, msgFilter === f && s.filterPillLabelActive]}>{f === 'current' ? 'Current' : 'Archived'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView style={{ flex: 1, maxHeight: 300 }}>
        {visible.length === 0 ? (
          <Text style={s.metaText}>No messages.</Text>
        ) : (
          visible.map((r) => {
            const reqStatus = getRequestStatus(r.threadId) ?? r.status;
            return (
              <TouchableOpacity key={r.threadId} style={[s.threadRow, selectedThreadId === r.threadId && s.threadRowActive]} onPress={() => setSelectedThreadId(r.threadId)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.modelName}>{r.modelName} · {r.date}</Text>
                  <Text style={s.metaText}>{r.clientName}{r.startTime ? ` · ${r.startTime}–${r.endTime}` : ''}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  {r.proposedPrice != null && (
                    <Text style={{ ...typography.label, fontSize: 9, color: colors.accentBrown }}>€{r.proposedPrice}</Text>
                  )}
                  <View style={[
                    s.approvalBadge,
                    r.modelAccountLinked === false && { backgroundColor: 'rgba(120,120,120,0.2)' },
                    r.modelAccountLinked !== false && r.modelApproval === 'approved' && s.approvalBadgeApproved,
                    r.modelAccountLinked !== false && r.modelApproval === 'rejected' && s.approvalBadgeRejected,
                    r.modelAccountLinked !== false && r.modelApproval === 'pending' && s.approvalBadgePending,
                  ]}>
                    <Text style={[
                      s.approvalBadgeLabel,
                      r.modelAccountLinked === false && { color: colors.textSecondary },
                      r.modelAccountLinked !== false && r.modelApproval === 'approved' && s.approvalBadgeLabelApproved,
                      r.modelAccountLinked !== false && r.modelApproval === 'rejected' && s.approvalBadgeLabelRejected,
                      r.modelAccountLinked !== false && r.modelApproval === 'pending' && s.approvalBadgeLabelPending,
                    ]}>
                      {r.modelAccountLinked === false ? 'No model app' : r.modelApproval === 'approved' ? 'Model ✓' : r.modelApproval === 'rejected' ? 'Model ✗' : 'Model ⏳'}
                    </Text>
                  </View>
                  <View style={[s.statusPill, { backgroundColor: STATUS_COLORS[reqStatus] }]}>
                    <Text style={s.statusPillLabel}>{STATUS_LABELS[reqStatus]}</Text>
                  </View>
                  <TouchableOpacity onPress={() => toggleArchive(r.threadId)}>
                    <Text style={{ fontSize: 12, color: colors.textSecondary }}>{archivedIds.has(r.threadId) ? '↩' : '📦'}</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {request && (
        <View style={s.chatPanel}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <Text style={s.chatTitle}>{request.clientName} · {request.modelName}</Text>
            <TouchableOpacity
              style={[s.statusPill, status && { backgroundColor: STATUS_COLORS[status] }]}
              onPress={() => setStatusDropdownOpen((o) => !o)}
            >
              <Text style={s.statusPillLabel}>{status ? STATUS_LABELS[status] : '—'}</Text>
            </TouchableOpacity>
          </View>
          {statusDropdownOpen && (
            <View style={{ flexDirection: 'row', gap: 4, marginBottom: spacing.sm }}>
              {(['in_negotiation', 'confirmed', 'rejected'] as ChatStatus[]).map((st) => (
                <TouchableOpacity key={st} style={[s.filterPill, { borderColor: STATUS_COLORS[st] }]}
                  onPress={() => { setRequestStatus(request.threadId, st); setStatusDropdownOpen(false); }}>
                  <Text style={[s.filterPillLabel, { color: STATUS_COLORS[st] }]}>{STATUS_LABELS[st]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {request.modelAccountLinked === false ? (
            <View style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, marginBottom: spacing.sm, backgroundColor: 'rgba(100,100,100,0.12)', borderRadius: 8 }}>
              <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary }}>
                No model app account — negotiate with the client only. When you confirm the option or casting, it is booked and syncs to client & agency calendars (no in-app model step).
              </Text>
            </View>
          ) : (
            <View style={[
              s.approvalBanner,
              request.modelApproval === 'approved' && s.approvalBannerApproved,
              request.modelApproval === 'rejected' && s.approvalBannerRejected,
              request.modelApproval === 'pending' && s.approvalBannerPending,
            ]}>
              <Text style={[
                s.approvalBannerText,
                request.modelApproval === 'approved' && s.approvalBannerTextApproved,
                request.modelApproval === 'rejected' && s.approvalBannerTextRejected,
                request.modelApproval === 'pending' && s.approvalBannerTextPending,
              ]}>
                {request.modelApproval === 'approved' ? 'Approved by Model ✓' : request.modelApproval === 'rejected' ? 'Rejected by Model ✗' : 'Pending Model Approval ⏳'}
              </Text>
            </View>
          )}
          {request.proposedPrice != null && (
            <Text style={{ ...typography.label, fontSize: 10, color: colors.accentBrown, marginBottom: spacing.xs }}>
              Client proposed: {currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency === 'CHF' ? 'CHF ' : '€'}{request.proposedPrice}
            </Text>
          )}
          {finalStatus && (
            <View style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, marginBottom: spacing.sm, backgroundColor: finalStatus === 'job_confirmed' ? 'rgba(0,120,0,0.15)' : finalStatus === 'option_confirmed' ? 'rgba(0,80,200,0.12)' : 'rgba(120,120,0,0.12)', borderRadius: 8 }}>
              <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary }}>
                {request.requestType === 'casting' ? 'Casting' : 'Option'} – {finalStatus === 'job_confirmed' ? 'Job confirmed' : finalStatus === 'option_confirmed' ? 'Confirmed' : 'Pending'}
              </Text>
            </View>
          )}
          {request.modelApproval === 'approved' && clientPriceStatus === 'pending' && finalStatus !== 'job_confirmed' && request.proposedPrice != null && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm }}>
              <TouchableOpacity
                style={[s.filterPill, { backgroundColor: colors.buttonOptionGreen }]}
                onPress={async () => {
                  if (request?.threadId) {
                    await agencyAcceptClientPriceStore(request.threadId);
                    setRequests(getOptionRequests());
                  }
                }}
              >
                <Text style={[s.filterPillLabel, { color: '#fff' }]}>Accept client price</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.filterPill, { borderWidth: 1, borderColor: colors.buttonSkipRed }]}
                onPress={async () => {
                  if (request?.threadId) {
                    await agencyRejectClientPriceStore(request.threadId);
                    setRequests(getOptionRequests());
                  }
                }}
              >
                <Text style={[s.filterPillLabel, { color: colors.buttonSkipRed }]}>Reject client price</Text>
              </TouchableOpacity>
            </View>
          )}
          {request.modelApproval === 'approved' && clientPriceStatus === 'rejected' && finalStatus !== 'job_confirmed' && (
            <View style={{ marginBottom: spacing.sm, padding: spacing.sm, backgroundColor: 'rgba(180,100,0,0.08)', borderRadius: 8 }}>
              <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary, marginBottom: spacing.xs }}>
                Client price declined — enter a counter-offer
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <TextInput
                  value={agencyCounterInput}
                  onChangeText={setAgencyCounterInput}
                  placeholder="Counter (e.g. 3000)"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="numeric"
                  style={[s.chatInput, { flex: 1, minWidth: 120 }]}
                />
                <TouchableOpacity
                  style={[s.filterPill, { paddingHorizontal: spacing.sm, backgroundColor: colors.textPrimary }]}
                  onPress={async () => {
                    const num = parseFloat(agencyCounterInput.trim());
                    if (!request?.threadId || isNaN(num)) return;
                    await agencyCounterOfferStore(request.threadId, num, currency);
                    setAgencyCounterInput('');
                    setRequests(getOptionRequests());
                  }}
                >
                  <Text style={[s.filterPillLabel, { color: '#fff' }]}>Send counter-offer</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {request.modelApproval === 'approved' && clientPriceStatus === 'pending' && finalStatus !== 'job_confirmed' && request.proposedPrice == null && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm, alignItems: 'center' }}>
              <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary }}>Propose a fee (optional)</Text>
              <TextInput
                value={agencyCounterInput}
                onChangeText={setAgencyCounterInput}
                placeholder="Amount"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                style={[s.chatInput, { width: 100 }]}
              />
              <TouchableOpacity
                style={[s.filterPill, { paddingHorizontal: spacing.sm }]}
                onPress={async () => {
                  const num = parseFloat(agencyCounterInput.trim());
                  if (!request?.threadId || isNaN(num)) return;
                  await agencyCounterOfferStore(request.threadId, num, currency);
                  setAgencyCounterInput('');
                  setRequests(getOptionRequests());
                }}
              >
                <Text style={s.filterPillLabel}>Send offer</Text>
              </TouchableOpacity>
            </View>
          )}
          <ScrollView style={{ maxHeight: 180, marginBottom: spacing.sm }}>
            {messages.map((msg) => (
              <View key={msg.id} style={[s.chatBubble, msg.from === 'agency' ? s.chatBubbleAgency : s.chatBubbleClient]}>
                <Text style={[s.chatBubbleText, msg.from === 'agency' && s.chatBubbleTextAgency]}>{msg.text}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TextInput value={chatInput} onChangeText={setChatInput} placeholder="Message..." placeholderTextColor={colors.textSecondary} style={s.chatInput} />
            <TouchableOpacity style={s.chatSend} onPress={sendMessage}>
              <Text style={s.chatSendLabel}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
        </>
      ) : null}
    </ScreenScrollView>
  );
};

const OrganizationTeamTab: React.FC<{
  organizationId: string | null;
  canInvite: boolean;
  members: Awaited<ReturnType<typeof listOrganizationMembers>>;
  invitations: InvitationRow[];
  onRefresh: () => void;
}> = ({ organizationId, canInvite, members, invitations, onRefresh }) => {
  const [inviteEmail, setInviteEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastLink, setLastLink] = useState<string | null>(null);

  const handleInvite = async () => {
    if (!organizationId || !inviteEmail.trim()) return;
    setBusy(true);
    const row = await createOrganizationInvitation({
      organizationId,
      email: inviteEmail.trim(),
      role: 'booker',
    });
    setBusy(false);
    if (row) {
      setInviteEmail('');
      setLastLink(buildOrganizationInviteUrl(row.token));
      onRefresh();
      Alert.alert(uiCopy.alerts.invitationCreated, uiCopy.alerts.invitationCreatedBody);
    } else {
      Alert.alert(uiCopy.common.error, uiCopy.alerts.invitationFailed);
    }
  };

  const roleLabel = (r: string) =>
    r === 'owner'
      ? uiCopy.team.roleOwner
      : r === 'booker'
        ? uiCopy.team.roleBooker
        : r === 'employee'
          ? uiCopy.team.roleEmployee
          : r;

  return (
    <ScreenScrollView>
      <Text style={s.sectionLabel}>{uiCopy.team.section}</Text>
      <Text style={s.metaText}>
        {uiCopy.team.leadAgency}
      </Text>
      <Text style={[s.metaText, { marginTop: spacing.sm }]}>
        {uiCopy.team.ownerRoleExplainerAgency}
      </Text>
      {!organizationId && (
        <Text style={[s.metaText, { marginTop: spacing.md }]}>
          {uiCopy.team.noOrganizationYet}
        </Text>
      )}
      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        <Text style={s.sectionLabel}>{uiCopy.team.members}</Text>
        {members.length === 0 ? (
          <Text style={s.metaText}>No members loaded.</Text>
        ) : (
          members.map((m) => (
            <View key={m.id} style={s.modelRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.modelName}>
                  {m.display_name || m.email || m.user_id.slice(0, 8)} · {roleLabel(m.role)}
                </Text>
                <Text style={s.metaText}>{m.email ?? '—'}</Text>
              </View>
            </View>
          ))
        )}
      </View>
      <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
        <Text style={s.sectionLabel}>{uiCopy.team.pendingInvitations}</Text>
        {invitations.filter((i) => i.status === 'pending').length === 0 ? (
          <Text style={s.metaText}>{uiCopy.team.noOpenInvitations}</Text>
        ) : (
          invitations
            .filter((i) => i.status === 'pending')
            .map((i) => (
              <View key={i.id} style={s.modelRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.modelName}>{i.email}</Text>
                  <Text style={s.metaText}>
                    {roleLabel(i.role)} · bis {new Date(i.expires_at).toLocaleDateString()}
                  </Text>
                </View>
              </View>
            ))
        )}
      </View>
      {canInvite && organizationId && (
        <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
          <Text style={s.sectionLabel}>{uiCopy.team.inviteBooker}</Text>
          <TextInput
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder="Email"
            placeholderTextColor={colors.textSecondary}
            style={s.editInput}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TouchableOpacity style={s.saveBtn} onPress={handleInvite} disabled={busy || !inviteEmail.trim()}>
            <Text style={s.saveBtnLabel}>{busy ? '…' : uiCopy.team.inviteSendLink}</Text>
          </TouchableOpacity>
          {lastLink && (
            <TouchableOpacity
              onPress={() => {
                Alert.alert(uiCopy.alerts.invitationLink, lastLink);
              }}
            >
              <Text style={[s.metaText, { textDecorationLine: 'underline' }]}>{uiCopy.alerts.showLastLink}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </ScreenScrollView>
  );
};

const GuestLinksTab: React.FC<{
  agencyId: string;
  agencyEmail: string;
  agencyName: string;
  models: SupabaseModel[];
}> = ({ agencyId, agencyEmail, agencyName, models }) => {
  const [links, setLinks] = useState<GuestLink[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (agencyId) getGuestLinksForAgency(agencyId).then(setLinks);
  }, [agencyId]);

  const toggleModel = (id: string) => {
    setSelectedModelIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const handleGenerate = async () => {
    if (selectedModelIds.size === 0) return;
    const link = await createGuestLink({
      agency_id: agencyId,
      model_ids: Array.from(selectedModelIds),
      agency_email: agencyEmail,
      agency_name: agencyName,
    });
    if (link) {
      setLinks((prev) => [link, ...prev]);
      setGeneratedUrl(buildGuestUrl(link.id));
      setSelectedModelIds(new Set());
    }
  };

  const handleCopy = () => {
    if (generatedUrl && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDeactivate = async (id: string) => {
    const ok = await deactivateGuestLink(id);
    if (ok) setLinks((prev) => prev.map((l) => l.id === id ? { ...l, is_active: false } : l));
  };

  return (
    <ScreenScrollView contentStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
      <Text style={s.sectionLabel}>Create Guest Link</Text>
      <Text style={{ ...typography.body, color: colors.textSecondary, fontSize: 12, marginBottom: spacing.md }}>
        Select models to share with a guest. The guest can view them and contact you via email.
      </Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md }}>
        {models.map((m) => (
          <TouchableOpacity
            key={m.id}
            style={[s.filterPill, selectedModelIds.has(m.id) && s.filterPillActive]}
            onPress={() => toggleModel(m.id)}
          >
            <Text style={[s.filterPillLabel, selectedModelIds.has(m.id) && s.filterPillLabelActive]}>{m.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[s.saveBtn, selectedModelIds.size === 0 && { opacity: 0.4 }]}
        onPress={handleGenerate}
        disabled={selectedModelIds.size === 0}
      >
        <Text style={s.saveBtnLabel}>Generate Link</Text>
      </TouchableOpacity>

      {generatedUrl && (
        <View style={{ marginTop: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: 10 }}>
          <Text style={{ ...typography.body, fontSize: 12, color: colors.textPrimary, marginBottom: spacing.xs }} numberOfLines={2}>{generatedUrl}</Text>
          <TouchableOpacity onPress={handleCopy} style={[s.filterPill, s.filterPillActive, { alignSelf: 'flex-start' }]}>
            <Text style={[s.filterPillLabel, s.filterPillLabelActive]}>{copied ? 'Copied!' : 'Copy Link'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {links.length > 0 && (
        <>
          <Text style={[s.sectionLabel, { marginTop: spacing.xl }]}>Existing Links</Text>
          {links.map((l) => (
            <View key={l.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.label, fontSize: 12, color: colors.textPrimary }}>{l.model_ids.length} models · {l.is_active ? 'Active' : 'Inactive'}</Text>
                <Text style={{ ...typography.body, fontSize: 10, color: colors.textSecondary }}>{new Date(l.created_at).toLocaleDateString()}</Text>
              </View>
              {l.is_active && (
                <TouchableOpacity onPress={() => handleDeactivate(l.id)}>
                  <Text style={{ fontSize: 11, color: '#e74c3c' }}>Deactivate</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </>
      )}
    </ScreenScrollView>
  );
};

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.xs },
  backArrow: { fontSize: 22, color: colors.textPrimary },
  backLabel: { ...typography.label, fontSize: 11, color: colors.textSecondary },
  brand: { ...typography.heading, color: colors.textPrimary, marginBottom: spacing.md },
  heading: { ...typography.heading, fontSize: 18, color: colors.textPrimary, marginBottom: spacing.md },
  tabRow: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  bottomBar: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.sm, backgroundColor: colors.background },
  tabItem: { alignItems: 'center' },
  tabLabel: { ...typography.label, color: colors.textSecondary },
  tabLabelActive: { color: colors.accentGreen },
  tabUnderline: { marginTop: 4, height: 2, width: 24, backgroundColor: colors.accentGreen, borderRadius: 1 },
  sectionLabel: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.xs },
  metaText: { ...typography.body, fontSize: 12, color: colors.textSecondary },
  modelName: { ...typography.body, color: colors.textPrimary },
  tractionRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modelRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
    borderWidth: 1, borderColor: colors.border, borderRadius: 12, marginBottom: spacing.xs,
  },
  bookingChatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    marginBottom: spacing.xs,
  },
  bookingChatThumbWrap: {
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  bookingChatThumb: {
    width: '100%',
    height: '100%',
  },
  bookingChatThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookingChatThumbPlaceholderText: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  visTag: {
    borderRadius: 4, borderWidth: 1, borderColor: colors.accentGreen,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  visTagLabel: { ...typography.label, fontSize: 9, color: colors.accentGreen },
  editInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    ...typography.body, color: colors.textPrimary,
  },
  visPill: {
    borderRadius: 999, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
  },
  visPillActive: { borderColor: colors.accentGreen, backgroundColor: colors.accentGreen },
  visPillLabel: { ...typography.label, fontSize: 10, color: colors.textSecondary },
  visPillLabelActive: { color: colors.surface },
  saveBtn: {
    borderRadius: 999, backgroundColor: colors.accentGreen,
    paddingVertical: spacing.sm, alignItems: 'center',
  },
  saveBtnLabel: { ...typography.label, color: colors.surface },
  filterPill: {
    borderRadius: 999, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
  },
  filterPillActive: { borderColor: colors.textPrimary, backgroundColor: colors.textPrimary },
  filterPillLabel: { ...typography.label, fontSize: 10, color: colors.textSecondary },
  filterPillLabelActive: { color: colors.surface },
  threadRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  threadRowActive: { backgroundColor: '#F3F0EC' },
  statusPill: { borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  statusPillLabel: { ...typography.label, fontSize: 10, color: colors.surface },
  chatPanel: {
    marginTop: spacing.md, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: spacing.md, backgroundColor: colors.surface,
  },
  chatTitle: { ...typography.label, color: colors.textPrimary },
  chatBubble: { alignSelf: 'flex-start', maxWidth: '85%', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: 12, marginBottom: spacing.xs, backgroundColor: '#F0EEEA' },
  chatBubbleAgency: { alignSelf: 'flex-end', backgroundColor: colors.buttonOptionGreen },
  chatBubbleClient: { backgroundColor: '#E2E0DB' },
  chatBubbleText: { ...typography.body, fontSize: 12, color: colors.textPrimary },
  chatBubbleTextAgency: { color: colors.surface },
  chatInput: {
    flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 999,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    ...typography.body, fontSize: 12, color: colors.textPrimary,
  },
  chatSend: { borderRadius: 999, backgroundColor: colors.buttonOptionGreen, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, justifyContent: 'center' },
  chatSendLabel: { ...typography.label, fontSize: 11, color: colors.surface },
  apiSection: {
    marginBottom: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  apiBtn: {
    borderRadius: 999, borderWidth: 1, borderColor: colors.accentGreen,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  apiBtnLabel: { ...typography.label, fontSize: 11, color: colors.accentGreen },
  apiConnectBtn: {
    borderRadius: 999, backgroundColor: colors.accentGreen,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  addFormContainer: {
    marginBottom: spacing.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    backgroundColor: colors.surface,
  },
  approvalBadge: {
    borderRadius: 999, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2,
    borderColor: colors.border,
  },
  approvalBadgeApproved: { borderColor: colors.buttonOptionGreen, backgroundColor: 'rgba(76,175,80,0.1)' },
  approvalBadgeRejected: { borderColor: '#e74c3c', backgroundColor: 'rgba(231,76,60,0.1)' },
  approvalBadgePending: { borderColor: '#B8860B', backgroundColor: 'rgba(184,134,11,0.1)' },
  approvalBadgeLabel: { ...typography.label, fontSize: 9, color: colors.textSecondary },
  approvalBadgeLabelApproved: { color: colors.buttonOptionGreen },
  approvalBadgeLabelRejected: { color: '#e74c3c' },
  approvalBadgeLabelPending: { color: '#B8860B' },
  approvalBanner: {
    borderRadius: 8, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  approvalBannerApproved: { borderColor: colors.buttonOptionGreen, backgroundColor: 'rgba(76,175,80,0.08)' },
  approvalBannerRejected: { borderColor: '#e74c3c', backgroundColor: 'rgba(231,76,60,0.08)' },
  approvalBannerPending: { borderColor: '#B8860B', backgroundColor: 'rgba(184,134,11,0.08)' },
  approvalBannerText: { ...typography.label, fontSize: 11, color: colors.textSecondary },
  approvalBannerTextApproved: { color: colors.buttonOptionGreen },
  approvalBannerTextRejected: { color: '#e74c3c' },
  approvalBannerTextPending: { color: '#B8860B' },
});

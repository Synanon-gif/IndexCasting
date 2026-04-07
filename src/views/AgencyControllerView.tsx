/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StorageImage } from '../components/StorageImage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { handleTabPress, BOTTOM_TAB_BAR_HEIGHT } from '../navigation/bottomTabNavigation';
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
  ActivityIndicator,
} from 'react-native';
import countries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';
import { colors, spacing, typography } from '../theme/theme';
import { showAppAlert } from '../utils/crossPlatformAlert';
import { useAuth } from '../context/AuthContext';
import { getAgencyModels } from '../services/apiService';
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
  type ChatStatus,
} from '../store/optionRequests';
import { AgencyRecruitingView } from './AgencyRecruitingView';
import {
  getModelsForAgencyFromSupabase,
  getModelByIdFromSupabase,
  removeModelFromAgency,
  agencyLinkModelToUser,
  generateModelClaimToken,
  type SupabaseModel,
} from '../services/modelsSupabase';
import { BookingChatView } from './BookingChatView';
import { getRecruitingThreadsForAgency, type RecruitingThread } from '../store/recruitingChats';
import {
  ensureClientAgencyChat,
  listB2BConversationsForOrganization,
  getB2BConversationTitleForViewer,
  ensureAgencyModelDirectChat,
  listAgencyModelDirectConversations,
} from '../services/b2bOrgChatSupabase';
import type { Conversation } from '../services/messengerSupabase';
import { sendMessage } from '../services/messengerSupabase';
import { getApplicationById } from '../store/applicationsStore';
import { OrgMessengerInline } from '../components/OrgMessengerInline';
import { AgencySettingsTab } from '../components/AgencySettingsTab';
// Recruiting chats (BookingChatView) live under Messages → Recruiting chats.
import { uploadModelPhoto, upsertPhotosForModel, syncPortfolioToModel, syncPolaroidsToModel } from '../services/modelPhotosSupabase';
import { confirmImageRights, guardImageUpload } from '../services/gdprComplianceSupabase';
import { ModelMediaSettingsPanel } from '../components/ModelMediaSettingsPanel';
import { getTerritoriesForModel, getTerritoriesForAgency, upsertTerritoriesForModel, bulkAddTerritoriesForModels } from '../services/territoriesSupabase';
import {
  bulkUpsertModelLocations,
  upsertModelLocation,
  getModelLocation,
  locationSourceLabel,
  roundCoord,
  type ModelLocation,
} from '../services/modelLocationsSupabase';

/**
 * Forward-geocodes a city + ISO-2 country code via Nominatim.
 * Returns rounded lat/lng (±5 km precision, DSGVO-compliant), or null if not found.
 * Used to enable agency-managed models in Near Me radius queries.
 */
async function geocodeCityForAgency(
  city: string,
  countryCode: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)},${encodeURIComponent(countryCode)}&format=json&limit=1`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'IndexCasting/1.0' } },
    );
    const results = await res.json() as Array<{ lat: string; lon: string }>;
    const first = results[0];
    if (!first) return null;
    return { lat: roundCoord(parseFloat(first.lat)), lng: roundCoord(parseFloat(first.lon)) };
  } catch (e) {
    console.warn('[geocodeCityForAgency] failed:', e);
    return null;
  }
}
import { FILTER_COUNTRIES as LOCATION_COUNTRIES } from '../utils/modelFilters';
import { supabase } from '../../lib/supabase';
import {
  ensureAgencyOrganization,
  getOrganizationIdForAgency,
  listOrganizationMembers,
  listInvitationsForOrganization,
  createOrganizationInvitation,
  buildOrganizationInviteUrl,
  dissolveOrganization,
  removeOrganizationMember,
  type InvitationRow,
} from '../services/organizationsInvitationsSupabase';
import {
  listClientOrganizationsForAgencyDirectory,
  type ClientOrganizationDirectoryRow,
} from '../services/clientOrganizationsDirectorySupabase';
import { getAgencies, type Agency } from '../services/agenciesSupabase';
import { createGuestLink, getGuestLinksForAgency, buildGuestUrl, revokeGuestAccess, deleteGuestLink, type GuestLink } from '../services/guestLinksSupabase';
import {
  getCalendarEntriesForAgency,
  getBookingEventsAsCalendarEntries,
  type CalendarEntry,
  type AgencyCalendarItem,
  updateBookingDetails,
  appendSharedBookingNote,
  type SharedBookingNote,
} from '../services/calendarSupabase';
import { updateOptionRequestSchedule } from '../services/optionRequestsSupabase';
import {
  getManualEventsForOwner,
  getManualEventsForOrg,
  insertManualEvent,
  updateManualEvent,
  deleteManualEvent,
  MANUAL_EVENT_COLORS,
  type UserCalendarEvent,
} from '../services/userCalendarEventsSupabase';
import { MonthCalendarView, type CalendarDayEvent } from '../components/MonthCalendarView';
import { ScreenScrollView } from '../components/ScreenScrollView';
import { uiCopy } from '../constants/uiCopy';
import { type ModelFilters, defaultModelFilters, filterModels } from '../utils/modelFilters';
import ModelFiltersPanel from '../components/ModelFiltersPanel';
import ModelEditDetailsPanel, { buildEditState, type ModelEditState } from '../components/ModelEditDetailsPanel';
import { importModelAndMerge } from '../services/modelCreationFacade';
import { runMediaslideCronSync } from '../services/mediaslideSyncService';
import { runNetwalkCronSync } from '../services/netwalkSyncService';
import { getAgencyApiKeys, saveAgencyApiConnection } from '../services/agencySettingsSupabase';
import { checkModelCompleteness, type CompletenessContext } from '../utils/modelCompleteness';
import { calendarEntryColor } from '../utils/calendarColors';
import { DashboardSummaryBar } from '../components/DashboardSummaryBar';
import { OrgMetricsPanel } from '../components/OrgMetricsPanel';
import { GlobalSearchBar } from '../components/GlobalSearchBar';
import { getMyAgencyUsageLimits, type AgencyUsageLimits } from '../services/agencyUsageLimitsSupabase';
import { getLatestActivityLog, type ActivityLog } from '../services/activityLogsSupabase';
import { uiCopy as _uiCopy } from '../constants/uiCopy';

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
  const { signOut, profile, session, refreshProfile } = useAuth();
  const [tab, setTab] = useState<AgencyTab>('dashboard');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [dissolvingOrg, setDissolvingOrg] = useState(false);
  const [orgDissolved, setOrgDissolved] = useState(false);
  const [models, setModels] = useState<AgencyModel[]>([]);
  const [fullModels, setFullModels] = useState<SupabaseModel[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  // Initialise from profile.organization_id (canonical org membership from get_my_org_context).
  // loadAgencyTeam may update this further (e.g. via ensureAgencyOrganization for owners
  // whose org didn't exist yet), but profile.organization_id is the primary source of truth.
  const [agencyOrganizationId, setAgencyOrganizationId] = useState<string | null>(
    profile?.organization_id ?? null
  );
  const [teamMembers, setTeamMembers] = useState<
    Awaited<ReturnType<typeof listOrganizationMembers>>
  >([]);
  const [pendingInvites, setPendingInvites] = useState<InvitationRow[]>([]);
  const [calendarItems, setCalendarItems] = useState<AgencyCalendarItem[]>([]);
  const [manualCalendarEvents, setManualCalendarEvents] = useState<UserCalendarEvent[]>([]);
  const [bookingEventEntries, setBookingEventEntries] = useState<CalendarEntry[]>([]);
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
  const [deletingManualEvent, setDeletingManualEvent] = useState(false);
  const [bookingChatThreads, setBookingChatThreads] = useState<RecruitingThread[]>([]);
  const [openBookingThreadId, setOpenBookingThreadId] = useState<string | null>(null);
  const [swipeLimits, setSwipeLimits] = useState<AgencyUsageLimits | null>(null);
  const [latestActivity, setLatestActivity] = useState<ActivityLog | null>(null);
  /** After starting a chat from Clients, open Messages with this thread. */
  const [pendingB2BChat, setPendingB2BChat] = useState<{ conversationId: string; title: string } | null>(null);
  /** Deep-link targets from GlobalSearch result clicks. */
  const [searchModelId, setSearchModelId] = useState<string | null>(null);
  const [searchOptionId, setSearchOptionId] = useState<string | null>(null);
  // Canonical source: org membership → organizations.agency_id (from get_my_org_context).
  // profile.agency_id ist der einzige gültige Lookup — kein Email-Match, kein agencies[0] Fallback.
  const currentAgency = useMemo(() => {
    if (!agencies.length) return null;
    if (profile?.agency_id) {
      const hit = agencies.find((a) => a.id === profile.agency_id);
      if (hit) return hit;
    }
    return null;
  }, [agencies, profile?.agency_id]);

  const currentAgencyId = currentAgency?.id ?? '';

  useEffect(() => {
    getAgencies().then(setAgencies);
  }, []);

  // Load swipe limits and activity log for the dashboard tab.
  useEffect(() => {
    if (tab !== 'dashboard') return;
    void getMyAgencyUsageLimits().then(setSwipeLimits);
    if (agencyOrganizationId) {
      void getLatestActivityLog(agencyOrganizationId).then(setLatestActivity);
    }
  }, [tab, agencyOrganizationId]);

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
    // 1. Canonical source: profile.organization_id (from get_my_org_context at login).
    let oid: string | null = profile?.organization_id ?? null;
    if (!oid) {
      // 2. DB-Lookup via agency_id (für Booker nach Invite oder falls Bootstrap noch aussteht).
      oid = await getOrganizationIdForAgency(currentAgencyId);
    }
    setAgencyOrganizationId(oid);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const [items, orgEvents, ownerEvents, beEntries] = await Promise.all([
        getCalendarEntriesForAgency(currentAgencyId),
        // Org-wide events: visible to all bookers in the same agency org.
        agencyOrganizationId
          ? getManualEventsForOrg(agencyOrganizationId, 'agency')
          : Promise.resolve([]),
        // Owner-only fallback: events without an organization_id (pre-org migration).
        getManualEventsForOwner(currentAgencyId, 'agency'),
        // booking_events.agency_org_id is organizations.id, not agencies.id.
        agencyOrganizationId
          ? getBookingEventsAsCalendarEntries(agencyOrganizationId, 'agency')
          : Promise.resolve([]),
      ]);
      // Merge org-wide + personal events, deduplicating by id.
      const seen = new Set<string>();
      const manual: UserCalendarEvent[] = [];
      for (const ev of [...orgEvents, ...ownerEvents]) {
        if (!seen.has(ev.id)) { seen.add(ev.id); manual.push(ev); }
      }
      manual.sort((a, b) => a.date.localeCompare(b.date) || (a.start_time ?? '').localeCompare(b.start_time ?? ''));
      setCalendarItems(items);
      setManualCalendarEvents(manual);
      setBookingEventEntries(beEntries);
    } finally {
      setCalendarLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'calendar' && currentAgencyId) {
      loadAgencyCalendar();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedManualEvent?.id]);

  /** Recruiting threads for Messages → Recruiting chats (Supabase).
   *  All agency members (owner + booker) see all threads for their agency. */
  const refreshBookingThreads = useCallback(() => {
    if (!currentAgencyId) return;
    getRecruitingThreadsForAgency(currentAgencyId, {}).then(setBookingChatThreads);
  }, [currentAgencyId]);

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
        { key: 'guestLinks', label: uiCopy.guestLinks.tabTitle },
        { key: 'settings', label: uiCopy.agencySettings.tabLabel },
      ];
      return all;
    },
    [],
  );

  const openAgencyBookingChat = (threadId: string) => {
    refreshBookingThreads();
    setOpenBookingThreadId(threadId);
  };

  const clearPendingB2BChat = useCallback(() => setPendingB2BChat(null), []);

  const insets = useSafeAreaInsets();
  const bottomTabInset = BOTTOM_TAB_BAR_HEIGHT + insets.bottom;

  const resetAgencyTabRoot = useCallback(() => {
    switch (tab) {
      case 'messages':
        setOpenBookingThreadId(null);
        setPendingB2BChat(null);
        break;
      case 'calendar':
        setSelectedCalendarItem(null);
        setSelectedManualEvent(null);
        setShowAddManualEvent(false);
        setAgencyNotesDraft('');
        setAgencySharedNoteDraft('');
        break;
      default:
        break;
    }
  }, [tab]);

  const handleAgencyTabPress = useCallback(
    (key: AgencyTab) => {
      handleTabPress({
        current: tab,
        next: key,
        setTab,
        onReselectRoot: resetAgencyTabRoot,
      });
    },
    [tab, resetAgencyTabRoot],
  );

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

      <View style={{ flex: 1, paddingBottom: bottomTabInset }}>
      {tab === 'dashboard' && (
        <View style={{ flex: 1 }}>
          {agencyOrganizationId && (
            <View style={{ paddingHorizontal: spacing.sm, paddingTop: spacing.xs, paddingBottom: spacing.xs, zIndex: 200 }}>
              <GlobalSearchBar
                orgId={agencyOrganizationId}
                onSelectModel={(id) => { setSearchModelId(id); setTab('myModels'); }}
                onSelectConversation={(id) => { setPendingB2BChat({ conversationId: id, title: '' }); setTab('messages'); }}
                onSelectOption={(id) => { setSearchOptionId(id); setTab('messages'); }}
              />
            </View>
          )}
          {agencyOrganizationId && session?.user?.id && (
            <DashboardSummaryBar
              orgId={agencyOrganizationId}
              userId={session.user.id}
              onPressRequests={() => setTab('messages')}
              onPressMessages={() => setTab('messages')}
              onPressCalendar={() => setTab('calendar')}
            />
          )}
          {swipeLimits && (
            <SwipeLimitBanner
              used={swipeLimits.swipes_used_today}
              limit={swipeLimits.daily_swipe_limit}
            />
          )}
          <DashboardTab models={models} />
          {latestActivity && (
            <ActivityLogFooter log={latestActivity} />
          )}
        </View>
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
          agencyName={currentAgency?.name ?? null}
          inviteOrganizationId={agencyOrganizationId ?? profile?.organization_id ?? null}
          onRefresh={() => getModelsForAgencyFromSupabase(currentAgencyId).then(setFullModels)}
          focusModelId={searchModelId}
          onFocusConsumed={() => setSearchModelId(null)}
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
          agencyName={currentAgency?.name ?? null}
          agencyOrganizationId={agencyOrganizationId}
          agencyModels={fullModels}
          currentUserId={session?.user?.id ?? null}
          pendingOpenB2BChat={pendingB2BChat}
          onPendingB2BChatConsumed={clearPendingB2BChat}
          onBookingCardPress={() => setTab('calendar')}
          pendingOptionRequestId={searchOptionId}
          onPendingOptionRequestConsumed={() => setSearchOptionId(null)}
        />
      )}

      {tab === 'calendar' && (
        <AgencyCalendarTab
          items={calendarItems}
          manualEvents={manualCalendarEvents}
          bookingEventEntries={bookingEventEntries}
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
          onOpenBookingEntry={(be) => Alert.alert(
            be.title ?? uiCopy.calendar.bookingEvent,
            `${uiCopy.calendar.date}: ${be.date}\n${uiCopy.calendar.status}: ${be.status ?? '—'}`,
          )}
          onAddEvent={() => setShowAddManualEvent(true)}
        />
      )}

        {tab === 'bookers' && (
          <OrganizationTeamTab
            organizationId={agencyOrganizationId}
            canInvite={profile?.org_member_role === 'owner'}
            members={teamMembers}
            invitations={pendingInvites}
            onRefresh={() => void loadAgencyTeam()}
            currentUserId={session?.user?.id ?? null}
            orgName={currentAgency?.name ?? null}
          />
        )}

        {tab === 'guestLinks' && (
          <GuestLinksTab
            agencyId={currentAgencyId}
            agencyEmail={currentAgency?.email ?? ''}
            agencyName={currentAgency?.name ?? ''}
            models={fullModels}
            viewerUserId={session?.user?.id ?? null}
          />
        )}

      {tab === 'settings' && profile?.org_member_role === 'owner' && (
        <ScreenScrollView>
          {agencyOrganizationId && (
            <OrgMetricsPanel
              orgId={agencyOrganizationId}
              userRole={profile?.org_member_role ?? 'owner'}
            />
          )}
          <AgencySettingsTab
            variant="embedded"
            agency={currentAgency}
            organizationId={agencyOrganizationId}
            onSaved={() => {
              void getAgencies().then(setAgencies);
            }}
          />
            <View style={{ marginTop: spacing.md, marginBottom: spacing.lg }}>
              {/* Dissolve organization — owners only */}
              {agencyOrganizationId && !orgDissolved && (
                <View style={{ marginBottom: spacing.lg, paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={s.sectionLabel}>{uiCopy.accountDeletion.dissolveOrgTitle}</Text>
                  <Text style={[s.metaText, { marginBottom: spacing.sm }]}>{uiCopy.accountDeletion.dissolveOrgDescription}</Text>
                  <TouchableOpacity
                    onPress={() => {
                      Alert.alert(
                        uiCopy.accountDeletion.dissolveOrgConfirmTitle,
                        uiCopy.accountDeletion.dissolveOrgConfirmMessage,
                        [
                          { text: uiCopy.common.cancel, style: 'cancel' },
                          {
                            text: uiCopy.accountDeletion.dissolveOrgButton,
                            style: 'destructive',
                            onPress: async () => {
                              setDissolvingOrg(true);
                              try {
                                const result = await dissolveOrganization(agencyOrganizationId);
                                if (result.ok) {
                                  setOrgDissolved(true);
                                  void refreshProfile();
                                  void getAgencies().then(setAgencies);
                                  Alert.alert(uiCopy.accountDeletion.dissolveOrgTitle, uiCopy.accountDeletion.dissolveOrgSuccess);
                                } else {
                                  Alert.alert(uiCopy.common.error, uiCopy.accountDeletion.dissolveOrgFailed);
                                }
                              } catch (e) {
                                console.error('dissolveOrganization error:', e);
                                Alert.alert(uiCopy.common.error, uiCopy.accountDeletion.dissolveOrgFailed);
                              } finally {
                                setDissolvingOrg(false);
                              }
                            },
                          },
                        ]
                      );
                    }}
                    disabled={dissolvingOrg}
                    style={{ borderRadius: 999, borderWidth: 1, borderColor: '#e74c3c', paddingVertical: spacing.sm, alignItems: 'center', opacity: dissolvingOrg ? 0.6 : 1 }}
                  >
                    <Text style={{ ...typography.label, fontSize: 12, color: '#e74c3c' }}>
                      {dissolvingOrg ? uiCopy.accountDeletion.dissolveOrgWorking : uiCopy.accountDeletion.dissolveOrgButton}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
              {orgDissolved && (
                <View style={{ marginBottom: spacing.md, padding: spacing.sm, backgroundColor: 'rgba(0,120,0,0.08)', borderRadius: 8 }}>
                  <Text style={{ ...typography.label, fontSize: 12, color: colors.textPrimary }}>{uiCopy.accountDeletion.dissolveOrgSuccess}</Text>
                </View>
              )}
              {/* Delete personal account */}
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
                          try {
                            const { requestAccountDeletion } = await import('../services/accountSupabase');
                            const res = await requestAccountDeletion();
                            if (res.ok) {
                              await signOut();
                              return;
                            }
                            if (res.reason === 'not_owner') {
                              Alert.alert(uiCopy.common.error, uiCopy.accountDeletion.ownerOnly);
                            } else {
                              Alert.alert(uiCopy.common.error, uiCopy.accountDeletion.failed);
                            }
                          } catch (e) {
                            console.error('requestAccountDeletion error:', e);
                            Alert.alert(uiCopy.common.error, uiCopy.accountDeletion.failed);
                          } finally {
                            setDeletingAccount(false);
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
      )}

      {tab === 'settings' && profile?.org_member_role !== 'owner' && (
        <ScreenScrollView>
          <View style={{ marginTop: spacing.md, marginBottom: spacing.lg }}>
            <Text style={s.sectionLabel}>{uiCopy.accountDeletion.sectionTitle}</Text>
            <Text style={[s.metaText, { marginBottom: spacing.sm }]}>{uiCopy.accountDeletion.personalDeleteDescription}</Text>
            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  uiCopy.accountDeletion.personalDeleteConfirmTitle,
                  uiCopy.accountDeletion.personalDeleteConfirmMessage,
                  [
                    { text: uiCopy.common.cancel, style: 'cancel' },
                    {
                      text: uiCopy.accountDeletion.button,
                      style: 'destructive',
                      onPress: async () => {
                        setDeletingAccount(true);
                        try {
                          const { requestPersonalAccountDeletion } = await import('../services/accountSupabase');
                          const res = await requestPersonalAccountDeletion();
                          if (res.ok) {
                            await signOut();
                            return;
                          }
                          Alert.alert(uiCopy.common.error, uiCopy.accountDeletion.failed);
                        } catch (e) {
                          console.error('requestPersonalAccountDeletion error:', e);
                          Alert.alert(uiCopy.common.error, uiCopy.accountDeletion.failed);
                        } finally {
                          setDeletingAccount(false);
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
      )}
      </View>

      {openBookingThreadId != null && (
        <BookingChatView
          threadId={openBookingThreadId}
          fromRole="agency"
          onClose={() => setOpenBookingThreadId(null)}
          presentation="insetAboveBottomNav"
          bottomInset={bottomTabInset}
        />
      )}

      <View style={[s.bottomBar, { paddingBottom: insets.bottom }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.tabRow}
        >
          {agencyBottomTabs.map((t) => (
            <TouchableOpacity key={t.key} onPress={() => handleAgencyTabPress(t.key)} style={s.tabItem}>
              <Text style={[s.tabLabel, tab === t.key && s.tabLabelActive]}>{t.label}</Text>
              {tab === t.key && <View style={s.tabUnderline} />}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {selectedCalendarItem && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: bottomTabInset,
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
                      } else {
                        showAppAlert(uiCopy.common.error, uiCopy.alerts.calendarNotSaved);
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
                  } catch (e) {
                    console.error('updateBookingDetails error:', e);
                    showAppAlert(uiCopy.common.error, uiCopy.alerts.calendarNotSaved);
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
                  try {
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
                  } catch (e) {
                    console.error('insertManualEvent error:', e);
                    Alert.alert(uiCopy.common.error, uiCopy.alerts.calendarNotSaved);
                  } finally {
                    setSavingManualEvent(false);
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
                style={[s.filterPill, { flex: 1, minWidth: 100, opacity: deletingManualEvent ? 0.5 : 1 }]}
                disabled={deletingManualEvent}
                onPress={() => {
                  if (!selectedManualEvent || deletingManualEvent) return;
                  Alert.alert(
                    uiCopy.common.confirm,
                    uiCopy.alerts.deleteEventConfirm,
                    [
                      { text: uiCopy.common.cancel, style: 'cancel' },
                      {
                        text: uiCopy.common.delete,
                        style: 'destructive',
                        onPress: async () => {
                          setDeletingManualEvent(true);
                          try {
                            if (await deleteManualEvent(selectedManualEvent.id)) {
                              await loadAgencyCalendar();
                              setSelectedManualEvent(null);
                            } else {
                              Alert.alert(uiCopy.common.error, uiCopy.alerts.calendarNotSaved);
                            }
                          } catch (e) {
                            console.error('deleteManualEvent error:', e);
                            Alert.alert(uiCopy.common.error, uiCopy.alerts.calendarNotSaved);
                          } finally {
                            setDeletingManualEvent(false);
                          }
                        },
                      },
                    ],
                  );
                }}
              >
                <Text style={[s.filterPillLabel, { color: colors.buttonSkipRed }]}>
                  {deletingManualEvent ? '…' : 'Delete'}
                </Text>
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

const SwipeLimitBanner: React.FC<{ used: number; limit: number }> = ({ used, limit }) => {
  const copy = _uiCopy.dashboard;
  const exceeded = used >= limit;
  return (
    <View style={[swipeBannerStyles.container, exceeded && swipeBannerStyles.exceeded]}>
      <Text style={[swipeBannerStyles.text, exceeded && swipeBannerStyles.textExceeded]}>
        {exceeded
          ? copy.swipeLimitReached
          : copy.swipesUsed.replace('{used}', String(used)).replace('{total}', String(limit))}
      </Text>
    </View>
  );
};

const swipeBannerStyles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: '#fef3c7',
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
  },
  exceeded: {
    backgroundColor: '#fee2e2',
    borderBottomColor: '#fecaca',
  },
  text: {
    fontSize: 12,
    color: '#92400e',
    textAlign: 'center',
  },
  textExceeded: {
    color: '#991b1b',
    fontWeight: '600',
  },
});

const ActivityLogFooter: React.FC<{ log: ActivityLog }> = ({ log }) => {
  const copy = _uiCopy.dashboard;
  const timeAgo = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const label = log.action_type.replace(/_/g, ' ');

  return (
    <View style={activityFooterStyles.container}>
      <Text style={activityFooterStyles.text}>
        {copy.lastActionPrefix} {label} {copy.lastActionBy} {log.actor_name} • {timeAgo(log.created_at)}
      </Text>
    </View>
  );
};

const activityFooterStyles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  text: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

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
  bookingEventEntries?: CalendarEntry[];
  loading: boolean;
  onRefresh: () => void;
  onOpenDetails: (item: AgencyCalendarItem) => void;
  onOpenManualEvent: (ev: UserCalendarEvent) => void;
  onOpenBookingEntry?: (entry: CalendarEntry) => void;
  onAddEvent: () => void;
};

const AgencyCalendarTab: React.FC<AgencyCalendarTabProps> = ({
  items,
  manualEvents,
  bookingEventEntries = [],
  loading,
  onRefresh,
  onOpenDetails,
  onOpenManualEvent,
  onOpenBookingEntry,
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
      const color = calendarEntryColor(entryType);
      map[date].push({
        id: item.option.id,
        color,
        title: item.option.model_name ?? 'Model',
        kind: entryType ?? 'option',
      });
    });
    // Merge booking_events as the single source of truth; skip entries already covered
    // by a calendar_entry sharing the same option_request_id to avoid duplicates.
    const coveredOptionIds = new Set(
      items.map((i) => i.calendar_entry?.option_request_id).filter(Boolean),
    );
    bookingEventEntries.forEach((be) => {
      if (be.option_request_id && coveredOptionIds.has(be.option_request_id)) return;
      const date = be.date;
      if (!date) return;
      if (!map[date]) map[date] = [];
      let color = '#1565C0';
      if (be.entry_type === 'booking') color = colors.buttonSkipRed;
      else if (be.entry_type === 'casting' || be.entry_type === 'gosee') color = colors.textSecondary;
      map[date].push({
        id: be.id,
        color,
        title: be.title ?? 'Booking',
        kind: be.entry_type ?? 'booking',
      });
    });
    return map;
  }, [items, manualEvents, bookingEventEntries]);

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

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const sorted = useMemo(
    () =>
      [...filtered]
        .filter((a) => {
          const date = a.calendar_entry?.date ?? a.option.requested_date;
          return date != null && date >= today;
        })
        .sort((a, b) =>
          (a.option.requested_date || '').localeCompare(
            b.option.requested_date || '',
          ),
        ),
    [filtered, today],
  );

  const sortedManual = useMemo(
    () =>
      [...manualEvents]
        .filter((ev) => (ev.date || '') >= today)
        .sort((a, b) => {
          const d = (a.date || '').localeCompare(b.date || '');
          if (d !== 0) return d;
          return (a.start_time || '').localeCompare(b.start_time || '');
        }),
    [manualEvents, today],
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
                  if (manual) { onOpenManualEvent(manual); return; }
                  const item = items.find((i) => (i.calendar_entry?.date ?? i.option.requested_date) === selectedDate && i.option.id === ev.id);
                  if (item) { onOpenDetails(item); return; }
                  const beEntry = bookingEventEntries.find((be) => be.id === ev.id);
                  if (beEntry && onOpenBookingEntry) onOpenBookingEntry(beEntry);
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
  agencyName?: string | null;
  /** Pass-through for send-invite (model_claim) — disambiguates multi-org bookers. */
  inviteOrganizationId?: string | null;
  onRefresh: () => void;
  focusModelId?: string | null;
  onFocusConsumed?: () => void;
}> = ({ models, agencyId, agencyName, inviteOrganizationId, onRefresh, focusModelId, onFocusConsumed }) => {
  const [selectedModel, setSelectedModel] = useState<SupabaseModel | null>(null);
  const [selectedModelLocation, setSelectedModelLocation] = useState<ModelLocation | null>(null);
  const [filters, setFilters] = useState<ModelFilters>(defaultModelFilters);
  const [editState, setEditState] = useState<ModelEditState>(buildEditState({ name: '' }));

  const [showAddForm, setShowAddForm] = useState(false);
  const [addModelEditState, setAddModelEditState] = useState<ModelEditState>(buildEditState({ name: '' }));
  const [addTerritories, setAddTerritories] = useState<string[]>([]);
  const [addTerritorySearch, setAddTerritorySearch] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addModelImageFiles, setAddModelImageFiles] = useState<File[]>([]);
  const [addModelPolaroidFiles, setAddModelPolaroidFiles] = useState<File[]>([]);
  const [addModelFeedback, setAddModelFeedback] = useState<string | null>(null);
  const [addModelImageRightsConfirmed, setAddModelImageRightsConfirmed] = useState(false);

  const [showMediaslideInput, setShowMediaslideInput] = useState(false);
  const [showNetwalkInput, setShowNetwalkInput] = useState(false);
  const [mediaslideKey, setMediaslideKey] = useState('');
  const [netwalkKey, setNetwalkKey] = useState('');
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);

  // Import from Link state
  const [importLinkUrl, setImportLinkUrl] = useState('');
  const [importLinkLoading, setImportLinkLoading] = useState(false);
  const [importLinkFeedback, setImportLinkFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  // Profile completeness state for the selected model
  const [completenessIssues, setCompletenessIssues] = useState<ReturnType<typeof checkModelCompleteness>>([]);
  const [saveFeedback, setSaveFeedback] = useState<'saving' | 'success' | 'error' | null>(null);

  /** Tracked by ModelMediaSettingsPanel callback — used for profile completeness check. */
  const [hasVisiblePortfolio, setHasVisiblePortfolio] = useState(false);

  const [territoryCountryCodes, setTerritoryCountryCodes] = useState<string[]>([]);
  const [territorySearch, setTerritorySearch] = useState('');
  const [territorySaving, setTerritorySaving] = useState(false);
  const [territorySaveFeedback, setTerritorySaveFeedback] = useState<'saved' | 'error' | null>(null);


  /** model_id → sorted country codes for territory badges in the roster list */
  const [rosterTerritoriesMap, setRosterTerritoriesMap] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (agencyId) {
      getTerritoriesForAgency(agencyId).then(setRosterTerritoriesMap);
    }
  }, [agencyId]);

  // Auto-select model when arriving from GlobalSearch deep-link.
  useEffect(() => {
    if (!focusModelId) return;
    const found = models.find((m) => m.id === focusModelId) ?? null;
    if (found) setSelectedModel(found);
    onFocusConsumed?.();
  }, [focusModelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load model's active location source when a model is opened in the edit panel.
  useEffect(() => {
    if (!selectedModel?.id) {
      setSelectedModelLocation(null);
      return;
    }
    let cancelled = false;
    void getModelLocation(selectedModel.id).then((loc) => {
      if (!cancelled) setSelectedModelLocation(loc);
    });
    return () => { cancelled = true; };
  }, [selectedModel?.id]);

  // Load API keys from DB (org-wide) on mount — kept in memory only, never in localStorage.
  useEffect(() => {
    if (!agencyId) return;
    getAgencyApiKeys(agencyId).then((keys) => {
      if (!keys) return;
      if (keys.mediaslide_api_key) setMediaslideKey(keys.mediaslide_api_key);
      if (keys.netwalk_api_key) setNetwalkKey(keys.netwalk_api_key);
    }).catch((e) => console.error('Failed to load agency API keys:', e));
  }, [agencyId]);

  useEffect(() => {
    if (selectedModel) {
      setEditState(buildEditState(selectedModel));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel?.id]);

  // Recalculate completeness whenever the selected model or its territories change.
  useEffect(() => {
    if (!selectedModel) {
      setCompletenessIssues([]);
      return;
    }
    const ctx: CompletenessContext = {
      hasTerritories: territoryCountryCodes.length > 0,
      hasVisiblePhoto: hasVisiblePortfolio,
    };
    setCompletenessIssues(checkModelCompleteness(selectedModel, ctx));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel?.id, territoryCountryCodes, hasVisiblePortfolio]);

  // Bulk selection state
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [showBulkTerritoryModal, setShowBulkTerritoryModal] = useState(false);
  const [bulkTerritorySearch, setBulkTerritorySearch] = useState('');
  const [bulkSelectedCountries, setBulkSelectedCountries] = useState<string[]>([]);
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [bulkFeedback, setBulkFeedback] = useState<string | null>(null);

  // Bulk location modal state
  const [showBulkLocationModal, setShowBulkLocationModal] = useState(false);
  const [bulkLocationCountry, setBulkLocationCountry] = useState('');
  const [bulkLocationCity, setBulkLocationCity] = useState('');
  const [bulkLocationCountrySearch, setBulkLocationCountrySearch] = useState('');
  const [bulkLocationCountryDropdownOpen, setBulkLocationCountryDropdownOpen] = useState(false);
  const [bulkLocationAssigning, setBulkLocationAssigning] = useState(false);

  const isoCountryList = useMemo(() => {
    const list = Object.entries(ISO_COUNTRY_NAMES)
      .map(([code, name]) => ({ code: code.toUpperCase(), name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, []);

  const bulkFilteredCountries = useMemo(() => {
    const q = bulkTerritorySearch.trim().toLowerCase();
    if (!q) return isoCountryList;
    return isoCountryList.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [isoCountryList, bulkTerritorySearch]);

  // Filtered country list for location modal (uses FILTER_COUNTRIES for consistent naming)
  const bulkLocationFilteredCountries = useMemo(() => {
    const q = bulkLocationCountrySearch.trim().toLowerCase();
    if (!q) return LOCATION_COUNTRIES;
    return LOCATION_COUNTRIES.filter(
      (c) => c.label.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [bulkLocationCountrySearch]);

  const selectedLocationCountryLabel = useMemo(
    () => LOCATION_COUNTRIES.find((c) => c.code === bulkLocationCountry)?.label ?? null,
    [bulkLocationCountry],
  );

  const handleBulkSetLocation = async () => {
    if (!bulkLocationCountry || selectedModelIds.size === 0) return;
    setBulkLocationAssigning(true);
    try {
      const cityTrim = bulkLocationCity.trim();
      // Forward-geocode city → coordinates so agency models appear in Near Me.
      // Geocoding runs only when a city is provided; without a city, coords stay null.
      const geocoded = cityTrim
        ? await geocodeCityForAgency(cityTrim, bulkLocationCountry)
        : null;

      const count = await bulkUpsertModelLocations(
        Array.from(selectedModelIds),
        {
          country_code: bulkLocationCountry,
          city: cityTrim || null,
          lat: geocoded?.lat,
          lng: geocoded?.lng,
        },
      );
      setShowBulkLocationModal(false);
      setSelectedModelIds(new Set());
      setBulkLocationCountry('');
      setBulkLocationCity('');
      setBulkLocationCountrySearch('');
      setBulkFeedback(
        geocoded
          ? uiCopy.locationModal.successBulk(count) + ' · Near Me enabled'
          : uiCopy.locationModal.successBulk(count),
      );
    } catch (err) {
      console.error('handleBulkSetLocation error:', err);
      setBulkFeedback(uiCopy.locationModal.error);
    } finally {
      setBulkLocationAssigning(false);
      setTimeout(() => setBulkFeedback(null), 4000);
    }
  };

  const handleBulkAssignTerritories = async () => {
    if (bulkSelectedCountries.length === 0 || selectedModelIds.size === 0) return;
    setBulkAssigning(true);
    const { succeededIds, failedIds } = await bulkAddTerritoriesForModels(
      Array.from(selectedModelIds),
      agencyId,
      bulkSelectedCountries,
    );
    setBulkAssigning(false);
    setShowBulkTerritoryModal(false);
    setSelectedModelIds(new Set());
    setBulkSelectedCountries([]);
    void getTerritoriesForAgency(agencyId).then(setRosterTerritoriesMap);
    if (failedIds.length === 0) {
      setBulkFeedback(uiCopy.territoryModal.bulkAssignSuccess);
    } else {
      setBulkFeedback(
        `${succeededIds.length} succeeded, ${failedIds.length} failed. ${uiCopy.territoryModal.bulkAssignFailed}`,
      );
    }
    setTimeout(() => setBulkFeedback(null), 3000);
  };

  /** Save territories independently — dedicated button in the territory section. */
  const handleSaveTerritoriesOnly = async () => {
    if (!selectedModel) return;
    if (territoryCountryCodes.length === 0) {
      showAppAlert(uiCopy.modelRoster.territoriesRequiredTitle, uiCopy.modelRoster.territoriesRequiredBody);
      return;
    }
    setTerritorySaving(true);
    setTerritorySaveFeedback(null);
    try {
      await upsertTerritoriesForModel(selectedModel.id, agencyId, territoryCountryCodes);
      void getTerritoriesForAgency(agencyId).then(setRosterTerritoriesMap);
      setTerritorySaveFeedback('saved');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('handleSaveTerritoriesOnly error:', err);
      setTerritorySaveFeedback('error');
      showAppAlert('Could not save territories', msg);
    } finally {
      setTerritorySaving(false);
      setTimeout(() => setTerritorySaveFeedback(null), 3000);
    }
  };

  const visibleIsoCountries = useMemo(() => {
    const q = territorySearch.trim().toLowerCase();
    if (!q) return isoCountryList.slice(0, 40);
    return isoCountryList
      .filter((c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
      .slice(0, 40);
  }, [isoCountryList, territorySearch]);

  const filtered = useMemo(() => filterModels(models, filters), [models, filters]);

  useEffect(() => {
    setSaveFeedback(null);
    if (!selectedModel) {
      setTerritoryCountryCodes([]);
      return;
    }
    void getTerritoriesForModel(selectedModel.id, agencyId).then((rows) => {
      setTerritoryCountryCodes(rows.map((r) => r.country_code.toUpperCase()));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel?.id]);

  const handleAddModel = async () => {
    const name = addModelEditState.name?.trim();
    if (!name || !agencyId) return;

    const toNullableInt = (value?: string) => {
      const trimmed = (value ?? '').trim();
      if (!trimmed) return null;
      const parsed = Number.parseInt(trimmed, 10);
      return Number.isFinite(parsed) ? parsed : null;
    };

    // Derive visibility flags from categories (same logic as the full edit save).
    const hasFashion = addModelEditState.categories.some((c) => c === 'Fashion' || c === 'High Fashion');
    const hasCommercial = addModelEditState.categories.includes('Commercial');
    const noCategory = addModelEditState.categories.length === 0;
    const isVisibleFashion = noCategory || hasFashion;
    const isVisibleCommercial = noCategory || hasCommercial;

    // Capture files in a local const BEFORE state resets (closure-safe).
    const filesToUpload = [...addModelImageFiles];
    const polaroidFilesToUpload = [...addModelPolaroidFiles];

    const heightInt = toNullableInt(addModelEditState.height);
    // Height is marked NOT NULL in the DB schema.
    // If the user left it blank and no existing model is found to merge into,
    // the insert would fail. We default to 0 so the row can be created —
    // the completeness banner will flag the missing height immediately.
    const heightForInsert: number = heightInt ?? 0;

    setAddLoading(true);
    setAddModelFeedback(null);
    try {
      const emailTrim = addModelEditState.email?.trim() || null;

      // Use importModelAndMerge so that a model with the same email or name+birthday
      // is merged instead of creating a duplicate.
      const territoriesInput = agencyId
        ? addTerritories.map((cc) => ({ country_code: cc, agency_id: agencyId }))
        : [];

      const toNullableFloat = (value?: string) => {
        const trimmed = (value ?? '').trim();
        if (!trimmed) return null;
        const parsed = parseFloat(trimmed);
        return Number.isFinite(parsed) ? parsed : null;
      };

      const mergeResult = await importModelAndMerge({
        agency_id:        agencyId,
        name,
        email:            emailTrim,
        height:           heightForInsert,
        chest:            toNullableInt(addModelEditState.chest),
        waist:            toNullableInt(addModelEditState.waist),
        hips:             toNullableInt(addModelEditState.hips),
        shoe_size:        toNullableFloat(addModelEditState.shoe_size),
        legs_inseam:      toNullableInt(addModelEditState.legs_inseam),
        city:             addModelEditState.city || null,
        country_code:     addModelEditState.country_code || null,
        hair_color:       addModelEditState.hair_color || null,
        eye_color:        addModelEditState.eye_color || null,
        ethnicity:        addModelEditState.ethnicity || null,
        sex:              addModelEditState.sex,
        categories:       addModelEditState.categories.length > 0 ? addModelEditState.categories : null,
        is_sports_winter: addModelEditState.is_sports_winter,
        is_sports_summer: addModelEditState.is_sports_summer,
        is_visible_fashion:    isVisibleFashion,
        is_visible_commercial: isVisibleCommercial,
        territories:      territoriesInput.length > 0 ? territoriesInput : null,
      });

      if (!mergeResult) {
        throw new Error('Could not create or merge model — check console for details.');
      }

      // If merged (not created): also set agency_id and relationship status via direct update
      // when the existing record belongs to another agency or has no agency yet.
      if (!mergeResult.created) {
        // Model existed without agency → claim ownership via SECURITY DEFINER RPC
        await supabase.rpc('agency_claim_unowned_model', {
          p_model_id:                   mergeResult.model_id,
          p_agency_relationship_status: emailTrim ? 'pending_link' : 'active',
          p_is_visible_fashion:         isVisibleFashion,
          p_is_visible_commercial:      isVisibleCommercial,
        });
      } else {
        // Newly created: set relationship + sports flags not covered by importModelAndMerge insert.
        await supabase.rpc('agency_update_model_full', {
          p_model_id:                  mergeResult.model_id,
          p_agency_relationship_status: emailTrim ? 'pending_link' : 'active',
          p_is_visible_fashion:         isVisibleFashion,
          p_is_visible_commercial:      isVisibleCommercial,
          p_is_sports_winter:           addModelEditState.is_sports_winter,
          p_is_sports_summer:           addModelEditState.is_sports_summer,
        });
      }

      const createdModelId = mergeResult.model_id;
      const modelDisplayName = name;

      // If the agency entered an email, generate a claim token and send an invite email.
      // Runs isolated — cannot block model creation or form reset.
      let emailSentOk = false;
      if (emailTrim) {
        try {
          const claimRes = await generateModelClaimToken(createdModelId, inviteOrganizationId ?? undefined);
          if (claimRes.ok) {
            const { data: { session: currentSession } } = await supabase.auth.getSession();
            const invokeRes = await supabase.functions.invoke('send-invite', {
              body: {
                type: 'model_claim',
                to: emailTrim,
                token: claimRes.data.token,
                organization_id: inviteOrganizationId ?? undefined,
                modelName: modelDisplayName,
                orgName: agencyName || undefined,
              },
              headers: currentSession?.access_token
                ? { Authorization: `Bearer ${currentSession.access_token}` }
                : undefined,
            });
            emailSentOk = !invokeRes.error;
            if (invokeRes.error) {
              console.error('handleAddModel send-invite error:', invokeRes.error);
            }
          } else {
            console.error('handleAddModel generateModelClaimToken error:', claimRes.error);
          }
        } catch (e) {
          console.error('handleAddModel model invite exception:', e);
        }
      }

      // Reset form immediately after successful insert.
      setAddModelEditState(buildEditState({ name: '' }));
      setAddTerritories([]);
      setAddTerritorySearch('');
      setAddModelImageFiles([]);
      setAddModelPolaroidFiles([]);
      setAddModelImageRightsConfirmed(false);
      setShowAddForm(false);

      // Uploads should not make creation fail.
      const hasAnyPhotos = filesToUpload.length > 0 || polaroidFilesToUpload.length > 0;
      if (hasAnyPhotos) {
        // EXPLOIT-C2 fix: Require image rights confirmation before any upload.
        if (!addModelImageRightsConfirmed) {
          setAddModelFeedback('Please confirm you have all image rights before uploading photos.');
          setAddLoading(false);
          return;
        }
        // Record the rights confirmation in the audit table, then guard the upload.
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (!currentUser) {
          Alert.alert('Image Rights Required', 'Authentication required to upload photos.');
          setAddLoading(false);
          return;
        }
        const rightsOk = await confirmImageRights({
          userId: currentUser.id,
          modelId: createdModelId,
          orgId: inviteOrganizationId ?? undefined,
        });
        if (!rightsOk.ok) {
          Alert.alert('Image Rights Required', 'Rights confirmation could not be recorded. Please try again.');
          setAddLoading(false);
          return;
        }
        const guard = await guardImageUpload(currentUser.id, createdModelId);
        if (!guard.ok) {
          Alert.alert('Image Rights Required', 'Rights confirmation could not be verified. Please try again.');
          setAddLoading(false);
          return;
        }

        // Portfolio uploads
        if (filesToUpload.length > 0) {
          const uploadedUrls: string[] = [];
          for (const file of filesToUpload) {
            const result = await uploadModelPhoto(createdModelId, file);
            if (result) {
              uploadedUrls.push(result.url);
            } else {
              Alert.alert('Upload Failed', 'One or more portfolio photos could not be uploaded. Please try again in the model settings.');
            }
          }
          if (uploadedUrls.length > 0) {
            await upsertPhotosForModel(
              createdModelId,
              uploadedUrls.map((url, index) => ({
                url,
                sort_order: index,
                visible: true,
                is_visible_to_clients: true,
                source: null,
                api_external_id: null,
                photo_type: 'portfolio' as const,
              })),
            );
            await syncPortfolioToModel(createdModelId, uploadedUrls);
          }
        }

        // Polaroid uploads — stored in the same private bucket as portfolio.
        // New polaroids start as agency-only (is_visible_to_clients: false).
        // models.polaroids[] is NOT synced here because only visible polaroids belong there.
        // The agency toggles visibility per photo in ModelMediaSettingsPanel → that triggers
        // syncPolaroidsToModel with only the visible subset.
        if (polaroidFilesToUpload.length > 0) {
          const uploadedPolaroidUrls: string[] = [];
          for (const file of polaroidFilesToUpload) {
            const result = await uploadModelPhoto(createdModelId, file);
            if (result) {
              uploadedPolaroidUrls.push(result.url);
            } else {
              Alert.alert('Upload Failed', 'One or more polaroid photos could not be uploaded. Please try again in the model settings.');
            }
          }
          if (uploadedPolaroidUrls.length > 0) {
            await upsertPhotosForModel(
              createdModelId,
              uploadedPolaroidUrls.map((url, index) => ({
                url,
                sort_order: index,
                visible: false,
                is_visible_to_clients: false,
                source: null,
                api_external_id: null,
                photo_type: 'polaroid' as const,
              })),
            );
            // intentionally no syncPolaroidsToModel call: polaroids are agency-only by default.
            // models.polaroids[] only holds is_visible_to_clients=true entries (synced from MediaPanel).
          }
        }
      }

      try {
        await Promise.resolve(onRefresh());
      } catch (refreshErr: any) {
        console.error('handleAddModel refresh error:', refreshErr);
      }

      const fresh = await getModelByIdFromSupabase(createdModelId);
      const emailNote = emailTrim
        ? emailSentOk
          ? ` Invitation email sent to ${emailTrim}.`
          : ` Could not send invitation email — share the invite link manually.`
        : '';
      const syncWarn = mergeResult.externalSyncIdsPersistFailed
        ? uiCopy.modelRoster.externalSyncIdsPersistWarning
        : '';
      if (fresh) {
        setSelectedModel(fresh);
        setAddModelFeedback(
          mergeResult.created
            ? `${modelDisplayName} added successfully.${emailNote}${syncWarn}`
            : `${modelDisplayName} merged with existing profile.${emailNote}${syncWarn}`,
        );
      } else {
        setAddModelFeedback(
          mergeResult.created
            ? `${modelDisplayName} was created.${emailNote} Please refresh the list once.${syncWarn}`
            : `${modelDisplayName} merged.${emailNote} Please refresh the list once.${syncWarn}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('handleAddModel error:', err);
      const isRlsInsert = /row-level security policy/i.test(message) && /models/i.test(message);
      const userMessage = isRlsInsert
        ? 'RLS blocks model insert. Run supabase/migration_models_insert_agency_org_members.sql and retry.'
        : message;
      setAddModelFeedback(`Could not add model: ${userMessage}`);
      Alert.alert('Could not add model', userMessage);
    } finally {
      setAddLoading(false);
    }
  };

  const saveApiKey = async (provider: 'mediaslide' | 'netwalk', key: string) => {
    // Update in-memory state immediately for instant UI feedback.
    // Keys are never written to localStorage — DB is the single source of truth.
    if (provider === 'mediaslide') { setMediaslideKey(key); setShowMediaslideInput(false); }
    else { setNetwalkKey(key); setShowNetwalkInput(false); }
    // Persist org-wide to DB (best-effort; failure does not block local usage).
    if (agencyId) {
      const result = await saveAgencyApiConnection(agencyId, provider, key || null);
      if (!result.ok) {
        console.error('saveApiKey: could not persist to DB:', result.message);
      }
    }
  };

  const handleSync = async () => {
    if (syncLoading) return;
    setSyncLoading(true);
    const providers = [mediaslideKey && 'Mediaslide', netwalkKey && 'Netwalk'].filter(Boolean).join(' & ');
    setSyncFeedback(`Syncing models from ${providers || 'connected providers'}…`);
    try {
      await Promise.all([
        mediaslideKey ? runMediaslideCronSync(mediaslideKey) : Promise.resolve(),
        netwalkKey    ? runNetwalkCronSync(netwalkKey)        : Promise.resolve(),
      ]);
      // Refresh models list so the incomplete-count banner reflects the new state.
      onRefresh();
      // Compute incomplete count from the freshly loaded models after refresh.
      // We use a short delay to let onRefresh propagate new data into `models`.
      setTimeout(() => {
        const incompleteAfterSync = models.filter(
          (m) =>
            (m.portfolio_images ?? []).length === 0 ||
            !(rosterTerritoriesMap[m.id] ?? []).length,
        ).length;
        setSyncFeedback(
          incompleteAfterSync > 0
            ? `Sync complete. ${uiCopy.modelRoster.incompleteModelsBanner(incompleteAfterSync)}.`
            : 'Sync complete — all models have required fields.',
        );
      }, 800);
    } catch (e: any) {
      console.error('handleSync error:', e);
      setSyncFeedback('Sync failed — see console for details.');
    } finally {
      setSyncLoading(false);
      setTimeout(() => setSyncFeedback(null), 8000);
    }
  };

  /**
   * Import & Merge a model profile from a URL that returns a JSON payload.
   * The JSON is expected to contain at minimum: name (string), height (number).
   * Optional fields: email, mediaslide_sync_id, bust/waist/hips/chest/legs_inseam/
   * shoe_size, city, country_code, hair_color, eye_color, sex, ethnicity,
   * categories, portfolio_images (string[]), polaroids (string[]).
   */
  const handleImportByLink = async () => {
    const url = importLinkUrl.trim();
    if (!url || importLinkLoading) return;
    setImportLinkLoading(true);
    setImportLinkFeedback(null);
    try {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        setImportLinkFeedback({ ok: false, message: 'Invalid URL format.' });
        return;
      }
      if (parsed.protocol !== 'https:') {
        setImportLinkFeedback({ ok: false, message: 'Only HTTPS URLs are allowed.' });
        return;
      }
      const hostname = parsed.hostname.toLowerCase();
      const isPrivate =
        hostname === 'localhost' ||
        /^127\./.test(hostname) ||
        /^10\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
        /^::1$/.test(hostname) ||
        /^0\./.test(hostname) ||
        hostname === '169.254.169.254';
      if (isPrivate) {
        setImportLinkFeedback({ ok: false, message: 'Private network targets are not allowed.' });
        return;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const raw = await res.json();

      // Support both a single object and an array (take first element).
      const data: Record<string, unknown> = Array.isArray(raw) ? raw[0] : raw;

      const name = typeof data.name === 'string' ? data.name.trim() : '';
      // name is mandatory — height is recommended only (completeness banner flags it).
      if (!name) {
        setImportLinkFeedback({ ok: false, message: 'Invalid payload: "name" (string) is required.' });
        return;
      }

      const toNum = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
      const toStr = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null;
      const toArr = (v: unknown): string[] => Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];

      const portfolioImages  = toArr(data.portfolio_images);
      const territoryCodes   = toArr(data.territories ?? data.territory_codes);
      const mediaslideSyncId = toStr(data.mediaslide_sync_id);
      const netwalkModelId   = toStr(data.netwalk_model_id ?? data.netwalk_id);

      // Convert flat country-code strings to the ModelMergeTerritoryInput shape
      // (each territory must also carry the current agency_id for DB upsert).
      const territoriesInput = agencyId
        ? territoryCodes.map((cc) => ({ country_code: cc, agency_id: agencyId }))
        : [];

      const result = await importModelAndMerge({
        agency_id: agencyId,
        mediaslide_sync_id: mediaslideSyncId,
        netwalk_model_id:   netwalkModelId,
        email:        toStr(data.email),
        name,
        height:       toNum(data.height) ?? 0,
        bust:         toNum(data.bust),
        waist:        toNum(data.waist),
        hips:         toNum(data.hips),
        chest:        toNum(data.chest),
        legs_inseam:  toNum(data.legs_inseam),
        shoe_size:    toNum(data.shoe_size),
        city:         toStr(data.city),
        country_code: toStr(data.country_code),
        hair_color:   toStr(data.hair_color),
        eye_color:    toStr(data.eye_color),
        ethnicity:    toStr(data.ethnicity),
        sex:          (data.sex === 'male' || data.sex === 'female') ? data.sex : null,
        categories:   toArr(data.categories).length > 0 ? toArr(data.categories) : null,
        portfolio_images: portfolioImages,
        polaroids:    toArr(data.polaroids),
        territories:  territoriesInput.length > 0 ? territoriesInput : undefined,
        forceUpdateMeasurements: Boolean(mediaslideSyncId || netwalkModelId),
      });

      if (!result) {
        setImportLinkFeedback({ ok: false, message: 'Import failed. Check console for details.' });
        return;
      }

      // Check which mandatory fields are missing in the imported payload so the
      // agency immediately knows what to fix — even before opening the model.
      const missingRequired: string[] = [];
      if (portfolioImages.length === 0)  missingRequired.push('Photos');
      if (territoryCodes.length === 0)   missingRequired.push('Territory');
      const baseMsg = result.created
        ? `Model "${name}" added to My Models.`
        : `Model "${name}" merged with existing profile.`;

      const warningMsg = missingRequired.length > 0
        ? ` Missing required fields: ${missingRequired.join(', ')} — model will not appear to clients until resolved.`
        : '';
      const syncWarn = result.externalSyncIdsPersistFailed ? uiCopy.modelRoster.externalSyncIdsPersistWarning : '';

      setImportLinkFeedback({ ok: true, message: baseMsg + warningMsg + syncWarn });
      setImportLinkUrl('');
      onRefresh();
    } catch (e: any) {
      console.error('handleImportByLink error:', e);
      setImportLinkFeedback({ ok: false, message: e?.message ?? 'Unknown error' });
    } finally {
      setImportLinkLoading(false);
    }
  };

  const handleSaveModel = async () => {
    if (!selectedModel) return;

    // ── STEP 0: Territory is required — cannot save without at least one ──
    if (territoryCountryCodes.length === 0) {
      Alert.alert(
        uiCopy.modelRoster.territoriesRequiredTitle,
        uiCopy.modelRoster.territoriesRequiredBody,
      );
      return;
    }

    setSaveFeedback('saving');

    // ── STEP 1: Save territories — block on failure, show error to user ──
    try {
      await upsertTerritoriesForModel(selectedModel.id, agencyId, territoryCountryCodes);
      void getTerritoriesForAgency(agencyId).then(setRosterTerritoriesMap);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('handleSaveModel territory error:', err);
      setSaveFeedback('error');
      setTimeout(() => setSaveFeedback(null), 4000);
      showAppAlert(
        'Could not save territories',
        `${msg}\n\nApply migration_territories_rpc_definitive.sql in Supabase SQL Editor.`,
      );
      return;
    }

    // ── STEP 2: Portfolio alert (non-blocking) — completeness banner already
    //   shows a warning; photos are managed independently by ModelMediaSettingsPanel.
    if (!hasVisiblePortfolio) {
      Alert.alert(uiCopy.modelRoster.portfolioRequiredTitle, uiCopy.modelRoster.portfolioRequiredBody);
    }

    // ── STEP 3: Save model fields + photos ──
    let step3Succeeded = false;
    try {
      const pInt = (v: string) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
      const updates: any = {};
      updates.name = editState.name;
      updates.email = editState.email.trim() || null;
      updates.height = pInt(editState.height) ?? selectedModel.height;
      // Save to both chest and bust for backwards compatibility.
      const chestVal = pInt(editState.chest);
      if (chestVal !== null) { updates.chest = chestVal; updates.bust = chestVal; }
      updates.waist = pInt(editState.waist);
      updates.hips = pInt(editState.hips);
      updates.legs_inseam = pInt(editState.legs_inseam);
      updates.shoe_size = pInt(editState.shoe_size);
      updates.hair_color = editState.hair_color || null;
      updates.eye_color = editState.eye_color || null;
      updates.ethnicity = editState.ethnicity ?? null;
      updates.city = editState.city || null;
      updates.country_code = editState.country_code || null;
      updates.current_location = editState.current_location || null;
      // Derive visibility flags from categories — no separate Visibility toggle.
      const hasFashion = editState.categories.some((c) => c === 'Fashion' || c === 'High Fashion');
      const hasCommercial = editState.categories.includes('Commercial');
      const noCategory = editState.categories.length === 0;
      updates.is_visible_fashion = noCategory || hasFashion;
      updates.is_visible_commercial = noCategory || hasCommercial;
      updates.categories = editState.categories.length > 0 ? editState.categories : null;
      // Sports columns: only include if migration has been applied (graceful skip on unknown column error).
      updates.is_sports_winter = editState.is_sports_winter;
      updates.is_sports_summer = editState.is_sports_summer;
      updates.sex = editState.sex;

      const { error: modelUpdateError } = await supabase.rpc('agency_update_model_full', {
        p_model_id:             selectedModel.id,
        p_name:                 updates.name              ?? null,
        p_email:                updates.email             ?? null,
        p_phone:                updates.phone             ?? null,
        p_city:                 updates.city              ?? null,
        p_country_code:         (updates as any).country_code      ?? null,
        p_current_location:     (updates as any).current_location  ?? null,
        p_height:               updates.height            ?? null,
        p_bust:                 updates.bust              ?? null,
        p_waist:                updates.waist             ?? null,
        p_hips:                 updates.hips              ?? null,
        p_chest:                updates.chest             ?? null,
        p_legs_inseam:          updates.legs_inseam       ?? null,
        p_shoe_size:            (updates as any).shoe_size         ?? null,
        p_hair_color:           updates.hair_color        ?? null,
        p_eye_color:            updates.eye_color         ?? null,
        p_sex:                  (updates as any).sex               ?? null,
        p_ethnicity:            (updates as any).ethnicity         ?? null,
        // Leeres Array = Kategorien löschen; null = keine Änderung
        p_categories:           updates.categories !== undefined
                                  ? (updates.categories ?? [])
                                  : null,
        p_is_visible_fashion:   updates.is_visible_fashion   ?? null,
        p_is_visible_commercial: updates.is_visible_commercial ?? null,
        p_is_sports_winter:     (updates as any).is_sports_winter  ?? null,
        p_is_sports_summer:     (updates as any).is_sports_summer  ?? null,
      });
      if (modelUpdateError) {
        throw modelUpdateError;
      }

      // Persist city/country to model_locations (agency-managed, source='agency').
      // Forward-geocode city → coordinates so the model appears in Near Me radius queries.
      // share_approximate_location is set to true only when geocoding succeeds.
      // The model-owned location (source='live'/'current') is protected by the DB priority guard.
      if (editState.country_code) {
        const cityTrim = editState.city?.trim() ?? null;
        const geocoded = cityTrim
          ? await geocodeCityForAgency(cityTrim, editState.country_code)
          : null;

        await upsertModelLocation(
          selectedModel.id,
          {
            country_code: editState.country_code,
            city: cityTrim,
            lat: geocoded?.lat,
            lng: geocoded?.lng,
            share_approximate_location: geocoded != null,
          },
          'agency',
        );
      }

      // Photos are managed directly by ModelMediaSettingsPanel (immediate save on change).
      setSaveFeedback('success');
      step3Succeeded = true;
    } catch (err) {
      console.error('handleSaveModel error:', err);
      setSaveFeedback('error');
    }

    // ── STEP 4: Only refresh + close panel on success ──
    if (!step3Succeeded) return;
    onRefresh();
    // Refresh completeness after save (model fields may have changed).
    if (selectedModel) {
      const freshModel = await getModelByIdFromSupabase(selectedModel.id).catch(() => null);
      if (freshModel) {
        const ctx: CompletenessContext = {
          hasTerritories: territoryCountryCodes.length > 0,
          hasVisiblePhoto: hasVisiblePortfolio,
        };
        setCompletenessIssues(checkModelCompleteness(freshModel, ctx));
      }
    }
    setTimeout(() => {
      setSaveFeedback(null);
      setSelectedModel(null);
      setEditState(buildEditState({ name: '' }));
    }, 1800);
  };

  const [linkAccountEmail, setLinkAccountEmail] = useState('');
  const [linkAccountLoading, setLinkAccountLoading] = useState(false);
  const addModelFileInputRef = useRef<HTMLInputElement | null>(null);
  const addModelPolaroidInputRef = useRef<HTMLInputElement | null>(null);

  const handleAddModelPhotoFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target?.files ?? []).filter((f) => f.type?.startsWith('image/'));
    e.target.value = '';
    if (files.length === 0) return;
    setAddModelImageFiles((prev) => [...prev, ...files]);
  };

  const handleAddModelPolaroidFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target?.files ?? []).filter((f) => f.type?.startsWith('image/'));
    e.target.value = '';
    if (files.length === 0) return;
    setAddModelPolaroidFiles((prev) => [...prev, ...files]);
  };

  if (selectedModel) {
    const needsAccountLink = !selectedModel.user_id;
    return (
      <ScreenScrollView>
        <TouchableOpacity onPress={() => { setSelectedModel(null); setEditState(buildEditState({ name: '' })); }} style={{ marginBottom: spacing.md }}>
          <Text style={s.backLabel}>← Back to models</Text>
        </TouchableOpacity>
        <Text style={s.heading}>{selectedModel.name}</Text>

        {/* Location source awareness badge — shown when model owns their location */}
        {selectedModelLocation && selectedModelLocation.source !== 'agency' && (
          <View style={{
            backgroundColor: selectedModelLocation.source === 'live' ? '#e8f5e9' : '#e3f2fd',
            borderRadius: 8, padding: spacing.sm, marginBottom: spacing.md,
            borderLeftWidth: 3,
            borderLeftColor: selectedModelLocation.source === 'live' ? '#2e7d32' : '#1565c0',
          }}>
            <Text style={{ fontWeight: '700', fontSize: 12,
              color: selectedModelLocation.source === 'live' ? '#2e7d32' : '#1565c0', marginBottom: 2 }}>
              {locationSourceLabel(selectedModelLocation.source)} active
              {selectedModelLocation.city ? ` · ${selectedModelLocation.city}, ${selectedModelLocation.country_code}` : ''}
            </Text>
            <Text style={{ fontSize: 11, color: '#555' }}>
              This model manages their own location. Your city/country changes will be saved to
              their profile but will not override their active Near Me location.
            </Text>
          </View>
        )}

        <ModelEditDetailsPanel
          state={editState}
          onChange={(patch) => setEditState((prev) => ({ ...prev, ...patch }))}
        />

        {/* Model Media Management – Portfolio, Polaroids, Private Folder */}
        <View style={{ marginTop: spacing.lg }}>
          <ModelMediaSettingsPanel
            modelId={selectedModel.id}
            organizationId={inviteOrganizationId ?? null}
            onHasVisiblePortfolioChange={setHasVisiblePortfolio}
          />
        </View>

        {/* Territories of Representation */}
        <View style={{
          marginTop: spacing.lg,
          borderTopWidth: 1,
          borderTopColor: territoryCountryCodes.length === 0 ? (colors.buttonSkipRed ?? '#c0392b') : colors.border,
          paddingTop: spacing.md,
        }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs }}>
              <Text style={s.sectionLabel}>{uiCopy.modelRoster.territoriesTitle}</Text>
              <View style={{
                paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4,
                backgroundColor: colors.buttonSkipRed ?? '#c0392b',
              }}>
                <Text style={{ ...typography.label, fontSize: 8, color: '#fff', letterSpacing: 0.5 }}>REQUIRED</Text>
              </View>
            </View>
            {territoryCountryCodes.length > 0 ? (
              <Text style={{ ...typography.label, fontSize: 10, color: colors.accentGreen ?? colors.textSecondary, marginBottom: spacing.xs, letterSpacing: 0.5 }}>
                {territoryCountryCodes.slice().sort().join(' · ')}
              </Text>
            ) : (
              <View style={{
                borderWidth: 1,
                borderColor: colors.buttonSkipRed ?? '#c0392b',
                borderRadius: 8,
                padding: spacing.sm,
                marginBottom: spacing.sm,
                backgroundColor: 'rgba(192,57,43,0.05)',
              }}>
                <Text style={{ ...typography.body, fontSize: 11, color: colors.buttonSkipRed ?? '#c0392b' }}>
                  {uiCopy.modelRoster.territoriesRequiredInline}
                </Text>
              </View>
            )}

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

            {/* Dedicated Save Territories button — saves territories independently */}
            <TouchableOpacity
              onPress={handleSaveTerritoriesOnly}
              disabled={territorySaving || territoryCountryCodes.length === 0}
              style={{
                marginTop: spacing.sm,
                borderRadius: 999,
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                alignItems: 'center',
                backgroundColor:
                  territorySaveFeedback === 'saved'
                    ? (colors.accentGreen ?? '#2e7d32')
                    : territorySaveFeedback === 'error'
                    ? (colors.buttonSkipRed ?? '#c0392b')
                    : (colors.buttonOptionGreen ?? '#2e7d32'),
                opacity: territorySaving || territoryCountryCodes.length === 0 ? 0.5 : 1,
              }}
            >
              <Text style={{ ...typography.label, fontSize: 11, color: '#fff', letterSpacing: 0.5 }}>
                {territorySaving
                  ? 'Saving territories…'
                  : territorySaveFeedback === 'saved'
                  ? '✓ Territories saved'
                  : territorySaveFeedback === 'error'
                  ? 'Save failed — tap to retry'
                  : `Save territories (${territoryCountryCodes.length})`}
              </Text>
            </TouchableOpacity>
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

        {/* ── Profile Completeness Banner ───────────────────────────────── */}
        {completenessIssues.length > 0 && (
          <View style={{
            borderRadius: 10,
            borderWidth: 1,
            borderColor: completenessIssues.some((i) => i.severity === 'critical') ? '#c0392b' : colors.border,
            backgroundColor: completenessIssues.some((i) => i.severity === 'critical') ? '#fff5f5' : '#fffbf2',
            padding: spacing.md,
            marginBottom: spacing.md,
          }}>
            <Text style={{ ...typography.label, fontSize: 12, color: completenessIssues.some((i) => i.severity === 'critical') ? '#c0392b' : '#b7740a', marginBottom: spacing.xs }}>
              {uiCopy.modelCompleteness.bannerTitle}
            </Text>
            <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm }}>
              {uiCopy.modelCompleteness.bannerSubtitle}
            </Text>
            {completenessIssues.map((issue) => (
              <View key={issue.field} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, marginBottom: 4 }}>
                <Text style={{ fontSize: 11, color: issue.severity === 'critical' ? '#c0392b' : '#b7740a', lineHeight: 16 }}>
                  {issue.severity === 'critical' ? '●' : '○'}
                </Text>
                <Text style={{ ...typography.body, fontSize: 11, color: issue.severity === 'critical' ? '#c0392b' : colors.textSecondary, flex: 1, lineHeight: 16 }}>
                  {issue.label}
                </Text>
              </View>
            ))}
          </View>
        )}

        {saveFeedback === 'success' && (
          <View style={{ backgroundColor: '#1a7a4a', borderRadius: 8, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm, alignItems: 'center' }}>
            <Text style={{ ...typography.label, fontSize: 13, color: '#fff' }}>Settings saved successfully</Text>
          </View>
        )}
        {saveFeedback === 'error' && (
          <View style={{ backgroundColor: '#b91c1c', borderRadius: 8, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm, alignItems: 'center' }}>
            <Text style={{ ...typography.label, fontSize: 13, color: '#fff' }}>Save failed — please try again</Text>
          </View>
        )}
        <TouchableOpacity
          onPress={handleSaveModel}
          style={[s.saveBtn, saveFeedback === 'saving' && { opacity: 0.6 }]}
          disabled={saveFeedback === 'saving'}
        >
          <Text style={s.saveBtnLabel}>{saveFeedback === 'saving' ? 'Saving…' : 'Save settings'}</Text>
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
                      setEditState(buildEditState({ name: '' }));
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
          <TouchableOpacity
            style={[s.saveBtn, { alignSelf: 'flex-start', paddingHorizontal: spacing.lg }, syncLoading && { opacity: 0.6 }]}
            onPress={handleSync}
            disabled={syncLoading}
          >
            <Text style={s.saveBtnLabel}>{syncLoading ? 'Syncing…' : 'Sync Models'}</Text>
          </TouchableOpacity>
        )}
        {syncFeedback && (
          <Text style={{ ...typography.body, fontSize: 12, color: colors.accentGreen, marginTop: spacing.xs }}>
            {syncFeedback}
          </Text>
        )}
      </View>

      {/* ── Import from Link ─────────────────────────────────────────────── */}
      <View style={s.apiSection}>
        <Text style={s.sectionLabel}>Import from Link</Text>
        <Text style={{ ...typography.body, fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm }}>
          Paste a URL that returns a JSON model profile (name, height, measurements, photos).
          If a profile with the same email or Mediaslide ID already exists it will be merged.
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <TextInput
            value={importLinkUrl}
            onChangeText={setImportLinkUrl}
            placeholder="https://…/model.json"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[s.editInput, { flex: 1 }]}
          />
          <TouchableOpacity
            style={[s.apiConnectBtn, (!importLinkUrl.trim() || importLinkLoading) && { opacity: 0.5 }]}
            onPress={handleImportByLink}
            disabled={!importLinkUrl.trim() || importLinkLoading}
          >
            <Text style={s.saveBtnLabel}>{importLinkLoading ? 'Importing…' : 'Import & Merge'}</Text>
          </TouchableOpacity>
        </View>
        {importLinkFeedback && (
          <Text style={{
            ...typography.body,
            fontSize: 12,
            color: importLinkFeedback.ok ? colors.accentGreen : '#e74c3c',
            marginTop: spacing.xs,
          }}>
            {importLinkFeedback.message}
          </Text>
        )}
      </View>

      <Text style={s.sectionLabel}>My Models</Text>
      <ModelFiltersPanel
        filters={filters}
        onChangeFilters={setFilters}
      />

      {/* Add Model Manually */}
      <TouchableOpacity style={[s.apiBtn, { alignSelf: 'flex-start', marginBottom: spacing.md }]} onPress={() => setShowAddForm((v) => !v)}>
        <Text style={s.apiBtnLabel}>{showAddForm ? 'Cancel' : '+ Add Model Manually'}</Text>
      </TouchableOpacity>
      {showAddForm && (
        <View style={s.addFormContainer}>
          <ModelEditDetailsPanel
            state={addModelEditState}
            onChange={(patch) => setAddModelEditState((prev) => ({ ...prev, ...patch }))}
          />

          {/* Territory selection — required for model to be visible to clients */}
          <View style={{ marginBottom: spacing.sm }}>
            <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary }}>
              Representation territories *
            </Text>
            <Text style={{ ...typography.body, fontSize: 10, color: colors.textSecondary, marginBottom: spacing.xs }}>
              Select countries where this model is represented. Required for client visibility.
            </Text>
            {addTerritories.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.xs }}>
                {addTerritories.map((code) => (
                  <TouchableOpacity
                    key={code}
                    style={[s.visPill, s.visPillActive, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}
                    onPress={() => setAddTerritories((prev) => prev.filter((c) => c !== code))}
                  >
                    <Text style={[s.visPillLabel, s.visPillLabelActive]}>
                      {(ISO_COUNTRY_NAMES as Record<string, string>)[code.toLowerCase()] ?? code}
                    </Text>
                    <Text style={[s.visPillLabel, s.visPillLabelActive, { fontSize: 11 }]}>×</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TextInput
              value={addTerritorySearch}
              onChangeText={setAddTerritorySearch}
              placeholder="Search country…"
              placeholderTextColor={colors.textSecondary}
              style={[s.editInput, { marginBottom: spacing.xs }]}
            />
            {addTerritorySearch.trim().length > 0 && (
              <View style={{ maxHeight: 160, borderWidth: 1, borderColor: colors.border, borderRadius: 6, overflow: 'hidden' }}>
                {isoCountryList
                  .filter((c) => {
                    const q = addTerritorySearch.trim().toLowerCase();
                    return c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
                  })
                  .slice(0, 20)
                  .map((c) => {
                    const selected = addTerritories.includes(c.code);
                    return (
                      <TouchableOpacity
                        key={c.code}
                        style={{
                          paddingHorizontal: spacing.sm,
                          paddingVertical: 8,
                          backgroundColor: selected ? colors.accentGreen + '22' : colors.surface,
                          borderBottomWidth: 1,
                          borderBottomColor: colors.border,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                        onPress={() => {
                          setAddTerritories((prev) =>
                            selected ? prev.filter((x) => x !== c.code) : [...prev, c.code],
                          );
                          setAddTerritorySearch('');
                        }}
                      >
                        <Text style={{ ...typography.body, fontSize: 13 }}>{c.name}</Text>
                        <Text style={{ ...typography.label, fontSize: 11, color: colors.textSecondary }}>{c.code}</Text>
                      </TouchableOpacity>
                    );
                  })}
              </View>
            )}
          </View>

          <View style={{ marginBottom: spacing.sm }}>
            <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary }}>Portfolio photos</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs }}>
              <TouchableOpacity
                style={s.filterPill}
                onPress={() => {
                  if (Platform.OS === 'web') addModelFileInputRef.current?.click();
                }}
              >
                <Text style={s.filterPillLabel}>
                  {addModelImageFiles.length > 0 ? `+ Add more` : 'Upload photos'}
                </Text>
              </TouchableOpacity>
              {addModelImageFiles.length > 0 && (
                <TouchableOpacity
                  onPress={() => setAddModelImageFiles([])}
                  style={[s.filterPill, { borderColor: colors.textSecondary }]}
                >
                  <Text style={[s.filterPillLabel, { color: colors.textSecondary }]}>Clear all</Text>
                </TouchableOpacity>
              )}
            </View>
            {addModelImageFiles.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }}>
                {addModelImageFiles.map((f, i) => {
                  const objUrl = typeof URL !== 'undefined' ? URL.createObjectURL(f) : '';
                  return (
                    <View key={`${f.name}-${i}`} style={{ position: 'relative' }}>
                      <Image
                        source={{ uri: objUrl }}
                        style={{ width: 60, height: 80, borderRadius: 4, borderWidth: i === 0 ? 2 : 1, borderColor: i === 0 ? colors.textPrimary : colors.border }}
                        resizeMode="cover"
                      />
                      {i === 0 && (
                        <View style={{ position: 'absolute', bottom: 2, left: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 2, paddingVertical: 1 }}>
                          <Text style={{ color: '#fff', fontSize: 8, textAlign: 'center' }}>Cover</Text>
                        </View>
                      )}
                      <TouchableOpacity
                        style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.textPrimary, justifyContent: 'center', alignItems: 'center' }}
                        onPress={() => setAddModelImageFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <Text style={{ color: colors.surface, fontSize: 10, lineHeight: 14, textAlign: 'center' }}>×</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            )}
            {addModelImageFiles.length === 0 && (
              <Text style={[s.metaText, { marginTop: 4 }]}>First image will be used as cover photo.</Text>
            )}
            {Platform.OS === 'web' && (
              <input
                ref={addModelFileInputRef as any}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={handleAddModelPhotoFiles}
              />
            )}
          </View>

          {/* Polaroid photos */}
          <View style={{ marginBottom: spacing.sm }}>
            <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary }}>Polaroid photos</Text>
            <Text style={{ ...typography.body, fontSize: 10, color: colors.textSecondary, marginBottom: spacing.xs }}>
              Optional. Agency-only by default; visible to clients only when included in a polaroid package.
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs }}>
              <TouchableOpacity
                style={s.filterPill}
                onPress={() => {
                  if (Platform.OS === 'web') addModelPolaroidInputRef.current?.click();
                }}
              >
                <Text style={s.filterPillLabel}>
                  {addModelPolaroidFiles.length > 0 ? '+ Add more' : 'Upload polaroids'}
                </Text>
              </TouchableOpacity>
              {addModelPolaroidFiles.length > 0 && (
                <TouchableOpacity
                  onPress={() => setAddModelPolaroidFiles([])}
                  style={[s.filterPill, { borderColor: colors.textSecondary }]}
                >
                  <Text style={[s.filterPillLabel, { color: colors.textSecondary }]}>Clear all</Text>
                </TouchableOpacity>
              )}
            </View>
            {addModelPolaroidFiles.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }}>
                {addModelPolaroidFiles.map((f, i) => {
                  const objUrl = typeof URL !== 'undefined' ? URL.createObjectURL(f) : '';
                  return (
                    <View key={`pol-${f.name}-${i}`} style={{ position: 'relative' }}>
                      <Image
                        source={{ uri: objUrl }}
                        style={{ width: 60, height: 80, borderRadius: 4, borderWidth: 1, borderColor: colors.border }}
                        resizeMode="cover"
                      />
                      <View style={{ position: 'absolute', bottom: 2, left: 2, right: 2, backgroundColor: 'rgba(255,152,0,0.75)', borderRadius: 2, paddingVertical: 1 }}>
                        <Text style={{ color: '#fff', fontSize: 7, textAlign: 'center' }}>POLAROID</Text>
                      </View>
                      <TouchableOpacity
                        style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.textPrimary, justifyContent: 'center', alignItems: 'center' }}
                        onPress={() => setAddModelPolaroidFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <Text style={{ color: colors.surface, fontSize: 10, lineHeight: 14, textAlign: 'center' }}>×</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            )}
            {Platform.OS === 'web' && (
              <input
                ref={addModelPolaroidInputRef as any}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={handleAddModelPolaroidFiles}
              />
            )}
          </View>

          {(addModelImageFiles.length > 0 || addModelPolaroidFiles.length > 0) && (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10, marginTop: 4 }}
              onPress={() => setAddModelImageRightsConfirmed(!addModelImageRightsConfirmed)}
            >
              <View style={{
                width: 18, height: 18, borderRadius: 3, borderWidth: 1.5,
                borderColor: addModelImageRightsConfirmed ? colors.accentGreen : colors.textSecondary,
                backgroundColor: addModelImageRightsConfirmed ? colors.accentGreen : 'transparent',
                marginRight: 8, marginTop: 2, alignItems: 'center', justifyContent: 'center',
              }}>
                {addModelImageRightsConfirmed && <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>✓</Text>}
              </View>
              <Text style={[s.metaText, { flex: 1 }]}>
                I confirm I hold all necessary rights and consents to upload these images.
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[s.saveBtn, (!addModelEditState.name?.trim() || addLoading) && { opacity: 0.4 }]}
            onPress={handleAddModel}
            disabled={!addModelEditState.name?.trim() || addLoading}
          >
            <Text style={s.saveBtnLabel}>{addLoading ? 'Adding...' : 'Add Model'}</Text>
          </TouchableOpacity>
          {addModelFeedback && (
            <Text style={{ ...typography.body, fontSize: 12, marginTop: spacing.xs, color: colors.accentGreen }}>
              {addModelFeedback}
            </Text>
          )}
        </View>
      )}

      {/* Bulk selection header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs }}>
        <TouchableOpacity
          onPress={() => {
            if (selectedModelIds.size === filtered.length && filtered.length > 0) {
              setSelectedModelIds(new Set());
            } else {
              setSelectedModelIds(new Set(filtered.map((m) => m.id)));
            }
          }}
        >
          <Text style={{ ...typography.label, fontSize: 11, color: colors.textSecondary }}>
            {selectedModelIds.size > 0
              ? uiCopy.bulkActions.selectedCount.replace('{count}', String(selectedModelIds.size))
              : 'Select models for bulk action'}
          </Text>
        </TouchableOpacity>
        {selectedModelIds.size > 0 && (
          <TouchableOpacity onPress={() => setSelectedModelIds(new Set())}>
            <Text style={{ ...typography.label, fontSize: 11, color: colors.textSecondary }}>
              {uiCopy.bulkActions.clearSelection}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Org-wide banner: shows count of models missing required fields */}
      {(() => {
        const incompleteCount = filtered.filter(
          (m) =>
            (m.portfolio_images ?? []).length === 0 ||
            (rosterTerritoriesMap[m.id] ?? []).length === 0,
        ).length;
        if (incompleteCount === 0) return null;
        return (
          <View style={{
            borderRadius: 8,
            borderWidth: 1,
            borderColor: '#c0392b',
            backgroundColor: 'rgba(192,57,43,0.06)',
            padding: spacing.md,
            marginBottom: spacing.md,
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: spacing.sm,
          }}>
            <Text style={{ fontSize: 14, color: '#c0392b', lineHeight: 20 }}>⚠</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ ...typography.label, fontSize: 12, color: '#c0392b', marginBottom: 2 }}>
                {uiCopy.modelRoster.incompleteModelsBanner(incompleteCount)}
              </Text>
              <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary }}>
                {uiCopy.modelRoster.incompleteModelsBannerSuffix}
              </Text>
            </View>
          </View>
        );
      })()}

      {filtered.map((m) => {
        const isChecked = selectedModelIds.has(m.id);
        return (
          <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity
              style={{ padding: spacing.sm, paddingRight: 0 }}
              onPress={() =>
                setSelectedModelIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(m.id)) next.delete(m.id);
                  else next.add(m.id);
                  return next;
                })
              }
            >
              <View style={{
                width: 20, height: 20, borderRadius: 4,
                borderWidth: 1.5,
                borderColor: isChecked ? colors.textPrimary : colors.border,
                backgroundColor: isChecked ? colors.textPrimary : 'transparent',
                alignItems: 'center', justifyContent: 'center',
              }}>
                {isChecked && <Text style={{ color: colors.surface, fontSize: 12, lineHeight: 16 }}>✓</Text>}
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={[s.modelRow, { flex: 1, marginLeft: spacing.xs }]} onPress={() => setSelectedModel(m)}>
              {(m.portfolio_images ?? [])[0] ? (
                <StorageImage
                  uri={(m.portfolio_images ?? [])[0]}
                  style={{ width: 44, height: 44, borderRadius: 6, marginRight: spacing.sm, backgroundColor: colors.border }}
                  resizeMode="cover"
                />
              ) : (
                <View style={{ width: 44, height: 44, borderRadius: 6, marginRight: spacing.sm, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 18, color: colors.textSecondary }}>◻</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.modelName}>{m.name}</Text>
                <Text style={s.metaText}>{m.city ?? '—'} · H{m.height} C{m.bust ?? (m as any).chest ?? '—'} W{m.waist ?? '—'} H{m.hips ?? '—'}</Text>
                {(rosterTerritoriesMap[m.id] ?? []).length > 0 ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginTop: 3 }}>
                    {(rosterTerritoriesMap[m.id] ?? []).slice(0, 6).map((code) => (
                      <View
                        key={code}
                        style={{
                          paddingHorizontal: 4,
                          paddingVertical: 1,
                          borderRadius: 3,
                          borderWidth: 1,
                          borderColor: colors.accentGreen ?? '#2e7d32',
                          backgroundColor: 'transparent',
                        }}
                      >
                        <Text style={{ ...typography.label, fontSize: 8, color: colors.accentGreen ?? '#2e7d32', letterSpacing: 0.3 }}>
                          {code}
                        </Text>
                      </View>
                    ))}
                    {(rosterTerritoriesMap[m.id] ?? []).length > 6 && (
                      <View style={{ paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, borderWidth: 1, borderColor: colors.border }}>
                        <Text style={{ ...typography.label, fontSize: 8, color: colors.textSecondary }}>
                          +{(rosterTerritoriesMap[m.id] ?? []).length - 6}
                        </Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', marginTop: 3,
                    paddingHorizontal: 5, paddingVertical: 1,
                    borderRadius: 3, borderWidth: 1,
                    borderColor: '#B8860B',
                    backgroundColor: 'rgba(184,134,11,0.08)',
                    alignSelf: 'flex-start',
                  }}>
                    <Text style={{ ...typography.label, fontSize: 8, color: '#B8860B', letterSpacing: 0.3 }}>
                      {uiCopy.modelRoster.territoriesMissingBadge}
                    </Text>
                  </View>
                )}
                {(m.portfolio_images ?? []).length === 0 && (
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', marginTop: 3,
                    paddingHorizontal: 5, paddingVertical: 1,
                    borderRadius: 3, borderWidth: 1,
                    borderColor: '#c0392b',
                    backgroundColor: 'rgba(192,57,43,0.07)',
                    alignSelf: 'flex-start',
                  }}>
                    <Text style={{ ...typography.label, fontSize: 8, color: '#c0392b', letterSpacing: 0.3 }}>
                      {uiCopy.modelRoster.photosMissingBadge}
                    </Text>
                  </View>
                )}
                {(m.agency_relationship_status === 'pending_link' || (!m.user_id && m.email)) && (
                  <Text style={{ ...typography.label, fontSize: 9, color: '#B8860B', marginTop: 2 }}>Pending app account link</Text>
                )}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, maxWidth: 80 }}>
                {(m.categories ?? []).length === 0 ? (
                  <View style={[s.visTag, { borderColor: colors.border }]}>
                    <Text style={[s.visTagLabel, { color: colors.textSecondary }]}>All</Text>
                  </View>
                ) : (
                  (m.categories ?? []).map((cat: string) => {
                    const isFashion = cat === 'Fashion' || cat === 'High Fashion';
                    return (
                      <View key={cat} style={[s.visTag, { borderColor: isFashion ? colors.accentBrown : colors.border }]}>
                        <Text style={[s.visTagLabel, { color: isFashion ? colors.accentBrown : colors.textSecondary }]}>
                          {cat === 'High Fashion' ? 'HF' : cat.charAt(0)}
                        </Text>
                      </View>
                    );
                  })
                )}
              </View>
              <Text style={{ fontSize: 14, color: colors.textSecondary, marginLeft: spacing.sm }}>›</Text>
            </TouchableOpacity>
          </View>
        );
      })}
      {filtered.length === 0 && <Text style={s.metaText}>No models found.</Text>}
      {bulkFeedback && (
        <Text style={{ ...typography.label, fontSize: 12, color: colors.accentGreen, marginTop: spacing.sm }}>
          {bulkFeedback}
        </Text>
      )}

      {/* Bulk action sticky footer */}
      {selectedModelIds.size > 0 && (
        <View style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          backgroundColor: colors.surface,
          borderTopWidth: 1, borderTopColor: colors.border,
          flexDirection: 'row', alignItems: 'center',
          padding: spacing.md, gap: spacing.sm,
        }}>
          <Text style={{ ...typography.label, fontSize: 12, color: colors.textPrimary, flex: 1 }}>
            {uiCopy.bulkActions.selectedCount.replace('{count}', String(selectedModelIds.size))}
          </Text>
          <TouchableOpacity
            style={{
              backgroundColor: colors.textPrimary,
              borderRadius: 999,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
            }}
            onPress={() => {
              setBulkSelectedCountries([]);
              setBulkTerritorySearch('');
              setShowBulkTerritoryModal(true);
            }}
          >
            <Text style={{ ...typography.label, fontSize: 12, color: colors.surface }}>
              {uiCopy.bulkActions.assignTerritories}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{
              backgroundColor: colors.accentBrown,
              borderRadius: 999,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
            }}
            onPress={() => {
              setBulkLocationCountry('');
              setBulkLocationCity('');
              setBulkLocationCountrySearch('');
              setBulkLocationCountryDropdownOpen(false);
              setShowBulkLocationModal(true);
            }}
          >
            <Text style={{ ...typography.label, fontSize: 12, color: colors.surface }}>
              {uiCopy.bulkActions.setLocation}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bulk territory assignment modal */}
      <Modal
        visible={showBulkTerritoryModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowBulkTerritoryModal(false)}
      >
        <View style={{
          flex: 1, backgroundColor: 'rgba(0,0,0,0.25)',
          justifyContent: 'center', alignItems: 'center', padding: spacing.lg,
        }}>
          <View style={{
            width: '100%', maxWidth: 480,
            backgroundColor: colors.surface,
            borderRadius: 18, borderWidth: 1, borderColor: colors.border,
            padding: spacing.md, maxHeight: '90%',
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
              <Text style={{ ...typography.heading, fontSize: 15, color: colors.textPrimary, flex: 1 }}>
                {uiCopy.territoryModal.title}
              </Text>
              <TouchableOpacity onPress={() => setShowBulkTerritoryModal(false)}>
                <Text style={{ ...typography.label, fontSize: 11, color: colors.textSecondary }}>
                  {uiCopy.common.cancel}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={{ ...typography.body, fontSize: 12, color: colors.textSecondary, marginBottom: 2 }}>
              {uiCopy.bulkActions.selectedCount.replace('{count}', String(selectedModelIds.size))}
            </Text>
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              marginBottom: spacing.sm,
              backgroundColor: 'rgba(46,125,50,0.08)',
              borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
            }}>
              <Text style={{ ...typography.label, fontSize: 9, color: colors.accentGreen ?? '#2e7d32' }}>
                + ADDITIVE
              </Text>
              <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, flex: 1 }}>
                {uiCopy.territoryModal.bulkAdditiveNote}
              </Text>
            </View>

            <TextInput
              value={bulkTerritorySearch}
              onChangeText={setBulkTerritorySearch}
              placeholder={uiCopy.territoryModal.searchPlaceholder}
              placeholderTextColor={colors.textSecondary}
              style={{
                borderWidth: 1, borderColor: colors.border, borderRadius: 999,
                paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
                ...typography.body, fontSize: 12, color: colors.textPrimary,
                marginBottom: spacing.sm,
              }}
            />

            {bulkSelectedCountries.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: spacing.sm }}>
                {bulkSelectedCountries.map((code) => (
                  <TouchableOpacity
                    key={code}
                    style={{
                      paddingHorizontal: spacing.sm, paddingVertical: 2,
                      borderRadius: 999, backgroundColor: colors.textPrimary,
                    }}
                    onPress={() => setBulkSelectedCountries((prev) => prev.filter((c) => c !== code))}
                  >
                    <Text style={{ ...typography.label, fontSize: 10, color: colors.surface }}>
                      {ISO_COUNTRY_NAMES[code] ?? code} ✕
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <ScrollView style={{ maxHeight: 220 }}>
              {bulkFilteredCountries.map((c) => {
                const active = bulkSelectedCountries.includes(c.code);
                return (
                  <TouchableOpacity
                    key={c.code}
                    style={{
                      paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
                      borderRadius: 8, marginBottom: 2,
                      backgroundColor: active ? colors.textPrimary : 'transparent',
                    }}
                    onPress={() =>
                      setBulkSelectedCountries((prev) =>
                        active ? prev.filter((x) => x !== c.code) : [...prev, c.code],
                      )
                    }
                  >
                    <Text style={{ ...typography.label, fontSize: 11, color: active ? colors.surface : colors.textSecondary }}>
                      {c.name} ({c.code})
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {bulkSelectedCountries.length === 0 && (
              <Text style={{ ...typography.label, fontSize: 11, color: colors.buttonSkipRed, marginTop: spacing.sm }}>
                {uiCopy.territoryModal.requiredHint}
              </Text>
            )}

            <TouchableOpacity
              style={{
                marginTop: spacing.md,
                backgroundColor: colors.textPrimary,
                borderRadius: 999,
                paddingVertical: spacing.sm,
                alignItems: 'center',
                opacity: bulkSelectedCountries.length === 0 || bulkAssigning ? 0.4 : 1,
              }}
              onPress={handleBulkAssignTerritories}
              disabled={bulkSelectedCountries.length === 0 || bulkAssigning}
            >
              <Text style={{ ...typography.label, color: colors.surface }}>
                {bulkAssigning ? 'Assigning…' : uiCopy.territoryModal.confirmBulkButton}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Bulk location modal */}
      <Modal
        visible={showBulkLocationModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowBulkLocationModal(false)}
      >
        <View style={{
          flex: 1, backgroundColor: 'rgba(0,0,0,0.25)',
          justifyContent: 'center', alignItems: 'center', padding: spacing.lg,
        }}>
          <View style={{
            width: '100%', maxWidth: 480,
            backgroundColor: colors.surface,
            borderRadius: 18, borderWidth: 1, borderColor: colors.border,
            padding: spacing.md, maxHeight: '90%',
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
              <Text style={{ ...typography.heading, fontSize: 15, color: colors.textPrimary, flex: 1 }}>
                {uiCopy.locationModal.title}
              </Text>
              <TouchableOpacity onPress={() => setShowBulkLocationModal(false)}>
                <Text style={{ ...typography.label, fontSize: 11, color: colors.textSecondary }}>
                  {uiCopy.common.cancel}
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={{ ...typography.body, fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm }}>
              {uiCopy.bulkActions.selectedCount.replace('{count}', String(selectedModelIds.size))} — {uiCopy.locationModal.subtitle}
            </Text>

            {/* Country */}
            <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary, marginBottom: 4 }}>
              {uiCopy.locationModal.countryLabel}
            </Text>
            {bulkLocationCountry ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm }}>
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  backgroundColor: colors.textPrimary, borderRadius: 999,
                  paddingHorizontal: spacing.sm, paddingVertical: 3,
                }}>
                  <Text style={{ ...typography.label, fontSize: 11, color: colors.surface }}>
                    {selectedLocationCountryLabel}
                  </Text>
                  <TouchableOpacity onPress={() => setBulkLocationCountry('')}>
                    <Text style={{ ...typography.label, fontSize: 13, color: colors.surface, lineHeight: 14 }}>×</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={{ marginBottom: spacing.sm }}>
                <TextInput
                  value={bulkLocationCountrySearch}
                  onChangeText={(v) => {
                    setBulkLocationCountrySearch(v);
                    setBulkLocationCountryDropdownOpen(true);
                  }}
                  onFocus={() => setBulkLocationCountryDropdownOpen(true)}
                  placeholder={uiCopy.locationModal.countryPlaceholder}
                  placeholderTextColor={colors.textSecondary}
                  style={{
                    borderWidth: 1, borderColor: colors.border, borderRadius: 999,
                    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
                    ...typography.body, fontSize: 12, color: colors.textPrimary,
                  }}
                />
                {bulkLocationCountryDropdownOpen && bulkLocationFilteredCountries.length > 0 && (
                  <View style={{
                    marginTop: 4, borderWidth: 1, borderColor: colors.border,
                    borderRadius: 8, backgroundColor: colors.surface, maxHeight: 180,
                    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 6,
                    shadowOffset: { width: 0, height: 2 }, elevation: 8, overflow: 'hidden',
                  }}>
                    <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled showsVerticalScrollIndicator>
                      {bulkLocationFilteredCountries.map((c) => (
                        <TouchableOpacity
                          key={c.code}
                          style={{ paddingHorizontal: spacing.md, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border }}
                          onPress={() => {
                            setBulkLocationCountry(c.code);
                            setBulkLocationCountrySearch('');
                            setBulkLocationCountryDropdownOpen(false);
                          }}
                        >
                          <Text style={{ ...typography.body, fontSize: 12, color: colors.textPrimary }}>
                            {c.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>
            )}

            {/* City */}
            <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary, marginBottom: 4 }}>
              {uiCopy.locationModal.cityLabel}
            </Text>
            <TextInput
              value={bulkLocationCity}
              onChangeText={setBulkLocationCity}
              placeholder={uiCopy.locationModal.cityPlaceholder}
              placeholderTextColor={colors.textSecondary}
              style={{
                borderWidth: 1, borderColor: colors.border, borderRadius: 8,
                paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
                ...typography.body, fontSize: 12, color: colors.textPrimary,
                marginBottom: spacing.md,
              }}
            />

            {!bulkLocationCountry && (
              <Text style={{ ...typography.label, fontSize: 11, color: colors.buttonSkipRed, marginBottom: spacing.sm }}>
                Country is required.
              </Text>
            )}

            <TouchableOpacity
              style={{
                backgroundColor: colors.textPrimary,
                borderRadius: 999,
                paddingVertical: spacing.sm,
                alignItems: 'center',
                opacity: !bulkLocationCountry || bulkLocationAssigning ? 0.4 : 1,
              }}
              onPress={handleBulkSetLocation}
              disabled={!bulkLocationCountry || bulkLocationAssigning}
            >
              <Text style={{ ...typography.label, color: colors.surface }}>
                {bulkLocationAssigning ? uiCopy.common.saving : uiCopy.locationModal.confirm}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
      return () => { cancelled = true; };
    }
    if (search.trim().length > 0 && search.trim().length < 2) {
      setRows([]);
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    const t = setTimeout(() => {
      void listClientOrganizationsForAgencyDirectory(agencyId, search)
        .then((list) => {
          if (!cancelled) setRows(list);
        })
        .catch((e) => {
          console.error('AgencyClientsTab load error:', e);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
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
  agencyName: string | null;
  agencyOrganizationId: string | null;
  agencyModels: SupabaseModel[];
  currentUserId: string | null;
  pendingOpenB2BChat: { conversationId: string; title: string } | null;
  onPendingB2BChatConsumed: () => void;
  onBookingCardPress?: () => void;
  /** Deep-link from GlobalSearch: auto-select this option request thread. */
  pendingOptionRequestId?: string | null;
  onPendingOptionRequestConsumed?: () => void;
};

const AgencyMessagesTab: React.FC<AgencyMessagesTabProps> = ({
  recruitingThreads,
  onRefreshRecruitingThreads,
  onOpenRecruitingThread,
  agencyId,
  agencyName,
  agencyOrganizationId: agencyOrganizationIdProp,
  agencyModels,
  currentUserId,
  pendingOpenB2BChat,
  onPendingB2BChatConsumed,
  onBookingCardPress,
  pendingOptionRequestId,
  onPendingOptionRequestConsumed,
}) => {
  const [messagesSection, setMessagesSection] = useState<'optionRequests' | 'recruiting' | 'clientRequests'>('clientRequests');
  const [messagesSearch, setMessagesSearch] = useState('');
  const [modelDirectConvs, setModelDirectConvs] = useState<Conversation[]>([]);
  const [searchChatBusy, setSearchChatBusy] = useState<string | null>(null);
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
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
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

  const refreshModelDirectConvs = useCallback(() => {
    const orgId = agencyOrgIdB2b ?? agencyOrganizationIdProp;
    if (!orgId) return;
    void listAgencyModelDirectConversations(orgId).then(setModelDirectConvs);
  }, [agencyOrgIdB2b, agencyOrganizationIdProp]);

  useEffect(() => {
    refreshModelDirectConvs();
  }, [refreshModelDirectConvs]);

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

  // Auto-select option request from GlobalSearch deep-link.
  useEffect(() => {
    if (!pendingOptionRequestId) return;
    setMessagesSection('optionRequests');
    setSelectedThreadId(pendingOptionRequestId);
    onPendingOptionRequestConsumed?.();
  }, [pendingOptionRequestId]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const _agencyCounterPrice = request?.agencyCounterPrice;
  const currency = request?.currency ?? 'EUR';

  const sendMessage = () => {
    const text = chatInput.trim();
    if (!text || !selectedThreadId) return;
    addMessage(selectedThreadId, 'agency', text);
    setChatInput('');
  };

  const searchActive = messagesSearch.trim().length > 0;
  const searchQ = messagesSearch.trim().toLowerCase();

  const searchedB2b = useMemo(
    () => b2bConversations.filter((c) => (b2bTitles[c.id] ?? '').toLowerCase().includes(searchQ)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [b2bConversations, b2bTitles, messagesSearch],
  );
  const searchedRecruiting = useMemo(
    () => recruitingThreads.filter((t) => (t.modelName ?? '').toLowerCase().includes(searchQ)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recruitingThreads, messagesSearch],
  );
  const searchedOptionRequests = useMemo(
    () => requests.filter((r) =>
      (r.modelName ?? '').toLowerCase().includes(searchQ) ||
      (r.clientName ?? '').toLowerCase().includes(searchQ),
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requests, messagesSearch],
  );
  const searchedModels = useMemo(
    () => agencyModels.filter((m) => (m.name ?? '').toLowerCase().includes(searchQ)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agencyModels, messagesSearch],
  );

  const getModelDirectConvId = (modelId: string): string | undefined =>
    modelDirectConvs.find((c) => c.context_id === `agency-model:${agencyId}:${modelId}`)?.id;

  const handleStartModelChat = async (model: SupabaseModel) => {
    if (!agencyId || !currentUserId) return;
    const orgId = agencyOrgIdB2b ?? agencyOrganizationIdProp;
    if (!orgId) {
      Alert.alert(uiCopy.common.error, uiCopy.messages.modelDirectChatFailed);
      return;
    }
    setSearchChatBusy(model.id);
    try {
      const result = await ensureAgencyModelDirectChat({
        agencyId,
        agencyOrganizationId: orgId,
        modelId: model.id,
        modelUserId: model.user_id ?? null,
        actingUserId: currentUserId,
        modelName: model.name,
        agencyName: agencyName ?? agencyId,
      });
      if (!result.ok) {
        Alert.alert(uiCopy.common.error, uiCopy.messages.modelDirectChatFailed);
        return;
      }
      refreshModelDirectConvs();
      setMessagesSearch('');
      setMessagesSection('clientRequests');
      setActiveConnectionChatId(result.conversationId);
      setActiveConnectionChatTitle(model.name);
    } finally {
      setSearchChatBusy(null);
    }
  };

  return (
    <ScreenScrollView>
      <Text style={s.sectionLabel}>Messages</Text>
      <Text style={[s.metaText, { marginBottom: spacing.sm }]}>{uiCopy.b2bChat.messagesIntroAgency}</Text>

      <View style={[s.messagesSearchRow, { marginBottom: spacing.sm }]}>
        <TextInput
          value={messagesSearch}
          onChangeText={setMessagesSearch}
          placeholder={uiCopy.messages.searchPlaceholder}
          placeholderTextColor={colors.textSecondary}
          style={s.messagesSearchBar}
          clearButtonMode="while-editing"
          multiline={false}
          numberOfLines={1}
          returnKeyType="search"
        />
        {messagesSearch.length > 0 && (
          <TouchableOpacity
            onPress={() => setMessagesSearch('')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={s.messagesSearchClear}
          >
            <Text style={s.messagesSearchClearText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {searchActive ? (
        <View>
          {/* Client chats */}
          {searchedB2b.length > 0 && (
            <View style={{ marginBottom: spacing.md }}>
              <Text style={[s.metaText, { fontWeight: '600', marginBottom: spacing.xs }]}>{uiCopy.messages.searchSectionClientChats}</Text>
              {searchedB2b.map((c) => (
                <View key={c.id} style={[s.modelRow, { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }]}>
                  <Text style={[s.modelName, { flex: 1 }]}>{b2bTitles[c.id] ?? uiCopy.b2bChat.chatPartnerFallback}</Text>
                  <TouchableOpacity
                    style={[s.filterPill, s.filterPillActive]}
                    onPress={() => {
                      setMessagesSearch('');
                      setMessagesSection('clientRequests');
                      setActiveConnectionChatId(c.id);
                      setActiveConnectionChatTitle(b2bTitles[c.id] ?? uiCopy.b2bChat.chatPartnerFallback);
                    }}
                  >
                    <Text style={[s.filterPillLabel, s.filterPillLabelActive]}>{uiCopy.messages.openChat}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* Recruiting chats */}
          {searchedRecruiting.length > 0 && (
            <View style={{ marginBottom: spacing.md }}>
              <Text style={[s.metaText, { fontWeight: '600', marginBottom: spacing.xs }]}>{uiCopy.messages.searchSectionRecruiting}</Text>
              {searchedRecruiting.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={s.modelRow}
                  onPress={() => {
                    setMessagesSearch('');
                    onOpenRecruitingThread(t.id);
                  }}
                >
                  <Text style={s.modelName}>{t.modelName}</Text>
                  <Text style={s.backLabel}>Chat</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Option requests */}
          {searchedOptionRequests.length > 0 && (
            <View style={{ marginBottom: spacing.md }}>
              <Text style={[s.metaText, { fontWeight: '600', marginBottom: spacing.xs }]}>{uiCopy.messages.searchSectionOptionRequests}</Text>
              {searchedOptionRequests.map((r) => (
                <TouchableOpacity
                  key={r.threadId}
                  style={s.modelRow}
                  onPress={() => {
                    setMessagesSearch('');
                    setMessagesSection('optionRequests');
                    setSelectedThreadId(r.threadId);
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.modelName}>{r.modelName} · {r.date}</Text>
                    <Text style={s.metaText}>{r.clientName}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Models — start new or open existing */}
          {searchedModels.length > 0 && (
            <View style={{ marginBottom: spacing.md }}>
              <Text style={[s.metaText, { fontWeight: '600', marginBottom: spacing.xs }]}>{uiCopy.messages.searchSectionModels}</Text>
              {searchedModels.map((m) => {
                const existingConvId = getModelDirectConvId(m.id);
                const hasAccount = !!m.user_id;
                const busy = searchChatBusy === m.id;
                return (
                  <View key={m.id} style={[s.modelRow, { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.modelName}>{m.name}</Text>
                      {!hasAccount && (
                        <Text style={[s.metaText, { color: colors.textSecondary }]}>{uiCopy.messages.modelNoAccount}</Text>
                      )}
                    </View>
                    {existingConvId ? (
                      <TouchableOpacity
                        style={[s.filterPill, s.filterPillActive]}
                        onPress={() => {
                          setMessagesSearch('');
                          setMessagesSection('clientRequests');
                          setActiveConnectionChatId(existingConvId);
                          setActiveConnectionChatTitle(m.name);
                        }}
                      >
                        <Text style={[s.filterPillLabel, s.filterPillLabelActive]}>{uiCopy.messages.openChat}</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[s.filterPill, (!hasAccount || busy) && { opacity: 0.5 }]}
                        disabled={!hasAccount || busy}
                        onPress={() => handleStartModelChat(m)}
                      >
                        <Text style={s.filterPillLabel}>{busy ? uiCopy.common.loading : uiCopy.messages.startChat}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {searchedB2b.length === 0 && searchedRecruiting.length === 0 &&
           searchedOptionRequests.length === 0 && searchedModels.length === 0 && (
            <Text style={s.metaText}>{uiCopy.messages.searchNoResults}</Text>
          )}
        </View>
      ) : (
        <>
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
                  onBookingCardPress={onBookingCardPress}
                  viewerRole="agency"
                  onBookingStatusUpdated={() => onBookingCardPress?.()}
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
                      <StorageImage uri={thumbUri} style={s.bookingChatThumb} resizeMode="contain" />
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
                style={[s.filterPill, { backgroundColor: colors.buttonOptionGreen, opacity: processingRequestId === request.threadId ? 0.5 : 1 }]}
                disabled={processingRequestId === request.threadId}
                onPress={async () => {
                  if (!request?.threadId || processingRequestId) return;
                  setProcessingRequestId(request.threadId);
                  try {
                    await agencyAcceptClientPriceStore(request.threadId);
                    setRequests(getOptionRequests());
                  } finally {
                    setProcessingRequestId(null);
                  }
                }}
              >
                <Text style={[s.filterPillLabel, { color: '#fff' }]}>Accept client price</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.filterPill, { borderWidth: 1, borderColor: colors.buttonSkipRed, opacity: processingRequestId === request.threadId ? 0.5 : 1 }]}
                disabled={processingRequestId === request.threadId}
                onPress={async () => {
                  if (!request?.threadId || processingRequestId) return;
                  setProcessingRequestId(request.threadId);
                  try {
                    await agencyRejectClientPriceStore(request.threadId);
                    setRequests(getOptionRequests());
                  } finally {
                    setProcessingRequestId(null);
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
                  style={[s.filterPill, { paddingHorizontal: spacing.sm, backgroundColor: colors.textPrimary, opacity: processingRequestId === request.threadId ? 0.5 : 1 }]}
                  disabled={processingRequestId === request.threadId}
                  onPress={async () => {
                    const num = parseFloat(agencyCounterInput.trim());
                    if (!request?.threadId || isNaN(num) || processingRequestId) return;
                    setProcessingRequestId(request.threadId);
                    try {
                      await agencyCounterOfferStore(request.threadId, num, currency);
                      setAgencyCounterInput('');
                      setRequests(getOptionRequests());
                    } finally {
                      setProcessingRequestId(null);
                    }
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
                style={[s.filterPill, { paddingHorizontal: spacing.sm, opacity: processingRequestId === request.threadId ? 0.5 : 1 }]}
                disabled={processingRequestId === request.threadId}
                onPress={async () => {
                  const num = parseFloat(agencyCounterInput.trim());
                  if (!request?.threadId || isNaN(num) || processingRequestId) return;
                  setProcessingRequestId(request.threadId);
                  try {
                    await agencyCounterOfferStore(request.threadId, num, currency);
                    setAgencyCounterInput('');
                    setRequests(getOptionRequests());
                  } finally {
                    setProcessingRequestId(null);
                  }
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
      </>
      )}
    </ScreenScrollView>
  );
};

const OrganizationTeamTab: React.FC<{
  organizationId: string | null;
  canInvite: boolean;
  members: Awaited<ReturnType<typeof listOrganizationMembers>>;
  invitations: InvitationRow[];
  onRefresh: () => void;
  currentUserId?: string | null;
  orgName?: string | null;
}> = ({ organizationId, canInvite, members, invitations, onRefresh, currentUserId, orgName }) => {
  const { profile, updateDisplayName } = useAuth();
  const [inviteEmail, setInviteEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState(profile?.display_name ?? '');
  const [nameBusy, setNameBusy] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);

  const handleRemoveMember = (targetUserId: string, displayName: string) => {
    if (!organizationId) return;
    Alert.alert(
      'Remove Member',
      `Remove ${displayName} from the organization? Their session will be invalidated immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemovingUserId(targetUserId);
            const result = await removeOrganizationMember(targetUserId, organizationId);
            setRemovingUserId(null);
            if (result.ok) {
              onRefresh();
              Alert.alert('Member Removed', 'The member has been removed and their session invalidated.');
            } else {
              Alert.alert(uiCopy.common.error, result.error ?? 'Failed to remove member.');
            }
          },
        },
      ],
    );
  };

  useEffect(() => {
    setNameInput(profile?.display_name ?? '');
  }, [profile?.display_name]);

  const handleInvite = async () => {
    if (!organizationId || !inviteEmail.trim()) return;
    setBusy(true);
    const row = await createOrganizationInvitation({
      organizationId,
      email: inviteEmail.trim(),
      role: 'booker',
    });
    if (row) {
      const link = buildOrganizationInviteUrl(row.token);
      setLastLink(link);

      // Send invitation email via Edge Function (fire and forget — link is fallback)
      let emailOk = false;
      try {
        const { data: { session: s } } = await supabase.auth.getSession();
        const res = await supabase.functions.invoke('send-invite', {
          body: {
            type: 'org_invitation',
            to: inviteEmail.trim(),
            token: row.token,
            organization_id: organizationId,
            orgName: orgName || undefined,
            inviterName: profile?.display_name || undefined,
          },
          headers: s?.access_token ? { Authorization: `Bearer ${s.access_token}` } : undefined,
        });
        emailOk = !res.error;
        if (res.error) console.error('OrganizationTeamTab send-invite error:', res.error);
      } catch (e) {
        console.error('OrganizationTeamTab send-invite exception:', e);
      }

      setInviteEmail('');
      onRefresh();
      Alert.alert(
        uiCopy.alerts.invitationCreated,
        emailOk ? uiCopy.alerts.invitationCreatedBody : uiCopy.alerts.invitationEmailFailed,
      );
    } else {
      Alert.alert(uiCopy.common.error, uiCopy.alerts.invitationFailed);
    }
    setBusy(false);
  };

  const handleSaveName = async () => {
    if (!nameInput.trim()) return;
    setNameBusy(true);
    const { error } = await updateDisplayName(nameInput);
    setNameBusy(false);
    if (error) {
      Alert.alert(uiCopy.common.error, uiCopy.team.ownerDisplayNameError);
    } else {
      Alert.alert(uiCopy.team.ownerDisplayNameLabel, uiCopy.team.ownerDisplayNameSaved);
      onRefresh();
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

      {canInvite && (
        <View style={{ marginTop: spacing.lg, gap: spacing.xs }}>
          <Text style={s.sectionLabel}>{uiCopy.team.ownerDisplayNameLabel}</Text>
          <Text style={s.metaText}>{uiCopy.team.ownerDisplayNameHint}</Text>
          <TextInput
            value={nameInput}
            onChangeText={setNameInput}
            placeholder={uiCopy.team.ownerDisplayNamePlaceholder}
            placeholderTextColor={colors.textSecondary}
            style={s.editInput}
          />
          <TouchableOpacity
            style={[s.saveBtn, (!nameInput.trim() || nameBusy) && { opacity: 0.55 }]}
            onPress={() => void handleSaveName()}
            disabled={nameBusy || !nameInput.trim()}
          >
            <Text style={s.saveBtnLabel}>{nameBusy ? '…' : uiCopy.team.ownerDisplayNameSave}</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        <Text style={s.sectionLabel}>{uiCopy.team.members}</Text>
        {members.length === 0 ? (
          <Text style={s.metaText}>No members loaded.</Text>
        ) : (
          members.map((m) => {
            const isSelf = m.user_id === currentUserId;
            const displayName = m.display_name || m.email || m.user_id.slice(0, 8);
            return (
              <View key={m.id} style={[s.modelRow, { alignItems: 'center' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.modelName}>
                    {displayName} · {roleLabel(m.role)}
                  </Text>
                  <Text style={s.metaText}>{m.email ?? '—'}</Text>
                </View>
                {canInvite && !isSelf && m.role !== 'owner' && (
                  <TouchableOpacity
                    onPress={() => handleRemoveMember(m.user_id, displayName)}
                    disabled={removingUserId === m.user_id}
                    style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#C0392B' }}
                  >
                    <Text style={{ ...typography.label, fontSize: 11, color: '#C0392B' }}>
                      {removingUserId === m.user_id ? '…' : 'Remove'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
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
                    {roleLabel(i.role)} · {uiCopy.team.inviteExpiresLabel} {new Date(i.expires_at).toLocaleDateString()}
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
  viewerUserId: string | null;
}> = ({ agencyId, agencyEmail, agencyName, models, viewerUserId }) => {
  const copy = uiCopy.guestLinks;

  // Package creation
  const [label, setLabel] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [packageType, setPackageType] = useState<'portfolio' | 'polaroid'>('portfolio');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [packageModelFilters, setPackageModelFilters] = useState<ModelFilters>(defaultModelFilters);
  const filteredPackageModels = useMemo(
    () => filterModels(models, packageModelFilters),
    [models, packageModelFilters],
  );

  // Package list
  const [links, setLinks] = useState<GuestLink[]>([]);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);

  // Send in App modal
  const [sendInAppTarget, setSendInAppTarget] = useState<GuestLink | null>(null);
  const [agencyOrgId, setAgencyOrgId] = useState<string | null>(null);
  const [b2bConversations, setB2bConversations] = useState<Conversation[]>([]);
  const [convTitles, setConvTitles] = useState<Record<string, string>>({});
  const [sendInAppStatus, setSendInAppStatus] = useState<'idle' | 'loading' | 'sending' | 'success' | 'error'>('idle');
  // Client discovery inside the modal
  const [sendSearch, setSendSearch] = useState('');
  const [searchRows, setSearchRows] = useState<ClientOrganizationDirectoryRow[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [startingChatForOrg, setStartingChatForOrg] = useState<string | null>(null);

  useEffect(() => {
    if (agencyId) void getGuestLinksForAgency(agencyId).then(setLinks);
  }, [agencyId]);

  // Debounced client-directory search – only runs while the send modal is open.
  useEffect(() => {
    if (!sendInAppTarget || !agencyId) { setSearchRows([]); return; }
    let cancelled = false;
    setSearchLoading(true);
    const t = setTimeout(() => {
      void listClientOrganizationsForAgencyDirectory(agencyId, sendSearch)
        .then((list) => { if (!cancelled) setSearchRows(list); })
        .finally(() => { if (!cancelled) setSearchLoading(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [sendSearch, agencyId, sendInAppTarget]);

  const toggleModel = (id: string) => {
    setSelectedModelIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const handleCreatePackage = async () => {
    if (!label.trim()) { setCreateError(copy.packageNameRequired); return; }
    if (selectedModelIds.size === 0) { setCreateError(copy.noModelsSelected); return; }
    setCreateError(null);
    setCreating(true);
    try {
      const defaultExpiryDays = 30;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + defaultExpiryDays);
      const link = await createGuestLink({
        agency_id: agencyId,
        model_ids: Array.from(selectedModelIds),
        agency_email: agencyEmail,
        agency_name: agencyName,
        label: label.trim(),
        type: packageType,
        expires_at: expiresAt.toISOString(),
      });
      if (link) {
        setLinks((prev) => [link, ...prev]);
        setLabel('');
        setSelectedModelIds(new Set());
        setPackageType('portfolio');
      } else {
        setCreateError(copy.createPackageError);
      }
    } catch (e) {
      console.error('handleCreatePackage error:', e);
      setCreateError(copy.createPackageError);
    } finally {
      setCreating(false);
    }
  };

  const handleCopyGuestLink = (link: GuestLink) => {
    const url = buildGuestUrl(link.id);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(url);
      setCopiedLinkId(link.id);
      setTimeout(() => setCopiedLinkId(null), 2000);
    }
  };

  const handleDeactivate = async (id: string) => {
    const ok = await revokeGuestAccess(id);
    if (ok) setLinks((prev) => prev.map((l) => l.id === id ? { ...l, is_active: false } : l));
  };

  const handleDeletePackage = (id: string) => {
    Alert.alert(
      copy.deleteConfirmTitle,
      copy.deleteConfirmMessage,
      [
        { text: copy.deleteConfirmCancel, style: 'cancel' },
        {
          text: copy.deleteConfirmOk,
          style: 'destructive',
          onPress: async () => {
            try {
              const ok = await deleteGuestLink(id);
              if (ok) {
                setLinks((prev) => prev.filter((l) => l.id !== id));
              }
            } catch (e) {
              console.error('handleDeletePackage error:', e);
            }
          },
        },
      ],
    );
  };

  const handleOpenSendInApp = async (link: GuestLink) => {
    setSendInAppTarget(link);
    setSendInAppStatus('loading');
    try {
      let oid = agencyOrgId;
      if (!oid) {
        oid = await ensureAgencyOrganization(agencyId);
        if (!oid) oid = await getOrganizationIdForAgency(agencyId);
        if (oid) setAgencyOrgId(oid);
      }
      if (!oid) { setSendInAppStatus('error'); return; }
      const convs = await listB2BConversationsForOrganization(oid);
      setB2bConversations(convs);
      const titles: Record<string, string> = {};
      await Promise.all(
        convs.map(async (c) => {
          const t = await getB2BConversationTitleForViewer({ conversation: c, viewerOrganizationId: oid! });
          titles[c.id] = t;
        }),
      );
      setConvTitles(titles);
      setSendInAppStatus('idle');
    } catch (e) {
      console.error('handleOpenSendInApp error:', e);
      setSendInAppStatus('error');
    }
  };

  const handleSendToConversation = async (conversationId: string) => {
    if (!sendInAppTarget || !viewerUserId) return;
    setSendInAppStatus('sending');
    try {
      const result = await sendMessage(
        conversationId,
        viewerUserId,
        uiCopy.b2bChat.sharedPackageBody,
        undefined,
        undefined,
        {
          messageType: 'package',
          metadata: {
            package_id: sendInAppTarget.id,
            guest_link: buildGuestUrl(sendInAppTarget.id),
            preview_model_ids: sendInAppTarget.model_ids.slice(0, 4),
            package_label: String(sendInAppTarget.model_ids.length),
            package_name: sendInAppTarget.label ?? null,
          },
        },
      );
      if (result) {
        setSendInAppStatus('success');
        setTimeout(() => { setSendInAppTarget(null); setSendInAppStatus('idle'); }, 1500);
      } else {
        setSendInAppStatus('error');
      }
    } catch (e) {
      console.error('handleSendToConversation error:', e);
      setSendInAppStatus('error');
    }
  };

  /**
   * Start a B2B chat with a client org (if none exists yet) and immediately
   * send the current package into that conversation.
   */
  const handleSendToNewClient = async (clientOrgId: string) => {
    if (!viewerUserId) {
      showAppAlert(uiCopy.alerts.signInRequired, uiCopy.b2bChat.signInToChatGeneric);
      return;
    }
    setStartingChatForOrg(clientOrgId);
    try {
      const r = await ensureClientAgencyChat({
        clientOrganizationId: clientOrgId,
        agencyId,
        actingUserId: viewerUserId,
      });
      if (!r.ok) {
        showAppAlert(uiCopy.b2bChat.chatFailedTitle, r.reason || uiCopy.b2bChat.chatFailedGeneric);
        return;
      }
      await handleSendToConversation(r.conversationId);
    } catch (e) {
      console.error('handleSendToNewClient error:', e);
      setSendInAppStatus('error');
    } finally {
      setStartingChatForOrg(null);
    }
  };

  return (
    <>
      <ScreenScrollView contentStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>

        {/* ── Create Package ─────────────────────────────────────────────── */}
        <Text style={s.sectionLabel}>{copy.createSection}</Text>

        <TextInput
          style={[s.editInput, { marginBottom: spacing.sm }]}
          placeholder={copy.packageNamePlaceholder}
          placeholderTextColor={colors.textSecondary}
          value={label}
          onChangeText={(t) => { setLabel(t); setCreateError(null); }}
        />

        <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.xs }}>
          {copy.selectModelsHint}
        </Text>

        {/* Attribute filters – same panel as My Models */}
        <ModelFiltersPanel
          filters={packageModelFilters}
          onChangeFilters={setPackageModelFilters}
        />

        {/* Model name search */}
        <TextInput
          style={[s.editInput, { marginBottom: spacing.sm, fontSize: 12 }]}
          placeholder="Search models…"
          placeholderTextColor={colors.textSecondary}
          value={modelSearch}
          onChangeText={setModelSearch}
        />

        {/* Selected count hint */}
        {selectedModelIds.size > 0 && (
          <Text style={{ ...typography.body, fontSize: 11, color: colors.buttonOptionGreen, marginBottom: spacing.xs }}>
            {selectedModelIds.size} model{selectedModelIds.size === 1 ? '' : 's'} selected
          </Text>
        )}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md }}>
          {filteredPackageModels
            .filter((m) =>
              modelSearch.trim() === '' ||
              m.name.toLowerCase().includes(modelSearch.trim().toLowerCase()),
            )
            .map((m) => (
              <TouchableOpacity
                key={m.id}
                style={[s.filterPill, selectedModelIds.has(m.id) && s.filterPillActive]}
                onPress={() => toggleModel(m.id)}
              >
                <Text style={[s.filterPillLabel, selectedModelIds.has(m.id) && s.filterPillLabelActive]}>{m.name}</Text>
              </TouchableOpacity>
            ))}
          {filteredPackageModels.filter((m) =>
            modelSearch.trim() === '' ||
            m.name.toLowerCase().includes(modelSearch.trim().toLowerCase()),
          ).length === 0 && (
            <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary }}>
              {modelSearch.trim() !== ''
                ? `No models found for "${modelSearch}"`
                : 'No models match the current filters.'}
            </Text>
          )}
        </View>

        {/* Package Type Selector */}
        <Text style={{ ...typography.label, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.xs }}>
          {copy.packageTypeLabel}
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs }}>
          <TouchableOpacity
            style={[s.filterPill, packageType === 'portfolio' && s.filterPillActive]}
            onPress={() => setPackageType('portfolio')}
          >
            <Text style={[s.filterPillLabel, packageType === 'portfolio' && s.filterPillLabelActive]}>
              {copy.packageTypePortfolio}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.filterPill, packageType === 'polaroid' && s.filterPillActive]}
            onPress={() => setPackageType('polaroid')}
          >
            <Text style={[s.filterPillLabel, packageType === 'polaroid' && s.filterPillLabelActive]}>
              {copy.packageTypePolaroid}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={{ ...typography.body, fontSize: 10, color: colors.textSecondary, marginBottom: spacing.sm }}>
          {packageType === 'polaroid' ? copy.packageTypePolaroidHint : copy.packageTypePortfolioHint}
        </Text>

        {createError !== null && (
          <Text style={{ ...typography.body, fontSize: 11, color: '#e74c3c', marginBottom: spacing.xs }}>{createError}</Text>
        )}

        <TouchableOpacity
          style={[s.saveBtn, (selectedModelIds.size === 0 || creating) && { opacity: 0.4 }]}
          onPress={handleCreatePackage}
          disabled={selectedModelIds.size === 0 || creating}
        >
          <Text style={s.saveBtnLabel}>{creating ? '…' : copy.createPackageButton}</Text>
        </TouchableOpacity>

        {/* ── My Packages ────────────────────────────────────────────────── */}
        {links.length > 0 ? (
          <>
            <Text style={[s.sectionLabel, { marginTop: spacing.xl }]}>{copy.packagesSection}</Text>
            {links.map((l) => (
              <View
                key={l.id}
                style={{
                  borderWidth: 1, borderColor: colors.border, borderRadius: 12,
                  padding: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.surface,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <Text style={{ ...typography.label, fontSize: 13, color: colors.textPrimary, flex: 1 }} numberOfLines={1}>
                    {l.label ?? 'Package'}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                    {/* Package type badge */}
                    <View style={{
                      borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2,
                      backgroundColor: l.type === 'polaroid' ? 'rgba(255,152,0,0.1)' : 'rgba(33,150,243,0.1)',
                      borderWidth: 1,
                      borderColor: l.type === 'polaroid' ? '#FF9800' : '#2196F3',
                    }}>
                      <Text style={{ ...typography.label, fontSize: 9, color: l.type === 'polaroid' ? '#FF9800' : '#2196F3' }}>
                        {l.type === 'polaroid' ? copy.packageTypePolaroid : copy.packageTypePortfolio}
                      </Text>
                    </View>
                    {/* Active / Inactive badge */}
                    <View style={[
                      { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
                      l.is_active
                        ? { backgroundColor: 'rgba(76,175,80,0.12)', borderWidth: 1, borderColor: colors.buttonOptionGreen }
                        : { backgroundColor: colors.border },
                    ]}>
                      <Text style={{ ...typography.label, fontSize: 9, color: l.is_active ? colors.buttonOptionGreen : colors.textSecondary }}>
                        {l.is_active ? copy.activeLabel : copy.inactiveLabel}
                      </Text>
                    </View>
                  </View>
                </View>

                <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm }}>
                  {copy.modelsCount(l.model_ids.length)} · {new Date(l.created_at).toLocaleDateString()}
                </Text>

                {l.is_active && (
                  <>
                    <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginBottom: 6 }}>
                      <TouchableOpacity
                        style={[s.filterPill, { borderColor: colors.textSecondary }]}
                        onPress={() => handleCopyGuestLink(l)}
                      >
                        <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary }}>
                          {copiedLinkId === l.id ? copy.copiedButton : copy.copyGuestLinkButton}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[s.filterPill, { borderColor: colors.buttonOptionGreen }]}
                        onPress={() => handleOpenSendInApp(l)}
                      >
                        <Text style={{ ...typography.label, fontSize: 10, color: colors.buttonOptionGreen }}>
                          {copy.sendInAppButton}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[s.filterPill, { borderColor: '#e74c3c' }]}
                        onPress={() => handleDeactivate(l.id)}
                      >
                        <Text style={{ ...typography.label, fontSize: 10, color: '#e74c3c' }}>{copy.deactivateButton}</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={{ flexDirection: 'row', gap: spacing.lg }}>
                      <Text style={{ ...typography.body, fontSize: 9, color: colors.textSecondary, flex: 1 }}>
                        {copy.guestLinkHint}
                      </Text>
                      <Text style={{ ...typography.body, fontSize: 9, color: colors.buttonOptionGreen, flex: 1 }}>
                        {copy.inAppHint}
                      </Text>
                    </View>
                  </>
                )}

                <TouchableOpacity
                  style={[s.filterPill, { borderColor: '#c0392b', marginTop: spacing.xs, alignSelf: 'flex-start' }]}
                  onPress={() => handleDeletePackage(l.id)}
                >
                  <Text style={{ ...typography.label, fontSize: 10, color: '#c0392b' }}>{copy.deleteButton}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        ) : (
          <Text style={{ ...typography.body, fontSize: 12, color: colors.textSecondary, marginTop: spacing.lg, textAlign: 'center' }}>
            {copy.noLinksYet}
          </Text>
        )}
      </ScreenScrollView>

      {/* ── Send in App Modal ──────────────────────────────────────────── */}
      {sendInAppTarget !== null && (
        <Modal transparent animationType="fade" visible>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
            <View style={{
              backgroundColor: colors.background,
              borderTopLeftRadius: 20, borderTopRightRadius: 20,
              padding: spacing.lg, maxHeight: '75%',
            }}>
              <Text style={{ ...typography.heading, fontSize: 16, color: colors.textPrimary, marginBottom: 4 }}>
                {copy.sendInAppModalTitle}
              </Text>
              <Text style={{ ...typography.body, fontSize: 12, color: colors.textSecondary, marginBottom: spacing.md }}>
                {sendInAppTarget.label
                  ? `"${sendInAppTarget.label}" — ${copy.sendInAppModalHint}`
                  : copy.sendInAppModalHint}
              </Text>

              {(sendInAppStatus === 'loading' || sendInAppStatus === 'sending') && (
                <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
                  <ActivityIndicator color={colors.accentGreen} />
                  <Text style={{ ...typography.body, fontSize: 12, color: colors.textSecondary, marginTop: spacing.xs }}>
                    {sendInAppStatus === 'loading' ? copy.sendInAppLoading : copy.sendInAppSending}
                  </Text>
                </View>
              )}

              {sendInAppStatus === 'success' && (
                <Text style={{ ...typography.label, fontSize: 14, color: colors.buttonOptionGreen, textAlign: 'center', paddingVertical: spacing.lg }}>
                  {copy.sendInAppSuccess}
                </Text>
              )}

              {sendInAppStatus === 'error' && (
                <Text style={{ ...typography.body, fontSize: 12, color: '#e74c3c', marginBottom: spacing.sm }}>
                  {copy.sendInAppError}
                </Text>
              )}

              {(sendInAppStatus === 'idle' || sendInAppStatus === 'error') && (
                <>
                  <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">

                    {/* ── Client search ─────────────────────────────────── */}
                    <TextInput
                      style={[s.editInput, { marginBottom: spacing.sm }]}
                      placeholder="Search clients..."
                      placeholderTextColor={colors.textSecondary}
                      value={sendSearch}
                      onChangeText={setSendSearch}
                      autoCorrect={false}
                    />

                    {searchLoading && (
                      <ActivityIndicator size="small" color={colors.accentGreen} style={{ marginBottom: spacing.sm }} />
                    )}

                    {!searchLoading && searchRows.length > 0 && (
                      <>
                        {searchRows.map((row) => {
                          const label = row.name?.trim() || uiCopy.b2bChat.chatPartnerFallback;
                          const isSending = startingChatForOrg === row.id;
                          return (
                            <TouchableOpacity
                              key={row.id}
                              style={{
                                paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
                                borderBottomWidth: 1, borderBottomColor: colors.border,
                                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                                opacity: isSending ? 0.5 : 1,
                              }}
                              onPress={() => { if (!isSending) void handleSendToNewClient(row.id); }}
                              disabled={isSending}
                            >
                              <Text style={{ ...typography.label, fontSize: 13, color: colors.textPrimary, flex: 1 }} numberOfLines={1}>
                                {label}
                              </Text>
                              {isSending
                                ? <ActivityIndicator size="small" color={colors.accentGreen} />
                                : <Text style={{ ...typography.label, fontSize: 11, color: colors.buttonOptionGreen }}>{copy.sendInAppButton} →</Text>
                              }
                            </TouchableOpacity>
                          );
                        })}
                      </>
                    )}

                    {!searchLoading && sendSearch.trim() !== '' && searchRows.length === 0 && (
                      <Text style={{ ...typography.body, fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm }}>
                        No clients found for "{sendSearch}"
                      </Text>
                    )}

                    {/* ── Recent chats ──────────────────────────────────── */}
                    {b2bConversations.length > 0 && (
                      <>
                        <Text style={[s.sectionLabel, { marginTop: spacing.md }]}>Recent chats</Text>
                        {b2bConversations.map((c) => (
                          <TouchableOpacity
                            key={c.id}
                            style={{
                              paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
                              borderBottomWidth: 1, borderBottomColor: colors.border,
                              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                            }}
                            onPress={() => handleSendToConversation(c.id)}
                          >
                            <Text style={{ ...typography.label, fontSize: 13, color: colors.textPrimary }} numberOfLines={1}>
                              {convTitles[c.id] ?? uiCopy.b2bChat.chatPartnerFallback}
                            </Text>
                            <Text style={{ ...typography.label, fontSize: 11, color: colors.buttonOptionGreen }}>
                              {copy.sendInAppButton} →
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </>
                    )}

                    {b2bConversations.length === 0 && sendSearch.trim() === '' && !searchLoading && (
                      <Text style={{ ...typography.body, fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm }}>
                        Search for a client above or start a chat in the Clients tab first.
                      </Text>
                    )}
                  </ScrollView>

                  <TouchableOpacity
                    style={[s.saveBtn, { marginTop: spacing.md, backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border }]}
                    onPress={() => { setSendInAppTarget(null); setSendInAppStatus('idle'); setSendSearch(''); setSearchRows([]); }}
                  >
                    <Text style={{ ...typography.label, color: colors.textPrimary }}>{copy.sendInAppCancelButton}</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </Modal>
      )}
    </>
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
  bottomBar: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
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
  /** Single-line search on Messages tab — never use flex:1 (RN Web expands to huge height). */
  messagesSearchRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    alignSelf: 'stretch' as const,
    width: '100%' as const,
    maxWidth: 400,
    height: 40,
    minHeight: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  messagesSearchBar: {
    flex: 1,
    height: 40,
    paddingVertical: 0,
    ...typography.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textPrimary,
    backgroundColor: 'transparent',
  },
  messagesSearchClear: {
    paddingLeft: spacing.xs,
  },
  messagesSearchClearText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
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

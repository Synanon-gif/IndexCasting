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
  useWindowDimensions,
} from 'react-native';
import countries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';
import { colors, spacing, typography } from '../theme/theme';
import {
  CHAT_MESSENGER_FLEX,
  CHAT_THREAD_LIST_FLEX,
  getThreadListMaxHeight,
  getThreadListMaxHeightSplit,
  shouldUseB2BWebSplit,
} from '../theme/chatLayout';
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
  purgeOptionThreadFromStore,
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
  buildModelClaimUrl,
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
import {
  uploadModelPhoto,
  upsertPhotosForModel,
  getPhotosForModel,
  rebuildPortfolioImagesFromModelPhotos,
  rebuildPolaroidsFromModelPhotos,
} from '../services/modelPhotosSupabase';
import { normalizeDocumentspicturesModelImageRef } from '../utils/normalizeModelPortfolioUrl';
import { confirmImageRights, guardImageUpload } from '../services/gdprComplianceSupabase';
import { ModelMediaSettingsPanel } from '../components/ModelMediaSettingsPanel';
import { OptionNegotiationChatShell } from '../components/optionNegotiation/OptionNegotiationChatShell';
import { OptionSystemInfoBlock } from '../components/optionNegotiation/OptionSystemInfoBlock';
import { shouldShowSystemMessageForViewer } from '../components/optionNegotiation/filterSystemMessagesForViewer';
import { getTerritoriesForModel, getTerritoriesForAgency, upsertTerritoriesForModel, bulkAddTerritoriesForModels } from '../services/territoriesSupabase';
import {
  upsertModelLocation,
  getModelLocation,
  locationSourceLabel,
  roundCoord,
  type ModelLocation,
} from '../services/modelLocationsSupabase';
import { describeSendInviteFailure, resendInviteEmail } from '../services/inviteDelivery';

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

/** Maps generate_model_claim_token errors to user-facing invite notes. */
function describeClaimTokenFailure(rawError: string): string {
  const msg = rawError.toLowerCase();
  if (msg.includes('already_linked')) {
    return 'This model is already linked to an app account — invite skipped.';
  }
  if (msg.includes('already_claimed')) {
    return 'This model has already been claimed — invite skipped.';
  }
  if (msg.includes('not_in_agency') || msg.includes('access_denied')) {
    return 'You cannot create a claim token for this model from the current agency context.';
  }
  return rawError || 'Could not generate claim token';
}

import { supabase } from '../../lib/supabase';
import {
  normalizeInput,
  MODEL_NAME_MAX_LENGTH,
  MODEL_CITY_MAX_LENGTH,
  MODEL_SHORT_TEXT_MAX_LENGTH,
  UI_DOUBLE_SUBMIT_DEBOUNCE_MS,
} from '../../lib/validation';
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
import {
  getClientAssignmentMapForAgency,
  upsertClientAssignmentFlag,
  type AssignmentFlagColor,
  type ClientAssignmentFlag,
} from '../services/clientAssignmentsSupabase';
import { getAgencies, type Agency } from '../services/agenciesSupabase';
import { createGuestLink, getGuestLinksForAgency, buildGuestUrl, revokeGuestAccess, deleteGuestLink, type GuestLink } from '../services/guestLinksSupabase';
import {
  getCalendarEntriesForAgency,
  getBookingEventsAsCalendarEntries,
  type CalendarEntry,
  type AgencyCalendarItem,
  type BookingDetails,
  updateBookingDetails,
  appendSharedBookingNote,
  type SharedBookingNote,
} from '../services/calendarSupabase';
import BookingBriefEditor from '../components/BookingBriefEditor';
import { deleteOptionRequestFull, updateOptionRequestSchedule } from '../services/optionRequestsSupabase';
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
import { AgencyOrgProfileScreen } from '../screens/AgencyOrgProfileScreen';
import { OrgProfileModal } from '../components/OrgProfileModal';
import { type ModelFilters, defaultModelFilters, filterModels } from '../utils/modelFilters';
import ModelFiltersPanel from '../components/ModelFiltersPanel';
import ModelEditDetailsPanel, { buildEditState, type ModelEditState } from '../components/ModelEditDetailsPanel';
import { importModelAndMerge } from '../services/modelCreationFacade';
import { runMediaslideCronSync } from '../services/mediaslideSyncService';
import { runNetwalkCronSync } from '../services/netwalkSyncService';
import { getAgencyApiKeys, saveAgencyApiConnection } from '../services/agencySettingsSupabase';
import { checkModelCompleteness, type CompletenessContext } from '../utils/modelCompleteness';
import { calendarEntryColor, OPTION_REQUEST_CHAT_STATUS_COLORS } from '../utils/calendarColors';
import {
  buildUnifiedAgencyCalendarRows,
  filterUnifiedAgencyCalendarRows,
  buildEventsByDateFromUnifiedRows,
  type AgencyCalendarTypeFilter,
  type AgencyCalendarAssigneeFilter,
  type AgencyCalendarClientScopeFilter,
  type AgencyCalendarUrgencyFilter,
  type UnifiedAgencyCalendarRow,
} from '../utils/agencyCalendarUnified';
import { DashboardSummaryBar } from '../components/DashboardSummaryBar';
import { OrgMetricsPanel } from '../components/OrgMetricsPanel';
import { OwnerBillingStatusCard } from '../components/OwnerBillingStatusCard';
import { GlobalSearchBar } from '../components/GlobalSearchBar';
import { getMyAgencyUsageLimits, type AgencyUsageLimits } from '../services/agencyUsageLimitsSupabase';
import { getAgencyOrganizationSeatLimit } from '../services/subscriptionSupabase';
import { getLatestActivityLog, type ActivityLog } from '../services/activityLogsSupabase';
import { uiCopy as _uiCopy } from '../constants/uiCopy';
import {
  deriveSmartAttentionState,
  smartAttentionVisibleForRole,
  type SmartAttentionState,
} from '../utils/optionRequestAttention';

const STATUS_LABELS: Record<ChatStatus, string> = {
  in_negotiation: _uiCopy.dashboard.optionRequestStatusInNegotiation,
  confirmed: _uiCopy.dashboard.optionRequestStatusConfirmed,
  rejected: _uiCopy.dashboard.optionRequestStatusRejected,
};

const STATUS_COLORS: Record<ChatStatus, string> = OPTION_REQUEST_CHAT_STATUS_COLORS;

function attentionLabelForAgency(state: SmartAttentionState): string {
  switch (state) {
    case 'waiting_for_agency': return _uiCopy.dashboard.smartAttentionWaitingForAgency;
    case 'counter_pending': return _uiCopy.dashboard.smartAttentionCounterPending;
    case 'waiting_for_model': return _uiCopy.dashboard.smartAttentionWaitingForModel;
    case 'conflict_risk': return _uiCopy.dashboard.smartAttentionConflictRisk;
    case 'waiting_for_client': return _uiCopy.dashboard.smartAttentionWaitingForClient;
    case 'job_confirmation_pending': return _uiCopy.dashboard.smartAttentionJobConfirmationPending;
    case 'no_attention':
    default: return _uiCopy.dashboard.smartAttentionNoAttention;
  }
}

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
  | 'settings'
  | 'profile';

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
  const [assignmentByClientOrgId, setAssignmentByClientOrgId] = useState<Record<string, ClientAssignmentFlag>>({});
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
  const lastAppendSharedNoteAtRef = useRef(0);
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
  /** Prevent repeated mirror-rebuild attempts for the same model id in one session. */
  const portfolioMirrorRebuildAttemptedRef = useRef<Set<string>>(new Set());
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

  const mapAgencyModelsToState = (data: any[]) =>
    data.map((m: any) => ({
      id: m.id,
      name: m.name,
      traction: m.traction ?? 0,
      isVisibleCommercial: m.isVisibleCommercial ?? false,
      isVisibleFashion: m.isVisibleFashion ?? false,
    }));

  /** Keeps Dashboard (`models`) and My Models (`fullModels`) in sync after import/save/remove. */
  const refreshAgencyModelLists = useCallback(async () => {
    if (!currentAgencyId) return;
    try {
      const [full, light] = await Promise.all([
        getModelsForAgencyFromSupabase(currentAgencyId),
        getAgencyModels(currentAgencyId),
      ]);
      setFullModels(full);
      setModels(mapAgencyModelsToState(light));

      const candidates = full
        .filter((m) =>
          (m.portfolio_images ?? []).length === 0 &&
          !portfolioMirrorRebuildAttemptedRef.current.has(m.id),
        )
        .map((m) => m.id);

      if (candidates.length > 0) {
        candidates.forEach((id) => portfolioMirrorRebuildAttemptedRef.current.add(id));
        const rebuilt = await Promise.all(
          candidates.flatMap((id) => [
            rebuildPortfolioImagesFromModelPhotos(id),
            rebuildPolaroidsFromModelPhotos(id),
          ]),
        );
        if (rebuilt.some(Boolean)) {
          const healedFull = await getModelsForAgencyFromSupabase(currentAgencyId);
          setFullModels(healedFull);
        }
      }
    } catch (e) {
      console.error('[AgencyControllerView] refreshAgencyModelLists', e);
    }
  }, [currentAgencyId]);

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
    void refreshAgencyModelLists();
    void loadOptionRequestsForAgency(currentAgencyId, agencyOrganizationId);
  }, [currentAgencyId, agencyOrganizationId, refreshAgencyModelLists]);

  useEffect(() => {
    if (tab !== 'messages' || !currentAgencyId) return;
    void loadOptionRequestsForAgency(currentAgencyId, agencyOrganizationId);
  }, [tab, currentAgencyId, agencyOrganizationId]);

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

  useEffect(() => {
    if (!agencyOrganizationId) {
      setAssignmentByClientOrgId({});
      return;
    }
    void getClientAssignmentMapForAgency(agencyOrganizationId).then(setAssignmentByClientOrgId);
  }, [agencyOrganizationId]);

  const handleUpsertClientAssignment = useCallback(async (
    clientOrganizationId: string,
    patch: { label: string; color: AssignmentFlagColor; assignedMemberUserId?: string | null },
  ): Promise<void> => {
    if (!agencyOrganizationId) return;
    const saved = await upsertClientAssignmentFlag({
      agencyOrganizationId,
      clientOrganizationId,
      label: patch.label,
      color: patch.color,
      assignedMemberUserId: patch.assignedMemberUserId ?? null,
    });
    if (!saved) return;
    setAssignmentByClientOrgId((prev) => ({ ...prev, [clientOrganizationId]: saved }));
  }, [agencyOrganizationId]);

  /** Re-load roster when opening My Models (e.g. after accepting an application in Recruiting). */
  useEffect(() => {
    if (tab === 'myModels' && currentAgencyId) void refreshAgencyModelLists();
  }, [tab, currentAgencyId, refreshAgencyModelLists]);

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
        { key: 'profile', label: 'Profile' },
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
          onRefresh={refreshAgencyModelLists}
          focusModelId={searchModelId}
          onFocusConsumed={() => setSearchModelId(null)}
        />
      )}

      {tab === 'clients' && currentAgencyId ? (
        <AgencyClientsTab
          agencyId={currentAgencyId}
          agencyOrganizationId={agencyOrganizationId}
          currentUserId={session?.user?.id ?? null}
          teamMembers={teamMembers}
          assignmentByClientOrgId={assignmentByClientOrgId}
          onUpsertClientAssignment={handleUpsertClientAssignment}
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
          assignmentByClientOrgId={assignmentByClientOrgId}
          onOptionRequestDeleted={() => { void loadAgencyCalendar(); }}
          bottomTabInset={bottomTabInset}
        />
      )}

      {tab === 'calendar' && (
        <AgencyCalendarTab
          items={calendarItems}
          assignmentByClientOrgId={assignmentByClientOrgId}
          manualEvents={manualCalendarEvents}
          bookingEventEntries={bookingEventEntries}
          teamMembers={teamMembers}
          currentUserId={session?.user?.id ?? null}
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
          <OwnerBillingStatusCard variant="agency" />
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
          <OwnerBillingStatusCard variant="agency" />
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

      {tab === 'profile' && (
        <AgencyOrgProfileScreen
          organizationId={agencyOrganizationId ?? null}
          agencyId={currentAgencyId ?? null}
          orgName={profile?.company_name ?? null}
          orgMemberRole={profile?.org_member_role ?? null}
        />
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
              <Text style={s.sectionLabel}>{uiCopy.calendar.bookingDetailsTitle}</Text>
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
                      void loadOptionRequestsForAgency(currentAgencyId, agencyOrganizationId);
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
            {selectedCalendarItem.calendar_entry?.option_request_id && currentAgencyId ? (
              <BookingBriefEditor
                role="agency"
                optionRequestId={selectedCalendarItem.option.id}
                bookingBriefRaw={
                  (selectedCalendarItem.calendar_entry.booking_details as BookingDetails | null)?.booking_brief
                }
                onAfterSave={async () => {
                  await loadAgencyCalendar();
                  const items = await getCalendarEntriesForAgency(currentAgencyId);
                  const next = items.find((x) => x.option.id === selectedCalendarItem.option.id);
                  if (next) setSelectedCalendarItem(next);
                }}
              />
            ) : null}
            {selectedCalendarItem.calendar_entry ? (
              <View style={{ marginBottom: spacing.md }}>
                <Text style={s.sectionLabel}>{uiCopy.calendar.sharedNotesTitle}</Text>
                <Text style={[s.metaText, { marginBottom: spacing.sm }]}>
                  {uiCopy.calendar.sharedNotesHelpAgency}
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
                  placeholder={uiCopy.calendar.sharedNotePlaceholder}
                  placeholderTextColor={colors.textSecondary}
                  style={[s.editInput, { minHeight: 72, textAlignVertical: 'top', borderRadius: 12 }]}
                />
                <TouchableOpacity
                  onPress={async () => {
                    if (!selectedCalendarItem || !agencySharedNoteDraft.trim() || !currentAgencyId) return;
                    const now = Date.now();
                    if (now - lastAppendSharedNoteAtRef.current < UI_DOUBLE_SUBMIT_DEBOUNCE_MS) return;
                    lastAppendSharedNoteAtRef.current = now;
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
                    {savingAgencySharedNote ? uiCopy.calendar.postingSharedNote : uiCopy.calendar.postSharedNote}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <Text style={s.sectionLabel}>{uiCopy.calendar.agencyNotesTitle}</Text>
            <TextInput
              value={agencyNotesDraft}
              onChangeText={setAgencyNotesDraft}
              multiline
              placeholder={uiCopy.calendar.agencyNotesPlaceholder}
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
                  {savingNotes ? uiCopy.calendar.savingNotes : uiCopy.calendar.saveNotes}
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
  assignmentByClientOrgId?: Record<string, ClientAssignmentFlag>;
  manualEvents: UserCalendarEvent[];
  bookingEventEntries?: CalendarEntry[];
  teamMembers: Array<{ user_id: string; display_name: string | null; email?: string | null }>;
  currentUserId: string | null;
  loading: boolean;
  onRefresh: () => void;
  onOpenDetails: (item: AgencyCalendarItem) => void;
  onOpenManualEvent: (ev: UserCalendarEvent) => void;
  onOpenBookingEntry?: (entry: CalendarEntry) => void;
  onAddEvent: () => void;
};

function renderAgencyCalendarOptionBadge(item: AgencyCalendarItem) {
  const { option, calendar_entry } = item;
  const entryType = calendar_entry?.entry_type;
  let kind: 'Option' | 'Job' | 'Casting' = 'Option';
  if (entryType === 'booking') kind = 'Job';
  if (entryType === 'casting' || entryType === 'gosee') kind = 'Casting';
  const isJobConfirmed = calendar_entry?.status === 'booked';

  let color = '#1565C0';
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
      <Text style={{ ...typography.label, fontSize: 10, color: '#fff' }}>{label}</Text>
    </View>
  );
}

function renderBookingEntryBadge(entry: CalendarEntry) {
  const t = entry.entry_type;
  const label = t === 'booking' ? 'Booking' : t === 'casting' || t === 'gosee' ? 'Casting' : 'Option';
  let bg = '#1565C0';
  if (t === 'booking') bg = colors.buttonSkipRed;
  else if (t === 'casting' || t === 'gosee') bg = colors.textSecondary;
  return (
    <View style={{ borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, backgroundColor: bg }}>
      <Text style={{ ...typography.label, fontSize: 10, color: '#fff' }}>{label}</Text>
    </View>
  );
}

const AgencyCalendarTab: React.FC<AgencyCalendarTabProps> = ({
  items,
  assignmentByClientOrgId = {},
  manualEvents,
  bookingEventEntries = [],
  teamMembers,
  currentUserId,
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
  const [typeFilter, setTypeFilter] = useState<AgencyCalendarTypeFilter>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<AgencyCalendarAssigneeFilter>('all');
  const [clientScope, setClientScope] = useState<AgencyCalendarClientScopeFilter>('all');
  const [urgency, setUrgency] = useState<AgencyCalendarUrgencyFilter>('all');
  const now = new Date();
  const [calendarMonth, setCalendarMonth] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const itemByOptionId = useMemo(() => {
    const m = new Map<string, AgencyCalendarItem>();
    for (const i of items) m.set(i.option.id, i);
    return m;
  }, [items]);

  const unifiedAll = useMemo(
    () =>
      buildUnifiedAgencyCalendarRows(
        items,
        bookingEventEntries,
        manualEvents,
        assignmentByClientOrgId,
        itemByOptionId,
      ),
    [items, bookingEventEntries, manualEvents, assignmentByClientOrgId, itemByOptionId],
  );

  const filteredUnified = useMemo(
    () =>
      filterUnifiedAgencyCalendarRows(unifiedAll, {
        modelQuery,
        fromDate,
        toDate,
        typeFilter,
        assigneeFilter,
        clientScope,
        urgency,
        currentUserId,
        assignmentByClientOrgId,
      }),
    [
      unifiedAll,
      modelQuery,
      fromDate,
      toDate,
      typeFilter,
      assigneeFilter,
      clientScope,
      urgency,
      currentUserId,
      assignmentByClientOrgId,
    ],
  );

  const eventsByDate = useMemo(
    () => buildEventsByDateFromUnifiedRows(filteredUnified),
    [filteredUnified],
  );

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const sortedUnified = useMemo(
    () =>
      [...filteredUnified]
        .filter((r) => r.date >= today)
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey)),
    [filteredUnified, today],
  );

  const filterPill = (label: string, active: boolean, onPress: () => void) => (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: active ? colors.textPrimary : colors.border,
        backgroundColor: active ? colors.surface : 'transparent',
      }}
    >
      <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary }}>{label}</Text>
    </TouchableOpacity>
  );

  const openUnifiedRow = (row: UnifiedAgencyCalendarRow) => {
    if (row.kind === 'manual') {
      onOpenManualEvent(row.ev);
      return;
    }
    if (row.kind === 'option') {
      onOpenDetails(row.item);
      return;
    }
    if (onOpenBookingEntry) onOpenBookingEntry(row.entry);
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

      <Text style={[s.metaText, { marginBottom: spacing.xs }]}>Entry type</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        {filterPill('All', typeFilter === 'all', () => setTypeFilter('all'))}
        {filterPill('Option', typeFilter === 'option', () => setTypeFilter('option'))}
        {filterPill('Casting', typeFilter === 'casting', () => setTypeFilter('casting'))}
        {filterPill('Booking', typeFilter === 'booking', () => setTypeFilter('booking'))}
      </View>

      <Text style={[s.metaText, { marginBottom: spacing.xs }]}>Assignee</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        {filterPill('All', assigneeFilter === 'all', () => setAssigneeFilter('all'))}
        {filterPill('Unassigned', assigneeFilter === 'unassigned', () => setAssigneeFilter('unassigned'))}
        {filterPill('Mine', assigneeFilter === 'mine', () => setAssigneeFilter('mine'))}
        {teamMembers.map((m) => (
          <View key={m.user_id}>
            {filterPill(
              m.display_name || m.email || m.user_id.slice(0, 8),
              assigneeFilter === m.user_id,
              () => setAssigneeFilter(m.user_id),
            )}
          </View>
        ))}
      </View>

      <Text style={[s.metaText, { marginBottom: spacing.xs }]}>Client assignment (label)</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
        {filterPill('All clients', clientScope === 'all', () => setClientScope('all'))}
        {filterPill('My assigned clients', clientScope === 'mine', () => setClientScope('mine'))}
        {filterPill('Unassigned clients', clientScope === 'unassigned', () => setClientScope('unassigned'))}
      </View>

      <Text style={[s.metaText, { marginBottom: spacing.xs }]}>Attention</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md }}>
        {filterPill('All', urgency === 'all', () => setUrgency('all'))}
        {filterPill('Action needed', urgency === 'action', () => setUrgency('action'))}
        {filterPill('No action', urgency === 'clear', () => setUrgency('clear'))}
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
          <Text style={s.sectionLabel}>Day: {selectedDate}</Text>
          <TouchableOpacity style={[s.filterPill, { alignSelf: 'flex-start', marginTop: spacing.xs }]} onPress={onAddEvent}>
            <Text style={s.filterPillLabel}>+ Event on this day</Text>
          </TouchableOpacity>
          {(eventsByDate[selectedDate] ?? []).length === 0 ? (
            <Text style={s.metaText}>No entries on this day.</Text>
          ) : (
            (eventsByDate[selectedDate] ?? []).map((ev: CalendarDayEvent) => (
              <TouchableOpacity
                key={ev.id}
                style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, paddingVertical: 4 }}
                onPress={() => {
                  const row = filteredUnified.find((r) => r.id === ev.id);
                  if (row) openUnifiedRow(row);
                }}
              >
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ev.color, marginRight: spacing.sm }} />
                <Text style={s.metaText}>{ev.title}</Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      )}

      {sortedUnified.length === 0 && !loading && (
        <Text style={s.metaText}>No calendar entries yet.</Text>
      )}

      {sortedUnified.map((row) => {
        if (row.kind === 'manual') {
          const ev = row.ev;
          return (
            <TouchableOpacity key={row.id} style={s.modelRow} onPress={() => onOpenManualEvent(ev)}>
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
          );
        }
        if (row.kind === 'booking') {
          const be = row.entry;
          return (
            <TouchableOpacity key={row.id} style={s.modelRow} onPress={() => onOpenBookingEntry?.(be)}>
              <View style={{ flex: 1 }}>
                <Text style={s.modelName}>{row.title} · {be.date}</Text>
                <Text style={s.metaText}>{be.note ?? ''}</Text>
              </View>
              {renderBookingEntryBadge(be)}
            </TouchableOpacity>
          );
        }
        const item = row.item;
        const { option, calendar_entry } = item;
        const date = calendar_entry?.date ?? option.requested_date;
        const start = calendar_entry?.start_time ?? option.start_time ?? undefined;
        const end = calendar_entry?.end_time ?? option.end_time ?? undefined;
        return (
          <TouchableOpacity key={option.id} style={s.modelRow} onPress={() => onOpenDetails(item)}>
            <View style={{ flex: 1 }}>
              <Text style={s.modelName}>
                {option.model_name ?? 'Model'} · {date}
              </Text>
              <Text style={s.metaText}>
                {option.client_name ?? 'Client'}
                {start ? ` · ${start}${end ? `–${end}` : ''}` : ''}
              </Text>
              {option.client_organization_id && assignmentByClientOrgId[option.client_organization_id] ? (
                <Text style={s.metaText}>
                  {assignmentByClientOrgId[option.client_organization_id].label}
                  {assignmentByClientOrgId[option.client_organization_id].assignedMemberName
                    ? ` · ${assignmentByClientOrgId[option.client_organization_id].assignedMemberName}`
                    : ''}
                </Text>
              ) : null}
            </View>
            {renderAgencyCalendarOptionBadge(item)}
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
  const saveFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bulkFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const territorySaveFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Client-visible portfolio rows from model_photos — source of truth for completeness (not models.portfolio_images alone). */
  const [hasVisibleClientPortfolio, setHasVisibleClientPortfolio] = useState(false);

  const refreshClientVisiblePortfolio = useCallback(() => {
    if (!selectedModel?.id) {
      setHasVisibleClientPortfolio(false);
      return;
    }
    void getPhotosForModel(selectedModel.id, 'portfolio').then((rows) => {
      setHasVisibleClientPortfolio(
        rows.some((p) => Boolean(p.is_visible_to_clients ?? p.visible)),
      );
    });
  }, [selectedModel?.id]);

  useEffect(() => {
    refreshClientVisiblePortfolio();
  }, [refreshClientVisiblePortfolio]);

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
  // Depends on `models` so it retries when the roster loads after the ID is set.
  useEffect(() => {
    if (!focusModelId) return;
    const found = models.find((m) => m.id === focusModelId) ?? null;
    if (found) {
      setSelectedModel(found);
      onFocusConsumed?.();
    }
  }, [focusModelId, models]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [selectedModel?.id, selectedModel?.updated_at]);

  // RC-5: models prop is already fullModels (full SupabaseModel from MODEL_DETAIL_SELECT,
  // passed as fullModels from the parent). No risk of light-model degradation here.
  useEffect(() => {
    if (!selectedModel) return;
    const fresh = models.find((m) => m.id === selectedModel.id);
    if (fresh && fresh !== selectedModel) {
      setSelectedModel(fresh);
    }
  }, [models, selectedModel]);

  // Recalculate completeness whenever the selected model or its territories change.
  useEffect(() => {
    if (!selectedModel) {
      setCompletenessIssues([]);
      return;
    }
    const ctx: CompletenessContext = {
      hasTerritories: territoryCountryCodes.length > 0,
      hasVisiblePhoto: hasVisibleClientPortfolio,
    };
    setCompletenessIssues(checkModelCompleteness(selectedModel, ctx));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel?.id, territoryCountryCodes, hasVisibleClientPortfolio]);

  // Bulk selection state
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
  const [showBulkTerritoryModal, setShowBulkTerritoryModal] = useState(false);
  const [bulkTerritorySearch, setBulkTerritorySearch] = useState('');
  const [bulkSelectedCountries, setBulkSelectedCountries] = useState<string[]>([]);
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [bulkFeedback, setBulkFeedback] = useState<string | null>(null);
  const [resendingModelId, setResendingModelId] = useState<string | null>(null);
  const [resendModelCooldownUntil, setResendModelCooldownUntil] = useState<Record<string, number>>({});

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
    if (bulkFeedbackTimerRef.current) clearTimeout(bulkFeedbackTimerRef.current);
    bulkFeedbackTimerRef.current = setTimeout(() => setBulkFeedback(null), 3000);
  };

  const handleResendModelClaimInvite = async (model: SupabaseModel) => {
    const email = model.email?.trim();
    if (!email || model.user_id) return;
    const cooldownUntil = resendModelCooldownUntil[model.id] ?? 0;
    if (Date.now() < cooldownUntil) return;
    setResendingModelId(model.id);
    try {
      const nowIso = new Date().toISOString();
      const { data: tokenRow, error: tokenErr } = await supabase
        .from('model_claim_tokens')
        .select('token')
        .eq('model_id', model.id)
        .is('used_at', null)
        .gt('expires_at', nowIso)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (tokenErr) {
        console.error('handleResendModelClaimInvite token lookup error:', tokenErr);
        Alert.alert(uiCopy.common.error, `${uiCopy.inviteResend.error}: ${tokenErr.message}\n\n${uiCopy.inviteResend.checkSpamHint}`);
        return;
      }
      let token = (tokenRow as { token?: string } | null)?.token ?? null;
      // RC-6 fix: auto-regenerate token when all existing tokens have expired.
      if (!token) {
        const regen = await generateModelClaimToken(model.id, inviteOrganizationId ?? undefined);
        if (regen.ok) {
          token = regen.data.token;
        } else {
          Alert.alert(
            uiCopy.common.error,
            `${uiCopy.inviteResend.error}: Could not regenerate claim token. ${regen.error ?? ''}\n\n${uiCopy.inviteResend.checkSpamHint}`,
          );
          return;
        }
      }
      const resend = await resendInviteEmail({
        email,
        token,
        type: 'model_claim',
        organization_id: inviteOrganizationId ?? undefined,
        modelName: model.name || undefined,
        orgName: agencyName || undefined,
      });
      if (resend.ok) {
        Alert.alert(uiCopy.common.success, uiCopy.inviteResend.success);
      } else {
        Alert.alert(
          uiCopy.common.error,
          `${uiCopy.inviteResend.error}: ${resend.error}\n\n${uiCopy.modelRoster.modelInviteManualLinkNote} ${buildModelClaimUrl(token)}\n\n${uiCopy.inviteResend.checkSpamHint}`,
        );
      }
    } finally {
      setResendingModelId(null);
      setResendModelCooldownUntil((prev) => ({ ...prev, [model.id]: Date.now() + 4000 }));
    }
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
      showAppAlert(uiCopy.modelRoster.territoriesSaveFailedTitle, msg);
    } finally {
      setTerritorySaving(false);
      if (territorySaveFeedbackTimerRef.current) clearTimeout(territorySaveFeedbackTimerRef.current);
      territorySaveFeedbackTimerRef.current = setTimeout(() => setTerritorySaveFeedback(null), 3000);
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
        const relationshipStatus = emailTrim ? 'pending_link' : 'active';

        // Try claiming unowned model first (agency_id IS NULL).
        const { error: claimError } = await supabase.rpc('agency_claim_unowned_model', {
          p_model_id:                   mergeResult.model_id,
          p_agency_relationship_status: relationshipStatus,
          p_is_visible_fashion:         isVisibleFashion,
          p_is_visible_commercial:      isVisibleCommercial,
        });

        if (claimError) {
          // Model already has an agency_id (e.g. soft-removed with status='ended',
          // or same-agency model being re-imported). Re-activate via
          // agency_update_model_full which validates same-agency ownership.
          // Note: agency_relationship_ended_at cannot be cleared through the COALESCE
          // pattern — acceptable because status='active' controls roster visibility.
          const { error: reactivateErr } = await supabase.rpc('agency_update_model_full', {
            p_model_id:                   mergeResult.model_id,
            p_agency_relationship_status: relationshipStatus,
            p_is_visible_fashion:         isVisibleFashion,
            p_is_visible_commercial:      isVisibleCommercial,
          });
          if (reactivateErr) {
            console.error('handleAddModel: agency_update_model_full after merge failed:', reactivateErr);
            throw new Error(
              reactivateErr.message || 'Could not update merged model (relationship / visibility).',
            );
          }
        }
      } else {
        // Newly created: set relationship + sports flags not covered by importModelAndMerge insert.
        const { error: updateErr } = await supabase.rpc('agency_update_model_full', {
          p_model_id:                  mergeResult.model_id,
          p_agency_relationship_status: emailTrim ? 'pending_link' : 'active',
          p_is_visible_fashion:         isVisibleFashion,
          p_is_visible_commercial:      isVisibleCommercial,
          p_is_sports_winter:           addModelEditState.is_sports_winter,
          p_is_sports_summer:           addModelEditState.is_sports_summer,
        });
        if (updateErr) {
          console.error('handleAddModel: agency_update_model_full (create) failed:', updateErr);
          Alert.alert(
            uiCopy.common.error,
            `Model created but visibility/status flags could not be set. Please reopen and save again. (${updateErr.message})`,
          );
        }
      }

      const createdModelId = mergeResult.model_id;
      const modelDisplayName = name;

      // If the agency entered an email, generate a claim token and send an invite email.
      // Runs isolated — cannot block model creation or form reset.
      let emailSentOk = false;
      let inviteFailureReason = '';
      let claimTokenForManualLink: string | null = null;
      let inviteSkippedReason = '';
      if (emailTrim) {
        try {
          const latestModel = await getModelByIdFromSupabase(createdModelId);
          if (latestModel?.user_id) {
            inviteSkippedReason = uiCopy.modelRoster.modelInviteSkippedAlreadyLinkedNote;
          } else {
            const claimRes = await generateModelClaimToken(createdModelId, inviteOrganizationId ?? undefined);
            if (claimRes.ok) {
              claimTokenForManualLink = claimRes.data.token;
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
              const body = invokeRes.data as { ok?: boolean; error?: string; detail?: string } | null;
              if (!invokeRes.error && body?.ok === true) {
                emailSentOk = true;
              } else {
                inviteFailureReason = describeSendInviteFailure(invokeRes.data, invokeRes.error);
                console.error('handleAddModel send-invite failed:', inviteFailureReason, invokeRes);
              }
            } else {
              inviteFailureReason = describeClaimTokenFailure(claimRes.error ?? '');
              console.error('handleAddModel generateModelClaimToken error:', claimRes.error);
            }
          }
        } catch (e) {
          inviteFailureReason = e instanceof Error ? e.message : String(e);
          console.error('handleAddModel model invite exception:', e);
        }
      }

      // ── RC-3 fix: Write location BEFORE photos (location has no photo dependency) ──
      let locationPersistFailed = false;
      if (addModelEditState.country_code) {
        const cityForGeocode = addModelEditState.city?.trim() || null;
        const geocoded = cityForGeocode
          ? await geocodeCityForAgency(cityForGeocode, addModelEditState.country_code)
          : null;
        const locOk = await upsertModelLocation(
          createdModelId,
          {
            country_code: addModelEditState.country_code,
            city: cityForGeocode,
            lat: geocoded?.lat,
            lng: geocoded?.lng,
            share_approximate_location: geocoded != null,
          },
          'agency',
        );
        if (!locOk) {
          locationPersistFailed = true;
          console.warn('handleAddModel: upsertModelLocation(agency) failed — location may not appear in Near-Me until next save');
          Alert.alert(
            uiCopy.modelMedia.agencyLocationPersistFailedTitle,
            uiCopy.modelMedia.agencyLocationPersistFailedBody,
          );
        }
      }

      // ── Photo uploads (must not block creation / location / refresh) ──
      // RC-1 fix: NO early returns from the photo block — rights failures skip
      // uploads but Location/Refresh/selectedModel always execute afterwards.
      // First-save truth: only treat photos as persisted after upsert + DB verify match expected counts.
      let portfolioPersisted = false;
      let polaroidPersisted = false;
      let portfolioRowsExpected = 0;
      let polaroidRowsExpected = 0;
      const hasAnyPhotos = filesToUpload.length > 0 || polaroidFilesToUpload.length > 0;
      if (hasAnyPhotos) {
        let photoRightsOk = false;
        if (!addModelImageRightsConfirmed) {
          Alert.alert(
            uiCopy.modelMedia.imageRightsRequiredTitle,
            uiCopy.modelMedia.addModelConfirmImageRightsFeedback,
          );
        } else {
          const { data: { user: currentUser } } = await supabase.auth.getUser();
          if (!currentUser) {
            Alert.alert(
              uiCopy.modelMedia.imageRightsRequiredTitle,
              uiCopy.modelMedia.addModelAuthRequiredToUploadPhotos,
            );
          } else {
            const rightsOk = await confirmImageRights({
              userId: currentUser.id,
              modelId: createdModelId,
              orgId: inviteOrganizationId ?? undefined,
            });
            if (!rightsOk.ok) {
              Alert.alert(
                uiCopy.modelMedia.imageRightsRequiredTitle,
                uiCopy.legal.imageRightsConfirmationFailed,
              );
            } else {
              const guard = await guardImageUpload(currentUser.id, createdModelId);
              if (!guard.ok) {
                Alert.alert(
                  uiCopy.modelMedia.imageRightsRequiredTitle,
                  uiCopy.legal.imageRightsGuardVerificationFailed,
                );
              } else {
                photoRightsOk = true;
              }
            }
          }
        }

        if (photoRightsOk) {
          // Portfolio uploads — skipConsentCheck: caller already passed confirmImageRights + guardImageUpload (RC-2)
          if (filesToUpload.length > 0) {
            const uploadedItems: { url: string; fileSizeBytes: number }[] = [];
            for (const file of filesToUpload) {
              const result = await uploadModelPhoto(createdModelId, file, { skipConsentCheck: true });
              if (result) {
                uploadedItems.push(result);
              } else {
                Alert.alert(
                  uiCopy.modelMedia.addModelPartialUploadTitle,
                  uiCopy.modelMedia.addModelPartialPortfolioUploadFailed,
                );
              }
            }
            portfolioRowsExpected = uploadedItems.length;
            if (uploadedItems.length > 0) {
              const inserted = await upsertPhotosForModel(
                createdModelId,
                uploadedItems.map((item, index) => ({
                  url: item.url,
                  sort_order: index,
                  visible: true,
                  is_visible_to_clients: true,
                  source: null,
                  api_external_id: null,
                  photo_type: 'portfolio' as const,
                  file_size_bytes: item.fileSizeBytes,
                })),
              );
              const verifyPort = await getPhotosForModel(createdModelId, 'portfolio');
              const persistOk =
                inserted.length === uploadedItems.length && verifyPort.length >= uploadedItems.length;
              if (!persistOk) {
                Alert.alert(
                  uiCopy.modelMedia.photoPersistFailedTitle,
                  uiCopy.modelMedia.photoPersistPortfolioFailedBody,
                );
              } else {
                portfolioPersisted = true;
              }
            }
            if (uploadedItems.length === 0) {
              Alert.alert(
                uiCopy.common.error,
                uiCopy.modelMedia.addModelNoPortfolioUploadedBody,
              );
            }
          }

          // Polaroid uploads — skipConsentCheck: same as portfolio above (RC-2)
          if (polaroidFilesToUpload.length > 0) {
            const uploadedPolaroidItems: { url: string; fileSizeBytes: number }[] = [];
            for (const file of polaroidFilesToUpload) {
              const result = await uploadModelPhoto(createdModelId, file, { skipConsentCheck: true });
              if (result) {
                uploadedPolaroidItems.push(result);
              } else {
                Alert.alert(
                  uiCopy.modelMedia.addModelPartialUploadTitle,
                  uiCopy.modelMedia.addModelPartialPolaroidUploadFailed,
                );
              }
            }
            polaroidRowsExpected = uploadedPolaroidItems.length;
            if (uploadedPolaroidItems.length > 0) {
              const insertedPol = await upsertPhotosForModel(
                createdModelId,
                uploadedPolaroidItems.map((item, index) => ({
                  url: item.url,
                  sort_order: index,
                  visible: false,
                  is_visible_to_clients: false,
                  source: null,
                  api_external_id: null,
                  photo_type: 'polaroid' as const,
                  file_size_bytes: item.fileSizeBytes,
                })),
              );
              const verifyPol = await getPhotosForModel(createdModelId, 'polaroid');
              const persistPolOk =
                insertedPol.length === uploadedPolaroidItems.length
                && verifyPol.length >= uploadedPolaroidItems.length;
              if (!persistPolOk) {
                Alert.alert(
                  uiCopy.modelMedia.photoPersistFailedTitle,
                  uiCopy.modelMedia.photoPersistPolaroidFailedBody,
                );
              } else {
                polaroidPersisted = true;
              }
            }
          }
        }
      }

      // Mirror rebuild only for types that were verified in model_photos (first-save truth).
      if (portfolioPersisted) {
        const rebuildPortOk = await rebuildPortfolioImagesFromModelPhotos(createdModelId);
        if (!rebuildPortOk) {
          Alert.alert(uiCopy.common.error, uiCopy.modelMedia.portfolioColumnSyncFailed);
        }
      }
      if (polaroidPersisted) {
        const rebuildPolOk = await rebuildPolaroidsFromModelPhotos(createdModelId);
        if (!rebuildPolOk) {
          Alert.alert(uiCopy.common.error, uiCopy.modelMedia.polaroidColumnSyncFailed);
        }
      }

      try {
        await Promise.resolve(onRefresh());
      } catch (refreshErr: any) {
        console.error('handleAddModel refresh error:', refreshErr);
      }

      const fresh = await getModelByIdFromSupabase(createdModelId);
      let emailNote = '';
      if (emailTrim) {
        if (emailSentOk) {
          emailNote = ` ${uiCopy.modelRoster.modelInviteEmailSentNote(emailTrim)}`;
        } else if (inviteSkippedReason) {
          emailNote = ` ${inviteSkippedReason}`;
        } else {
          emailNote = ` ${uiCopy.modelRoster.modelInviteEmailFailedNote(inviteFailureReason || 'Unknown error')}`;
          if (claimTokenForManualLink) {
            emailNote += ` ${uiCopy.modelRoster.modelInviteManualLinkNote} ${buildModelClaimUrl(claimTokenForManualLink)}`;
          }
        }
      }
      const syncWarn = mergeResult.externalSyncIdsPersistFailed
        ? uiCopy.modelRoster.externalSyncIdsPersistWarning
        : '';
      const persistenceSuffix =
        locationPersistFailed
        || (portfolioRowsExpected > 0 && !portfolioPersisted)
        || (polaroidRowsExpected > 0 && !polaroidPersisted)
          ? uiCopy.modelMedia.addModelPersistenceWarningSuffix
          : '';
      if (fresh) {
        setSelectedModel(fresh);
        setAddModelFeedback(
          mergeResult.created
            ? `${modelDisplayName} added successfully.${emailNote}${syncWarn}${persistenceSuffix}`
            : `${modelDisplayName} merged with existing profile.${emailNote}${syncWarn}${persistenceSuffix}`,
        );
      } else {
        setAddModelFeedback(
          mergeResult.created
            ? `${modelDisplayName} was created.${emailNote} Please refresh the list once.${syncWarn}${persistenceSuffix}`
            : `${modelDisplayName} merged.${emailNote} Please refresh the list once.${syncWarn}${persistenceSuffix}`,
        );
      }

      // RC-1 fix: Form reset AFTER all persistence (photos, location, refresh, selectedModel).
      setAddModelEditState(buildEditState({ name: '' }));
      setAddTerritories([]);
      setAddTerritorySearch('');
      setAddModelImageFiles([]);
      setAddModelPolaroidFiles([]);
      setAddModelImageRightsConfirmed(false);
      setShowAddForm(false);
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
      await Promise.resolve(onRefresh());
      // Re-fetch the light model list to compute incomplete count from fresh data
      // instead of relying on stale closure `models`.
      const freshList = agencyId ? await getAgencyModels(agencyId) : [];
      const incompleteAfterSync = freshList.filter(
        (m: any) =>
          (m.portfolio_images ?? []).length === 0 ||
          !(rosterTerritoriesMap[m.id] ?? []).length,
      ).length;
      setSyncFeedback(
        incompleteAfterSync > 0
          ? `Sync complete. ${uiCopy.modelRoster.incompleteModelsBanner(incompleteAfterSync)}.`
          : 'Sync complete — all models have required fields.',
      );
    } catch (e: any) {
      console.error('handleSync error:', e);
      setSyncFeedback('Sync failed — see console for details.');
    } finally {
      setSyncLoading(false);
      if (syncFeedbackTimerRef.current) clearTimeout(syncFeedbackTimerRef.current);
      syncFeedbackTimerRef.current = setTimeout(() => setSyncFeedback(null), 8000);
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
      if (saveFeedbackTimerRef.current) clearTimeout(saveFeedbackTimerRef.current);
      saveFeedbackTimerRef.current = setTimeout(() => setSaveFeedback(null), 4000);
      showAppAlert(
        uiCopy.modelRoster.territoriesSaveFailedTitle,
        `${msg}\n\n${uiCopy.modelRoster.territoriesSaveSupportFooter}`,
      );
      return;
    }

    // ── STEP 2: Portfolio alert (non-blocking) — completeness banner already
    //   shows a warning; photos are managed independently by ModelMediaSettingsPanel.
    if (!hasVisibleClientPortfolio) {
      Alert.alert(uiCopy.modelRoster.portfolioRequiredTitle, uiCopy.modelRoster.portfolioRequiredBody);
    }

    // ── STEP 3: Save model fields + photos ──
    let step3Succeeded = false;
    try {
      const pInt = (v: string) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
      const updates: any = {};
      updates.name = normalizeInput(String(editState.name ?? '')).slice(0, MODEL_NAME_MAX_LENGTH);
      updates.email = editState.email.trim() || null;
      updates.height = pInt(editState.height) ?? selectedModel.height;
      // Save to both chest and bust for backwards compatibility.
      const chestVal = pInt(editState.chest);
      if (chestVal !== null) { updates.chest = chestVal; updates.bust = chestVal; }
      updates.waist = pInt(editState.waist);
      updates.hips = pInt(editState.hips);
      updates.legs_inseam = pInt(editState.legs_inseam);
      updates.shoe_size = pInt(editState.shoe_size);
      updates.hair_color =
        normalizeInput(String(editState.hair_color ?? '')).slice(0, MODEL_SHORT_TEXT_MAX_LENGTH) || null;
      updates.eye_color =
        normalizeInput(String(editState.eye_color ?? '')).slice(0, MODEL_SHORT_TEXT_MAX_LENGTH) || null;
      updates.ethnicity =
        normalizeInput(String(editState.ethnicity ?? '')).slice(0, MODEL_SHORT_TEXT_MAX_LENGTH) || null;
      updates.city =
        normalizeInput(String(editState.city ?? '')).slice(0, MODEL_CITY_MAX_LENGTH) || null;
      updates.country_code = editState.country_code || null;
      updates.current_location =
        normalizeInput(String(editState.current_location ?? '')).slice(0, MODEL_SHORT_TEXT_MAX_LENGTH) || null;
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
      // DB CHECK (sex IN ('male','female')) — only send valid values or null (no change).
      updates.sex =
        editState.sex === 'male' || editState.sex === 'female' ? editState.sex : null;

      const { error: modelUpdateError } = await supabase.rpc('agency_update_model_full', {
        p_model_id:             selectedModel.id,
        p_name:                 updates.name              ?? null,
        p_email:                updates.email             ?? null,
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
        console.error('handleSaveModel agency_update_model_full:', {
          message: modelUpdateError.message,
          code: (modelUpdateError as { code?: string }).code,
          details: (modelUpdateError as { details?: string }).details,
          hint: (modelUpdateError as { hint?: string }).hint,
        });
        throw modelUpdateError;
      }

      // Persist city/country to model_locations (agency-managed, source='agency').
      // Forward-geocode city → coordinates so the model appears in Near Me radius queries.
      // share_approximate_location is set to true only when geocoding succeeds.
      // The model-owned location (source='live'/'current') is protected by the DB priority guard.
      if (editState.country_code) {
        const cityTrim = updates.city ?? null;
        const geocoded = cityTrim
          ? await geocodeCityForAgency(cityTrim, editState.country_code)
          : null;

        const locOk = await upsertModelLocation(
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
        if (!locOk) {
          console.warn('handleSaveModel: upsertModelLocation(agency) failed — location may be stale');
          Alert.alert(
            uiCopy.modelMedia.agencyLocationPersistFailedTitle,
            uiCopy.modelMedia.agencyLocationPersistFailedBody,
          );
        }
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
    // RC-8 fix: await so subsequent completeness checks read fresh data.
    try { await Promise.resolve(onRefresh()); } catch (e) { console.error('handleSaveModel refresh error:', e); }
    // Refresh completeness after save (model fields may have changed).
    if (selectedModel) {
      const freshModel = await getModelByIdFromSupabase(selectedModel.id).catch(() => null);
      if (freshModel) {
        const rows = await getPhotosForModel(selectedModel.id, 'portfolio');
        const hasVis = rows.some((p) => Boolean(p.is_visible_to_clients ?? p.visible));
        setHasVisibleClientPortfolio(hasVis);
        const ctx: CompletenessContext = {
          hasTerritories: territoryCountryCodes.length > 0,
          hasVisiblePhoto: hasVis,
        };
        setCompletenessIssues(checkModelCompleteness(freshModel, ctx));
      }
    }
    if (saveFeedbackTimerRef.current) clearTimeout(saveFeedbackTimerRef.current);
    saveFeedbackTimerRef.current = setTimeout(() => {
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
            key={selectedModel.id}
            modelId={selectedModel.id}
            organizationId={inviteOrganizationId ?? null}
            onHasVisiblePortfolioChange={refreshClientVisiblePortfolio}
            onReconcileComplete={onRefresh}
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
            <Text style={{ ...typography.label, fontSize: 13, color: '#fff' }}>{uiCopy.modelRoster.modelSaveSuccess}</Text>
          </View>
        )}
        {saveFeedback === 'error' && (
          <View style={{ backgroundColor: '#b91c1c', borderRadius: 8, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm, alignItems: 'center' }}>
            <Text style={{ ...typography.label, fontSize: 13, color: '#fff' }}>{uiCopy.modelRoster.modelSaveFailed}</Text>
          </View>
        )}
        <TouchableOpacity
          onPress={handleSaveModel}
          style={[s.saveBtn, saveFeedback === 'saving' && { opacity: 0.6 }]}
          disabled={saveFeedback === 'saving'}
        >
          <Text style={s.saveBtnLabel}>{saveFeedback === 'saving' ? uiCopy.common.saving : uiCopy.modelRoster.modelSaveButton}</Text>
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
    <ScreenScrollView
      contentStyle={selectedModelIds.size > 0 ? { paddingBottom: spacing.xl * 5 } : undefined}
    >
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
                {uiCopy.legal.chatFileRightsCheckbox}
              </Text>
            </TouchableOpacity>
          )}
          {(addModelImageFiles.length > 0 || addModelPolaroidFiles.length > 0) && (
            <Text style={{ fontSize: 10, color: colors.textSecondary, marginBottom: spacing.sm, lineHeight: 14 }}>
              {uiCopy.modelMedia.imageRightsCheckboxSessionHint}
            </Text>
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
              : uiCopy.bulkActions.selectForTerritoriesHint}
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
              {(() => {
                const raw = (m.portfolio_images ?? [])[0];
                const coverUri = raw ? normalizeDocumentspicturesModelImageRef(raw, m.id) : '';
                return coverUri ? (
                <StorageImage
                  uri={coverUri}
                  style={{ width: 44, height: 44, borderRadius: 6, marginRight: spacing.sm, backgroundColor: colors.border }}
                  resizeMode="cover"
                />
              ) : (
                <View style={{ width: 44, height: 44, borderRadius: 6, marginRight: spacing.sm, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 18, color: colors.textSecondary }}>◻</Text>
                </View>
              );
              })()}
              <View style={{ flex: 1 }}>
                <Text style={s.modelName}>{m.name}</Text>
                <Text style={s.metaText}>
                  {m.city ?? '—'} · H{m.height} C{(m as SupabaseModel).chest ?? m.bust ?? '—'} W{m.waist ?? '—'} H{m.hips ?? '—'}
                </Text>
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 }}>
                    <Text style={{ ...typography.label, fontSize: 9, color: '#B8860B' }}>Pending app account link</Text>
                    {m.email && !m.user_id && (
                      <TouchableOpacity
                        style={[s.saveBtn, { marginTop: 0, paddingHorizontal: spacing.sm, paddingVertical: 4 }]}
                        onPress={() => {
                          void handleResendModelClaimInvite(m);
                        }}
                        disabled={resendingModelId === m.id || Date.now() < (resendModelCooldownUntil[m.id] ?? 0)}
                      >
                        <Text style={[s.saveBtnLabel, { fontSize: 10 }]}>
                      {resendingModelId === m.id ? uiCopy.inviteResend.loading : uiCopy.inviteResend.cta}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
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
          padding: spacing.md,
          gap: spacing.sm,
        }}>
          <Text style={{ ...typography.label, fontSize: 12, color: colors.textPrimary }}>
            {uiCopy.bulkActions.selectedCount.replace('{count}', String(selectedModelIds.size))}
          </Text>
          <TouchableOpacity
            style={{
              backgroundColor: colors.textPrimary,
              borderRadius: 999,
              paddingVertical: spacing.sm,
              alignItems: 'center',
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

    </ScreenScrollView>
  );
};

type AgencyClientsTabProps = {
  agencyId: string;
  agencyOrganizationId: string | null;
  currentUserId: string | null;
  teamMembers: Awaited<ReturnType<typeof listOrganizationMembers>>;
  assignmentByClientOrgId: Record<string, ClientAssignmentFlag>;
  onUpsertClientAssignment: (
    clientOrganizationId: string,
    patch: { label: string; color: AssignmentFlagColor; assignedMemberUserId?: string | null },
  ) => Promise<void>;
  onChatStarted: (conversationId: string, title: string) => void;
};

const AgencyClientsTab: React.FC<AgencyClientsTabProps> = ({
  agencyId,
  agencyOrganizationId,
  currentUserId,
  teamMembers,
  assignmentByClientOrgId,
  onUpsertClientAssignment,
  onChatStarted,
}) => {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<ClientOrganizationDirectoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [editingClientOrgId, setEditingClientOrgId] = useState<string | null>(null);

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
        const assignment = assignmentByClientOrgId[row.id];
        return (
          <View
            key={row.id}
            style={[s.modelRow, { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }]}
          >
            <View style={{ flex: 1, minWidth: 160 }}>
              <Text style={s.modelName}>{label}</Text>
              <Text style={s.metaText}>{sub}</Text>
              <Text style={s.metaText}>
                {assignment
                  ? `${assignment.label}${assignment.assignedMemberName ? ` · ${assignment.assignedMemberName}` : ''}`
                  : 'No assignment yet'}
              </Text>
            </View>
            {agencyOrganizationId && (
              <>
                <TouchableOpacity
                  style={s.filterPill}
                  onPress={() => {
                    if (!currentUserId) return;
                    void onUpsertClientAssignment(row.id, {
                      label: assignment?.label ?? 'BLUE',
                      color: assignment?.color ?? 'blue',
                      assignedMemberUserId: currentUserId,
                    });
                  }}
                >
                  <Text style={s.filterPillLabel}>Assign to me</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.filterPill}
                  onPress={() => setEditingClientOrgId((prev) => (prev === row.id ? null : row.id))}
                >
                  <Text style={s.filterPillLabel}>{editingClientOrgId === row.id ? 'Close' : 'Edit assignment'}</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity
              style={[s.filterPill, { backgroundColor: colors.buttonOptionGreen, opacity: actionId === row.id ? 0.6 : 1 }]}
              disabled={actionId === row.id}
              onPress={() => void startChat(row.id, label)}
            >
              <Text style={[s.filterPillLabel, { color: '#fff' }]}>{uiCopy.b2bChat.startChat}</Text>
            </TouchableOpacity>
            {editingClientOrgId === row.id && (
              <View style={{ width: '100%', marginTop: spacing.xs, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {(['gray', 'blue', 'green', 'amber', 'purple', 'red'] as AssignmentFlagColor[]).map((color) => (
                  <TouchableOpacity
                    key={`${row.id}-${color}`}
                    style={[s.filterPill, assignment?.color === color && s.filterPillActive]}
                    onPress={() => {
                      void onUpsertClientAssignment(row.id, {
                        label: assignment?.label ?? color.toUpperCase(),
                        color,
                        assignedMemberUserId: assignment?.assignedMemberUserId ?? null,
                      });
                    }}
                  >
                    <Text style={[s.filterPillLabel, assignment?.color === color && s.filterPillLabelActive]}>{color}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={s.filterPill}
                  onPress={() => {
                    const fallbackMember = teamMembers[0]?.user_id ?? currentUserId ?? null;
                    void onUpsertClientAssignment(row.id, {
                      label: assignment?.label ?? 'BLUE',
                      color: assignment?.color ?? 'blue',
                      assignedMemberUserId: fallbackMember,
                    });
                  }}
                >
                  <Text style={s.filterPillLabel}>Owner/default</Text>
                </TouchableOpacity>
                {teamMembers.slice(0, 8).map((member) => (
                  <TouchableOpacity
                    key={`${row.id}-${member.user_id}`}
                    style={[s.filterPill, assignment?.assignedMemberUserId === member.user_id && s.filterPillActive]}
                    onPress={() => {
                      void onUpsertClientAssignment(row.id, {
                        label: assignment?.label ?? 'BLUE',
                        color: assignment?.color ?? 'blue',
                        assignedMemberUserId: member.user_id,
                      });
                    }}
                  >
                    <Text style={[s.filterPillLabel, assignment?.assignedMemberUserId === member.user_id && s.filterPillLabelActive]}>
                      {member.display_name ?? member.email ?? 'Member'}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={s.filterPill}
                  onPress={() => {
                    void onUpsertClientAssignment(row.id, {
                      label: assignment?.label ?? 'BLUE',
                      color: assignment?.color ?? 'blue',
                      assignedMemberUserId: null,
                    });
                  }}
                >
                  <Text style={s.filterPillLabel}>Unassigned</Text>
                </TouchableOpacity>
              </View>
            )}
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
  assignmentByClientOrgId?: Record<string, ClientAssignmentFlag>;
  onOptionRequestDeleted?: () => void;
  /** Tab bar + safe area inset for negotiation composer (same as AgencyControllerView content padding). */
  bottomTabInset: number;
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
  assignmentByClientOrgId = {},
  onOptionRequestDeleted,
  bottomTabInset,
}) => {
  const { width: agencyMsgWinW, height: agencyMsgWinH } = useWindowDimensions();
  const agencyB2bWebSplit = Platform.OS === 'web' && shouldUseB2BWebSplit(agencyMsgWinW);
  const agencyThreadListScrollMax = agencyB2bWebSplit
    ? getThreadListMaxHeightSplit(agencyMsgWinH)
    : getThreadListMaxHeight(agencyMsgWinH);
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
  const [viewingClientProfileOrgId, setViewingClientProfileOrgId] = useState<string | null>(null);
  const [viewingClientProfileOrgName, setViewingClientProfileOrgName] = useState<string | null>(null);
  const [requests, setRequests] = useState(getOptionRequests());
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [agencyCounterInput, setAgencyCounterInput] = useState('');
  const [openOrgChatBusy, setOpenOrgChatBusy] = useState(false);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
  const [deletingOptionId, setDeletingOptionId] = useState<string | null>(null);
  const [negotiationCounterExpanded, setNegotiationCounterExpanded] = useState(false);
  const [msgFilter, setMsgFilter] = useState<'current' | 'archived' | 'applications'>('current');
  const [assignmentScope, setAssignmentScope] = useState<'all' | 'mine' | 'unassigned'>('all');
  const [assignmentFlagFilter, setAssignmentFlagFilter] = useState<string>('all');
  const [attentionFilter, setAttentionFilter] = useState<'all' | 'action_required'>('all');
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

  const visible = requests.filter((r) => {
    if (msgFilter === 'archived' ? !archivedIds.has(r.threadId) : archivedIds.has(r.threadId)) return false;
    const assignment = r.clientOrganizationId ? assignmentByClientOrgId[r.clientOrganizationId] : undefined;
    if (assignmentScope === 'mine' && assignment?.assignedMemberUserId !== currentUserId) return false;
    if (assignmentScope === 'unassigned' && !!assignment?.assignedMemberUserId) return false;
    if (assignmentFlagFilter !== 'all' && (assignment?.label ?? '').toLowerCase() !== assignmentFlagFilter.toLowerCase()) return false;
    if (attentionFilter === 'action_required') {
      const state = deriveSmartAttentionState({
        status: r.status,
        finalStatus: r.finalStatus ?? null,
        clientPriceStatus: r.clientPriceStatus ?? null,
        modelApproval: r.modelApproval,
        modelAccountLinked: r.modelAccountLinked ?? true,
      });
      if (!smartAttentionVisibleForRole(state, 'agency')) return false;
    }
    return true;
  });

  const request = selectedThreadId ? getRequestByThreadId(selectedThreadId) : null;
  const messages = selectedThreadId ? getMessages(selectedThreadId) : [];
  const filteredMessages = messages.filter((m) => shouldShowSystemMessageForViewer(m, 'agency'));
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

  const openOrgChatFromRequest = async () => {
    if (!request?.clientOrganizationId || !agencyId || !currentUserId || openOrgChatBusy) return;
    setOpenOrgChatBusy(true);
    try {
      const result = await ensureClientAgencyChat({
        clientOrganizationId: request.clientOrganizationId,
        agencyId,
        actingUserId: currentUserId,
      });
      if (!result.ok) {
        showAppAlert(uiCopy.b2bChat.chatFailedTitle, result.reason || uiCopy.b2bChat.chatFailedGeneric);
        return;
      }
      setMessagesSection('clientRequests');
      setActiveConnectionChatId(result.conversationId);
      setActiveConnectionChatTitle(request.clientName || uiCopy.b2bChat.chatPartnerFallback);
    } finally {
      setOpenOrgChatBusy(false);
    }
  };

  const handleDeleteOptionRequest = () => {
    if (!request || !selectedThreadId || !agencyId || deletingOptionId) return;
    if (request.finalStatus === 'job_confirmed') {
      showAppAlert(uiCopy.messages.deleteOptionRequestNotAllowed);
      return;
    }
    const threadId = request.threadId;
    const reqId = request.id;
    const run = async () => {
      setDeletingOptionId(threadId);
      try {
        const ok = await deleteOptionRequestFull(reqId);
        if (!ok) {
          showAppAlert(uiCopy.common.error, uiCopy.messages.deleteOptionRequestFailed);
          return;
        }
        purgeOptionThreadFromStore(threadId);
        setSelectedThreadId(null);
        await loadOptionRequestsForAgency(agencyId, agencyOrganizationIdProp);
        onOptionRequestDeleted?.();
      } finally {
        setDeletingOptionId(null);
      }
    };
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const msg = `${uiCopy.messages.deleteOptionRequestTitle}\n\n${uiCopy.messages.deleteOptionRequestMessage}`;
      if (window.confirm(msg)) void run();
      return;
    }
    Alert.alert(
      uiCopy.messages.deleteOptionRequestTitle,
      uiCopy.messages.deleteOptionRequestMessage,
      [
        { text: uiCopy.common.cancel, style: 'cancel' },
        { text: uiCopy.common.delete, style: 'destructive', onPress: () => { void run(); } },
      ],
    );
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

  const handleBackOptionChat = () => {
    setSelectedThreadId(null);
    setNegotiationCounterExpanded(false);
    setStatusDropdownOpen(false);
  };

  const handleRejectOptionNegotiation = () => {
    if (!request?.threadId) return;
    const threadId = request.threadId;
    const run = () => {
      setRequestStatus(threadId, 'rejected');
      setRequests(getOptionRequests());
    };
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const msg = `${uiCopy.optionNegotiationChat.rejectOptionTitle}\n\n${uiCopy.optionNegotiationChat.rejectOptionMessage}`;
      if (window.confirm(msg)) run();
      return;
    }
    Alert.alert(
      uiCopy.optionNegotiationChat.rejectOptionTitle,
      uiCopy.optionNegotiationChat.rejectOptionMessage,
      [
        { text: uiCopy.common.cancel, style: 'cancel' },
        { text: uiCopy.optionNegotiationChat.rejectOption, style: 'destructive', onPress: run },
      ],
    );
  };

  const optionFullscreenActive =
    messagesSection === 'optionRequests' && !!selectedThreadId && !!request;

  if (optionFullscreenActive && request) {
    return (
      <>
        <View style={{ flex: 1, minHeight: 0, alignSelf: 'stretch' }}>
          <OptionNegotiationChatShell
            title={`${request.clientName} · ${request.modelName}`}
            subtitle={`${request.date}${request.startTime ? ` · ${request.startTime}–${request.endTime}` : ''}`}
            onBack={handleBackOptionChat}
            backLabel={uiCopy.optionNegotiationChat.back}
            statusLabel={status ? STATUS_LABELS[status] : '—'}
            statusBackgroundColor={status ? STATUS_COLORS[status] : colors.border}
            onStatusPress={() => setStatusDropdownOpen((o) => !o)}
            headerAccessory={
              finalStatus !== 'job_confirmed' ? (
                <TouchableOpacity
                  onPress={handleDeleteOptionRequest}
                  disabled={!!deletingOptionId}
                  style={{ opacity: deletingOptionId ? 0.5 : 1 }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={{ fontSize: 12, color: colors.buttonSkipRed ?? '#c0392b', fontWeight: '600' }}>
                    {deletingOptionId ? uiCopy.common.loading : uiCopy.common.delete}
                  </Text>
                </TouchableOpacity>
              ) : null
            }
            bottomInset={bottomTabInset}
            footerTop={
              <>
                {request.clientOrganizationId && assignmentByClientOrgId[request.clientOrganizationId] ? (
                  <Text style={[s.metaText, { marginBottom: spacing.xs }]}>
                    Client assignment: {assignmentByClientOrgId[request.clientOrganizationId].label}
                    {assignmentByClientOrgId[request.clientOrganizationId].assignedMemberName
                      ? ` · ${assignmentByClientOrgId[request.clientOrganizationId].assignedMemberName}`
                      : ''}
                  </Text>
                ) : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
                  <View style={[s.statusPill, { backgroundColor: '#e0e7ff' }]}>
                    <Text style={[s.statusPillLabel, { color: '#3730a3' }]}>{uiCopy.b2bChat.contextNegotiationThread}</Text>
                  </View>
                  <TouchableOpacity
                    style={[s.filterPill, openOrgChatBusy && { opacity: 0.6 }]}
                    disabled={openOrgChatBusy || !request.clientOrganizationId}
                    onPress={() => { void openOrgChatFromRequest(); }}
                  >
                    <Text style={s.filterPillLabel}>
                      {openOrgChatBusy ? uiCopy.common.loading : uiCopy.b2bChat.openOrgChat}
                    </Text>
                  </TouchableOpacity>
                </View>
                {request.proposedPrice != null && (
                  <Text style={{ ...typography.label, fontSize: 10, color: colors.accentBrown, marginBottom: spacing.xs }}>
                    {uiCopy.optionNegotiationChat.proposedPriceLabel}:{' '}
                    {currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency === 'CHF' ? 'CHF ' : '€'}
                    {request.proposedPrice}
                  </Text>
                )}
                {request.modelAccountLinked === false ? (
                  <View style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, marginBottom: spacing.sm, backgroundColor: 'rgba(100,100,100,0.12)', borderRadius: 8 }}>
                    <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary }}>
                      {uiCopy.dashboard.optionRequestFinalStatusNoModelAppHint}
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
                      {request.modelApproval === 'approved'
                        ? uiCopy.dashboard.optionRequestModelApprovalApproved
                        : request.modelApproval === 'rejected'
                          ? uiCopy.dashboard.optionRequestModelApprovalRejected
                          : uiCopy.dashboard.optionRequestModelApprovalPending}
                    </Text>
                  </View>
                )}
                {finalStatus && (
                  <View style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, marginBottom: spacing.sm, backgroundColor: finalStatus === 'job_confirmed' ? 'rgba(0,120,0,0.15)' : finalStatus === 'option_confirmed' ? 'rgba(0,80,200,0.12)' : 'rgba(120,120,0,0.12)', borderRadius: 8 }}>
                    <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary }}>
                      {request.requestType === 'casting' ? uiCopy.dashboard.threadContextCasting : uiCopy.dashboard.threadContextOption} -{' '}
                      {finalStatus === 'job_confirmed' ? uiCopy.dashboard.optionRequestStatusJobConfirmed : finalStatus === 'option_confirmed' ? uiCopy.dashboard.optionRequestStatusConfirmed : uiCopy.dashboard.optionRequestStatusPending}
                    </Text>
                  </View>
                )}
                {request.modelApproval === 'approved' && finalStatus !== 'job_confirmed' && status !== 'rejected' && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm }}>
                    {request.proposedPrice != null && clientPriceStatus === 'pending' ? (
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
                        <Text style={[s.filterPillLabel, { color: '#fff' }]}>{uiCopy.optionNegotiationChat.confirmOption}</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      style={s.filterPill}
                      onPress={() => setNegotiationCounterExpanded((e) => !e)}
                    >
                      <Text style={s.filterPillLabel}>{uiCopy.optionNegotiationChat.counterOffer}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.filterPill, { borderWidth: 1, borderColor: colors.buttonSkipRed }]} onPress={handleRejectOptionNegotiation}>
                      <Text style={[s.filterPillLabel, { color: colors.buttonSkipRed }]}>{uiCopy.optionNegotiationChat.rejectOption}</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {request.modelApproval === 'approved' && clientPriceStatus === 'pending' && finalStatus !== 'job_confirmed' && request.proposedPrice != null && (
                  <TouchableOpacity
                    style={{ alignSelf: 'flex-start', marginBottom: spacing.sm }}
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
                    <Text style={{ ...typography.label, fontSize: 12, color: colors.buttonSkipRed, fontWeight: '600' }}>
                      {uiCopy.optionNegotiationChat.declineProposedFee}
                    </Text>
                  </TouchableOpacity>
                )}
                {negotiationCounterExpanded && request.modelApproval === 'approved' && clientPriceStatus === 'rejected' && finalStatus !== 'job_confirmed' && (
                  <View style={{ marginBottom: spacing.sm, padding: spacing.sm, backgroundColor: 'rgba(180,100,0,0.08)', borderRadius: 8 }}>
                    <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary, marginBottom: spacing.xs }}>
                      {uiCopy.optionNegotiationChat.clientPriceDeclinedCounterHint}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                      <TextInput
                        value={agencyCounterInput}
                        onChangeText={setAgencyCounterInput}
                        placeholder={uiCopy.optionNegotiationChat.counterPlaceholder}
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
                            setNegotiationCounterExpanded(false);
                            setRequests(getOptionRequests());
                          } finally {
                            setProcessingRequestId(null);
                          }
                        }}
                      >
                        <Text style={[s.filterPillLabel, { color: '#fff' }]}>{uiCopy.optionNegotiationChat.sendCounter}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
                {negotiationCounterExpanded && request.modelApproval === 'approved' && clientPriceStatus === 'pending' && finalStatus !== 'job_confirmed' && request.proposedPrice == null && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm, alignItems: 'center' }}>
                    <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary }}>{uiCopy.optionNegotiationChat.proposeFeeHint}</Text>
                    <TextInput
                      value={agencyCounterInput}
                      onChangeText={setAgencyCounterInput}
                      placeholder={uiCopy.optionNegotiationChat.counterPlaceholder}
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
                          setNegotiationCounterExpanded(false);
                          setRequests(getOptionRequests());
                        } finally {
                          setProcessingRequestId(null);
                        }
                      }}
                    >
                      <Text style={s.filterPillLabel}>{uiCopy.optionNegotiationChat.sendOffer}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            }
            composer={
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TextInput
                  value={chatInput}
                  onChangeText={setChatInput}
                  placeholder={uiCopy.optionNegotiationChat.messagePlaceholder}
                  placeholderTextColor={colors.textSecondary}
                  style={s.chatInput}
                />
                <TouchableOpacity style={s.chatSend} onPress={sendMessage}>
                  <Text style={s.chatSendLabel}>{uiCopy.optionNegotiationChat.send}</Text>
                </TouchableOpacity>
              </View>
            }
          >
            {filteredMessages.map((msg) =>
              msg.from === 'system' ? (
                <OptionSystemInfoBlock key={msg.id} text={msg.text} />
              ) : (
                <View key={msg.id} style={[s.chatBubble, msg.from === 'agency' ? s.chatBubbleAgency : s.chatBubbleClient]}>
                  <Text style={[s.chatBubbleText, msg.from === 'agency' && s.chatBubbleTextAgency]}>{msg.text}</Text>
                </View>
              ),
            )}
          </OptionNegotiationChatShell>
        </View>
        {statusDropdownOpen && (
          <Modal transparent animationType="fade" visible={statusDropdownOpen} onRequestClose={() => setStatusDropdownOpen(false)}>
            <TouchableOpacity
              style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-start', paddingTop: 56 }}
              activeOpacity={1}
              onPress={() => setStatusDropdownOpen(false)}
            >
              <View style={{ alignSelf: 'center', backgroundColor: colors.surface, borderRadius: 8, padding: spacing.sm, minWidth: 220, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
                {(['in_negotiation', 'confirmed', 'rejected'] as ChatStatus[]).map((st) => (
                  <TouchableOpacity
                    key={st}
                    style={[s.filterPill, { marginBottom: spacing.xs, borderColor: STATUS_COLORS[st] }]}
                    onPress={() => {
                      if (request) setRequestStatus(request.threadId, st);
                      setStatusDropdownOpen(false);
                    }}
                  >
                    <Text style={[s.filterPillLabel, { color: STATUS_COLORS[st] }]}>{STATUS_LABELS[st]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableOpacity>
          </Modal>
        )}
      </>
    );
  }

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
              ) : agencyB2bWebSplit ? (
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
                  <View style={{ flex: CHAT_THREAD_LIST_FLEX, minWidth: 0 }}>
                    <ScrollView style={{ maxHeight: agencyThreadListScrollMax }}>
                      {b2bConversations.map((c) => (
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
                      ))}
                    </ScrollView>
                  </View>
                  <View style={{ flex: CHAT_MESSENGER_FLEX, minWidth: 0, minHeight: 0 }}>
                    {activeConnectionChatId ? (
                      <OrgMessengerInline
                        conversationId={activeConnectionChatId}
                        headerTitle={activeConnectionChatTitle}
                        viewerUserId={currentUserId}
                        threadContext={{ type: uiCopy.b2bChat.contextOrgChat }}
                        agencyId={agencyId}
                        guestLinks={guestLinksForChat}
                        modelsForShare={modelsForShare}
                        onOpenRelatedRequest={(optionRequestId) => {
                          setMessagesSection('optionRequests');
                          setSelectedThreadId(optionRequestId);
                        }}
                        onBookingCardPress={onBookingCardPress}
                        viewerRole="agency"
                        onBookingStatusUpdated={() => onBookingCardPress?.()}
                        containerStyle={{ marginTop: 0, flex: 1 }}
                        onOrgPress={() => {
                          const conv = b2bConversations.find((c) => c.id === activeConnectionChatId);
                          const orgId = conv?.client_organization_id ?? null;
                          if (!orgId) return;
                          setViewingClientProfileOrgId(orgId);
                          setViewingClientProfileOrgName(activeConnectionChatTitle);
                        }}
                      />
                    ) : null}
                  </View>
                </View>
              ) : (
                <>
                  {b2bConversations.map((c) => (
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
                  ))}
                  {activeConnectionChatId ? (
                    <View style={{ flex: 1, minHeight: 0, marginTop: spacing.md }}>
                      <OrgMessengerInline
                        conversationId={activeConnectionChatId}
                        headerTitle={activeConnectionChatTitle}
                        viewerUserId={currentUserId}
                        threadContext={{ type: uiCopy.b2bChat.contextOrgChat }}
                        agencyId={agencyId}
                        guestLinks={guestLinksForChat}
                        modelsForShare={modelsForShare}
                        onOpenRelatedRequest={(optionRequestId) => {
                          setMessagesSection('optionRequests');
                          setSelectedThreadId(optionRequestId);
                        }}
                        onBookingCardPress={onBookingCardPress}
                        viewerRole="agency"
                        onBookingStatusUpdated={() => onBookingCardPress?.()}
                        containerStyle={{ marginTop: 0, flex: 1 }}
                        onOrgPress={() => {
                          const conv = b2bConversations.find((c) => c.id === activeConnectionChatId);
                          const orgId = conv?.client_organization_id ?? null;
                          if (!orgId) return;
                          setViewingClientProfileOrgId(orgId);
                          setViewingClientProfileOrgName(activeConnectionChatTitle);
                        }}
                      />
                    </View>
                  ) : null}
                </>
              )}
            </>
          )}
          {viewingClientProfileOrgId && (
            <OrgProfileModal
              visible
              onClose={() => setViewingClientProfileOrgId(null)}
              orgType="client"
              organizationId={viewingClientProfileOrgId}
              agencyId={null}
              orgName={viewingClientProfileOrgName}
            />
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
      {Object.keys(assignmentByClientOrgId).length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
          {(['all', 'mine', 'unassigned'] as const).map((scope) => (
            <TouchableOpacity
              key={`scope-${scope}`}
              style={[s.filterPill, assignmentScope === scope && s.filterPillActive]}
              onPress={() => setAssignmentScope(scope)}
            >
              <Text style={[s.filterPillLabel, assignmentScope === scope && s.filterPillLabelActive]}>
                {scope === 'all' ? 'All clients' : scope === 'mine' ? 'My clients' : 'Unassigned'}
              </Text>
            </TouchableOpacity>
          ))}
          {['all', ...Array.from(new Set(Object.values(assignmentByClientOrgId).map((a) => a.label.toLowerCase())))]
            .slice(0, 8)
            .map((flag) => (
              <TouchableOpacity
                key={`flag-${flag}`}
                style={[s.filterPill, assignmentFlagFilter === flag && s.filterPillActive]}
                onPress={() => setAssignmentFlagFilter(flag)}
              >
                <Text style={[s.filterPillLabel, assignmentFlagFilter === flag && s.filterPillLabelActive]}>
                  {flag === 'all' ? 'Any flag' : `Flag ${flag}`}
                </Text>
              </TouchableOpacity>
            ))}
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
        <TouchableOpacity style={[s.filterPill, attentionFilter === 'all' && s.filterPillActive]} onPress={() => setAttentionFilter('all')}>
          <Text style={[s.filterPillLabel, attentionFilter === 'all' && s.filterPillLabelActive]}>
            {_uiCopy.dashboard.smartAttentionFilterAll}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.filterPill, attentionFilter === 'action_required' && s.filterPillActive]} onPress={() => setAttentionFilter('action_required')}>
          <Text style={[s.filterPillLabel, attentionFilter === 'action_required' && s.filterPillLabelActive]}>
            {_uiCopy.dashboard.smartAttentionFilterActionRequired}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1, maxHeight: agencyThreadListScrollMax }}>
        {visible.length === 0 ? (
          <Text style={s.metaText}>No messages.</Text>
        ) : (
          visible.map((r) => {
            const reqStatus = getRequestStatus(r.threadId) ?? r.status;
            const assignment = r.clientOrganizationId ? assignmentByClientOrgId[r.clientOrganizationId] : undefined;
            const attentionState = deriveSmartAttentionState({
              status: r.status,
              finalStatus: r.finalStatus ?? null,
              clientPriceStatus: r.clientPriceStatus ?? null,
              modelApproval: r.modelApproval,
              modelAccountLinked: r.modelAccountLinked ?? true,
            });
            const showAttention = smartAttentionVisibleForRole(attentionState, 'agency');
            return (
              <TouchableOpacity key={r.threadId} style={[s.threadRow, selectedThreadId === r.threadId && s.threadRowActive]} onPress={() => setSelectedThreadId(r.threadId)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.modelName}>{r.modelName} · {r.date}</Text>
                  <Text style={s.metaText}>{r.clientName}{r.startTime ? ` · ${r.startTime}–${r.endTime}` : ''}</Text>
                  {assignment ? (
                    <Text style={s.metaText}>
                      {assignment.label}
                      {assignment.assignedMemberName ? ` · ${assignment.assignedMemberName}` : ''}
                    </Text>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  {showAttention ? (
                    <View style={[s.statusPill, { backgroundColor: '#dbeafe' }]}>
                      <Text style={[s.statusPillLabel, { color: '#1d4ed8' }]}>{attentionLabelForAgency(attentionState)}</Text>
                    </View>
                  ) : null}
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
                      {r.modelAccountLinked === false
                        ? uiCopy.dashboard.optionRequestModelApprovalNoApp
                        : r.modelApproval === 'approved'
                          ? uiCopy.dashboard.optionRequestModelApprovalApproved
                          : r.modelApproval === 'rejected'
                            ? uiCopy.dashboard.optionRequestModelApprovalRejected
                            : uiCopy.dashboard.optionRequestModelApprovalPending}
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
  /** undefined = not loaded; null = unlimited; number = plan cap */
  const [seatLimit, setSeatLimit] = useState<number | null | undefined>(undefined);
  const [nameInput, setNameInput] = useState(profile?.display_name ?? '');
  const [nameBusy, setNameBusy] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [resendingInvitationId, setResendingInvitationId] = useState<string | null>(null);
  const [resendInvitationCooldownUntil, setResendInvitationCooldownUntil] = useState<Record<string, number>>({});

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

  useEffect(() => {
    if (!organizationId) {
      setSeatLimit(undefined);
      return;
    }
    void getAgencyOrganizationSeatLimit(organizationId).then(setSeatLimit);
  }, [organizationId, members.length, invitations.length]);

  const handleInvite = async () => {
    if (!organizationId || !inviteEmail.trim()) return;
    setBusy(true);
    const result = await createOrganizationInvitation({
      organizationId,
      email: inviteEmail.trim(),
      role: 'booker',
    });
    if (result.ok) {
      const row = result.invitation;
      const link = buildOrganizationInviteUrl(row.token);
      setLastLink(link);

      // Email dispatch is best-effort. The invite link remains a deterministic fallback.
      let emailOk = false;
      let emailFailureReason = '';
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
            invite_role: 'booker',
          },
          headers: s?.access_token ? { Authorization: `Bearer ${s.access_token}` } : undefined,
        });
        const body = res.data as { ok?: boolean; error?: string; detail?: string } | null;
        emailOk = !res.error && body?.ok === true;
        if (!emailOk) {
          emailFailureReason = describeSendInviteFailure(res.data, res.error);
          console.error('OrganizationTeamTab send-invite error:', emailFailureReason, res);
        }
      } catch (e) {
        emailFailureReason = e instanceof Error ? e.message : String(e);
        console.error('OrganizationTeamTab send-invite exception:', e);
      }

      setInviteEmail('');
      onRefresh();
      Alert.alert(
        uiCopy.alerts.invitationCreated,
        emailOk
          ? uiCopy.alerts.invitationCreatedBody
          : uiCopy.inviteDelivery.invitationCreatedEmailFailedWithLink(emailFailureReason || 'unknown_error', link),
      );
    } else if (result.error === 'agency_member_limit_reached') {
      Alert.alert(uiCopy.common.error, uiCopy.team.agencyPlanMemberLimitReached);
    } else if (result.error === 'already_invited') {
      Alert.alert(uiCopy.common.error, uiCopy.alerts.invitationAlreadyInvited);
    } else if (result.error === 'already_member') {
      Alert.alert(uiCopy.common.error, uiCopy.alerts.invitationAlreadyMember);
    } else if (result.error === 'owner_only') {
      Alert.alert(uiCopy.common.error, uiCopy.alerts.invitationOwnerOnly);
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

  const handleResendInvitation = async (invitation: InvitationRow) => {
    if (!organizationId || !invitation.email || !invitation.token || invitation.status !== 'pending') return;
    const cooldownUntil = resendInvitationCooldownUntil[invitation.id] ?? 0;
    if (Date.now() < cooldownUntil) return;
    setResendingInvitationId(invitation.id);
    const result = await resendInviteEmail({
      email: invitation.email,
      token: invitation.token,
      type: 'org_invitation',
      organization_id: organizationId,
      invite_role: 'booker',
      orgName: orgName ?? undefined,
      inviterName: profile?.display_name ?? undefined,
    });
    setResendingInvitationId(null);
    setResendInvitationCooldownUntil((prev) => ({ ...prev, [invitation.id]: Date.now() + 4000 }));
    if (result.ok) {
      Alert.alert(uiCopy.common.success, uiCopy.inviteResend.success);
      return;
    }
    const fallbackLink = buildOrganizationInviteUrl(invitation.token);
    Alert.alert(
      uiCopy.common.error,
      `${uiCopy.inviteResend.error}: ${result.error}\n\n${uiCopy.alerts.invitationLink}: ${fallbackLink}\n\n${uiCopy.inviteResend.checkSpamHint}`,
    );
  };

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
        {organizationId && seatLimit !== undefined && (
          <Text style={s.metaText}>
            {seatLimit === null
              ? uiCopy.team.teamSeatsUnlimited
              : uiCopy.team.teamSeatsUsage(members.length, seatLimit)}
          </Text>
        )}
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
                {canInvite && i.email && i.token && (
                  <TouchableOpacity
                    style={[s.saveBtn, { marginTop: 0, paddingHorizontal: spacing.md }]}
                    onPress={() => {
                      void handleResendInvitation(i);
                    }}
                    disabled={resendingInvitationId === i.id || Date.now() < (resendInvitationCooldownUntil[i.id] ?? 0)}
                  >
                    <Text style={s.saveBtnLabel}>
                      {resendingInvitationId === i.id ? uiCopy.inviteResend.loading : uiCopy.inviteResend.cta}
                    </Text>
                  </TouchableOpacity>
                )}
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
  chatBubbleSystem: { alignSelf: 'center' as const, maxWidth: '92%', backgroundColor: '#E8E6E3' },
  chatBubbleSystemLabel: { ...typography.label, fontSize: 10, color: colors.textSecondary, marginBottom: 2, textAlign: 'center' as const },
  chatBubbleSystemText: { textAlign: 'center' as const },
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

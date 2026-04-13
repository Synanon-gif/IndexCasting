/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { handleTabPress, BOTTOM_TAB_BAR_HEIGHT } from '../navigation/bottomTabNavigation';
import { OptionNegotiationChatShell } from '../components/optionNegotiation/OptionNegotiationChatShell';
import { NegotiationMessageRow } from '../components/optionNegotiation/NegotiationMessageRow';
import { NegotiationChipsRow } from '../components/optionNegotiation/NegotiationChipsRow';
import { NegotiationSummaryCard } from '../components/optionNegotiation/NegotiationSummaryCard';
import { NegotiationThreadFooter } from '../components/optionNegotiation/NegotiationThreadFooter';
import { ConfirmDestructiveModal } from '../components/ConfirmDestructiveModal';
import { useDeviceType } from '../hooks/useDeviceType';
import { isMobileWidth } from '../theme/breakpoints';
import { shouldShowSystemMessageForViewer } from '../components/optionNegotiation/filterSystemMessagesForViewer';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Linking,
  Alert,
  Platform,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import {
  CHAT_MESSENGER_FLEX,
  CHAT_THREAD_LIST_FLEX,
  flexFillColumn,
  flexFillScrollWebWithMinHeight,
  shouldUseB2BWebSplit,
} from '../theme/chatLayout';
import { UI_DOUBLE_SUBMIT_DEBOUNCE_MS } from '../../lib/validation';
import { showAppAlert } from '../utils/crossPlatformAlert';
import { uiCopy } from '../constants/uiCopy';
import { normalizeDocumentspicturesModelImageRef } from '../utils/normalizeModelPortfolioUrl';
import {
  getPackageCoverRawRef,
  getPackageDisplayImages,
  normalizePackageType,
} from '../utils/packageDisplayMedia';
import { canonicalDisplayCityForModel } from '../utils/canonicalModelCity';
import {
  formatDateWithOptionalTimeRange,
  formatOptionTimeRangeSuffix,
  stripClockSeconds,
} from '../utils/formatTimeForUi';
import { getHeroResizeMode } from '../utils/discoverImageMode';
import { useAuth } from '../context/AuthContext';
import { getModelsForClient, getModelData } from '../services/apiService';
import {
  recordInteraction,
  getDiscoveryModels,
  loadSessionIds,
  saveSessionId,
  clearSessionIds,
  type DiscoveryModel,
  type DiscoveryCursor,
} from '../services/clientDiscoverySupabase';
import {
  getModelsNearLocation,
  roundCoord,
  type NearbyModel,
} from '../services/modelLocationsSupabase';
import {
  getGuestLink,
  getGuestLinkModels,
  type GuestLinkModel,
  type PackageType,
} from '../services/guestLinksSupabase';
import { isOrganizationOwner } from '../services/orgRoleTypes';
import { getAgencies, getAgencyChatDisplayById, type Agency } from '../services/agenciesSupabase';
import { AGENCY_SEGMENT_TYPES } from '../constants/agencyTypes';
import { type ModelFilters, defaultModelFilters } from '../utils/modelFilters';
import ModelFiltersPanel from '../components/ModelFiltersPanel';
import {
  getCalendarEntriesForClient,
  getBookingEventsAsCalendarEntries,
  type CalendarEntry,
  type ClientCalendarItem,
  type AgencyCalendarItem,
  type BookingDetails,
  updateBookingDetails,
  appendSharedBookingNote,
  type SharedBookingNote,
} from '../services/calendarSupabase';
import BookingBriefEditor from '../components/BookingBriefEditor';
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
import {
  loadClientProjects,
  saveClientProjects,
  loadClientActiveProjectId,
  saveClientActiveProjectId,
  loadClientFilters,
  saveClientFilters,
  type PersistedClientProject,
  type PersistedClientFilters,
} from '../storage/persistence';
import {
  saveFilterPresetToSupabase,
  loadFilterPresetFromSupabase,
} from '../services/clientFiltersSupabase';
import {
  addOptionRequest,
  getOptionRequests,
  subscribe,
  hasOpenOptionRequestAttention,
  getMessages,
  addMessage,
  getRequestByThreadId,
  getOptionRequestsByProjectId,
  getRequestStatus,
  agencyRejectNegotiationStore,
  clientRejectCounterStore,
  loadOptionRequestsForClient,
  purgeOptionThreadFromStore,
  refreshOptionRequestInCache,
  loadMessagesForThread,
  agencyConfirmAvailabilityStore,
  agencyAcceptClientPriceStore,
  agencyCounterOfferStore,
  agencyRejectClientPriceStore,
  clientAcceptCounterStore,
  clientConfirmJobStore,
  type ChatStatus,
} from '../store/optionRequests';
import {
  ensureClientAgencyChat,
  listB2BConversationsForOrganization,
  getB2BConversationTitleForViewer,
} from '../services/b2bOrgChatSupabase';
import {
  conversationHasUnreadForViewer,
  subscribeToConversation,
  type Conversation,
} from '../services/messengerSupabase';
import { deleteOptionRequestFull, sendAgencyInvitation } from '../services/optionRequestsSupabase';
import {
  ensureClientOrganization,
  getClientOrganizationIdForUser,
  listOrganizationMembers,
  updateOrganizationName,
  getOrganizationById,
  dissolveOrganization,
  getAgencyIdForOrganization,
} from '../services/organizationsInvitationsSupabase';
import { OrgProfileModal } from '../components/OrgProfileModal';
import {
  getClientAssignmentMapForAgency,
  upsertClientAssignmentFlag,
  type ClientAssignmentFlag,
  type AssignmentFlagColor,
} from '../services/clientAssignmentsSupabase';
import {
  removeModelFromProject,
  createProject as createProjectOnSupabase,
  deleteProject as deleteProjectOnSupabase,
  fetchHydratedClientProjectsForOrg,
  getProjectModels,
  addModelToProject as addModelToProjectOnSupabase,
} from '../services/projectsSupabase';
import { supabase } from '../../lib/supabase';
import { loadArchivedThreadIds, setThreadArchived } from '../services/threadPreferencesSupabase';
import { B2BUnifiedCalendarBody } from '../components/B2BUnifiedCalendarBody';
import type { CalendarViewMode } from '../components/CalendarViewModeBar';
import { OPTION_REQUEST_CHAT_STATUS_COLORS } from '../utils/calendarColors';
import { getCalendarDetailNextStepText } from '../utils/calendarDetailNextStep';
import {
  buildUnifiedAgencyCalendarRows,
  filterUnifiedAgencyCalendarRows,
  buildEventsByDateFromUnifiedRows,
  dedupeUnifiedRowsByOptionRequest,
  type AgencyCalendarTypeFilter,
  type UnifiedAgencyCalendarRow,
} from '../utils/agencyCalendarUnified';
import { attentionSignalsFromOptionRequestLike } from '../utils/optionRequestAttention';
import { attentionHeaderLabelFromSignals } from '../utils/negotiationAttentionLabels';
import { extractCounterparties } from '../utils/threadFilters';
import { toDisplayStatus } from '../utils/statusHelpers';
import { ClientOrganizationTeamSection } from '../components/ClientOrganizationTeamSection';
import { OrgMessengerInline } from '../components/OrgMessengerInline';
import { OrgMetricsPanel } from '../components/OrgMetricsPanel';
import { OwnerBillingStatusCard } from '../components/OwnerBillingStatusCard';
import { GlobalSearchBar } from '../components/GlobalSearchBar';
import { DashboardSummaryBar } from '../components/DashboardSummaryBar';
import { StorageImage } from '../components/StorageImage';
import { ClientOrgProfileScreen } from '../screens/ClientOrgProfileScreen';
import {
  isCalendarThreadUuid,
  resolveCanonicalOptionRequestIdForCalendarItem,
  resolveCanonicalOptionRequestIdFromBookingCalendarEntry,
} from '../utils/calendarThreadDeepLink';
import {
  agencyNegotiationThreadSummaryHint,
  optionConfirmedBannerLabel,
} from '../utils/modelAccountNegotiationCopy';

/** Signed-URL lifetime for authenticated client views of model photos (private bucket). */
const CLIENT_MODEL_IMAGE_TTL_SEC = 3600;

/** Thin wrapper to pass client org metrics panel with owner role. */
const ClientOrgMetricsPanelWrapper: React.FC<{ orgId: string }> = ({ orgId }) => (
  <OrgMetricsPanel orgId={orgId} userRole="owner" />
);

type AssignmentFilters = {
  scope: 'all' | 'mine' | 'unassigned';
  flagLabel: string;
  assignedMemberUserId: string;
};

/** Client Dashboard Tab — GlobalSearch + summary badges + quick-nav. */
const ClientDashboardTab: React.FC<{
  orgId: string | null;
  userId: string | null;
  onNavigateMessages: () => void;
  onNavigateCalendar: () => void;
  onNavigateRequests: () => void;
  onSelectConversation: (id: string) => void;
  onSelectOption: (id: string) => void;
  onSelectModel: (id: string) => void;
}> = ({
  orgId,
  userId,
  onNavigateMessages,
  onNavigateCalendar,
  onNavigateRequests,
  onSelectConversation,
  onSelectOption,
  onSelectModel,
}) => (
  <View style={{ flex: 1 }}>
    {orgId && (
      <View
        style={{
          paddingHorizontal: spacing.sm,
          paddingTop: spacing.xs,
          paddingBottom: spacing.xs,
          zIndex: 200,
        }}
      >
        <GlobalSearchBar
          orgId={orgId}
          onSelectModel={onSelectModel}
          onSelectConversation={onSelectConversation}
          onSelectOption={onSelectOption}
        />
      </View>
    )}
    {orgId && userId && (
      <DashboardSummaryBar
        orgId={orgId}
        userId={userId}
        onPressRequests={onNavigateRequests}
        onPressMessages={onNavigateMessages}
        onPressCalendar={onNavigateCalendar}
      />
    )}
    {!orgId && (
      <View style={{ padding: spacing.md }}>
        <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
          No organization assigned. Please contact support.
        </Text>
      </View>
    )}
  </View>
);

type TopTab =
  | 'dashboard'
  | 'discover'
  | 'projects'
  | 'agencies'
  | 'messages'
  | 'calendar'
  | 'team'
  | 'profile';

/** Same tab set on narrow and wide web — narrow uses horizontal scroll. */
const CLIENT_PRIMARY_BOTTOM_TABS: TopTab[] = [
  'dashboard',
  'discover',
  'messages',
  'calendar',
  'agencies',
  'projects',
  'profile',
];

function labelForClientBottomTab(key: TopTab): string {
  switch (key) {
    case 'dashboard':
      return uiCopy.clientWeb.bottomTabs.dashboard;
    case 'discover':
      return uiCopy.clientWeb.bottomTabs.discover;
    case 'projects':
      return uiCopy.clientWeb.bottomTabs.projects;
    case 'calendar':
      return uiCopy.clientWeb.bottomTabs.calendar;
    case 'agencies':
      return uiCopy.clientWeb.bottomTabs.agencies;
    case 'team':
      return uiCopy.clientWeb.bottomTabs.team;
    case 'profile':
      return uiCopy.clientWeb.bottomTabs.profile;
    case 'messages':
    default:
      return uiCopy.clientWeb.bottomTabs.messages;
  }
}

type ModelSummary = {
  id: string;
  name: string;
  /** models.city fallback; prefer summaryDisplayCity() for UI */
  city: string;
  /** RPC / near-me resolved canonical city (model_locations priority) when known */
  effective_city?: string | null;
  countryCode?: string | null;
  hasRealLocation?: boolean;
  hairColor: string;
  height: number;
  bust: number;
  waist: number;
  hips: number;
  chest: number;
  legsInseam: number;
  coverUrl: string;
  agencyId?: string | null;
  agencyName?: string | null;
  isSportsWinter?: boolean;
  isSportsSummer?: boolean;
  sex?: 'male' | 'female' | null;
};

function summaryDisplayCity(m: ModelSummary): string {
  return canonicalDisplayCityForModel({ effective_city: m.effective_city, city: m.city });
}

type ClientWebAppProps = {
  clientType: 'fashion' | 'commercial';
  onClientTypeChange: (t: 'fashion' | 'commercial') => void;
  onBackToRoleSelection: () => void;
};

type Project = {
  id: string;
  name: string;
  models: ModelSummary[];
  /** `client_projects.owner_id` — RLS allows DELETE only when this equals auth uid. */
  ownerId?: string;
};

type MediaslideModel = {
  id: string;
  name: string;
  measurements: {
    height: number;
    chest: number;
    waist: number;
    hips: number;
  };
  portfolio: {
    images: string[];
    polaroids: string[];
  };
  calendar: {
    blocked: string[];
    available: string[];
  };
};

// ModelFilters type, defaultModelFilters and FILTER_COUNTRIES are imported from '../utils/modelFilters'.

/** How many cards before the end of the list trigger a paginated load-more call. */
const LOAD_MORE_THRESHOLD = 10;

/** Maps a raw DiscoveryModel (from the RPC) to the app-local ModelSummary shape. */
function mapDiscoveryModelToSummary(m: DiscoveryModel): ModelSummary {
  const firstImg = m.portfolio_images?.[0] ?? '';
  return {
    id: m.id,
    name: m.name,
    effective_city: m.effective_city ?? null,
    city: m.city ?? '',
    hairColor: m.hair_color ?? '',
    height: m.height,
    bust: m.bust ?? 0,
    waist: m.waist ?? 0,
    hips: m.hips ?? 0,
    chest: m.chest ?? m.bust ?? 0,
    legsInseam: m.legs_inseam ?? 0,
    coverUrl: firstImg ? normalizeDocumentspicturesModelImageRef(firstImg, m.id) : '',
    agencyId: m.territory_agency_id ?? m.agency_id ?? null,
    agencyName: m.agency_name ?? null,
    countryCode: m.country_code ?? m.territory_country_code ?? null,
    hasRealLocation: !!m.country_code,
    isSportsWinter: m.is_sports_winter ?? false,
    isSportsSummer: m.is_sports_summer ?? false,
    sex: m.sex ?? null,
  };
}

/** localStorage-Modelle ohne chest/legsInseam → volles ModelSummary für die App */
function persistedProjectsToProjects(list: PersistedClientProject[]): Project[] {
  return list.map((p) => ({
    id: p.id,
    name: p.name,
    ownerId: undefined,
    models: p.models.map((m) => ({
      ...m,
      chest: 0,
      legsInseam: 0,
      agencyId: undefined,
    })),
  }));
}

function projectsToPersisted(list: Project[]): PersistedClientProject[] {
  return list.map((p) => ({
    id: p.id,
    name: p.name,
    models: p.models.map(
      ({ id, name, city, effective_city, hairColor, height, bust, waist, hips, coverUrl }) => ({
        id,
        name,
        city,
        ...(effective_city != null && String(effective_city).trim() !== ''
          ? { effective_city }
          : {}),
        hairColor,
        height,
        bust,
        waist,
        hips,
        coverUrl,
      }),
    ),
  }));
}

export const ClientWebApp: React.FC<ClientWebAppProps> = ({
  clientType: _clientType,
  onClientTypeChange: _onClientTypeChange,
  onBackToRoleSelection,
}) => {
  const auth = useAuth();
  const { width: clientWindowWidth, height: clientWindowHeight } = useWindowDimensions();
  const clientIsMobile = isMobileWidth(clientWindowWidth);
  /** Mobile: 16px horizontal — readable touch targets without wasting width like oversized gutters. */
  const shellPaddingH = clientIsMobile ? spacing.md : spacing.lg;
  const [tab, setTab] = useState<TopTab>(() =>
    typeof window !== 'undefined' && isMobileWidth(window.innerWidth) ? 'messages' : 'dashboard',
  );
  /** True when MessagesView is in fullscreen-chat mode on mobile — hides the bottom tab bar. */
  const [clientChatFullscreen, setClientChatFullscreen] = useState(false);
  // Reset fullscreen flag whenever the user navigates away from the messages tab.
  // Without this, a stuck `true` value would keep the bottom nav hidden on unrelated tabs.
  useEffect(() => {
    if (tab !== 'messages') setClientChatFullscreen(false);
  }, [tab]);
  const [mobileWorkspaceMenuOpen, setMobileWorkspaceMenuOpen] = useState(false);
  const [showActiveOptions, setShowActiveOptions] = useState(false);
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [projects, setProjects] = useState<Project[]>(() =>
    persistedProjectsToProjects(loadClientProjects()),
  );
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() =>
    loadClientActiveProjectId(),
  );
  const [newProjectName, setNewProjectName] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<MediaslideModel | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  /** True while My Projects "Create" is awaiting Supabase (prevents double-submit / dead taps). */
  const [projectCreateBusy, setProjectCreateBusy] = useState(false);
  const [filters, setFilters] = useState<ModelFilters>(() => {
    const saved = loadClientFilters();
    if (saved) {
      return {
        ...defaultModelFilters,
        sex: (saved as any).sex ?? 'all',
        heightMin: (saved as any).heightMin ?? '',
        heightMax: (saved as any).heightMax ?? '',
        ethnicities: (saved as any).ethnicities ?? [],
        countryCode: saved.countryCode ?? '',
        city: saved.city ?? '',
        nearby: saved.nearby ?? false,
        category: (saved as any).category ?? '',
        sportsWinter: (saved as any).sportsWinter ?? false,
        sportsSummer: (saved as any).sportsSummer ?? false,
        hairColor: (saved as any).hairColor ?? '',
        hipsMin: (saved as any).hipsMin ?? '',
        hipsMax: (saved as any).hipsMax ?? '',
        waistMin: (saved as any).waistMin ?? '',
        waistMax: (saved as any).waistMax ?? '',
        chestMin: (saved as any).chestMin ?? '',
        chestMax: (saved as any).chestMax ?? '',
        legsInseamMin: (saved as any).legsInseamMin ?? '',
        legsInseamMax: (saved as any).legsInseamMax ?? '',
      };
    }
    return defaultModelFilters;
  });
  const [filterSaveStatus, setFilterSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const [sharedProjectId, setSharedProjectId] = useState<string | null>(null);
  const [packageViewState, setPackageViewState] = useState<{
    packageId: string;
    name: string;
    models: ModelSummary[];
    guestLink: string;
    packageType: PackageType;
    rawModels: GuestLinkModel[];
  } | null>(null);
  const [projectOverviewId, setProjectOverviewId] = useState<string | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [pendingModel, setPendingModel] = useState<ModelSummary | null>(null);
  const [addingModelIds, setAddingModelIds] = useState<Set<string>>(new Set());
  const [optionDatePickerOpen, setOptionDatePickerOpen] = useState(false);
  const [optionDateModel, setOptionDateModel] = useState<ModelSummary | null>(null);
  const [openThreadIdOnMessages, setOpenThreadIdOnMessages] = useState<string | null>(null);
  /** Where to return when closing fullscreen option negotiation (Back). */
  const optionChatReturnRef = useRef<
    { kind: 'list' } | { kind: 'tab'; tab: TopTab; restore?: () => void } | null
  >(null);
  const [pendingClientB2BChat, setPendingClientB2BChat] = useState<{
    conversationId: string;
    title: string;
  } | null>(null);
  const [isChatWithAgencyLoading, setIsChatWithAgencyLoading] = useState(false);
  const [hasNew, setHasNew] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Measured height of the absolute bottom tab bar (may wrap on narrow web). */
  const [clientBottomTabBarHeight, setClientBottomTabBarHeight] = useState(BOTTOM_TAB_BAR_HEIGHT);
  const [msgFilter, setMsgFilter] = useState<'current' | 'archived'>('current');
  const [userCity, setUserCity] = useState<string | null>(null);
  /** Rounded approximate lat/lng for Near me radius queries (~5 km precision). Never exact GPS. */
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  /** Near me models fetched from the radius RPC (separate from territory-based baseModels). */
  const [nearbyModels, setNearbyModels] = useState<ModelSummary[]>([]);
  const [nearbyLoadFailed, setNearbyLoadFailed] = useState(false);
  const [discoveryLoadMoreFailed, setDiscoveryLoadMoreFailed] = useState(false);
  /**
   * GDPR: user has consented to location data being sent to Nominatim (OpenStreetMap).
   * Stored in localStorage so it persists across sessions.
   */
  const [geoConsentGiven, setGeoConsentGiven] = useState<boolean>(
    () => typeof window !== 'undefined' && window.localStorage.getItem('ic_geo_consent_v1') === '1',
  );
  const [showGeoConsentBanner, setShowGeoConsentBanner] = useState(false);
  const [calendarItems, setCalendarItems] = useState<ClientCalendarItem[]>([]);
  const [manualCalendarEvents, setManualCalendarEvents] = useState<UserCalendarEvent[]>([]);
  const [bookingEventEntries, setBookingEventEntries] = useState<CalendarEntry[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [selectedCalendarItem, setSelectedCalendarItem] = useState<ClientCalendarItem | null>(null);
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
  const [savingManualEvent, setSavingManualEvent] = useState(false);
  const [clientNotesDraft, setClientNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [clientSharedNoteDraft, setClientSharedNoteDraft] = useState('');
  const [savingSharedNoteClient, setSavingSharedNoteClient] = useState(false);
  const lastAppendSharedNoteAtRef = useRef(0);
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
  /** UUID of the client organisation this user belongs to (owner or employee). */
  const [clientOrgId, setClientOrgId] = useState<string | null>(null);
  const [assignmentByClientOrgId, setAssignmentByClientOrgId] = useState<
    Record<string, ClientAssignmentFlag>
  >({});
  const [assignableMembers, setAssignableMembers] = useState<
    Array<{ userId: string; name: string }>
  >([]);
  const agencyOrgId =
    auth?.profile?.org_type === 'agency' ? (auth.profile.organization_id ?? null) : null;

  const realClientId = auth?.profile?.role === 'client' && auth.profile.id ? auth.profile.id : null;
  const isRealClient = !!realClientId;

  /**
   * Model IDs already shown in the current discovery session.
   * Persisted to localStorage so sessions survive page refreshes.
   * Stored in a ref to avoid triggering re-renders on every swipe.
   */
  const sessionSeenIds = useRef<Set<string>>(new Set());

  /** Prevents concurrent paginated load-more fetches. */
  const isLoadingMoreRef = useRef(false);

  /** Cursor for keyset pagination — updated after each successful ranked load. */
  const [discoveryCursor, setDiscoveryCursor] = useState<DiscoveryCursor>(null);

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

  /** Keep calendar detail overlay aligned with latest fetch (status, booking_details) without name-based lookup. */
  useEffect(() => {
    setSelectedCalendarItem((prev) => {
      if (!prev) return prev;
      const fresh = calendarItems.find((x) => x.option.id === prev.option.id);
      if (!fresh) return prev;
      const sameOpt = prev.option.updated_at === fresh.option.updated_at;
      const sameCe =
        prev.calendar_entry?.id === fresh.calendar_entry?.id &&
        JSON.stringify(prev.calendar_entry?.booking_details ?? null) ===
          JSON.stringify(fresh.calendar_entry?.booking_details ?? null);
      return sameOpt && sameCe ? prev : fresh;
    });
  }, [calendarItems]);

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

  useEffect(() => {
    if (!agencyOrgId) {
      setAssignmentByClientOrgId({});
      setAssignableMembers([]);
      return;
    }
    void getClientAssignmentMapForAgency(agencyOrgId).then(setAssignmentByClientOrgId);
    void listOrganizationMembers(agencyOrgId).then((rows) => {
      setAssignableMembers(
        rows.map((row) => ({
          userId: row.user_id,
          name: row.display_name ?? row.email ?? 'Member',
        })),
      );
    });
  }, [agencyOrgId]);

  /**
   * GDPR-compliant geolocation:
   * Only triggered when the user explicitly enables "Near me" AND has consented
   * to sharing their location with OpenStreetMap Nominatim (third-party geocoder).
   * If no consent has been recorded yet, the consent banner is shown first.
   */
  useEffect(() => {
    if (!filters.nearby) return;
    if (!navigator.geolocation) return;
    // If coordinates are already resolved, skip re-requesting.
    if (userLat !== null && userLng !== null) return;

    if (!geoConsentGiven) {
      setShowGeoConsentBanner(true);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          // Round coordinates before storing and before sending to any external API (privacy).
          const lat = roundCoord(pos.coords.latitude);
          const lng = roundCoord(pos.coords.longitude);
          setUserLat(lat);
          setUserLng(lng);

          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
            { headers: { 'Accept-Language': 'en', 'User-Agent': 'IndexCasting/1.0' } },
          );
          const data = await res.json();
          const city = data.address?.city || data.address?.town || data.address?.village || null;
          if (city) setUserCity(city);
        } catch (e) {
          console.warn('[geolocation] reverse geocoding failed:', e);
        }
      },
      (err) => {
        console.warn('[geolocation] position error:', err.code, err.message);
      },
      { timeout: 10000 },
    );
  }, [filters.nearby, geoConsentGiven, userLat, userLng]);

  // Sync projects FROM Supabase when the client org is resolved (authenticated clients only).
  // DB (`client_projects` + `client_project_models`) is source of truth; localStorage is fallback until org id exists (e.g. guests).
  useEffect(() => {
    if (!clientOrgId || !realClientId) return;
    void (async () => {
      try {
        const hydrated = await fetchHydratedClientProjectsForOrg(clientOrgId);
        const merged: Project[] = hydrated.map((h) => ({
          id: h.id,
          name: h.name,
          ownerId: h.owner_id,
          models: h.models as ModelSummary[],
        }));
        setProjects(merged);
        setActiveProjectId((prev) => {
          if (!prev) return null;
          return merged.some((p) => p.id === prev) ? prev : null;
        });
      } catch (e) {
        console.error('ClientWebApp: failed to sync projects from Supabase', e);
      }
    })();
  }, [clientOrgId, realClientId]);

  // Persist client projects and selection to localStorage (survives refresh / offline)
  useEffect(() => {
    saveClientProjects(projectsToPersisted(projects));
  }, [projects]);

  useEffect(() => {
    saveClientActiveProjectId(activeProjectId);
  }, [activeProjectId]);

  // Auto-save ALL filters to localStorage on every change.
  useEffect(() => {
    const persisted: PersistedClientFilters = {
      sex: filters.sex,
      heightMin: filters.heightMin,
      heightMax: filters.heightMax,
      ethnicities: filters.ethnicities,
      countryCode: filters.countryCode,
      city: filters.city,
      nearby: filters.nearby,
      category: filters.category,
      sportsWinter: filters.sportsWinter,
      sportsSummer: filters.sportsSummer,
      hairColor: filters.hairColor,
      hipsMin: filters.hipsMin,
      hipsMax: filters.hipsMax,
      waistMin: filters.waistMin,
      waistMax: filters.waistMax,
      chestMin: filters.chestMin,
      chestMax: filters.chestMax,
      legsInseamMin: filters.legsInseamMin,
      legsInseamMax: filters.legsInseamMax,
    };
    saveClientFilters(persisted);
  }, [
    filters.sex,
    filters.heightMin,
    filters.heightMax,
    filters.ethnicities,
    filters.countryCode,
    filters.city,
    filters.nearby,
    filters.category,
    filters.sportsWinter,
    filters.sportsSummer,
    filters.hairColor,
    filters.hipsMin,
    filters.hipsMax,
    filters.waistMin,
    filters.waistMax,
    filters.chestMin,
    filters.chestMax,
    filters.legsInseamMin,
    filters.legsInseamMax,
  ]);

  // Resolve the client organisation for this user (owner or employee).
  // profile.organization_id is loaded by AuthContext via get_my_org_context() —
  // it already covers both owners and employees without an additional RPC call.
  useEffect(() => {
    if (!realClientId) {
      setClientOrgId(null);
      return;
    }
    const profileOrgId = auth.profile?.organization_id;
    if (profileOrgId) {
      setClientOrgId(profileOrgId);
      sessionSeenIds.current = loadSessionIds(profileOrgId);
      return;
    }
    // Fallback: org not yet bootstrapped (e.g. brand-new owner) — create it.
    void (async () => {
      try {
        const oid = await ensureClientOrganization();
        setClientOrgId(oid);
        if (oid) {
          sessionSeenIds.current = loadSessionIds(oid);
        }
      } catch (e) {
        console.error('ClientWebApp: failed to resolve clientOrgId', e);
      }
    })();
  }, [realClientId, auth.profile?.organization_id]);

  // Save filters to Supabase (explicit user action via "Save Filters" button).
  const handleSaveFilters = useCallback(async () => {
    setFilterSaveStatus('saving');
    const preset: PersistedClientFilters = {
      sex: filters.sex,
      heightMin: filters.heightMin,
      heightMax: filters.heightMax,
      ethnicities: filters.ethnicities,
      countryCode: filters.countryCode,
      city: filters.city,
      nearby: filters.nearby,
      category: filters.category,
      sportsWinter: filters.sportsWinter,
      sportsSummer: filters.sportsSummer,
      hairColor: filters.hairColor,
      hipsMin: filters.hipsMin,
      hipsMax: filters.hipsMax,
      waistMin: filters.waistMin,
      waistMax: filters.waistMax,
      chestMin: filters.chestMin,
      chestMax: filters.chestMax,
      legsInseamMin: filters.legsInseamMin,
      legsInseamMax: filters.legsInseamMax,
    };
    const ok = await saveFilterPresetToSupabase(preset);
    setFilterSaveStatus(ok ? 'saved' : 'error');
    setTimeout(() => setFilterSaveStatus('idle'), 3000);
  }, [filters]);

  // Load saved filter preset from Supabase on mount (if user is authenticated).
  useEffect(() => {
    if (!realClientId) return;
    loadFilterPresetFromSupabase().then((preset) => {
      if (!preset) return;
      setFilters((prev) => ({
        ...prev,
        sex: preset.sex ?? prev.sex,
        countryCode: preset.countryCode ?? prev.countryCode,
        city: preset.city ?? prev.city,
        nearby: preset.nearby ?? prev.nearby,
        category: preset.category ?? prev.category,
        sportsWinter: preset.sportsWinter ?? prev.sportsWinter,
        sportsSummer: preset.sportsSummer ?? prev.sportsSummer,
        hairColor: preset.hairColor ?? prev.hairColor,
        hipsMin: preset.hipsMin ?? prev.hipsMin,
        hipsMax: preset.hipsMax ?? prev.hipsMax,
        waistMin: preset.waistMin ?? prev.waistMin,
        waistMax: preset.waistMax ?? prev.waistMax,
        chestMin: preset.chestMin ?? prev.chestMin,
        chestMax: preset.chestMax ?? prev.chestMax,
        legsInseamMin: preset.legsInseamMin ?? prev.legsInseamMin,
        legsInseamMax: preset.legsInseamMax ?? prev.legsInseamMax,
      }));
    });
  }, [realClientId]);

  const loadClientCalendar = async () => {
    if (!realClientId) {
      setCalendarItems([]);
      setManualCalendarEvents([]);
      setBookingEventEntries([]);
      return;
    }
    setCalendarLoading(true);
    try {
      const [items, personalEvents, orgEvents, beEntries] = await Promise.all([
        getCalendarEntriesForClient(realClientId),
        getManualEventsForOwner(realClientId, 'client'),
        clientOrgId ? getManualEventsForOrg(clientOrgId, 'client') : Promise.resolve([]),
        // booking_events.client_org_id is an organizations.id, not auth.uid().
        clientOrgId
          ? getBookingEventsAsCalendarEntries(clientOrgId, 'client')
          : Promise.resolve([]),
      ]);
      // Merge personal and org events, deduplicating by id.
      const seen = new Set<string>();
      const merged: UserCalendarEvent[] = [];
      for (const ev of [...orgEvents, ...personalEvents]) {
        if (!seen.has(ev.id)) {
          seen.add(ev.id);
          merged.push(ev);
        }
      }
      merged.sort(
        (a, b) =>
          a.date.localeCompare(b.date) || (a.start_time ?? '').localeCompare(b.start_time ?? ''),
      );
      setCalendarItems(items);
      setManualCalendarEvents(merged);
      setBookingEventEntries(beEntries);
    } finally {
      setCalendarLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'calendar') {
      loadClientCalendar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, realClientId, clientOrgId]);

  useEffect(() => {
    if (realClientId) {
      void loadOptionRequestsForClient(clientOrgId);
    }
  }, [realClientId, clientOrgId]);

  // Refresh option threads when opening Messages (reliable after navigation / background tab).
  useEffect(() => {
    if (realClientId && tab === 'messages') {
      void loadOptionRequestsForClient(clientOrgId);
    }
  }, [tab, realClientId, clientOrgId]);

  useEffect(() => {
    // Reset session dedup on every new filter-driven query (new discovery context).
    if (clientOrgId) {
      clearSessionIds(clientOrgId);
    }
    sessionSeenIds.current = new Set();
    setCurrentIndex(0);
    setDiscoveryCursor(null);
    setDiscoveryLoadMoreFailed(false);

    void (async () => {
      const countryIso = filters.countryCode.trim() || undefined;
      const cityFilter = countryIso && filters.city.trim() ? filters.city.trim() : undefined;

      // Derive effective clientType / category from unified category filter.
      const cat = filters.category;
      const effectiveClientType = !cat ? 'all' : cat === 'Commercial' ? 'commercial' : 'fashion';
      const effectiveCategory = cat === 'High Fashion' ? 'High Fashion' : undefined;

      // Convert height range strings → numeric values for backend filtering.
      const pInt = (v: string) => {
        const n = parseInt(v, 10);
        return isNaN(n) ? undefined : n;
      };

      const measurementFilters = {
        heightMin: pInt(filters.heightMin),
        heightMax: pInt(filters.heightMax),
        ethnicities: filters.ethnicities.length ? filters.ethnicities : undefined,
        hairColor: filters.hairColor.trim() || undefined,
        hipsMin: pInt(filters.hipsMin),
        hipsMax: pInt(filters.hipsMax),
        waistMin: pInt(filters.waistMin),
        waistMax: pInt(filters.waistMax),
        chestMin: pInt(filters.chestMin),
        chestMax: pInt(filters.chestMax),
        legsInseamMin: pInt(filters.legsInseamMin),
        legsInseamMax: pInt(filters.legsInseamMax),
        sex: (filters.sex !== 'all' ? filters.sex : undefined) as 'male' | 'female' | undefined,
      };

      // Ranked discovery: use get_discovery_models RPC when a client org +
      // country code are known. Falls back to the unranked legacy path otherwise.
      if (clientOrgId && countryIso) {
        const discoveryFilters = {
          countryCode: countryIso,
          clientCity: userCity ?? null,
          category: effectiveCategory ?? null,
          sportsWinter: filters.sportsWinter || false,
          sportsSummer: filters.sportsSummer || false,
          ...measurementFilters,
        };

        const { models: ranked, nextCursor } = await getDiscoveryModels(
          clientOrgId,
          discoveryFilters,
          null,
          sessionSeenIds.current,
        );

        if (ranked.length === 0 && sessionSeenIds.current.size > 0) {
          // Empty-state recovery: session had IDs that excluded everything.
          // Clear session and try one more time without exclusion.
          clearSessionIds(clientOrgId);
          sessionSeenIds.current = new Set();
          const { models: recovered, nextCursor: recoveredCursor } = await getDiscoveryModels(
            clientOrgId,
            discoveryFilters,
            null,
            new Set(),
          );
          setModels(recovered.map(mapDiscoveryModelToSummary));
          setDiscoveryCursor(recoveredCursor);
          return;
        }

        setModels(ranked.map(mapDiscoveryModelToSummary));
        setDiscoveryCursor(nextCursor);
        return;
      }

      // Legacy unranked path (no clientOrgId resolved yet, or no country filter).
      const data: any[] = await getModelsForClient(
        effectiveClientType,
        countryIso,
        cityFilter,
        effectiveCategory,
        filters.sportsWinter || undefined,
        filters.sportsSummer || undefined,
        measurementFilters,
      );
      const mapped: ModelSummary[] = data.map((m: any) => ({
        id: m.id,
        name: m.name,
        effective_city: m.effective_city ?? null,
        city: m.city ?? '',
        hairColor: m.hairColor ?? m.hair_color ?? '',
        height: m.height,
        bust: m.bust ?? 0,
        waist: m.waist ?? 0,
        hips: m.hips ?? 0,
        chest: m.chest ?? m.bust ?? 0,
        legsInseam: m.legsInseam ?? m.legs_inseam ?? 0,
        coverUrl: normalizeDocumentspicturesModelImageRef(m.gallery?.[0] ?? '', m.id),
        agencyId: m.agencyId ?? m.agency_id ?? null,
        agencyName: m.agencyName ?? m.agency_name ?? null,
        countryCode: m.countryCode ?? null,
        hasRealLocation: m.hasRealLocation ?? false,
        isSportsWinter: m.isSportsWinter ?? false,
        isSportsSummer: m.isSportsSummer ?? false,
        sex: m.sex ?? null,
      }));
      setModels(mapped);
    })();
  }, [
    clientOrgId,
    filters.sex,
    filters.heightMin,
    filters.heightMax,
    filters.ethnicities,
    filters.countryCode,
    filters.city,
    filters.category,
    filters.sportsWinter,
    filters.sportsSummer,
    filters.hairColor,
    filters.hipsMin,
    filters.hipsMax,
    filters.waistMin,
    filters.waistMax,
    filters.chestMin,
    filters.chestMax,
    filters.legsInseamMin,
    filters.legsInseamMax,
    userCity,
  ]);

  // Load next page of ranked discovery results when the user approaches the end of the list.
  // Only active for the ranked discovery path (clientOrgId + countryCode); not for nearby,
  // package views, or shared project views.
  useEffect(() => {
    if (
      !discoveryCursor ||
      !clientOrgId ||
      isLoadingMoreRef.current ||
      filteredModels.length === 0 ||
      filters.nearby ||
      packageViewState != null ||
      sharedProjectId != null
    )
      return;

    const remaining = filteredModels.length - 1 - currentIndex;
    if (remaining > LOAD_MORE_THRESHOLD) return;

    const countryIso = filters.countryCode.trim();
    if (!countryIso) return;

    isLoadingMoreRef.current = true;
    const cat = filters.category;
    const effectiveCategory = cat === 'High Fashion' ? 'High Fashion' : undefined;
    const pInt = (v: string) => {
      const n = parseInt(v, 10);
      return isNaN(n) ? undefined : n;
    };

    void (async () => {
      try {
        const { models: more, nextCursor } = await getDiscoveryModels(
          clientOrgId,
          {
            countryCode: countryIso,
            clientCity: userCity ?? null,
            category: effectiveCategory ?? null,
            sportsWinter: filters.sportsWinter || false,
            sportsSummer: filters.sportsSummer || false,
            heightMin: pInt(filters.heightMin),
            heightMax: pInt(filters.heightMax),
            ethnicities: filters.ethnicities.length ? filters.ethnicities : undefined,
            hairColor: filters.hairColor.trim() || undefined,
            hipsMin: pInt(filters.hipsMin),
            hipsMax: pInt(filters.hipsMax),
            waistMin: pInt(filters.waistMin),
            waistMax: pInt(filters.waistMax),
            chestMin: pInt(filters.chestMin),
            chestMax: pInt(filters.chestMax),
            legsInseamMin: pInt(filters.legsInseamMin),
            legsInseamMax: pInt(filters.legsInseamMax),
            sex: (filters.sex !== 'all' ? filters.sex : undefined) as 'male' | 'female' | undefined,
          },
          discoveryCursor,
          sessionSeenIds.current,
        );
        if (more.length > 0) {
          setDiscoveryLoadMoreFailed(false);
          setModels((prev) => [...prev, ...more.map(mapDiscoveryModelToSummary)]);
          setDiscoveryCursor(nextCursor);
        } else {
          setDiscoveryLoadMoreFailed(false);
          setDiscoveryCursor(null);
        }
      } catch (e) {
        console.error('[Discovery] loadMore error:', e);
        setDiscoveryLoadMoreFailed(true);
      } finally {
        isLoadingMoreRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentIndex,
    discoveryCursor,
    clientOrgId,
    filters.nearby,
    packageViewState,
    sharedProjectId,
    userCity,
    filters.countryCode,
    filters.sex,
    filters.heightMin,
    filters.heightMax,
    filters.ethnicities,
    filters.category,
    filters.sportsWinter,
    filters.sportsSummer,
    filters.hairColor,
    filters.hipsMin,
    filters.hipsMax,
    filters.waistMin,
    filters.waistMax,
    filters.chestMin,
    filters.chestMax,
    filters.legsInseamMin,
    filters.legsInseamMax,
    models.length,
  ]);

  useEffect(() => {
    if (!filters.nearby) {
      setNearbyLoadFailed(false);
    }
  }, [filters.nearby]);

  // Radius-based Near me discovery — only when nearby toggle is active AND we have coordinates.
  useEffect(() => {
    if (!filters.nearby || userLat == null || userLng == null) {
      setNearbyModels([]);
      return;
    }
    setNearbyLoadFailed(false);
    void (async () => {
      try {
        const cat = filters.category;
        const effectiveClientType = !cat ? 'all' : cat === 'Commercial' ? 'commercial' : 'fashion';
        const effectiveCategory = cat === 'High Fashion' ? 'High Fashion' : undefined;
        const pInt = (v: string) => {
          const n = parseInt(v, 10);
          return isNaN(n) ? undefined : n;
        };
        const measurementFilters = {
          heightMin: pInt(filters.heightMin),
          heightMax: pInt(filters.heightMax),
          ethnicities: filters.ethnicities.length ? filters.ethnicities : undefined,
          hairColor: filters.hairColor.trim() || undefined,
          hipsMin: pInt(filters.hipsMin),
          hipsMax: pInt(filters.hipsMax),
          waistMin: pInt(filters.waistMin),
          waistMax: pInt(filters.waistMax),
          chestMin: pInt(filters.chestMin),
          chestMax: pInt(filters.chestMax),
          legsInseamMin: pInt(filters.legsInseamMin),
          legsInseamMax: pInt(filters.legsInseamMax),
          sex: (filters.sex !== 'all' ? filters.sex : undefined) as 'male' | 'female' | undefined,
        };
        const nearby: NearbyModel[] = await getModelsNearLocation(
          userLat,
          userLng,
          50,
          effectiveClientType as 'fashion' | 'commercial' | 'all',
          measurementFilters,
          effectiveCategory,
          filters.sportsWinter || undefined,
          filters.sportsSummer || undefined,
        );
        const mapped: ModelSummary[] = nearby.map((m) => ({
          id: m.id,
          name: m.name,
          effective_city: m.location_city ?? null,
          city: m.city ?? '',
          hairColor: m.hair_color ?? '',
          height: m.height,
          bust: m.bust ?? 0,
          waist: m.waist ?? 0,
          hips: m.hips ?? 0,
          chest: m.chest ?? m.bust ?? 0,
          legsInseam: m.legs_inseam ?? 0,
          coverUrl: normalizeDocumentspicturesModelImageRef(m.portfolio_images?.[0] ?? '', m.id),
          agencyId: m.territory_agency_id ?? m.agency_id ?? null,
          agencyName: m.agency_name ?? null,
          countryCode: m.location_country_code ?? null,
          hasRealLocation: true,
          isSportsWinter: m.is_sports_winter ?? false,
          isSportsSummer: m.is_sports_summer ?? false,
          sex: m.sex ?? null,
        }));
        setNearbyModels(mapped);
        setNearbyLoadFailed(false);
      } catch (e) {
        console.error('getModelsNearLocation error:', e);
        setNearbyLoadFailed(true);
        setNearbyModels([]);
      }
    })();
  }, [
    filters.nearby,
    userLat,
    userLng,
    filters.sex,
    filters.heightMin,
    filters.heightMax,
    filters.ethnicities,
    filters.category,
    filters.sportsWinter,
    filters.sportsSummer,
    filters.hairColor,
    filters.hipsMin,
    filters.hipsMax,
    filters.waistMin,
    filters.waistMax,
    filters.chestMin,
    filters.chestMax,
    filters.legsInseamMin,
    filters.legsInseamMax,
  ]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) || null,
    [projects, activeProjectId],
  );

  const sharedProject = useMemo(
    () => projects.find((p) => p.id === sharedProjectId) || null,
    [projects, sharedProjectId],
  );

  const isSharedMode = !!sharedProject;
  const isPackageMode = !!packageViewState;

  const baseModels = useMemo(
    () => packageViewState?.models ?? (sharedProject ? sharedProject.models : models),
    [packageViewState, sharedProject, models],
  );

  const filteredModels = useMemo(() => {
    // Package and shared-project modes require strict isolation — never apply discovery filters.
    // baseModels is already scoped to packageViewState.models or sharedProject.models.
    if (isPackageMode || isSharedMode) return baseModels;
    // When "Near me" is active and we have radius-based results → use nearbyModels (sorted by distance).
    // Fallback: if geolocation was denied but city is known → city-substring filter on baseModels.
    // Otherwise → use baseModels as-is (all server-side filters already applied).
    if (filters.nearby) {
      if (userLat != null && userLng != null) {
        return nearbyModels; // radius RPC results, already sorted by distance
      }
      if (userCity) {
        // Geolocation permission denied but city resolved via Nominatim
        return baseModels.filter((m) =>
          summaryDisplayCity(m).toLowerCase().includes(userCity.toLowerCase()),
        );
      }
    }
    return baseModels;
  }, [
    baseModels,
    nearbyModels,
    filters.nearby,
    userLat,
    userLng,
    userCity,
    isPackageMode,
    isSharedMode,
  ]);

  const discoverFilterMessages = useMemo(() => {
    if (isPackageMode || isSharedMode) return [];
    const out: { kind: 'warning' | 'error'; text: string }[] = [];
    const cityTrim = userCity?.trim() ?? '';
    if (filters.nearby && userLat == null && userLng == null && !cityTrim) {
      out.push({ kind: 'warning', text: uiCopy.dashboard.nearbyNeedsLocation });
    }
    if (nearbyLoadFailed && filters.nearby) {
      out.push({ kind: 'error', text: uiCopy.dashboard.nearbyLoadFailed });
    }
    if (discoveryLoadMoreFailed) {
      out.push({ kind: 'error', text: uiCopy.dashboard.discoveryLoadMoreFailed });
    }
    return out;
  }, [
    isPackageMode,
    isSharedMode,
    filters.nearby,
    userLat,
    userLng,
    userCity,
    nearbyLoadFailed,
    discoveryLoadMoreFailed,
  ]);

  useEffect(() => {
    if (detailId) {
      setDetailLoading(true);
      setDetailData(null);
      // Snapshot discover card cover at open — used only if getModelData still has no images.
      const card = filteredModels.find((m) => m.id === detailId);
      const coverFromDiscover =
        !packageViewState && !sharedProject ? card?.coverUrl?.trim() : undefined;
      getModelData(detailId)
        .then((data: any) => {
          if (packageViewState) {
            const raw = packageViewState.rawModels.find((m) => m.id === detailId);
            const correctImages = getPackageDisplayImages(raw, packageViewState.packageType);
            if (data) {
              setDetailData({
                ...data,
                portfolio: { ...data.portfolio, images: correctImages, polaroids: [] },
              });
            } else if (raw) {
              // Model not visible in discovery (different territory / incomplete profile) —
              // build MediaslideModel from package RPC data so the detail overlay still shows fully.
              setDetailData({
                id: raw.id,
                name: raw.name,
                measurements: {
                  height: raw.height ?? 0,
                  chest: (raw as { chest?: number | null }).chest ?? raw.bust ?? 0,
                  waist: raw.waist ?? 0,
                  hips: raw.hips ?? 0,
                },
                portfolio: { images: correctImages, polaroids: [] },
                calendar: { blocked: [], available: [] },
              });
            }
          } else if (sharedProject && !data) {
            // Shared-project mode: model not visible in discovery — build from ModelSummary.
            // sharedProject.models already contains the measurements from when the model was added.
            const summary = sharedProject.models.find((m) => m.id === detailId);
            if (summary) {
              setDetailData({
                id: summary.id,
                name: summary.name,
                measurements: {
                  height: summary.height,
                  chest: summary.chest ?? summary.bust ?? 0,
                  waist: summary.waist,
                  hips: summary.hips,
                },
                portfolio: {
                  images: summary.coverUrl
                    ? [normalizeDocumentspicturesModelImageRef(summary.coverUrl, summary.id)]
                    : [],
                  polaroids: [],
                },
                calendar: { blocked: [], available: [] },
              });
            }
          } else if (data && coverFromDiscover && !data.portfolio?.images?.length) {
            setDetailData({
              ...data,
              portfolio: {
                ...data.portfolio,
                images: [normalizeDocumentspicturesModelImageRef(coverFromDiscover, detailId)],
              },
            });
          } else {
            setDetailData(data);
          }
        })
        .finally(() => setDetailLoading(false));
    }
    // filteredModels: snapshot at detail open only (do not re-fetch detail on swipe).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: detailId-driven open
  }, [detailId, packageViewState, sharedProject]);

  const currentModel = useMemo(
    () => (filteredModels.length ? filteredModels[currentIndex % filteredModels.length] : null),
    [filteredModels, currentIndex],
  );

  useEffect(() => {
    if (currentIndex >= filteredModels.length) {
      setCurrentIndex(0);
    }
  }, [filteredModels.length, currentIndex]);

  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearFeedbackLater = () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 2400);
  };

  const createProjectInternal = async (name: string): Promise<Project | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (realClientId) {
      if (!clientOrgId) {
        setFeedback('Organization not ready. Please wait a moment and try again.');
        clearFeedbackLater();
        return null;
      }
      try {
        const remote = await createProjectOnSupabase(realClientId, trimmed, clientOrgId);
        if (!remote?.id) {
          setFeedback('Could not create project. Please try again.');
          clearFeedbackLater();
          return null;
        }
        const project: Project = {
          id: remote.id,
          name: trimmed,
          models: [],
          ownerId: remote.owner_id,
        };
        setProjects((prev) => [...prev, project]);
        setActiveProjectId(project.id);
        return project;
      } catch (e) {
        console.error('createProjectInternal: Supabase createProject failed', e);
        setFeedback('Could not create project. Please try again.');
        clearFeedbackLater();
        return null;
      }
    }
    const id = String(Date.now());
    const project: Project = { id, name: trimmed, models: [] };
    setProjects((prev) => [...prev, project]);
    setActiveProjectId(project.id);
    return project;
  };

  const createProject = async () => {
    const trimmed = newProjectName.trim();
    if (!trimmed) {
      setFeedback(uiCopy.projects.createNameRequired);
      clearFeedbackLater();
      return;
    }
    if (projectCreateBusy) return;
    setProjectCreateBusy(true);
    try {
      const created = await createProjectInternal(trimmed);
      if (!created) return;
      setNewProjectName('');
      setFeedback(`Created project "${created.name}".`);
      clearFeedbackLater();
    } finally {
      setProjectCreateBusy(false);
    }
  };

  // Server Reconciliation Refetch — Level 4 consistency guarantee.
  //
  // After a successful add/remove mutation, the DB is the source of truth.
  // This function fetches the canonical model ID list from client_project_models
  // and silently removes any in-memory models that are NOT in the DB (stale state).
  //
  // It does NOT add models we have no ModelSummary for — those would have no display
  // data. In practice this means: UI ≤ DB (we never show models that aren't in DB).
  //
  // Stable: setProjects is a stable setter, getProjectModels is a module import.
  const reconcileProjectModels = useCallback(async (projectId: string): Promise<void> => {
    try {
      const dbModelIds = await getProjectModels(projectId);
      const dbIdSet = new Set(dbModelIds);
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId ? { ...p, models: p.models.filter((m) => dbIdSet.has(m.id)) } : p,
        ),
      );
    } catch (e) {
      console.error('reconcileProjectModels: failed to sync from DB', e);
    }
  }, []);

  const handleDeleteProject = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    if (realClientId && project.ownerId != null && project.ownerId !== realClientId) {
      setFeedback('Only the teammate who created this project can delete it.');
      clearFeedbackLater();
      return;
    }
    const confirmed =
      typeof window !== 'undefined' ? window.confirm(uiCopy.projects.deleteConfirm) : true;
    if (!confirmed) return;

    // Level 3 — Inverse-Operation Rollback (NOT snapshot-based).
    //
    // Global snapshot breaks for (theoretically) concurrent deletes:
    //   Delete P1: snapshot=[P1,P2]  optimistic→[P2]
    //   Delete P2: snapshot=[P1,P2]  optimistic→[P1]  (React closure: same render)
    //   RPC_P1 fails → setProjects([P1,P2]) → P2 comes back even if RPC_P2 succeeds.
    //
    // In practice, window.confirm makes this scenario impossible. We apply the same
    // inverse pattern for consistency and to future-proof the handler.
    //
    // deletedProject is already captured as `project` above.
    // The prev.some() guard prevents double-insertion on concurrent rollbacks.
    const deletedProject = project;
    const prevActiveId = activeProjectId;

    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    if (activeProjectId === projectId) setActiveProjectId(null);

    void deleteProjectOnSupabase(projectId)
      .then((ok) => {
        if (ok) {
          setFeedback(`Deleted project "${deletedProject.name}".`);
          clearFeedbackLater();
        } else {
          // Inverse rollback: add back the deleted project only if it's not already there.
          setProjects((prev) =>
            prev.some((p) => p.id === projectId) ? prev : [...prev, deletedProject],
          );
          setActiveProjectId(prevActiveId);
          setFeedback('Could not delete project. Please try again.');
          clearFeedbackLater();
        }
      })
      .catch((e) => {
        console.error('handleDeleteProject: unexpected rejection', e);
        setProjects((prev) =>
          prev.some((p) => p.id === projectId) ? prev : [...prev, deletedProject],
        );
        setActiveProjectId(prevActiveId);
        setFeedback('Could not delete project.');
        clearFeedbackLater();
      });
  };

  const addModelToProject = (projectId: string, model: ModelSummary) => {
    // Inflight-lock per model.id — prevents double-click on the same model.
    if (addingModelIds.has(model.id)) return;
    setAddingModelIds((prev) => new Set(prev).add(model.id));

    // Level 3 — Inverse-Operation Rollback (NOT snapshot-based).
    //
    // Snapshot-based rollback (Level 2) breaks for concurrent adds to the same project:
    //   Add M1: projectPreAddModels=[]  optimistic→[M1]
    //   Add M2: projectPreAddModels=[]  optimistic→[M1,M2]  (React closure: same render)
    //   RPC_M1 fails → restore []  → M2 LOST even though RPC_M2 may still succeed.
    //
    // Inverse operation: on failure, filter OUT the specific model.id from live state.
    // No snapshot needed — the rollback reads from `prev` at the moment of execution.
    //
    // alreadyPresent guard: if the model was already in the project before this Add
    // (stale UI / idempotent RPC), a failed RPC must NOT remove it.
    const alreadyPresent =
      projects.find((p) => p.id === projectId)?.models.some((m) => m.id === model.id) ?? false;

    // Capture project name now (closure-safe; names rarely change mid-flight).
    const projectName = projects.find((p) => p.id === projectId)?.name;

    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? {
              ...p,
              models: p.models.some((m) => m.id === model.id) ? p.models : [...p.models, model],
            }
          : p,
      ),
    );

    // Persist to Supabase. The service NEVER throws — it returns false on error
    // (both supabase error and exception paths). .catch() would never fire.
    // MUST use .then(ok) to detect failure and trigger inverse-operation rollback.
    // Territory alignment: prefer per-model country (Discover card) over filter bar so
    // p_country_iso matches get_discovery_models / MAT — not only filters.countryCode.
    const countryIsoForRpcRaw = model.countryCode ?? filters.countryCode;
    const countryIsoForRpc = countryIsoForRpcRaw?.trim() ? countryIsoForRpcRaw.trim() : undefined;
    void addModelToProjectOnSupabase(
      projectId,
      model.id,
      clientOrgId?.trim() ? clientOrgId : undefined,
      countryIsoForRpc,
    )
      .then((result) => {
        setAddingModelIds((prev) => {
          const s = new Set(prev);
          s.delete(model.id);
          return s;
        });
        if (result.ok) {
          // Server reconciliation refetch: silently align UI with DB after successful add.
          // Removes any stale in-memory models not confirmed in client_project_models.
          void reconcileProjectModels(projectId);
          if (projectName) {
            setFeedback(`Added ${model.name} to "${projectName}".`);
            clearFeedbackLater();
          }
        } else {
          // Inverse rollback: remove only this model from live state.
          // alreadyPresent guard ensures a pre-existing model is never removed.
          if (!alreadyPresent) {
            setProjects((prev) =>
              prev.map((p) =>
                p.id === projectId
                  ? { ...p, models: p.models.filter((m) => m.id !== model.id) }
                  : p,
              ),
            );
          }
          setFeedback(result.userMessage);
          clearFeedbackLater();
        }
      })
      .catch((e) => {
        // Network-level rejection (extremely rare with Supabase JS client).
        console.error('addModelToProject: unexpected rejection', e);
        setAddingModelIds((prev) => {
          const s = new Set(prev);
          s.delete(model.id);
          return s;
        });
        if (!alreadyPresent) {
          setProjects((prev) =>
            prev.map((p) =>
              p.id === projectId ? { ...p, models: p.models.filter((m) => m.id !== model.id) } : p,
            ),
          );
        }
        setFeedback('Could not save model to project.');
        clearFeedbackLater();
      });
  };

  // Record "viewed" whenever the current discovery card changes and the user is
  // a real client (not a guest / shared-link viewer). Also adds the model to the
  // session dedup set so it won't be re-requested in subsequent paginated loads.
  const currentModelForEffect = useMemo(
    () =>
      filteredModels.length && !packageViewState && !sharedProjectId
        ? filteredModels[currentIndex % filteredModels.length]
        : null,

    [filteredModels, currentIndex, packageViewState, sharedProjectId],
  );

  useEffect(() => {
    if (!currentModelForEffect || !clientOrgId) return;
    sessionSeenIds.current.add(currentModelForEffect.id);
    saveSessionId(clientOrgId, currentModelForEffect.id);
    void recordInteraction(currentModelForEffect.id, 'viewed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentModelForEffect?.id, clientOrgId]);

  const openProjectDiscovery = (projectId: string) => {
    setActiveProjectId(projectId);
    setSharedProjectId(projectId);
    setTab('discover');
  };

  /** Project container: model list (same as legacy Overview). */
  const openProjectFolder = (projectId: string) => {
    setActiveProjectId(projectId);
    setProjectOverviewId(projectId);
    setTab('projects');
  };

  const closeProjectOverview = () => setProjectOverviewId(null);

  const handleRemoveModelFromProject = async (projectId: string, modelId: string) => {
    const confirmed =
      typeof window !== 'undefined'
        ? window.confirm(uiCopy.projects.deleteFromProjectConfirm)
        : true;
    if (!confirmed) return;

    // Level 3 — Inverse-Operation Rollback (NOT snapshot-based).
    //
    // Global snapshot breaks for concurrent removes from the same project:
    //   Remove A: snapshot=[A,B,C]  optimistic→[B,C]
    //   Remove B: snapshot=[A,B,C]  optimistic→[A,C]  (React closure: same render)
    //   RPC_A fails → setProjects([A,B,C]) → B comes back even though remove-B RPC may succeed.
    //
    // Inverse operation: on failure, add back only the specific model that was removed.
    // The removedModel object must be captured before the optimistic remove so it can be
    // re-inserted. The !p.models.some() guard prevents double-insertion if two concurrent
    // rollbacks run simultaneously.
    const removedModel = projects
      .find((p) => p.id === projectId)
      ?.models.find((m) => m.id === modelId);

    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId ? { ...p, models: p.models.filter((m) => m.id !== modelId) } : p,
      ),
    );

    const ok = await removeModelFromProject(projectId, modelId);
    if (ok) {
      // Server reconciliation refetch: silently confirm DB state matches UI after remove.
      void reconcileProjectModels(projectId);
    } else if (removedModel) {
      // Inverse rollback: add back the removed model to live state.
      // !p.models.some() guard: prevents double-insertion on concurrent rollbacks.
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId && !p.models.some((m) => m.id === modelId)
            ? { ...p, models: [...p.models, removedModel] }
            : p,
        ),
      );
      setFeedback('Could not remove model from project. Please try again.');
      clearFeedbackLater();
    }
  };

  const openProjectPickerForModel = (model: ModelSummary) => {
    setPendingModel(model);
    setProjectPickerOpen(true);
  };

  const handleAddToExistingProject = (projectId: string) => {
    if (!pendingModel) return;
    addModelToProject(projectId, pendingModel);
    setProjectPickerOpen(false);
    setPendingModel(null);
  };

  const handleCreateProjectAndAdd = async (name: string) => {
    if (!pendingModel) return;
    const created = await createProjectInternal(name);
    if (!created) return;
    addModelToProject(created.id, pendingModel);
    setProjectPickerOpen(false);
    setPendingModel(null);
  };

  const isNavigatingRef = useRef(false);
  const onNext = () => {
    if (!filteredModels.length || isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    // "Next" = browse to next card (neutral skip, not a rejection).
    // The "viewed" interaction is already recorded by the currentModelForEffect effect.
    // An explicit "Pass/Reject" action is required to fire recordInteraction 'rejected'.
    setCurrentIndex((prev) => (prev + 1) % filteredModels.length);
    // Release mutex after a brief frame to debounce rapid taps.
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 300);
  };

  const _onReject = () => {
    if (!filteredModels.length || isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    const current = filteredModels[currentIndex % filteredModels.length];
    if (current && clientOrgId) {
      void recordInteraction(current.id, 'rejected');
    }
    setCurrentIndex((prev) => (prev + 1) % filteredModels.length);
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 300);
  };

  const _openSharedLinkForProject = (projectId: string) => {
    setActiveProjectId(projectId);
    setSharedProjectId(projectId);
    setTab('discover');
  };

  const getShareableLinkForProject = (project: Project): string => {
    const base =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin + (window.location.pathname || '')
        : '';
    const ids = project.models.map((m) => m.id).join(',');
    const params = new URLSearchParams();
    params.set('shared', '1');
    params.set('name', project.name);
    if (ids) params.set('ids', ids);
    return `${base}?${params.toString()}`;
  };

  const handleShareFolder = async (project: Project) => {
    const url = getShareableLinkForProject(project);
    const title = project.name;
    const text = `Selection: ${project.name}`;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, text, url });
        setFeedback('Link shared.');
        clearFeedbackLater();
      } catch {
        copyShareLinkFallback(url);
      }
    } else {
      copyShareLinkFallback(url);
    }
  };

  const copyShareLinkFallback = (url: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        setFeedback('Link copied. Share via WhatsApp or e-mail.');
        clearFeedbackLater();
      });
    } else {
      setFeedback('Share link: ' + url);
    }
    clearFeedbackLater();
  };

  const exitSharedMode = () => {
    const id = sharedProjectId;
    if (id) {
      setActiveProjectId(id);
      setProjectOverviewId(id);
    }
    setSharedProjectId(null);
    setTab('projects');
  };

  const exitPackageMode = () => {
    setPackageViewState(null);
    setTab('messages');
  };

  const handlePackagePress = async (meta: Record<string, unknown>) => {
    const rawId = meta.package_id ?? meta.packageId;
    const packageId = typeof rawId === 'string' ? rawId.trim() : null;
    if (!packageId) return;
    setFeedback('Loading package…');
    try {
      const gl = await getGuestLink(packageId);
      if (!gl) {
        setFeedback(uiCopy.b2bChat.packageNotFoundOrExpired);
        clearFeedbackLater();
        return;
      }
      const modelsRes = await getGuestLinkModels(packageId);
      if (!modelsRes.ok) {
        setFeedback(modelsRes.error);
        clearFeedbackLater();
        return;
      }
      const glModels = modelsRes.data;
      const pkgType = normalizePackageType(gl.type);
      const packageModels: ModelSummary[] = glModels.map((m) => ({
        id: m.id,
        name: m.name,
        effective_city: m.effective_city ?? null,
        city: m.city ?? '',
        hairColor: m.hair_color ?? '',
        height: m.height ?? 0,
        bust: m.bust ?? 0,
        waist: m.waist ?? 0,
        hips: m.hips ?? 0,
        chest: (m as { chest?: number | null }).chest ?? m.bust ?? 0,
        legsInseam: 0,
        coverUrl: normalizeDocumentspicturesModelImageRef(getPackageCoverRawRef(m, pkgType), m.id),
        agencyId: null,
        agencyName: null,
        countryCode: null,
        hasRealLocation: false,
      }));
      // Prefer the explicit label set by the agency; fall back to agency-name + count
      const packageName =
        gl.label ??
        (gl.agency_name
          ? `${gl.agency_name} (${glModels.length} models)`
          : `Package (${glModels.length} models)`);
      setFeedback(null);
      setPackageViewState({
        packageId,
        name: packageName,
        models: packageModels,
        guestLink: typeof meta.guest_link === 'string' ? meta.guest_link : '',
        packageType: pkgType,
        rawModels: glModels,
      });
      setCurrentIndex(0);
      setTab('discover');
    } catch (e) {
      console.error('handlePackagePress error:', e);
      setFeedback(uiCopy.b2bChat.packageLoadFailed);
      clearFeedbackLater();
    }
  };

  const openDetails = (id: string) => {
    setDetailId(id);
  };

  const closeDetails = () => {
    setDetailId(null);
  };

  const handleOptionRequest = (
    modelName: string,
    modelId: string,
    date: string,
    projectId?: string,
    extra?: {
      proposedPrice?: number;
      startTime?: string;
      endTime?: string;
      requestType?: 'option' | 'casting';
      currency?: string;
      countryCode?: string;
      jobDescription?: string;
    },
  ) => {
    const originTab = tab;
    const pkgExtra = packageViewState
      ? { source: 'package' as const, packageId: packageViewState.packageId }
      : {};
    const resolvedProjectId = projectId ?? sharedProjectId ?? activeProjectId ?? undefined;
    const flowSource =
      packageViewState != null
        ? packageViewState.packageType === 'polaroid'
          ? ('polaroid_package' as const)
          : ('portfolio_package' as const)
        : resolvedProjectId
          ? ('project' as const)
          : ('discover' as const);
    const clientOrgName = auth.profile?.company_name ?? auth.profile?.display_name ?? 'Client';
    addOptionRequest(clientOrgName, modelName, modelId, date, resolvedProjectId, {
      ...extra,
      ...pkgExtra,
      flowSource,
      clientOrganizationName: clientOrgName,
      onThreadReady: (dbThreadId) => {
        optionChatReturnRef.current = { kind: 'tab', tab: originTab };
        setOpenThreadIdOnMessages(dbThreadId);
      },
    });
    setOptionDatePickerOpen(false);
    setOptionDateModel(null);
    setTab('messages');
  };

  const handleSaveClientAssignment = useCallback(
    async (
      clientOrganizationId: string,
      patch: { label: string; color: AssignmentFlagColor; assignedMemberUserId?: string | null },
    ): Promise<void> => {
      if (!agencyOrgId) return;
      const saved = await upsertClientAssignmentFlag({
        agencyOrganizationId: agencyOrgId,
        clientOrganizationId,
        label: patch.label,
        color: patch.color,
        assignedMemberUserId: patch.assignedMemberUserId ?? null,
      });
      if (!saved) return;
      setAssignmentByClientOrgId((prev) => ({
        ...prev,
        [clientOrganizationId]: saved,
      }));
    },
    [agencyOrgId],
  );

  useEffect(() => {
    setHasNew(hasOpenOptionRequestAttention());
    const unsub = subscribe(() => setHasNew(hasOpenOptionRequestAttention()));
    return unsub;
  }, []);

  const openOptionDatePicker = (model: ModelSummary) => {
    setOptionDateModel(model);
    setOptionDatePickerOpen(true);
  };

  const insets = useSafeAreaInsets();
  const bottomTabInset = Math.max(BOTTOM_TAB_BAR_HEIGHT, clientBottomTabBarHeight) + insets.bottom;

  /** Web mobile: lock shell to viewport so document scroll does not move the bottom tab bar; inner tab ScrollViews scroll instead. */
  const clientMobileWebShellLock =
    clientIsMobile && Platform.OS === 'web'
      ? {
          height: clientWindowHeight,
          maxHeight: clientWindowHeight,
          overflow: 'hidden' as const,
        }
      : null;
  /** RN ViewStyle omits CSS `fixed`; required for RN Web viewport-fixed client tab bar (all breakpoints). */
  const clientWebBottomTabPosition: ViewStyle | null =
    Platform.OS === 'web' ? ({ position: 'fixed' } as unknown as ViewStyle) : null;

  const resetDiscoverTabRoot = useCallback(() => {
    setDetailId(null);
    setDetailData(null);
    setProjectPickerOpen(false);
    setPendingModel(null);
    setOptionDatePickerOpen(false);
    setOptionDateModel(null);
    setCurrentIndex(0);
  }, []);

  const resetProjectsTabRoot = useCallback(() => {
    setProjectOverviewId(null);
  }, []);

  const resetMessagesTabRoot = useCallback(() => {
    setOpenThreadIdOnMessages(null);
    setPendingClientB2BChat(null);
    optionChatReturnRef.current = null;
  }, []);

  const handleCloseOptionNegotiation = useCallback(() => {
    const r = optionChatReturnRef.current;
    optionChatReturnRef.current = null;
    if (r?.kind === 'tab') {
      setTab(r.tab);
      if (r.tab === 'discover') resetDiscoverTabRoot();
      if (r.tab === 'projects') resetProjectsTabRoot();
    }
  }, [setTab, resetDiscoverTabRoot, resetProjectsTabRoot]);

  const resetCalendarTabRoot = useCallback(() => {
    setSelectedCalendarItem(null);
    setSelectedManualEvent(null);
    setShowAddManualEvent(false);
    setClientNotesDraft('');
    setClientSharedNoteDraft('');
  }, []);

  const navigateToOptionThreadFromCalendar = useCallback(
    (optionRequestId: string | null | undefined) => {
      const id = optionRequestId?.trim() ?? '';
      if (!isCalendarThreadUuid(id)) {
        showAppAlert(uiCopy.common.error, uiCopy.calendar.threadNavigationUnavailable);
        return;
      }
      optionChatReturnRef.current = { kind: 'tab', tab: 'calendar' };
      setOpenThreadIdOnMessages(id);
      setTab('messages');
      resetCalendarTabRoot();
    },
    [resetCalendarTabRoot, setTab],
  );

  const handleBottomTabPress = useCallback(
    (key: TopTab) => {
      handleTabPress({
        current: tab,
        next: key,
        setTab,
        onReselectRoot: () => {
          switch (tab) {
            case 'dashboard':
              break;
            case 'discover':
              resetDiscoverTabRoot();
              break;
            case 'projects':
              resetProjectsTabRoot();
              break;
            case 'messages':
              resetMessagesTabRoot();
              break;
            case 'calendar':
              resetCalendarTabRoot();
              break;
            case 'team':
            case 'agencies':
            default:
              break;
          }
        },
      });
    },
    [tab, resetDiscoverTabRoot, resetProjectsTabRoot, resetMessagesTabRoot, resetCalendarTabRoot],
  );

  const handleChatWithAgency = async (agencyId: string) => {
    if (!realClientId) {
      showAppAlert(uiCopy.alerts.signInRequired, uiCopy.b2bChat.signInToChatBody);
      return;
    }
    setIsChatWithAgencyLoading(true);
    try {
      const result = await ensureClientAgencyChat({
        agencyId,
        actingUserId: realClientId,
        clientUserId: realClientId,
      });
      if (result.ok) {
        setPendingClientB2BChat({
          conversationId: result.conversationId,
          title: uiCopy.b2bChat.agencyFallback,
        });
        setTab('messages');
      } else {
        showAppAlert(
          uiCopy.b2bChat.chatFailedTitle,
          result.reason || uiCopy.b2bChat.chatFailedGeneric,
        );
      }
    } catch (e) {
      console.error('handleChatWithAgency exception:', e);
      showAppAlert(uiCopy.b2bChat.chatFailedTitle, uiCopy.b2bChat.chatFailedGeneric);
    } finally {
      setIsChatWithAgencyLoading(false);
    }
  };

  const handleGeoConsentAccept = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('ic_geo_consent_v1', '1');
    }
    setGeoConsentGiven(true);
    setShowGeoConsentBanner(false);
  };

  const handleGeoConsentDecline = () => {
    setShowGeoConsentBanner(false);
    setFilters((prev) => ({ ...prev, nearby: false }));
  };

  return (
    <View style={[styles.root, clientMobileWebShellLock]}>
      {/* GDPR: Geolocation + Nominatim consent banner — shown the first time "Near me" is activated */}
      {showGeoConsentBanner && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.55)',
            zIndex: 9999,
            alignItems: 'center',
            justifyContent: 'center',
            padding: spacing.lg,
          }}
        >
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 12,
              padding: spacing.lg,
              maxWidth: 420,
              width: '100%',
              gap: spacing.md,
            }}
          >
            <Text style={{ ...typography.heading, fontSize: 16, color: colors.textPrimary }}>
              Location Access
            </Text>
            <Text style={{ ...typography.body, color: colors.textSecondary, lineHeight: 20 }}>
              To show models near you, IndexCasting will request your device location and send your
              approximate coordinates to{' '}
              <Text style={{ color: colors.textPrimary }}>OpenStreetMap Nominatim</Text> (a
              third-party geocoder) to determine your city.
            </Text>
            <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary }}>
              Your coordinates are rounded to ~5 km precision and are not stored on our servers. You
              can withdraw consent at any time by disabling the "Near me" filter.
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' }}>
              <TouchableOpacity
                onPress={handleGeoConsentDecline}
                style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
              >
                <Text style={{ color: colors.textSecondary, fontWeight: '500' }}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleGeoConsentAccept}
                style={{
                  backgroundColor: colors.accent,
                  borderRadius: 8,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '600' }}>Allow Location</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
      <View
        style={[
          styles.appShell,
          {
            paddingBottom: clientChatFullscreen ? 0 : bottomTabInset,
            paddingTop: Math.max(spacing.xs, insets.top + 2),
            paddingHorizontal: shellPaddingH,
          },
        ]}
      >
        <View style={styles.topBar}>
          <View style={styles.topBarRow}>
            <View style={styles.topBarSide}>
              <TouchableOpacity
                style={styles.backArrowTouchable}
                onPress={onBackToRoleSelection}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={{ ...typography.label, fontSize: 12, color: colors.textSecondary }}>
                  Logout
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.topBarCenter}>
              <Text style={styles.brand} numberOfLines={1}>
                INDEX CASTING
              </Text>
            </View>
            <View style={[styles.topBarSide, styles.topBarSideRight]}>
              {clientIsMobile ? (
                <TouchableOpacity
                  onPress={() => setMobileWorkspaceMenuOpen(true)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Text style={{ fontSize: 12, color: colors.textSecondary, fontWeight: '600' }}>
                    {uiCopy.clientWeb.workspaceMenu.openLabel}
                  </Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                onPress={() => setSettingsOpen(true)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={{ fontSize: 18, color: colors.textSecondary }}>⚙</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const subject = encodeURIComponent('Help Request – Casting Index');
                  const body = encodeURIComponent(
                    'Hello Casting Index Team,\n\nI need help with:\n\n',
                  );
                  Linking.openURL(`mailto:admin@castingindex.com?subject=${subject}&body=${body}`);
                }}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={{ fontSize: 14, color: colors.textSecondary }}>Help</Text>
              </TouchableOpacity>
            </View>
          </View>
          {(isSharedMode || isPackageMode) && (
            <View style={styles.sharedRight}>
              <TouchableOpacity onPress={isPackageMode ? exitPackageMode : exitSharedMode}>
                <Text style={styles.sharedExit}>
                  {isPackageMode ? uiCopy.b2bChat.exitPackageMode : 'Back to workspace'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {tab === 'dashboard' && (
          <ScrollView
            style={{ flex: 1, minHeight: 0 }}
            contentContainerStyle={{ paddingBottom: bottomTabInset + spacing.md, flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <ClientDashboardTab
              orgId={clientOrgId}
              userId={realClientId}
              onNavigateMessages={() => setTab('messages')}
              onNavigateCalendar={() => setTab('calendar')}
              onNavigateRequests={() => setTab('messages')}
              onSelectConversation={(id) => {
                setPendingClientB2BChat({ conversationId: id, title: '' });
                setTab('messages');
              }}
              onSelectOption={(id) => {
                optionChatReturnRef.current = { kind: 'tab', tab: 'dashboard' };
                setOpenThreadIdOnMessages(id);
                setTab('messages');
              }}
              onSelectModel={(id) => {
                openDetails(id);
                setTab('discover');
              }}
            />
          </ScrollView>
        )}

        {tab === 'discover' && showActiveOptions && (
          <ActiveOptionsView
            onClose={() => setShowActiveOptions(false)}
            assignmentByClientOrgId={assignmentByClientOrgId}
            scrollBottomInset={bottomTabInset}
          />
        )}

        {tab === 'discover' && !showActiveOptions && (
          <DiscoverView
            models={filteredModels}
            current={currentModel}
            index={currentIndex}
            activeProject={activeProject}
            sharedProjectName={sharedProject?.name ?? null}
            filters={filters}
            onChangeFilters={setFilters}
            onSaveFilters={handleSaveFilters}
            filterSaveStatus={filterSaveStatus}
            onNext={onNext}
            onAddToProject={openProjectPickerForModel}
            onOpenDetails={openDetails}
            onOpenOptionDatePicker={openOptionDatePicker}
            onChatWithAgency={handleChatWithAgency}
            isChatWithAgencyLoading={isChatWithAgencyLoading}
            isSharedMode={isSharedMode}
            isPackageMode={isPackageMode}
            packageName={packageViewState?.name ?? null}
            packageType={packageViewState?.packageType ?? undefined}
            addingModelIds={addingModelIds}
            onExitPackage={exitPackageMode}
            userCity={userCity}
            onShowActiveOptions={() => setShowActiveOptions(true)}
            tabBarBottomInset={bottomTabInset}
            shellHorizontalPadding={shellPaddingH}
            discoverFilterMessages={discoverFilterMessages}
          />
        )}

        {tab === 'projects' && projectOverviewId ? (
          <ProjectOverviewView
            project={projects.find((p) => p.id === projectOverviewId) ?? null}
            onBack={closeProjectOverview}
            onRemoveModel={handleRemoveModelFromProject}
            onBrowseDiscover={openProjectDiscovery}
            scrollBottomInset={bottomTabInset}
          />
        ) : tab === 'projects' ? (
          <ProjectsView
            projects={projects}
            activeProjectId={activeProjectId}
            onSelectProject={setActiveProjectId}
            newProjectName={newProjectName}
            setNewProjectName={setNewProjectName}
            onCreateProject={createProject}
            creatingProject={projectCreateBusy}
            onDeleteProject={handleDeleteProject}
            canDeleteProject={(p) =>
              !realClientId || p.ownerId == null || p.ownerId === realClientId
            }
            onOpenDetails={openDetails}
            onOpenProject={openProjectFolder}
            onShareFolder={handleShareFolder}
            onOpenOptionChat={(threadId) => {
              optionChatReturnRef.current = { kind: 'tab', tab: 'projects' };
              setOpenThreadIdOnMessages(threadId);
              setTab('messages');
            }}
            scrollBottomInset={bottomTabInset}
          />
        ) : null}

        {tab === 'agencies' && (
          <AgenciesView
            clientUserId={realClientId}
            scrollBottomInset={bottomTabInset}
            onChatStarted={(conversationId, title) => {
              setPendingClientB2BChat({ conversationId, title });
              setTab('messages');
            }}
          />
        )}

        {tab === 'calendar' && (
          <View style={{ flex: 1, minHeight: 0 }}>
            {!isRealClient ? (
              <View
                style={{
                  padding: spacing.md,
                  marginBottom: spacing.sm,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                }}
              >
                <Text style={{ ...typography.body, fontSize: 13, color: colors.textPrimary }}>
                  <Text style={{ fontWeight: '600' }}>{uiCopy.clientWeb.calendarCalloutTitle}</Text>{' '}
                  {uiCopy.clientWeb.calendarCalloutBody}
                </Text>
              </View>
            ) : null}
            <ClientCalendarView
              items={calendarItems}
              assignmentByClientOrgId={assignmentByClientOrgId}
              manualEvents={manualCalendarEvents}
              bookingEventEntries={bookingEventEntries}
              loading={calendarLoading}
              canAddManualEvents={isRealClient}
              scrollBottomInset={bottomTabInset}
              onRefresh={loadClientCalendar}
              onOpenDetails={(item) => {
                setSelectedCalendarItem(item);
                setSelectedManualEvent(null);
                const existing = (item.calendar_entry?.booking_details as any)?.client_notes ?? '';
                setClientNotesDraft(existing);
              }}
              onOpenManualEvent={(ev) => {
                setSelectedManualEvent(ev);
                setSelectedCalendarItem(null);
              }}
              onOpenBookingEntry={(be) => {
                const oid = resolveCanonicalOptionRequestIdFromBookingCalendarEntry(be);
                if (oid) {
                  navigateToOptionThreadFromCalendar(oid);
                  return;
                }
                Alert.alert(
                  be.title ?? uiCopy.calendar.bookingEvent,
                  `${uiCopy.calendar.date}: ${be.date}\n${uiCopy.calendar.status}: ${be.status ?? '—'}${be.entry_type ? `\nType: ${be.entry_type}` : ''}\n\n${uiCopy.calendar.bookingEntryDetailFallback}`,
                );
              }}
              onAddEvent={() => isRealClient && setShowAddManualEvent(true)}
              isMobile={clientIsMobile}
            />
          </View>
        )}

        {tab === 'messages' && (
          <MessagesView
            openThreadId={openThreadIdOnMessages}
            onClearOpenThreadId={() => setOpenThreadIdOnMessages(null)}
            isAgency={false}
            currentUserId={auth.profile?.id ?? null}
            assignmentByClientOrgId={assignmentByClientOrgId}
            assignableMembers={assignableMembers}
            onSaveClientAssignment={handleSaveClientAssignment}
            msgFilter={msgFilter}
            onMsgFilterChange={setMsgFilter}
            clientUserId={realClientId}
            clientOrgId={clientOrgId}
            pendingClientB2BChat={pendingClientB2BChat}
            onPendingClientB2BChatConsumed={() => setPendingClientB2BChat(null)}
            onBookingCardPress={() => setTab('calendar')}
            onPackagePress={(meta) => {
              void handlePackagePress(meta);
            }}
            onOptionRequestDeleted={() => {
              void loadClientCalendar();
            }}
            onOptionProjectionChanged={() => {
              void loadClientCalendar();
            }}
            onOptionThreadOpenedFromList={() => {
              optionChatReturnRef.current = { kind: 'list' };
            }}
            onCloseOptionNegotiation={handleCloseOptionNegotiation}
            onChatFullscreenChange={(active) => setClientChatFullscreen(active && clientIsMobile)}
          />
        )}

        {tab === 'team' && (
          <ScrollView
            style={{ flex: 1, minHeight: 0 }}
            contentContainerStyle={{ paddingBottom: bottomTabInset + spacing.md }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={{ flex: 1, alignSelf: 'stretch', paddingHorizontal: spacing.xs }}>
              <Text
                style={{
                  ...typography.heading,
                  fontSize: 18,
                  color: colors.textPrimary,
                  marginBottom: spacing.sm,
                }}
              >
                Team
              </Text>
              {clientOrgId && <OwnerBillingStatusCard variant="client" />}
              {clientOrgId && isOrganizationOwner(auth.profile?.org_member_role) && (
                <ClientOrgMetricsPanelWrapper orgId={clientOrgId} />
              )}
              <ClientOrganizationTeamSection realClientId={realClientId} />
            </View>
          </ScrollView>
        )}

        {tab === 'profile' && (
          <ClientOrgProfileScreen
            organizationId={clientOrgId}
            orgName={auth.profile?.company_name ?? null}
            orgMemberRole={auth.profile?.org_member_role ?? null}
            scrollBottomInset={bottomTabInset}
          />
        )}

        {feedback && (
          <View style={styles.feedbackBanner}>
            <Text style={styles.feedbackText}>{feedback}</Text>
          </View>
        )}
      </View>

      <ProjectDetailView
        open={!!detailId}
        loading={detailLoading}
        data={detailData}
        onClose={closeDetails}
        onOptionRequest={handleOptionRequest}
        detailMediaPackageType={
          packageViewState && detailId && packageViewState.rawModels.some((m) => m.id === detailId)
            ? packageViewState.packageType
            : undefined
        }
      />

      {selectedCalendarItem && (
        <View style={styles.detailOverlay}>
          <View style={[styles.detailCard, { maxWidth: 520 }]}>
            <View style={styles.detailHeaderRow}>
              <Text style={styles.detailTitle}>{uiCopy.calendar.bookingDetailsTitle}</Text>
              <TouchableOpacity
                onPress={() => {
                  setSelectedCalendarItem(null);
                  setClientNotesDraft('');
                  setClientSharedNoteDraft('');
                }}
              >
                <Text style={styles.closeLabel}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              style={{ maxHeight: clientWindowHeight * 0.85, width: '100%' }}
              contentContainerStyle={{ paddingBottom: spacing.xl }}
              keyboardShouldPersistTaps="handled"
            >
              {(() => {
                const { option, calendar_entry } = selectedCalendarItem;
                const entryType = calendar_entry?.entry_type;
                let kind: 'Option' | 'Job' | 'Casting' = 'Option';
                if (entryType === 'booking') kind = 'Job';
                if (entryType === 'casting' || entryType === 'gosee') kind = 'Casting';
                const date = calendar_entry?.date ?? option.requested_date;
                const start = calendar_entry?.start_time ?? option.start_time ?? undefined;
                const end = calendar_entry?.end_time ?? option.end_time ?? undefined;
                return (
                  <View>
                    <Text style={styles.metaText}>
                      {kind} · {option.model_name ?? 'Model'} · {option.client_name ?? 'Client'}
                    </Text>
                    <Text style={styles.metaText}>
                      {date}
                      {start ? ` · ${start}${end ? `–${end}` : ''}` : ''}
                    </Text>
                    {isRealClient ? (
                      <>
                        <Text style={[styles.metaText, { marginTop: spacing.sm }]}>
                          <Text style={{ fontWeight: '600' }}>
                            {uiCopy.calendar.nextStepLabel}:{' '}
                          </Text>
                          {getCalendarDetailNextStepText(option, calendar_entry, 'client', {
                            nextStepAwaitingModel: uiCopy.calendar.nextStepAwaitingModel,
                            nextStepAwaitingAgency: uiCopy.calendar.nextStepAwaitingAgency,
                            nextStepAwaitingClient: uiCopy.calendar.nextStepAwaitingClient,
                            nextStepJobConfirm: uiCopy.calendar.nextStepJobConfirm,
                            nextStepNegotiating: uiCopy.calendar.nextStepNegotiating,
                            nextStepNoAction: uiCopy.calendar.nextStepNoAction,
                            nextStepYourConfirm: uiCopy.calendar.nextStepYourConfirm,
                          })}
                        </Text>
                        <TouchableOpacity
                          style={[
                            styles.primaryButton,
                            { marginTop: spacing.sm, alignSelf: 'stretch' },
                          ]}
                          onPress={() =>
                            navigateToOptionThreadFromCalendar(
                              resolveCanonicalOptionRequestIdForCalendarItem({
                                option,
                                calendar_entry,
                              }),
                            )
                          }
                        >
                          <Text style={styles.primaryLabel}>
                            {uiCopy.calendar.openNegotiationThread}
                          </Text>
                        </TouchableOpacity>
                      </>
                    ) : null}
                  </View>
                );
              })()}
              <View style={{ marginTop: spacing.md }}>
                <Text style={styles.sectionLabel}>{uiCopy.calendar.reschedule}</Text>
                <Text style={[styles.metaText, { marginBottom: spacing.sm }]}>
                  {uiCopy.calendar.optionScheduleHelp}
                </Text>
                <Text style={{ ...typography.label, marginBottom: 4 }}>Date (YYYY-MM-DD)</Text>
                <TextInput
                  value={bookingScheduleDraft.date}
                  onChangeText={(t) => setBookingScheduleDraft((p) => ({ ...p, date: t }))}
                  placeholderTextColor={colors.textSecondary}
                  style={styles.input}
                />
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...typography.label, marginBottom: 4 }}>From</Text>
                    <TextInput
                      value={bookingScheduleDraft.start_time}
                      onChangeText={(t) =>
                        setBookingScheduleDraft((p) => ({ ...p, start_time: t }))
                      }
                      placeholderTextColor={colors.textSecondary}
                      style={styles.input}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...typography.label, marginBottom: 4 }}>To</Text>
                    <TextInput
                      value={bookingScheduleDraft.end_time}
                      onChangeText={(t) => setBookingScheduleDraft((p) => ({ ...p, end_time: t }))}
                      placeholderTextColor={colors.textSecondary}
                      style={styles.input}
                    />
                  </View>
                </View>
                <TouchableOpacity
                  onPress={async () => {
                    if (!selectedCalendarItem || !bookingScheduleDraft.date.trim()) return;
                    setSavingBookingSchedule(true);
                    try {
                      const ok = await updateOptionRequestSchedule(selectedCalendarItem.option.id, {
                        requested_date: bookingScheduleDraft.date.trim(),
                        start_time: bookingScheduleDraft.start_time.trim() || null,
                        end_time: bookingScheduleDraft.end_time.trim() || null,
                      });
                      if (ok && realClientId) {
                        await loadClientCalendar();
                        await loadOptionRequestsForClient(clientOrgId);
                        const items = await getCalendarEntriesForClient(realClientId);
                        const next = items.find(
                          (x) => x.option.id === selectedCalendarItem.option.id,
                        );
                        if (next) setSelectedCalendarItem(next);
                        Alert.alert(uiCopy.common.success, uiCopy.calendar.bookingUpdated);
                      } else {
                        Alert.alert(uiCopy.common.error, uiCopy.calendar.bookingUpdateFailed);
                      }
                    } finally {
                      setSavingBookingSchedule(false);
                    }
                  }}
                  style={[
                    styles.primaryButton,
                    {
                      marginTop: spacing.sm,
                      alignSelf: 'flex-end',
                      opacity: savingBookingSchedule ? 0.6 : 1,
                    },
                  ]}
                  disabled={savingBookingSchedule}
                >
                  <Text style={styles.primaryLabel}>
                    {savingBookingSchedule ? uiCopy.common.saving : uiCopy.calendar.saveSchedule}
                  </Text>
                </TouchableOpacity>
              </View>
              {selectedCalendarItem.calendar_entry?.option_request_id && realClientId ? (
                <BookingBriefEditor
                  role="client"
                  optionRequestId={selectedCalendarItem.option.id}
                  bookingBriefRaw={
                    (selectedCalendarItem.calendar_entry.booking_details as BookingDetails | null)
                      ?.booking_brief
                  }
                  onAfterSave={async () => {
                    await loadClientCalendar();
                    await loadOptionRequestsForClient(clientOrgId);
                    const items = await getCalendarEntriesForClient(realClientId);
                    const next = items.find((x) => x.option.id === selectedCalendarItem.option.id);
                    if (next) setSelectedCalendarItem(next);
                  }}
                />
              ) : null}
              {selectedCalendarItem.calendar_entry ? (
                <View style={{ marginTop: spacing.md }}>
                  <Text style={styles.sectionLabel}>{uiCopy.calendar.sharedNotesTitle}</Text>
                  <Text style={[styles.metaText, { marginBottom: spacing.sm }]}>
                    {uiCopy.calendar.sharedNotesHelpClient}
                  </Text>
                  <ScrollView style={{ maxHeight: 120, marginBottom: spacing.sm }}>
                    {(
                      (
                        selectedCalendarItem.calendar_entry?.booking_details as {
                          shared_notes?: SharedBookingNote[];
                        } | null
                      )?.shared_notes ?? []
                    ).map((n, i) => (
                      <View
                        key={`${n.at}-${i}`}
                        style={{
                          marginBottom: 6,
                          padding: 8,
                          backgroundColor: colors.border,
                          borderRadius: 8,
                        }}
                      >
                        <Text style={{ fontSize: 10, color: colors.textSecondary }}>
                          {n.role} · {new Date(n.at).toLocaleString('en-GB')}
                        </Text>
                        <Text style={{ fontSize: 12, color: colors.textPrimary }}>{n.text}</Text>
                      </View>
                    ))}
                  </ScrollView>
                  <TextInput
                    value={clientSharedNoteDraft}
                    onChangeText={setClientSharedNoteDraft}
                    multiline
                    placeholder={uiCopy.calendar.sharedNotePlaceholder}
                    placeholderTextColor={colors.textSecondary}
                    style={[
                      styles.input,
                      { minHeight: 72, borderRadius: 12, textAlignVertical: 'top' },
                    ]}
                  />
                  <TouchableOpacity
                    onPress={async () => {
                      if (!selectedCalendarItem || !clientSharedNoteDraft.trim()) return;
                      const now = Date.now();
                      if (now - lastAppendSharedNoteAtRef.current < UI_DOUBLE_SUBMIT_DEBOUNCE_MS)
                        return;
                      lastAppendSharedNoteAtRef.current = now;
                      setSavingSharedNoteClient(true);
                      try {
                        const ok = await appendSharedBookingNote(
                          selectedCalendarItem.option.id,
                          'client',
                          clientSharedNoteDraft,
                        );
                        if (ok && realClientId) {
                          setClientSharedNoteDraft('');
                          await loadClientCalendar();
                          const items = await getCalendarEntriesForClient(realClientId);
                          const next = items.find(
                            (x) => x.option.id === selectedCalendarItem.option.id,
                          );
                          if (next) setSelectedCalendarItem(next);
                        }
                      } finally {
                        setSavingSharedNoteClient(false);
                      }
                    }}
                    style={[
                      styles.primaryButton,
                      {
                        marginTop: spacing.sm,
                        alignSelf: 'flex-end',
                        opacity: savingSharedNoteClient ? 0.6 : 1,
                      },
                    ]}
                    disabled={savingSharedNoteClient}
                  >
                    <Text style={styles.primaryLabel}>
                      {savingSharedNoteClient
                        ? uiCopy.calendar.postingSharedNote
                        : uiCopy.calendar.postSharedNote}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              <View style={{ marginTop: spacing.md }}>
                <Text style={styles.sectionLabel}>{uiCopy.calendar.clientNotesTitle}</Text>
                <TextInput
                  value={clientNotesDraft}
                  onChangeText={setClientNotesDraft}
                  multiline
                  placeholder={uiCopy.calendar.clientNotesPlaceholder}
                  placeholderTextColor={colors.textSecondary}
                  style={[
                    styles.input,
                    {
                      height: 96,
                      borderRadius: 12,
                      textAlignVertical: 'top',
                    },
                  ]}
                />
              </View>
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
                    setClientNotesDraft('');
                  }}
                  style={[styles.secondaryButton, { paddingHorizontal: spacing.lg }]}
                >
                  <Text style={styles.secondaryLabel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    if (!selectedCalendarItem) return;
                    setSavingNotes(true);
                    try {
                      await updateBookingDetails(
                        selectedCalendarItem.option.id,
                        { client_notes: clientNotesDraft },
                        'client',
                      );
                      await loadClientCalendar();
                      setSelectedCalendarItem(null);
                      setClientNotesDraft('');
                    } finally {
                      setSavingNotes(false);
                    }
                  }}
                  style={[
                    styles.primaryButton,
                    { paddingHorizontal: spacing.lg, opacity: savingNotes ? 0.6 : 1 },
                  ]}
                  disabled={savingNotes}
                >
                  <Text style={styles.primaryLabel}>
                    {savingNotes ? uiCopy.calendar.savingNotes : uiCopy.calendar.saveNotes}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      )}

      <ProjectPicker
        open={projectPickerOpen}
        projects={projects}
        pendingModel={pendingModel}
        addingModelIds={addingModelIds}
        onClose={() => {
          setProjectPickerOpen(false);
          setPendingModel(null);
        }}
        onAddToExisting={handleAddToExistingProject}
        onCreateAndAdd={handleCreateProjectAndAdd}
      />

      <OptionDatePickerModal
        open={optionDatePickerOpen}
        model={optionDateModel}
        onClose={() => {
          setOptionDatePickerOpen(false);
          setOptionDateModel(null);
        }}
        onSubmit={(date, startTime, endTime, price, requestType, currency, jobDescription) =>
          optionDateModel &&
          handleOptionRequest(optionDateModel.name, optionDateModel.id, date, undefined, {
            startTime,
            endTime,
            proposedPrice: price,
            requestType: requestType ?? 'option',
            currency: currency ?? 'EUR',
            jobDescription,
            countryCode:
              filters.countryCode.trim() || optionDateModel.countryCode?.trim() || undefined,
          })
        }
      />

      {showAddManualEvent && (
        <View style={styles.detailOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowAddManualEvent(false)}
          />
          <View style={[styles.detailCard, { maxWidth: 400 }]}>
            <Text style={styles.detailTitle}>Add event</Text>
            <TextInput
              placeholder="Title"
              value={newEventForm.title}
              onChangeText={(t) => setNewEventForm((f) => ({ ...f, title: t }))}
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
            />
            <Text style={{ ...typography.label, marginTop: spacing.sm, marginBottom: 4 }}>
              Date (YYYY-MM-DD)
            </Text>
            <TextInput
              placeholder="2025-03-15"
              value={newEventForm.date}
              onChangeText={(d) => setNewEventForm((f) => ({ ...f, date: d }))}
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.label, marginBottom: 4 }}>From</Text>
                <TextInput
                  value={newEventForm.start_time}
                  onChangeText={(t) => setNewEventForm((f) => ({ ...f, start_time: t }))}
                  placeholderTextColor={colors.textSecondary}
                  style={styles.input}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.label, marginBottom: 4 }}>To</Text>
                <TextInput
                  value={newEventForm.end_time}
                  onChangeText={(t) => setNewEventForm((f) => ({ ...f, end_time: t }))}
                  placeholderTextColor={colors.textSecondary}
                  style={styles.input}
                />
              </View>
            </View>
            <Text style={{ ...typography.label, marginTop: spacing.sm, marginBottom: 4 }}>
              Note (private)
            </Text>
            <TextInput
              value={newEventForm.note}
              onChangeText={(t) => setNewEventForm((f) => ({ ...f, note: t }))}
              multiline
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, { minHeight: 64, textAlignVertical: 'top', borderRadius: 12 }]}
            />
            <Text style={{ ...typography.label, marginTop: spacing.sm, marginBottom: 4 }}>
              Color
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {MANUAL_EVENT_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setNewEventForm((f) => ({ ...f, color: c }))}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: c,
                    borderWidth: newEventForm.color === c ? 2 : 0,
                    borderColor: colors.textPrimary,
                  }}
                />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <TouchableOpacity
                style={[styles.filterPill, { flex: 1 }]}
                onPress={() => setShowAddManualEvent(false)}
              >
                <Text style={styles.filterPillLabel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, { flex: 1 }]}
                disabled={
                  !newEventForm.title.trim() || !newEventForm.date.trim() || savingManualEvent
                }
                onPress={async () => {
                  if (!realClientId) {
                    Alert.alert(
                      uiCopy.alerts.signInRequired,
                      uiCopy.alerts.signInAsClientForCalendar,
                    );
                    return;
                  }
                  setSavingManualEvent(true);
                  const { data: calUser } = await supabase.auth.getUser();
                  const result = await insertManualEvent({
                    owner_id: realClientId,
                    owner_type: 'client',
                    organization_id: clientOrgId,
                    created_by: calUser.user?.id ?? null,
                    ...newEventForm,
                  });
                  setSavingManualEvent(false);
                  if (result.ok) {
                    await loadClientCalendar();
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
                      'Event not saved',
                      result.errorMessage || 'Please check the date (YYYY-MM-DD) and try again.',
                    );
                  }
                }}
              >
                <Text style={styles.primaryLabel}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {selectedManualEvent && (
        <View style={styles.detailOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setSelectedManualEvent(null)}
          />
          <View style={[styles.detailCard, { maxWidth: 400 }]}>
            <Text style={styles.detailTitle}>{uiCopy.clientWeb.editEvent}</Text>
            <Text style={{ ...typography.label, marginTop: spacing.sm, marginBottom: 4 }}>
              Title
            </Text>
            <TextInput
              value={manualEventEditDraft.title}
              onChangeText={(t) => setManualEventEditDraft((p) => ({ ...p, title: t }))}
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
            />
            <Text style={{ ...typography.label, marginTop: spacing.sm, marginBottom: 4 }}>
              Date (YYYY-MM-DD)
            </Text>
            <TextInput
              value={manualEventEditDraft.date}
              onChangeText={(t) => setManualEventEditDraft((p) => ({ ...p, date: t }))}
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.label, marginBottom: 4 }}>From</Text>
                <TextInput
                  value={manualEventEditDraft.start_time}
                  onChangeText={(t) => setManualEventEditDraft((p) => ({ ...p, start_time: t }))}
                  placeholderTextColor={colors.textSecondary}
                  style={styles.input}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.label, marginBottom: 4 }}>To</Text>
                <TextInput
                  value={manualEventEditDraft.end_time}
                  onChangeText={(t) => setManualEventEditDraft((p) => ({ ...p, end_time: t }))}
                  placeholderTextColor={colors.textSecondary}
                  style={styles.input}
                />
              </View>
            </View>
            <Text style={{ ...typography.label, marginTop: spacing.sm, marginBottom: 4 }}>
              Note (private)
            </Text>
            <TextInput
              value={manualEventEditDraft.note}
              onChangeText={(t) => setManualEventEditDraft((p) => ({ ...p, note: t }))}
              multiline
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, { minHeight: 72, textAlignVertical: 'top', borderRadius: 12 }]}
            />
            <Text style={{ ...typography.label, marginTop: spacing.sm, marginBottom: 4 }}>
              Color
            </Text>
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
            <View
              style={{
                flexDirection: 'row',
                gap: spacing.sm,
                marginTop: spacing.lg,
                flexWrap: 'wrap',
              }}
            >
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  { flex: 1, minWidth: 120, opacity: savingManualEventEdit ? 0.6 : 1 },
                ]}
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
                      await loadClientCalendar();
                      setSelectedManualEvent(null);
                      Alert.alert(uiCopy.common.success, uiCopy.calendar.manualEventUpdated);
                    } else {
                      Alert.alert(uiCopy.common.error, uiCopy.calendar.manualEventUpdateFailed);
                    }
                  } finally {
                    setSavingManualEventEdit(false);
                  }
                }}
              >
                <Text style={styles.primaryLabel}>{savingManualEventEdit ? '…' : 'Save'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterPill, { flex: 1, minWidth: 100 }]}
                onPress={async () => {
                  if (!selectedManualEvent) return;
                  if (await deleteManualEvent(selectedManualEvent.id)) {
                    await loadClientCalendar();
                    setSelectedManualEvent(null);
                  }
                }}
              >
                <Text style={[styles.filterPillLabel, { color: colors.buttonSkipRed }]}>
                  Delete
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterPill, { flex: 1, minWidth: 100 }]}
                onPress={() => setSelectedManualEvent(null)}
              >
                <Text style={styles.filterPillLabel}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {settingsOpen && (
        <SettingsPanel realClientId={realClientId} onClose={() => setSettingsOpen(false)} />
      )}

      {clientIsMobile ? (
        <Modal
          visible={mobileWorkspaceMenuOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setMobileWorkspaceMenuOpen(false)}
        >
          <View style={styles.workspaceMenuOuter}>
            <TouchableOpacity
              style={styles.workspaceMenuBackdropTouchable}
              activeOpacity={1}
              onPress={() => setMobileWorkspaceMenuOpen(false)}
            />
            <View style={styles.workspaceMenuCard}>
              <Text style={styles.workspaceMenuTitle}>{uiCopy.clientWeb.workspaceMenu.title}</Text>
              <Text style={styles.workspaceMenuSubtitle}>
                {uiCopy.clientWeb.workspaceMenu.subtitle}
              </Text>
              {(
                [
                  ['dashboard', uiCopy.clientWeb.bottomTabs.dashboard],
                  ['discover', uiCopy.clientWeb.bottomTabs.discover],
                  ['calendar', uiCopy.clientWeb.bottomTabs.calendar],
                  ['team', uiCopy.clientWeb.bottomTabs.team],
                  ['profile', uiCopy.clientWeb.bottomTabs.profile],
                ] as const
              ).map(([k, label]) => (
                <TouchableOpacity
                  key={k}
                  style={styles.workspaceMenuRow}
                  onPress={() => {
                    handleBottomTabPress(k);
                    setMobileWorkspaceMenuOpen(false);
                  }}
                >
                  <Text style={styles.workspaceMenuRowLabel}>{label}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.workspaceMenuClose}
                onPress={() => setMobileWorkspaceMenuOpen(false)}
              >
                <Text style={styles.workspaceMenuCloseLabel}>{uiCopy.common.close}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      ) : null}

      {!clientChatFullscreen && (
        <View
          style={[
            styles.bottomTabBar,
            clientWebBottomTabPosition,
            { paddingBottom: insets.bottom },
          ]}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0) {
              setClientBottomTabBarHeight((prev) => (Math.abs(prev - h) > 0.5 ? h : prev));
            }
          }}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={clientIsMobile}
            keyboardShouldPersistTaps="handled"
            style={{ width: '100%' }}
            contentContainerStyle={styles.bottomTabRow}
          >
            {CLIENT_PRIMARY_BOTTOM_TABS.map((key) => {
              const active = tab === key;
              return (
                <TouchableOpacity
                  key={key}
                  onPress={() => handleBottomTabPress(key)}
                  style={[styles.bottomTabItem, clientIsMobile && styles.bottomTabItemScrollMobile]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text
                    style={[
                      styles.bottomTabLabel,
                      clientIsMobile && styles.bottomTabLabelScrollMobile,
                      active && styles.bottomTabLabelActive,
                    ]}
                    numberOfLines={1}
                  >
                    {labelForClientBottomTab(key)}
                  </Text>
                  {key === 'messages' && hasNew ? <View style={styles.bottomTabDot} /> : null}
                  {active ? <View style={styles.bottomTabUnderline} /> : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
};

/** Compact banner showing which filters are currently active (aligned with discovery / near-me RPCs). */
const FilterExplanationBanner: React.FC<{ filters: ModelFilters }> = ({ filters }) => {
  const parts: string[] = [];
  const addRange = (label: string, min: string, max: string) => {
    if (!min?.trim() && !max?.trim()) return;
    const range = [min, max].filter(Boolean).join('–');
    parts.push(uiCopy.dashboard.filterMeasurements(label, range));
  };
  if (filters.nearby) parts.push(uiCopy.dashboard.filterNearMe);
  if (filters.heightMin || filters.heightMax) {
    const ht = [filters.heightMin, filters.heightMax].filter(Boolean).join('–');
    parts.push(`Height ${ht} cm`);
  }
  if (filters.sex !== 'all') parts.push(filters.sex.charAt(0).toUpperCase() + filters.sex.slice(1));
  if (filters.countryCode) parts.push(filters.countryCode.toUpperCase());
  if (filters.city) parts.push(filters.city);
  if (filters.category) parts.push(filters.category);
  if (filters.sportsWinter) parts.push(uiCopy.dashboard.filterSportsWinter);
  if (filters.sportsSummer) parts.push(uiCopy.dashboard.filterSportsSummer);
  if (filters.hairColor.trim()) parts.push(uiCopy.dashboard.filterHair(filters.hairColor.trim()));
  if (filters.ethnicities.length)
    parts.push(uiCopy.dashboard.filterEthnicities(filters.ethnicities.length));
  addRange('Hips', filters.hipsMin, filters.hipsMax);
  addRange('Waist', filters.waistMin, filters.waistMax);
  addRange('Chest', filters.chestMin, filters.chestMax);
  addRange('Legs', filters.legsInseamMin, filters.legsInseamMax);
  if (parts.length === 0) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
        paddingHorizontal: spacing.xs,
        paddingVertical: spacing.xs,
      }}
    >
      <Text style={{ fontSize: 11, color: colors.textSecondary }}>
        {uiCopy.dashboard.filterExplanation}
      </Text>
      {parts.map((p, i) => (
        <Text
          key={`${i}-${p}`}
          style={{ fontSize: 11, color: colors.textPrimary, fontWeight: '600' }}
        >
          {p}
        </Text>
      ))}
      <Text style={{ fontSize: 11, color: colors.textSecondary }}>
        {'  •  '}
        {uiCopy.dashboard.filterSeenHidden}
      </Text>
    </View>
  );
};

type DiscoverProps = {
  models: ModelSummary[];
  current: ModelSummary | null;
  index: number;
  activeProject: Project | null;
  sharedProjectName: string | null;
  filters: ModelFilters;
  onChangeFilters: (f: ModelFilters) => void;
  onSaveFilters: () => void;
  filterSaveStatus: 'idle' | 'saving' | 'saved' | 'error';
  onNext: () => void;
  onAddToProject: (model: ModelSummary) => void;
  onOpenDetails: (id: string) => void;
  onOpenOptionDatePicker: (model: ModelSummary) => void;
  onChatWithAgency: (agencyId: string) => void;
  isChatWithAgencyLoading: boolean;
  isSharedMode: boolean;
  isPackageMode: boolean;
  packageName: string | null;
  packageType?: PackageType;
  addingModelIds?: Set<string>;
  onExitPackage?: () => void;
  userCity: string | null;
  onShowActiveOptions?: () => void;
  /** Bottom inset for package grid (clears absolute tab bar + safe area). */
  tabBarBottomInset?: number;
  /** Must match `appShell` horizontal padding — used to full-bleed the swipe card without lateral shift. */
  shellHorizontalPadding: number;
  discoverFilterMessages?: { kind: 'warning' | 'error'; text: string }[];
};

const DiscoverView: React.FC<DiscoverProps> = ({
  models,
  current,
  index,
  activeProject,
  sharedProjectName,
  filters,
  onChangeFilters,
  onSaveFilters,
  filterSaveStatus,
  onNext,
  onAddToProject,
  userCity,
  onOpenDetails,
  onOpenOptionDatePicker,
  onChatWithAgency,
  isChatWithAgencyLoading,
  isSharedMode,
  isPackageMode,
  packageName,
  packageType,
  addingModelIds,
  onExitPackage,
  onShowActiveOptions,
  tabBarBottomInset = 0,
  shellHorizontalPadding,
  discoverFilterMessages = [],
}) => {
  const { width: discoverW, height: discoverH } = useWindowDimensions();
  const isMobileDiscover = isMobileWidth(discoverW);
  const heroResizeMode = getHeroResizeMode(isMobileDiscover);

  // Package mode: grid layout matching GuestView (all models visible at once, no swipe)
  if (isPackageMode) {
    const packageTypeLabel = packageType === 'polaroid' ? 'Polaroid Package' : 'Portfolio Package';
    const packageGridPaddingBottom = Math.max(120, tabBarBottomInset + spacing.lg);
    return (
      <View style={[styles.section, { flex: 1 }]}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>{packageTypeLabel}</Text>
          <Text style={styles.metaText}>{models.length} models</Text>
        </View>
        <View style={styles.packageBanner}>
          <Text style={styles.packageBannerText}>
            {packageName ?? uiCopy.discover.viewingPackage}
          </Text>
          <TouchableOpacity
            onPress={onExitPackage}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.packageBannerExit}>{uiCopy.discover.exitPackage}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          style={Platform.OS === 'web' ? { flex: 1, minHeight: 0 } : undefined}
          contentContainerStyle={[styles.packageGrid, { paddingBottom: packageGridPaddingBottom }]}
          showsVerticalScrollIndicator={false}
        >
          {models.length === 0 ? (
            <View style={styles.emptyDiscover}>
              <Text style={styles.emptyTitle}>{uiCopy.discover.noMoreModels}</Text>
            </View>
          ) : (
            models.map((m) => (
              <View key={m.id} style={styles.packageGridCard}>
                <TouchableOpacity activeOpacity={0.9} onPress={() => onOpenDetails(m.id)}>
                  <View style={styles.packageGridImageContainer}>
                    <StorageImage
                      uri={m.coverUrl || undefined}
                      style={styles.packageGridImage}
                      resizeMode={heroResizeMode}
                      ttlSeconds={CLIENT_MODEL_IMAGE_TTL_SEC}
                      fallback={
                        <View
                          style={[styles.packageGridImage, { backgroundColor: colors.border }]}
                        />
                      }
                    />
                    <View style={styles.coverGradientOverlay} />
                    <View style={styles.coverMeasurementsOverlay}>
                      <Text style={styles.coverNameOnImage}>{m.name}</Text>
                      <Text style={styles.coverMeasurementsLabel}>
                        Height {m.height} cm · Chest {m.chest || m.bust || '—'} cm · Waist{' '}
                        {m.waist || '—'} cm · Hips {m.hips || '—'} cm
                        {m.legsInseam ? ` · Inseam ${m.legsInseam} cm` : ''}
                      </Text>
                      <Text style={styles.coverLocationLabel}>{summaryDisplayCity(m) || '—'}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
                <View style={styles.cardButtonRow}>
                  <TouchableOpacity
                    style={styles.optionButtonOutline}
                    onPress={() => onOpenOptionDatePicker(m)}
                  >
                    <Text style={styles.optionButtonOutlineLabel}>Option</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.addToSelectionButton,
                      addingModelIds?.has(m.id) && { opacity: 0.4 },
                    ]}
                    onPress={() => onAddToProject(m)}
                    disabled={addingModelIds?.has(m.id) ?? false}
                  >
                    <Text style={styles.addToSelectionLabel}>
                      {addingModelIds?.has(m.id) ? 'Adding…' : 'Add to selection'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    );
  }

  // Normal discover mode: single-card swipe
  // Tinder-style: on mobile the card fills the screen edge-to-edge; on desktop cap at 640px
  const cardMaxWidth = isMobileDiscover ? 9999 : 640;
  // Image height: ~68% of visible viewport height on mobile for dominant presence; fixed on desktop
  const cardImageHeight = isMobileDiscover ? Math.round(discoverH * 0.68) : 500;
  // No horizontal margin around card on mobile (full bleed); keep border radius only on desktop
  const cardBorderRadius = isMobileDiscover ? 12 : 20;

  const discoverScrollPaddingBottom = Math.max(spacing.xl * 2, tabBarBottomInset + spacing.lg);

  return (
    <View style={[styles.section, { minHeight: 0, flex: 1 }]}>
      <ScrollView
        style={Platform.OS === 'web' ? { flex: 1, minHeight: 0 } : { flex: 1 }}
        contentContainerStyle={{ paddingBottom: discoverScrollPaddingBottom }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={Platform.OS !== 'web'}
      >
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>Discover</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            {onShowActiveOptions && (
              <TouchableOpacity
                onPress={onShowActiveOptions}
                style={{
                  backgroundColor: colors.background,
                  borderRadius: 6,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 4,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ fontSize: 11, color: colors.textPrimary, fontWeight: '600' }}>
                  {uiCopy.dashboard.activeOptionsTitle}
                </Text>
              </TouchableOpacity>
            )}
            <Text style={styles.metaText}>
              {models.length ? `${index + 1}/${models.length}` : '0/0'}
            </Text>
          </View>
        </View>

        {!isSharedMode && (
          <>
            {discoverFilterMessages.length > 0 ? (
              <View
                style={{ paddingHorizontal: spacing.xs, gap: spacing.xs, marginBottom: spacing.xs }}
              >
                {discoverFilterMessages.map((msg, i) => (
                  <View
                    key={`dfm-${i}-${msg.kind}`}
                    style={{
                      padding: spacing.sm,
                      borderRadius: 8,
                      borderLeftWidth: 4,
                      borderLeftColor:
                        msg.kind === 'error' ? colors.buttonSkipRed : colors.accentBrown,
                      backgroundColor: colors.surface,
                    }}
                  >
                    <Text style={{ fontSize: 12, color: colors.textPrimary, lineHeight: 18 }}>
                      {msg.text}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            <ModelFiltersPanel
              filters={filters}
              onChangeFilters={onChangeFilters}
              onSaveFilters={onSaveFilters}
              filterSaveStatus={filterSaveStatus === 'idle' ? null : filterSaveStatus}
              userCity={userCity}
            />
            <FilterExplanationBanner filters={filters} />
          </>
        )}

        <View style={styles.activeProjectRow}>
          <Text style={styles.metaText}>Active project</Text>
          <Text style={styles.activeProjectName}>
            {isSharedMode
              ? (sharedProjectName ?? 'Project')
              : activeProject
                ? activeProject.name
                : 'None'}
          </Text>
        </View>

        {current ? (
          <View
            style={[
              styles.coverRow,
              isMobileDiscover && { marginHorizontal: -shellHorizontalPadding },
            ]}
          >
            <View
              style={[styles.coverCard, { maxWidth: cardMaxWidth, borderRadius: cardBorderRadius }]}
            >
              <View style={[styles.coverImageContainer, { height: cardImageHeight }]}>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => onOpenDetails(current.id)}
                  style={styles.coverImageTouchable}
                >
                  <StorageImage
                    uri={current.coverUrl || undefined}
                    style={styles.coverImage}
                    resizeMode={heroResizeMode}
                    ttlSeconds={CLIENT_MODEL_IMAGE_TTL_SEC}
                    fallback={
                      <View style={[styles.coverImage, { backgroundColor: colors.border }]} />
                    }
                  />
                </TouchableOpacity>
                <View style={styles.coverGradientOverlay} />
                <View style={styles.coverMeasurementsOverlay}>
                  <Text style={styles.coverNameOnImage}>{current.name}</Text>
                  <Text style={styles.coverMeasurementsLabel}>
                    Height {current.height} cm · Chest {current.chest || current.bust || '—'} cm ·
                    Waist {current.waist || '—'} cm · Hips {current.hips || '—'} cm
                    {current.legsInseam ? ` · Inseam ${current.legsInseam} cm` : ''}
                  </Text>
                  <Text style={styles.coverLocationLabel}>
                    {current.hasRealLocation
                      ? `${summaryDisplayCity(current) || '—'} · ${current.countryCode || '—'}`
                      : `Represented in ${current.countryCode || '—'}${
                          current.agencyName ? ` · ${current.agencyName}` : ''
                        }`}
                  </Text>
                  {(current.isSportsWinter || current.isSportsSummer) && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                      {current.isSportsWinter && (
                        <View style={styles.sportsBadge}>
                          <Text style={styles.sportsBadgeLabel}>
                            {uiCopy.sportCategories.winterSports}
                          </Text>
                        </View>
                      )}
                      {current.isSportsSummer && (
                        <View style={styles.sportsBadge}>
                          <Text style={styles.sportsBadgeLabel}>
                            {uiCopy.sportCategories.summerSports}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              </View>
              <View style={styles.cardButtonRow}>
                <TouchableOpacity style={styles.nextButton} onPress={onNext}>
                  <Text style={styles.nextButtonLabel}>Next</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.optionButtonOutline}
                  onPress={() => onOpenOptionDatePicker(current)}
                >
                  <Text style={styles.optionButtonOutlineLabel}>Option</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.cardButtonRowSecondary}>
                <TouchableOpacity
                  style={[
                    styles.addToSelectionButton,
                    addingModelIds?.has(current.id) && { opacity: 0.4 },
                  ]}
                  onPress={() => onAddToProject(current)}
                  disabled={addingModelIds?.has(current.id) ?? false}
                >
                  <Text style={styles.addToSelectionLabel}>
                    {addingModelIds?.has(current.id) ? 'Adding…' : 'Add to selection'}
                  </Text>
                </TouchableOpacity>
              </View>
              {current.agencyId && (
                <View style={styles.cardButtonRowSecondary}>
                  <TouchableOpacity
                    style={[
                      styles.chatWithAgencyButton,
                      isChatWithAgencyLoading && { opacity: 0.5 },
                    ]}
                    onPress={() => onChatWithAgency(current.agencyId!)}
                    disabled={isChatWithAgencyLoading}
                  >
                    <Text style={styles.chatWithAgencyLabel}>
                      {isChatWithAgencyLoading
                        ? uiCopy.discover.chatWithAgencyLoading
                        : uiCopy.discover.chatWithAgency}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.emptyDiscover}>
            <Text style={styles.emptyTitle}>{uiCopy.discover.noMoreModels}</Text>
            <Text style={styles.emptyCopy}>{uiCopy.discover.noMoreModelsSub}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

type ClientCalendarViewProps = {
  items: ClientCalendarItem[];
  assignmentByClientOrgId?: Record<string, ClientAssignmentFlag>;
  manualEvents: UserCalendarEvent[];
  bookingEventEntries?: CalendarEntry[];
  loading: boolean;
  canAddManualEvents?: boolean;
  /** Extra bottom padding so list clears fixed client bottom tab bar when scrolled. */
  scrollBottomInset?: number;
  /** Narrow layout: month view uses scrollable agenda inside B2B body — hide duplicate list below. */
  isMobile?: boolean;
  onRefresh: () => void;
  onOpenDetails: (item: ClientCalendarItem) => void;
  onOpenManualEvent: (event: UserCalendarEvent) => void;
  onOpenBookingEntry?: (entry: CalendarEntry) => void;
  onAddEvent: () => void;
};

const ClientCalendarView: React.FC<ClientCalendarViewProps> = ({
  items,
  assignmentByClientOrgId = {},
  manualEvents,
  bookingEventEntries = [],
  loading,
  canAddManualEvents = true,
  scrollBottomInset = 0,
  isMobile: _isMobile = false,
  onRefresh,
  onOpenDetails,
  onOpenManualEvent,
  onOpenBookingEntry,
  onAddEvent,
}) => {
  const now = new Date();
  const [calendarMonth, setCalendarMonth] = useState({
    year: now.getFullYear(),
    month: now.getMonth(),
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<AgencyCalendarTypeFilter>('all');
  const [calendarViewMode, setCalendarViewMode] = useState<CalendarViewMode>('month');

  const itemByOptionId = useMemo(() => {
    const m = new Map<string, AgencyCalendarItem>();
    for (const i of items) m.set(i.option.id, i as AgencyCalendarItem);
    return m;
  }, [items]);

  const unifiedAll = useMemo(
    () =>
      buildUnifiedAgencyCalendarRows(
        items as AgencyCalendarItem[],
        bookingEventEntries,
        manualEvents,
        assignmentByClientOrgId,
        itemByOptionId,
      ),
    [items, bookingEventEntries, manualEvents, assignmentByClientOrgId, itemByOptionId],
  );

  const filteredUnified = useMemo(
    () =>
      dedupeUnifiedRowsByOptionRequest(
        filterUnifiedAgencyCalendarRows(unifiedAll, {
          modelQuery: '',
          fromDate: '',
          toDate: '',
          typeFilter,
          assigneeFilter: 'all',
          clientScope: 'all',
          urgency: 'all',
          currentUserId: null,
          assignmentByClientOrgId,
        }),
      ),
    [unifiedAll, assignmentByClientOrgId, typeFilter],
  );

  const eventsByDate = useMemo(
    () => buildEventsByDateFromUnifiedRows(filteredUnified),
    [filteredUnified],
  );

  const openUnifiedRow = (row: UnifiedAgencyCalendarRow) => {
    if (row.kind === 'manual') {
      onOpenManualEvent(row.ev);
      return;
    }
    if (row.kind === 'booking') {
      onOpenBookingEntry?.(row.entry);
      return;
    }
    if (row.kind === 'option') {
      onOpenDetails(row.item as ClientCalendarItem);
      return;
    }
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: spacing.xl * 2 + scrollBottomInset }}
    >
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>Calendar</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          {!canAddManualEvents && (
            <Text
              style={{
                ...typography.body,
                fontSize: 12,
                color: colors.textSecondary,
                marginRight: spacing.sm,
              }}
            >
              Sign in to save your own events
            </Text>
          )}
          <TouchableOpacity
            style={[
              styles.filterPill,
              { paddingHorizontal: spacing.sm },
              !canAddManualEvents && { opacity: 0.6 },
            ]}
            onPress={onAddEvent}
            disabled={!canAddManualEvents}
          >
            <Text style={styles.filterPillLabel}>+ Add event</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.filterTrigger} onPress={onRefresh}>
            <Text style={styles.filterTriggerLabel}>{loading ? 'Loading…' : 'Refresh'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text
        style={{
          ...typography.label,
          fontSize: 11,
          color: colors.textSecondary,
          marginBottom: spacing.xs,
        }}
      >
        {uiCopy.calendar.typeFilterHeading}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: spacing.xs,
          marginBottom: spacing.sm,
        }}
      >
        {[
          { k: 'all' as const, label: uiCopy.calendar.typeFilterAll },
          { k: 'option' as const, label: uiCopy.calendar.typeFilterOption },
          { k: 'casting' as const, label: uiCopy.calendar.typeFilterCasting },
          { k: 'booking' as const, label: uiCopy.calendar.typeFilterBooking },
        ].map(({ k, label }) => (
          <TouchableOpacity
            key={k}
            onPress={() => setTypeFilter(k)}
            style={{
              paddingHorizontal: spacing.sm,
              paddingVertical: spacing.xs,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: typeFilter === k ? colors.textPrimary : colors.border,
              backgroundColor: typeFilter === k ? colors.surface : 'transparent',
            }}
          >
            <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary }}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <B2BUnifiedCalendarBody
        viewerRole="client"
        viewMode={calendarViewMode}
        onViewModeChange={setCalendarViewMode}
        calendarMonth={calendarMonth}
        setCalendarMonth={setCalendarMonth}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        eventsByDate={eventsByDate}
        filteredUnified={filteredUnified}
        onOpenUnifiedRow={openUnifiedRow}
      />

      {calendarViewMode === 'month' && filteredUnified.length === 0 && !loading && (
        <Text
          style={{
            ...typography.body,
            fontSize: 12,
            color: colors.textSecondary,
            marginBottom: spacing.sm,
          }}
        >
          No calendar entries yet. Add your own events or wait for confirmed options/jobs.
        </Text>
      )}
    </ScrollView>
  );
};

/** Displays the client's active option requests grouped by status. */
const ActiveOptionsView: React.FC<{
  onClose: () => void;
  assignmentByClientOrgId?: Record<string, ClientAssignmentFlag>;
  scrollBottomInset?: number;
}> = ({ onClose, assignmentByClientOrgId = {}, scrollBottomInset = 0 }) => {
  const [requests, setRequests] = React.useState(getOptionRequests());
  const copy = uiCopy.dashboard;

  React.useEffect(() => {
    setRequests(getOptionRequests());
    const unsub = subscribe(() => setRequests(getOptionRequests()));
    return unsub;
  }, []);

  const grouped = React.useMemo(() => {
    const negotiating = requests.filter((r) => r.status === 'in_negotiation');
    const confirmed = requests.filter((r) => r.status === 'confirmed');
    const rejected = requests.filter((r) => r.status === 'rejected');
    return { negotiating, confirmed, rejected };
  }, [requests]);

  const renderRow = (r: ReturnType<typeof getOptionRequests>[0]) => (
    <View
      key={r.threadId}
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textPrimary }}>
          {r.modelName}
        </Text>
        {r.date ? (
          <Text style={{ fontSize: 11, color: colors.textSecondary }}>{r.date}</Text>
        ) : null}
        {r.clientOrganizationId && assignmentByClientOrgId[r.clientOrganizationId] ? (
          <Text style={{ fontSize: 10, color: colors.textSecondary, marginTop: 2 }}>
            {assignmentByClientOrgId[r.clientOrganizationId].label}
            {assignmentByClientOrgId[r.clientOrganizationId].assignedMemberName
              ? ` · ${assignmentByClientOrgId[r.clientOrganizationId].assignedMemberName}`
              : ''}
          </Text>
        ) : null}
      </View>
      <View
        style={{
          backgroundColor:
            r.status === 'confirmed' ? '#dcfce7' : r.status === 'rejected' ? '#fee2e2' : '#fef3c7',
          borderRadius: 6,
          paddingHorizontal: spacing.sm,
          paddingVertical: 2,
        }}
      >
        <Text
          style={{
            fontSize: 10,
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color:
              r.status === 'confirmed'
                ? '#16a34a'
                : r.status === 'rejected'
                  ? '#dc2626'
                  : '#92400e',
          }}
        >
          {r.status === 'in_negotiation'
            ? copy.optionRequestStatusInNegotiation
            : r.status === 'confirmed'
              ? copy.optionRequestStatusConfirmed
              : copy.optionRequestStatusRejected}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: spacing.md,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={{ fontSize: 18, color: colors.textPrimary, marginRight: spacing.md }}>
            ‹
          </Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.textPrimary }}>
          {copy.activeOptionsTitle}
        </Text>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: spacing.md,
          paddingBottom: spacing.md + scrollBottomInset,
        }}
      >
        {requests.length === 0 && (
          <Text
            style={{
              fontSize: 13,
              color: colors.textSecondary,
              textAlign: 'center',
              marginTop: spacing.xl,
            }}
          >
            {copy.activeOptionsEmpty}
          </Text>
        )}
        {grouped.negotiating.length > 0 && (
          <View style={{ marginBottom: spacing.md }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: '600',
                color: colors.textSecondary,
                textTransform: 'uppercase',
                letterSpacing: 1,
                marginBottom: spacing.sm,
              }}
            >
              {copy.optionRequestStatusInNegotiation} ({grouped.negotiating.length})
            </Text>
            {grouped.negotiating.map(renderRow)}
          </View>
        )}
        {grouped.confirmed.length > 0 && (
          <View style={{ marginBottom: spacing.md }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: '600',
                color: colors.accentGreen,
                textTransform: 'uppercase',
                letterSpacing: 1,
                marginBottom: spacing.sm,
              }}
            >
              {copy.optionRequestStatusConfirmed} ({grouped.confirmed.length})
            </Text>
            {grouped.confirmed.map(renderRow)}
          </View>
        )}
        {grouped.rejected.length > 0 && (
          <View style={{ marginBottom: spacing.md }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: '600',
                color: colors.textSecondary,
                textTransform: 'uppercase',
                letterSpacing: 1,
                marginBottom: spacing.sm,
              }}
            >
              {copy.optionRequestStatusRejected} ({grouped.rejected.length})
            </Text>
            {grouped.rejected.map(renderRow)}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

type ProjectsProps = {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  newProjectName: string;
  setNewProjectName: (v: string) => void;
  onCreateProject: () => void;
  creatingProject?: boolean;
  onDeleteProject: (id: string) => void;
  canDeleteProject: (p: Project) => boolean;
  onOpenDetails: (id: string) => void;
  /** Opens project folder (scrollable model list). */
  onOpenProject: (id: string) => void;
  onShareFolder: (project: Project) => void;
  onOpenOptionChat: (threadId: string) => void;
  scrollBottomInset?: number;
};

const ProjectsView: React.FC<ProjectsProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  newProjectName,
  setNewProjectName,
  onCreateProject,
  creatingProject = false,
  onDeleteProject,
  canDeleteProject,
  onOpenProject,
  onShareFolder,
  onOpenOptionChat,
  scrollBottomInset = 0,
}) => {
  return (
    <View style={[styles.section, { minHeight: 0 }]}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>My Projects</Text>
      </View>

      {/*
        Keep the create row OUTSIDE ScrollView: on RN Web, ScrollView often steals the first
        tap / breaks TouchableOpacity onPress for header rows inside the scroll area (no handler
        fire → no network). List scroll remains below.
      */}
      <View style={styles.newProjectRow}>
        <TextInput
          value={newProjectName}
          onChangeText={setNewProjectName}
          placeholder="New project, e.g. Zalando HW26"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
          editable={!creatingProject}
          returnKeyType="done"
          blurOnSubmit={false}
          onSubmitEditing={() => {
            void onCreateProject();
          }}
        />
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            creatingProject && styles.primaryButtonDisabled,
            pressed && !creatingProject && { opacity: 0.85 },
          ]}
          onPress={() => {
            void onCreateProject();
          }}
          disabled={creatingProject}
          accessibilityRole="button"
          accessibilityState={{ disabled: creatingProject }}
        >
          <Text style={styles.primaryLabel}>
            {creatingProject ? uiCopy.projects.creatingProject : 'Create'}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="always"
        style={[styles.projectsList, { minHeight: 0 }]}
        contentContainerStyle={{ paddingBottom: scrollBottomInset + spacing.md }}
      >
        {projects.map((p) => (
          <View
            key={p.id}
            style={[styles.projectCard, activeProjectId === p.id && styles.projectCardActive]}
          >
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => onSelectProject(p.id)}
              style={styles.projectCardTopRow}
            >
              <Text style={styles.projectName}>{p.name}</Text>
              <Text style={styles.projectModelCount}>
                {p.models.length} model{p.models.length === 1 ? '' : 's'}
              </Text>
            </TouchableOpacity>

            <View style={styles.projectPrimaryActions}>
              <TouchableOpacity style={styles.projectActionBtn} onPress={() => onOpenProject(p.id)}>
                <Text style={styles.projectActionBtnLabel}>{uiCopy.projects.open}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.projectSecondaryActions}>
              {p.models.length > 0 && (
                <TouchableOpacity onPress={() => onShareFolder(p)}>
                  <Text style={styles.shareFolderLabel}>Share folder</Text>
                </TouchableOpacity>
              )}
              {canDeleteProject(p) ? (
                <TouchableOpacity
                  onPress={(e) => {
                    e.stopPropagation();
                    onDeleteProject(p.id);
                  }}
                >
                  <Text style={styles.deleteProjectLabel}>Delete</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {getOptionRequestsByProjectId(p.id).length > 0 && (
              <View style={styles.projectOptionChats}>
                <Text style={styles.projectOptionChatsLabel}>Option chats</Text>
                {getOptionRequestsByProjectId(p.id).map((r) => (
                  <TouchableOpacity
                    key={r.threadId}
                    style={styles.projectOptionChatRow}
                    onPress={() => onOpenOptionChat(r.threadId)}
                  >
                    <Text style={styles.projectOptionChatText}>
                      {r.modelName} · {r.date}
                    </Text>
                    <Text style={styles.projectOptionChatOpen}>Open chat</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        ))}

        {projects.length === 0 && (
          <View style={styles.emptyProjects}>
            <Text style={styles.emptyTitle}>No projects yet</Text>
            <Text style={styles.emptyCopy}>Create a project and add models from Discover.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

type ProjectOverviewProps = {
  project: Project | null;
  onBack: () => void;
  onRemoveModel: (projectId: string, modelId: string) => Promise<void>;
  onBrowseDiscover: (projectId: string) => void;
  scrollBottomInset?: number;
};

const ProjectOverviewView: React.FC<ProjectOverviewProps> = ({
  project,
  onBack,
  onRemoveModel,
  onBrowseDiscover,
  scrollBottomInset = 0,
}) => {
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [errorId, setErrorId] = useState<string | null>(null);

  const handleDelete = async (modelId: string) => {
    if (!project) return;
    setBusyIds((prev) => new Set(prev).add(modelId));
    setErrorId(null);
    try {
      await onRemoveModel(project.id, modelId);
    } catch {
      setErrorId(modelId);
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(modelId);
        return next;
      });
    }
  };

  if (!project) return null;

  return (
    <View style={[styles.section, { flex: 1, minHeight: 0 }]}>
      <View style={styles.overviewHeader}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.overviewBackBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.overviewBackLabel}>{uiCopy.projects.back}</Text>
        </TouchableOpacity>
        <Text style={styles.overviewTitle}>{project.name}</Text>
      </View>

      <TouchableOpacity
        style={styles.overviewBrowseBtn}
        onPress={() => onBrowseDiscover(project.id)}
        activeOpacity={0.85}
      >
        <Text style={styles.overviewBrowseBtnLabel}>{uiCopy.projects.browseInDiscover}</Text>
      </TouchableOpacity>

      <ScrollView
        style={[styles.overviewList, { flex: 1, minHeight: 0 }]}
        contentContainerStyle={[
          styles.overviewListContent,
          { paddingBottom: spacing.xl + scrollBottomInset },
        ]}
      >
        {project.models.length === 0 && (
          <View style={styles.emptyProjects}>
            <Text style={styles.emptyCopy}>{uiCopy.projects.emptyOverview}</Text>
          </View>
        )}
        {project.models.map((m) => {
          const lineCity = summaryDisplayCity(m);
          return (
            <View key={m.id} style={styles.overviewModelRow}>
              <StorageImage
                uri={m.coverUrl || undefined}
                style={styles.overviewModelImage}
                resizeMode="contain"
                ttlSeconds={CLIENT_MODEL_IMAGE_TTL_SEC}
                fallback={
                  <View style={[styles.overviewModelImage, { backgroundColor: colors.border }]} />
                }
              />
              <View style={styles.overviewModelInfo}>
                <Text style={styles.overviewModelName}>{m.name}</Text>
                <Text style={styles.overviewModelMeta}>
                  {[
                    m.height ? `${m.height} cm` : null,
                    m.chest || m.bust ? `Chest ${m.chest || m.bust} cm` : null,
                    m.waist ? `Waist ${m.waist} cm` : null,
                    m.hips ? `Hips ${m.hips} cm` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                {lineCity ? <Text style={styles.overviewModelCity}>{lineCity}</Text> : null}
                {errorId === m.id && (
                  <Text style={styles.overviewModelError}>{uiCopy.projects.removeError}</Text>
                )}
              </View>
              <TouchableOpacity
                style={[
                  styles.overviewDeleteBtn,
                  busyIds.has(m.id) && styles.overviewDeleteBtnBusy,
                ]}
                onPress={() => handleDelete(m.id)}
                disabled={busyIds.has(m.id)}
              >
                <Text style={styles.overviewDeleteBtnLabel}>
                  {busyIds.has(m.id) ? uiCopy.common.loading : uiCopy.projects.deleteFromProject}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
};

const AgenciesView: React.FC<{
  clientUserId: string | null;
  onChatStarted: (conversationId: string, agencyName: string) => void;
  scrollBottomInset?: number;
}> = ({ clientUserId, onChatStarted, scrollBottomInset = 0 }) => {
  const [search, setSearch] = useState('');
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [agencyTypeFilter, setAgencyTypeFilter] = useState<string[]>([]);
  const [invitationEmail, setInvitationEmail] = useState('');
  const [invitationFeedback, setInvitationFeedback] = useState<string | null>(null);
  const [busyAgencyId, setBusyAgencyId] = useState<string | null>(null);

  useEffect(() => {
    if (agencyTypeFilter.length === 0) {
      void getAgencies().then(setAgencies);
    } else {
      void getAgencies({ overlapsAgencyTypes: agencyTypeFilter }).then(setAgencies);
    }
  }, [agencyTypeFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return agencies;
    return agencies.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.city && a.city.toLowerCase().includes(q)) ||
        (a.focus && a.focus.toLowerCase().includes(q)),
    );
  }, [search, agencies]);

  const showNotFound = search.trim().length >= 2 && filtered.length === 0;

  const handleSendInvitation = async () => {
    if (!invitationEmail.trim() || !clientUserId) return;
    await sendAgencyInvitation(search.trim(), invitationEmail.trim(), clientUserId);
    setInvitationFeedback('Invitation link sent.');
    setInvitationEmail('');
    setTimeout(() => setInvitationFeedback(null), 3000);
  };

  const startChat = async (agency: Agency) => {
    if (!clientUserId) {
      showAppAlert(uiCopy.alerts.signInRequired, uiCopy.b2bChat.signInToChatBody);
      return;
    }
    setBusyAgencyId(agency.id);
    try {
      const r = await ensureClientAgencyChat({
        clientUserId,
        agencyId: agency.id,
        actingUserId: clientUserId,
      });
      if (!r.ok) {
        showAppAlert(uiCopy.b2bChat.chatFailedTitle, r.reason || uiCopy.b2bChat.chatFailedGeneric);
        return;
      }
      onChatStarted(r.conversationId, agency.name);
    } finally {
      setBusyAgencyId(null);
    }
  };

  return (
    <View style={[styles.section, { minHeight: 0 }]}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>{uiCopy.b2bChat.agenciesSectionTitle}</Text>
        <Text style={styles.metaText}>{uiCopy.b2bChat.agenciesSubtitle}</Text>
      </View>
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder={uiCopy.b2bChat.agenciesSearchPlaceholder}
        placeholderTextColor={colors.textSecondary}
        style={styles.agencySearchInput}
      />
      <Text
        style={{
          ...typography.label,
          fontSize: 11,
          color: colors.textSecondary,
          marginBottom: spacing.xs,
        }}
      >
        {uiCopy.b2bChat.agencyTypeFilterLabel}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: spacing.sm,
          marginBottom: spacing.md,
        }}
      >
        {AGENCY_SEGMENT_TYPES.map((seg) => {
          const on = agencyTypeFilter.includes(seg);
          return (
            <TouchableOpacity
              key={seg}
              style={[
                styles.filterPill,
                on && { borderColor: colors.accentGreen, backgroundColor: colors.surface },
              ]}
              onPress={() => {
                setAgencyTypeFilter((prev) =>
                  on ? prev.filter((x) => x !== seg) : [...prev, seg],
                );
              }}
            >
              <Text style={[styles.filterPillLabel, on && { color: colors.accentGreen }]}>
                {seg}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {showNotFound && (
        <View
          style={{
            padding: spacing.md,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
            marginBottom: spacing.md,
          }}
        >
          <Text style={{ ...typography.body, color: colors.textPrimary, marginBottom: spacing.sm }}>
            {uiCopy.b2bChat.agencyNotFoundTitle}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TextInput
              value={invitationEmail}
              onChangeText={setInvitationEmail}
              placeholder={uiCopy.b2bChat.agencyEmailPlaceholder}
              placeholderTextColor={colors.textSecondary}
              keyboardType="email-address"
              style={[styles.input, { flex: 1, height: 36 }]}
            />
            <TouchableOpacity style={styles.primaryButton} onPress={handleSendInvitation}>
              <Text style={styles.primaryLabel}>{uiCopy.b2bChat.sendInvitation}</Text>
            </TouchableOpacity>
          </View>
          {invitationFeedback ? (
            <Text
              style={{
                ...typography.body,
                fontSize: 12,
                color: colors.accentGreen,
                marginTop: spacing.xs,
              }}
            >
              {invitationFeedback}
            </Text>
          ) : null}
        </View>
      )}

      <ScrollView
        style={{ flex: 1, minHeight: 0 }}
        contentContainerStyle={{ paddingBottom: scrollBottomInset + spacing.md }}
      >
        <View style={styles.agencyList}>
          {filtered.map((a) => (
            <View key={a.id} style={styles.agencyRow}>
              <View style={styles.agencyLeft}>
                <Text style={styles.agencyName}>{a.name}</Text>
                <Text style={styles.metaText}>{a.city ?? '—'}</Text>
                {a.agency_types && a.agency_types.length > 0 ? (
                  <Text style={{ ...styles.metaText, fontSize: 11, marginTop: 4 }}>
                    {a.agency_types.join(' · ')}
                  </Text>
                ) : null}
              </View>
              <View style={styles.agencyRight}>
                <View style={styles.agencyPill}>
                  <Text style={styles.agencyPillLabel}>{a.focus ?? '—'}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.contactButton, busyAgencyId === a.id && { opacity: 0.6 }]}
                  disabled={busyAgencyId === a.id}
                  onPress={() => void startChat(a)}
                >
                  <Text style={styles.contactButtonLabel}>{uiCopy.b2bChat.startChat}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.agencyContactLink}
                  onPress={() => Linking.openURL(`mailto:${a.email || 'contact@agency.com'}`)}
                >
                  <Text style={styles.agencyContactLinkLabel}>{uiCopy.b2bChat.contactLink}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
};

const STATUS_LABELS: Record<ChatStatus, string> = {
  in_negotiation: uiCopy.dashboard.optionRequestStatusInNegotiation,
  confirmed: uiCopy.dashboard.optionRequestStatusConfirmed,
  rejected: uiCopy.dashboard.optionRequestStatusRejected,
};

const STATUS_COLORS: Record<ChatStatus, string> = OPTION_REQUEST_CHAT_STATUS_COLORS;

type MessagesViewProps = {
  openThreadId: string | null;
  onClearOpenThreadId: () => void;
  isAgency: boolean;
  currentUserId?: string | null;
  assignmentByClientOrgId?: Record<string, ClientAssignmentFlag>;
  assignableMembers?: Array<{ userId: string; name: string }>;
  onSaveClientAssignment?: (
    clientOrganizationId: string,
    patch: { label: string; color: AssignmentFlagColor; assignedMemberUserId?: string | null },
  ) => Promise<void>;
  msgFilter?: 'current' | 'archived';
  onMsgFilterChange?: (f: 'current' | 'archived') => void;
  clientUserId?: string | null;
  clientOrgId?: string | null;
  pendingClientB2BChat?: { conversationId: string; title: string } | null;
  onPendingClientB2BChatConsumed?: () => void;
  onBookingCardPress?: (meta: Record<string, unknown>) => void;
  onPackagePress?: (meta: Record<string, unknown>) => void;
  /** Refresh calendar / merged views after an option_request was deleted. */
  onOptionRequestDeleted?: () => void;
  /** Refresh calendar cache after negotiation actions that update projection (price, confirm, reject). */
  onOptionProjectionChanged?: () => void;
  /** Call when user opens a thread from the in-tab list (Back returns to list only). */
  onOptionThreadOpenedFromList?: () => void;
  /** After Back from fullscreen option chat: restore previous tab when opened from discover/project/dashboard. */
  onCloseOptionNegotiation?: () => void;
  /** Called with true when a chat occupies the full mobile screen — outer shell hides the bottom tab bar. */
  onChatFullscreenChange?: (active: boolean) => void;
};

const ClientB2BChatsPanel: React.FC<{
  clientUserId: string;
  pendingOpen?: { conversationId: string; title: string } | null;
  onPendingConsumed?: () => void;
  onBookingCardPress?: (meta: Record<string, unknown>) => void;
  onPackagePress?: (meta: Record<string, unknown>) => void;
  onOpenRelatedRequest?: (optionRequestId: string) => void;
  searchQuery?: string;
  /** Called with true when a chat is actively open on mobile (non-split), false otherwise. */
  onChatActiveChange?: (active: boolean) => void;
}> = ({
  clientUserId,
  pendingOpen,
  onPendingConsumed,
  onBookingCardPress,
  onPackagePress,
  onOpenRelatedRequest,
  searchQuery = '',
  onChatActiveChange,
}) => {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const b2bWebSplit = Platform.OS === 'web' && shouldUseB2BWebSplit(windowWidth);
  const b2bPanelInsets = useSafeAreaInsets();
  const clientB2bThreadListScrollStyle = useMemo(
    () =>
      flexFillScrollWebWithMinHeight(
        windowHeight,
        b2bPanelInsets.top,
        b2bPanelInsets.bottom,
        'default',
      ),
    [windowHeight, b2bPanelInsets.top, b2bPanelInsets.bottom],
  );
  const auth = useAuth();
  const [rows, setRows] = useState<Conversation[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [clientOrgId, setClientOrgId] = useState<string | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Until `rows` + `titles` include a freshly started chat, keep the agency name from Start chat. */
  const [optimisticThreadTitle, setOptimisticThreadTitle] = useState<string | null>(null);
  const [viewingAgencyProfileState, setViewingAgencyProfileState] = useState<{
    orgId: string;
    agencyId: string | null;
    orgName: string;
  } | null>(null);
  const [b2bUnreadById, setB2bUnreadById] = useState<Record<string, boolean>>({});
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const reload = useCallback(() => {
    if (!clientOrgId) return;
    void listB2BConversationsForOrganization(clientOrgId).then(setRows);
  }, [clientOrgId]);

  useEffect(() => {
    let cancelled = false;
    setOrgLoading(true);
    void (async () => {
      let oid = await getClientOrganizationIdForUser(clientUserId);
      if (!oid) oid = await ensureClientOrganization();
      if (!cancelled) {
        setClientOrgId(oid);
        setOrgLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientUserId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!clientOrgId || rows.length === 0) {
      setTitles({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      rows.map(async (c) => {
        const t = await getB2BConversationTitleForViewer({
          conversation: c,
          viewerOrganizationId: clientOrgId,
        });
        return [c.id, t] as const;
      }),
    ).then((pairs) => {
      if (cancelled) return;
      const m: Record<string, string> = {};
      pairs.forEach(([id, t]) => {
        m[id] = t;
      });
      setTitles(m);
      if (selectedId && m[selectedId]) {
        setOptimisticThreadTitle(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [rows, clientOrgId, selectedId]);

  useEffect(() => {
    if (!pendingOpen?.conversationId || !clientOrgId) return;
    setSelectedId(pendingOpen.conversationId);
    setOptimisticThreadTitle(pendingOpen.title);
    onPendingConsumed?.();
    void listB2BConversationsForOrganization(clientOrgId).then(setRows);
  }, [pendingOpen?.conversationId, clientOrgId, onPendingConsumed, pendingOpen?.title]);

  // Notify parent when a chat becomes active or inactive on mobile (non-split).
  // This lets MessagesView hide the search/tab bar while inside a chat.
  useEffect(() => {
    const isMobileChat = !b2bWebSplit && !!selectedId;
    onChatActiveChange?.(isMobileChat);
  }, [selectedId, b2bWebSplit, onChatActiveChange]);

  const conversationIdsKey = useMemo(
    () =>
      rows
        .map((c) => c.id)
        .sort()
        .join(','),
    [rows],
  );

  useEffect(() => {
    const list = rowsRef.current;
    if (!clientUserId || list.length === 0) {
      setB2bUnreadById({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      list.map(async (c) => {
        const u = await conversationHasUnreadForViewer(c.id, clientUserId);
        return [c.id, u] as const;
      }),
    ).then((pairs) => {
      if (cancelled) return;
      const next: Record<string, boolean> = {};
      pairs.forEach(([id, u]) => {
        next[id] = u;
      });
      setB2bUnreadById(next);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationIdsKey, clientUserId]);

  useEffect(() => {
    if (selectedId) {
      setB2bUnreadById((prev) => ({ ...prev, [selectedId]: false }));
    }
  }, [selectedId]);

  useEffect(() => {
    const list = rowsRef.current;
    if (!clientUserId || list.length === 0) return;
    const unsubs = list.map((c) =>
      subscribeToConversation(c.id, (msg) => {
        if (msg.sender_id !== clientUserId && selectedIdRef.current !== c.id) {
          setB2bUnreadById((prev) => ({ ...prev, [c.id]: true }));
        }
      }),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [conversationIdsKey, clientUserId]);

  if (orgLoading) {
    return <Text style={styles.metaText}>{uiCopy.b2bChat.clientWorkspaceLoading}</Text>;
  }

  if (!clientOrgId) {
    return <Text style={styles.metaText}>{uiCopy.b2bChat.noClientWorkspaceForB2B}</Text>;
  }

  const selectedRow = selectedId ? rows.find((r) => r.id === selectedId) : undefined;
  const activeConversationId = selectedRow?.id ?? selectedId ?? null;
  const messengerTitle =
    (activeConversationId && (titles[activeConversationId] ?? optimisticThreadTitle ?? null)) ??
    uiCopy.b2bChat.chatPartnerFallback;

  const filteredRows = searchQuery.trim()
    ? rows.filter((c) =>
        (titles[c.id] ?? '').toLowerCase().includes(searchQuery.trim().toLowerCase()),
      )
    : rows;

  if (rows.length === 0 && !activeConversationId) {
    return <Text style={styles.metaText}>{uiCopy.b2bChat.noAgencyChatsYetClient}</Text>;
  }

  const threadListEl =
    filteredRows.length > 0 ? (
      <ScrollView
        style={clientB2bThreadListScrollStyle}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: spacing.sm }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        {filteredRows.map((c) => (
          <TouchableOpacity
            key={c.id}
            style={[styles.threadRow, selectedId === c.id && styles.threadRowActive]}
            onPress={() => setSelectedId(c.id)}
          >
            <View style={styles.threadRowLeft}>
              <Text style={styles.threadTitle}>
                {titles[c.id] ?? uiCopy.b2bChat.chatPartnerFallback}
              </Text>
              <Text style={styles.metaText}>{new Date(c.updated_at).toLocaleString()}</Text>
            </View>
            {clientUserId && (b2bUnreadById[c.id] ?? false) && selectedId !== c.id ? (
              <View
                style={styles.threadRowUnreadDot}
                accessibilityLabel={uiCopy.b2bChat.unreadMessagesIndicatorA11y}
              />
            ) : null}
          </TouchableOpacity>
        ))}
      </ScrollView>
    ) : searchQuery.trim() ? (
      <Text style={styles.metaText}>{uiCopy.messages.searchNoResults}</Text>
    ) : null;

  const targetAgencyOrgId = selectedRow?.agency_organization_id ?? null;

  const messengerEl = activeConversationId ? (
    <OrgMessengerInline
      conversationId={activeConversationId}
      headerTitle={messengerTitle}
      viewerUserId={auth.profile?.id ?? null}
      threadContext={{ type: uiCopy.b2bChat.contextOrgChat }}
      composerBottomInsetOverride={0}
      containerStyle={
        b2bWebSplit
          ? { marginTop: 0, flex: 1 }
          : { marginTop: 0, padding: 0, borderWidth: 0, borderRadius: 0, flex: 1, minHeight: 0 }
      }
      useFlexMessengerScroll={b2bWebSplit}
      onBookingCardPress={onBookingCardPress}
      onPackagePress={onPackagePress}
      onOpenRelatedRequest={onOpenRelatedRequest}
      onOrgPress={
        targetAgencyOrgId
          ? () => {
              void (async () => {
                const agencyId = await getAgencyIdForOrganization(targetAgencyOrgId);
                setViewingAgencyProfileState({
                  orgId: targetAgencyOrgId,
                  agencyId,
                  orgName: messengerTitle,
                });
              })();
            }
          : undefined
      }
      // Mobile (non-split): show back button to return to thread list
      onBack={b2bWebSplit ? undefined : () => setSelectedId(null)}
      backLabel={uiCopy.messages.backToChats ?? 'Chats'}
    />
  ) : null;

  return (
    <View style={[flexFillColumn, { marginTop: spacing.sm }]}>
      {b2bWebSplit ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'stretch',
            gap: spacing.md,
            flex: 1,
            minHeight: 0,
          }}
        >
          <View style={{ flex: CHAT_THREAD_LIST_FLEX, minWidth: 0 }}>{threadListEl}</View>
          <View style={{ flex: CHAT_MESSENGER_FLEX, minWidth: 0, minHeight: 0 }}>
            {messengerEl}
          </View>
        </View>
      ) : // Mobile: WhatsApp pattern — show list OR messenger (not both), messenger fills screen
      activeConversationId ? (
        <View style={{ flex: 1, minHeight: 0 }}>{messengerEl}</View>
      ) : (
        <View style={flexFillColumn}>{threadListEl}</View>
      )}
      {viewingAgencyProfileState && (
        <OrgProfileModal
          visible
          onClose={() => setViewingAgencyProfileState(null)}
          orgType="agency"
          organizationId={viewingAgencyProfileState.orgId}
          agencyId={viewingAgencyProfileState.agencyId}
          orgName={viewingAgencyProfileState.orgName}
        />
      )}
    </View>
  );
};

const MessagesView: React.FC<MessagesViewProps> = ({
  openThreadId,
  onClearOpenThreadId,
  isAgency,
  currentUserId = null,
  assignmentByClientOrgId = {},
  assignableMembers = [],
  onSaveClientAssignment,
  msgFilter = 'current',
  onMsgFilterChange,
  clientUserId = null,
  clientOrgId = null,
  pendingClientB2BChat = null,
  onPendingClientB2BChatConsumed,
  onBookingCardPress,
  onPackagePress,
  onOptionRequestDeleted,
  onOptionProjectionChanged,
  onOptionThreadOpenedFromList,
  onCloseOptionNegotiation,
  onChatFullscreenChange,
}) => {
  const { deviceType } = useDeviceType();
  const insets = useSafeAreaInsets();
  const { height: msgViewportH } = useWindowDimensions();
  const webOptionThreadListScrollStyle = useMemo(
    () => flexFillScrollWebWithMinHeight(msgViewportH, insets.top, insets.bottom, 'optionFilters'),
    [msgViewportH, insets.top, insets.bottom],
  );
  const [negotiationCounterExpanded, setNegotiationCounterExpanded] = useState(false);
  // Mobile: NegotiationSummaryCard is collapsed by default (chips in header already show status).
  // Desktop: always visible in the right rail — this state is ignored on desktop.
  const [mobileSummaryCollapsed, setMobileSummaryCollapsed] = useState(true);
  const [clientMsgTab, setClientMsgTab] = useState<'b2bChats' | 'optionRequests'>('b2bChats');
  const [clientMsgSearch, setClientMsgSearch] = useState('');
  // Tracks whether ClientB2BChatsPanel has an active chat open on mobile (non-split).
  // When true, the search bar + tabs are hidden so only the chat is visible.
  const [b2bChatIsOpen, setB2bChatIsOpen] = useState(false);
  // For client option threads: resolved agency display name for the header title.
  const [agencyTitleForThread, setAgencyTitleForThread] = useState<string | null>(null);
  // Viewing agency org profile from option thread header tap.
  const [viewingOptReqAgencyProfile, setViewingOptReqAgencyProfile] = useState<{
    orgId: string;
    agencyId: string | null;
    orgName: string | null;
  } | null>(null);
  const [requests, setRequests] = useState(getOptionRequests());
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  // Reset mobile summary collapse whenever a different negotiation thread is opened.
  useEffect(() => {
    setMobileSummaryCollapsed(true);
  }, [selectedThreadId]);
  const [chatInput, setChatInput] = useState('');
  const [chatInputHeight, setChatInputHeight] = useState(36);
  const [agencyCounterInput, setAgencyCounterInput] = useState('');
  const [calendarHint, setCalendarHint] = useState<string | null>(null);
  const calendarHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [openOrgChatBusy, setOpenOrgChatBusy] = useState(false);
  const [localPendingB2BChat, setLocalPendingB2BChat] = useState<{
    conversationId: string;
    title: string;
  } | null>(null);
  const [assignmentFilters, setAssignmentFilters] = useState<AssignmentFilters>({
    scope: 'all',
    flagLabel: 'all',
    assignedMemberUserId: 'all',
  });
  const [attentionFilter, setAttentionFilter] = useState<'all' | 'action_required'>('all');
  const [counterpartyFilter, setCounterpartyFilter] = useState<string | null>(null);
  const [deletingOptionId, setDeletingOptionId] = useState<string | null>(null);
  const [deleteOptionModalVisible, setDeleteOptionModalVisible] = useState(false);
  const [rejectCounterModalVisible, setRejectCounterModalVisible] = useState(false);
  const [editingAssignmentThreadId, setEditingAssignmentThreadId] = useState<string | null>(null);
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => {
    // Seed from localStorage for instant display before the server load completes.
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem('ci_archived_threads');
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Load archived thread IDs from the server (cross-device persistence).
  useEffect(() => {
    if (!clientOrgId) return;
    void loadArchivedThreadIds(clientOrgId).then((serverIds) => {
      if (serverIds.size === 0) return;
      setArchivedIds((prev) => {
        const merged = new Set([...prev, ...serverIds]);
        // Keep localStorage in sync.
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('ci_archived_threads', JSON.stringify([...merged]));
        }
        return merged;
      });
    });
  }, [clientOrgId]);

  useEffect(() => {
    setRequests(getOptionRequests());
    const unsub = subscribe(() => setRequests(getOptionRequests()));
    return unsub;
  }, []);

  // Deep-link / calendar / dashboard: must switch to Option Requests tab — otherwise
  // optionFullscreenActive stays false while clientMsgTab defaults to b2bChats.
  useEffect(() => {
    if (!openThreadId) return;
    setClientMsgTab('optionRequests');
    void loadOptionRequestsForClient(clientOrgId).then(() => {
      setSelectedThreadId(openThreadId);
      onClearOpenThreadId();
    });
  }, [openThreadId, onClearOpenThreadId, clientOrgId]);

  useEffect(() => {
    if (selectedThreadId) {
      refreshOptionRequestInCache(selectedThreadId);
      loadMessagesForThread(selectedThreadId);
    }
  }, [selectedThreadId]);

  // Resolve agency display name for the open option thread (client side only).
  // isAgency is always false here (MessagesView is only used by clients in ClientWebApp).
  useEffect(() => {
    const agencyId = requests.find((r) => r.id === selectedThreadId)?.agencyId;
    if (!selectedThreadId || !agencyId) {
      setAgencyTitleForThread(null);
      return;
    }
    let cancelled = false;
    getAgencyChatDisplayById(agencyId).then((row) => {
      if (!cancelled) setAgencyTitleForThread(row?.name ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedThreadId, requests]);

  const toggleArchive = (threadId: string) => {
    setArchivedIds((prev) => {
      const next = new Set(prev);
      const nowArchived = !next.has(threadId);
      if (nowArchived) next.add(threadId);
      else next.delete(threadId);
      // Persist to localStorage for instant optimistic feedback.
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('ci_archived_threads', JSON.stringify([...next]));
      }
      // Persist to server for cross-device sync (fire-and-forget; localStorage is the fallback).
      if (clientOrgId) {
        void setThreadArchived(clientOrgId, threadId, nowArchived);
      }
      return next;
    });
  };

  const clientCounterparties = useMemo(() => extractCounterparties(requests, 'client'), [requests]);

  const visibleRequests = requests.filter((r) => {
    if (msgFilter === 'archived' ? !archivedIds.has(r.threadId) : archivedIds.has(r.threadId))
      return false;
    if (counterpartyFilter) {
      const agencyKey = r.agencyOrganizationId ?? r.agencyId ?? '';
      if (agencyKey !== counterpartyFilter) return false;
    }
    if (clientMsgSearch.trim()) {
      const q = clientMsgSearch.trim().toLowerCase();
      return (
        (r.modelName ?? '').toLowerCase().includes(q) ||
        (r.clientName ?? '').toLowerCase().includes(q)
      );
    }
    const assignment = r.clientOrganizationId
      ? assignmentByClientOrgId[r.clientOrganizationId]
      : undefined;
    if (assignmentFilters.scope === 'mine' && assignment?.assignedMemberUserId !== currentUserId)
      return false;
    if (assignmentFilters.scope === 'unassigned' && !!assignment?.assignedMemberUserId)
      return false;
    if (
      assignmentFilters.flagLabel !== 'all' &&
      (assignment?.label ?? '').toLowerCase() !== assignmentFilters.flagLabel.toLowerCase()
    )
      return false;
    if (
      assignmentFilters.assignedMemberUserId !== 'all' &&
      assignment?.assignedMemberUserId !== assignmentFilters.assignedMemberUserId
    )
      return false;
    if (attentionFilter === 'action_required') {
      const sig = attentionSignalsFromOptionRequestLike({
        status: r.status,
        finalStatus: r.finalStatus ?? null,
        clientPriceStatus: r.clientPriceStatus ?? null,
        modelApproval: r.modelApproval,
        modelAccountLinked: r.modelAccountLinked ?? false,
        agencyCounterPrice: r.agencyCounterPrice ?? null,
        proposedPrice: r.proposedPrice ?? null,
      });
      if (!attentionHeaderLabelFromSignals(sig, 'client')) return false;
    }
    return true;
  });

  const request = selectedThreadId ? getRequestByThreadId(selectedThreadId) : null;
  const messages = selectedThreadId ? getMessages(selectedThreadId) : [];
  const status = request ? (getRequestStatus(request.threadId) ?? request.status) : null;
  const finalStatus = request?.finalStatus;
  const clientPriceStatus = request?.clientPriceStatus;
  const agencyCounterPrice = request?.agencyCounterPrice;
  const currency = request?.currency ?? 'EUR';
  const displayStatus = request
    ? toDisplayStatus(request.status, request.finalStatus ?? null, {
        clientPriceStatus: request.clientPriceStatus ?? null,
        agencyCounterPrice: request.agencyCounterPrice ?? null,
        proposedPrice: request.proposedPrice ?? null,
      })
    : 'Draft';
  const headerAttentionLabel = request
    ? attentionHeaderLabelFromSignals(
        attentionSignalsFromOptionRequestLike({
          status: request.status,
          finalStatus: request.finalStatus ?? null,
          clientPriceStatus: request.clientPriceStatus ?? null,
          modelApproval: request.modelApproval,
          modelAccountLinked: request.modelAccountLinked ?? false,
          agencyCounterPrice: request.agencyCounterPrice ?? null,
          proposedPrice: request.proposedPrice ?? null,
        }),
        isAgency ? 'agency' : 'client',
      )
    : null;
  const negotiationDateLine = request
    ? formatDateWithOptionalTimeRange(request.date, request.startTime, request.endTime)
    : '';
  const negotiationFinalStatusLine =
    request && request.finalStatus
      ? `${request.requestType === 'casting' ? uiCopy.dashboard.threadContextCasting : uiCopy.dashboard.threadContextOption} — ${optionConfirmedBannerLabel(
          {
            finalStatus: request.finalStatus,
            modelAccountLinked: request.modelAccountLinked,
            modelApproval: request.modelApproval,
          },
        )}`
      : null;
  const negotiationRequestTypeLabel =
    request?.requestType === 'casting'
      ? uiCopy.dashboard.threadContextCasting
      : uiCopy.dashboard.threadContextOption;
  const showDesktopNegotiationRail = deviceType === 'desktop';
  const negotiationConfirmationSummaryLine = request
    ? isAgency
      ? agencyNegotiationThreadSummaryHint({
          modelAccountLinked: request.modelAccountLinked,
          modelApproval: request.modelApproval,
          finalStatus: request.finalStatus ?? null,
          status: request.status,
        })
      : request.modelAccountLinked === false
        ? uiCopy.optionNegotiationChat.clientNoModelAppHint
        : request.finalStatus === 'option_confirmed' &&
            request.status === 'in_negotiation' &&
            request.modelApproval === 'pending'
          ? uiCopy.optionNegotiationChat.clientWaitingForModelConfirm
          : null
    : null;
  const viewerRole = isAgency ? 'agency' : 'client';
  const filteredMessages = messages.filter((m) => shouldShowSystemMessageForViewer(m, viewerRole));

  const sendMessage = () => {
    const text = chatInput.trim();
    if (!text || !selectedThreadId) return;
    addMessage(selectedThreadId, isAgency ? 'agency' : 'client', text);
    setChatInput('');
    setChatInputHeight(36);
  };

  const openDeleteOptionModal = () => {
    if (!request || !selectedThreadId || deletingOptionId) return;
    if (request.finalStatus === 'job_confirmed') {
      showAppAlert(uiCopy.messages.deleteOptionRequestNotAllowed);
      return;
    }
    setDeleteOptionModalVisible(true);
  };

  const confirmDeleteOptionRequest = () => {
    if (!request || !selectedThreadId || deletingOptionId) return;
    const threadId = request.threadId;
    const reqId = request.id;
    setDeleteOptionModalVisible(false);
    void (async () => {
      setDeletingOptionId(threadId);
      try {
        const ok = await deleteOptionRequestFull(reqId, {
          auditActor: 'client',
          auditOrganizationId: clientOrgId,
        });
        if (!ok) {
          showAppAlert(uiCopy.common.error, uiCopy.messages.deleteOptionRequestFailed);
          return;
        }
        purgeOptionThreadFromStore(threadId);
        setSelectedThreadId(null);
        await loadOptionRequestsForClient(clientOrgId);
        onOptionRequestDeleted?.();
      } finally {
        setDeletingOptionId(null);
      }
    })();
  };

  const handleBackOptionChat = () => {
    setSelectedThreadId(null);
    setNegotiationCounterExpanded(false);
    onCloseOptionNegotiation?.();
  };

  const openOrgChatFromRequest = async () => {
    if (!request?.agencyId || !clientOrgId || !currentUserId || openOrgChatBusy) return;
    setOpenOrgChatBusy(true);
    try {
      const result = await ensureClientAgencyChat({
        agencyId: request.agencyId,
        actingUserId: currentUserId,
        clientOrganizationId: clientOrgId,
      });
      if (!result.ok) {
        showAppAlert(
          uiCopy.b2bChat.chatFailedTitle,
          result.reason || uiCopy.b2bChat.chatFailedGeneric,
        );
        return;
      }
      setClientMsgTab('b2bChats');
      setLocalPendingB2BChat({
        conversationId: result.conversationId,
        title: request.clientName || uiCopy.b2bChat.chatPartnerFallback,
      });
    } finally {
      setOpenOrgChatBusy(false);
    }
  };

  const showNegotiationCalendarHint = useCallback(() => {
    onOptionProjectionChanged?.();
    if (calendarHintTimerRef.current) clearTimeout(calendarHintTimerRef.current);
    setCalendarHint(uiCopy.dashboard.negotiationCalendarSyncedHint);
    calendarHintTimerRef.current = setTimeout(() => {
      setCalendarHint(null);
      calendarHintTimerRef.current = null;
    }, 4000);
  }, [onOptionProjectionChanged]);

  const runAgencyConfirmAvailability = useCallback(async () => {
    if (!request?.threadId) return;
    await agencyConfirmAvailabilityStore(request.threadId);
    setRequests(getOptionRequests());
    showNegotiationCalendarHint();
  }, [request?.threadId, showNegotiationCalendarHint]);

  const runAgencyAcceptClientPrice = useCallback(async () => {
    if (!request?.threadId) return;
    await agencyAcceptClientPriceStore(request.threadId);
    setRequests(getOptionRequests());
    showNegotiationCalendarHint();
  }, [request?.threadId, showNegotiationCalendarHint]);

  const runAgencyRejectClientPrice = useCallback(async () => {
    if (!request?.threadId) return;
    await agencyRejectClientPriceStore(request.threadId);
    setRequests(getOptionRequests());
    showNegotiationCalendarHint();
  }, [request?.threadId, showNegotiationCalendarHint]);

  const runAgencyCounterOffer = useCallback(
    async (amount: number) => {
      if (!request?.threadId) return;
      await agencyCounterOfferStore(request.threadId, amount, currency);
      setAgencyCounterInput('');
      setNegotiationCounterExpanded(false);
      setRequests(getOptionRequests());
      showNegotiationCalendarHint();
    },
    [request?.threadId, currency, showNegotiationCalendarHint],
  );

  const runClientAcceptCounter = useCallback(async () => {
    if (!request?.threadId) return;
    await clientAcceptCounterStore(request.threadId);
    setRequests(getOptionRequests());
    showNegotiationCalendarHint();
  }, [request?.threadId, showNegotiationCalendarHint]);

  const runClientConfirmJob = useCallback(async () => {
    if (!request?.threadId) return;
    await clientConfirmJobStore(request.threadId);
    setRequests(getOptionRequests());
    showNegotiationCalendarHint();
  }, [request?.threadId, showNegotiationCalendarHint]);

  const openRejectCounterModal = useCallback(async () => {
    if (!request?.threadId) return;
    setRejectCounterModalVisible(true);
  }, [request?.threadId]);

  const confirmRejectCounterOffer = useCallback(() => {
    if (!request?.threadId) return;
    const threadId = request.threadId;
    setRejectCounterModalVisible(false);
    void (async () => {
      await clientRejectCounterStore(threadId);
      setRequests(getOptionRequests());
      showNegotiationCalendarHint();
    })();
  }, [request?.threadId, showNegotiationCalendarHint]);

  const handleRejectOptionNegotiation = useCallback(() => {
    if (!request?.threadId || !isAgency) return;
    const threadId = request.threadId;
    const run = () => {
      void (async () => {
        await agencyRejectNegotiationStore(threadId);
        setRequests(getOptionRequests());
        showNegotiationCalendarHint();
      })();
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
  }, [request?.threadId, isAgency, showNegotiationCalendarHint]);

  const showClientMessagesTabs = !isAgency && !!clientUserId;

  // Selecting a negotiation thread must show the Option Requests tab (not B2B-only shell).
  useEffect(() => {
    if (!selectedThreadId || !showClientMessagesTabs) return;
    setClientMsgTab('optionRequests');
  }, [selectedThreadId, showClientMessagesTabs]);

  const optionFullscreenActive =
    !!selectedThreadId &&
    !!request &&
    (!showClientMessagesTabs || clientMsgTab === 'optionRequests');

  // Notify outer shell when this view occupies the full mobile screen so it can hide the tab bar.
  useEffect(() => {
    onChatFullscreenChange?.(b2bChatIsOpen || optionFullscreenActive);
  }, [b2bChatIsOpen, optionFullscreenActive, onChatFullscreenChange]);

  return (
    <View style={[styles.section, flexFillColumn]}>
      {showClientMessagesTabs && !optionFullscreenActive && !b2bChatIsOpen && (
        <View style={styles.msgsFixedTop}>
          <TextInput
            value={clientMsgSearch}
            onChangeText={setClientMsgSearch}
            placeholder={uiCopy.messages.searchPlaceholderClient}
            placeholderTextColor={colors.textSecondary}
            style={[styles.searchInput, { marginBottom: spacing.xs }]}
            multiline={false}
            numberOfLines={1}
            returnKeyType="search"
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              flexDirection: 'row',
              gap: spacing.sm,
              paddingVertical: spacing.xs,
            }}
          >
            <TouchableOpacity
              style={[styles.filterPill, clientMsgTab === 'b2bChats' && styles.filterPillActive]}
              onPress={() => setClientMsgTab('b2bChats')}
            >
              <Text
                style={[
                  styles.filterPillLabel,
                  clientMsgTab === 'b2bChats' && styles.filterPillLabelActive,
                ]}
              >
                {uiCopy.b2bChat.tabB2BChatsClientView}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.filterPill,
                clientMsgTab === 'optionRequests' && styles.filterPillActive,
              ]}
              onPress={() => setClientMsgTab('optionRequests')}
            >
              <Text
                style={[
                  styles.filterPillLabel,
                  clientMsgTab === 'optionRequests' && styles.filterPillLabelActive,
                ]}
              >
                {uiCopy.b2bChat.tabOptionRequests}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}
      {showClientMessagesTabs && clientMsgTab === 'b2bChats' ? (
        <ClientB2BChatsPanel
          clientUserId={clientUserId!}
          pendingOpen={localPendingB2BChat ?? pendingClientB2BChat}
          onPendingConsumed={() => {
            if (localPendingB2BChat) setLocalPendingB2BChat(null);
            else onPendingClientB2BChatConsumed?.();
          }}
          onOpenRelatedRequest={(optionRequestId) => {
            onOptionThreadOpenedFromList?.();
            setSelectedThreadId(optionRequestId);
            setClientMsgTab('optionRequests');
          }}
          onBookingCardPress={onBookingCardPress}
          onPackagePress={onPackagePress}
          searchQuery={clientMsgSearch}
          onChatActiveChange={setB2bChatIsOpen}
        />
      ) : (
        <View style={flexFillColumn}>
          {!optionFullscreenActive ? (
            <View style={flexFillColumn}>
              {onMsgFilterChange && (
                <View style={{ flexDirection: 'row', gap: 4, marginBottom: spacing.xs }}>
                  {(['current', 'archived'] as const).map((f) => (
                    <TouchableOpacity
                      key={f}
                      style={[styles.filterPill, msgFilter === f && styles.filterPillActive]}
                      onPress={() => onMsgFilterChange(f)}
                    >
                      <Text
                        style={[
                          styles.filterPillLabel,
                          msgFilter === f && styles.filterPillLabelActive,
                        ]}
                      >
                        {f === 'current'
                          ? uiCopy.messages.optionRequestListFilterCurrent
                          : uiCopy.messages.optionRequestListFilterArchived}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
                <TouchableOpacity
                  style={[styles.filterPill, attentionFilter === 'all' && styles.filterPillActive]}
                  onPress={() => setAttentionFilter('all')}
                >
                  <Text
                    style={[
                      styles.filterPillLabel,
                      attentionFilter === 'all' && styles.filterPillLabelActive,
                    ]}
                  >
                    {uiCopy.dashboard.smartAttentionFilterAll}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.filterPill,
                    attentionFilter === 'action_required' && styles.filterPillActive,
                  ]}
                  onPress={() => setAttentionFilter('action_required')}
                >
                  <Text
                    style={[
                      styles.filterPillLabel,
                      attentionFilter === 'action_required' && styles.filterPillLabelActive,
                    ]}
                  >
                    {uiCopy.dashboard.smartAttentionFilterActionRequired}
                  </Text>
                </TouchableOpacity>
              </View>
              {Object.keys(assignmentByClientOrgId).length > 0 && (
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: spacing.xs,
                    marginBottom: spacing.sm,
                  }}
                >
                  {(['all', 'mine', 'unassigned'] as const).map((scope) => (
                    <TouchableOpacity
                      key={scope}
                      style={[
                        styles.filterPill,
                        assignmentFilters.scope === scope && styles.filterPillActive,
                      ]}
                      onPress={() => setAssignmentFilters((prev) => ({ ...prev, scope }))}
                    >
                      <Text
                        style={[
                          styles.filterPillLabel,
                          assignmentFilters.scope === scope && styles.filterPillLabelActive,
                        ]}
                      >
                        {scope === 'all'
                          ? 'All clients'
                          : scope === 'mine'
                            ? 'My clients'
                            : 'Unassigned'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {[
                    'all',
                    ...Array.from(
                      new Set(
                        Object.values(assignmentByClientOrgId).map((a) => a.label.toLowerCase()),
                      ),
                    ),
                  ]
                    .slice(0, 6)
                    .map((flagLabel) => (
                      <TouchableOpacity
                        key={`flag-${flagLabel}`}
                        style={[
                          styles.filterPill,
                          assignmentFilters.flagLabel === flagLabel && styles.filterPillActive,
                        ]}
                        onPress={() => setAssignmentFilters((prev) => ({ ...prev, flagLabel }))}
                      >
                        <Text
                          style={[
                            styles.filterPillLabel,
                            assignmentFilters.flagLabel === flagLabel &&
                              styles.filterPillLabelActive,
                          ]}
                        >
                          {flagLabel === 'all' ? 'Any flag' : `Flag ${flagLabel}`}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  {['all', ...assignableMembers.map((m) => m.userId)].slice(0, 8).map((userId) => {
                    const member = assignableMembers.find((m) => m.userId === userId);
                    const label = userId === 'all' ? 'Any member' : (member?.name ?? 'Member');
                    return (
                      <TouchableOpacity
                        key={`member-${userId}`}
                        style={[
                          styles.filterPill,
                          assignmentFilters.assignedMemberUserId === userId &&
                            styles.filterPillActive,
                        ]}
                        onPress={() =>
                          setAssignmentFilters((prev) => ({
                            ...prev,
                            assignedMemberUserId: userId,
                          }))
                        }
                      >
                        <Text
                          style={[
                            styles.filterPillLabel,
                            assignmentFilters.assignedMemberUserId === userId &&
                              styles.filterPillLabelActive,
                          ]}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
              {clientCounterparties.length > 1 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ flexShrink: 0, marginBottom: spacing.sm }}
                  contentContainerStyle={{ gap: spacing.xs }}
                >
                  <TouchableOpacity
                    style={[styles.filterPill, !counterpartyFilter && styles.filterPillActive]}
                    onPress={() => setCounterpartyFilter(null)}
                  >
                    <Text
                      style={[
                        styles.filterPillLabel,
                        !counterpartyFilter && styles.filterPillLabelActive,
                      ]}
                    >
                      All agencies
                    </Text>
                  </TouchableOpacity>
                  {clientCounterparties.map((cp) => (
                    <TouchableOpacity
                      key={cp.id}
                      style={[
                        styles.filterPill,
                        counterpartyFilter === cp.id && styles.filterPillActive,
                      ]}
                      onPress={() =>
                        setCounterpartyFilter(counterpartyFilter === cp.id ? null : cp.id)
                      }
                    >
                      <Text
                        style={[
                          styles.filterPillLabel,
                          counterpartyFilter === cp.id && styles.filterPillLabelActive,
                        ]}
                        numberOfLines={1}
                      >
                        {cp.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <ScrollView
                style={[styles.threadList, webOptionThreadListScrollStyle]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
                contentContainerStyle={{ flexGrow: 1, paddingBottom: spacing.sm }}
              >
                {visibleRequests.length === 0 ? (
                  <Text style={styles.metaText}>
                    {msgFilter === 'archived' ? 'No archived messages.' : 'No messages.'}
                  </Text>
                ) : (
                  visibleRequests.map((r) => {
                    const reqStatus = getRequestStatus(r.threadId) ?? r.status;
                    const isArchived = archivedIds.has(r.threadId);
                    const assignment = r.clientOrganizationId
                      ? assignmentByClientOrgId[r.clientOrganizationId]
                      : undefined;
                    const attentionListLabel = attentionHeaderLabelFromSignals(
                      attentionSignalsFromOptionRequestLike({
                        status: r.status,
                        finalStatus: r.finalStatus ?? null,
                        clientPriceStatus: r.clientPriceStatus ?? null,
                        modelApproval: r.modelApproval,
                        modelAccountLinked: r.modelAccountLinked ?? false,
                        agencyCounterPrice: r.agencyCounterPrice ?? null,
                        proposedPrice: r.proposedPrice ?? null,
                      }),
                      'client',
                    );
                    return (
                      <View
                        key={r.threadId}
                        style={[
                          styles.threadRow,
                          styles.threadRowOptionRequestList,
                          selectedThreadId === r.threadId && styles.threadRowActive,
                        ]}
                      >
                        <TouchableOpacity
                          style={styles.optionRequestThreadNamesColumn}
                          onPress={() => {
                            onOptionThreadOpenedFromList?.();
                            setSelectedThreadId(r.threadId);
                          }}
                          accessibilityRole="button"
                        >
                          <Text style={styles.threadTitle} numberOfLines={1} ellipsizeMode="tail">
                            {r.modelName} · {r.date}
                          </Text>
                          <Text style={styles.metaText} numberOfLines={1} ellipsizeMode="tail">
                            {r.clientName}
                            {formatOptionTimeRangeSuffix(r.startTime, r.endTime)}
                          </Text>
                          {assignment ? (
                            <Text style={styles.metaText} numberOfLines={1} ellipsizeMode="tail">
                              {assignment.label}
                              {assignment.assignedMemberName
                                ? ` · ${assignment.assignedMemberName}`
                                : ''}
                            </Text>
                          ) : null}
                        </TouchableOpacity>
                        <ScrollView
                          horizontal
                          nestedScrollEnabled
                          showsHorizontalScrollIndicator
                          keyboardShouldPersistTaps="handled"
                          style={styles.optionRequestThreadAttentionScroll}
                          contentContainerStyle={styles.optionRequestThreadAttentionScrollContent}
                        >
                          {attentionListLabel ? (
                            <View style={[styles.statusPill, { backgroundColor: '#dbeafe' }]}>
                              <Text
                                style={[styles.statusPillLabel, { color: '#1d4ed8' }]}
                                numberOfLines={1}
                              >
                                {attentionListLabel}
                              </Text>
                            </View>
                          ) : null}
                          {r.modelAccountLinked === false ? (
                            <Text
                              style={{
                                ...typography.label,
                                fontSize: 9,
                                color: colors.textSecondary,
                              }}
                              numberOfLines={1}
                            >
                              {uiCopy.dashboard.optionRequestModelApprovalNoApp}
                            </Text>
                          ) : r.modelApproval === 'approved' ? (
                            <Text
                              style={{
                                ...typography.label,
                                fontSize: 9,
                                color: colors.buttonOptionGreen,
                              }}
                              numberOfLines={1}
                            >
                              {uiCopy.dashboard.optionRequestModelApprovalApproved}
                            </Text>
                          ) : null}
                          <View
                            style={[
                              styles.statusPill,
                              { backgroundColor: STATUS_COLORS[reqStatus] },
                            ]}
                          >
                            <Text style={styles.statusPillLabel} numberOfLines={1}>
                              {STATUS_LABELS[reqStatus]}
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => toggleArchive(r.threadId)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityRole="button"
                            accessibilityLabel={
                              isArchived
                                ? uiCopy.messages.unarchiveThreadInListAccessibility
                                : uiCopy.messages.archiveThreadInListAccessibility
                            }
                          >
                            <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                              {isArchived ? '↩' : '📦'}
                            </Text>
                          </TouchableOpacity>
                        </ScrollView>
                      </View>
                    );
                  })
                )}
              </ScrollView>
            </View>
          ) : null}

          {optionFullscreenActive && request ? (
            <OptionNegotiationChatShell
              title={
                isAgency
                  ? `${request.clientName} · ${request.modelName}`
                  : (agencyTitleForThread ?? request.modelName)
              }
              subtitle={
                isAgency
                  ? formatDateWithOptionalTimeRange(
                      request.date,
                      request.startTime,
                      request.endTime,
                    )
                  : `${request.modelName} · ${formatDateWithOptionalTimeRange(request.date, request.startTime, request.endTime)}`
              }
              onBack={handleBackOptionChat}
              onTitlePress={
                !isAgency && request.agencyOrganizationId
                  ? () =>
                      setViewingOptReqAgencyProfile({
                        orgId: request.agencyOrganizationId!,
                        agencyId: request.agencyId ?? null,
                        orgName: agencyTitleForThread,
                      })
                  : undefined
              }
              statusLabel={status ? STATUS_LABELS[status] : '—'}
              statusBackgroundColor={status ? STATUS_COLORS[status] : colors.border}
              headerBelowTitle={
                <NegotiationChipsRow
                  displayStatus={displayStatus}
                  attentionLabel={headerAttentionLabel}
                  proposedPrice={request.proposedPrice}
                  agencyCounterPrice={request.agencyCounterPrice}
                  clientPriceStatus={clientPriceStatus}
                  finalStatus={finalStatus}
                  currency={currency}
                  showPriceLines={false}
                />
              }
              headerAccessory={
                finalStatus !== 'job_confirmed' ? (
                  <TouchableOpacity
                    onPress={openDeleteOptionModal}
                    disabled={!!deletingOptionId}
                    style={{ opacity: deletingOptionId ? 0.5 : 1 }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel={uiCopy.common.delete}
                  >
                    <Text style={{ fontSize: 18, color: colors.buttonSkipRed ?? '#c0392b' }}>
                      🗑️
                    </Text>
                  </TouchableOpacity>
                ) : null
              }
              deviceType={deviceType}
              rightPanel={
                deviceType === 'desktop' ? (
                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.lg }}
                  >
                    <NegotiationSummaryCard
                      modelName={request.modelName}
                      clientName={request.clientName}
                      isAgency={isAgency}
                      dateLine={negotiationDateLine}
                      displayStatus={displayStatus}
                      attentionLabel={headerAttentionLabel}
                      proposedPrice={request.proposedPrice}
                      agencyCounterPrice={request.agencyCounterPrice}
                      clientPriceStatus={clientPriceStatus}
                      finalStatus={finalStatus}
                      currency={currency}
                      requestTypeLabel={negotiationRequestTypeLabel}
                      finalStatusLine={negotiationFinalStatusLine}
                      confirmationSummaryLine={negotiationConfirmationSummaryLine}
                    />
                    <NegotiationThreadFooter
                      request={request}
                      isAgency={isAgency}
                      status={status}
                      finalStatus={finalStatus}
                      clientPriceStatus={clientPriceStatus}
                      currency={currency}
                      agencyCounterPrice={agencyCounterPrice}
                      negotiationCounterExpanded={negotiationCounterExpanded}
                      setNegotiationCounterExpanded={setNegotiationCounterExpanded}
                      agencyCounterInput={agencyCounterInput}
                      setAgencyCounterInput={setAgencyCounterInput}
                      assignmentByClientOrgId={assignmentByClientOrgId}
                      assignableMembers={assignableMembers}
                      onSaveClientAssignment={onSaveClientAssignment}
                      editingAssignmentThreadId={editingAssignmentThreadId}
                      setEditingAssignmentThreadId={setEditingAssignmentThreadId}
                      openOrgChatBusy={openOrgChatBusy}
                      openOrgChatFromRequest={openOrgChatFromRequest}
                      onAgencyConfirmAvailability={runAgencyConfirmAvailability}
                      onAgencyAcceptClientPrice={runAgencyAcceptClientPrice}
                      onAgencyRejectClientPrice={runAgencyRejectClientPrice}
                      onAgencyCounterOffer={runAgencyCounterOffer}
                      onAgencyProposeInitialFee={runAgencyCounterOffer}
                      onRejectNegotiation={handleRejectOptionNegotiation}
                      onClientAcceptCounter={runClientAcceptCounter}
                      onClientRejectCounter={openRejectCounterModal}
                      onClientConfirmJob={runClientConfirmJob}
                      showAgencyExtras={false}
                      suppressDuplicateMeta
                    />
                  </ScrollView>
                ) : null
              }
              bottomInset={insets.bottom}
              footerTop={
                showDesktopNegotiationRail ? null : (
                  <NegotiationThreadFooter
                    request={request}
                    isAgency={isAgency}
                    status={status}
                    finalStatus={finalStatus}
                    clientPriceStatus={clientPriceStatus}
                    currency={currency}
                    agencyCounterPrice={agencyCounterPrice}
                    negotiationCounterExpanded={negotiationCounterExpanded}
                    setNegotiationCounterExpanded={setNegotiationCounterExpanded}
                    agencyCounterInput={agencyCounterInput}
                    setAgencyCounterInput={setAgencyCounterInput}
                    assignmentByClientOrgId={assignmentByClientOrgId}
                    assignableMembers={assignableMembers}
                    onSaveClientAssignment={onSaveClientAssignment}
                    editingAssignmentThreadId={editingAssignmentThreadId}
                    setEditingAssignmentThreadId={setEditingAssignmentThreadId}
                    openOrgChatBusy={openOrgChatBusy}
                    openOrgChatFromRequest={openOrgChatFromRequest}
                    onAgencyConfirmAvailability={runAgencyConfirmAvailability}
                    onAgencyAcceptClientPrice={runAgencyAcceptClientPrice}
                    onAgencyRejectClientPrice={runAgencyRejectClientPrice}
                    onAgencyCounterOffer={runAgencyCounterOffer}
                    onAgencyProposeInitialFee={runAgencyCounterOffer}
                    onRejectNegotiation={handleRejectOptionNegotiation}
                    onClientAcceptCounter={runClientAcceptCounter}
                    onClientRejectCounter={openRejectCounterModal}
                    onClientConfirmJob={runClientConfirmJob}
                    showAgencyExtras={false}
                    suppressDuplicateMeta
                  />
                )
              }
              composerTopBanner={
                calendarHint ? (
                  <Text style={{ ...typography.label, fontSize: 12, color: colors.textPrimary }}>
                    {calendarHint}
                  </Text>
                ) : null
              }
              composer={
                <View style={styles.chatPanelInputRow}>
                  <TextInput
                    value={chatInput}
                    onChangeText={setChatInput}
                    placeholder={uiCopy.optionNegotiationChat.messagePlaceholder}
                    placeholderTextColor={colors.textSecondary}
                    style={[
                      styles.chatPanelInput,
                      { height: Math.max(36, Math.min(120, chatInputHeight)) },
                    ]}
                    multiline
                    blurOnSubmit={false}
                    onContentSizeChange={(e) =>
                      setChatInputHeight(e.nativeEvent.contentSize.height)
                    }
                  />
                  <TouchableOpacity style={styles.chatPanelSend} onPress={sendMessage}>
                    <Text style={styles.chatPanelSendLabel}>
                      {uiCopy.optionNegotiationChat.send}
                    </Text>
                  </TouchableOpacity>
                </View>
              }
              containerStyle={{ flex: 1, minHeight: 0, alignSelf: 'stretch' }}
            >
              <>
                {!showDesktopNegotiationRail ? (
                  <>
                    {/* Mobile: collapsible summary — collapsed by default since chips show key status */}
                    <TouchableOpacity
                      onPress={() => setMobileSummaryCollapsed((v) => !v)}
                      style={styles.mobileSummaryToggle}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.mobileSummaryToggleLabel}>
                        {mobileSummaryCollapsed ? '↓ Details' : '↑ Hide details'}
                      </Text>
                    </TouchableOpacity>
                    {!mobileSummaryCollapsed ? (
                      <NegotiationSummaryCard
                        modelName={request.modelName}
                        clientName={request.clientName}
                        isAgency={isAgency}
                        dateLine={negotiationDateLine}
                        displayStatus={displayStatus}
                        attentionLabel={headerAttentionLabel}
                        proposedPrice={request.proposedPrice}
                        agencyCounterPrice={request.agencyCounterPrice}
                        clientPriceStatus={clientPriceStatus}
                        finalStatus={finalStatus}
                        currency={currency}
                        requestTypeLabel={negotiationRequestTypeLabel}
                        finalStatusLine={negotiationFinalStatusLine}
                        confirmationSummaryLine={negotiationConfirmationSummaryLine}
                      />
                    ) : null}
                  </>
                ) : null}
                {filteredMessages.map((msg, i) => {
                  const prev = i > 0 ? filteredMessages[i - 1] : null;
                  const compact = !!(prev && prev.from === msg.from && msg.from !== 'system');
                  const timeLabel =
                    msg.createdAt != null
                      ? new Date(msg.createdAt).toLocaleTimeString(undefined, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : undefined;
                  return (
                    <NegotiationMessageRow
                      key={msg.id}
                      id={msg.id}
                      from={msg.from}
                      text={msg.text}
                      viewerRole={isAgency ? 'agency' : 'client'}
                      compactTop={compact}
                      timeLabel={timeLabel}
                    />
                  );
                })}
              </>
            </OptionNegotiationChatShell>
          ) : null}

          <ConfirmDestructiveModal
            visible={deleteOptionModalVisible}
            title={uiCopy.messages.deleteOptionRequestTitle}
            message={uiCopy.messages.deleteOptionRequestMessage}
            confirmLabel={uiCopy.common.delete}
            cancelLabel={uiCopy.common.cancel}
            confirmDisabled={!!deletingOptionId}
            onConfirm={confirmDeleteOptionRequest}
            onCancel={() => setDeleteOptionModalVisible(false)}
            detailLine1={request?.modelName}
            detailLine2={
              request
                ? formatDateWithOptionalTimeRange(request.date, request.startTime, request.endTime)
                : undefined
            }
          />
          <ConfirmDestructiveModal
            visible={rejectCounterModalVisible}
            title={uiCopy.optionNegotiationChat.rejectCounterOfferTitle}
            message={uiCopy.optionNegotiationChat.rejectCounterOfferMessage}
            confirmLabel={uiCopy.optionNegotiationChat.rejectCounterOffer}
            cancelLabel={uiCopy.common.cancel}
            onConfirm={confirmRejectCounterOffer}
            onCancel={() => setRejectCounterModalVisible(false)}
            detailLine1={request?.modelName}
            detailLine2={
              request
                ? formatDateWithOptionalTimeRange(request.date, request.startTime, request.endTime)
                : undefined
            }
          />

          {viewingOptReqAgencyProfile && (
            <OrgProfileModal
              visible
              onClose={() => setViewingOptReqAgencyProfile(null)}
              orgType="agency"
              organizationId={viewingOptReqAgencyProfile.orgId}
              agencyId={viewingOptReqAgencyProfile.agencyId}
              orgName={viewingOptReqAgencyProfile.orgName}
            />
          )}
        </View>
      )}
    </View>
  );
};

type OptionDatePickerModalProps = {
  open: boolean;
  model: ModelSummary | null;
  onClose: () => void;
  onSubmit: (
    date: string,
    startTime: string,
    endTime: string,
    price?: number,
    requestType?: 'option' | 'casting',
    currency?: string,
    jobDescription?: string,
  ) => void;
};

const TIME_SLOTS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

/** Schnellauswahl Daten für Option im Model-Detail (14 Tage ab heute). */
const OPTION_DATES: string[] = Array.from({ length: 14 }, (_, i) => {
  const x = new Date();
  x.setDate(x.getDate() + i);
  return x.toISOString().slice(0, 10);
});

const OptionDatePickerModal: React.FC<OptionDatePickerModalProps> = ({
  open,
  model,
  onClose,
  onSubmit,
}) => {
  const [calMonth, setCalMonth] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<'EUR' | 'USD' | 'GBP' | 'CHF'>('EUR');
  const [sendVia, setSendVia] = useState<'app' | 'email'>('app');
  const [requestType, setRequestType] = useState<'option' | 'casting'>('option');
  const [roleDescription, setRoleDescription] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!open || !model) return null;

  const daysInMonth = new Date(calMonth.year, calMonth.month + 1, 0).getDate();
  const firstDayOfWeek = new Date(calMonth.year, calMonth.month, 1).getDay();
  const monthLabel = new Date(calMonth.year, calMonth.month).toLocaleString('en', {
    month: 'long',
    year: 'numeric',
  });
  const today = new Date().toISOString().slice(0, 10);

  const prevMonth = () =>
    setCalMonth((p) =>
      p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 },
    );
  const nextMonth = () =>
    setCalMonth((p) =>
      p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 },
    );

  const handleSubmit = () => {
    setSubmitError(null);
    if (!selectedDate) {
      setSubmitError(uiCopy.dashboard.optionChecklistDate);
      return;
    }
    if (!roleDescription.trim()) {
      setSubmitError(uiCopy.dashboard.optionChecklistRole);
      return;
    }
    const p = requestType === 'option' && price.trim() ? parseFloat(price) : undefined;
    if (sendVia === 'email') {
      const subject = encodeURIComponent(
        `${requestType === 'casting' ? 'Casting' : 'Option'} Request – ${model.name} – ${selectedDate}`,
      );
      const body = encodeURIComponent(
        `Hello,\n\nI would like to request ${requestType === 'casting' ? 'a casting' : 'an option'} for:\n\n` +
          `Model: ${model.name}\n` +
          `Date: ${selectedDate}\n` +
          `Time: ${stripClockSeconds(startTime)} – ${stripClockSeconds(endTime)}\n` +
          (requestType === 'option' && p ? `Proposed Price: ${p}\n` : '') +
          `\nPlease confirm at your earliest convenience.\n\nBest regards`,
      );
      Linking.openURL(`mailto:?subject=${subject}&body=${body}`);
      onClose();
      return;
    }
    onSubmit(
      selectedDate,
      startTime,
      endTime,
      p,
      requestType,
      currency,
      roleDescription.trim() || undefined,
    );
  };

  return (
    <View style={styles.detailOverlay}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
      <View
        style={[
          styles.optionDateCard,
          { maxWidth: 440, marginBottom: 100, paddingBottom: spacing.lg },
        ]}
      >
        <Text style={styles.optionDateCardTitle}>
          {requestType === 'casting' ? 'Request casting' : 'Request option'}
        </Text>
        <Text style={styles.metaText}>Select date and time for {model.name}</Text>

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
          {(['option', 'casting'] as const).map((t) => (
            <TouchableOpacity
              key={t}
              style={[
                styles.filterPill,
                requestType === t && styles.filterPillActive,
                { paddingHorizontal: spacing.md },
              ]}
              onPress={() => setRequestType(t)}
            >
              <Text
                style={[styles.filterPillLabel, requestType === t && styles.filterPillLabelActive]}
              >
                {t === 'option' ? 'Option' : 'Casting'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: spacing.md,
            marginBottom: spacing.sm,
          }}
        >
          <TouchableOpacity onPress={prevMonth}>
            <Text style={{ fontSize: 18, color: colors.textPrimary }}>‹</Text>
          </TouchableOpacity>
          <Text style={{ ...typography.label, color: colors.textPrimary }}>{monthLabel}</Text>
          <TouchableOpacity onPress={nextMonth}>
            <Text style={{ fontSize: 18, color: colors.textPrimary }}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row', marginBottom: 4 }}>
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
            <View key={d} style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ ...typography.label, fontSize: 9, color: colors.textSecondary }}>
                {d}
              </Text>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {Array.from({ length: firstDayOfWeek }, (_, i) => (
            <View key={`e-${i}`} style={{ width: `${100 / 7}%`, height: 36 }} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const dateStr = `${calMonth.year}-${String(calMonth.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isPast = dateStr < today;
            const isSelected = dateStr === selectedDate;
            return (
              <TouchableOpacity
                key={day}
                disabled={isPast}
                onPress={() => setSelectedDate(dateStr)}
                style={{
                  width: `${100 / 7}%`,
                  height: 36,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isSelected ? colors.accentGreen : 'transparent',
                  }}
                >
                  <Text
                    style={{
                      ...typography.body,
                      fontSize: 12,
                      color: isPast ? colors.border : isSelected ? '#fff' : colors.textPrimary,
                    }}
                  >
                    {day}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                ...typography.label,
                fontSize: 10,
                color: colors.textSecondary,
                marginBottom: 4,
              }}
            >
              From
            </Text>
            <ScrollView
              style={{
                maxHeight: 100,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 8,
              }}
            >
              {TIME_SLOTS.map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setStartTime(t)}
                  style={{
                    padding: 6,
                    backgroundColor: startTime === t ? colors.accentGreen : 'transparent',
                  }}
                >
                  <Text
                    style={{
                      ...typography.body,
                      fontSize: 11,
                      color: startTime === t ? '#fff' : colors.textPrimary,
                    }}
                  >
                    {t}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                ...typography.label,
                fontSize: 10,
                color: colors.textSecondary,
                marginBottom: 4,
              }}
            >
              To
            </Text>
            <ScrollView
              style={{
                maxHeight: 100,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 8,
              }}
            >
              {TIME_SLOTS.map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setEndTime(t)}
                  style={{
                    padding: 6,
                    backgroundColor: endTime === t ? colors.accentGreen : 'transparent',
                  }}
                >
                  <Text
                    style={{
                      ...typography.body,
                      fontSize: 11,
                      color: endTime === t ? '#fff' : colors.textPrimary,
                    }}
                  >
                    {t}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>

        {requestType === 'option' && (
          <View style={{ marginTop: spacing.md }}>
            <Text
              style={{
                ...typography.label,
                fontSize: 10,
                color: colors.textSecondary,
                marginBottom: 4,
              }}
            >
              Proposed price (visible to agency only)
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TextInput
                value={price}
                onChangeText={setPrice}
                placeholder="e.g. 2500"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                style={[styles.input, { height: 36, flex: 1 }]}
              />
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {(['EUR', 'USD', 'GBP', 'CHF'] as const).map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[
                      styles.filterPill,
                      currency === c && styles.filterPillActive,
                      { paddingHorizontal: 8, paddingVertical: 6 },
                    ]}
                    onPress={() => setCurrency(c)}
                  >
                    <Text
                      style={[
                        styles.filterPillLabel,
                        currency === c && styles.filterPillLabelActive,
                        { fontSize: 10 },
                      ]}
                    >
                      {c === 'EUR' ? '€' : c === 'USD' ? '$' : c === 'GBP' ? '£' : 'CHF'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        )}

        <View style={{ marginTop: spacing.md }}>
          <Text
            style={{
              ...typography.label,
              fontSize: 10,
              color: colors.textSecondary,
              marginBottom: 4,
            }}
          >
            Role / Job description <Text style={{ color: '#dc2626' }}>*</Text>
          </Text>
          <TextInput
            value={roleDescription}
            onChangeText={(t) => {
              setRoleDescription(t);
              setSubmitError(null);
            }}
            placeholder="e.g. Runway model, Photographer, Brand ambassador"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { height: 36 }]}
          />
        </View>

        {submitError ? (
          <Text style={{ fontSize: 12, color: '#dc2626', marginTop: spacing.sm }}>
            {submitError}
          </Text>
        ) : null}

        <View style={{ marginTop: spacing.md }}>
          <Text
            style={{
              ...typography.label,
              fontSize: 10,
              color: colors.textSecondary,
              marginBottom: 4,
            }}
          >
            Send via
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {(['app', 'email'] as const).map((v) => (
              <TouchableOpacity
                key={v}
                style={[
                  styles.filterPill,
                  sendVia === v && styles.filterPillActive,
                  { paddingHorizontal: spacing.md },
                ]}
                onPress={() => setSendVia(v)}
              >
                <Text
                  style={[styles.filterPillLabel, sendVia === v && styles.filterPillLabelActive]}
                >
                  {v === 'app' ? 'In-App' : 'Email'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View
          style={{
            flexDirection: 'row',
            gap: spacing.md,
            marginTop: spacing.xl,
            marginBottom: spacing.md,
          }}
        >
          <TouchableOpacity
            onPress={onClose}
            style={[styles.filterPill, { flex: 1, alignItems: 'center' }]}
          >
            <Text style={styles.filterPillLabel}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!selectedDate || !roleDescription.trim()}
            style={[
              styles.primaryButton,
              { flex: 1, opacity: selectedDate && roleDescription.trim() ? 1 : 0.4 },
            ]}
          >
            <Text style={styles.primaryLabel}>
              {sendVia === 'email'
                ? 'Open in Email'
                : requestType === 'casting'
                  ? 'Send casting request'
                  : 'Send option'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

type DetailProps = {
  open: boolean;
  loading: boolean;
  data: MediaslideModel | null;
  onClose: () => void;
  onOptionRequest?: (modelName: string, modelId: string, date: string) => void;
  /** When set, detail gallery copy/labels follow package type (authenticated package-open flow). */
  detailMediaPackageType?: PackageType;
};

const ProjectDetailView: React.FC<DetailProps> = ({
  open,
  loading,
  data,
  onClose,
  onOptionRequest,
  detailMediaPackageType,
}) => {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const normalizedDisplayImageUrls = useMemo(() => {
    const id = data?.id ?? '';
    const imgs = data?.portfolio?.images ?? [];
    if (!id) return imgs;
    return imgs.map((u) => normalizeDocumentspicturesModelImageRef(u, id));
  }, [data?.id, data?.portfolio?.images]);

  const mediaSectionLabel =
    detailMediaPackageType === 'polaroid'
      ? uiCopy.discover.detailMediaSectionPolaroid
      : uiCopy.discover.detailMediaSectionPortfolio;
  const mediaEmptyCopy =
    detailMediaPackageType === 'polaroid'
      ? uiCopy.discover.detailNoPolaroidImages
      : uiCopy.discover.detailNoPortfolioImages;

  useEffect(() => {
    if (!open) {
      setSelectedDate(null);
      setConfirmation(null);
    }
  }, [open]);

  const requestOption = (date: string) => {
    setSelectedDate(date);
    setConfirmation(null);
    if (data && onOptionRequest) {
      onOptionRequest(data.name, data.id, date);
    }
  };

  if (!open) return null;

  return (
    <View style={styles.detailOverlay}>
      <View style={styles.detailCard}>
        <View style={styles.detailHeaderRow}>
          <Text style={styles.detailTitle}>{data ? data.name : 'Loading'}</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeLabel}>Close</Text>
          </TouchableOpacity>
        </View>

        {loading && <Text style={styles.metaText}>Loading…</Text>}

        {!loading && data && (
          <ScrollView style={styles.detailScroll}>
            <View style={styles.detailMeasurementsRow}>
              <View style={styles.detailMeasureItem}>
                <Text style={styles.detailMeasureLabel}>
                  {uiCopy.discover.detailMeasurementHeight}
                </Text>
                <Text style={styles.detailMeasureValue}>{data.measurements.height}</Text>
              </View>
              <View style={styles.detailMeasureItem}>
                <Text style={styles.detailMeasureLabel}>
                  {uiCopy.discover.detailMeasurementChest}
                </Text>
                <Text style={styles.detailMeasureValue}>{data.measurements.chest}</Text>
              </View>
              <View style={styles.detailMeasureItem}>
                <Text style={styles.detailMeasureLabel}>
                  {uiCopy.discover.detailMeasurementWaist}
                </Text>
                <Text style={styles.detailMeasureValue}>{data.measurements.waist}</Text>
              </View>
              <View style={styles.detailMeasureItem}>
                <Text style={styles.detailMeasureLabel}>
                  {uiCopy.discover.detailMeasurementHips}
                </Text>
                <Text style={styles.detailMeasureValue}>{data.measurements.hips}</Text>
              </View>
            </View>

            <Text style={styles.detailSectionLabel}>{mediaSectionLabel}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.detailPortfolioRow}
            >
              {normalizedDisplayImageUrls.map((url, idx) => (
                <TouchableOpacity
                  key={`${idx}-${url}`}
                  onPress={() => setLightboxIndex(idx)}
                  activeOpacity={0.85}
                >
                  <View style={{ position: 'relative', overflow: 'hidden', borderRadius: 12 }}>
                    <StorageImage
                      uri={url || undefined}
                      style={styles.detailPortfolioImage}
                      resizeMode="contain"
                      ttlSeconds={CLIENT_MODEL_IMAGE_TTL_SEC}
                      fallback={
                        <View
                          style={[styles.detailPortfolioImage, { backgroundColor: colors.border }]}
                        />
                      }
                    />
                  </View>
                </TouchableOpacity>
              ))}
              {normalizedDisplayImageUrls.length === 0 && (
                <Text style={styles.metaText}>{mediaEmptyCopy}</Text>
              )}
            </ScrollView>

            <Text style={styles.detailSectionLabel}>Calendar</Text>
            <View style={styles.calendarRow}>
              {data.calendar.blocked.map((d) => (
                <View key={d} style={styles.blockedPill}>
                  <Text style={styles.blockedPillLabel}>{d}</Text>
                </View>
              ))}
              {data.calendar.available.map((d) => (
                <View key={d} style={styles.availablePill}>
                  <Text style={styles.availablePillLabel}>{d}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.detailSectionLabel}>Request option</Text>
            <Text style={styles.metaText}>Request option for a specific date.</Text>
            <View style={styles.optionDatesRow}>
              {OPTION_DATES.map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[styles.optionDatePill, selectedDate === d && styles.optionDatePillActive]}
                  onPress={() => requestOption(d)}
                >
                  <Text
                    style={[
                      styles.optionDateLabel,
                      selectedDate === d && styles.optionDateLabelActive,
                    ]}
                  >
                    {d}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {confirmation && <Text style={styles.confirmationText}>{confirmation}</Text>}
          </ScrollView>
        )}
      </View>

      {/* Lightbox */}
      {(() => {
        const images = normalizedDisplayImageUrls;
        const currentUrl = lightboxIndex !== null ? images[lightboxIndex] : null;
        const hasPrev = lightboxIndex !== null && lightboxIndex > 0;
        const hasNext = lightboxIndex !== null && lightboxIndex < images.length - 1;
        return (
          <Modal
            visible={lightboxIndex !== null}
            transparent
            animationType="fade"
            onRequestClose={() => setLightboxIndex(null)}
          >
            <View style={styles.lightboxOverlay}>
              {/* Hintergrund-Tap zum Schließen */}
              <TouchableOpacity
                style={StyleSheet.absoluteFillObject}
                activeOpacity={1}
                onPress={() => setLightboxIndex(null)}
              />

              <View style={{ position: 'relative' }}>
                <StorageImage
                  uri={currentUrl || undefined}
                  style={styles.lightboxImage}
                  resizeMode="contain"
                  ttlSeconds={CLIENT_MODEL_IMAGE_TTL_SEC}
                  fallback={
                    <View style={[styles.lightboxImage, { backgroundColor: colors.border }]} />
                  }
                />
              </View>

              {/* Pfeil links */}
              {hasPrev && (
                <TouchableOpacity
                  style={styles.lightboxArrowLeft}
                  onPress={() => setLightboxIndex((i) => (i !== null ? i - 1 : null))}
                >
                  <Text style={styles.lightboxArrowLabel}>‹</Text>
                </TouchableOpacity>
              )}

              {/* Pfeil rechts */}
              {hasNext && (
                <TouchableOpacity
                  style={styles.lightboxArrowRight}
                  onPress={() => setLightboxIndex((i) => (i !== null ? i + 1 : null))}
                >
                  <Text style={styles.lightboxArrowLabel}>›</Text>
                </TouchableOpacity>
              )}

              {/* Bildnummer */}
              {images.length > 1 && lightboxIndex !== null && (
                <View style={styles.lightboxCounter}>
                  <Text style={styles.lightboxCounterLabel}>
                    {lightboxIndex + 1} / {images.length}
                  </Text>
                </View>
              )}

              {/* Schließen-Button */}
              <TouchableOpacity style={styles.lightboxClose} onPress={() => setLightboxIndex(null)}>
                <Text style={styles.lightboxCloseLabel}>✕</Text>
              </TouchableOpacity>
            </View>
          </Modal>
        );
      })()}
    </View>
  );
};

type ProjectPickerProps = {
  open: boolean;
  projects: Project[];
  pendingModel: ModelSummary | null;
  addingModelIds?: Set<string>;
  onClose: () => void;
  onAddToExisting: (projectId: string) => void;
  onCreateAndAdd: (name: string) => void;
};

const ProjectPicker: React.FC<ProjectPickerProps> = ({
  open,
  projects,
  pendingModel,
  addingModelIds,
  onClose,
  onAddToExisting,
  onCreateAndAdd,
}) => {
  const [name, setName] = useState('');

  useEffect(() => {
    if (!open) {
      setName('');
    }
  }, [open]);

  if (!open || !pendingModel) return null;

  return (
    <View style={styles.pickerOverlay}>
      <View style={styles.pickerCard}>
        <View style={styles.pickerHeader}>
          <Text style={styles.pickerTitle}>Add to project</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeLabel}>Close</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.metaText}>Choose a project for {pendingModel.name}.</Text>

        <ScrollView style={styles.pickerList}>
          {projects.map((p) => {
            const isAdding = addingModelIds?.has(pendingModel?.id ?? '') ?? false;
            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.pickerRow, isAdding && { opacity: 0.4 }]}
                onPress={() => onAddToExisting(p.id)}
                disabled={isAdding}
              >
                <Text style={styles.projectName}>{p.name}</Text>
                <Text style={styles.metaText}>
                  {p.models.length} model{p.models.length === 1 ? '' : 's'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.newProjectRow}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="New project name"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
          />
          {(() => {
            const isAdding = addingModelIds?.has(pendingModel?.id ?? '') ?? false;
            return (
              <TouchableOpacity
                style={[styles.primaryButton, isAdding && { opacity: 0.4 }]}
                onPress={() => onCreateAndAdd(name)}
                disabled={isAdding}
              >
                <Text style={styles.primaryLabel}>{isAdding ? 'Adding…' : 'Create & add'}</Text>
              </TouchableOpacity>
            );
          })()}
        </View>
      </View>
    </View>
  );
};

const SettingsPanel: React.FC<{ realClientId: string | null; onClose: () => void }> = ({
  realClientId,
  onClose,
}) => {
  const { signOut, profile, updateDisplayName, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [instagram, setInstagram] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'profile' | 'team'>('profile');
  const [deleting, setDeleting] = useState(false);
  const [dissolvingOrg, setDissolvingOrg] = useState(false);
  const [orgDissolved, setOrgDissolved] = useState(false);
  const clientIsOwner = isOrganizationOwner(profile?.org_member_role);
  const ownerRoleLoading = !!realClientId && !profile?.org_member_role;
  const clientOrgId = profile?.organization_id ?? null;

  // Load settings: Supabase profile is authoritative for display_name; localStorage fills the rest.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem('ci_client_settings');
        if (raw) {
          const s = JSON.parse(raw);
          setCompanyName(s.companyName ?? '');
          setPhone(s.phone ?? '');
          setWebsite(s.website ?? '');
          setInstagram(s.instagram ?? '');
          setLinkedin(s.linkedin ?? '');
          // Only use localStorage display name as fallback; Supabase takes precedence below.
          if (!profile?.display_name) setDisplayName(s.displayName ?? '');
        }
      } catch {}
    }
    // Always override with the authoritative Supabase value when available.
    if (profile?.display_name) setDisplayName(profile.display_name);
  }, [profile?.display_name]);

  useEffect(() => {
    if (!clientOrgId) return;
    void getOrganizationById(clientOrgId).then((org) => {
      if (org?.name) setCompanyName(org.name);
    });
  }, [clientOrgId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(
          'ci_client_settings',
          JSON.stringify({
            displayName,
            companyName,
            phone,
            website,
            instagram,
            linkedin,
          }),
        );
      }
      // Persist display name to Supabase (profiles.display_name) so it is
      // visible to admins and consistent across devices.
      if (displayName.trim()) {
        await updateDisplayName(displayName.trim());
      }
      // Only the org owner may update the organization name.
      if (clientIsOwner && clientOrgId && companyName.trim()) {
        await updateOrganizationName(clientOrgId, companyName.trim());
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('SettingsPanel handleSave error:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleRequestAccountDeletion = () => {
    Alert.alert(uiCopy.accountDeletion.confirmTitle, uiCopy.accountDeletion.confirmMessage, [
      { text: uiCopy.common.cancel, style: 'cancel' },
      {
        text: uiCopy.accountDeletion.button,
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          const { requestAccountDeletion } = await import('../services/accountSupabase');
          const res = await requestAccountDeletion();
          setDeleting(false);
          if (res.ok) {
            onClose();
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
    ]);
  };

  const handleRequestPersonalAccountDeletion = () => {
    Alert.alert(
      uiCopy.accountDeletion.personalDeleteConfirmTitle,
      uiCopy.accountDeletion.personalDeleteConfirmMessage,
      [
        { text: uiCopy.common.cancel, style: 'cancel' },
        {
          text: uiCopy.accountDeletion.button,
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            const { requestPersonalAccountDeletion } = await import('../services/accountSupabase');
            const res = await requestPersonalAccountDeletion();
            setDeleting(false);
            if (res.ok) {
              onClose();
              await signOut();
              return;
            }
            Alert.alert(uiCopy.common.error, uiCopy.accountDeletion.failed);
          },
        },
      ],
    );
  };

  const handleDissolveOrganization = () => {
    if (!clientOrgId) return;
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
            const result = await dissolveOrganization(clientOrgId);
            setDissolvingOrg(false);
            if (result.ok) {
              setOrgDissolved(true);
              void refreshProfile();
              Alert.alert(
                uiCopy.accountDeletion.dissolveOrgTitle,
                uiCopy.accountDeletion.dissolveOrgSuccess,
              );
            } else {
              Alert.alert(uiCopy.common.error, uiCopy.accountDeletion.dissolveOrgFailed);
            }
          },
        },
      ],
    );
  };

  return (
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
        paddingHorizontal: spacing.sm,
        zIndex: 100,
      }}
    >
      <View
        style={{
          width: '100%',
          maxWidth: 520,
          maxHeight: '92%',
          borderRadius: 18,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          padding: spacing.md,
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
          <Text style={{ ...typography.heading, fontSize: 16, color: colors.textPrimary }}>
            Settings
          </Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ ...typography.label, fontSize: 11, color: colors.textSecondary }}>
              {uiCopy.common.close}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
          {(['profile', 'team'] as const).map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setSettingsTab(t)}
              style={{
                paddingVertical: 4,
                paddingHorizontal: spacing.md,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: settingsTab === t ? colors.textPrimary : colors.border,
                backgroundColor: settingsTab === t ? colors.textPrimary : 'transparent',
              }}
            >
              <Text
                style={{
                  ...typography.label,
                  fontSize: 11,
                  color: settingsTab === t ? colors.surface : colors.textSecondary,
                }}
              >
                {t === 'profile' ? 'Profile' : 'Team'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator
        >
          {settingsTab === 'profile' ? (
            <>
              <Text
                style={{
                  ...typography.label,
                  fontSize: 10,
                  color: colors.textSecondary,
                  marginBottom: 4,
                }}
              >
                Display name
              </Text>
              <TextInput
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Your name"
                placeholderTextColor={colors.textSecondary}
                style={[settingsInputStyle, { marginBottom: spacing.md }]}
              />

              <Text
                style={{
                  ...typography.label,
                  fontSize: 10,
                  color: colors.textSecondary,
                  marginBottom: 4,
                }}
              >
                Company{' '}
                {ownerRoleLoading ? (
                  ''
                ) : clientIsOwner ? (
                  ''
                ) : (
                  <Text style={{ fontWeight: '400', color: colors.textSecondary }}>
                    (read-only)
                  </Text>
                )}
              </Text>
              {clientIsOwner ? (
                <TextInput
                  value={companyName}
                  onChangeText={setCompanyName}
                  placeholder="Company name"
                  placeholderTextColor={colors.textSecondary}
                  style={[settingsInputStyle, { marginBottom: 4 }]}
                />
              ) : (
                <View style={[settingsInputStyle, { justifyContent: 'center', marginBottom: 4 }]}>
                  <Text style={{ ...typography.body, fontSize: 13, color: colors.textPrimary }}>
                    {companyName || '—'}
                  </Text>
                </View>
              )}
              {!ownerRoleLoading && !clientIsOwner && (
                <Text
                  style={{
                    ...typography.body,
                    fontSize: 11,
                    color: colors.textSecondary,
                    marginBottom: spacing.md,
                  }}
                >
                  Only the organization owner can change the company name.
                </Text>
              )}
              {clientIsOwner && <View style={{ marginBottom: spacing.md }} />}

              <Text
                style={{
                  ...typography.label,
                  fontSize: 10,
                  color: colors.textSecondary,
                  marginBottom: 4,
                }}
              >
                Phone
              </Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="+49..."
                placeholderTextColor={colors.textSecondary}
                keyboardType="phone-pad"
                style={[settingsInputStyle, { marginBottom: spacing.md }]}
              />

              <Text
                style={{
                  ...typography.label,
                  fontSize: 10,
                  color: colors.textSecondary,
                  marginBottom: 4,
                }}
              >
                Website
              </Text>
              <TextInput
                value={website}
                onChangeText={setWebsite}
                placeholder="https://..."
                placeholderTextColor={colors.textSecondary}
                style={[settingsInputStyle, { marginBottom: spacing.md }]}
              />

              <Text
                style={{
                  ...typography.label,
                  fontSize: 10,
                  color: colors.textSecondary,
                  marginBottom: spacing.xs,
                }}
              >
                Social links
              </Text>
              <TextInput
                value={instagram}
                onChangeText={setInstagram}
                placeholder="Instagram URL"
                placeholderTextColor={colors.textSecondary}
                style={[settingsInputStyle, { marginBottom: spacing.sm }]}
              />
              <TextInput
                value={linkedin}
                onChangeText={setLinkedin}
                placeholder="LinkedIn URL"
                placeholderTextColor={colors.textSecondary}
                style={[settingsInputStyle, { marginBottom: spacing.lg }]}
              />

              <TouchableOpacity
                onPress={() => {
                  void handleSave();
                }}
                disabled={saving}
                style={{
                  borderRadius: 999,
                  backgroundColor: colors.accentGreen,
                  paddingVertical: spacing.sm,
                  alignItems: 'center',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                <Text style={{ ...typography.label, color: colors.surface }}>
                  {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save settings'}
                </Text>
              </TouchableOpacity>

              <View
                style={{
                  marginTop: spacing.xl,
                  paddingTop: spacing.lg,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                }}
              >
                {!realClientId ? (
                  <>
                    <Text
                      style={{
                        ...typography.label,
                        fontSize: 12,
                        color: colors.textPrimary,
                        marginBottom: 4,
                      }}
                    >
                      {uiCopy.accountDeletion.sectionTitle}
                    </Text>
                    <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary }}>
                      {uiCopy.accountDeletion.notAvailableSignedOut}
                    </Text>
                  </>
                ) : ownerRoleLoading ? (
                  <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary }}>
                    {uiCopy.common.loading}
                  </Text>
                ) : clientIsOwner ? (
                  <>
                    {/* Dissolve organization — owners only */}
                    {!orgDissolved && (
                      <View
                        style={{
                          marginBottom: spacing.lg,
                          paddingBottom: spacing.lg,
                          borderBottomWidth: 1,
                          borderBottomColor: colors.border,
                        }}
                      >
                        <Text
                          style={{
                            ...typography.label,
                            fontSize: 12,
                            color: colors.textPrimary,
                            marginBottom: 4,
                          }}
                        >
                          {uiCopy.accountDeletion.dissolveOrgTitle}
                        </Text>
                        <Text
                          style={{
                            ...typography.body,
                            fontSize: 11,
                            color: colors.textSecondary,
                            marginBottom: spacing.sm,
                          }}
                        >
                          {uiCopy.accountDeletion.dissolveOrgDescription}
                        </Text>
                        <TouchableOpacity
                          onPress={handleDissolveOrganization}
                          disabled={dissolvingOrg}
                          style={{
                            borderRadius: 999,
                            borderWidth: 1,
                            borderColor: '#e74c3c',
                            paddingVertical: spacing.sm,
                            alignItems: 'center',
                            opacity: dissolvingOrg ? 0.6 : 1,
                          }}
                        >
                          <Text style={{ ...typography.label, fontSize: 12, color: '#e74c3c' }}>
                            {dissolvingOrg
                              ? uiCopy.accountDeletion.dissolveOrgWorking
                              : uiCopy.accountDeletion.dissolveOrgButton}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    {orgDissolved && (
                      <View
                        style={{
                          marginBottom: spacing.md,
                          padding: spacing.sm,
                          backgroundColor: 'rgba(0,120,0,0.08)',
                          borderRadius: 8,
                        }}
                      >
                        <Text
                          style={{ ...typography.body, fontSize: 11, color: colors.textPrimary }}
                        >
                          {uiCopy.accountDeletion.dissolveOrgSuccess}
                        </Text>
                      </View>
                    )}
                    {/* Delete personal account */}
                    <Text
                      style={{
                        ...typography.label,
                        fontSize: 12,
                        color: colors.textPrimary,
                        marginBottom: 4,
                      }}
                    >
                      {uiCopy.accountDeletion.sectionTitle}
                    </Text>
                    <Text
                      style={{
                        ...typography.body,
                        fontSize: 11,
                        color: colors.textSecondary,
                        marginBottom: spacing.sm,
                      }}
                    >
                      {uiCopy.accountDeletion.description}
                    </Text>
                    <TouchableOpacity
                      onPress={handleRequestAccountDeletion}
                      disabled={deleting}
                      style={{
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: '#e74c3c',
                        paddingVertical: spacing.sm,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ ...typography.label, fontSize: 12, color: '#e74c3c' }}>
                        {deleting
                          ? uiCopy.accountDeletion.buttonWorking
                          : uiCopy.accountDeletion.button}
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    {/* Non-owner employee: personal account deletion only */}
                    <Text
                      style={{
                        ...typography.label,
                        fontSize: 12,
                        color: colors.textPrimary,
                        marginBottom: 4,
                      }}
                    >
                      {uiCopy.accountDeletion.sectionTitle}
                    </Text>
                    <Text
                      style={{
                        ...typography.body,
                        fontSize: 11,
                        color: colors.textSecondary,
                        marginBottom: spacing.sm,
                      }}
                    >
                      {uiCopy.accountDeletion.personalDeleteDescription}
                    </Text>
                    <TouchableOpacity
                      onPress={handleRequestPersonalAccountDeletion}
                      disabled={deleting}
                      style={{
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: '#e74c3c',
                        paddingVertical: spacing.sm,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ ...typography.label, fontSize: 12, color: '#e74c3c' }}>
                        {deleting
                          ? uiCopy.accountDeletion.buttonWorking
                          : uiCopy.accountDeletion.button}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}

                {/* ── GDPR Data Export + Consent Withdrawal (Art. 20 + Art. 7) ─── */}
                <View
                  style={{
                    marginTop: spacing.lg,
                    paddingTop: spacing.lg,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                  }}
                >
                  <Text
                    style={{
                      ...typography.label,
                      fontSize: 12,
                      color: colors.textPrimary,
                      marginBottom: 4,
                    }}
                  >
                    {uiCopy.privacyData.sectionTitle}
                  </Text>
                  <Text
                    style={{
                      ...typography.body,
                      fontSize: 11,
                      color: colors.textSecondary,
                      marginBottom: spacing.sm,
                    }}
                  >
                    {uiCopy.privacyData.art20Body}
                  </Text>
                  <TouchableOpacity
                    onPress={async () => {
                      try {
                        const {
                          data: { user },
                        } = await import('../../lib/supabase').then((m) =>
                          m.supabase.auth.getUser(),
                        );
                        if (!user) return;
                        const { downloadUserDataExport } =
                          await import('../services/gdprComplianceSupabase');
                        const okDl = await downloadUserDataExport(user.id);
                        if (okDl) {
                          showAppAlert(
                            uiCopy.privacyData.downloadStartedTitle,
                            uiCopy.privacyData.downloadStartedBody,
                          );
                        } else {
                          showAppAlert(uiCopy.common.error, uiCopy.privacyData.couldNotExport);
                        }
                      } catch (e) {
                        console.error('SettingsPanel download export error:', e);
                        showAppAlert(uiCopy.common.error, uiCopy.privacyData.couldNotExport);
                      }
                    }}
                    style={{
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: colors.border,
                      paddingVertical: spacing.sm,
                      alignItems: 'center',
                      marginBottom: spacing.sm,
                    }}
                  >
                    <Text
                      style={{ ...typography.label, fontSize: 12, color: colors.textSecondary }}
                    >
                      {uiCopy.privacyData.downloadMyData}
                    </Text>
                  </TouchableOpacity>

                  <Text
                    style={{
                      ...typography.body,
                      fontSize: 11,
                      color: colors.textSecondary,
                      marginBottom: spacing.sm,
                      marginTop: spacing.sm,
                    }}
                  >
                    {uiCopy.privacyData.art7Body}
                  </Text>
                  <TouchableOpacity
                    onPress={async () => {
                      const confirmed = window?.confirm?.(
                        uiCopy.privacyData.withdrawConfirmClientWeb,
                      );
                      if (!confirmed) return;
                      try {
                        const { withdrawConsent } = await import('../services/consentSupabase');
                        const m = await withdrawConsent('marketing', 'user_requested');
                        const a = await withdrawConsent('analytics', 'user_requested');
                        if (!m.ok || !a.ok) {
                          showAppAlert(
                            uiCopy.common.error,
                            uiCopy.privacyData.couldNotWithdrawConsent,
                          );
                          return;
                        }
                        void refreshProfile();
                        showAppAlert(
                          uiCopy.privacyData.consentWithdrawnTitle,
                          uiCopy.privacyData.consentWithdrawnBody,
                        );
                      } catch (e) {
                        console.error('SettingsPanel withdraw consent error:', e);
                        showAppAlert(
                          uiCopy.common.error,
                          uiCopy.privacyData.couldNotWithdrawConsent,
                        );
                      }
                    }}
                    style={{
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: colors.border,
                      paddingVertical: spacing.sm,
                      alignItems: 'center',
                    }}
                  >
                    <Text
                      style={{ ...typography.label, fontSize: 12, color: colors.textSecondary }}
                    >
                      {uiCopy.privacyData.withdrawOptionalConsent}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          ) : (
            <ClientOrganizationTeamSection realClientId={realClientId} />
          )}
        </ScrollView>
      </View>
    </View>
  );
};

const settingsInputStyle: any = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 12,
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  ...typography.body,
  color: colors.textPrimary,
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    backgroundColor: colors.background,
  },
  appShell: {
    flex: 1,
    maxWidth: 1200,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    minHeight: 0,
  },
  topBar: {
    marginBottom: spacing.xs,
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.xs,
    width: '100%',
  },
  topBarSide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  topBarSideRight: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
  },
  topBarCenter: {
    flexShrink: 0,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '46%',
  },
  bottomTabBar: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    paddingVertical: spacing.sm,
    maxWidth: 1200,
    width: '100%',
    alignSelf: 'center',
  },
  bottomTabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  bottomTabItem: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    position: 'relative' as const,
    flexShrink: 0,
  },
  bottomTabItemScrollMobile: {
    minWidth: 72,
    paddingHorizontal: spacing.xs,
  },
  bottomTabLabel: {
    ...typography.label,
    fontSize: 12,
    color: colors.textSecondary,
  },
  bottomTabLabelScrollMobile: {
    fontSize: 11,
  },
  bottomTabLabelActive: {
    color: colors.textPrimary,
  },
  bottomTabDot: {
    position: 'absolute' as const,
    top: 2,
    right: 2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E74C3C',
  },
  bottomTabUnderline: {
    marginTop: 4,
    height: 2,
    width: 24,
    borderRadius: 1,
    backgroundColor: colors.textPrimary,
  },
  workspaceMenuOuter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  workspaceMenuBackdropTouchable: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  workspaceMenuCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    zIndex: 2,
  },
  workspaceMenuTitle: {
    ...typography.heading,
    fontSize: 17,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  workspaceMenuSubtitle: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  workspaceMenuRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: 10,
    marginBottom: 2,
    backgroundColor: colors.background,
  },
  workspaceMenuRowLabel: {
    ...typography.label,
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  workspaceMenuClose: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  workspaceMenuCloseLabel: {
    ...typography.label,
    fontSize: 13,
    color: colors.textSecondary,
  },
  backArrowTouchable: {
    marginRight: spacing.sm,
    paddingVertical: spacing.xs,
    paddingRight: spacing.xs,
  },
  backArrow: {
    fontSize: 22,
    color: colors.textPrimary,
  },
  brand: {
    ...typography.headingCompact,
    color: colors.textPrimary,
  },
  sharedRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sharedExit: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
  },
  profileIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInitial: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  menuRow: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  menuItem: {
    alignItems: 'center',
  },
  menuLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  menuLabelActive: {
    color: colors.accentGreen,
  },
  menuUnderline: {
    marginTop: 4,
    height: 1,
    width: 28,
    backgroundColor: colors.accentGreen,
  },
  menuItemInner: {
    position: 'relative',
  },
  notificationDot: {
    position: 'absolute',
    top: -2,
    right: -6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.buttonSkipRed,
  },
  section: {
    flex: 1,
    minHeight: 0,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  clientTypeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  clientTypePill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  clientTypePillActive: {
    borderColor: colors.textPrimary,
    backgroundColor: colors.textPrimary,
  },
  clientTypePillLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  clientTypePillLabelActive: {
    color: colors.surface,
  },
  filterTrigger: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  filterTriggerLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  filterSlideOut: {
    marginBottom: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  metaText: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
  },
  packageBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  packageBannerText: {
    ...typography.body,
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '600',
    flex: 1,
    minWidth: 0,
  },
  packageBannerExit: {
    ...typography.body,
    fontSize: 13,
    color: colors.accent,
    fontWeight: '600',
    marginLeft: spacing.md,
  },
  packageGrid: {
    gap: spacing.md,
    width: '100%',
    alignItems: 'stretch',
  },
  packageGridCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  packageGridImageContainer: {
    width: '100%',
    height: 360,
    position: 'relative',
  },
  packageGridImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#D0CEC7',
  },
  activeProjectRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  activeProjectName: {
    ...typography.body,
    color: colors.textPrimary,
  },
  coverRow: {
    alignItems: 'center',
    marginBottom: spacing.lg,
    width: '100%',
  },
  coverCard: {
    width: '100%',
    maxWidth: 640,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  coverImageContainer: {
    position: 'relative',
    height: 480,
    zIndex: 0,
  },
  coverImageTouchable: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  coverImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#D0CEC7',
  },
  coverGradientOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 120,
    backgroundColor: 'transparent',
    zIndex: 1,
  },
  coverMeasurementsOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    justifyContent: 'flex-end',
    zIndex: 2,
  },
  coverNameOnImage: {
    ...typography.heading,
    fontSize: 18,
    color: '#FFFFFF',
    marginBottom: 4,
    textShadowColor: '#000000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  } as any,
  coverMeasurementsLabel: {
    ...typography.label,
    fontSize: 11,
    letterSpacing: 1.2,
    color: '#FFFFFF',
    textShadowColor: '#000000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  } as any,
  coverLocationLabel: {
    ...typography.label,
    fontSize: 10,
    letterSpacing: 0.8,
    color: '#FFFFFF',
    textShadowColor: '#000000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
    marginTop: 6,
  } as any,
  sportsBadge: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  sportsBadgeLabel: {
    ...typography.label,
    fontSize: 9,
    letterSpacing: 0.6,
    color: '#FFFFFF',
    textShadowColor: '#000000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  } as any,
  coverImageShell: {
    height: 360,
    backgroundColor: '#D0CEC7',
  },
  coverImagePlaceholder: {
    flex: 1,
  },
  coverMeta: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  cardButtonRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.md,
    zIndex: 3,
    backgroundColor: colors.surface,
  },
  nextButton: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.buttonSkipRed,
    backgroundColor: 'transparent',
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextButtonLabel: {
    ...typography.label,
    color: colors.buttonSkipRed,
  },
  optionButtonOutline: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.buttonOptionGreen,
    backgroundColor: 'transparent',
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionButtonOutlineLabel: {
    ...typography.label,
    color: colors.buttonOptionGreen,
  },
  cardButtonRowSecondary: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
  },
  addToSelectionButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'transparent',
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addToSelectionLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
  },
  chatWithAgencyButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accentGreen,
    backgroundColor: 'transparent',
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatWithAgencyLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.accentGreen,
  },
  skipButton: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: colors.buttonSkipRed,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipButtonLabel: {
    ...typography.label,
    color: colors.surface,
  },
  optionButton: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: colors.buttonOptionGreen,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionButtonLabel: {
    ...typography.label,
    color: colors.surface,
  },
  coverName: {
    ...typography.heading,
    fontSize: 18,
    color: colors.textPrimary,
    fontFamily: 'serif',
  },
  coverSub: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
  },
  emptyDiscover: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    ...typography.heading,
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  emptyCopy: {
    ...typography.body,
    color: colors.textSecondary,
  },
  discoverActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  primaryButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accentGreen,
    backgroundColor: colors.accentGreen,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.4,
  },
  primaryLabel: {
    ...typography.label,
    color: colors.surface,
  },
  secondaryButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  feedbackBanner: {
    marginTop: spacing.md,
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: '#E4EFE9',
  },
  feedbackText: {
    ...typography.body,
    fontSize: 12,
    color: colors.accentGreen,
  },
  newProjectRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  input: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: colors.textPrimary,
  },
  projectsList: {
    flex: 1,
  },
  projectRow: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  projectRowActive: {
    borderColor: colors.accentBrown,
  },
  projectHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  projectName: {
    ...typography.body,
    color: colors.textPrimary,
  },
  projectModelsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  projectOptionChats: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  projectOptionChatsLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  projectOptionChatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  projectOptionChatText: {
    ...typography.body,
    fontSize: 12,
    color: colors.textPrimary,
  },
  projectOptionChatOpen: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
  },
  modelChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  modelChipLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  emptyProjects: {
    marginTop: spacing.lg,
  },
  agencyList: {
    gap: spacing.sm,
  },
  agencyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  agencyLeft: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  agencyRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  agencyName: {
    ...typography.body,
    color: colors.textPrimary,
  },
  agencyPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accentBrown,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  agencyPillLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.accentBrown,
  },
  agencySearchInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    ...typography.body,
    color: colors.textPrimary,
  },
  contactButton: {
    marginTop: spacing.xs,
  },
  contactButtonLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.buttonOptionGreen,
  },
  agencyConnectedLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.buttonOptionGreen,
    marginTop: spacing.xs,
  },
  agencyPendingLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  agencyPendingActions: {
    marginTop: spacing.xs,
  },
  agencyAcceptBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 8,
    backgroundColor: colors.buttonOptionGreen,
  },
  agencyAcceptBtnLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.surface,
  },
  agencyContactLink: {
    marginTop: spacing.xs,
  },
  agencyContactLinkLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  detailOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  detailCard: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '92%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  detailHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  detailTitle: {
    ...typography.heading,
    fontSize: 18,
    color: colors.textPrimary,
    fontFamily: 'serif',
  },
  closeLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  detailScroll: {
    flex: 1,
  },
  detailMeasurementsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  detailMeasureItem: {
    alignItems: 'flex-start',
  },
  detailMeasureLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  detailMeasureValue: {
    ...typography.body,
    color: colors.textPrimary,
  },
  detailSectionLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  detailPortfolioRow: {
    marginBottom: spacing.lg,
  },
  detailPortfolioImage: {
    width: 180,
    height: 240,
    marginRight: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.border,
  },
  detailImagePlaceholder: {
    width: 80,
    height: 120,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.xs,
    backgroundColor: '#D0CEC7',
  },
  calendarRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  blockedPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accentBrown,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: '#F3EEE7',
  },
  blockedPillLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.accentBrown,
  },
  availablePill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  availablePillLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  optionDatesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginVertical: spacing.sm,
  },
  optionDatePill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  optionDatePillActive: {
    borderColor: colors.accentGreen,
    backgroundColor: '#E4EFE9',
  },
  optionDateLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  optionDateLabelActive: {
    color: colors.accentGreen,
  },
  confirmationText: {
    ...typography.body,
    fontSize: 12,
    color: colors.accentGreen,
    marginTop: spacing.sm,
  },
  sharedLinkLabel: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
  },
  projectActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  shareFolderLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.buttonOptionGreen,
  },
  deleteProjectLabel: {
    ...typography.label,
    fontSize: 11,
    color: '#e74c3c',
  },
  projectCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    width: '100%',
  },
  projectCardActive: {
    borderColor: colors.accentBrown,
  },
  projectCardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  projectModelCount: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
  },
  projectPrimaryActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  projectActionBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.accentBrown,
    alignItems: 'center',
  },
  projectActionBtnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  projectActionBtnLabel: {
    ...typography.label,
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  projectActionBtnLabelSecondary: {
    color: colors.textPrimary,
  },
  projectSecondaryActions: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  overviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  overviewBackBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  overviewBackLabel: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
  },
  overviewTitle: {
    ...typography.heading,
    fontSize: 16,
    color: colors.textPrimary,
    flex: 1,
  },
  overviewBrowseBtn: {
    marginBottom: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    backgroundColor: colors.accentBrown,
    alignItems: 'center',
  },
  overviewBrowseBtnLabel: {
    ...typography.label,
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  overviewList: {
    flex: 1,
  },
  overviewListContent: {
    paddingBottom: spacing.xl,
  },
  overviewModelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  overviewModelImage: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: colors.border,
  },
  overviewModelInfo: {
    flex: 1,
    gap: 2,
  },
  overviewModelName: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  overviewModelMeta: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
  },
  overviewModelCity: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
  },
  overviewModelError: {
    ...typography.label,
    fontSize: 11,
    color: '#e74c3c',
    marginTop: 2,
  },
  overviewDeleteBtn: {
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e74c3c',
    alignItems: 'center',
  },
  overviewDeleteBtnBusy: {
    opacity: 0.4,
  },
  overviewDeleteBtnLabel: {
    ...typography.label,
    fontSize: 11,
    color: '#e74c3c',
    fontWeight: '600',
  },
  filterGroup: {
    flex: 1,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  filterLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  filterPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  filterPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  filterPillActive: {
    borderColor: colors.accentBrown,
    backgroundColor: '#F3EEE7',
  },
  filterPillLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  filterPillLabelActive: {
    color: colors.accentBrown,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
  },
  bottomBarInner: {
    maxWidth: 1200,
    alignSelf: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  bottomSecondary: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomPrimary: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accentGreen,
    backgroundColor: colors.accentGreen,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  pickerCard: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  pickerTitle: {
    ...typography.label,
    color: colors.textPrimary,
  },
  pickerList: {
    maxHeight: 200,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  pickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  /** Messages tab — compact pill search (matches agency web). */
  msgsFixedTop: {
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginBottom: spacing.xs,
  },
  searchInput: {
    alignSelf: 'stretch',
    width: '100%' as const,
    height: 40,
    minHeight: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 0,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  threadList: {
    flex: 1,
    minHeight: 0,
    marginTop: spacing.xs,
  },
  threadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  threadRowActive: {
    backgroundColor: '#F3F0EC',
  },
  threadRowLeft: {
    flex: 1,
    minWidth: 0,
  },
  /** Option-request list: names stay visible; attention strip scrolls on the right (end-aligned). */
  threadRowOptionRequestList: {
    width: '100%',
    alignSelf: 'stretch',
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  optionRequestThreadNamesColumn: {
    flex: 1,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '58%',
    paddingRight: spacing.sm,
  },
  optionRequestThreadAttentionScroll: {
    flex: 1,
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    alignSelf: 'stretch',
  },
  optionRequestThreadAttentionScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    paddingVertical: 2,
    paddingLeft: spacing.xs,
    paddingRight: spacing.md,
    minWidth: '100%',
  },
  threadRowUnreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2563EB',
    alignSelf: 'center',
    flexShrink: 0,
    marginLeft: spacing.sm,
  },
  threadTitle: {
    ...typography.body,
    color: colors.textPrimary,
    fontFamily: 'serif',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statusPillLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.surface,
  },
  chatPanel: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  chatPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  chatPanelTitle: {
    ...typography.label,
    color: colors.textPrimary,
    fontFamily: 'serif',
  },
  chatPanelMessages: {
    marginBottom: spacing.sm,
  },
  chatBubble: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 12,
    marginBottom: spacing.xs,
    backgroundColor: '#F0EEEA',
  },
  chatBubbleSelf: {
    alignSelf: 'flex-end',
    backgroundColor: colors.buttonOptionGreen,
  },
  chatBubbleOther: {
    backgroundColor: '#E2E0DB',
  },
  chatBubbleText: {
    ...typography.body,
    fontSize: 12,
    color: colors.textPrimary,
  },
  chatBubbleTextSelf: {
    color: colors.surface,
  },
  chatBubbleSystem: {
    alignSelf: 'center',
    maxWidth: '92%',
    backgroundColor: '#E8E6E3',
  },
  chatBubbleSystemLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
    marginBottom: 2,
    textAlign: 'center',
  },
  chatBubbleSystemText: {
    textAlign: 'center',
  },
  chatPanelInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    width: '100%',
    minWidth: 0,
    gap: spacing.sm,
  },
  chatPanelInput: {
    flex: 1,
    minWidth: 0,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    fontSize: 12,
    color: colors.textPrimary,
    minHeight: 36,
    maxHeight: 120,
  },
  chatPanelSend: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.buttonOptionGreen,
    backgroundColor: colors.buttonOptionGreen,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
  chatPanelSendLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.surface,
  },
  // Mobile: toggle button for NegotiationSummaryCard collapse/expand
  mobileSummaryToggle: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  mobileSummaryToggleLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.accent,
    fontWeight: '600' as const,
  },
  optionDateCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  optionDateCardTitle: {
    ...typography.label,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  optionDateChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginVertical: spacing.md,
  },
  optionDateChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionDateChipLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  detailOverlayTouch: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  lightboxOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxImage: {
    width: '90%',
    height: '85%',
  },
  lightboxClose: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxCloseLabel: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  lightboxArrowLeft: {
    position: 'absolute',
    left: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxArrowRight: {
    position: 'absolute',
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxArrowLabel: {
    color: '#fff',
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '300',
  },
  lightboxCounter: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  lightboxCounterLabel: {
    color: '#fff',
    fontSize: 13,
  },
});

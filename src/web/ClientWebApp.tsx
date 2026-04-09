/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Linking,
  Alert,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import {
  CHAT_MESSENGER_FLEX,
  CHAT_THREAD_LIST_FLEX,
  getLegacyChatPanelMessagesMaxHeight,
  getThreadListMaxHeight,
  getThreadListMaxHeightSplit,
  shouldUseB2BWebSplit,
} from '../theme/chatLayout';
import { UI_DOUBLE_SUBMIT_DEBOUNCE_MS } from '../../lib/validation';
import { showAppAlert } from '../utils/crossPlatformAlert';
import { uiCopy } from '../constants/uiCopy';
import { normalizeDocumentspicturesModelImageRef } from '../utils/normalizeModelPortfolioUrl';
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
import { getModelsNearLocation, roundCoord, type NearbyModel } from '../services/modelLocationsSupabase';
import { getGuestLink, getGuestLinkModels, type GuestLinkModel, type PackageType } from '../services/guestLinksSupabase';
import { getAgencies, type Agency } from '../services/agenciesSupabase';
import { AGENCY_SEGMENT_TYPES } from '../constants/agencyTypes';
import { type ModelFilters, defaultModelFilters } from '../utils/modelFilters';
import ModelFiltersPanel from '../components/ModelFiltersPanel';
import {
  getCalendarEntriesForClient,
  getBookingEventsAsCalendarEntries,
  type CalendarEntry,
  type ClientCalendarItem,
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
  setRequestStatus,
  getRequestStatus,
  loadOptionRequestsForClient,
  refreshOptionRequestInCache,
  loadMessagesForThread,
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
import type { Conversation } from '../services/messengerSupabase';
import { sendAgencyInvitation } from '../services/optionRequestsSupabase';
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
  getProjectsForOrg,
  getProjectModels,
  addModelToProject as addModelToProjectOnSupabase,
  type SupabaseProject,
} from '../services/projectsSupabase';
import { supabase } from '../../lib/supabase';
import {
  loadArchivedThreadIds,
  setThreadArchived,
} from '../services/threadPreferencesSupabase';
import { MonthCalendarView, type CalendarDayEvent } from '../components/MonthCalendarView';
import { OPTION_REQUEST_CHAT_STATUS_COLORS } from '../utils/calendarColors';
import {
  deriveSmartAttentionState,
  smartAttentionVisibleForRole,
  type SmartAttentionState,
} from '../utils/optionRequestAttention';
import { ClientOrganizationTeamSection } from '../components/ClientOrganizationTeamSection';
import { OrgMessengerInline } from '../components/OrgMessengerInline';
import { OrgMetricsPanel } from '../components/OrgMetricsPanel';
import { OwnerBillingStatusCard } from '../components/OwnerBillingStatusCard';
import { GlobalSearchBar } from '../components/GlobalSearchBar';
import { DashboardSummaryBar } from '../components/DashboardSummaryBar';
import { StorageImage } from '../components/StorageImage';
import { ClientOrgProfileScreen } from '../screens/ClientOrgProfileScreen';

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
      <View style={{ paddingHorizontal: spacing.sm, paddingTop: spacing.xs, paddingBottom: spacing.xs, zIndex: 200 }}>
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

type TopTab = 'dashboard' | 'discover' | 'projects' | 'agencies' | 'messages' | 'calendar' | 'team' | 'profile';

type ModelSummary = {
  id: string;
  name: string;
  city: string;
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

type ClientWebAppProps = {
  clientType: 'fashion' | 'commercial';
  onClientTypeChange: (t: 'fashion' | 'commercial') => void;
  onBackToRoleSelection: () => void;
};

type Project = {
  id: string;
  name: string;
  models: ModelSummary[];
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
      ({ id, name, city, hairColor, height, bust, waist, hips, coverUrl }) => ({
        id,
        name,
        city,
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
  const [tab, setTab] = useState<TopTab>('dashboard');
  const [showActiveOptions, setShowActiveOptions] = useState(false);
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [projects, setProjects] = useState<Project[]>(() => persistedProjectsToProjects(loadClientProjects()));
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => loadClientActiveProjectId());
  const [newProjectName, setNewProjectName] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<MediaslideModel | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
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
  const [filterSaveStatus, setFilterSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
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
  const [pendingClientB2BChat, setPendingClientB2BChat] = useState<{ conversationId: string; title: string } | null>(null);
  const [isChatWithAgencyLoading, setIsChatWithAgencyLoading] = useState(false);
  const [hasNew, setHasNew] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [msgFilter, setMsgFilter] = useState<'current' | 'archived'>('current');
  const [userCity, setUserCity] = useState<string | null>(null);
  /** Rounded approximate lat/lng for Near me radius queries (~5 km precision). Never exact GPS. */
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  /** Near me models fetched from the radius RPC (separate from territory-based baseModels). */
  const [nearbyModels, setNearbyModels] = useState<ModelSummary[]>([]);
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
  const [assignmentByClientOrgId, setAssignmentByClientOrgId] = useState<Record<string, ClientAssignmentFlag>>({});
  const [assignableMembers, setAssignableMembers] = useState<Array<{ userId: string; name: string }>>([]);
  const agencyOrgId =
    auth?.profile?.org_type === 'agency' ? (auth.profile.organization_id ?? null) : null;

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
          const city =
            data.address?.city ||
            data.address?.town ||
            data.address?.village ||
            null;
          if (city) setUserCity(city);
        } catch (e) {
          console.warn('[geolocation] reverse geocoding failed:', e);
        }
      },
      (err) => { console.warn('[geolocation] position error:', err.code, err.message); },
      { timeout: 10000 },
    );
  }, [filters.nearby, geoConsentGiven, userLat, userLng]);

  // Sync projects FROM Supabase when the client org is resolved.
  // Supabase is the source of truth; localStorage is only a fallback for guests.
  useEffect(() => {
    if (!clientOrgId) return;
    void (async () => {
      try {
        const remote = await getProjectsForOrg(clientOrgId);
        if (remote.length > 0) {
          // Merge: keep model lists from localStorage (not stored in Supabase here),
          // but use Supabase UUIDs as the canonical IDs.
          const local = loadClientProjects();
          const merged = remote.map((rp: SupabaseProject) => {
            const match = local.find((lp) => lp.id === rp.id || lp.name === rp.name);
            return {
              id: rp.id,
              name: rp.name,
              models: match
                ? match.models.map((m) => ({
                    ...m,
                    chest: 0,
                    legsInseam: 0,
                    countryCode: undefined,
                    hasRealLocation: undefined,
                    agencyId: undefined,
                    agencyName: undefined,
                    isSportsWinter: undefined,
                    isSportsSummer: undefined,
                    sex: undefined,
                  }))
                : [],
            };
          });
          setProjects(merged as Project[]);
        }
      } catch (e) {
        console.error('ClientWebApp: failed to sync projects from Supabase', e);
      }
    })();
  }, [clientOrgId]);

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
    filters.sex, filters.heightMin, filters.heightMax, filters.ethnicities,
    filters.countryCode, filters.city, filters.nearby,
    filters.category, filters.sportsWinter, filters.sportsSummer,
    filters.hairColor, filters.hipsMin, filters.hipsMax,
    filters.waistMin, filters.waistMax, filters.chestMin, filters.chestMax,
    filters.legsInseamMin, filters.legsInseamMax,
  ]);

  const realClientId =
    auth?.profile?.role === 'client' && auth.profile.id ? auth.profile.id : null;
  const isRealClient = !!realClientId;

  // Resolve the client organisation for this user (owner or employee).
  // profile.organization_id is loaded by AuthContext via get_my_org_context() —
  // it already covers both owners and employees without an additional RPC call.
  useEffect(() => {
    if (!realClientId) { setClientOrgId(null); return; }
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
        if (!seen.has(ev.id)) { seen.add(ev.id); merged.push(ev); }
      }
      merged.sort((a, b) => a.date.localeCompare(b.date) || (a.start_time ?? '').localeCompare(b.start_time ?? ''));
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
      loadOptionRequestsForClient();
    }
  }, [realClientId]);

  useEffect(() => {
    // Reset session dedup on every new filter-driven query (new discovery context).
    if (clientOrgId) {
      clearSessionIds(clientOrgId);
    }
    sessionSeenIds.current = new Set();
    setCurrentIndex(0);
    setDiscoveryCursor(null);

    void (async () => {
      const countryIso = filters.countryCode.trim() || undefined;
      const cityFilter = countryIso && filters.city.trim() ? filters.city.trim() : undefined;

      // Derive effective clientType / category from unified category filter.
      const cat = filters.category;
      const effectiveClientType = !cat ? 'all' : cat === 'Commercial' ? 'commercial' : 'fashion';
      const effectiveCategory = cat === 'High Fashion' ? 'High Fashion' : undefined;

      // Convert height range strings → numeric values for backend filtering.
      const pInt = (v: string) => { const n = parseInt(v, 10); return isNaN(n) ? undefined : n; };

      const measurementFilters = {
        heightMin:     pInt(filters.heightMin),
        heightMax:     pInt(filters.heightMax),
        ethnicities:   filters.ethnicities.length ? filters.ethnicities : undefined,
        hairColor:     filters.hairColor.trim() || undefined,
        hipsMin:       pInt(filters.hipsMin),
        hipsMax:       pInt(filters.hipsMax),
        waistMin:      pInt(filters.waistMin),
        waistMax:      pInt(filters.waistMax),
        chestMin:      pInt(filters.chestMin),
        chestMax:      pInt(filters.chestMax),
        legsInseamMin: pInt(filters.legsInseamMin),
        legsInseamMax: pInt(filters.legsInseamMax),
        sex: (filters.sex !== 'all' ? filters.sex : undefined) as 'male' | 'female' | undefined,
      };

      // Ranked discovery: use get_discovery_models RPC when a client org +
      // country code are known. Falls back to the unranked legacy path otherwise.
      if (clientOrgId && countryIso) {
        const discoveryFilters = {
          countryCode:  countryIso,
          clientCity:   userCity ?? null,
          category:     effectiveCategory ?? null,
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
        city: m.city,
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
    filters.sex, filters.heightMin, filters.heightMax, filters.ethnicities,
    filters.countryCode, filters.city, filters.category,
    filters.sportsWinter, filters.sportsSummer,
    filters.hairColor, filters.hipsMin, filters.hipsMax,
    filters.waistMin, filters.waistMax, filters.chestMin, filters.chestMax,
    filters.legsInseamMin, filters.legsInseamMax,
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
    ) return;

    const remaining = filteredModels.length - 1 - currentIndex;
    if (remaining > LOAD_MORE_THRESHOLD) return;

    const countryIso = filters.countryCode.trim();
    if (!countryIso) return;

    isLoadingMoreRef.current = true;
    const cat = filters.category;
    const effectiveCategory = cat === 'High Fashion' ? 'High Fashion' : undefined;
    const pInt = (v: string) => { const n = parseInt(v, 10); return isNaN(n) ? undefined : n; };

    void (async () => {
      try {
        const { models: more, nextCursor } = await getDiscoveryModels(
          clientOrgId,
          {
            countryCode:   countryIso,
            clientCity:    userCity ?? null,
            category:      effectiveCategory ?? null,
            sportsWinter:  filters.sportsWinter || false,
            sportsSummer:  filters.sportsSummer || false,
            heightMin:     pInt(filters.heightMin),
            heightMax:     pInt(filters.heightMax),
            ethnicities:   filters.ethnicities.length ? filters.ethnicities : undefined,
            hairColor:     filters.hairColor.trim() || undefined,
            hipsMin:       pInt(filters.hipsMin),
            hipsMax:       pInt(filters.hipsMax),
            waistMin:      pInt(filters.waistMin),
            waistMax:      pInt(filters.waistMax),
            chestMin:      pInt(filters.chestMin),
            chestMax:      pInt(filters.chestMax),
            legsInseamMin: pInt(filters.legsInseamMin),
            legsInseamMax: pInt(filters.legsInseamMax),
            sex: (filters.sex !== 'all' ? filters.sex : undefined) as 'male' | 'female' | undefined,
          },
          discoveryCursor,
          sessionSeenIds.current,
        );
        if (more.length > 0) {
          setModels((prev) => [...prev, ...more.map(mapDiscoveryModelToSummary)]);
          setDiscoveryCursor(nextCursor);
        } else {
          setDiscoveryCursor(null);
        }
      } catch (e) {
        console.error('[Discovery] loadMore error:', e);
      } finally {
        isLoadingMoreRef.current = false;
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentIndex, discoveryCursor, clientOrgId, filters.nearby, packageViewState, sharedProjectId,
    userCity, filters.countryCode, filters.sex, filters.heightMin, filters.heightMax,
    filters.ethnicities, filters.category, filters.sportsWinter, filters.sportsSummer,
    filters.hairColor, filters.hipsMin, filters.hipsMax, filters.waistMin, filters.waistMax,
    filters.chestMin, filters.chestMax, filters.legsInseamMin, filters.legsInseamMax,
    models.length,
  ]);

  // Radius-based Near me discovery — only when nearby toggle is active AND we have coordinates.
  useEffect(() => {
    if (!filters.nearby || userLat == null || userLng == null) {
      setNearbyModels([]);
      return;
    }
    void (async () => {
      try {
        const cat = filters.category;
        const effectiveClientType = !cat ? 'all' : cat === 'Commercial' ? 'commercial' : 'fashion';
        const effectiveCategory = cat === 'High Fashion' ? 'High Fashion' : undefined;
        const pInt = (v: string) => { const n = parseInt(v, 10); return isNaN(n) ? undefined : n; };
        const measurementFilters = {
          heightMin:      pInt(filters.heightMin),
          heightMax:      pInt(filters.heightMax),
          ethnicities:    filters.ethnicities.length ? filters.ethnicities : undefined,
          hairColor:      filters.hairColor.trim() || undefined,
          hipsMin:        pInt(filters.hipsMin),
          hipsMax:        pInt(filters.hipsMax),
          waistMin:       pInt(filters.waistMin),
          waistMax:       pInt(filters.waistMax),
          chestMin:       pInt(filters.chestMin),
          chestMax:       pInt(filters.chestMax),
          legsInseamMin:  pInt(filters.legsInseamMin),
          legsInseamMax:  pInt(filters.legsInseamMax),
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
          city: m.location_city ?? m.city ?? '',
          hairColor: m.hair_color ?? '',
          height: m.height,
          bust: m.bust ?? 0,
          waist: m.waist ?? 0,
          hips: m.hips ?? 0,
          chest: m.chest ?? m.bust ?? 0,
          legsInseam: m.legs_inseam ?? 0,
          coverUrl: normalizeDocumentspicturesModelImageRef(
            m.portfolio_images?.[0] ?? '',
            m.id,
          ),
          agencyId: m.territory_agency_id ?? m.agency_id ?? null,
          agencyName: m.agency_name ?? null,
          countryCode: m.location_country_code ?? null,
          hasRealLocation: true,
          isSportsWinter: m.is_sports_winter ?? false,
          isSportsSummer: m.is_sports_summer ?? false,
          sex: m.sex ?? null,
        }));
        setNearbyModels(mapped);
      } catch (e) {
        console.error('getModelsNearLocation error:', e);
        setNearbyModels([]);
      }
    })();
  }, [
    filters.nearby, userLat, userLng,
    filters.sex, filters.heightMin, filters.heightMax, filters.ethnicities,
    filters.category, filters.sportsWinter, filters.sportsSummer,
    filters.hairColor, filters.hipsMin, filters.hipsMax,
    filters.waistMin, filters.waistMax, filters.chestMin, filters.chestMax,
    filters.legsInseamMin, filters.legsInseamMax,
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

  useEffect(() => {
    if (detailId) {
      setDetailLoading(true);
      setDetailData(null);
      getModelData(detailId)
        .then((data: any) => {
          if (packageViewState) {
            const raw = packageViewState.rawModels.find((m) => m.id === detailId);
            const correctImages = packageViewState.packageType === 'polaroid'
              ? (raw?.polaroids ?? [])
              : (raw?.portfolio_images ?? []);
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
          } else {
            setDetailData(data);
          }
        })
        .finally(() => setDetailLoading(false));
    }
  }, [detailId, packageViewState, sharedProject]);

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
        return nearbyModels;  // radius RPC results, already sorted by distance
      }
      if (userCity) {
        // Geolocation permission denied but city resolved via Nominatim
        return baseModels.filter((m) =>
          (m.city || '').toLowerCase().includes(userCity.toLowerCase()),
        );
      }
    }
    return baseModels;
  }, [baseModels, nearbyModels, filters.nearby, userLat, userLng, userCity, isPackageMode, isSharedMode]);

  const currentModel = useMemo(
    () =>
      filteredModels.length
        ? filteredModels[currentIndex % filteredModels.length]
        : null,
    [filteredModels, currentIndex],
  );

  useEffect(() => {
    if (currentIndex >= filteredModels.length) {
      setCurrentIndex(0);
    }
  }, [filteredModels.length, currentIndex]);

  const createProjectInternal = async (name: string): Promise<Project | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    // Persist to Supabase to get a real UUID; fall back to timestamp ID for guests.
    let id: string = String(Date.now());
    if (realClientId) {
      try {
        const remote = await createProjectOnSupabase(realClientId, trimmed, clientOrgId ?? undefined);
        if (remote?.id) id = remote.id;
      } catch (e) {
        console.error('createProjectInternal: Supabase createProject failed, using local ID', e);
      }
    }
    const project: Project = { id, name: trimmed, models: [] };
    setProjects((prev) => [...prev, project]);
    setActiveProjectId(project.id);
    return project;
  };

  const createProject = async () => {
    const created = await createProjectInternal(newProjectName);
    if (!created) return;
    setNewProjectName('');
    setFeedback(`Created project "${created.name}".`);
    clearFeedbackLater();
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
          p.id === projectId
            ? { ...p, models: p.models.filter((m) => dbIdSet.has(m.id)) }
            : p,
        ),
      );
    } catch (e) {
      console.error('reconcileProjectModels: failed to sync from DB', e);
    }
  }, []);

  const handleDeleteProject = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(uiCopy.projects.deleteConfirm)
      : true;
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
              models: p.models.some((m) => m.id === model.id)
                ? p.models
                : [...p.models, model],
            }
          : p,
      ),
    );

    // Persist to Supabase. The service NEVER throws — it returns false on error
    // (both supabase error and exception paths). .catch() would never fire.
    // MUST use .then(ok) to detect failure and trigger inverse-operation rollback.
    void addModelToProjectOnSupabase(projectId, model.id)
      .then((ok) => {
        setAddingModelIds((prev) => { const s = new Set(prev); s.delete(model.id); return s; });
        if (ok) {
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
          setFeedback('Could not save model to project — no active agency connection.');
          clearFeedbackLater();
        }
      })
      .catch((e) => {
        // Network-level rejection (extremely rare with Supabase JS client).
        console.error('addModelToProject: unexpected rejection', e);
        setAddingModelIds((prev) => { const s = new Set(prev); s.delete(model.id); return s; });
        if (!alreadyPresent) {
          setProjects((prev) =>
            prev.map((p) =>
              p.id === projectId
                ? { ...p, models: p.models.filter((m) => m.id !== model.id) }
                : p,
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
    setSharedProjectId(projectId);
    setTab('discover');
  };

  const openProjectOverview = (id: string) => setProjectOverviewId(id);
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
        p.id === projectId
          ? { ...p, models: p.models.filter((m) => m.id !== modelId) }
          : p,
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

  // Single-timer ref: cancels any previous clearFeedbackLater timer before starting a new one.
  // Without this, concurrent actions (each starting their own setTimeout) race and can clear
  // a newer feedback message early, or leave a stale message visible too long.
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearFeedbackLater = () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 2400);
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
    setTimeout(() => { isNavigatingRef.current = false; }, 300);
  };

  const _onReject = () => {
    if (!filteredModels.length || isNavigatingRef.current) return;
    isNavigatingRef.current = true;
    const current = filteredModels[currentIndex % filteredModels.length];
    if (current && clientOrgId) {
      void recordInteraction(current.id, 'rejected');
    }
    setCurrentIndex((prev) => (prev + 1) % filteredModels.length);
    setTimeout(() => { isNavigatingRef.current = false; }, 300);
  };

  const _openSharedLinkForProject = (projectId: string) => {
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
    setSharedProjectId(null);
    setTab('projects');
  };

  const exitPackageMode = () => {
    setPackageViewState(null);
    setTab('messages');
  };

  const handlePackagePress = async (meta: Record<string, unknown>) => {
    const packageId = typeof meta.package_id === 'string' ? meta.package_id : null;
    if (!packageId) return;
    setFeedback('Loading package…');
    try {
      const gl = await getGuestLink(packageId);
      if (!gl) {
        setFeedback('Package not found or has expired.');
        clearFeedbackLater();
        return;
      }
      const glModels = await getGuestLinkModels(packageId);
      const packageModels: ModelSummary[] = glModels.map((m) => ({
        id: m.id,
        name: m.name,
        city: m.city ?? '',
        hairColor: m.hair_color ?? '',
        height: m.height ?? 0,
        bust: m.bust ?? 0,
        waist: m.waist ?? 0,
        hips: m.hips ?? 0,
        chest: (m as { chest?: number | null }).chest ?? m.bust ?? 0,
        legsInseam: 0,
        coverUrl: normalizeDocumentspicturesModelImageRef(
          gl.type === 'polaroid' ? (m.polaroids?.[0] ?? '') : (m.portfolio_images?.[0] ?? ''),
          m.id,
        ),
        agencyId: null,
        agencyName: null,
        countryCode: null,
        hasRealLocation: false,
      }));
      // Prefer the explicit label set by the agency; fall back to agency-name + count
      const packageName = gl.label
        ?? (gl.agency_name
          ? `${gl.agency_name} (${glModels.length} models)`
          : `Package (${glModels.length} models)`);
      setFeedback(null);
      setPackageViewState({
        packageId,
        name: packageName,
        models: packageModels,
        guestLink: typeof meta.guest_link === 'string' ? meta.guest_link : '',
        packageType: gl.type,
        rawModels: glModels,
      });
      setCurrentIndex(0);
      setTab('discover');
    } catch (e) {
      console.error('handlePackagePress error:', e);
      setFeedback('Could not load package. Please try again.');
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
    }
  ) => {
    const pkgExtra = packageViewState
      ? { source: 'package' as const, packageId: packageViewState.packageId }
      : {};
    const threadId = addOptionRequest(
      'Client',
      modelName,
      modelId,
      date,
      projectId ?? sharedProjectId ?? activeProjectId ?? undefined,
      { ...extra, ...pkgExtra },
    );
    setOptionDatePickerOpen(false);
    setOptionDateModel(null);
    setOpenThreadIdOnMessages(threadId);
    setTab('messages');
  };

  const handleSaveClientAssignment = useCallback(async (
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
  }, [agencyOrgId]);

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
  const bottomTabInset = BOTTOM_TAB_BAR_HEIGHT + insets.bottom;

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
  }, []);

  const resetCalendarTabRoot = useCallback(() => {
    setSelectedCalendarItem(null);
    setSelectedManualEvent(null);
    setShowAddManualEvent(false);
    setClientNotesDraft('');
    setClientSharedNoteDraft('');
  }, []);

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
        setPendingClientB2BChat({ conversationId: result.conversationId, title: uiCopy.b2bChat.agencyFallback });
        setTab('messages');
      } else {
        showAppAlert(uiCopy.b2bChat.chatFailedTitle, result.reason || uiCopy.b2bChat.chatFailedGeneric);
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
    <View style={styles.root}>
      {/* GDPR: Geolocation + Nominatim consent banner — shown the first time "Near me" is activated */}
      {showGeoConsentBanner && (
        <View style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.55)', zIndex: 9999,
          alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
        }}>
          <View style={{
            backgroundColor: colors.surface, borderRadius: 12, padding: spacing.lg,
            maxWidth: 420, width: '100%', gap: spacing.md,
          }}>
            <Text style={{ ...typography.heading, fontSize: 16, color: colors.textPrimary }}>
              Location Access
            </Text>
            <Text style={{ ...typography.body, color: colors.textSecondary, lineHeight: 20 }}>
              To show models near you, IndexCasting will request your device location and send
              your approximate coordinates to{' '}
              <Text style={{ color: colors.textPrimary }}>OpenStreetMap Nominatim</Text>
              {' '}(a third-party geocoder) to determine your city.
            </Text>
            <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary }}>
              Your coordinates are rounded to ~5 km precision and are not stored on our servers.
              You can withdraw consent at any time by disabling the "Near me" filter.
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
                  backgroundColor: colors.accent, borderRadius: 8,
                  paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '600' }}>Allow Location</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
      <View style={[styles.appShell, { paddingBottom: bottomTabInset }]}>
        <View style={styles.topBar}>
          <View style={styles.topBarRow}>
            <TouchableOpacity
              style={styles.backArrowTouchable}
              onPress={onBackToRoleSelection}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={{ ...typography.label, fontSize: 12, color: colors.textSecondary }}>Logout</Text>
            </TouchableOpacity>
            <Text style={styles.brand}>INDEX CASTING</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <TouchableOpacity
                onPress={() => setSettingsOpen(true)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={{ fontSize: 18, color: colors.textSecondary }}>⚙</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const subject = encodeURIComponent('Help Request – Casting Index');
                  const body = encodeURIComponent('Hello Casting Index Team,\n\nI need help with:\n\n');
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
              setOpenThreadIdOnMessages(id);
              setTab('messages');
            }}
            onSelectModel={(id) => { openDetails(id); setTab('discover'); }}
          />
        )}

        {tab === 'discover' && showActiveOptions && (
          <ActiveOptionsView
            onClose={() => setShowActiveOptions(false)}
            assignmentByClientOrgId={assignmentByClientOrgId}
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
          />
        )}

        {tab === 'projects' && projectOverviewId ? (
          <ProjectOverviewView
            project={projects.find((p) => p.id === projectOverviewId) ?? null}
            onBack={closeProjectOverview}
            onRemoveModel={handleRemoveModelFromProject}
          />
        ) : tab === 'projects' ? (
          <ProjectsView
            projects={projects}
            activeProjectId={activeProjectId}
            onSelectProject={setActiveProjectId}
            newProjectName={newProjectName}
            setNewProjectName={setNewProjectName}
            onCreateProject={createProject}
            onDeleteProject={handleDeleteProject}
            onOpenDetails={openDetails}
            onOpenProject={openProjectDiscovery}
            onOpenOverview={openProjectOverview}
            onShareFolder={handleShareFolder}
            onOpenOptionChat={(threadId) => {
              setOpenThreadIdOnMessages(threadId);
              setTab('messages');
            }}
          />
        ) : null}

        {tab === 'agencies' && (
          <AgenciesView
            clientUserId={realClientId}
            onChatStarted={(conversationId, title) => {
              setPendingClientB2BChat({ conversationId, title });
              setTab('messages');
            }}
          />
        )}

        {tab === 'calendar' && (
          <View style={{ flex: 1 }}>
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
              onRefresh={loadClientCalendar}
              onOpenDetails={(item) => {
                setSelectedCalendarItem(item);
                setSelectedManualEvent(null);
                const existing =
                  (item.calendar_entry?.booking_details as any)?.client_notes ??
                  '';
                setClientNotesDraft(existing);
              }}
              onOpenManualEvent={(ev) => {
                setSelectedManualEvent(ev);
                setSelectedCalendarItem(null);
              }}
              onOpenBookingEntry={(be) => Alert.alert(
                be.title ?? uiCopy.calendar.bookingEvent,
                `${uiCopy.calendar.date}: ${be.date}\n${uiCopy.calendar.status}: ${be.status ?? '—'}`,
              )}
              onAddEvent={() => isRealClient && setShowAddManualEvent(true)}
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
            onPackagePress={(meta) => { void handlePackagePress(meta); }}
          />
        )}

        {tab === 'team' && (
          <View style={{ flex: 1, alignSelf: 'stretch', paddingHorizontal: spacing.xs }}>
            <Text style={{ ...typography.heading, fontSize: 18, color: colors.textPrimary, marginBottom: spacing.sm }}>
              Team
            </Text>
            {clientOrgId && <OwnerBillingStatusCard variant="client" />}
            {clientOrgId && auth.profile?.org_member_role === 'owner' && (
              <ClientOrgMetricsPanelWrapper orgId={clientOrgId} />
            )}
            <ClientOrganizationTeamSection realClientId={realClientId} />
          </View>
        )}

        {tab === 'profile' && (
          <ClientOrgProfileScreen
            organizationId={clientOrgId}
            orgName={auth.profile?.company_name ?? null}
            orgMemberRole={auth.profile?.org_member_role ?? null}
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
        isPackageMode={isPackageMode}
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
            {(() => {
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
                <View>
                  <Text style={styles.metaText}>
                    {kind} · {option.model_name ?? 'Model'} ·{' '}
                    {option.client_name ?? 'Client'}
                  </Text>
                  <Text style={styles.metaText}>
                    {date}
                    {start ? ` · ${start}${end ? `–${end}` : ''}` : ''}
                  </Text>
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
                    onChangeText={(t) => setBookingScheduleDraft((p) => ({ ...p, start_time: t }))}
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
                      await loadOptionRequestsForClient();
                      const items = await getCalendarEntriesForClient(realClientId);
                      const next = items.find((x) => x.option.id === selectedCalendarItem.option.id);
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
                  { marginTop: spacing.sm, alignSelf: 'flex-end', opacity: savingBookingSchedule ? 0.6 : 1 },
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
                  (selectedCalendarItem.calendar_entry.booking_details as BookingDetails | null)?.booking_brief
                }
                onAfterSave={async () => {
                  await loadClientCalendar();
                  await loadOptionRequestsForClient();
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
                    (selectedCalendarItem.calendar_entry?.booking_details as { shared_notes?: SharedBookingNote[] } | null)
                      ?.shared_notes ?? []
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
                  style={[styles.input, { minHeight: 72, borderRadius: 12, textAlignVertical: 'top' }]}
                />
                <TouchableOpacity
                  onPress={async () => {
                    if (!selectedCalendarItem || !clientSharedNoteDraft.trim()) return;
                    const now = Date.now();
                    if (now - lastAppendSharedNoteAtRef.current < UI_DOUBLE_SUBMIT_DEBOUNCE_MS) return;
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
                        const next = items.find((x) => x.option.id === selectedCalendarItem.option.id);
                        if (next) setSelectedCalendarItem(next);
                      }
                    } finally {
                      setSavingSharedNoteClient(false);
                    }
                  }}
                  style={[
                    styles.primaryButton,
                    { marginTop: spacing.sm, alignSelf: 'flex-end', opacity: savingSharedNoteClient ? 0.6 : 1 },
                  ]}
                  disabled={savingSharedNoteClient}
                >
                  <Text style={styles.primaryLabel}>
                    {savingSharedNoteClient ? uiCopy.calendar.postingSharedNote : uiCopy.calendar.postSharedNote}
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
        onSubmit={(date, startTime, endTime, price, requestType, currency) =>
          optionDateModel &&
          handleOptionRequest(optionDateModel.name, optionDateModel.id, date, undefined, {
            startTime,
            endTime,
            proposedPrice: price,
            requestType: requestType ?? 'option',
            currency: currency ?? 'EUR',
            countryCode: filters.countryCode.trim() || undefined,
          })
        }
      />

      {showAddManualEvent && (
        <View style={styles.detailOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowAddManualEvent(false)} />
          <View style={[styles.detailCard, { maxWidth: 400 }]}>
            <Text style={styles.detailTitle}>Add event</Text>
            <TextInput placeholder="Title" value={newEventForm.title} onChangeText={(t) => setNewEventForm((f) => ({ ...f, title: t }))} placeholderTextColor={colors.textSecondary} style={styles.input} />
            <Text style={{ ...typography.label, marginTop: spacing.sm, marginBottom: 4 }}>Date (YYYY-MM-DD)</Text>
            <TextInput placeholder="2025-03-15" value={newEventForm.date} onChangeText={(d) => setNewEventForm((f) => ({ ...f, date: d }))} placeholderTextColor={colors.textSecondary} style={styles.input} />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.label, marginBottom: 4 }}>From</Text>
                <TextInput value={newEventForm.start_time} onChangeText={(t) => setNewEventForm((f) => ({ ...f, start_time: t }))} placeholderTextColor={colors.textSecondary} style={styles.input} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...typography.label, marginBottom: 4 }}>To</Text>
                <TextInput value={newEventForm.end_time} onChangeText={(t) => setNewEventForm((f) => ({ ...f, end_time: t }))} placeholderTextColor={colors.textSecondary} style={styles.input} />
              </View>
            </View>
            <Text style={{ ...typography.label, marginTop: spacing.sm, marginBottom: 4 }}>Note (private)</Text>
            <TextInput
              value={newEventForm.note}
              onChangeText={(t) => setNewEventForm((f) => ({ ...f, note: t }))}
              multiline
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, { minHeight: 64, textAlignVertical: 'top', borderRadius: 12 }]}
            />
            <Text style={{ ...typography.label, marginTop: spacing.sm, marginBottom: 4 }}>Color</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {MANUAL_EVENT_COLORS.map((c) => (
                <TouchableOpacity key={c} onPress={() => setNewEventForm((f) => ({ ...f, color: c }))} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c, borderWidth: newEventForm.color === c ? 2 : 0, borderColor: colors.textPrimary }} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <TouchableOpacity style={[styles.filterPill, { flex: 1 }]} onPress={() => setShowAddManualEvent(false)}>
                <Text style={styles.filterPillLabel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, { flex: 1 }]}
                disabled={!newEventForm.title.trim() || !newEventForm.date.trim() || savingManualEvent}
                onPress={async () => {
                  if (!realClientId) {
                    Alert.alert(uiCopy.alerts.signInRequired, uiCopy.alerts.signInAsClientForCalendar);
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
                    Alert.alert('Event not saved', result.errorMessage || 'Please check the date (YYYY-MM-DD) and try again.');
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
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setSelectedManualEvent(null)} />
          <View style={[styles.detailCard, { maxWidth: 400 }]}>
            <Text style={styles.detailTitle}>{uiCopy.clientWeb.editEvent}</Text>
            <Text style={{ ...typography.label, marginTop: spacing.sm, marginBottom: 4 }}>Title</Text>
            <TextInput
              value={manualEventEditDraft.title}
              onChangeText={(t) => setManualEventEditDraft((p) => ({ ...p, title: t }))}
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
            />
            <Text style={{ ...typography.label, marginTop: spacing.sm, marginBottom: 4 }}>Date (YYYY-MM-DD)</Text>
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
            <Text style={{ ...typography.label, marginTop: spacing.sm, marginBottom: 4 }}>Note (private)</Text>
            <TextInput
              value={manualEventEditDraft.note}
              onChangeText={(t) => setManualEventEditDraft((p) => ({ ...p, note: t }))}
              multiline
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, { minHeight: 72, textAlignVertical: 'top', borderRadius: 12 }]}
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
                style={[styles.primaryButton, { flex: 1, minWidth: 120, opacity: savingManualEventEdit ? 0.6 : 1 }]}
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
                <Text style={[styles.filterPillLabel, { color: colors.buttonSkipRed }]}>Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.filterPill, { flex: 1, minWidth: 100 }]} onPress={() => setSelectedManualEvent(null)}>
                <Text style={styles.filterPillLabel}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {settingsOpen && (
        <SettingsPanel realClientId={realClientId} onClose={() => setSettingsOpen(false)} />
      )}

      <View style={[styles.bottomTabBar, { paddingBottom: insets.bottom }]}>
        {(['dashboard', 'discover', 'messages', 'calendar', 'agencies', 'projects', 'profile'] as TopTab[]).map((key) => (
          <TouchableOpacity
            key={key}
            onPress={() => handleBottomTabPress(key)}
            style={styles.bottomTabItem}
          >
            <Text style={[styles.bottomTabLabel, tab === key && styles.bottomTabLabelActive]}>
              {key === 'dashboard'
                ? uiCopy.clientWeb.bottomTabs.dashboard
                : key === 'discover'
                ? uiCopy.clientWeb.bottomTabs.discover
                : key === 'projects'
                ? uiCopy.clientWeb.bottomTabs.projects
                : key === 'calendar'
                ? uiCopy.clientWeb.bottomTabs.calendar
                : key === 'agencies'
                ? uiCopy.clientWeb.bottomTabs.agencies
                : key === 'team'
                ? uiCopy.clientWeb.bottomTabs.team
                : key === 'profile'
                ? uiCopy.clientWeb.bottomTabs.profile
                : uiCopy.clientWeb.bottomTabs.messages}
            </Text>
            {key === 'messages' && hasNew && (
              <View style={styles.bottomTabDot} />
            )}
            {tab === key && <View style={styles.bottomTabUnderline} />}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

/** Compact banner showing which filters are currently active. */
const FilterExplanationBanner: React.FC<{ filters: ModelFilters }> = ({ filters }) => {
  const parts: string[] = [];
  if (filters.heightMin || filters.heightMax) {
    const ht = [filters.heightMin, filters.heightMax].filter(Boolean).join('–');
    parts.push(`Height ${ht} cm`);
  }
  if (filters.sex !== 'all') parts.push(filters.sex.charAt(0).toUpperCase() + filters.sex.slice(1));
  if (filters.countryCode) parts.push(filters.countryCode.toUpperCase());
  if (filters.city) parts.push(filters.city);
  if (filters.category) parts.push(filters.category);
  if (parts.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs }}>
      <Text style={{ fontSize: 11, color: colors.textSecondary }}>
        {uiCopy.dashboard.filterExplanation}
      </Text>
      {parts.map((p) => (
        <Text key={p} style={{ fontSize: 11, color: colors.textPrimary, fontWeight: '600' }}>{p}</Text>
      ))}
      <Text style={{ fontSize: 11, color: colors.textSecondary }}>
        {'  •  '}{uiCopy.dashboard.filterSeenHidden}
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
};

/**
 * Watermark overlay for guest-link / package views.
 * Renders a grid of semi-transparent diagonal "PREVIEW" labels.
 * pointerEvents="none" ensures the overlay never blocks taps on images below.
 *
 * Architecture note (M2): The serve-watermarked-image Edge Function (JWT-required)
 * handles per-image server-side SVG watermarking for authenticated agency/client
 * users requesting individual images. This React overlay is appropriate for the
 * shared/package discovery context because the images are already resolved to
 * signed URLs before rendering. Migrating to serve-watermarked-image here would
 * require passing storage paths (not signed URLs) through the discovery pipeline,
 * which is a larger architectural change tracked separately.
 */
const GuestWatermark: React.FC = () => (
  <View
    pointerEvents="none"
    style={{
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      overflow: 'hidden',
      zIndex: 10,
    }}
  >
    {[0, 1, 2, 3, 4].map((row) =>
      [0, 1].map((col) => (
        <View
          key={`${row}-${col}`}
          style={{
            position: 'absolute',
            top: `${row * 25}%` as unknown as number,
            left: `${col * 50}%` as unknown as number,
            width: '60%' as unknown as number,
            alignItems: 'center',
            transform: [{ rotate: '-30deg' }],
          }}
        >
          <Text
            style={{
              color: 'rgba(255,255,255,0.28)',
              fontSize: 13,
              fontWeight: '700',
              letterSpacing: 2,
              textTransform: 'uppercase',
            }}
            selectable={false}
          >
            PREVIEW · IndexCasting
          </Text>
        </View>
      ))
    )}
  </View>
);

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
}) => {
  // Package mode: grid layout matching GuestView (all models visible at once, no swipe)
  if (isPackageMode) {
    const packageTypeLabel = packageType === 'polaroid' ? 'Polaroid Package' : 'Portfolio Package';
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
          <TouchableOpacity onPress={onExitPackage} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.packageBannerExit}>{uiCopy.discover.exitPackage}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.packageGrid} showsVerticalScrollIndicator={false}>
          {models.length === 0 ? (
            <View style={styles.emptyDiscover}>
              <Text style={styles.emptyTitle}>{uiCopy.discover.noMoreModels}</Text>
            </View>
          ) : (
            models.map((m) => (
              <View key={m.id} style={styles.packageGridCard}>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => onOpenDetails(m.id)}
                >
                  <View style={styles.packageGridImageContainer}>
                    <StorageImage
                      uri={m.coverUrl || undefined}
                      style={styles.packageGridImage}
                      resizeMode="cover"
                      ttlSeconds={CLIENT_MODEL_IMAGE_TTL_SEC}
                      fallback={
                        <View style={[styles.packageGridImage, { backgroundColor: colors.border }]} />
                      }
                    />
                    <GuestWatermark />
                    <View style={styles.coverGradientOverlay} />
                    <View style={styles.coverMeasurementsOverlay}>
                      <Text style={styles.coverNameOnImage}>{m.name}</Text>
                      <Text style={styles.coverMeasurementsLabel}>
                        Height {m.height} cm · Chest {m.chest || m.bust || '—'} cm · Waist {m.waist || '—'} cm · Hips {m.hips || '—'} cm
                        {m.legsInseam ? ` · Inseam ${m.legsInseam} cm` : ''}
                      </Text>
                      <Text style={styles.coverLocationLabel}>{m.city || '—'}</Text>
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
                    style={[styles.addToSelectionButton, addingModelIds?.has(m.id) && { opacity: 0.4 }]}
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
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>Discover</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {onShowActiveOptions && (
            <TouchableOpacity
              onPress={onShowActiveOptions}
              style={{ backgroundColor: colors.background, borderRadius: 6, paddingHorizontal: spacing.sm, paddingVertical: 4, borderWidth: 1, borderColor: colors.border }}
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
        <View style={styles.coverRow}>
          <View style={styles.coverCard}>
            <View style={styles.coverImageContainer}>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => onOpenDetails(current.id)}
                style={styles.coverImageTouchable}
              >
                <StorageImage
                  uri={current.coverUrl || undefined}
                  style={styles.coverImage}
                  resizeMode="cover"
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
                  Height {current.height} cm · Chest {current.chest || current.bust || '—'} cm · Waist {current.waist || '—'} cm · Hips {current.hips || '—'} cm
                  {current.legsInseam ? ` · Inseam ${current.legsInseam} cm` : ''}
                </Text>
                <Text style={styles.coverLocationLabel}>
                  {current.hasRealLocation
                    ? `${current.city || '—'} · ${current.countryCode || '—'}`
                    : `Represented in ${current.countryCode || '—'}${
                        current.agencyName ? ` · ${current.agencyName}` : ''
                      }`}
                </Text>
                {(current.isSportsWinter || current.isSportsSummer) && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {current.isSportsWinter && (
                      <View style={styles.sportsBadge}>
                        <Text style={styles.sportsBadgeLabel}>{uiCopy.sportCategories.winterSports}</Text>
                      </View>
                    )}
                    {current.isSportsSummer && (
                      <View style={styles.sportsBadge}>
                        <Text style={styles.sportsBadgeLabel}>{uiCopy.sportCategories.summerSports}</Text>
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
                style={[styles.addToSelectionButton, addingModelIds?.has(current.id) && { opacity: 0.4 }]}
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
                  style={[styles.chatWithAgencyButton, isChatWithAgencyLoading && { opacity: 0.5 }]}
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
  onRefresh,
  onOpenDetails,
  onOpenManualEvent,
  onOpenBookingEntry,
  onAddEvent,
}) => {
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

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const sorted = useMemo(
    () =>
      [...items]
        .filter((a) => {
          const date = a.calendar_entry?.date ?? a.option.requested_date;
          return date != null && date >= today;
        })
        .sort((a, b) =>
          (a.option.requested_date || '').localeCompare(b.option.requested_date || ''),
        ),
    [items, today],
  );
  const sortedManual = useMemo(
    () =>
      [...manualEvents]
        .filter((ev) => (ev.date || '') >= today)
        .sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || '').localeCompare(b.start_time || '')),
    [manualEvents, today],
  );

  const renderBadge = (item: ClientCalendarItem) => {
    const { option, calendar_entry } = item;
    const entryType = calendar_entry?.entry_type;
    let kind: 'Option' | 'Job' | 'Casting' = 'Option';
    if (entryType === 'booking') kind = 'Job';
    if (entryType === 'casting' || entryType === 'gosee') kind = 'Casting';
    const isJobConfirmed = calendar_entry?.status === 'booked';

    let color = '#1565C0'; // blue for options
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
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>Calendar</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          {!canAddManualEvents && (
            <Text style={{ ...typography.body, fontSize: 12, color: colors.textSecondary, marginRight: spacing.sm }}>Sign in to save your own events</Text>
          )}
          <TouchableOpacity
            style={[styles.filterPill, { paddingHorizontal: spacing.sm }, !canAddManualEvents && { opacity: 0.6 }]}
            onPress={onAddEvent}
            disabled={!canAddManualEvents}
          >
            <Text style={styles.filterPillLabel}>+ Add event</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.filterTrigger} onPress={onRefresh}>
            <Text style={styles.filterTriggerLabel}>
              {loading ? 'Loading…' : 'Refresh'}
            </Text>
          </TouchableOpacity>
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
        <View style={[styles.projectRow, { marginBottom: spacing.sm }]}>
          <Text style={styles.sectionLabel}>Tag: {selectedDate}</Text>
          <TouchableOpacity
            style={[styles.filterPill, { alignSelf: 'flex-start', marginTop: spacing.xs }]}
            onPress={onAddEvent}
            disabled={!canAddManualEvents}
          >
            <Text style={styles.filterPillLabel}>+ Event on this day</Text>
          </TouchableOpacity>
          {(eventsByDate[selectedDate] ?? []).length === 0 ? (
            <Text style={{ ...typography.body, fontSize: 12, color: colors.textSecondary, marginTop: spacing.xs }}>No entries on this day.</Text>
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
                <Text style={styles.metaText}>{ev.title}</Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      )}

      {sorted.length === 0 && sortedManual.length === 0 && !loading && (
        <Text style={{ ...typography.body, fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm }}>
          No calendar entries yet. Add your own events or wait for confirmed options/jobs.
        </Text>
      )}

      <ScrollView style={{ flex: 1 }}>
        {sortedManual.map((ev) => (
          <TouchableOpacity
            key={ev.id}
            style={styles.projectRow}
            onPress={() => onOpenManualEvent(ev)}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
              <Text style={styles.projectName}>{ev.title} · {ev.date}</Text>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: ev.color }} />
            </View>
            <Text style={styles.metaText}>
              {ev.start_time || '—'}{ev.end_time ? ` – ${ev.end_time}` : ''}
              {ev.note ? ` · ${ev.note}` : ''}
            </Text>
          </TouchableOpacity>
        ))}
        {sorted.map((item) => {
          const { option, calendar_entry } = item;
          const date = calendar_entry?.date ?? option.requested_date;
          const start = calendar_entry?.start_time ?? option.start_time ?? undefined;
          const end = calendar_entry?.end_time ?? option.end_time ?? undefined;
          return (
            <TouchableOpacity
              key={option.id}
              style={styles.projectRow}
              onPress={() => onOpenDetails(item)}
            >
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: spacing.xs,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.projectName}>
                    {option.model_name ?? 'Model'} · {date}
                  </Text>
                  <Text style={styles.metaText}>
                    {option.client_name ?? 'Client'}
                    {start ? ` · ${start}${end ? `–${end}` : ''}` : ''}
                  </Text>
                  {option.client_organization_id && assignmentByClientOrgId[option.client_organization_id] ? (
                    <Text style={styles.metaText}>
                      {assignmentByClientOrgId[option.client_organization_id].label}
                      {assignmentByClientOrgId[option.client_organization_id].assignedMemberName
                        ? ` · ${assignmentByClientOrgId[option.client_organization_id].assignedMemberName}`
                        : ''}
                    </Text>
                  ) : null}
                </View>
                {renderBadge(item)}
              </View>
              {calendar_entry?.booking_details && (
                <Text
                  style={{
                    ...typography.body,
                    fontSize: 11,
                    color: colors.textSecondary,
                    marginTop: 2,
                  }}
                  numberOfLines={2}
                >
                  {(calendar_entry.booking_details as any).client_notes ??
                    (calendar_entry.booking_details as any).agency_notes ??
                    (calendar_entry.booking_details as any).model_notes ??
                    ''}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

/** Displays the client's active option requests grouped by status. */
const ActiveOptionsView: React.FC<{
  onClose: () => void;
  assignmentByClientOrgId?: Record<string, ClientAssignmentFlag>;
}> = ({ onClose, assignmentByClientOrgId = {} }) => {
  const [requests, setRequests] = React.useState(getOptionRequests());
  const copy = uiCopy.dashboard;

  React.useEffect(() => {
    setRequests(getOptionRequests());
    const unsub = subscribe(() => setRequests(getOptionRequests()));
    return unsub;
  }, []);

  const grouped = React.useMemo(() => {
    const negotiating = requests.filter((r) => r.status === 'in_negotiation');
    const confirmed   = requests.filter((r) => r.status === 'confirmed');
    const rejected    = requests.filter((r) => r.status === 'rejected');
    return { negotiating, confirmed, rejected };
  }, [requests]);

  const renderRow = (r: ReturnType<typeof getOptionRequests>[0]) => (
    <View key={r.threadId} style={{
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border,
    }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textPrimary }}>{r.modelName}</Text>
        {r.date ? <Text style={{ fontSize: 11, color: colors.textSecondary }}>{r.date}</Text> : null}
        {r.clientOrganizationId && assignmentByClientOrgId[r.clientOrganizationId] ? (
          <Text style={{ fontSize: 10, color: colors.textSecondary, marginTop: 2 }}>
            {assignmentByClientOrgId[r.clientOrganizationId].label}
            {assignmentByClientOrgId[r.clientOrganizationId].assignedMemberName
              ? ` · ${assignmentByClientOrgId[r.clientOrganizationId].assignedMemberName}`
              : ''}
          </Text>
        ) : null}
      </View>
      <View style={{
        backgroundColor: r.status === 'confirmed' ? '#dcfce7' : r.status === 'rejected' ? '#fee2e2' : '#fef3c7',
        borderRadius: 6, paddingHorizontal: spacing.sm, paddingVertical: 2,
      }}>
        <Text style={{
          fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5,
          color: r.status === 'confirmed' ? '#16a34a' : r.status === 'rejected' ? '#dc2626' : '#92400e',
        }}>
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
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={{ fontSize: 18, color: colors.textPrimary, marginRight: spacing.md }}>‹</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.textPrimary }}>{copy.activeOptionsTitle}</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.md }}>
        {requests.length === 0 && (
          <Text style={{ fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xl }}>
            {copy.activeOptionsEmpty}
          </Text>
        )}
        {grouped.negotiating.length > 0 && (
          <View style={{ marginBottom: spacing.md }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm }}>
              {copy.optionRequestStatusInNegotiation} ({grouped.negotiating.length})
            </Text>
            {grouped.negotiating.map(renderRow)}
          </View>
        )}
        {grouped.confirmed.length > 0 && (
          <View style={{ marginBottom: spacing.md }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: colors.accentGreen, textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm }}>
              {copy.optionRequestStatusConfirmed} ({grouped.confirmed.length})
            </Text>
            {grouped.confirmed.map(renderRow)}
          </View>
        )}
        {grouped.rejected.length > 0 && (
          <View style={{ marginBottom: spacing.md }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm }}>
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
  onDeleteProject: (id: string) => void;
  onOpenDetails: (id: string) => void;
  onOpenProject: (id: string) => void;
  onOpenOverview: (id: string) => void;
  onShareFolder: (project: Project) => void;
  onOpenOptionChat: (threadId: string) => void;
};

const ProjectsView: React.FC<ProjectsProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  newProjectName,
  setNewProjectName,
  onCreateProject,
  onDeleteProject,
  onOpenProject,
  onOpenOverview,
  onShareFolder,
  onOpenOptionChat,
}) => {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>My Projects</Text>
      </View>

      <View style={styles.newProjectRow}>
        <TextInput
          value={newProjectName}
          onChangeText={setNewProjectName}
          placeholder="New project, e.g. Zalando HW26"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />
        <TouchableOpacity style={styles.primaryButton} onPress={onCreateProject}>
          <Text style={styles.primaryLabel}>Create</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.projectsList}>
        {projects.map((p) => (
          <View
            key={p.id}
            style={[
              styles.projectCard,
              activeProjectId === p.id && styles.projectCardActive,
            ]}
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
              <TouchableOpacity
                style={styles.projectActionBtn}
                onPress={() => onOpenProject(p.id)}
              >
                <Text style={styles.projectActionBtnLabel}>{uiCopy.projects.open}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.projectActionBtn, styles.projectActionBtnSecondary]}
                onPress={() => onOpenOverview(p.id)}
              >
                <Text style={[styles.projectActionBtnLabel, styles.projectActionBtnLabelSecondary]}>
                  {uiCopy.projects.overview}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.projectSecondaryActions}>
              {p.models.length > 0 && (
                <TouchableOpacity onPress={() => onShareFolder(p)}>
                  <Text style={styles.shareFolderLabel}>Share folder</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={(e) => { e.stopPropagation(); onDeleteProject(p.id); }}
              >
                <Text style={styles.deleteProjectLabel}>Delete</Text>
              </TouchableOpacity>
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
                    <Text style={styles.projectOptionChatText}>{r.modelName} · {r.date}</Text>
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
            <Text style={styles.emptyCopy}>
              Create a project and add models from Discover.
            </Text>
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
};

const ProjectOverviewView: React.FC<ProjectOverviewProps> = ({
  project,
  onBack,
  onRemoveModel,
}) => {
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [errorId, setErrorId] = useState<string | null>(null);

  const handleDelete = async (modelId: string) => {
    if (!project) return;
    const confirmed =
      typeof window !== 'undefined'
        ? window.confirm(uiCopy.projects.deleteFromProjectConfirm)
        : true;
    if (!confirmed) return;
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
    <View style={styles.section}>
      <View style={styles.overviewHeader}>
        <TouchableOpacity onPress={onBack} style={styles.overviewBackBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.overviewBackLabel}>{uiCopy.projects.back}</Text>
        </TouchableOpacity>
        <Text style={styles.overviewTitle}>{project.name}</Text>
      </View>

      <ScrollView style={styles.overviewList}>
        {project.models.length === 0 && (
          <View style={styles.emptyProjects}>
            <Text style={styles.emptyCopy}>{uiCopy.projects.emptyOverview}</Text>
          </View>
        )}
        {project.models.map((m) => (
          <View key={m.id} style={styles.overviewModelRow}>
            <StorageImage
              uri={m.coverUrl || undefined}
              style={styles.overviewModelImage}
              resizeMode="cover"
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
              {m.city ? <Text style={styles.overviewModelCity}>{m.city}</Text> : null}
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
        ))}
      </ScrollView>
    </View>
  );
};

const AgenciesView: React.FC<{
  clientUserId: string | null;
  onChatStarted: (conversationId: string, agencyName: string) => void;
}> = ({ clientUserId, onChatStarted }) => {
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
        (a.focus && a.focus.toLowerCase().includes(q))
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
    <View style={styles.section}>
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
      <Text style={{ ...typography.label, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.xs }}>
        {uiCopy.b2bChat.agencyTypeFilterLabel}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
        {AGENCY_SEGMENT_TYPES.map((seg) => {
          const on = agencyTypeFilter.includes(seg);
          return (
            <TouchableOpacity
              key={seg}
              style={[styles.filterPill, on && { borderColor: colors.accentGreen, backgroundColor: colors.surface }]}
              onPress={() => {
                setAgencyTypeFilter((prev) => (on ? prev.filter((x) => x !== seg) : [...prev, seg]));
              }}
            >
              <Text style={[styles.filterPillLabel, on && { color: colors.accentGreen }]}>{seg}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {showNotFound && (
        <View style={{ padding: spacing.md, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.md }}>
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
            <Text style={{ ...typography.body, fontSize: 12, color: colors.accentGreen, marginTop: spacing.xs }}>{invitationFeedback}</Text>
          ) : null}
        </View>
      )}

      <ScrollView style={{ flex: 1 }}>
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
                <TouchableOpacity style={styles.agencyContactLink} onPress={() => Linking.openURL(`mailto:${a.email || 'contact@agency.com'}`)}>
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

function attentionLabelForClient(state: SmartAttentionState): string {
  switch (state) {
    case 'waiting_for_client':
      return uiCopy.dashboard.smartAttentionWaitingForClient;
    case 'job_confirmation_pending':
      return uiCopy.dashboard.smartAttentionJobConfirmationPending;
    case 'waiting_for_model':
      return uiCopy.dashboard.smartAttentionWaitingForModel;
    case 'counter_pending':
      return uiCopy.dashboard.smartAttentionCounterPending;
    case 'conflict_risk':
      return uiCopy.dashboard.smartAttentionConflictRisk;
    case 'waiting_for_agency':
      return uiCopy.dashboard.smartAttentionWaitingForAgency;
    case 'no_attention':
    default:
      return uiCopy.dashboard.smartAttentionNoAttention;
  }
}

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
};

const ClientB2BChatsPanel: React.FC<{
  clientUserId: string;
  pendingOpen?: { conversationId: string; title: string } | null;
  onPendingConsumed?: () => void;
  onBookingCardPress?: (meta: Record<string, unknown>) => void;
  onPackagePress?: (meta: Record<string, unknown>) => void;
  onOpenRelatedRequest?: (optionRequestId: string) => void;
  searchQuery?: string;
}> = ({
  clientUserId,
  pendingOpen,
  onPendingConsumed,
  onBookingCardPress,
  onPackagePress,
  onOpenRelatedRequest,
  searchQuery = '',
}) => {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const b2bWebSplit = Platform.OS === 'web' && shouldUseB2BWebSplit(windowWidth);
  const threadListScrollMax = b2bWebSplit
    ? getThreadListMaxHeightSplit(windowHeight)
    : getThreadListMaxHeight(windowHeight);
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

  if (orgLoading) {
    return <Text style={styles.metaText}>{uiCopy.b2bChat.clientWorkspaceLoading}</Text>;
  }

  if (!clientOrgId) {
    return <Text style={styles.metaText}>{uiCopy.b2bChat.noClientWorkspaceForB2B}</Text>;
  }

  const selectedRow = selectedId ? rows.find((r) => r.id === selectedId) : undefined;
  const activeConversationId = selectedRow?.id ?? selectedId ?? null;
  const messengerTitle =
    (activeConversationId &&
      (titles[activeConversationId] ?? optimisticThreadTitle ?? null)) ??
    uiCopy.b2bChat.chatPartnerFallback;

  const filteredRows = searchQuery.trim()
    ? rows.filter((c) => (titles[c.id] ?? '').toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : rows;

  if (rows.length === 0 && !activeConversationId) {
    return <Text style={styles.metaText}>{uiCopy.b2bChat.noAgencyChatsYetClient}</Text>;
  }

  const threadListEl =
    filteredRows.length > 0 ? (
      <ScrollView style={{ maxHeight: threadListScrollMax }}>
        {filteredRows.map((c) => (
          <TouchableOpacity
            key={c.id}
            style={[styles.threadRow, selectedId === c.id && styles.threadRowActive]}
            onPress={() => setSelectedId(c.id)}
          >
            <View style={styles.threadRowLeft}>
              <Text style={styles.threadTitle}>{titles[c.id] ?? uiCopy.b2bChat.chatPartnerFallback}</Text>
              <Text style={styles.metaText}>{new Date(c.updated_at).toLocaleString()}</Text>
            </View>
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
      containerStyle={b2bWebSplit ? { marginTop: 0, flex: 1 } : { marginTop: spacing.md }}
      onBookingCardPress={onBookingCardPress}
      onPackagePress={onPackagePress}
      onOpenRelatedRequest={onOpenRelatedRequest}
      onOrgPress={targetAgencyOrgId ? () => {
        void (async () => {
          const agencyId = await getAgencyIdForOrganization(targetAgencyOrgId);
          setViewingAgencyProfileState({
            orgId: targetAgencyOrgId,
            agencyId,
            orgName: messengerTitle,
          });
        })();
      } : undefined}
    />
  ) : null;

  return (
    <View style={{ marginTop: spacing.sm }}>
      {b2bWebSplit ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
          <View style={{ flex: CHAT_THREAD_LIST_FLEX, minWidth: 0 }}>{threadListEl}</View>
          <View style={{ flex: CHAT_MESSENGER_FLEX, minWidth: 0 }}>{messengerEl}</View>
        </View>
      ) : (
        <>
          {threadListEl}
          {messengerEl}
        </>
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
}) => {
  const { height: messagesViewWindowHeight } = useWindowDimensions();
  const legacyChatPanelMessagesMaxHeight = getLegacyChatPanelMessagesMaxHeight(messagesViewWindowHeight);
  const [clientMsgTab, setClientMsgTab] = useState<'b2bChats' | 'optionRequests'>('b2bChats');
  const [clientMsgSearch, setClientMsgSearch] = useState('');
  const [requests, setRequests] = useState(getOptionRequests());
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [agencyCounterInput, setAgencyCounterInput] = useState('');
  const [openOrgChatBusy, setOpenOrgChatBusy] = useState(false);
  const [localPendingB2BChat, setLocalPendingB2BChat] = useState<{ conversationId: string; title: string } | null>(null);
  const [assignmentFilters, setAssignmentFilters] = useState<AssignmentFilters>({
    scope: 'all',
    flagLabel: 'all',
    assignedMemberUserId: 'all',
  });
  const [attentionFilter, setAttentionFilter] = useState<'all' | 'action_required'>('all');
  const [editingAssignmentThreadId, setEditingAssignmentThreadId] = useState<string | null>(null);
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => {
    // Seed from localStorage for instant display before the server load completes.
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem('ci_archived_threads');
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
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

  useEffect(() => {
    if (openThreadId) {
      setSelectedThreadId(openThreadId);
      onClearOpenThreadId();
    }
  }, [openThreadId, onClearOpenThreadId]);

  useEffect(() => {
    if (selectedThreadId) {
      refreshOptionRequestInCache(selectedThreadId);
      loadMessagesForThread(selectedThreadId);
    }
  }, [selectedThreadId]);

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

  const visibleRequests = requests.filter((r) => {
    if (msgFilter === 'archived' ? !archivedIds.has(r.threadId) : archivedIds.has(r.threadId)) return false;
    if (clientMsgSearch.trim()) {
      const q = clientMsgSearch.trim().toLowerCase();
      return (r.modelName ?? '').toLowerCase().includes(q) || (r.clientName ?? '').toLowerCase().includes(q);
    }
    const assignment = r.clientOrganizationId ? assignmentByClientOrgId[r.clientOrganizationId] : undefined;
    if (assignmentFilters.scope === 'mine' && assignment?.assignedMemberUserId !== currentUserId) return false;
    if (assignmentFilters.scope === 'unassigned' && !!assignment?.assignedMemberUserId) return false;
    if (assignmentFilters.flagLabel !== 'all' && (assignment?.label ?? '').toLowerCase() !== assignmentFilters.flagLabel.toLowerCase()) return false;
    if (assignmentFilters.assignedMemberUserId !== 'all' && assignment?.assignedMemberUserId !== assignmentFilters.assignedMemberUserId) return false;
    if (attentionFilter === 'action_required') {
      const state = deriveSmartAttentionState({
        status: r.status,
        finalStatus: r.finalStatus ?? null,
        clientPriceStatus: r.clientPriceStatus ?? null,
        modelApproval: r.modelApproval,
        modelAccountLinked: r.modelAccountLinked ?? true,
      });
      if (!smartAttentionVisibleForRole(state, 'client')) return false;
    }
    return true;
  });

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
    addMessage(selectedThreadId, isAgency ? 'agency' : 'client', text);
    setChatInput('');
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
        showAppAlert(uiCopy.b2bChat.chatFailedTitle, result.reason || uiCopy.b2bChat.chatFailedGeneric);
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

  const showClientMessagesTabs = !isAgency && !!clientUserId;

  return (
    <View style={styles.section}>
      {showClientMessagesTabs && (
        <TextInput
          value={clientMsgSearch}
          onChangeText={setClientMsgSearch}
          placeholder={uiCopy.messages.searchPlaceholderClient}
          placeholderTextColor={colors.textSecondary}
          style={[styles.searchInput, { marginBottom: spacing.sm }]}
          multiline={false}
          numberOfLines={1}
          returnKeyType="search"
        />
      )}
      {showClientMessagesTabs && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md }}>
          <TouchableOpacity
            style={[styles.filterPill, clientMsgTab === 'b2bChats' && styles.filterPillActive]}
            onPress={() => setClientMsgTab('b2bChats')}
          >
            <Text style={[styles.filterPillLabel, clientMsgTab === 'b2bChats' && styles.filterPillLabelActive]}>
              {uiCopy.b2bChat.tabB2BChatsClientView}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterPill, clientMsgTab === 'optionRequests' && styles.filterPillActive]}
            onPress={() => setClientMsgTab('optionRequests')}
          >
            <Text style={[styles.filterPillLabel, clientMsgTab === 'optionRequests' && styles.filterPillLabelActive]}>
              {uiCopy.b2bChat.tabOptionRequests}
            </Text>
          </TouchableOpacity>
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
            setSelectedThreadId(optionRequestId);
            setClientMsgTab('optionRequests');
          }}
          onBookingCardPress={onBookingCardPress}
          onPackagePress={onPackagePress}
          searchQuery={clientMsgSearch}
        />
      ) : (
        <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
        <Text style={styles.sectionLabel}>Messages</Text>
        {onMsgFilterChange && (
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {(['current', 'archived'] as const).map((f) => (
              <TouchableOpacity
                key={f}
                style={[styles.filterPill, msgFilter === f && styles.filterPillActive]}
                onPress={() => onMsgFilterChange(f)}
              >
                <Text style={[styles.filterPillLabel, msgFilter === f && styles.filterPillLabelActive]}>
                  {f === 'current' ? 'Current' : 'Archived'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
        <TouchableOpacity
          style={[styles.filterPill, attentionFilter === 'all' && styles.filterPillActive]}
          onPress={() => setAttentionFilter('all')}
        >
          <Text style={[styles.filterPillLabel, attentionFilter === 'all' && styles.filterPillLabelActive]}>
            {uiCopy.dashboard.smartAttentionFilterAll}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterPill, attentionFilter === 'action_required' && styles.filterPillActive]}
          onPress={() => setAttentionFilter('action_required')}
        >
          <Text style={[styles.filterPillLabel, attentionFilter === 'action_required' && styles.filterPillLabelActive]}>
            {uiCopy.dashboard.smartAttentionFilterActionRequired}
          </Text>
        </TouchableOpacity>
      </View>
      {Object.keys(assignmentByClientOrgId).length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
          {(['all', 'mine', 'unassigned'] as const).map((scope) => (
            <TouchableOpacity
              key={scope}
              style={[styles.filterPill, assignmentFilters.scope === scope && styles.filterPillActive]}
              onPress={() => setAssignmentFilters((prev) => ({ ...prev, scope }))}
            >
              <Text style={[styles.filterPillLabel, assignmentFilters.scope === scope && styles.filterPillLabelActive]}>
                {scope === 'all' ? 'All clients' : scope === 'mine' ? 'My clients' : 'Unassigned'}
              </Text>
            </TouchableOpacity>
          ))}
          {['all', ...Array.from(new Set(Object.values(assignmentByClientOrgId).map((a) => a.label.toLowerCase())))]
            .slice(0, 6)
            .map((flagLabel) => (
              <TouchableOpacity
                key={`flag-${flagLabel}`}
                style={[styles.filterPill, assignmentFilters.flagLabel === flagLabel && styles.filterPillActive]}
                onPress={() => setAssignmentFilters((prev) => ({ ...prev, flagLabel }))}
              >
                <Text style={[styles.filterPillLabel, assignmentFilters.flagLabel === flagLabel && styles.filterPillLabelActive]}>
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
                style={[styles.filterPill, assignmentFilters.assignedMemberUserId === userId && styles.filterPillActive]}
                onPress={() => setAssignmentFilters((prev) => ({ ...prev, assignedMemberUserId: userId }))}
              >
                <Text style={[styles.filterPillLabel, assignmentFilters.assignedMemberUserId === userId && styles.filterPillLabelActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      <ScrollView style={styles.threadList}>
        {visibleRequests.length === 0 ? (
          <Text style={styles.metaText}>{msgFilter === 'archived' ? 'No archived messages.' : 'No messages.'}</Text>
        ) : (
          visibleRequests.map((r) => {
            const reqStatus = getRequestStatus(r.threadId) ?? r.status;
            const isArchived = archivedIds.has(r.threadId);
            const assignment = r.clientOrganizationId ? assignmentByClientOrgId[r.clientOrganizationId] : undefined;
            const attentionState = deriveSmartAttentionState({
              status: r.status,
              finalStatus: r.finalStatus ?? null,
              clientPriceStatus: r.clientPriceStatus ?? null,
              modelApproval: r.modelApproval,
              modelAccountLinked: r.modelAccountLinked ?? true,
            });
            const showAttention = smartAttentionVisibleForRole(attentionState, 'client');
            return (
              <TouchableOpacity
                key={r.threadId}
                style={[styles.threadRow, selectedThreadId === r.threadId && styles.threadRowActive]}
                onPress={() => setSelectedThreadId(r.threadId)}
              >
                <View style={styles.threadRowLeft}>
                  <Text style={styles.threadTitle}>{r.modelName} · {r.date}</Text>
                  <Text style={styles.metaText}>{r.clientName}{r.startTime ? ` · ${r.startTime}–${r.endTime}` : ''}</Text>
                  {assignment ? (
                    <Text style={styles.metaText}>
                      {assignment.label}
                      {assignment.assignedMemberName ? ` · ${assignment.assignedMemberName}` : ''}
                    </Text>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  {showAttention ? (
                    <View style={[styles.statusPill, { backgroundColor: '#dbeafe' }]}>
                      <Text style={[styles.statusPillLabel, { color: '#1d4ed8' }]}>
                        {attentionLabelForClient(attentionState)}
                      </Text>
                    </View>
                  ) : null}
                  {r.modelAccountLinked === false ? (
                    <Text style={{ ...typography.label, fontSize: 9, color: colors.textSecondary }}>
                      {uiCopy.dashboard.optionRequestModelApprovalNoApp}
                    </Text>
                  ) : r.modelApproval === 'approved' ? (
                    <Text style={{ ...typography.label, fontSize: 9, color: colors.buttonOptionGreen }}>
                      {uiCopy.dashboard.optionRequestModelApprovalApproved}
                    </Text>
                  ) : null}
                  <View style={[styles.statusPill, { backgroundColor: STATUS_COLORS[reqStatus] }]}>
                    <Text style={styles.statusPillLabel}>{STATUS_LABELS[reqStatus]}</Text>
                  </View>
                  <TouchableOpacity onPress={() => toggleArchive(r.threadId)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={{ fontSize: 12, color: colors.textSecondary }}>{isArchived ? '↩' : '📦'}</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {request && (
        <View style={styles.chatPanel}>
          <View style={styles.chatPanelHeader}>
            <Text style={styles.chatPanelTitle}>{request.modelName} · {request.date}</Text>
            {isAgency ? (
              <View style={styles.statusDropdownWrap}>
                <Text style={styles.metaText}>Status: </Text>
                <TouchableOpacity
                  style={[styles.statusPill, { backgroundColor: status ? STATUS_COLORS[status] : colors.border }]}
                  onPress={() => setStatusDropdownOpen(true)}
                >
                  <Text style={styles.statusPillLabel}>{status ? STATUS_LABELS[status] : '—'}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={[styles.statusPill, status && { backgroundColor: STATUS_COLORS[status] }]}>
                <Text style={styles.statusPillLabel}>{status ? STATUS_LABELS[status] : '—'}</Text>
              </View>
            )}
          </View>
          {request.clientOrganizationId && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
              {assignmentByClientOrgId[request.clientOrganizationId] ? (
                <Text style={styles.metaText}>
                  Client flag: {assignmentByClientOrgId[request.clientOrganizationId].label}
                  {assignmentByClientOrgId[request.clientOrganizationId].assignedMemberName
                    ? ` · ${assignmentByClientOrgId[request.clientOrganizationId].assignedMemberName}`
                    : ''}
                </Text>
              ) : (
                <Text style={styles.metaText}>Client flag: none</Text>
              )}
              {isAgency && onSaveClientAssignment && (
                <TouchableOpacity
                  style={styles.filterPill}
                  onPress={() => setEditingAssignmentThreadId((prev) => (prev === request.threadId ? null : request.threadId))}
                >
                  <Text style={styles.filterPillLabel}>Edit</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {isAgency && onSaveClientAssignment && request.clientOrganizationId && editingAssignmentThreadId === request.threadId && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
              {(['gray', 'blue', 'green', 'amber', 'purple', 'red'] as AssignmentFlagColor[]).map((color) => (
                <TouchableOpacity
                  key={color}
                  style={styles.filterPill}
                  onPress={() => {
                    void onSaveClientAssignment(request.clientOrganizationId!, {
                      label: color.toUpperCase(),
                      color,
                      assignedMemberUserId: assignmentByClientOrgId[request.clientOrganizationId!]?.assignedMemberUserId ?? null,
                    });
                    setEditingAssignmentThreadId(null);
                  }}
                >
                  <Text style={styles.filterPillLabel}>{color}</Text>
                </TouchableOpacity>
              ))}
              {assignableMembers.slice(0, 6).map((member) => (
                <TouchableOpacity
                  key={member.userId}
                  style={styles.filterPill}
                  onPress={() => {
                    const current = assignmentByClientOrgId[request.clientOrganizationId!];
                    void onSaveClientAssignment(request.clientOrganizationId!, {
                      label: current?.label ?? 'BLUE',
                      color: current?.color ?? 'blue',
                      assignedMemberUserId: member.userId,
                    });
                    setEditingAssignmentThreadId(null);
                  }}
                >
                  <Text style={styles.filterPillLabel}>{member.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
            <View style={[styles.statusPill, { backgroundColor: '#e0e7ff' }]}>
              <Text style={[styles.statusPillLabel, { color: '#3730a3' }]}>{uiCopy.b2bChat.contextNegotiationThread}</Text>
            </View>
            <TouchableOpacity
              style={[styles.filterPill, openOrgChatBusy && { opacity: 0.6 }]}
              disabled={openOrgChatBusy || !request.agencyId || !request.clientOrganizationId}
              onPress={() => { void openOrgChatFromRequest(); }}
            >
              <Text style={styles.filterPillLabel}>
                {openOrgChatBusy ? uiCopy.common.loading : uiCopy.b2bChat.openOrgChat}
              </Text>
            </TouchableOpacity>
          </View>
          {request.proposedPrice != null && isAgency && (
            <Text style={{ ...typography.label, fontSize: 10, color: colors.accentBrown, marginBottom: spacing.xs }}>
              Proposed price: {request.currency === 'USD' ? '$' : request.currency === 'GBP' ? '£' : request.currency === 'CHF' ? 'CHF ' : '€'}{request.proposedPrice}
            </Text>
          )}
          {request.modelAccountLinked === false && (
            <View style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, marginBottom: spacing.sm, backgroundColor: 'rgba(100,100,100,0.12)', borderRadius: 8 }}>
              <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary }}>
                {uiCopy.dashboard.optionRequestFinalStatusNoModelAppHint}
              </Text>
            </View>
          )}
          {finalStatus && (
            <View style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, marginBottom: spacing.sm, backgroundColor: finalStatus === 'job_confirmed' ? 'rgba(0,120,0,0.15)' : finalStatus === 'option_confirmed' ? 'rgba(0,80,200,0.12)' : 'rgba(120,120,0,0.12)', borderRadius: 8 }}>
              <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary }}>
                {request.requestType === 'casting' ? uiCopy.dashboard.threadContextCasting : uiCopy.dashboard.threadContextOption} - {finalStatus === 'job_confirmed' ? uiCopy.dashboard.optionRequestStatusJobConfirmed : finalStatus === 'option_confirmed' ? uiCopy.dashboard.optionRequestStatusConfirmed : uiCopy.dashboard.optionRequestStatusPending}
              </Text>
            </View>
          )}
          {isAgency && request.modelApproval === 'approved' && clientPriceStatus === 'pending' && finalStatus !== 'job_confirmed' && request.proposedPrice != null && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm }}>
              <TouchableOpacity
                style={[styles.filterPill, { backgroundColor: colors.buttonOptionGreen }]}
                onPress={async () => {
                  if (request?.threadId) {
                    await agencyAcceptClientPriceStore(request.threadId);
                    setRequests(getOptionRequests());
                  }
                }}
              >
                <Text style={[styles.filterPillLabel, { color: '#fff' }]}>Accept client price</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterPill, { borderWidth: 1, borderColor: colors.buttonSkipRed }]}
                onPress={async () => {
                  if (request?.threadId) {
                    await agencyRejectClientPriceStore(request.threadId);
                    setRequests(getOptionRequests());
                  }
                }}
              >
                <Text style={[styles.filterPillLabel, { color: colors.buttonSkipRed }]}>Reject client price</Text>
              </TouchableOpacity>
            </View>
          )}
          {isAgency && request.modelApproval === 'approved' && clientPriceStatus === 'rejected' && finalStatus !== 'job_confirmed' && (
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
                  style={[styles.chatPanelInput, { flex: 1, minWidth: 120 }]}
                />
                <TouchableOpacity
                  style={[styles.filterPill, { paddingHorizontal: spacing.sm, backgroundColor: colors.textPrimary }]}
                  onPress={async () => {
                    const num = parseFloat(agencyCounterInput.trim());
                    if (!request?.threadId || isNaN(num)) return;
                    await agencyCounterOfferStore(request.threadId, num, currency);
                    setAgencyCounterInput('');
                    setRequests(getOptionRequests());
                  }}
                >
                  <Text style={[styles.filterPillLabel, { color: '#fff' }]}>Send counter-offer</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {isAgency && request.modelApproval === 'approved' && clientPriceStatus === 'pending' && finalStatus !== 'job_confirmed' && request.proposedPrice == null && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm, alignItems: 'center' }}>
              <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary }}>Propose a fee (optional)</Text>
              <TextInput
                value={agencyCounterInput}
                onChangeText={setAgencyCounterInput}
                placeholder="Amount"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                style={[styles.chatPanelInput, { width: 100 }]}
              />
              <TouchableOpacity
                style={[styles.filterPill, { paddingHorizontal: spacing.sm }]}
                onPress={async () => {
                  const num = parseFloat(agencyCounterInput.trim());
                  if (!request?.threadId || isNaN(num)) return;
                  await agencyCounterOfferStore(request.threadId, num, currency);
                  setAgencyCounterInput('');
                  setRequests(getOptionRequests());
                }}
              >
                <Text style={styles.filterPillLabel}>Send offer</Text>
              </TouchableOpacity>
            </View>
          )}
          {!isAgency && agencyCounterPrice != null && clientPriceStatus === 'pending' && finalStatus !== 'job_confirmed' && (
            <TouchableOpacity
              style={[styles.filterPill, { marginBottom: spacing.sm, backgroundColor: colors.buttonOptionGreen }]}
              onPress={async () => {
                if (request?.threadId) {
                  await clientAcceptCounterStore(request.threadId);
                  setRequests(getOptionRequests());
                }
              }}
            >
              <Text style={[styles.filterPillLabel, { color: '#fff' }]}>Accept agency proposal ({currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency === 'CHF' ? 'CHF ' : '€'}{agencyCounterPrice})</Text>
            </TouchableOpacity>
          )}
          {!isAgency && finalStatus === 'option_confirmed' && request?.requestType === 'option' && (
            <TouchableOpacity
              style={[styles.filterPill, { marginBottom: spacing.sm, backgroundColor: colors.accentBrown }]}
              onPress={async () => {
                if (request?.threadId) {
                  await clientConfirmJobStore(request.threadId);
                  setRequests(getOptionRequests());
                }
              }}
            >
              <Text style={[styles.filterPillLabel, { color: '#fff' }]}>Confirm job</Text>
            </TouchableOpacity>
          )}
          <ScrollView style={[styles.chatPanelMessages, { maxHeight: legacyChatPanelMessagesMaxHeight }]}>
            {messages.map((msg) => (
              <View
                key={msg.id}
                style={[styles.chatBubble, msg.from === (isAgency ? 'agency' : 'client') ? styles.chatBubbleSelf : styles.chatBubbleOther]}
              >
                <Text style={[styles.chatBubbleText, msg.from === (isAgency ? 'agency' : 'client') && styles.chatBubbleTextSelf]}>
                  {msg.text}
                </Text>
              </View>
            ))}
          </ScrollView>
          <View style={styles.chatPanelInputRow}>
            <TextInput
              value={chatInput}
              onChangeText={setChatInput}
              placeholder="Message..."
              placeholderTextColor={colors.textSecondary}
              style={styles.chatPanelInput}
            />
            <TouchableOpacity style={styles.chatPanelSend} onPress={sendMessage}>
              <Text style={styles.chatPanelSendLabel}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {request && isAgency && statusDropdownOpen && (
        <StatusDropdownOverlay
          onSelect={(s) => {
            if (request) setRequestStatus(request.threadId, s);
            setStatusDropdownOpen(false);
          }}
          onClose={() => setStatusDropdownOpen(false)}
        />
      )}
        </>
      )}
    </View>
  );
};

const StatusDropdownOverlay: React.FC<{
  onSelect: (s: ChatStatus) => void;
  onClose: () => void;
}> = ({ onSelect, onClose }) => {
  return (
    <TouchableOpacity
      style={styles.statusDropdownBackdrop}
      activeOpacity={1}
      onPress={onClose}
    >
      <View style={styles.statusDropdown}>
        {(['in_negotiation', 'confirmed', 'rejected'] as ChatStatus[]).map((s) => (
          <TouchableOpacity
            key={s}
            style={styles.statusDropdownItem}
            onPress={() => onSelect(s)}
          >
            <Text style={[styles.statusPillLabel, { color: STATUS_COLORS[s] }]}>
              {STATUS_LABELS[s]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </TouchableOpacity>
  );
};

type OptionDatePickerModalProps = {
  open: boolean;
  model: ModelSummary | null;
  onClose: () => void;
  onSubmit: (date: string, startTime: string, endTime: string, price?: number, requestType?: 'option' | 'casting', currency?: string) => void;
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
  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; });
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
  const monthLabel = new Date(calMonth.year, calMonth.month).toLocaleString('en', { month: 'long', year: 'numeric' });
  const today = new Date().toISOString().slice(0, 10);

  const prevMonth = () => setCalMonth((p) => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 });
  const nextMonth = () => setCalMonth((p) => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 });

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
      const subject = encodeURIComponent(`${requestType === 'casting' ? 'Casting' : 'Option'} Request – ${model.name} – ${selectedDate}`);
      const body = encodeURIComponent(
        `Hello,\n\nI would like to request ${requestType === 'casting' ? 'a casting' : 'an option'} for:\n\n` +
        `Model: ${model.name}\n` +
        `Date: ${selectedDate}\n` +
        `Time: ${startTime} – ${endTime}\n` +
        (requestType === 'option' && p ? `Proposed Price: ${p}\n` : '') +
        `\nPlease confirm at your earliest convenience.\n\nBest regards`
      );
      Linking.openURL(`mailto:?subject=${subject}&body=${body}`);
      onClose();
      return;
    }
    onSubmit(selectedDate, startTime, endTime, p, requestType, currency);
  };

  return (
    <View style={styles.detailOverlay}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
      <View style={[styles.optionDateCard, { maxWidth: 440, marginBottom: 100, paddingBottom: spacing.lg }]}>
        <Text style={styles.optionDateCardTitle}>{requestType === 'casting' ? 'Request casting' : 'Request option'}</Text>
        <Text style={styles.metaText}>Select date and time for {model.name}</Text>

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
          {(['option', 'casting'] as const).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.filterPill, requestType === t && styles.filterPillActive, { paddingHorizontal: spacing.md }]}
              onPress={() => setRequestType(t)}
            >
              <Text style={[styles.filterPillLabel, requestType === t && styles.filterPillLabelActive]}>{t === 'option' ? 'Option' : 'Casting'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.sm }}>
          <TouchableOpacity onPress={prevMonth}><Text style={{ fontSize: 18, color: colors.textPrimary }}>‹</Text></TouchableOpacity>
          <Text style={{ ...typography.label, color: colors.textPrimary }}>{monthLabel}</Text>
          <TouchableOpacity onPress={nextMonth}><Text style={{ fontSize: 18, color: colors.textPrimary }}>›</Text></TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row', marginBottom: 4 }}>
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
            <View key={d} style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ ...typography.label, fontSize: 9, color: colors.textSecondary }}>{d}</Text>
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
                <View style={{
                  width: 32, height: 32, borderRadius: 16,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: isSelected ? colors.accentGreen : 'transparent',
                }}>
                  <Text style={{
                    ...typography.body, fontSize: 12,
                    color: isPast ? colors.border : isSelected ? '#fff' : colors.textPrimary,
                  }}>{day}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary, marginBottom: 4 }}>From</Text>
            <ScrollView style={{ maxHeight: 100, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
              {TIME_SLOTS.map((t) => (
                <TouchableOpacity key={t} onPress={() => setStartTime(t)} style={{ padding: 6, backgroundColor: startTime === t ? colors.accentGreen : 'transparent' }}>
                  <Text style={{ ...typography.body, fontSize: 11, color: startTime === t ? '#fff' : colors.textPrimary }}>{t}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary, marginBottom: 4 }}>To</Text>
            <ScrollView style={{ maxHeight: 100, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
              {TIME_SLOTS.map((t) => (
                <TouchableOpacity key={t} onPress={() => setEndTime(t)} style={{ padding: 6, backgroundColor: endTime === t ? colors.accentGreen : 'transparent' }}>
                  <Text style={{ ...typography.body, fontSize: 11, color: endTime === t ? '#fff' : colors.textPrimary }}>{t}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>

        {requestType === 'option' && (
          <View style={{ marginTop: spacing.md }}>
            <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary, marginBottom: 4 }}>Proposed price (visible to agency only)</Text>
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
                    style={[styles.filterPill, currency === c && styles.filterPillActive, { paddingHorizontal: 8, paddingVertical: 6 }]}
                    onPress={() => setCurrency(c)}
                  >
                    <Text style={[styles.filterPillLabel, currency === c && styles.filterPillLabelActive, { fontSize: 10 }]}>
                      {c === 'EUR' ? '€' : c === 'USD' ? '$' : c === 'GBP' ? '£' : 'CHF'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        )}

        <View style={{ marginTop: spacing.md }}>
          <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary, marginBottom: 4 }}>
            Role / Job description <Text style={{ color: '#dc2626' }}>*</Text>
          </Text>
          <TextInput
            value={roleDescription}
            onChangeText={(t) => { setRoleDescription(t); setSubmitError(null); }}
            placeholder="e.g. Runway model, Photographer, Brand ambassador"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { height: 36 }]}
          />
        </View>

        {submitError ? (
          <Text style={{ fontSize: 12, color: '#dc2626', marginTop: spacing.sm }}>{submitError}</Text>
        ) : null}

        <View style={{ marginTop: spacing.md }}>
          <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary, marginBottom: 4 }}>Send via</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {(['app', 'email'] as const).map((v) => (
              <TouchableOpacity
                key={v}
                style={[styles.filterPill, sendVia === v && styles.filterPillActive, { paddingHorizontal: spacing.md }]}
                onPress={() => setSendVia(v)}
              >
                <Text style={[styles.filterPillLabel, sendVia === v && styles.filterPillLabelActive]}>
                  {v === 'app' ? 'In-App' : 'Email'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl, marginBottom: spacing.md }}>
          <TouchableOpacity onPress={onClose} style={[styles.filterPill, { flex: 1, alignItems: 'center' }]}>
            <Text style={styles.filterPillLabel}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!selectedDate || !roleDescription.trim()}
            style={[styles.primaryButton, { flex: 1, opacity: (selectedDate && roleDescription.trim()) ? 1 : 0.4 }]}
          >
            <Text style={styles.primaryLabel}>{sendVia === 'email' ? 'Open in Email' : requestType === 'casting' ? 'Send casting request' : 'Send option'}</Text>
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
  isPackageMode?: boolean;
};

const ProjectDetailView: React.FC<DetailProps> = ({
  open,
  loading,
  data,
  onClose,
  onOptionRequest,
  isPackageMode = false,
}) => {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const normalizedPortfolioUrls = useMemo(() => {
    const id = data?.id ?? '';
    const imgs = data?.portfolio?.images ?? [];
    if (!id) return imgs;
    return imgs.map((u) => normalizeDocumentspicturesModelImageRef(u, id));
  }, [data?.id, data?.portfolio?.images]);

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
          <Text style={styles.detailTitle}>
            {data ? data.name : 'Loading'}
          </Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.closeLabel}>Close</Text>
          </TouchableOpacity>
        </View>

        {loading && (
          <Text style={styles.metaText}>Loading…</Text>
        )}

        {!loading && data && (
          <ScrollView style={styles.detailScroll}>
            <View style={styles.detailMeasurementsRow}>
              <View style={styles.detailMeasureItem}>
                <Text style={styles.detailMeasureLabel}>{uiCopy.discover.detailMeasurementHeight}</Text>
                <Text style={styles.detailMeasureValue}>{data.measurements.height}</Text>
              </View>
              <View style={styles.detailMeasureItem}>
                <Text style={styles.detailMeasureLabel}>{uiCopy.discover.detailMeasurementChest}</Text>
                <Text style={styles.detailMeasureValue}>{data.measurements.chest}</Text>
              </View>
              <View style={styles.detailMeasureItem}>
                <Text style={styles.detailMeasureLabel}>{uiCopy.discover.detailMeasurementWaist}</Text>
                <Text style={styles.detailMeasureValue}>{data.measurements.waist}</Text>
              </View>
              <View style={styles.detailMeasureItem}>
                <Text style={styles.detailMeasureLabel}>{uiCopy.discover.detailMeasurementHips}</Text>
                <Text style={styles.detailMeasureValue}>{data.measurements.hips}</Text>
              </View>
            </View>

            <Text style={styles.detailSectionLabel}>Portfolio</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.detailPortfolioRow}
            >
              {normalizedPortfolioUrls.map((url, idx) => (
                <TouchableOpacity key={`${idx}-${url}`} onPress={() => setLightboxIndex(idx)} activeOpacity={0.85}>
                  <View style={{ position: 'relative', overflow: 'hidden', borderRadius: 12 }}>
                    <StorageImage
                      uri={url || undefined}
                      style={styles.detailPortfolioImage}
                      resizeMode="cover"
                      ttlSeconds={CLIENT_MODEL_IMAGE_TTL_SEC}
                      fallback={
                        <View style={[styles.detailPortfolioImage, { backgroundColor: colors.border }]} />
                      }
                    />
                    {isPackageMode && <GuestWatermark />}
                  </View>
                </TouchableOpacity>
              ))}
              {normalizedPortfolioUrls.length === 0 && (
                <Text style={styles.metaText}>No portfolio images</Text>
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
            <Text style={styles.metaText}>
              Request option for a specific date.
            </Text>
            <View style={styles.optionDatesRow}>
              {OPTION_DATES.map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[
                    styles.optionDatePill,
                    selectedDate === d && styles.optionDatePillActive,
                  ]}
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

            {confirmation && (
              <Text style={styles.confirmationText}>{confirmation}</Text>
            )}
          </ScrollView>
        )}
      </View>

      {/* Lightbox */}
      {(() => {
        const images = normalizedPortfolioUrls;
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
                {isPackageMode && <GuestWatermark />}
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
              <TouchableOpacity
                style={styles.lightboxClose}
                onPress={() => setLightboxIndex(null)}
              >
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
        <Text style={styles.metaText}>
          Choose a project for {pendingModel.name}.
        </Text>

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
  const clientIsOwner = profile?.org_member_role === 'owner';
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
        window.localStorage.setItem('ci_client_settings', JSON.stringify({
          displayName, companyName, phone, website, instagram, linkedin,
        }));
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
    Alert.alert(
      uiCopy.accountDeletion.confirmTitle,
      uiCopy.accountDeletion.confirmMessage,
      [
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
      ]
    );
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
      ]
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
              Alert.alert(uiCopy.accountDeletion.dissolveOrgTitle, uiCopy.accountDeletion.dissolveOrgSuccess);
            } else {
              Alert.alert(uiCopy.common.error, uiCopy.accountDeletion.dissolveOrgFailed);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={{
      position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.08)', justifyContent: 'center', alignItems: 'center',
      paddingHorizontal: spacing.lg, zIndex: 100,
    }}>
      <View style={{
        width: '100%', maxWidth: 520, maxHeight: '90%', borderRadius: 18,
        borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.lg,
      }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
          <Text style={{ ...typography.heading, fontSize: 16, color: colors.textPrimary }}>Settings</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ ...typography.label, fontSize: 11, color: colors.textSecondary }}>{uiCopy.common.close}</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
          {(['profile', 'team'] as const).map((t) => (
            <TouchableOpacity key={t} onPress={() => setSettingsTab(t)} style={{ paddingVertical: 4, paddingHorizontal: spacing.md, borderRadius: 999, borderWidth: 1, borderColor: settingsTab === t ? colors.textPrimary : colors.border, backgroundColor: settingsTab === t ? colors.textPrimary : 'transparent' }}>
              <Text style={{ ...typography.label, fontSize: 11, color: settingsTab === t ? colors.surface : colors.textSecondary }}>{t === 'profile' ? 'Profile' : 'Team'}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <ScrollView>
          {settingsTab === 'profile' ? (
            <>
              <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary, marginBottom: 4 }}>Display name</Text>
              <TextInput value={displayName} onChangeText={setDisplayName} placeholder="Your name" placeholderTextColor={colors.textSecondary} style={[settingsInputStyle, { marginBottom: spacing.md }]} />

              <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary, marginBottom: 4 }}>
                Company {ownerRoleLoading ? '' : clientIsOwner ? '' : <Text style={{ fontWeight: '400', color: colors.textSecondary }}>(read-only)</Text>}
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
                  <Text style={{ ...typography.body, fontSize: 13, color: colors.textPrimary }}>{companyName || '—'}</Text>
                </View>
              )}
              {!ownerRoleLoading && !clientIsOwner && (
                <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.md }}>
                  Only the organization owner can change the company name.
                </Text>
              )}
              {clientIsOwner && <View style={{ marginBottom: spacing.md }} />}

              <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary, marginBottom: 4 }}>Phone</Text>
              <TextInput value={phone} onChangeText={setPhone} placeholder="+49..." placeholderTextColor={colors.textSecondary} keyboardType="phone-pad" style={[settingsInputStyle, { marginBottom: spacing.md }]} />

              <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary, marginBottom: 4 }}>Website</Text>
              <TextInput value={website} onChangeText={setWebsite} placeholder="https://..." placeholderTextColor={colors.textSecondary} style={[settingsInputStyle, { marginBottom: spacing.md }]} />

              <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary, marginBottom: spacing.xs }}>Social links</Text>
              <TextInput value={instagram} onChangeText={setInstagram} placeholder="Instagram URL" placeholderTextColor={colors.textSecondary} style={[settingsInputStyle, { marginBottom: spacing.sm }]} />
              <TextInput value={linkedin} onChangeText={setLinkedin} placeholder="LinkedIn URL" placeholderTextColor={colors.textSecondary} style={[settingsInputStyle, { marginBottom: spacing.lg }]} />

              <TouchableOpacity onPress={() => { void handleSave(); }} disabled={saving} style={{ borderRadius: 999, backgroundColor: colors.accentGreen, paddingVertical: spacing.sm, alignItems: 'center', opacity: saving ? 0.6 : 1 }}>
                <Text style={{ ...typography.label, color: colors.surface }}>{saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save settings'}</Text>
              </TouchableOpacity>

              <View style={{ marginTop: spacing.xl, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border }}>
                {!realClientId ? (
                  <>
                    <Text style={{ ...typography.label, fontSize: 12, color: colors.textPrimary, marginBottom: 4 }}>
                      {uiCopy.accountDeletion.sectionTitle}
                    </Text>
                    <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary }}>
                      {uiCopy.accountDeletion.notAvailableSignedOut}
                    </Text>
                  </>
                ) : ownerRoleLoading ? (
                  <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary }}>{uiCopy.common.loading}</Text>
                ) : clientIsOwner ? (
                  <>
                    {/* Dissolve organization — owners only */}
                    {!orgDissolved && (
                      <View style={{ marginBottom: spacing.lg, paddingBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <Text style={{ ...typography.label, fontSize: 12, color: colors.textPrimary, marginBottom: 4 }}>
                          {uiCopy.accountDeletion.dissolveOrgTitle}
                        </Text>
                        <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm }}>
                          {uiCopy.accountDeletion.dissolveOrgDescription}
                        </Text>
                        <TouchableOpacity
                          onPress={handleDissolveOrganization}
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
                        <Text style={{ ...typography.body, fontSize: 11, color: colors.textPrimary }}>{uiCopy.accountDeletion.dissolveOrgSuccess}</Text>
                      </View>
                    )}
                    {/* Delete personal account */}
                    <Text style={{ ...typography.label, fontSize: 12, color: colors.textPrimary, marginBottom: 4 }}>
                      {uiCopy.accountDeletion.sectionTitle}
                    </Text>
                    <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm }}>
                      {uiCopy.accountDeletion.description}
                    </Text>
                    <TouchableOpacity
                      onPress={handleRequestAccountDeletion}
                      disabled={deleting}
                      style={{ borderRadius: 999, borderWidth: 1, borderColor: '#e74c3c', paddingVertical: spacing.sm, alignItems: 'center' }}
                    >
                      <Text style={{ ...typography.label, fontSize: 12, color: '#e74c3c' }}>
                        {deleting ? uiCopy.accountDeletion.buttonWorking : uiCopy.accountDeletion.button}
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    {/* Non-owner employee: personal account deletion only */}
                    <Text style={{ ...typography.label, fontSize: 12, color: colors.textPrimary, marginBottom: 4 }}>
                      {uiCopy.accountDeletion.sectionTitle}
                    </Text>
                    <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm }}>
                      {uiCopy.accountDeletion.personalDeleteDescription}
                    </Text>
                    <TouchableOpacity
                      onPress={handleRequestPersonalAccountDeletion}
                      disabled={deleting}
                      style={{ borderRadius: 999, borderWidth: 1, borderColor: '#e74c3c', paddingVertical: spacing.sm, alignItems: 'center' }}
                    >
                      <Text style={{ ...typography.label, fontSize: 12, color: '#e74c3c' }}>
                        {deleting ? uiCopy.accountDeletion.buttonWorking : uiCopy.accountDeletion.button}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}

                {/* ── GDPR Data Export + Consent Withdrawal (Art. 20 + Art. 7) ─── */}
                <View style={{ marginTop: spacing.lg, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <Text style={{ ...typography.label, fontSize: 12, color: colors.textPrimary, marginBottom: 4 }}>
                    {uiCopy.privacyData.sectionTitle}
                  </Text>
                  <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm }}>
                    {uiCopy.privacyData.art20Body}
                  </Text>
                  <TouchableOpacity
                    onPress={async () => {
                      try {
                        const { data: { user } } = await import('../../lib/supabase').then(m => m.supabase.auth.getUser());
                        if (!user) return;
                        const { downloadUserDataExport } = await import('../services/gdprComplianceSupabase');
                        const okDl = await downloadUserDataExport(user.id);
                        if (okDl) {
                          showAppAlert(uiCopy.privacyData.downloadStartedTitle, uiCopy.privacyData.downloadStartedBody);
                        } else {
                          showAppAlert(uiCopy.common.error, uiCopy.privacyData.couldNotExport);
                        }
                      } catch (e) {
                        console.error('SettingsPanel download export error:', e);
                        showAppAlert(uiCopy.common.error, uiCopy.privacyData.couldNotExport);
                      }
                    }}
                    style={{ borderRadius: 999, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.sm, alignItems: 'center', marginBottom: spacing.sm }}
                  >
                    <Text style={{ ...typography.label, fontSize: 12, color: colors.textSecondary }}>
                      {uiCopy.privacyData.downloadMyData}
                    </Text>
                  </TouchableOpacity>

                  <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm, marginTop: spacing.sm }}>
                    {uiCopy.privacyData.art7Body}
                  </Text>
                  <TouchableOpacity
                    onPress={async () => {
                      const confirmed = window?.confirm?.(uiCopy.privacyData.withdrawConfirmClientWeb);
                      if (!confirmed) return;
                      try {
                        const { withdrawConsent } = await import('../services/consentSupabase');
                        const m = await withdrawConsent('marketing', 'user_requested');
                        const a = await withdrawConsent('analytics', 'user_requested');
                        if (!m.ok || !a.ok) {
                          showAppAlert(uiCopy.common.error, uiCopy.privacyData.couldNotWithdrawConsent);
                          return;
                        }
                        void refreshProfile();
                        showAppAlert(uiCopy.privacyData.consentWithdrawnTitle, uiCopy.privacyData.consentWithdrawnBody);
                      } catch (e) {
                        console.error('SettingsPanel withdraw consent error:', e);
                        showAppAlert(uiCopy.common.error, uiCopy.privacyData.couldNotWithdrawConsent);
                      }
                    }}
                    style={{ borderRadius: 999, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.sm, alignItems: 'center' }}
                  >
                    <Text style={{ ...typography.label, fontSize: 12, color: colors.textSecondary }}>
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
  borderWidth: 1, borderColor: colors.border, borderRadius: 12,
  paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  ...typography.body, color: colors.textPrimary,
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
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  topBar: {
    marginBottom: spacing.lg,
  },
  topBarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bottomTabBar: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    maxWidth: 1200,
    width: '100%',
    alignSelf: 'center',
  },
  bottomTabItem: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    position: 'relative' as const,
  },
  bottomTabLabel: {
    ...typography.label,
    fontSize: 12,
    color: colors.textSecondary,
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
    ...typography.heading,
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
  },
  packageBannerExit: {
    ...typography.body,
    fontSize: 13,
    color: colors.accent,
    fontWeight: '600',
    marginLeft: spacing.md,
  },
  packageGrid: {
    paddingBottom: 120,
    gap: spacing.md,
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
    height: 320,
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
  },
  coverCard: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  coverImageContainer: {
    position: 'relative',
    height: 360,
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
    paddingHorizontal: spacing.lg,
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  cardButtonRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
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
    paddingHorizontal: spacing.lg,
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
    paddingHorizontal: spacing.lg,
  },
  detailCard: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '90%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
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
    width: 160,
    height: 220,
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
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
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
  overviewList: {
    flex: 1,
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
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
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
    paddingHorizontal: spacing.lg,
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
  searchInput: {
    alignSelf: 'stretch',
    width: '100%' as const,
    maxWidth: 400,
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
    marginTop: spacing.sm,
  },
  threadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  threadRowActive: {
    backgroundColor: '#F3F0EC',
  },
  threadRowLeft: {
    flex: 1,
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
  statusDropdownWrap: {
    flexDirection: 'row',
    alignItems: 'center',
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
  chatPanelInputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chatPanelInput: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    fontSize: 12,
    color: colors.textPrimary,
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
  statusDropdownBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.06)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 80,
    paddingRight: spacing.lg,
    zIndex: 10,
  },
  statusDropdown: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xs,
    minWidth: 140,
  },
  statusDropdownItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
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


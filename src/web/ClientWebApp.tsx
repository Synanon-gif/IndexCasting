import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Image,
  Modal,
  Linking,
  Alert,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { showAppAlert } from '../utils/crossPlatformAlert';
import { uiCopy } from '../constants/uiCopy';
import { useAuth } from '../context/AuthContext';
import { getModelsForClient, getModelData } from '../services/apiService';
import { getModelByIdFromSupabase, type SupabaseModel } from '../services/modelsSupabase';
import { getGuestLink } from '../services/guestLinksSupabase';
import { getAgencies, type Agency } from '../services/agenciesSupabase';
import { AGENCY_SEGMENT_TYPES } from '../constants/agencyTypes';
import { type ModelFilters, defaultModelFilters, FILTER_COUNTRIES } from '../utils/modelFilters';
import ModelFiltersPanel from '../components/ModelFiltersPanel';
import {
  getCalendarEntriesForClient,
  getBookingEventsAsCalendarEntries,
  type CalendarEntry,
  type ClientCalendarItem,
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
  hasNewMessages,
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
  getMyClientMemberRole,
  updateOrganizationName,
  getOrganizationById,
} from '../services/organizationsInvitationsSupabase';
import { supabase } from '../../lib/supabase';
import { MonthCalendarView, type CalendarDayEvent } from '../components/MonthCalendarView';
import { ClientOrganizationTeamSection } from '../components/ClientOrganizationTeamSection';
import { OrgMessengerInline } from '../components/OrgMessengerInline';

type TopTab = 'discover' | 'projects' | 'agencies' | 'messages' | 'calendar' | 'team';

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
    bust: number;
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
  clientType,
  onClientTypeChange,
  onBackToRoleSelection,
}) => {
  const [tab, setTab] = useState<TopTab>('discover');
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
    if (saved && typeof saved.size === 'string') {
      return {
        ...defaultModelFilters,
        size: saved.size,
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
  } | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [pendingModel, setPendingModel] = useState<ModelSummary | null>(null);
  const [optionDatePickerOpen, setOptionDatePickerOpen] = useState(false);
  const [optionDateModel, setOptionDateModel] = useState<ModelSummary | null>(null);
  const [openThreadIdOnMessages, setOpenThreadIdOnMessages] = useState<string | null>(null);
  const [pendingClientB2BChat, setPendingClientB2BChat] = useState<{ conversationId: string; title: string } | null>(null);
  const [hasNew, setHasNew] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [msgFilter, setMsgFilter] = useState<'current' | 'archived'>('current');
  const [userCity, setUserCity] = useState<string | null>(null);
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

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`,
            { headers: { 'Accept-Language': 'en' } },
          );
          const data = await res.json();
          const city =
            data.address?.city ||
            data.address?.town ||
            data.address?.village ||
            null;
          if (city) setUserCity(city);
        } catch {}
      },
      () => {},
      { timeout: 10000 },
    );
  }, []);

  // Persist client projects and selection to localStorage (survives refresh)
  useEffect(() => {
    saveClientProjects(projectsToPersisted(projects));
  }, [projects]);

  useEffect(() => {
    saveClientActiveProjectId(activeProjectId);
  }, [activeProjectId]);

  // Auto-save ALL filters to localStorage on every change.
  useEffect(() => {
    const persisted: PersistedClientFilters = {
      size: filters.size,
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
    filters.size, filters.countryCode, filters.city, filters.nearby,
    filters.category, filters.sportsWinter, filters.sportsSummer,
    filters.hairColor, filters.hipsMin, filters.hipsMax,
    filters.waistMin, filters.waistMax, filters.chestMin, filters.chestMax,
    filters.legsInseamMin, filters.legsInseamMax,
  ]);

  const auth = useAuth();
  /** Nur echte Auth-UUID – Supabase erwartet UUID für client_id / owner_id (kein Demo-String „user-client"). */
  const realClientId =
    auth?.profile?.role === 'client' && auth.profile.id ? auth.profile.id : null;
  const isRealClient = !!realClientId;
  const effectiveClientId = realClientId ?? 'user-client';

  // Save filters to Supabase (explicit user action via "Save Filters" button).
  const handleSaveFilters = useCallback(async () => {
    setFilterSaveStatus('saving');
    const preset: PersistedClientFilters = {
      size: filters.size,
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
        size: preset.size ?? prev.size,
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const [items, manual, beEntries] = await Promise.all([
        getCalendarEntriesForClient(realClientId),
        getManualEventsForOwner(realClientId, 'client'),
        getBookingEventsAsCalendarEntries(realClientId, 'client'),
      ]);
      setCalendarItems(items);
      setManualCalendarEvents(manual);
      setBookingEventEntries(beEntries);
    } finally {
      setCalendarLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'calendar') {
      loadClientCalendar();
    }
  }, [tab, realClientId]);

  useEffect(() => {
    if (realClientId) {
      loadOptionRequestsForClient();
    }
  }, [realClientId]);

  useEffect(() => {
    void (async () => {
      const countryIso = filters.countryCode.trim() || undefined;
      const cityFilter = countryIso && filters.city.trim() ? filters.city.trim() : undefined;

      // Derive effective clientType / category from unified category filter.
      const cat = filters.category;
      const effectiveClientType = !cat ? 'all' : cat === 'Commercial' ? 'commercial' : 'fashion';
      const effectiveCategory = cat === 'High Fashion' ? 'High Fashion' : undefined;

      // Convert height bucket → numeric range for backend filtering.
      const pInt = (v: string) => { const n = parseInt(v, 10); return isNaN(n) ? undefined : n; };
      let heightMin: number | undefined;
      let heightMax: number | undefined;
      if (filters.size === 'short')  { heightMax = 174; }
      if (filters.size === 'medium') { heightMin = 175; heightMax = 182; }
      if (filters.size === 'tall')   { heightMin = 183; }

      const measurementFilters = {
        heightMin,
        heightMax,
        hairColor: filters.hairColor.trim() || undefined,
        hipsMin:        pInt(filters.hipsMin),
        hipsMax:        pInt(filters.hipsMax),
        waistMin:       pInt(filters.waistMin),
        waistMax:       pInt(filters.waistMax),
        chestMin:       pInt(filters.chestMin),
        chestMax:       pInt(filters.chestMax),
        legsInseamMin:  pInt(filters.legsInseamMin),
        legsInseamMax:  pInt(filters.legsInseamMax),
      };

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
        chest: m.chest ?? 0,
        legsInseam: m.legsInseam ?? m.legs_inseam ?? 0,
        coverUrl: m.gallery?.[0] ?? m.polaroids?.[0] ?? '',
        agencyId: m.agencyId ?? m.agency_id ?? null,
        agencyName: m.agencyName ?? m.agency_name ?? null,
        countryCode: m.countryCode ?? null,
        hasRealLocation: m.hasRealLocation ?? false,
        isSportsWinter: m.isSportsWinter ?? false,
        isSportsSummer: m.isSportsSummer ?? false,
      }));
      setModels(mapped);
    })();
  }, [
    filters.countryCode, filters.city, filters.category,
    filters.sportsWinter, filters.sportsSummer, filters.size,
    filters.hairColor, filters.hipsMin, filters.hipsMax,
    filters.waistMin, filters.waistMax, filters.chestMin, filters.chestMax,
    filters.legsInseamMin, filters.legsInseamMax,
  ]);

  useEffect(() => {
    if (detailId) {
      setDetailLoading(true);
      setDetailData(null);
      getModelData(detailId)
        .then((data: any) => {
          setDetailData(data);
        })
        .finally(() => setDetailLoading(false));
    }
  }, [detailId]);

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
    // All measurement/category/sport/height/hair filters are now applied server-side.
    // Only "nearby" (user location detection) remains client-side because it depends
    // on the device's geo-position, not a fixed query parameter.
    if (!filters.nearby || !userCity) return baseModels;
    return baseModels.filter((m) =>
      (m.city || '').toLowerCase().includes(userCity.toLowerCase()),
    );
  }, [baseModels, filters.nearby, userCity]);

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

  const createProjectInternal = (name: string): Project | null => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const project: Project = {
      id: String(Date.now()),
      name: trimmed,
      models: [],
    };
    setProjects((prev) => [...prev, project]);
    setActiveProjectId(project.id);
    return project;
  };

  const createProject = () => {
    const created = createProjectInternal(newProjectName);
    if (!created) return;
    setNewProjectName('');
    setFeedback(`Created project "${created.name}".`);
    clearFeedbackLater();
  };

  const addModelToProject = (projectId: string, model: ModelSummary) => {
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
    const projectName = projects.find((p) => p.id === projectId)?.name;
    if (projectName) {
      setFeedback(`Added ${model.name} to "${projectName}".`);
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

  const handleCreateProjectAndAdd = (name: string) => {
    if (!pendingModel) return;
    const created = createProjectInternal(name);
    if (!created) return;
    addModelToProject(created.id, pendingModel);
    setProjectPickerOpen(false);
    setPendingModel(null);
  };

  const clearFeedbackLater = () => {
    setTimeout(() => setFeedback(null), 2400);
  };

  const onNext = () => {
    if (!filteredModels.length) return;
    setCurrentIndex((prev) => (prev + 1) % filteredModels.length);
  };

  const openSharedLinkForProject = (projectId: string) => {
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
      } catch (err) {
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
  };

  const exitPackageMode = () => setPackageViewState(null);

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
      const rows = await Promise.all(gl.model_ids.map((id) => getModelByIdFromSupabase(id)));
      const packageModels: ModelSummary[] = rows
        .filter((m): m is SupabaseModel => m !== null)
        .map((m) => ({
          id: m.id,
          name: m.name,
          city: m.city ?? '',
          hairColor: m.hair_color ?? '',
          height: m.height,
          bust: m.bust ?? 0,
          waist: m.waist ?? 0,
          hips: m.hips ?? 0,
          chest: m.chest ?? 0,
          legsInseam: m.legs_inseam ?? 0,
          coverUrl: m.portfolio_images?.[0] ?? m.polaroids?.[0] ?? '',
          agencyId: m.agency_id ?? null,
          agencyName: null,
          countryCode: m.country ?? null,
          hasRealLocation: false,
        }));
      const packageName = gl.agency_name
        ? `${gl.agency_name} (${gl.model_ids.length} models)`
        : `Package (${gl.model_ids.length} models)`;
      setFeedback(null);
      setPackageViewState({
        packageId,
        name: packageName,
        models: packageModels,
        guestLink: typeof meta.guest_link === 'string' ? meta.guest_link : '',
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
      projectId ?? activeProjectId ?? undefined,
      { ...extra, ...pkgExtra },
    );
    setOptionDatePickerOpen(false);
    setOptionDateModel(null);
    setOpenThreadIdOnMessages(threadId);
    setTab('messages');
  };

  useEffect(() => {
    setHasNew(hasNewMessages());
    const unsub = subscribe(() => setHasNew(hasNewMessages()));
    return unsub;
  }, []);

  const openOptionDatePicker = (model: ModelSummary) => {
    setOptionDateModel(model);
    setOptionDatePickerOpen(true);
  };

  return (
    <View style={styles.root}>
      <View style={styles.appShell}>
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

        {tab === 'discover' && (
          <DiscoverView
            models={filteredModels}
            current={currentModel}
            index={currentIndex}
            activeProject={activeProject}
            filters={filters}
            onChangeFilters={setFilters}
            onSaveFilters={handleSaveFilters}
            filterSaveStatus={filterSaveStatus}
            onNext={onNext}
            onAddToProject={openProjectPickerForModel}
            onOpenDetails={openDetails}
            onOpenOptionDatePicker={openOptionDatePicker}
            isSharedMode={isSharedMode}
            isPackageMode={isPackageMode}
            packageName={packageViewState?.name ?? null}
            onExitPackage={exitPackageMode}
            userCity={userCity}
          />
        )}

        {tab === 'projects' && (
          <ProjectsView
            projects={projects}
            activeProjectId={activeProjectId}
            onSelectProject={setActiveProjectId}
            newProjectName={newProjectName}
            setNewProjectName={setNewProjectName}
            onCreateProject={createProject}
            onOpenDetails={openDetails}
            onOpenSharedLink={openSharedLinkForProject}
            onShareFolder={handleShareFolder}
            onOpenOptionChat={(threadId) => {
              setOpenThreadIdOnMessages(threadId);
              setTab('messages');
            }}
          />
        )}

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
            msgFilter={msgFilter}
            onMsgFilterChange={setMsgFilter}
            clientUserId={realClientId}
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
            <ClientOrganizationTeamSection realClientId={realClientId} />
          </View>
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
      />

      {selectedCalendarItem && (
        <View style={styles.detailOverlay}>
          <View style={[styles.detailCard, { maxWidth: 520 }]}>
            <View style={styles.detailHeaderRow}>
              <Text style={styles.detailTitle}>Booking details</Text>
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
            {selectedCalendarItem.calendar_entry ? (
              <View style={{ marginTop: spacing.md }}>
                <Text style={styles.sectionLabel}>Shared notes</Text>
                <Text style={[styles.metaText, { marginBottom: spacing.sm }]}>
                  Visible to agency and model. Minimise personal data (GDPR).
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
                  placeholder="Add a note for everyone on this booking…"
                  placeholderTextColor={colors.textSecondary}
                  style={[styles.input, { minHeight: 72, borderRadius: 12, textAlignVertical: 'top' }]}
                />
                <TouchableOpacity
                  onPress={async () => {
                    if (!selectedCalendarItem || !clientSharedNoteDraft.trim()) return;
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
                    {savingSharedNoteClient ? 'Posting…' : 'Post shared note'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <View style={{ marginTop: spacing.md }}>
              <Text style={styles.sectionLabel}>Client notes (internal)</Text>
              <TextInput
                value={clientNotesDraft}
                onChangeText={setClientNotesDraft}
                multiline
                placeholder="Notes shared with agency and model…"
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
                  {savingNotes ? 'Saving…' : 'Save notes'}
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
                  const clientOrgId = await ensureClientOrganization();
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

      {!isSharedMode && !isPackageMode && (
        <View style={styles.bottomTabBar}>
          {(['discover', 'messages', 'calendar', 'team', 'agencies', 'projects'] as TopTab[]).map((key) => (
            <TouchableOpacity
              key={key}
              onPress={() => setTab(key)}
              style={styles.bottomTabItem}
            >
              <Text style={[styles.bottomTabLabel, tab === key && styles.bottomTabLabelActive]}>
                {key === 'discover'
                  ? 'Discover'
                  : key === 'projects'
                  ? 'My Projects'
                  : key === 'calendar'
                  ? 'Calendar'
                  : key === 'agencies'
                  ? 'Agencies'
                  : key === 'team'
                  ? 'Team'
                  : 'Messages'}
              </Text>
              {key === 'messages' && hasNew && (
                <View style={styles.bottomTabDot} />
              )}
              {tab === key && <View style={styles.bottomTabUnderline} />}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};

type DiscoverProps = {
  models: ModelSummary[];
  current: ModelSummary | null;
  index: number;
  activeProject: Project | null;
  filters: ModelFilters;
  onChangeFilters: (f: ModelFilters) => void;
  onSaveFilters: () => void;
  filterSaveStatus: 'idle' | 'saving' | 'saved' | 'error';
  onNext: () => void;
  onAddToProject: (model: ModelSummary) => void;
  onOpenDetails: (id: string) => void;
  onOpenOptionDatePicker: (model: ModelSummary) => void;
  isSharedMode: boolean;
  isPackageMode: boolean;
  packageName: string | null;
  onExitPackage?: () => void;
  userCity: string | null;
};

const DiscoverView: React.FC<DiscoverProps> = ({
  models,
  current,
  index,
  activeProject,
  filters,
  onChangeFilters,
  onSaveFilters,
  filterSaveStatus,
  onNext,
  onAddToProject,
  userCity,
  onOpenDetails,
  onOpenOptionDatePicker,
  isSharedMode,
  isPackageMode,
  packageName,
  onExitPackage,
}) => {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>Discover</Text>
        <Text style={styles.metaText}>
          {models.length ? `${index + 1}/${models.length}` : '0/0'}
        </Text>
      </View>

      {isPackageMode && packageName ? (
        <View style={styles.packageBanner}>
          <Text style={styles.packageBannerText}>
            {uiCopy.discover.viewingPackage}: {packageName}
          </Text>
          <TouchableOpacity onPress={onExitPackage} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.packageBannerExit}>{uiCopy.discover.exitPackage}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ModelFiltersPanel
          filters={filters}
          onChangeFilters={onChangeFilters}
          onSaveFilters={onSaveFilters}
          filterSaveStatus={filterSaveStatus === 'idle' ? null : filterSaveStatus}
          userCity={userCity}
        />
      )}

      <View style={styles.activeProjectRow}>
        <Text style={styles.metaText}>Active project</Text>
        <Text style={styles.activeProjectName}>
          {activeProject ? activeProject.name : isSharedMode ? 'Shared view' : 'None'}
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
                <Image
                  source={{ uri: current.coverUrl }}
                  style={styles.coverImage}
                  resizeMode="cover"
                />
              </TouchableOpacity>
              <View style={styles.coverGradientOverlay} />
              <View style={styles.coverMeasurementsOverlay}>
                <Text style={styles.coverNameOnImage}>{current.name}</Text>
                <Text style={styles.coverMeasurementsLabel}>
                  Height {current.height} · Chest {current.chest || current.bust} · Waist {current.waist} · Hips {current.hips}
                  {current.legsInseam ? ` · Inseam ${current.legsInseam}` : ''}
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
                style={styles.addToSelectionButton}
                onPress={() => onAddToProject(current)}
              >
                <Text style={styles.addToSelectionLabel}>Add to selection</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.emptyDiscover}>
          <Text style={styles.emptyTitle}>No models available</Text>
          <Text style={styles.emptyCopy}>Adjust filters or check back later for new talent.</Text>
        </View>
      )}

    </View>
  );
};

type ClientCalendarViewProps = {
  items: ClientCalendarItem[];
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

  const sorted = useMemo(
    () =>
      [...items].sort((a, b) =>
        (a.option.requested_date || '').localeCompare(b.option.requested_date || ''),
      ),
    [items],
  );
  const sortedManual = useMemo(
    () => [...manualEvents].sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || '').localeCompare(b.start_time || '')),
    [manualEvents],
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

type ProjectsProps = {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  newProjectName: string;
  setNewProjectName: (v: string) => void;
  onCreateProject: () => void;
  onOpenDetails: (id: string) => void;
  onOpenSharedLink: (id: string) => void;
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
  onOpenDetails,
  onOpenSharedLink,
  onShareFolder,
  onOpenOptionChat,
}) => {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>My projects</Text>
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
          <TouchableOpacity
            key={p.id}
            style={[
              styles.projectRow,
              activeProjectId === p.id && styles.projectRowActive,
            ]}
            onPress={() => onSelectProject(p.id)}
          >
            <View style={styles.projectHeader}>
              <Text style={styles.projectName}>{p.name}</Text>
              <Text style={styles.metaText}>
                {p.models.length} model{p.models.length === 1 ? '' : 's'}
              </Text>
              <View style={styles.projectActionsRow}>
                <TouchableOpacity onPress={() => onOpenSharedLink(p.id)}>
                  <Text style={styles.sharedLinkLabel}>Open shared link</Text>
                </TouchableOpacity>
                {p.models.length > 0 && (
                  <TouchableOpacity onPress={() => onShareFolder(p)}>
                    <Text style={styles.shareFolderLabel}>Share folder</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <View style={styles.projectModelsRow}>
              {p.models.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={styles.modelChip}
                  onPress={() => onOpenDetails(m.id)}
                >
                  <Text style={styles.modelChipLabel}>{m.name}</Text>
                </TouchableOpacity>
              ))}
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
          </TouchableOpacity>
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
    if (!q) return agencies;
    return agencies.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.city && a.city.toLowerCase().includes(q)) ||
        (a.focus && a.focus.toLowerCase().includes(q))
    );
  }, [search, agencies]);

  const showNotFound = search.trim().length > 2 && filtered.length === 0;

  const handleSendInvitation = async () => {
    if (!invitationEmail.trim()) return;
    await sendAgencyInvitation(search.trim(), invitationEmail.trim(), clientUserId ?? 'user-client');
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
  in_negotiation: 'In negotiation',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
};

const STATUS_COLORS: Record<ChatStatus, string> = {
  in_negotiation: '#B8860B',
  confirmed: colors.buttonOptionGreen,
  rejected: colors.textSecondary,
};

type MessagesViewProps = {
  openThreadId: string | null;
  onClearOpenThreadId: () => void;
  isAgency: boolean;
  msgFilter?: 'current' | 'archived';
  onMsgFilterChange?: (f: 'current' | 'archived') => void;
  clientUserId?: string | null;
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
}> = ({ clientUserId, pendingOpen, onPendingConsumed, onBookingCardPress, onPackagePress }) => {
  const auth = useAuth();
  const [rows, setRows] = useState<Conversation[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [clientOrgId, setClientOrgId] = useState<string | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Until `rows` + `titles` include a freshly started chat, keep the agency name from Start chat. */
  const [optimisticThreadTitle, setOptimisticThreadTitle] = useState<string | null>(null);

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

  if (rows.length === 0 && !activeConversationId) {
    return <Text style={styles.metaText}>{uiCopy.b2bChat.noAgencyChatsYetClient}</Text>;
  }

  return (
    <View style={{ marginTop: spacing.sm }}>
      {rows.length > 0 ? (
        <ScrollView style={{ maxHeight: 220 }}>
          {rows.map((c) => (
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
      ) : null}
      {activeConversationId ? (
        <OrgMessengerInline
          conversationId={activeConversationId}
          headerTitle={messengerTitle}
          viewerUserId={auth.profile?.id ?? null}
          containerStyle={{ marginTop: spacing.md }}
          onBookingCardPress={onBookingCardPress}
          onPackagePress={onPackagePress}
        />
      ) : null}
    </View>
  );
};

const MessagesView: React.FC<MessagesViewProps> = ({
  openThreadId,
  onClearOpenThreadId,
  isAgency,
  msgFilter = 'current',
  onMsgFilterChange,
  clientUserId = null,
  pendingClientB2BChat = null,
  onPendingClientB2BChatConsumed,
  onBookingCardPress,
  onPackagePress,
}) => {
  const [clientMsgTab, setClientMsgTab] = useState<'b2bChats' | 'optionRequests'>('b2bChats');
  const [requests, setRequests] = useState(getOptionRequests());
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [agencyCounterInput, setAgencyCounterInput] = useState('');
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem('ci_archived_threads');
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });

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
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      if (typeof window !== 'undefined') window.localStorage.setItem('ci_archived_threads', JSON.stringify([...next]));
      return next;
    });
  };

  const visibleRequests = requests.filter((r) =>
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
    addMessage(selectedThreadId, isAgency ? 'agency' : 'client', text);
    setChatInput('');
  };

  const showClientMessagesTabs = !isAgency && !!clientUserId;

  return (
    <View style={styles.section}>
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
          pendingOpen={pendingClientB2BChat}
          onPendingConsumed={onPendingClientB2BChatConsumed}
          onBookingCardPress={onBookingCardPress}
          onPackagePress={onPackagePress}
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
      <ScrollView style={styles.threadList}>
        {visibleRequests.length === 0 ? (
          <Text style={styles.metaText}>{msgFilter === 'archived' ? 'No archived messages.' : 'No messages.'}</Text>
        ) : (
          visibleRequests.map((r) => {
            const reqStatus = getRequestStatus(r.threadId) ?? r.status;
            const isArchived = archivedIds.has(r.threadId);
            return (
              <TouchableOpacity
                key={r.threadId}
                style={[styles.threadRow, selectedThreadId === r.threadId && styles.threadRowActive]}
                onPress={() => setSelectedThreadId(r.threadId)}
              >
                <View style={styles.threadRowLeft}>
                  <Text style={styles.threadTitle}>{r.modelName} · {r.date}</Text>
                  <Text style={styles.metaText}>{r.clientName}{r.startTime ? ` · ${r.startTime}–${r.endTime}` : ''}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                  {r.modelAccountLinked === false ? (
                    <Text style={{ ...typography.label, fontSize: 9, color: colors.textSecondary }}>No model app</Text>
                  ) : r.modelApproval === 'approved' ? (
                    <Text style={{ ...typography.label, fontSize: 9, color: colors.buttonOptionGreen }}>Model OK</Text>
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
          {request.proposedPrice != null && isAgency && (
            <Text style={{ ...typography.label, fontSize: 10, color: colors.accentBrown, marginBottom: spacing.xs }}>
              Proposed price: {request.currency === 'USD' ? '$' : request.currency === 'GBP' ? '£' : request.currency === 'CHF' ? 'CHF ' : '€'}{request.proposedPrice}
            </Text>
          )}
          {request.modelAccountLinked === false && (
            <View style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, marginBottom: spacing.sm, backgroundColor: 'rgba(100,100,100,0.12)', borderRadius: 8 }}>
              <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary }}>
                This model has no app account — the agency can confirm with you directly. Once confirmed, the date is booked and appears in your calendar and the agency&apos;s.
              </Text>
            </View>
          )}
          {finalStatus && (
            <View style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, marginBottom: spacing.sm, backgroundColor: finalStatus === 'job_confirmed' ? 'rgba(0,120,0,0.15)' : finalStatus === 'option_confirmed' ? 'rgba(0,80,200,0.12)' : 'rgba(120,120,0,0.12)', borderRadius: 8 }}>
              <Text style={{ ...typography.label, fontSize: 11, color: colors.textPrimary }}>
                {request.requestType === 'casting' ? 'Casting' : 'Option'} – {finalStatus === 'job_confirmed' ? 'Job confirmed' : finalStatus === 'option_confirmed' ? 'Confirmed (pending job)' : 'Pending'}
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
          <ScrollView style={styles.chatPanelMessages}>
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

  if (!open || !model) return null;

  const daysInMonth = new Date(calMonth.year, calMonth.month + 1, 0).getDate();
  const firstDayOfWeek = new Date(calMonth.year, calMonth.month, 1).getDay();
  const monthLabel = new Date(calMonth.year, calMonth.month).toLocaleString('en', { month: 'long', year: 'numeric' });
  const today = new Date().toISOString().slice(0, 10);

  const prevMonth = () => setCalMonth((p) => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 });
  const nextMonth = () => setCalMonth((p) => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 });

  const handleSubmit = () => {
    if (!selectedDate) return;
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
            disabled={!selectedDate}
            style={[styles.primaryButton, { flex: 1, opacity: selectedDate ? 1 : 0.4 }]}
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
};

const ProjectDetailView: React.FC<DetailProps> = ({
  open,
  loading,
  data,
  onClose,
  onOptionRequest,
}) => {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

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
    setTimeout(() => {
      setConfirmation(`Request option for ${date} was sent (mock API).`);
    }, 700);
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
              {Object.entries(data.measurements).map(([key, value]) => (
                <View key={key} style={styles.detailMeasureItem}>
                  <Text style={styles.detailMeasureLabel}>{key}</Text>
                  <Text style={styles.detailMeasureValue}>{value}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.detailSectionLabel}>Portfolio</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.detailPortfolioRow}
            >
              {(data.portfolio?.images || []).map((url, idx) => (
                <TouchableOpacity key={url} onPress={() => setLightboxIndex(idx)} activeOpacity={0.85}>
                  <Image
                    source={{ uri: url }}
                    style={styles.detailPortfolioImage}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              ))}
              {(!data.portfolio?.images || data.portfolio.images.length === 0) && (
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
        const images = data?.portfolio?.images ?? [];
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

              <Image
                source={{ uri: currentUrl ?? '' }}
                style={styles.lightboxImage}
                resizeMode="contain"
              />

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
  onClose: () => void;
  onAddToExisting: (projectId: string) => void;
  onCreateAndAdd: (name: string) => void;
};

const ProjectPicker: React.FC<ProjectPickerProps> = ({
  open,
  projects,
  pendingModel,
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
          {projects.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={styles.pickerRow}
              onPress={() => onAddToExisting(p.id)}
            >
              <Text style={styles.projectName}>{p.name}</Text>
              <Text style={styles.metaText}>
                {p.models.length} model{p.models.length === 1 ? '' : 's'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.newProjectRow}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="New project name"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
          />
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => onCreateAndAdd(name)}
          >
            <Text style={styles.primaryLabel}>Create & add</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const SettingsPanel: React.FC<{ realClientId: string | null; onClose: () => void }> = ({
  realClientId,
  onClose,
}) => {
  const { signOut } = useAuth();
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
  const [clientIsOwner, setClientIsOwner] = useState(false);
  const [ownerRoleLoading, setOwnerRoleLoading] = useState(true);
  const [clientOrgId, setClientOrgId] = useState<string | null>(null);

  useEffect(() => {
    if (!realClientId) {
      setClientIsOwner(false);
      setOwnerRoleLoading(false);
      return;
    }
    setOwnerRoleLoading(true);
    void getMyClientMemberRole().then((row) => {
      setClientIsOwner(row?.member_role === 'owner');
      setOwnerRoleLoading(false);
      if (row?.organization_id) {
        setClientOrgId(row.organization_id);
      }
    });
  }, [realClientId]);

  // Load company name from Supabase (authoritative) and fall back to localStorage.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem('ci_client_settings');
        if (raw) {
          const s = JSON.parse(raw);
          setDisplayName(s.displayName ?? '');
          setCompanyName(s.companyName ?? '');
          setPhone(s.phone ?? '');
          setWebsite(s.website ?? '');
          setInstagram(s.instagram ?? '');
          setLinkedin(s.linkedin ?? '');
        }
      } catch {}
    }
  }, []);

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
            <Text style={{ ...typography.label, fontSize: 11, color: colors.textSecondary }}>Close</Text>
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
                <Text style={{ ...typography.label, fontSize: 12, color: colors.textPrimary, marginBottom: 4 }}>
                  {uiCopy.accountDeletion.sectionTitle}
                </Text>
                {!realClientId ? (
                  <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary }}>
                    {uiCopy.accountDeletion.notAvailableSignedOut}
                  </Text>
                ) : ownerRoleLoading ? (
                  <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary }}>{uiCopy.common.loading}</Text>
                ) : clientIsOwner ? (
                  <>
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
                  <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary }}>
                    {uiCopy.accountDeletion.ownerOnly}
                  </Text>
                )}
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
    backgroundColor: colors.background,
  },
  appShell: {
    flex: 1,
    maxWidth: 1200,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
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
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    paddingVertical: spacing.sm,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
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
    maxHeight: 200,
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


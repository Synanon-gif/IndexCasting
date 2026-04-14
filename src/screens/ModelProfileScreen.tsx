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
  Linking,
  Alert,
  ActivityIndicator,
  Image,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { isMobileWidth } from '../theme/breakpoints';
import { getChatOverlayMaxWidth, getMessagesScrollMaxHeight } from '../theme/chatLayout';
import {
  getModelsFromSupabase,
  getModelForUserFromSupabase,
  type SupabaseModel,
} from '../services/modelsSupabase';
import {
  upsertModelLocation,
  getModelLocation,
  deleteModelLocation,
  roundCoord,
  locationSourceLabel,
  type ModelLocation,
} from '../services/modelLocationsSupabase';
import { getPhotosForModel, type ModelPhoto } from '../services/modelPhotosSupabase';
import { StorageImage } from '../components/StorageImage';
import { supabase } from '../../lib/supabase';
import { UI_DOUBLE_SUBMIT_DEBOUNCE_MS } from '../../lib/validation';
import {
  getModelBookingThreadIds,
  getRecruitingThread,
  subscribeRecruitingChats,
} from '../store/recruitingChats';
import {
  getOptionRequests,
  subscribe,
  getMessages,
  addMessage,
  getRequestByThreadId,
  getOutstandingOptionsForModel,
  loadOptionsForModel,
  loadMessagesForThread,
  loadOlderMessagesForThread,
  refreshOptionRequestInCache,
  type OptionRequest,
} from '../store/optionRequests';
import { subscribeToOptionMessages } from '../services/optionRequestsSupabase';
import {
  getCalendarForModel,
  bookingEventToCalendarEntry,
  insertCalendarEntry,
  deleteCalendarEntryById,
  updateCalendarEntryById,
  type CalendarEntry,
  type BookingDetails,
  updateBookingDetails,
  appendSharedBookingNote,
  type SharedBookingNote,
} from '../services/calendarSupabase';
import { resolveCanonicalOptionRequestIdFromBookingCalendarEntry } from '../utils/calendarThreadDeepLink';
import BookingBriefEditor from '../components/BookingBriefEditor';
import { getBookingEventsForModel } from '../services/bookingEventsSupabase';
import {
  modelUpdateOptionSchedule,
  getPendingModelConfirmations,
  modelConfirmOptionRequest,
  modelRejectOptionRequest,
  type SupabaseOptionRequestModelSafe,
} from '../services/optionRequestsSupabase';
import { getAgencyById, type Agency } from '../services/agenciesSupabase';
import { getAgencyNamesByThreadIds } from '../services/recruitingChatSupabase';
import { BookingChatView } from '../views/BookingChatView';
import { useAuth } from '../context/AuthContext';
import { useModelAgency } from '../context/ModelAgencyContext';
import { makeModelAgencyKey } from '../utils/modelAgencyKey';
import {
  primaryCounterpartyLabelForModel,
  secondarySubtitleForModel,
} from '../utils/modelOptionDisplay';
import { uiCopy } from '../constants/uiCopy';
import { showAppAlert } from '../utils/crossPlatformAlert';
import { exportUserData, downloadUserDataExport } from '../services/gdprComplianceSupabase';
import { listModelAgencyDirectConversations } from '../services/b2bOrgChatSupabase';
import type { Conversation } from '../services/messengerSupabase';
import { OrgMessengerInline } from '../components/OrgMessengerInline';
import { ConfirmDestructiveModal } from '../components/ConfirmDestructiveModal';
import { shouldShowSystemMessageForViewer } from '../components/optionNegotiation/filterSystemMessagesForViewer';
import { modelInboxRequiresModelConfirmation } from '../utils/optionRequestAttention';
import { formatDateWithOptionalTimeRange, stripClockSeconds } from '../utils/formatTimeForUi';
import { bubbleColorsForSender, outgoingSelfBubbleColors } from '../theme/roleColors';
import { CHAT_BUBBLE_MAX_WIDTH } from '../components/orgMessengerMessageLayout';
import { getCalendarDetailNextStepForModelLocalOption } from '../utils/calendarDetailNextStep';
import { MonthCalendarView } from '../components/MonthCalendarView';
import { CalendarViewModeBar, type CalendarViewMode } from '../components/CalendarViewModeBar';
import { CalendarWeekGrid } from '../components/CalendarWeekGrid';
import { CalendarDayTimeline } from '../components/CalendarDayTimeline';
import {
  buildEventsByDateFromModelEntries,
  filterModelScheduleBlocksForDate,
  filterModelScheduleBlocksForWeek,
} from '../utils/modelCalendarSchedule';
import {
  addDaysYmd,
  startOfWeekMonday,
  todayYmd,
  weekDayDates,
} from '../utils/calendarTimelineLayout';
import { calendarEntryColor } from '../utils/calendarColors';

type ModelProfile = {
  id: string;
  name: string;
  height: number;
  /** Display: `chest` column or legacy `bust` from API. */
  chest: number;
  waist: number;
  hips: number;
  city: string;
  countryCode: string | null;
  currentLocation: string;
  hairColor: string;
  mediaslideSyncId: string | null;
  agencyId: string | null;
};

type ModelTab = 'home' | 'calendar' | 'messages' | 'settings';

const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

type ModelProfileScreenProps = {
  onBackToRoleSelection?: () => void;
  /** Wenn gesetzt: Model dieses Users laden (echte Anmeldung). Sonst: erstes Model (Demo). */
  userId?: string | null;
  /** When set (e.g. from Model inbox), open Options tab and this negotiation thread once. */
  focusOptionRequestId?: string | null;
  onConsumedFocusOption?: () => void;
};

export const ModelProfileScreen: React.FC<ModelProfileScreenProps> = ({
  onBackToRoleSelection,
  userId,
  focusOptionRequestId,
  onConsumedFocusOption,
}) => {
  const { width: modelProfileWindowWidth, height: modelProfileWindowHeight } =
    useWindowDimensions();
  const optionChatOverlayMaxW = getChatOverlayMaxWidth(modelProfileWindowWidth);
  const optionChatMessagesMaxH = getMessagesScrollMaxHeight(modelProfileWindowHeight);
  // True on mobile-width viewports — option chat overlay fills the inset area instead of floating.
  const isMobileModel = isMobileWidth(modelProfileWindowWidth);
  const { signOut } = useAuth();
  const modelAgencyCtx = useModelAgency();
  const [profile, setProfile] = useState<ModelProfile | null>(null);
  const [tab, setTab] = useState<ModelTab>('home');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [exportingData, setExportingData] = useState(false);
  const [calMonth, setCalMonth] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarViewMode, setCalendarViewMode] = useState<CalendarViewMode>('month');
  const [calEntries, setCalEntries] = useState<CalendarEntry[]>([]);
  const [newEntryTitle, setNewEntryTitle] = useState('');
  const [newEntryStart, setNewEntryStart] = useState('09:00');
  const [newEntryEnd, setNewEntryEnd] = useState('10:00');
  const [bookingThreadIds, setBookingThreadIds] = useState<string[]>(() =>
    getModelBookingThreadIds(),
  );
  const [openBookingThreadId, setOpenBookingThreadId] = useState<string | null>(null);
  const [options, setOptions] = useState<OptionRequest[]>([]);
  const [selectedOptionThread, setSelectedOptionThread] = useState<string | null>(null);
  const [optChatInput, setOptChatInput] = useState('');
  const [optChatInputHeight, setOptChatInputHeight] = useState(36);
  const [locationLoading, setLocationLoading] = useState(false);
  const [openEntry, setOpenEntry] = useState<CalendarEntry | null>(null);
  const [modelNotesDraft, setModelNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [sharedNoteDraft, setSharedNoteDraft] = useState('');
  const [savingSharedNote, setSavingSharedNote] = useState(false);
  const lastAppendSharedNoteAtRef = useRef(0);
  const [entryScheduleDraft, setEntryScheduleDraft] = useState({
    date: '',
    start_time: '09:00',
    end_time: '10:00',
    title: '',
  });
  const [savingEntrySchedule, setSavingEntrySchedule] = useState(false);
  const [deletingCalendarEntry, setDeletingCalendarEntry] = useState(false);
  const [optionChatAgency, setOptionChatAgency] = useState<Agency | null>(null);
  const [bookingAgencyByThread, setBookingAgencyByThread] = useState<Record<string, string>>({});
  const [agencyDirectConvs, setAgencyDirectConvs] = useState<Conversation[]>([]);
  const [openDirectConvId, setOpenDirectConvId] = useState<string | null>(null);
  const [pendingConfirmations, setPendingConfirmations] = useState<
    SupabaseOptionRequestModelSafe[]
  >([]);
  const [confirmingBookingId, setConfirmingBookingId] = useState<string | null>(null);
  const [rejectingBookingId, setRejectingBookingId] = useState<string | null>(null);
  const [optionActionModal, setOptionActionModal] = useState<{
    id: string;
    action: 'confirm' | 'reject';
  } | null>(null);
  const [addingEntry, setAddingEntry] = useState(false);

  // Portfolio photos the agency uploaded for this model
  const [modelPhotos, setModelPhotos] = useState<ModelPhoto[]>([]);

  // Location state — active source + manual 'current' city input
  const [modelLocation, setModelLocation] = useState<ModelLocation | null>(null);
  const [currentCityInput, setCurrentCityInput] = useState('');
  const [currentCountryInput, setCurrentCountryInput] = useState('');
  const [currentCityLoading, setCurrentCityLoading] = useState(false);
  const [removingLocation, setRemovingLocation] = useState(false);

  const handleShareLocation = async () => {
    if (!profile) return;
    setLocationLoading(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 10000,
        }),
      );
      const { latitude, longitude } = position.coords;

      // Round before sending to any third-party service to avoid exposing exact GPS.
      const latRounded = roundCoord(latitude);
      const lngRounded = roundCoord(longitude);

      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${latRounded}&lon=${lngRounded}&format=json`,
        { headers: { 'Accept-Language': 'en' } },
      );
      const data = await res.json();
      const cityName =
        data.address?.city ??
        data.address?.town ??
        data.address?.village ??
        data.address?.state ??
        'Unknown';
      const countryCode: string =
        (data.address?.country_code as string | undefined)?.toUpperCase() ??
        profile.countryCode ??
        'XX';

      // Update legacy current_location text field via SECURITY DEFINER RPC
      // (blocked if model belongs to an agency — agency controls location in that case)
      await supabase.rpc('model_update_own_profile_safe', {
        p_current_location: cityName,
      });

      // Write privacy-safe approximate location to model_locations
      await upsertModelLocation(
        profile.id,
        {
          country_code: countryCode,
          city: cityName,
          lat: latRounded,
          lng: lngRounded,
          share_approximate_location: true,
        },
        'live',
      );

      setProfile((prev) => (prev ? { ...prev, currentLocation: cityName } : prev));
      // Reload to reflect the new highest-priority source (live now overrides current/agency)
      const refreshed = await import('../services/modelLocationsSupabase').then((m) =>
        m.getModelLocation(profile.id),
      );
      setModelLocation(refreshed);
      Alert.alert(uiCopy.alerts.locationUpdatedTitle, `Live GPS location set to: ${cityName}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      Alert.alert(
        uiCopy.alerts.locationErrorTitle,
        err?.message ?? uiCopy.alerts.locationErrorFallback,
      );
    } finally {
      setLocationLoading(false);
    }
  };

  const onExportData = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setExportingData(true);
    try {
      if (Platform.OS === 'web') {
        const okDl = await downloadUserDataExport(user.id);
        if (okDl) {
          showAppAlert(
            uiCopy.privacyData.downloadStartedTitle,
            uiCopy.privacyData.downloadStartedBody,
          );
        } else {
          showAppAlert(uiCopy.common.error, uiCopy.privacyData.couldNotExport);
        }
      } else {
        const result = await exportUserData(user.id);
        if (result.ok) {
          showAppAlert(uiCopy.privacyData.exportNativeTitle, uiCopy.privacyData.exportNativeBody);
        } else {
          showAppAlert(uiCopy.common.error, uiCopy.privacyData.couldNotExport);
        }
      }
    } catch (e) {
      console.error('[ModelProfileScreen] onExportData error:', e);
      showAppAlert(uiCopy.common.error, uiCopy.privacyData.couldNotExport);
    } finally {
      setExportingData(false);
    }
  };

  /** Set a manual approximate city (source='current') via Nominatim forward geocoding.
   *
   * GEOCODING SAFETY INVARIANT: if geocoding fails, NO update is made.
   * Existing location data is always preserved — never overwritten with null coordinates.
   */
  const handleSetCurrentCity = async () => {
    if (!profile || !currentCityInput.trim() || !currentCountryInput.trim()) {
      Alert.alert(uiCopy.alerts.missingFieldsTitle, uiCopy.alerts.missingFieldsLocationBody);
      return;
    }
    setCurrentCityLoading(true);
    try {
      const city = currentCityInput.trim();
      const countryCode = currentCountryInput.trim().toUpperCase().slice(0, 2);

      // Forward geocode city → lat/lng (required for Near Me radius filtering)
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)},${countryCode}&format=json&limit=1`,
        { headers: { 'Accept-Language': 'en', 'User-Agent': 'IndexCasting/1.0' } },
      );
      const results = (await res.json()) as Array<{ lat: string; lon: string }>;
      const first = results[0];
      const lat = first ? roundCoord(parseFloat(first.lat)) : null;
      const lng = first ? roundCoord(parseFloat(first.lon)) : null;

      // GEOCODING SAFETY: if geocoding failed, abort — never write null coordinates.
      // Existing location data is preserved. User must try a more specific city name.
      if (lat == null || lng == null) {
        Alert.alert(
          uiCopy.alerts.cityNotFoundTitle,
          `Could not geocode "${city}, ${countryCode}". Please try a more specific city name.\n\nYour existing location has not been changed.`,
        );
        return;
      }

      const ok = await upsertModelLocation(
        profile.id,
        {
          country_code: countryCode,
          city,
          lat,
          lng,
          share_approximate_location: true,
        },
        'current',
      );

      if (ok) {
        const updated: ModelLocation = {
          ...(modelLocation ?? ({} as ModelLocation)),
          model_id: profile.id,
          city,
          country_code: countryCode,
          lat_approx: lat,
          lng_approx: lng,
          share_approximate_location: true,
          source: 'current',
          updated_at: new Date().toISOString(),
        };
        setModelLocation(updated);
        setProfile((prev) => (prev ? { ...prev, currentLocation: city } : prev));
        setCurrentCityInput('');
        setCurrentCountryInput('');
        Alert.alert(
          uiCopy.alerts.locationSetTitle,
          `Current city set to ${city}, ${countryCode}. You will appear in Near Me.`,
        );
      } else {
        Alert.alert(uiCopy.common.error, uiCopy.alerts.couldNotSaveLocation);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      Alert.alert(uiCopy.common.error, err?.message ?? uiCopy.alerts.couldNotSaveLocation);
    } finally {
      setCurrentCityLoading(false);
    }
  };

  /**
   * Remove the active model-owned location source (live or current only).
   * Source-aware: only removes the specific source being displayed — agency source is
   * never touched. Removing 'live' naturally falls back to 'current' or 'agency'.
   *
   * Model cannot remove agency-set location (that's agency's data).
   */
  const handleRemoveLocation = async () => {
    if (!profile || !modelLocation) return;
    // Only model-owned sources can be removed by the model
    if (modelLocation.source === 'agency') {
      Alert.alert(uiCopy.alerts.cannotRemoveTitle, uiCopy.alerts.cannotRemoveAgencyBody);
      return;
    }
    const sourceLabel = modelLocation.source === 'live' ? 'Live GPS' : 'Current city';
    Alert.alert(`Remove ${sourceLabel}`, uiCopy.alerts.removeLocationConfirmBody, [
      { text: uiCopy.common.cancel, style: 'cancel' },
      {
        text: uiCopy.common.remove,
        style: 'destructive',
        onPress: async () => {
          setRemovingLocation(true);
          const removedSource = modelLocation.source;
          // Delete only the specific source row — other sources are preserved
          const ok = await deleteModelLocation(profile.id, removedSource);
          setRemovingLocation(false);
          if (ok) {
            // Reload to get the next effective location (fallback to current/agency)
            const next = await import('../services/modelLocationsSupabase').then((m) =>
              m.getModelLocation(profile.id),
            );
            setModelLocation(next);
            if (!next) setProfile((prev) => (prev ? { ...prev, currentLocation: '' } : prev));
          } else {
            Alert.alert(uiCopy.common.error, uiCopy.alerts.couldNotRemoveLocation);
          }
        },
      },
    ]);
  };

  useEffect(() => {
    setBookingThreadIds(getModelBookingThreadIds());
    // Subscribe to store changes instead of polling every 3 s.
    const unsub = subscribeRecruitingChats(() => {
      setBookingThreadIds(getModelBookingThreadIds());
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (tab !== 'messages' || bookingThreadIds.length === 0) return;
    let cancelled = false;
    // Resolves all thread→agencyName mappings in exactly 2 queries (batch),
    // replacing the previous N+1 loop (2 queries per thread).
    void getAgencyNamesByThreadIds(bookingThreadIds).then((map) => {
      if (!cancelled) setBookingAgencyByThread((prev) => ({ ...prev, ...map }));
    });
    return () => {
      cancelled = true;
    };
  }, [tab, bookingThreadIds]);

  useEffect(() => {
    if (tab !== 'messages' || !userId) return;
    let cancelled = false;
    void listModelAgencyDirectConversations(userId).then((convs) => {
      if (!cancelled) setAgencyDirectConvs(convs);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, userId]);

  useEffect(() => {
    let cancelled = false;
    const applyModel = (
      m: Partial<SupabaseModel> & { id: string; name: string; height: number },
    ) => {
      if (cancelled) return;
      setProfile({
        id: m.id,
        name: m.name,
        height: m.height,
        chest: m.chest ?? m.bust ?? 0,
        waist: m.waist ?? 0,
        hips: m.hips ?? 0,
        city: m.city ?? '',
        countryCode: m.country_code ?? null,
        currentLocation: m.current_location ?? '',
        hairColor: m.hair_color ?? '',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mediaslideSyncId: (m as any).mediaslide_sync_id ?? null,
        agencyId: m.agency_id ?? null,
      });
      loadCalendar(m.id);
      loadOptionsForModel(m.id);
    };
    if (userId) {
      getModelForUserFromSupabase(userId)
        .then((m) => {
          if (m) applyModel(m);
        })
        .catch((e) => console.error('[ModelProfileScreen] getModelForUser error:', e));
    } else {
      getModelsFromSupabase({ limit: 1 })
        .then((list) => {
          const m = list[0];
          if (m) applyModel(m);
        })
        .catch((e) => console.error('[ModelProfileScreen] getModels error:', e));
    }
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Load active location source on mount (and when profile changes)
  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    void getModelLocation(profile.id).then((loc) => {
      if (!cancelled) setModelLocation(loc);
    });
    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    void getPhotosForModel(profile.id).then((photos) => {
      if (!cancelled) setModelPhotos(photos.filter((p) => p.photo_type !== 'private'));
    });
    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  useEffect(() => {
    setOptions(getOptionRequests());
    const unsub = subscribe(() => setOptions(getOptionRequests()));
    return unsub;
  }, []);

  useEffect(() => {
    if (!focusOptionRequestId || !profile?.id) return;
    let cancelled = false;
    void (async () => {
      await loadOptionsForModel(profile.id);
      if (cancelled) return;
      await loadMessagesForThread(focusOptionRequestId, { viewerRole: 'model' });
      if (cancelled) return;
      setTab('home');
      setSelectedOptionThread(focusOptionRequestId);
      onConsumedFocusOption?.();
    })();
    return () => {
      cancelled = true;
    };
  }, [focusOptionRequestId, profile?.id, onConsumedFocusOption]);

  const loadCalendar = async (modelId: string) => {
    const [legacyEntries, bookingEvents] = await Promise.all([
      getCalendarForModel(modelId),
      getBookingEventsForModel(modelId),
    ]);
    const coveredOptionIds = new Set(legacyEntries.map((e) => e.option_request_id).filter(Boolean));
    const coveredDateModel = new Set(
      legacyEntries.filter((e) => e.model_id).map((e) => `${e.date ?? ''}|${e.model_id}`),
    );
    const coveredDateNames = new Set(
      legacyEntries
        .filter((e) => e.title)
        .map((e) => `${e.date ?? ''}|${(e.title ?? '').trim().toLowerCase()}`),
    );
    const stripAffixes = (t: string): string => {
      const pres = [
        'option \u2013 ',
        'casting \u2013 ',
        'job \u2013 ',
        'booking \u2013 ',
        'option - ',
        'casting - ',
        'job - ',
        'booking - ',
      ];
      const sufs = [
        ' \u2013 option',
        ' \u2013 casting',
        ' \u2013 job',
        ' \u2013 booking',
        ' - option',
        ' - casting',
        ' - job',
        ' - booking',
      ];
      let r = t;
      for (const p of pres) {
        if (r.startsWith(p)) {
          r = r.slice(p.length);
          break;
        }
      }
      for (const s of sufs) {
        if (r.endsWith(s)) {
          r = r.slice(0, -s.length);
          break;
        }
      }
      return r.trim();
    };
    const coveredDateStripped = new Set(
      legacyEntries
        .filter((e) => e.title)
        .map((e) => `${e.date ?? ''}|${stripAffixes((e.title ?? '').trim().toLowerCase())}`),
    );
    const beEntries = bookingEvents.map(bookingEventToCalendarEntry).filter((be) => {
      if (be.option_request_id && coveredOptionIds.has(be.option_request_id)) return false;
      if (be.model_id && coveredDateModel.has(`${be.date ?? ''}|${be.model_id}`)) return false;
      const beName = (be.title ?? '').trim().toLowerCase();
      const beDate = be.date ?? '';
      if (beName && beDate && coveredDateNames.has(`${beDate}|${beName}`)) return false;
      if (beName && beDate) {
        const stripped = stripAffixes(beName);
        if (stripped && coveredDateNames.has(`${beDate}|${stripped}`)) return false;
        if (stripped && coveredDateStripped.has(`${beDate}|${stripped}`)) return false;
        for (const k of coveredDateNames) {
          if (!k.startsWith(`${beDate}|`)) continue;
          const n = k.slice(beDate.length + 1);
          if (n && (beName.includes(n) || n.includes(stripped))) return false;
        }
      }
      return true;
    });
    setCalEntries([...legacyEntries, ...beEntries]);
  };

  const loadPendingConfirmations = async (modelId: string) => {
    const items = await getPendingModelConfirmations(modelId);
    setPendingConfirmations(items);
  };

  useEffect(() => {
    if (profile?.id) {
      void loadPendingConfirmations(profile.id);
    }
  }, [profile?.id]);

  const handleConfirmBooking = async (id: string) => {
    setConfirmingBookingId(id);
    const ok = await modelConfirmOptionRequest(id);
    setConfirmingBookingId(null);
    if (ok && profile) {
      await refreshOptionRequestInCache(id, { modelSafe: true });
      await loadPendingConfirmations(profile.id);
      await loadCalendar(profile.id);
    } else if (!ok) {
      Alert.alert(
        uiCopy.common.error ?? 'Error',
        'Could not confirm availability. The agency may not have confirmed yet, or the request status has changed. Please try again later.',
      );
    }
  };

  const handleRejectBooking = async (id: string) => {
    setRejectingBookingId(id);
    const ok = await modelRejectOptionRequest(id);
    setRejectingBookingId(null);
    if (ok && profile) {
      await refreshOptionRequestInCache(id, { modelSafe: true });
      await loadPendingConfirmations(profile.id);
      await loadCalendar(profile.id);
    } else if (!ok) {
      Alert.alert(
        uiCopy.common.error ?? 'Error',
        'Could not decline the request. Please try again later.',
      );
    }
  };

  const outstandingOptions = useMemo(() => {
    if (!profile) return [];
    const all = getOutstandingOptionsForModel(profile.id);
    const confirmedIds = new Set(pendingConfirmations.map((c) => c.id));
    return all.filter((o) => !confirmedIds.has(o.threadId));
  }, [profile, pendingConfirmations]);

  const jobTickets = useMemo(
    () =>
      profile
        ? options.filter((o) => {
            if (o.modelId !== profile.id) return false;
            if (o.finalStatus === 'job_confirmed') return true;
            if (o.finalStatus === 'option_confirmed') {
              const pendingModelApproval =
                o.modelAccountLinked === true && o.modelApproval === 'pending';
              return !pendingModelApproval;
            }
            return false;
          })
        : [],
    [profile, options],
  );

  useEffect(() => {
    if (!selectedOptionThread) {
      setOptionChatAgency(null);
      return;
    }
    const r = getRequestByThreadId(selectedOptionThread);
    if (r?.agencyId) getAgencyById(r.agencyId).then(setOptionChatAgency);
    else setOptionChatAgency(null);
  }, [selectedOptionThread]);

  useEffect(() => {
    const req = selectedOptionThread ? getRequestByThreadId(selectedOptionThread) : undefined;
    if (!req) return;
    const unsub = subscribeToOptionMessages(req.id, () => {
      loadMessagesForThread(selectedOptionThread!, { viewerRole: 'model' });
      refreshOptionRequestInCache(selectedOptionThread!, { modelSafe: true });
    });
    return unsub;
  }, [selectedOptionThread]);

  useEffect(() => {
    if (!openEntry) return;
    setEntryScheduleDraft({
      date: openEntry.date,
      start_time: (openEntry.start_time ?? '09:00').toString().slice(0, 5),
      end_time: (openEntry.end_time ?? '10:00').toString().slice(0, 5),
      title: openEntry.title ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEntry?.id]);

  const modelEventsByDate = useMemo(
    () => buildEventsByDateFromModelEntries(calEntries),
    [calEntries],
  );

  const focusDateModel = selectedDate ?? todayYmd();
  const modelWeekStart = useMemo(() => startOfWeekMonday(focusDateModel), [focusDateModel]);
  const modelWeekDates = useMemo(() => weekDayDates(modelWeekStart), [modelWeekStart]);
  const modelWeekEvents = useMemo(
    () => filterModelScheduleBlocksForWeek(calEntries, modelWeekDates),
    [calEntries, modelWeekDates],
  );
  const modelDayEvents = useMemo(
    () => filterModelScheduleBlocksForDate(calEntries, focusDateModel),
    [calEntries, focusDateModel],
  );

  const modelWeekRangeLabel = useMemo(() => {
    const a = new Date(`${modelWeekDates[0]}T12:00:00`);
    const b = new Date(`${modelWeekDates[6]}T12:00:00`);
    return `${a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${b.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }, [modelWeekDates]);

  const modelDayDateLabel = useMemo(() => {
    const d = new Date(`${focusDateModel}T12:00:00`);
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }, [focusDateModel]);

  const modelCalendarViewHint = useMemo(() => {
    if (calendarViewMode === 'week') return uiCopy.calendar.viewModeHintWeek;
    if (calendarViewMode === 'day') return uiCopy.calendar.viewModeHintDay;
    return uiCopy.calendar.viewModeHintMonth;
  }, [calendarViewMode]);

  const shiftModelFocus = (d: string) => {
    setSelectedDate(d);
    const [y, m] = d.split('-').map(Number);
    setCalMonth({ year: y, month: m - 1 });
  };

  const handleAddPersonalEntry = async () => {
    if (!profile || !selectedDate || addingEntry) return;
    setAddingEntry(true);
    try {
      const created = await insertCalendarEntry(profile.id, selectedDate, 'blocked', {
        start_time: newEntryStart,
        end_time: newEntryEnd,
        title: newEntryTitle.trim() || 'Personal',
        entry_type: 'personal',
      });
      if (!created) {
        Alert.alert('Calendar', uiCopy.alerts.calendarNotSaved);
        return;
      }
      setNewEntryTitle('');
      loadCalendar(profile.id);
    } finally {
      setAddingEntry(false);
    }
  };

  // Approve/reject for store-based options is unused since the DB-based
  // "Booking requests" (pendingConfirmations) section handles model actions.
  // Legacy store functions (approveOptionAsModel / rejectOptionAsModel)
  // remain available in the store if needed for future flows.

  const insets = useSafeAreaInsets();
  const bottomTabInset = BOTTOM_TAB_BAR_HEIGHT + insets.bottom;

  const resetModelTabRoot = useCallback(() => {
    switch (tab) {
      case 'calendar':
        setOpenEntry(null);
        setSelectedDate(null);
        break;
      case 'messages':
        setOpenBookingThreadId(null);
        setOpenDirectConvId(null);
        break;
      case 'home':
        setSelectedOptionThread(null);
        setOptChatInput('');
        break;
      default:
        break;
    }
  }, [tab]);

  const handleModelTabPress = useCallback(
    (key: ModelTab) => {
      handleTabPress({
        current: tab,
        next: key,
        setTab,
        onReselectRoot: resetModelTabRoot,
      });
    },
    [tab, resetModelTabRoot],
  );

  if (!profile) {
    return (
      <View style={st.container}>
        <Text style={st.label}>Model profile</Text>
        <Text style={st.metaText}>Loading profile...</Text>
      </View>
    );
  }

  return (
    <View
      style={[
        st.container,
        {
          paddingTop: Math.max(spacing.xs, insets.top + 2),
          paddingHorizontal: isMobileModel ? spacing.sm : spacing.lg,
        },
      ]}
    >
      <View style={st.topShell}>
        <Text style={st.brand}>INDEX CASTING</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <TouchableOpacity
            onPress={() => {
              const subject = encodeURIComponent('Help Request – Model – Casting Index');
              const body = encodeURIComponent('Hello Casting Index Team,\n\nI need help with:\n\n');
              Linking.openURL(`mailto:admin@castingindex.com?subject=${subject}&body=${body}`);
            }}
          >
            <Text
              style={{ ...typography.headingCompact, fontSize: 11, color: colors.textSecondary }}
            >
              Help
            </Text>
          </TouchableOpacity>
          {onBackToRoleSelection && (
            <TouchableOpacity
              onPress={onBackToRoleSelection}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text
                style={{ ...typography.headingCompact, fontSize: 11, color: colors.textSecondary }}
              >
                Logout
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      <Text style={st.heading}>{profile.name}</Text>

      <View style={{ flex: 1, paddingBottom: bottomTabInset }}>
        {tab === 'settings' && (
          <ScrollView style={{ flex: 1 }}>
            {modelAgencyCtx.agencies.length > 1 && (
              <View style={st.section}>
                <Text style={st.sectionLabel}>{uiCopy.model.switchAgencyLabel}</Text>
                <Text style={st.metaText}>
                  Active:{' '}
                  {modelAgencyCtx.activeRow
                    ? `${modelAgencyCtx.activeRow.agencyName} · ${modelAgencyCtx.activeRow.territory}`
                    : '—'}
                </Text>
                <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
                  {modelAgencyCtx.agencies
                    .filter(
                      (a) =>
                        makeModelAgencyKey(a.agencyId, a.territory) !==
                        modelAgencyCtx.activeRepresentationKey,
                    )
                    .map((a) => (
                      <TouchableOpacity
                        key={makeModelAgencyKey(a.agencyId, a.territory)}
                        style={{
                          backgroundColor: colors.surface,
                          borderRadius: 10,
                          paddingVertical: spacing.sm,
                          paddingHorizontal: spacing.md,
                          borderWidth: 1,
                          borderColor: colors.border,
                        }}
                        onPress={() => modelAgencyCtx.switchRepresentation(a)}
                      >
                        <Text
                          style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}
                        >
                          {a.agencyName}
                        </Text>
                        <Text style={{ fontSize: 11, color: colors.textSecondary }}>
                          {a.territory}
                        </Text>
                      </TouchableOpacity>
                    ))}
                </View>
              </View>
            )}
            {modelAgencyCtx.agencies.length === 0 && (
              <View style={st.section}>
                <Text style={st.sectionLabel}>Agency</Text>
                <Text style={st.metaText}>{uiCopy.model.noAgencyProfiles}</Text>
              </View>
            )}
            <View style={st.section}>
              <Text style={st.sectionLabel}>About</Text>
              <Text style={st.metaText}>Base city: {profile.city || '—'}</Text>
              <Text style={st.metaText}>Hair: {profile.hairColor || '—'}</Text>
            </View>
            {/* ── Location Section ─────────────────────────────── */}
            <View style={st.section}>
              <Text style={st.sectionLabel}>Location</Text>

              {modelLocation ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderRadius: 10,
                    padding: spacing.sm,
                    marginBottom: spacing.md,
                    backgroundColor:
                      modelLocation.source === 'live'
                        ? '#e8f5e9'
                        : modelLocation.source === 'current'
                          ? '#e3f2fd'
                          : '#fff3e0',
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...typography.label, fontSize: 12, color: colors.textPrimary }}>
                      {[modelLocation.city, modelLocation.country_code]
                        .filter(Boolean)
                        .join(', ') || 'Location set'}
                    </Text>
                    <Text
                      style={{
                        ...typography.body,
                        fontSize: 10,
                        color: colors.textSecondary,
                        marginTop: 2,
                      }}
                    >
                      {locationSourceLabel(modelLocation.source)}
                      {modelLocation.lat_approx != null ? ' · Near Me active' : ''}
                      {modelLocation.source === 'agency' ? ' · Set by agency' : ''}
                    </Text>
                  </View>
                  {modelLocation.source !== 'agency' && (
                    <TouchableOpacity
                      onPress={() => {
                        void handleRemoveLocation();
                      }}
                      disabled={removingLocation}
                      style={{ paddingHorizontal: spacing.sm, paddingVertical: 6 }}
                    >
                      <Text style={{ fontSize: 11, color: colors.error, fontWeight: '600' }}>
                        {removingLocation ? '…' : '✕'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <Text
                  style={{
                    ...typography.body,
                    fontSize: 12,
                    color: colors.textSecondary,
                    marginBottom: spacing.sm,
                  }}
                >
                  No active location. Set one below to appear in Near Me searches.
                </Text>
              )}

              <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                <TextInput
                  placeholder="Country (DE)"
                  value={currentCountryInput}
                  onChangeText={setCurrentCountryInput}
                  maxLength={2}
                  autoCapitalize="characters"
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 10,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 8,
                    ...typography.body,
                    fontSize: 13,
                  }}
                />
                <TextInput
                  placeholder="City name"
                  value={currentCityInput}
                  onChangeText={setCurrentCityInput}
                  style={{
                    flex: 3,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 10,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 8,
                    ...typography.body,
                    fontSize: 13,
                  }}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TouchableOpacity
                  onPress={() => {
                    void handleSetCurrentCity();
                  }}
                  disabled={
                    currentCityLoading || !currentCityInput.trim() || !currentCountryInput.trim()
                  }
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    borderRadius: 999,
                    backgroundColor: '#1565c0',
                    paddingVertical: 10,
                    opacity:
                      currentCityLoading || !currentCityInput.trim() || !currentCountryInput.trim()
                        ? 0.4
                        : 1,
                  }}
                >
                  {currentCityLoading && <ActivityIndicator size="small" color="#fff" />}
                  <Text style={{ ...typography.label, color: '#fff', fontSize: 12 }}>
                    {currentCityLoading ? 'Saving…' : 'Set city'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    void handleShareLocation();
                  }}
                  disabled={locationLoading}
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    borderRadius: 999,
                    backgroundColor: colors.accentGreen,
                    paddingVertical: 10,
                    opacity: locationLoading ? 0.5 : 1,
                  }}
                >
                  {locationLoading && <ActivityIndicator size="small" color="#fff" />}
                  <Text style={{ ...typography.label, color: '#fff', fontSize: 12 }}>
                    {locationLoading ? 'Locating…' : 'Share GPS'}
                  </Text>
                </TouchableOpacity>
              </View>
              <Text
                style={{
                  ...typography.body,
                  fontSize: 10,
                  color: colors.textSecondary,
                  marginTop: 4,
                }}
              >
                GPS shares your approximate city (±5 km). No exact coordinates are stored.
              </Text>
            </View>
            {/* ── End Location Section ──────────────────────── */}
            <View style={st.section}>
              <Text style={st.sectionLabel}>Measurements</Text>
              <View style={st.measureRow}>
                <Measure label={uiCopy.modelEdit.heightLabel} value={profile.height} />
                <Measure label={uiCopy.modelEdit.chestLabel} value={profile.chest} />
                <Measure label={uiCopy.modelEdit.waistLabel} value={profile.waist} />
                <Measure label={uiCopy.modelEdit.hipsLabel} value={profile.hips} />
              </View>
            </View>

            {/* ── My Portfolio Section ──────────────────────── */}
            {modelPhotos.length > 0 && (
              <View style={st.section}>
                <Text style={st.sectionLabel}>My Portfolio</Text>
                <Text
                  style={{
                    ...typography.body,
                    fontSize: 11,
                    color: colors.textSecondary,
                    marginBottom: spacing.sm,
                  }}
                >
                  Photos managed by your agency. Contact your agency if you want to update these.
                </Text>
                {(() => {
                  const portfolioPhotos = modelPhotos.filter((p) => p.photo_type === 'portfolio');
                  const polaroidPhotos = modelPhotos.filter((p) => p.photo_type === 'polaroid');
                  return (
                    <>
                      {portfolioPhotos.length > 0 && (
                        <>
                          <Text
                            style={{
                              ...typography.label,
                              fontSize: 11,
                              color: colors.textSecondary,
                              marginBottom: 4,
                            }}
                          >
                            Portfolio ({portfolioPhotos.length})
                          </Text>
                          <View
                            style={{
                              flexDirection: 'row',
                              flexWrap: 'wrap',
                              gap: spacing.sm,
                              marginBottom: spacing.md,
                            }}
                          >
                            {portfolioPhotos.map((photo) => (
                              <View
                                key={photo.id}
                                style={{
                                  width: isMobileModel ? 100 : 120,
                                  height: isMobileModel ? 140 : 168,
                                  borderRadius: 8,
                                  overflow: 'hidden',
                                  borderWidth: 1,
                                  borderColor: colors.border,
                                  backgroundColor: '#f5f5f5',
                                }}
                              >
                                <StorageImage
                                  uri={photo.url}
                                  style={{ width: '100%', height: '100%' }}
                                  resizeMode="contain"
                                />
                              </View>
                            ))}
                          </View>
                        </>
                      )}
                      {polaroidPhotos.length > 0 && (
                        <>
                          <Text
                            style={{
                              ...typography.label,
                              fontSize: 11,
                              color: colors.textSecondary,
                              marginBottom: 4,
                            }}
                          >
                            Polaroids ({polaroidPhotos.length})
                          </Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                            {polaroidPhotos.map((photo) => (
                              <View
                                key={photo.id}
                                style={{
                                  width: isMobileModel ? 80 : 100,
                                  height: isMobileModel ? 80 : 100,
                                  borderRadius: 8,
                                  overflow: 'hidden',
                                  borderWidth: 1,
                                  borderColor: colors.border,
                                  backgroundColor: '#f5f5f5',
                                }}
                              >
                                <StorageImage
                                  uri={photo.url}
                                  style={{ width: '100%', height: '100%' }}
                                  resizeMode="contain"
                                />
                              </View>
                            ))}
                          </View>
                        </>
                      )}
                    </>
                  );
                })()}
              </View>
            )}
            {/* ── End My Portfolio Section ──────────────────── */}

            <View
              style={[
                st.section,
                {
                  marginTop: spacing.lg,
                  paddingTop: spacing.md,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                },
              ]}
            >
              <Text style={st.sectionLabel}>{uiCopy.privacyData.sectionTitle}</Text>
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
                onPress={() => void onExportData()}
                disabled={exportingData}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  paddingVertical: spacing.md,
                  alignItems: 'center',
                  marginBottom: spacing.md,
                  opacity: exportingData ? 0.6 : 1,
                }}
              >
                <Text style={{ ...typography.label, color: colors.textSecondary }}>
                  {exportingData
                    ? uiCopy.privacyData.preparingExport
                    : uiCopy.privacyData.downloadMyData}
                </Text>
              </TouchableOpacity>
            </View>

            <View
              style={[
                st.section,
                {
                  marginTop: spacing.xl,
                  paddingTop: spacing.lg,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                },
              ]}
            >
              <Text style={st.sectionLabel}>{uiCopy.accountDeletion.sectionTitle}</Text>
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
                          const { requestAccountDeletion } =
                            await import('../services/accountSupabase');
                          const res = await requestAccountDeletion();
                          setDeletingAccount(false);
                          if (res.ok) {
                            await signOut();
                            return;
                          }
                          Alert.alert(uiCopy.common.error, uiCopy.accountDeletion.failed);
                        },
                      },
                    ],
                  );
                }}
                disabled={deletingAccount}
                style={{
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: colors.error,
                  paddingVertical: spacing.sm,
                  alignItems: 'center',
                }}
              >
                <Text style={{ ...typography.label, fontSize: 12, color: colors.error }}>
                  {deletingAccount
                    ? uiCopy.accountDeletion.buttonWorking
                    : uiCopy.accountDeletion.button}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}

        {tab === 'calendar' && (
          <ScrollView style={{ flex: 1 }}>
            <CalendarViewModeBar
              mode={calendarViewMode}
              onModeChange={setCalendarViewMode}
              monthLabel={uiCopy.dashboard.monthViewLabel}
              weekLabel={uiCopy.dashboard.weekViewLabel}
              dayLabel={uiCopy.calendar.dayViewLabel}
              compact={false}
              sectionTitle={uiCopy.calendar.viewModeHeading}
              sectionHint={modelCalendarViewHint}
            />

            {calendarViewMode === 'month' && (
              <MonthCalendarView
                year={calMonth.year}
                month={calMonth.month}
                eventsByDate={modelEventsByDate}
                selectedDate={selectedDate}
                compact={false}
                onSelectDay={(d) => {
                  shiftModelFocus(d);
                  setCalendarViewMode('day');
                }}
                onPrevMonth={() =>
                  setCalMonth((p) =>
                    p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 },
                  )
                }
                onNextMonth={() =>
                  setCalMonth((p) =>
                    p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 },
                  )
                }
              />
            )}

            {calendarViewMode === 'week' && (
              <CalendarWeekGrid
                weekDates={modelWeekDates}
                events={modelWeekEvents}
                selectedDate={selectedDate}
                onSelectDay={(d) => shiftModelFocus(d)}
                onEventPress={(ev) => {
                  const entry = calEntries.find((e) => e.id === ev.id);
                  if (!entry) return;
                  setOpenEntry(entry);
                  setSharedNoteDraft('');
                  const existing =
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (entry.booking_details as any)?.model_notes ?? entry.note ?? '';
                  setModelNotesDraft(existing);
                }}
                onPrevWeek={() => shiftModelFocus(addDaysYmd(focusDateModel, -7))}
                onNextWeek={() => shiftModelFocus(addDaysYmd(focusDateModel, 7))}
                rangeLabel={modelWeekRangeLabel}
              />
            )}

            {calendarViewMode === 'day' && (
              <CalendarDayTimeline
                dateLabel={modelDayDateLabel}
                events={modelDayEvents}
                onEventPress={(ev) => {
                  const entry = calEntries.find((e) => e.id === ev.id);
                  if (!entry) return;
                  setOpenEntry(entry);
                  setSharedNoteDraft('');
                  const existing =
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (entry.booking_details as any)?.model_notes ?? entry.note ?? '';
                  setModelNotesDraft(existing);
                }}
                onPrevDay={() => shiftModelFocus(addDaysYmd(focusDateModel, -1))}
                onNextDay={() => shiftModelFocus(addDaysYmd(focusDateModel, 1))}
              />
            )}

            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: spacing.md,
                marginBottom: spacing.md,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: calendarEntryColor('personal'),
                  }}
                />
                <Text style={st.metaText}>{uiCopy.dashboard.colorPersonalLabel}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: calendarEntryColor('booking'),
                  }}
                />
                <Text style={st.metaText}>{uiCopy.dashboard.threadContextBooking}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: calendarEntryColor('option'),
                  }}
                />
                <Text style={st.metaText}>{uiCopy.dashboard.colorOptionLabel}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: calendarEntryColor('casting'),
                  }}
                />
                <Text style={st.metaText}>{uiCopy.dashboard.colorCastingLabel}</Text>
              </View>
            </View>

            {calendarViewMode === 'day' && selectedDate && (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  padding: spacing.md,
                  marginBottom: spacing.md,
                }}
              >
                <Text style={st.sectionLabel}>Add personal entry</Text>
                <TextInput
                  value={newEntryTitle}
                  onChangeText={setNewEntryTitle}
                  placeholder="Title (e.g. Gym, Casting prep)"
                  placeholderTextColor={colors.textSecondary}
                  style={[st.input, { marginBottom: spacing.sm }]}
                />
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...typography.label, fontSize: 9, color: colors.textSecondary }}>
                      Start
                    </Text>
                    <ScrollView
                      style={{
                        maxHeight: 80,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: 8,
                      }}
                    >
                      {HOURS.map((t) => (
                        <TouchableOpacity
                          key={t}
                          onPress={() => setNewEntryStart(t)}
                          style={{
                            padding: 4,
                            backgroundColor: newEntryStart === t ? colors.success : 'transparent',
                          }}
                        >
                          <Text
                            style={{
                              ...typography.body,
                              fontSize: 10,
                              color: newEntryStart === t ? '#fff' : colors.textPrimary,
                            }}
                          >
                            {t}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...typography.label, fontSize: 9, color: colors.textSecondary }}>
                      End
                    </Text>
                    <ScrollView
                      style={{
                        maxHeight: 80,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: 8,
                      }}
                    >
                      {HOURS.map((t) => (
                        <TouchableOpacity
                          key={t}
                          onPress={() => setNewEntryEnd(t)}
                          style={{
                            padding: 4,
                            backgroundColor: newEntryEnd === t ? colors.success : 'transparent',
                          }}
                        >
                          <Text
                            style={{
                              ...typography.body,
                              fontSize: 10,
                              color: newEntryEnd === t ? '#fff' : colors.textPrimary,
                            }}
                          >
                            {t}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={handleAddPersonalEntry}
                  disabled={addingEntry}
                  style={{
                    borderRadius: 999,
                    backgroundColor: colors.success,
                    paddingVertical: spacing.sm,
                    alignItems: 'center',
                    opacity: addingEntry ? 0.5 : 1,
                  }}
                >
                  <Text style={{ ...typography.label, color: '#fff' }}>
                    {addingEntry ? 'Saving…' : 'Add entry'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        )}

        {tab === 'messages' && (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingBottom: spacing.xl,
              paddingHorizontal: spacing.md,
              paddingTop: spacing.sm,
            }}
          >
            {(() => {
              type UnifiedRow =
                | {
                    kind: 'option';
                    id: string;
                    label: string;
                    sub: string;
                    actionRequired: boolean;
                    ts: number;
                    requestType: string;
                  }
                | { kind: 'direct'; id: string; label: string; ts: number }
                | { kind: 'recruiting'; id: string; label: string; ts: number };
              const rows: UnifiedRow[] = [];
              for (const o of options) {
                const isAction = modelInboxRequiresModelConfirmation({
                  status: o.status,
                  finalStatus: o.finalStatus,
                  modelApproval: o.modelApproval ?? 'pending',
                  modelAccountLinked: o.modelAccountLinked ?? false,
                });
                rows.push({
                  kind: 'option',
                  id: o.threadId,
                  label: primaryCounterpartyLabelForModel(o),
                  sub: secondarySubtitleForModel(o),
                  actionRequired: isAction,
                  ts: o.createdAt ?? 0,
                  requestType: o.requestType ?? 'option',
                });
              }
              for (const conv of agencyDirectConvs) {
                rows.push({
                  kind: 'direct',
                  id: conv.id,
                  label: conv.title ?? uiCopy.b2bChat.conversationFallback,
                  ts: conv.updated_at ? new Date(conv.updated_at).getTime() : 0,
                });
              }
              for (const id of bookingThreadIds) {
                const t = getRecruitingThread(id);
                if (!t) continue;
                rows.push({
                  kind: 'recruiting',
                  id,
                  label: bookingAgencyByThread[id] ?? uiCopy.b2bChat.conversationFallback,
                  ts: t.createdAt ?? 0,
                });
              }
              rows.sort((a, b) => {
                if (
                  a.kind === 'option' &&
                  (a as Extract<UnifiedRow, { kind: 'option' }>).actionRequired &&
                  !(
                    b.kind === 'option' &&
                    (b as Extract<UnifiedRow, { kind: 'option' }>).actionRequired
                  )
                )
                  return -1;
                if (
                  b.kind === 'option' &&
                  (b as Extract<UnifiedRow, { kind: 'option' }>).actionRequired &&
                  !(
                    a.kind === 'option' &&
                    (a as Extract<UnifiedRow, { kind: 'option' }>).actionRequired
                  )
                )
                  return 1;
                return b.ts - a.ts;
              });

              if (rows.length === 0) {
                return (
                  <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
                    <Text
                      style={{
                        ...typography.body,
                        fontSize: 13,
                        color: colors.textSecondary,
                        textAlign: 'center',
                      }}
                    >
                      {uiCopy.model.noAgencyMessages}
                    </Text>
                  </View>
                );
              }

              return rows.map((row) => {
                if (row.kind === 'option') {
                  const o = row as Extract<UnifiedRow, { kind: 'option' }>;
                  const typeLabel =
                    o.requestType === 'casting'
                      ? uiCopy.dashboard.threadContextCasting
                      : uiCopy.dashboard.threadContextOption;
                  return (
                    <TouchableOpacity
                      key={`opt-${o.id}`}
                      style={[
                        st.chatRow,
                        o.actionRequired && { borderColor: '#f59e0b', backgroundColor: '#fffbeb' },
                      ]}
                      onPress={() => {
                        setSelectedOptionThread(o.id);
                        void loadMessagesForThread(o.id, { viewerRole: 'model' });
                      }}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        {o.actionRequired && (
                          <Text
                            style={{
                              fontSize: 9,
                              fontWeight: '700',
                              color: '#b45309',
                              textTransform: 'uppercase',
                              letterSpacing: 0.6,
                              marginBottom: 2,
                            }}
                          >
                            {uiCopy.dashboard.smartAttentionLabel}
                          </Text>
                        )}
                        <Text style={st.chatRowKicker}>{typeLabel}</Text>
                        <Text style={st.chatRowLabel} numberOfLines={1}>
                          {o.label}
                        </Text>
                        <Text style={{ fontSize: 11, color: colors.textSecondary }}>{o.sub}</Text>
                      </View>
                      <Text style={st.chatRowOpen}>Open</Text>
                    </TouchableOpacity>
                  );
                }
                if (row.kind === 'direct') {
                  return (
                    <TouchableOpacity
                      key={`dir-${row.id}`}
                      style={st.chatRow}
                      onPress={() => setOpenDirectConvId(row.id)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={st.chatRowKicker}>{uiCopy.model.agencyChatRowKicker}</Text>
                        <Text style={st.chatRowLabel}>{row.label}</Text>
                      </View>
                      <Text style={st.chatRowOpen}>Open</Text>
                    </TouchableOpacity>
                  );
                }
                return (
                  <TouchableOpacity
                    key={`rec-${row.id}`}
                    style={st.chatRow}
                    onPress={() => setOpenBookingThreadId(row.id)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={st.chatRowKicker}>{uiCopy.model.agencyChatRowKicker}</Text>
                      <Text style={st.chatRowLabel}>{row.label}</Text>
                    </View>
                    <Text style={st.chatRowOpen}>Open</Text>
                  </TouchableOpacity>
                );
              });
            })()}
          </ScrollView>
        )}

        {tab === 'home' && (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1, paddingBottom: spacing.xl * 2 }}
          >
            {pendingConfirmations.length > 0 && (
              <View style={{ marginBottom: spacing.lg }}>
                <Text style={st.sectionLabel}>Action required</Text>
                <Text style={st.metaText}>
                  Your agency confirmed these. Please accept or decline availability.
                </Text>
                {pendingConfirmations.map((req) => (
                  <View
                    key={req.id}
                    style={{
                      borderWidth: 1,
                      borderColor: colors.warningDark,
                      borderRadius: 12,
                      padding: spacing.md,
                      marginTop: spacing.sm,
                      backgroundColor: '#FFF3E0',
                    }}
                  >
                    <Text style={{ ...typography.label, color: '#BF360C', marginBottom: 2 }}>
                      {req.request_type === 'casting'
                        ? uiCopy.dashboard.threadContextCasting
                        : uiCopy.dashboard.threadContextOption}
                    </Text>
                    {(req.agency_organization_name ??
                    req.client_organization_name ??
                    req.client_name) ? (
                      <Text
                        style={{
                          ...typography.body,
                          fontSize: 12,
                          color: colors.textPrimary,
                          fontWeight: '600',
                          marginBottom: 2,
                        }}
                      >
                        {req.agency_organization_name ??
                          req.client_organization_name ??
                          req.client_name}
                      </Text>
                    ) : null}
                    <Text
                      style={{
                        ...typography.body,
                        fontSize: 12,
                        color: colors.textSecondary,
                        marginBottom: req.job_description ? 2 : spacing.sm,
                      }}
                    >
                      {req.requested_date}
                      {req.start_time ? ` · ${stripClockSeconds(String(req.start_time))}` : ''}
                      {req.end_time ? `–${stripClockSeconds(String(req.end_time))}` : ''}
                    </Text>
                    {req.job_description ? (
                      <Text
                        style={{
                          ...typography.body,
                          fontSize: 12,
                          color: colors.textSecondary,
                          fontStyle: 'italic',
                          marginBottom: spacing.sm,
                        }}
                        numberOfLines={2}
                      >
                        {req.job_description}
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      <TouchableOpacity
                        onPress={() => setOptionActionModal({ id: req.id, action: 'confirm' })}
                        disabled={confirmingBookingId === req.id || rejectingBookingId === req.id}
                        style={{
                          flex: 1,
                          borderRadius: 999,
                          backgroundColor: colors.accentGreen,
                          paddingVertical: spacing.sm,
                          alignItems: 'center',
                          opacity:
                            confirmingBookingId === req.id || rejectingBookingId === req.id
                              ? 0.5
                              : 1,
                        }}
                      >
                        <Text style={{ ...typography.label, color: '#fff' }}>
                          {confirmingBookingId === req.id ? 'Confirming…' : 'Accept'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setOptionActionModal({ id: req.id, action: 'reject' })}
                        disabled={confirmingBookingId === req.id || rejectingBookingId === req.id}
                        style={{
                          flex: 1,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: colors.buttonSkipRed,
                          paddingVertical: spacing.sm,
                          alignItems: 'center',
                          opacity:
                            confirmingBookingId === req.id || rejectingBookingId === req.id
                              ? 0.5
                              : 1,
                        }}
                      >
                        <Text style={{ ...typography.label, color: colors.buttonSkipRed }}>
                          {rejectingBookingId === req.id ? 'Declining…' : 'Decline'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            <View style={{ marginBottom: spacing.lg }}>
              <Text style={st.sectionLabel}>Confirmed jobs</Text>
              {jobTickets.length === 0 ? (
                <Text style={[st.metaText, { marginTop: spacing.xs }]}>No confirmed jobs yet.</Text>
              ) : (
                jobTickets.map((o) => (
                  <TouchableOpacity
                    key={o.threadId}
                    onPress={() => {
                      setSelectedOptionThread(o.threadId);
                      void loadMessagesForThread(o.threadId, { viewerRole: 'model' });
                    }}
                    style={{
                      borderWidth: 1,
                      borderColor: colors.accentGreen,
                      borderRadius: 12,
                      padding: spacing.md,
                      marginTop: spacing.sm,
                      backgroundColor: '#f0fdf4',
                    }}
                  >
                    <Text style={{ ...typography.label, color: colors.textPrimary }}>
                      {o.requestType === 'casting'
                        ? uiCopy.dashboard.threadContextCasting
                        : uiCopy.dashboard.threadContextOption}{' '}
                      ·{' '}
                      {o.finalStatus === 'job_confirmed'
                        ? uiCopy.dashboard.optionRequestStatusJobConfirmed
                        : uiCopy.dashboard.optionRequestStatusConfirmed}
                    </Text>
                    <Text
                      style={{
                        ...typography.body,
                        fontSize: 12,
                        color: colors.textPrimary,
                        fontWeight: '600',
                        marginBottom: 1,
                      }}
                    >
                      {o.agencyOrganizationName ?? o.clientOrganizationName ?? o.clientName}
                    </Text>
                    <Text style={st.metaText}>
                      {formatDateWithOptionalTimeRange(o.date, o.startTime, o.endTime)}
                    </Text>
                    {o.jobDescription ? (
                      <Text
                        style={{
                          ...typography.body,
                          fontSize: 12,
                          color: colors.textSecondary,
                          fontStyle: 'italic',
                          marginTop: 2,
                        }}
                        numberOfLines={2}
                      >
                        {o.jobDescription}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                ))
              )}
            </View>

            {outstandingOptions.length > 0 && (
              <View style={{ marginBottom: spacing.lg }}>
                <Text style={st.sectionLabel}>In negotiation</Text>
                <Text style={st.metaText}>
                  Your agency will ask for your availability once the booking is confirmed.
                </Text>
                {outstandingOptions.map((o) => (
                  <TouchableOpacity
                    key={o.threadId}
                    onPress={() => {
                      setSelectedOptionThread(o.threadId);
                      void loadMessagesForThread(o.threadId, { viewerRole: 'model' });
                    }}
                    style={{
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 12,
                      padding: spacing.md,
                      marginTop: spacing.sm,
                      backgroundColor: colors.surface,
                    }}
                  >
                    <Text
                      style={{ ...typography.label, fontSize: 11, color: colors.textSecondary }}
                    >
                      {o.requestType === 'casting'
                        ? uiCopy.dashboard.threadContextCasting
                        : uiCopy.dashboard.threadContextOption}
                    </Text>
                    <Text
                      style={{ ...typography.body, color: colors.textPrimary, fontWeight: '600' }}
                    >
                      {o.agencyOrganizationName ?? o.clientOrganizationName ?? o.clientName}
                    </Text>
                    <Text style={st.metaText}>
                      {formatDateWithOptionalTimeRange(o.date, o.startTime, o.endTime)}
                    </Text>
                    {o.jobDescription ? (
                      <Text
                        style={{
                          ...typography.body,
                          fontSize: 12,
                          color: colors.textSecondary,
                          fontStyle: 'italic',
                          marginTop: 2,
                        }}
                        numberOfLines={2}
                      >
                        {o.jobDescription}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {pendingConfirmations.length === 0 &&
              jobTickets.length === 0 &&
              outstandingOptions.length === 0 && (
                <View style={{ alignItems: 'center', paddingVertical: spacing.xl * 2 }}>
                  <Text
                    style={{
                      ...typography.body,
                      fontSize: 14,
                      color: colors.textSecondary,
                      textAlign: 'center',
                    }}
                  >
                    No active bookings or options.{'\n'}New requests from clients will appear here.
                  </Text>
                </View>
              )}
          </ScrollView>
        )}
      </View>

      {openBookingThreadId && (
        <BookingChatView
          threadId={openBookingThreadId}
          fromRole="model"
          initialAgencyName={bookingAgencyByThread[openBookingThreadId]}
          onClose={() => setOpenBookingThreadId(null)}
          presentation="insetAboveBottomNav"
          bottomInset={bottomTabInset}
        />
      )}

      {openDirectConvId && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: bottomTabInset,
            backgroundColor: colors.background,
            zIndex: 1000,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: spacing.md,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Text style={{ ...typography.label, fontSize: 13, color: colors.textSecondary }}>
              {agencyDirectConvs.find((c) => c.id === openDirectConvId)?.title ??
                uiCopy.b2bChat.conversationFallback}
            </Text>
            <TouchableOpacity onPress={() => setOpenDirectConvId(null)}>
              <Text style={{ ...typography.label, color: colors.textPrimary }}>Close</Text>
            </TouchableOpacity>
          </View>
          <OrgMessengerInline
            conversationId={openDirectConvId}
            headerTitle={
              agencyDirectConvs.find((c) => c.id === openDirectConvId)?.title ??
              uiCopy.b2bChat.conversationFallback
            }
            viewerUserId={userId ?? null}
            b2bViewerRole="model"
            composerBottomInsetOverride={0}
          />
        </View>
      )}

      <View style={[st.bottomTabBar, { paddingBottom: insets.bottom }]}>
        <View style={st.tabRow}>
          {[
            { key: 'home' as const, label: 'Home' },
            { key: 'calendar' as const, label: 'Calendar' },
            {
              key: 'messages' as const,
              label: pendingConfirmations.length
                ? `Messages (${pendingConfirmations.length})`
                : 'Messages',
            },
            { key: 'settings' as const, label: 'Settings' },
          ].map((t) => (
            <TouchableOpacity
              key={t.key}
              onPress={() => handleModelTabPress(t.key)}
              style={st.tabItem}
            >
              <Text style={[st.tabLabel, tab === t.key && st.tabLabelActive]}>{t.label}</Text>
              {tab === t.key && <View style={st.tabUnderline} />}
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {selectedOptionThread && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: bottomTabInset,
            zIndex: 995,
            // On mobile: fullscreen panel. On desktop: dimmed overlay with centered card.
            ...(isMobileModel
              ? { backgroundColor: colors.surface }
              : {
                  backgroundColor: 'rgba(0,0,0,0.1)',
                  justifyContent: 'center' as const,
                  alignItems: 'center' as const,
                  padding: spacing.lg,
                }),
          }}
        >
          <View
            style={{
              // Mobile: fill entire inset area. Desktop: floating card.
              ...(isMobileModel
                ? { flex: 1, backgroundColor: colors.surface, overflow: 'hidden' as const }
                : {
                    width: '100%',
                    maxWidth: optionChatOverlayMaxW,
                    maxHeight: '80%',
                    backgroundColor: colors.surface,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: colors.border,
                    overflow: 'hidden' as const,
                  }),
              padding: spacing.md,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: spacing.sm,
                flexShrink: 0,
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}
                >
                  {optionChatAgency?.logo_url ? (
                    <Image
                      source={{ uri: optionChatAgency.logo_url }}
                      style={{ width: 28, height: 28, borderRadius: 5 }}
                      resizeMode="contain"
                    />
                  ) : null}
                  <View>
                    <Text style={{ ...typography.label, fontSize: 9, color: colors.textSecondary }}>
                      {uiCopy.model.agencyChatRowKicker}
                    </Text>
                    <Text style={{ ...typography.label, color: colors.textPrimary }}>
                      {optionChatAgency?.name ?? uiCopy.model.agencyChatRowKicker}
                    </Text>
                  </View>
                </View>
                {(() => {
                  const r = getRequestByThreadId(selectedOptionThread!);
                  if (!r) return null;
                  const titleLine = primaryCounterpartyLabelForModel(r);
                  return (
                    <View
                      style={{
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.border,
                        paddingTop: 6,
                      }}
                    >
                      <Text
                        style={{
                          ...typography.body,
                          fontSize: 11,
                          color: colors.textPrimary,
                          fontWeight: '600',
                        }}
                        numberOfLines={2}
                      >
                        {titleLine}
                      </Text>
                      <Text
                        style={{ ...typography.body, fontSize: 11, color: colors.textSecondary }}
                      >
                        {r.requestType === 'casting'
                          ? uiCopy.dashboard.threadContextCasting
                          : uiCopy.dashboard.threadContextOption}
                        {' · '}
                        {formatDateWithOptionalTimeRange(r.date, r.startTime, r.endTime)}
                      </Text>
                      {r.jobDescription ? (
                        <View style={{ marginTop: 4 }}>
                          <Text
                            style={{
                              ...typography.label,
                              fontSize: 9,
                              color: colors.textSecondary,
                              marginBottom: 2,
                            }}
                          >
                            {uiCopy.model.optionThreadRoleDetails}
                          </Text>
                          <Text
                            style={{
                              ...typography.body,
                              fontSize: 11,
                              color: colors.textSecondary,
                            }}
                          >
                            {r.jobDescription}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })()}
              </View>
              <TouchableOpacity
                onPress={() => setSelectedOptionThread(null)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={{ marginLeft: spacing.sm }}
              >
                <Text style={{ ...typography.label, fontSize: 11, color: colors.textSecondary }}>
                  Close
                </Text>
              </TouchableOpacity>
            </View>
            {/* Messages: flex:1 on mobile fills remaining space; capped on desktop */}
            <ScrollView
              style={
                isMobileModel
                  ? { flex: 1, marginBottom: spacing.sm }
                  : { maxHeight: optionChatMessagesMaxH, marginBottom: spacing.sm }
              }
              contentContainerStyle={{ flexGrow: 1 }}
              keyboardShouldPersistTaps="handled"
            >
              {getMessages(selectedOptionThread).length >= 50 && selectedOptionThread && (
                <TouchableOpacity
                  onPress={() =>
                    void loadOlderMessagesForThread(selectedOptionThread, { viewerRole: 'model' })
                  }
                  style={{ alignSelf: 'center', paddingVertical: spacing.xs }}
                >
                  <Text style={{ color: colors.accentBrown, fontSize: 13 }}>
                    {uiCopy.b2bChat.loadOlderMessages}
                  </Text>
                </TouchableOpacity>
              )}
              {getMessages(selectedOptionThread)
                .filter((m) => shouldShowSystemMessageForViewer(m, 'model'))
                .map((msg) =>
                  msg.from === 'system' ? (
                    <View
                      key={msg.id}
                      style={{
                        alignSelf: 'center',
                        maxWidth: '90%',
                        paddingHorizontal: spacing.sm,
                        paddingVertical: spacing.xs,
                        borderRadius: 12,
                        marginBottom: spacing.xs,
                        backgroundColor: '#E8E6E3',
                      }}
                    >
                      <Text
                        style={{
                          ...typography.label,
                          fontSize: 9,
                          color: colors.textSecondary,
                          textAlign: 'center',
                        }}
                      >
                        {uiCopy.systemMessages.systemMessageLabel}
                      </Text>
                      <Text
                        style={{
                          ...typography.body,
                          fontSize: 12,
                          color: colors.textPrimary,
                          textAlign: 'center',
                        }}
                      >
                        {msg.text}
                      </Text>
                    </View>
                  ) : (
                    (() => {
                      const isOwn = msg.from === 'model';
                      const rc = isOwn ? outgoingSelfBubbleColors : bubbleColorsForSender(msg.from);
                      return (
                        <View
                          key={msg.id}
                          style={{
                            alignSelf: isOwn ? 'flex-end' : 'flex-start',
                            maxWidth: CHAT_BUBBLE_MAX_WIDTH,
                            marginLeft: isOwn ? '12%' : 0,
                            marginRight: isOwn ? spacing.sm : 0,
                            paddingHorizontal: spacing.sm,
                            paddingVertical: spacing.xs,
                            borderRadius: 12,
                            marginBottom: spacing.xs,
                            backgroundColor: rc.bubbleBackground,
                            borderWidth: StyleSheet.hairlineWidth,
                            borderColor: rc.borderColor,
                          }}
                        >
                          <Text style={{ ...typography.body, fontSize: 12, color: rc.bubbleText }}>
                            {msg.text}
                          </Text>
                        </View>
                      );
                    })()
                  ),
                )}
            </ScrollView>
            {(() => {
              const req = selectedOptionThread
                ? getRequestByThreadId(selectedOptionThread)
                : undefined;
              if (!req) return null;
              const needsConfirm = modelInboxRequiresModelConfirmation({
                status: req.status,
                finalStatus: req.finalStatus ?? null,
                modelApproval: req.modelApproval ?? null,
                modelAccountLinked: req.modelAccountLinked ?? false,
              });
              if (!needsConfirm) return null;
              return (
                <View
                  style={{
                    flexDirection: 'row',
                    gap: spacing.sm,
                    marginBottom: spacing.sm,
                    flexShrink: 0,
                  }}
                >
                  <TouchableOpacity
                    onPress={() => setOptionActionModal({ id: req.id, action: 'confirm' })}
                    disabled={confirmingBookingId === req.id || rejectingBookingId === req.id}
                    style={{
                      flex: 1,
                      backgroundColor: colors.buttonOptionGreen,
                      borderRadius: 8,
                      paddingVertical: spacing.sm + 2,
                      alignItems: 'center',
                      opacity:
                        confirmingBookingId === req.id || rejectingBookingId === req.id ? 0.5 : 1,
                    }}
                  >
                    <Text style={{ ...typography.label, color: '#fff' }}>
                      {confirmingBookingId === req.id
                        ? 'Confirming…'
                        : uiCopy.optionNegotiationChat.modelConfirmAvailabilityTitle}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setOptionActionModal({ id: req.id, action: 'reject' })}
                    disabled={confirmingBookingId === req.id || rejectingBookingId === req.id}
                    style={{
                      flex: 1,
                      borderWidth: 1,
                      borderColor: colors.buttonSkipRed,
                      borderRadius: 8,
                      paddingVertical: spacing.sm + 2,
                      alignItems: 'center',
                      opacity:
                        confirmingBookingId === req.id || rejectingBookingId === req.id ? 0.5 : 1,
                    }}
                  >
                    <Text style={{ ...typography.label, color: colors.buttonSkipRed }}>
                      {rejectingBookingId === req.id
                        ? 'Declining…'
                        : uiCopy.optionNegotiationChat.modelDeclineAvailabilityTitle}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })()}
            <View
              style={{
                flexDirection: 'row',
                gap: spacing.sm,
                alignItems: 'flex-end',
                flexShrink: 0,
              }}
            >
              <TextInput
                value={optChatInput}
                onChangeText={setOptChatInput}
                placeholder={uiCopy.model.composerPlaceholder}
                placeholderTextColor={colors.textSecondary}
                multiline
                blurOnSubmit={false}
                onContentSizeChange={(e) => setOptChatInputHeight(e.nativeEvent.contentSize.height)}
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 18,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  ...typography.body,
                  fontSize: 12,
                  color: colors.textPrimary,
                  minHeight: 36,
                  maxHeight: 120,
                  height: Math.max(36, Math.min(120, optChatInputHeight)),
                }}
              />
              <TouchableOpacity
                onPress={() => {
                  if (optChatInput.trim()) {
                    addMessage(selectedOptionThread, 'model', optChatInput.trim());
                    setOptChatInput('');
                    setOptChatInputHeight(36);
                  }
                }}
                style={{
                  borderRadius: 999,
                  backgroundColor: colors.buttonOptionGreen,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  justifyContent: 'center',
                }}
              >
                <Text style={{ ...typography.label, fontSize: 11, color: '#fff' }}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {openEntry && (
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
            paddingHorizontal: isMobileModel ? spacing.xs : spacing.lg,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: 480,
              maxHeight: '92%',
              borderRadius: 18,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              padding: isMobileModel ? spacing.md : spacing.lg,
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
              <Text style={st.sectionLabel}>Calendar entry</Text>
              <TouchableOpacity
                onPress={() => {
                  setOpenEntry(null);
                  setModelNotesDraft('');
                }}
              >
                <Text style={st.backLabel}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              contentContainerStyle={{ paddingBottom: 30 }}
            >
              {(() => {
                const entry = openEntry;
                let kind: 'Option' | 'Job' | 'Casting' | 'Personal' = 'Personal';
                if (entry.entry_type === 'booking') kind = 'Job';
                else if (entry.entry_type === 'option') kind = 'Option';
                else if (entry.entry_type === 'casting' || entry.entry_type === 'gosee')
                  kind = 'Casting';
                const date = entry.date;
                const start = entry.start_time ?? undefined;
                const end = entry.end_time ?? undefined;
                return (
                  <View style={{ marginBottom: spacing.md }}>
                    <Text style={st.heading}>{kind}</Text>
                    <Text style={st.metaText}>
                      {date}
                      {start ? ` · ${start}${end ? `–${end}` : ''}` : ''}
                    </Text>
                    {entry.client_name && (
                      <Text style={st.metaText}>Client: {entry.client_name}</Text>
                    )}
                    {openEntry.option_request_id ? (
                      <>
                        <Text style={[st.metaText, { marginTop: spacing.sm }]}>
                          <Text style={{ fontWeight: '600' }}>
                            {uiCopy.calendar.nextStepLabel}:{' '}
                          </Text>
                          {(() => {
                            const localReq = getRequestByThreadId(openEntry.option_request_id!);
                            if (!localReq) return uiCopy.calendar.nextStepNegotiating;
                            return getCalendarDetailNextStepForModelLocalOption(localReq, {
                              nextStepAwaitingModel: uiCopy.calendar.nextStepAwaitingModel,
                              nextStepAwaitingAgency: uiCopy.calendar.nextStepAwaitingAgency,
                              nextStepAwaitingClient: uiCopy.calendar.nextStepAwaitingClient,
                              nextStepJobConfirm: uiCopy.calendar.nextStepJobConfirm,
                              nextStepNegotiating: uiCopy.calendar.nextStepNegotiating,
                              nextStepNoAction: uiCopy.calendar.nextStepNoAction,
                              nextStepYourConfirm: uiCopy.calendar.nextStepYourConfirm,
                            });
                          })()}
                        </Text>
                        <TouchableOpacity
                          style={{
                            marginTop: spacing.sm,
                            borderRadius: 999,
                            backgroundColor: colors.textPrimary,
                            paddingVertical: spacing.sm,
                            alignItems: 'center',
                          }}
                          onPress={() => {
                            const id =
                              resolveCanonicalOptionRequestIdFromBookingCalendarEntry(openEntry);
                            if (!id) return;
                            setSelectedOptionThread(id);
                            setTab('home');
                            setOpenEntry(null);
                            setModelNotesDraft('');
                            void loadMessagesForThread(id, { viewerRole: 'model' });
                          }}
                        >
                          <Text style={{ ...typography.label, color: colors.surface }}>
                            {uiCopy.calendar.openNegotiationThread}
                          </Text>
                        </TouchableOpacity>
                      </>
                    ) : null}
                  </View>
                );
              })()}
              <View style={{ marginBottom: spacing.md }}>
                <Text style={st.sectionLabel}>
                  {openEntry.option_request_id
                    ? uiCopy.calendar.reschedule
                    : uiCopy.calendar.editEntry}
                </Text>
                <Text style={[st.metaText, { marginBottom: spacing.sm }]}>
                  {openEntry.option_request_id
                    ? uiCopy.calendar.optionScheduleHelp
                    : uiCopy.calendar.manualBlockHelp}
                </Text>
                {!openEntry.option_request_id ? (
                  <>
                    <Text
                      style={{
                        ...typography.label,
                        fontSize: 10,
                        color: colors.textSecondary,
                        marginBottom: 4,
                      }}
                    >
                      Title
                    </Text>
                    <TextInput
                      value={entryScheduleDraft.title}
                      onChangeText={(t) => setEntryScheduleDraft((p) => ({ ...p, title: t }))}
                      placeholderTextColor={colors.textSecondary}
                      style={[st.input, { marginBottom: spacing.sm }]}
                    />
                  </>
                ) : null}
                <Text
                  style={{
                    ...typography.label,
                    fontSize: 10,
                    color: colors.textSecondary,
                    marginBottom: 4,
                  }}
                >
                  Date (YYYY-MM-DD)
                </Text>
                <TextInput
                  value={entryScheduleDraft.date}
                  onChangeText={(t) => setEntryScheduleDraft((p) => ({ ...p, date: t }))}
                  placeholderTextColor={colors.textSecondary}
                  style={[st.input, { marginBottom: spacing.sm }]}
                />
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
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
                    <TextInput
                      value={entryScheduleDraft.start_time}
                      onChangeText={(t) => setEntryScheduleDraft((p) => ({ ...p, start_time: t }))}
                      placeholderTextColor={colors.textSecondary}
                      style={st.input}
                    />
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
                    <TextInput
                      value={entryScheduleDraft.end_time}
                      onChangeText={(t) => setEntryScheduleDraft((p) => ({ ...p, end_time: t }))}
                      placeholderTextColor={colors.textSecondary}
                      style={st.input}
                    />
                  </View>
                </View>
                <TouchableOpacity
                  onPress={async () => {
                    if (!profile || !openEntry || !entryScheduleDraft.date.trim()) return;
                    setSavingEntrySchedule(true);
                    try {
                      let ok = false;
                      if (openEntry.option_request_id) {
                        ok = await modelUpdateOptionSchedule(
                          openEntry.option_request_id,
                          entryScheduleDraft.date.trim(),
                          entryScheduleDraft.start_time.trim() || null,
                          entryScheduleDraft.end_time.trim() || null,
                        );
                      } else {
                        ok = await updateCalendarEntryById(openEntry.id, {
                          date: entryScheduleDraft.date.trim(),
                          start_time: entryScheduleDraft.start_time.trim() || null,
                          end_time: entryScheduleDraft.end_time.trim() || null,
                          title: entryScheduleDraft.title.trim() || null,
                        });
                      }
                      if (ok) {
                        const refreshed = await getCalendarForModel(profile.id);
                        setCalEntries(refreshed);
                        const updated = refreshed.find((e) => e.id === openEntry.id);
                        if (updated) setOpenEntry(updated);
                        Alert.alert(uiCopy.common.success, uiCopy.alerts.calendarUpdatedGeneric);
                      } else {
                        Alert.alert(uiCopy.common.error, uiCopy.alerts.couldNotSaveCheckMigration);
                      }
                    } finally {
                      setSavingEntrySchedule(false);
                    }
                  }}
                  style={{
                    alignSelf: 'flex-end',
                    marginTop: spacing.sm,
                    borderRadius: 999,
                    backgroundColor: colors.textPrimary,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    opacity: savingEntrySchedule ? 0.6 : 1,
                  }}
                  disabled={savingEntrySchedule}
                >
                  <Text style={{ ...typography.label, color: colors.surface }}>
                    {savingEntrySchedule ? '…' : uiCopy.calendar.saveSchedule}
                  </Text>
                </TouchableOpacity>
                {!openEntry.option_request_id ? (
                  <TouchableOpacity
                    onPress={() => {
                      if (!profile || !openEntry) return;
                      Alert.alert(
                        uiCopy.alerts.deletePersonalEntryTitle,
                        uiCopy.alerts.deletePersonalEntryMessage,
                        [
                          { text: uiCopy.common.cancel, style: 'cancel' },
                          {
                            text: uiCopy.common.delete,
                            style: 'destructive',
                            onPress: async () => {
                              setDeletingCalendarEntry(true);
                              try {
                                const ok = await deleteCalendarEntryById(openEntry.id);
                                if (ok) {
                                  await loadCalendar(profile.id);
                                  setOpenEntry(null);
                                } else {
                                  Alert.alert(uiCopy.common.error, uiCopy.alerts.deleteEntryFailed);
                                }
                              } finally {
                                setDeletingCalendarEntry(false);
                              }
                            },
                          },
                        ],
                      );
                    }}
                    style={{
                      alignSelf: 'flex-start',
                      marginTop: spacing.md,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: colors.buttonSkipRed,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      opacity: deletingCalendarEntry ? 0.6 : 1,
                    }}
                    disabled={deletingCalendarEntry}
                  >
                    <Text style={{ ...typography.label, color: colors.buttonSkipRed }}>
                      {uiCopy.calendar.deletePersonalCalendarEntry}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {openEntry.option_request_id && profile ? (
                <BookingBriefEditor
                  role="model"
                  optionRequestId={openEntry.option_request_id}
                  bookingBriefRaw={
                    (openEntry.booking_details as BookingDetails | null)?.booking_brief
                  }
                  onAfterSave={async () => {
                    const refreshed = await getCalendarForModel(profile.id);
                    setCalEntries(refreshed);
                    const updated = refreshed.find((e) => e.id === openEntry.id);
                    if (updated) setOpenEntry(updated);
                  }}
                />
              ) : null}
              {openEntry.option_request_id ? (
                <View style={{ marginBottom: spacing.md }}>
                  <Text style={st.sectionLabel}>{uiCopy.calendar.sharedNotesTitle}</Text>
                  <Text style={[st.metaText, { marginBottom: spacing.sm }]}>
                    {uiCopy.calendar.sharedNotesHelpModel}
                  </Text>
                  <ScrollView style={{ maxHeight: 140, marginBottom: spacing.sm }}>
                    {(
                      (openEntry.booking_details as { shared_notes?: SharedBookingNote[] } | null)
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
                        <Text
                          style={{ ...typography.label, fontSize: 9, color: colors.textSecondary }}
                        >
                          {n.role} · {new Date(n.at).toLocaleString('en-GB')}
                        </Text>
                        <Text
                          style={{ ...typography.body, fontSize: 12, color: colors.textPrimary }}
                        >
                          {n.text}
                        </Text>
                      </View>
                    ))}
                  </ScrollView>
                  <TextInput
                    value={sharedNoteDraft}
                    onChangeText={setSharedNoteDraft}
                    multiline
                    placeholder={uiCopy.calendar.sharedNotePlaceholder}
                    placeholderTextColor={colors.textSecondary}
                    style={[
                      st.input,
                      { minHeight: 72, textAlignVertical: 'top', borderRadius: 12 },
                    ]}
                  />
                  <TouchableOpacity
                    onPress={async () => {
                      if (!profile || !openEntry?.option_request_id || !sharedNoteDraft.trim())
                        return;
                      const now = Date.now();
                      if (now - lastAppendSharedNoteAtRef.current < UI_DOUBLE_SUBMIT_DEBOUNCE_MS)
                        return;
                      lastAppendSharedNoteAtRef.current = now;
                      setSavingSharedNote(true);
                      try {
                        const ok = await appendSharedBookingNote(
                          openEntry.option_request_id,
                          'model',
                          sharedNoteDraft,
                        );
                        if (ok) {
                          setSharedNoteDraft('');
                          const refreshed = await getCalendarForModel(profile.id);
                          setCalEntries(refreshed);
                          const updated = refreshed.find((e) => e.id === openEntry.id);
                          if (updated) setOpenEntry(updated);
                        }
                      } finally {
                        setSavingSharedNote(false);
                      }
                    }}
                    style={{
                      alignSelf: 'flex-end',
                      marginTop: spacing.sm,
                      borderRadius: 999,
                      backgroundColor: colors.textPrimary,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      opacity: savingSharedNote ? 0.6 : 1,
                    }}
                    disabled={savingSharedNote}
                  >
                    <Text style={{ ...typography.label, color: colors.surface }}>
                      {savingSharedNote
                        ? uiCopy.calendar.postingSharedNote
                        : uiCopy.calendar.postSharedNote}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              <Text style={st.sectionLabel}>{uiCopy.calendar.modelNotesTitle}</Text>
              <TextInput
                value={modelNotesDraft}
                onChangeText={setModelNotesDraft}
                multiline
                placeholder={uiCopy.calendar.modelNotesPlaceholder}
                placeholderTextColor={colors.textSecondary}
                style={[
                  st.input,
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
                    setOpenEntry(null);
                    setModelNotesDraft('');
                  }}
                  style={[
                    {
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: colors.border,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                    },
                  ]}
                >
                  <Text style={st.sectionLabel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    if (!profile || !openEntry) return;
                    setSavingNotes(true);
                    try {
                      if (openEntry.option_request_id) {
                        await updateBookingDetails(
                          openEntry.option_request_id,
                          { model_notes: modelNotesDraft },
                          'model',
                        );
                      } else {
                        await updateCalendarEntryById(openEntry.id, {
                          note: modelNotesDraft,
                          start_time: openEntry.start_time ?? null,
                          end_time: openEntry.end_time ?? null,
                          title: openEntry.title ?? null,
                          status: openEntry.status,
                        });
                      }
                      await loadCalendar(profile.id);
                      setOpenEntry(null);
                      setModelNotesDraft('');
                    } finally {
                      setSavingNotes(false);
                    }
                  }}
                  style={[
                    {
                      borderRadius: 999,
                      backgroundColor: colors.accentGreen,
                      paddingHorizontal: spacing.lg,
                      paddingVertical: spacing.sm,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: savingNotes ? 0.6 : 1,
                    },
                  ]}
                  disabled={savingNotes}
                >
                  <Text
                    style={{
                      ...typography.label,
                      color: '#fff',
                    }}
                  >
                    {savingNotes ? uiCopy.calendar.savingNotes : uiCopy.calendar.saveNotes}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      )}

      <ConfirmDestructiveModal
        visible={!!optionActionModal}
        title={
          optionActionModal?.action === 'confirm'
            ? uiCopy.optionNegotiationChat.modelConfirmAvailabilityTitle
            : uiCopy.optionNegotiationChat.modelDeclineAvailabilityTitle
        }
        message={
          optionActionModal?.action === 'confirm'
            ? uiCopy.optionNegotiationChat.modelConfirmAvailabilityMessage
            : uiCopy.optionNegotiationChat.modelDeclineAvailabilityMessage
        }
        confirmLabel={
          optionActionModal?.action === 'confirm'
            ? uiCopy.common.confirm
            : uiCopy.optionNegotiationChat.modelDeclineAvailabilityConfirm
        }
        cancelLabel={uiCopy.common.cancel}
        tone={optionActionModal?.action === 'confirm' ? 'confirm' : 'destructive'}
        onConfirm={() => {
          if (!optionActionModal) return;
          const { id, action } = optionActionModal;
          setOptionActionModal(null);
          if (action === 'confirm') void handleConfirmBooking(id);
          else void handleRejectBooking(id);
        }}
        onCancel={() => setOptionActionModal(null)}
        detailLine1={
          optionActionModal
            ? ((pendingConfirmations.find((r) => r.id === optionActionModal.id)?.client_name as
                | string
                | undefined) ?? undefined)
            : undefined
        }
        detailLine2={
          optionActionModal
            ? (() => {
                const r = pendingConfirmations.find((x) => x.id === optionActionModal.id);
                if (!r) return undefined;
                return `${r.requested_date}${r.start_time ? ` · ${String(r.start_time).slice(0, 5)}` : ''}${
                  r.end_time ? `–${String(r.end_time).slice(0, 5)}` : ''
                }`;
              })()
            : undefined
        }
      />
    </View>
  );
};

type MeasureProps = { label: string; value: number };
const Measure: React.FC<MeasureProps> = ({ label, value }) => (
  <View style={st.measureItem}>
    <Text style={st.measureLabel}>{label}</Text>
    <Text style={st.measureValue}>{value}</Text>
  </View>
);

const st = StyleSheet.create({
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
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  backArrow: { fontSize: 22, color: colors.textPrimary },
  backLabel: { ...typography.label, fontSize: 11, color: colors.textSecondary },
  brand: { ...typography.headingCompact, color: colors.textPrimary, marginBottom: 0 },
  heading: {
    ...typography.heading,
    fontSize: 18,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  label: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },
  tabRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
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
  },
  tabItem: { alignItems: 'center' },
  tabLabel: { ...typography.label, color: colors.textSecondary },
  tabLabelActive: { color: colors.accentGreen },
  tabUnderline: {
    marginTop: 4,
    height: 2,
    width: 24,
    backgroundColor: colors.accentGreen,
    borderRadius: 1,
  },
  section: { marginTop: spacing.lg, gap: spacing.sm },
  sectionLabel: { ...typography.label, color: colors.textSecondary },
  metaText: { ...typography.body, fontSize: 12, color: colors.textSecondary },
  measureRow: { flexDirection: 'row', justifyContent: 'space-between' },
  measureItem: { alignItems: 'flex-start' },
  measureLabel: { ...typography.label, fontSize: 10, color: colors.textSecondary },
  measureValue: { ...typography.body, color: colors.textPrimary },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: colors.textPrimary,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    marginBottom: spacing.xs,
  },
  chatRowKicker: {
    ...typography.label,
    fontSize: 9,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  chatRowLabel: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  chatRowOpen: { ...typography.label, fontSize: 11, color: colors.textSecondary },
});

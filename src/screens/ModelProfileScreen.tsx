import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { handleTabPress, BOTTOM_TAB_BAR_HEIGHT } from '../navigation/bottomTabNavigation';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Linking, Alert, ActivityIndicator, Image } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { getModelsFromSupabase, getModelForUserFromSupabase, type SupabaseModel } from '../services/modelsSupabase';
import {
  upsertModelLocation,
  getModelLocation,
  deleteModelLocation,
  roundCoord,
  locationSourceLabel,
  type ModelLocation,
  type LocationSource,  // used in handleShareLocation type cast
} from '../services/modelLocationsSupabase';
import { supabase } from '../../lib/supabase';
import { getModelBookingThreadIds, getRecruitingThread, subscribeRecruitingChats } from '../store/recruitingChats';
import {
  getOptionRequests,
  subscribe,
  getMessages,
  addMessage,
  getRequestByThreadId,
  getOutstandingOptionsForModel,
  approveOptionAsModel,
  rejectOptionAsModel,
  loadOptionsForModel,
  type OptionRequest,
} from '../store/optionRequests';
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
import BookingBriefEditor from '../components/BookingBriefEditor';
import { getBookingEventsForModel } from '../services/bookingEventsSupabase';
import {
  modelUpdateOptionSchedule,
  getPendingModelConfirmations,
  modelConfirmOptionRequest,
  modelRejectOptionRequest,
  type SupabaseOptionRequest,
} from '../services/optionRequestsSupabase';
import { getAgencyById, type Agency } from '../services/agenciesSupabase';
import { getAgencyNamesByThreadIds } from '../services/recruitingChatSupabase';
import { BookingChatView } from '../views/BookingChatView';
import { useAuth } from '../context/AuthContext';
import { uiCopy } from '../constants/uiCopy';
import { listModelAgencyDirectConversations } from '../services/b2bOrgChatSupabase';
import type { Conversation } from '../services/messengerSupabase';
import { OrgMessengerInline } from '../components/OrgMessengerInline';

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
};

type ModelTab = 'calendar' | 'messages' | 'options' | 'profile';

const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
const ENTRY_COLORS: Record<string, string> = {
  personal: '#2E7D32',
  booking:  '#B71C1C',
  job:      '#1B5E20',
  option:   '#E65100',
  gosee:    '#0288D1',
  casting:  '#1565C0',
};

type ModelProfileScreenProps = {
  onBackToRoleSelection?: () => void;
  /** Wenn gesetzt: Model dieses Users laden (echte Anmeldung). Sonst: erstes Model (Demo). */
  userId?: string | null;
};

export const ModelProfileScreen: React.FC<ModelProfileScreenProps> = ({
  onBackToRoleSelection,
  userId,
}) => {
  const { signOut } = useAuth();
  const [profile, setProfile] = useState<ModelProfile | null>(null);
  const [tab, setTab] = useState<ModelTab>('calendar');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calEntries, setCalEntries] = useState<CalendarEntry[]>([]);
  const [newEntryTitle, setNewEntryTitle] = useState('');
  const [newEntryStart, setNewEntryStart] = useState('09:00');
  const [newEntryEnd, setNewEntryEnd] = useState('10:00');
  const [bookingThreadIds, setBookingThreadIds] = useState<string[]>(() => getModelBookingThreadIds());
  const [openBookingThreadId, setOpenBookingThreadId] = useState<string | null>(null);
  const [options, setOptions] = useState<OptionRequest[]>([]);
  const [selectedOptionThread, setSelectedOptionThread] = useState<string | null>(null);
  const [optChatInput, setOptChatInput] = useState('');
  const [locationLoading, setLocationLoading] = useState(false);
  const [openEntry, setOpenEntry] = useState<CalendarEntry | null>(null);
  const [modelNotesDraft, setModelNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [sharedNoteDraft, setSharedNoteDraft] = useState('');
  const [savingSharedNote, setSavingSharedNote] = useState(false);
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
  const [pendingConfirmations, setPendingConfirmations] = useState<SupabaseOptionRequest[]>([]);
  const [confirmingBookingId, setConfirmingBookingId] = useState<string | null>(null);
  const [rejectingBookingId, setRejectingBookingId] = useState<string | null>(null);
  const [actingOnOption, setActingOnOption] = useState(false);
  const [addingEntry, setAddingEntry] = useState(false);

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
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 10000 })
      );
      const { latitude, longitude } = position.coords;

      // Round before sending to any third-party service to avoid exposing exact GPS.
      const latRounded = roundCoord(latitude);
      const lngRounded = roundCoord(longitude);

      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${latRounded}&lon=${lngRounded}&format=json`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json();
      const cityName =
        data.address?.city ?? data.address?.town ?? data.address?.village ?? data.address?.state ?? 'Unknown';
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

      setProfile((prev) => prev ? { ...prev, currentLocation: cityName } : prev);
      // Reload to reflect the new highest-priority source (live now overrides current/agency)
      const refreshed = await import('../services/modelLocationsSupabase')
        .then(m => m.getModelLocation(profile.id));
      setModelLocation(refreshed);
      Alert.alert('Location Updated', `Live GPS location set to: ${cityName}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      Alert.alert('Location Error', err?.message ?? 'Could not retrieve your location.');
    } finally {
      setLocationLoading(false);
    }
  };

  /** Set a manual approximate city (source='current') via Nominatim forward geocoding.
   *
   * GEOCODING SAFETY INVARIANT: if geocoding fails, NO update is made.
   * Existing location data is always preserved — never overwritten with null coordinates.
   */
  const handleSetCurrentCity = async () => {
    if (!profile || !currentCityInput.trim() || !currentCountryInput.trim()) {
      Alert.alert('Missing fields', 'Please enter both a city and country code (e.g. DE, FR, US).');
      return;
    }
    setCurrentCityLoading(true);
    try {
      const city = currentCityInput.trim();
      const countryCode = currentCountryInput.trim().toUpperCase().slice(0, 2);

      // Forward geocode city → lat/lng (required for Near Me radius filtering)
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)},${countryCode}&format=json&limit=1`,
        { headers: { 'Accept-Language': 'en', 'User-Agent': 'IndexCasting/1.0' } }
      );
      const results = await res.json() as Array<{ lat: string; lon: string }>;
      const first = results[0];
      const lat = first ? roundCoord(parseFloat(first.lat)) : null;
      const lng = first ? roundCoord(parseFloat(first.lon)) : null;

      // GEOCODING SAFETY: if geocoding failed, abort — never write null coordinates.
      // Existing location data is preserved. User must try a more specific city name.
      if (lat == null || lng == null) {
        Alert.alert(
          'City not found',
          `Could not geocode "${city}, ${countryCode}". Please try a more specific city name.\n\nYour existing location has not been changed.`
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
          ...(modelLocation ?? {} as ModelLocation),
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
        setProfile((prev) => prev ? { ...prev, currentLocation: city } : prev);
        setCurrentCityInput('');
        setCurrentCountryInput('');
        Alert.alert('Location set', `Current city set to ${city}, ${countryCode}. You will appear in Near Me.`);
      } else {
        Alert.alert('Error', 'Could not save your location. Please try again.');
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not save location.');
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
      Alert.alert(
        'Cannot remove',
        'This location was set by your agency. Contact your agency to update it.'
      );
      return;
    }
    const sourceLabel = modelLocation.source === 'live' ? 'Live GPS' : 'Current city';
    Alert.alert(
      `Remove ${sourceLabel}`,
      `This will remove your ${sourceLabel} location. You may still appear in Near Me if another location source is set.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemovingLocation(true);
            const removedSource = modelLocation.source;
            // Delete only the specific source row — other sources are preserved
            const ok = await deleteModelLocation(profile.id, removedSource);
            setRemovingLocation(false);
            if (ok) {
              // Reload to get the next effective location (fallback to current/agency)
              const next = await import('../services/modelLocationsSupabase')
                .then(m => m.getModelLocation(profile.id));
              setModelLocation(next);
              if (!next) setProfile((prev) => prev ? { ...prev, currentLocation: '' } : prev);
            } else {
              Alert.alert('Error', 'Could not remove location. Please try again.');
            }
          },
        },
      ]
    );
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
    const applyModel = (m: Partial<SupabaseModel> & { id: string; name: string; height: number }) => {
      if (cancelled) return;
      setProfile({
        id: m.id, name: m.name, height: m.height,
        chest: m.chest ?? m.bust ?? 0, waist: m.waist ?? 0, hips: m.hips ?? 0,
        city: m.city ?? '', countryCode: m.country_code ?? null,
        currentLocation: m.current_location ?? '', hairColor: m.hair_color ?? '',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mediaslideSyncId: (m as any).mediaslide_sync_id ?? null,
      });
      loadCalendar(m.id);
      loadOptionsForModel(m.id);
    };
    if (userId) {
      getModelForUserFromSupabase(userId)
        .then((m) => { if (m) applyModel(m); })
        .catch((e) => console.error('[ModelProfileScreen] getModelForUser error:', e));
    } else {
      getModelsFromSupabase()
        .then((list) => { const m = list[0]; if (m) applyModel(m); })
        .catch((e) => console.error('[ModelProfileScreen] getModels error:', e));
    }
    return () => { cancelled = true; };
  }, [userId]);

  // Load active location source on mount (and when profile changes)
  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    void getModelLocation(profile.id).then((loc) => {
      if (!cancelled) setModelLocation(loc);
    });
    return () => { cancelled = true; };
  }, [profile?.id]);

  useEffect(() => {
    setOptions(getOptionRequests());
    const unsub = subscribe(() => setOptions(getOptionRequests()));
    return unsub;
  }, []);

  const loadCalendar = async (modelId: string) => {
    const [legacyEntries, bookingEvents] = await Promise.all([
      getCalendarForModel(modelId),
      getBookingEventsForModel(modelId),
    ]);
    const coveredOptionIds = new Set(
      legacyEntries.map((e) => e.option_request_id).filter(Boolean),
    );
    const beEntries = bookingEvents
      .map(bookingEventToCalendarEntry)
      .filter((be) => !(be.option_request_id && coveredOptionIds.has(be.option_request_id)));
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
      await loadPendingConfirmations(profile.id);
      await loadCalendar(profile.id);
    }
  };

  const handleRejectBooking = async (id: string) => {
    setRejectingBookingId(id);
    const ok = await modelRejectOptionRequest(id);
    setRejectingBookingId(null);
    if (ok && profile) {
      await loadPendingConfirmations(profile.id);
    }
  };

  const outstandingOptions = useMemo(() =>
    profile ? getOutstandingOptionsForModel(profile.id) : [],
    [profile]
  );

  const jobTickets = useMemo(
    () =>
      profile
        ? options.filter(
            (o) =>
              o.modelId === profile.id &&
              (o.finalStatus === 'option_confirmed' || o.finalStatus === 'job_confirmed'),
          )
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
    if (!openEntry) return;
    setEntryScheduleDraft({
      date: openEntry.date,
      start_time: (openEntry.start_time ?? '09:00').toString().slice(0, 5),
      end_time: (openEntry.end_time ?? '10:00').toString().slice(0, 5),
      title: openEntry.title ?? '',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEntry?.id]);

  const daysInMonth = new Date(calMonth.year, calMonth.month + 1, 0).getDate();
  const firstDayOfWeek = new Date(calMonth.year, calMonth.month, 1).getDay();
  const monthLabel = new Date(calMonth.year, calMonth.month).toLocaleString('en', { month: 'long', year: 'numeric' });

  const entriesForDate = useMemo(
    () =>
      calEntries
        .filter((e) => e.date === selectedDate)
        .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? '')),
    [calEntries, selectedDate],
  );

  const _dateHasEntry = (dateStr: string) => calEntries.some((e) => e.date === dateStr);
  const dateEntryType = (dateStr: string): string | null => {
    const entry = calEntries.find((e) => e.date === dateStr);
    return entry?.entry_type ?? null;
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

  const handleApproveOption = async (threadId: string) => {
    if (actingOnOption) return;
    setActingOnOption(true);
    try {
      await approveOptionAsModel(threadId);
    } finally {
      setActingOnOption(false);
    }
  };

  const handleRejectOption = async (threadId: string) => {
    if (actingOnOption) return;
    setActingOnOption(true);
    try {
      await rejectOptionAsModel(threadId);
    } finally {
      setActingOnOption(false);
    }
  };

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
        break;
      case 'options':
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
    <View style={st.container}>
      {onBackToRoleSelection && (
        <TouchableOpacity style={st.backRow} onPress={onBackToRoleSelection} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={st.backArrow}>←</Text>
          <Text style={st.backLabel}>Logout</Text>
        </TouchableOpacity>
      )}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={st.brand}>INDEX CASTING</Text>
        <TouchableOpacity
          onPress={() => {
            const subject = encodeURIComponent('Help Request – Model – Casting Index');
            const body = encodeURIComponent('Hello Casting Index Team,\n\nI need help with:\n\n');
            Linking.openURL(`mailto:admin@castingindex.com?subject=${subject}&body=${body}`);
          }}
        >
          <Text style={{ ...typography.label, fontSize: 12, color: colors.textSecondary }}>Help</Text>
        </TouchableOpacity>
      </View>
      <Text style={st.heading}>{profile.name}</Text>

      <View style={{ flex: 1, paddingBottom: bottomTabInset }}>
      {tab === 'profile' && (
        <ScrollView style={{ flex: 1 }}>
          <View style={st.section}>
            <Text style={st.sectionLabel}>Status</Text>
            <Text style={st.metaText}>Current location: {profile.currentLocation}</Text>
            <Text style={st.metaText}>Base: {profile.city} · Hair: {profile.hairColor}</Text>
            {profile.mediaslideSyncId ? (
              <Text style={[st.metaText, { marginTop: 4, fontSize: 10, color: '#6b7280', letterSpacing: 0.5 }]}>
                Mediaslide ID: {profile.mediaslideSyncId}
              </Text>
            ) : null}
          </View>
          {/* ── Location Section ─────────────────────────────── */}
          <View style={st.section}>
            <Text style={st.sectionLabel}>Location</Text>

            {/* Active source badge — shows highest-priority resolved location */}
            {modelLocation ? (
              <View style={{
                borderRadius: 8, padding: spacing.sm, marginBottom: spacing.sm,
                backgroundColor: modelLocation.source === 'live' ? '#e8f5e9'
                  : modelLocation.source === 'current' ? '#e3f2fd' : '#fff3e0',
                borderLeftWidth: 3,
                borderLeftColor: modelLocation.source === 'live' ? '#2e7d32'
                  : modelLocation.source === 'current' ? '#1565c0' : '#e65100',
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...typography.label, fontSize: 11,
                      color: modelLocation.source === 'live' ? '#2e7d32'
                        : modelLocation.source === 'current' ? '#1565c0' : '#e65100' }}>
                      {locationSourceLabel(modelLocation.source)}
                    </Text>
                    <Text style={{ ...typography.body, fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                      {[modelLocation.city, modelLocation.country_code].filter(Boolean).join(', ') || 'Location set'}
                      {modelLocation.lat_approx != null ? ' · Near Me active' : ' · Not in Near Me (no geocoords)'}
                    </Text>
                    {modelLocation.source === 'agency' && (
                      <Text style={{ fontSize: 10, color: '#9a6a00', marginTop: 2 }}>
                        Set by your agency · Add your own city above to override
                      </Text>
                    )}
                  </View>
                  {/* Remove button only for model-owned sources (live/current).
                      Agency location is managed by the agency, not the model. */}
                  {modelLocation.source !== 'agency' && (
                    <TouchableOpacity
                      onPress={() => { void handleRemoveLocation(); }}
                      disabled={removingLocation}
                      style={{ paddingHorizontal: spacing.xs, paddingVertical: 4 }}
                    >
                      <Text style={{ fontSize: 11, color: '#e74c3c', fontWeight: '600' }}>
                        {removingLocation ? '…' : 'Remove'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ) : (
              <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm }}>
                No active location. Set one below to appear in Near Me.
              </Text>
            )}

            {/* Mode A — Set current city (source='current', no GPS required) */}
            <Text style={{ ...typography.label, fontSize: 11, color: colors.textSecondary, marginBottom: 4 }}>
              Set current city
            </Text>
            <TextInput
              placeholder="Country code (e.g. DE, FR, US)"
              value={currentCountryInput}
              onChangeText={setCurrentCountryInput}
              maxLength={2}
              autoCapitalize="characters"
              style={{
                borderWidth: 1, borderColor: colors.border, borderRadius: 8,
                paddingHorizontal: spacing.sm, paddingVertical: 8,
                ...typography.body, fontSize: 13, marginBottom: 6,
              }}
            />
            <TextInput
              placeholder="City name"
              value={currentCityInput}
              onChangeText={setCurrentCityInput}
              style={{
                borderWidth: 1, borderColor: colors.border, borderRadius: 8,
                paddingHorizontal: spacing.sm, paddingVertical: 8,
                ...typography.body, fontSize: 13, marginBottom: spacing.xs,
              }}
            />
            <TouchableOpacity
              onPress={() => { void handleSetCurrentCity(); }}
              disabled={currentCityLoading || !currentCityInput.trim() || !currentCountryInput.trim()}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
                borderRadius: 999, backgroundColor: '#1565c0', paddingVertical: spacing.sm,
                opacity: (currentCityLoading || !currentCityInput.trim() || !currentCountryInput.trim()) ? 0.5 : 1,
                marginBottom: spacing.sm,
              }}
            >
              {currentCityLoading && <ActivityIndicator size="small" color="#fff" />}
              <Text style={{ ...typography.label, color: '#fff', fontSize: 13 }}>
                {currentCityLoading ? 'Saving…' : 'Set current city'}
              </Text>
            </TouchableOpacity>

            {/* Mode B — Share live GPS (source='live') */}
            <Text style={{ ...typography.label, fontSize: 11, color: colors.textSecondary, marginBottom: 4 }}>
              Or share live GPS
            </Text>
            <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.xs }}>
              Only your approximate city (±5 km) will be shared. No exact GPS is stored.
            </Text>
            <TouchableOpacity
              onPress={() => { void handleShareLocation(); }}
              disabled={locationLoading}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
                borderRadius: 999, backgroundColor: colors.accentGreen, paddingVertical: spacing.sm,
                opacity: locationLoading ? 0.6 : 1,
              }}
            >
              {locationLoading && <ActivityIndicator size="small" color="#fff" />}
              <Text style={{ ...typography.label, color: '#fff' }}>
                {locationLoading ? 'Locating…' : 'Share live GPS'}
              </Text>
            </TouchableOpacity>
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

          <View style={[st.section, { marginTop: spacing.xl, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border }]}>
            <Text style={st.sectionLabel}>{uiCopy.accountDeletion.sectionTitle}</Text>
            <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm }}>
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
                        const { requestAccountDeletion } = await import('../services/accountSupabase');
                        const res = await requestAccountDeletion();
                        setDeletingAccount(false);
                        if (res.ok) {
                          await signOut();
                          return;
                        }
                        Alert.alert(uiCopy.common.error, uiCopy.accountDeletion.failed);
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
        </ScrollView>
      )}

      {tab === 'calendar' && (
        <ScrollView style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <TouchableOpacity onPress={() => setCalMonth((p) => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 })}>
              <Text style={{ fontSize: 20, color: colors.textPrimary }}>‹</Text>
            </TouchableOpacity>
            <Text style={{ ...typography.label, color: colors.textPrimary }}>{monthLabel}</Text>
            <TouchableOpacity onPress={() => setCalMonth((p) => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 })}>
              <Text style={{ fontSize: 20, color: colors.textPrimary }}>›</Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row', marginBottom: 4 }}>
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
              <View key={d} style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ ...typography.label, fontSize: 9, color: colors.textSecondary }}>{d}</Text>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md }}>
            {Array.from({ length: firstDayOfWeek }, (_, i) => (
              <View key={`e-${i}`} style={{ width: `${100 / 7}%`, height: 40 }} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const dateStr = `${calMonth.year}-${String(calMonth.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isSelected = dateStr === selectedDate;
              const entryType = dateEntryType(dateStr);
              const dotColor = entryType ? (ENTRY_COLORS[entryType] ?? colors.textSecondary) : null;
              return (
                <TouchableOpacity
                  key={day}
                  onPress={() => setSelectedDate(dateStr)}
                  style={{ width: `${100 / 7}%`, height: 40, alignItems: 'center', justifyContent: 'center' }}
                >
                  <View style={{
                    width: 34, height: 34, borderRadius: 17,
                    alignItems: 'center', justifyContent: 'center',
                    backgroundColor: isSelected ? colors.accentGreen : 'transparent',
                    borderWidth: dotColor && !isSelected ? 2 : 0,
                    borderColor: dotColor ?? 'transparent',
                  }}>
                    <Text style={{ ...typography.body, fontSize: 12, color: isSelected ? '#fff' : colors.textPrimary }}>{day}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#2E7D32' }} />
              <Text style={st.metaText}>Personal</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#C62828' }} />
              <Text style={st.metaText}>Gosee / Booking</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#1565C0' }} />
              <Text style={st.metaText}>Option (pending)</Text>
            </View>
          </View>

          {selectedDate && (
            <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing.md, marginBottom: spacing.md }}>
              <Text style={st.sectionLabel}>{selectedDate}</Text>
              <View style={{ borderLeftWidth: 2, borderLeftColor: colors.border, marginLeft: 8, paddingLeft: spacing.md, marginTop: spacing.sm }}>
                {HOURS.map((hour) => {
                  const entry = entriesForDate.find((e) => e.start_time?.slice(0, 5) === hour);
                  return (
                    <View key={hour} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 2, minHeight: 24 }}>
                      <Text style={{ ...typography.label, fontSize: 9, color: colors.textSecondary, width: 40 }}>{hour}</Text>
                      {entry ? (
                        <TouchableOpacity
                          style={{
                            flex: 1,
                            backgroundColor:
                              ENTRY_COLORS[entry.entry_type] ?? colors.textSecondary,
                            borderRadius: 6,
                            paddingHorizontal: spacing.sm,
                            paddingVertical: 2,
                            marginLeft: 4,
                          }}
                          onPress={() => {
                            setOpenEntry(entry);
                            setSharedNoteDraft('');
                            const existing =
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              (entry.booking_details as any)?.model_notes ??
                              entry.note ??
                              '';
                            setModelNotesDraft(existing);
                          }}
                        >
                          <Text style={{ ...typography.body, fontSize: 11, color: '#fff' }}>
                            {entry.title || entry.entry_type}
                            {entry.end_time
                              ? ` (until ${entry.end_time.slice(0, 5)})`
                              : ''}
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={{ flex: 1, height: 1, backgroundColor: colors.border, marginTop: 8, marginLeft: 4 }} />
                      )}
                    </View>
                  );
                })}
              </View>

              <View style={{ marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md }}>
                <Text style={st.sectionLabel}>Add personal entry</Text>
                <TextInput value={newEntryTitle} onChangeText={setNewEntryTitle} placeholder="Title (e.g. Gym, Casting prep)" placeholderTextColor={colors.textSecondary} style={[st.input, { marginBottom: spacing.sm }]} />
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...typography.label, fontSize: 9, color: colors.textSecondary }}>Start</Text>
                    <ScrollView style={{ maxHeight: 80, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
                      {HOURS.map((t) => (
                        <TouchableOpacity key={t} onPress={() => setNewEntryStart(t)} style={{ padding: 4, backgroundColor: newEntryStart === t ? '#2E7D32' : 'transparent' }}>
                          <Text style={{ ...typography.body, fontSize: 10, color: newEntryStart === t ? '#fff' : colors.textPrimary }}>{t}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...typography.label, fontSize: 9, color: colors.textSecondary }}>End</Text>
                    <ScrollView style={{ maxHeight: 80, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
                      {HOURS.map((t) => (
                        <TouchableOpacity key={t} onPress={() => setNewEntryEnd(t)} style={{ padding: 4, backgroundColor: newEntryEnd === t ? '#2E7D32' : 'transparent' }}>
                          <Text style={{ ...typography.body, fontSize: 10, color: newEntryEnd === t ? '#fff' : colors.textPrimary }}>{t}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={handleAddPersonalEntry}
                  disabled={addingEntry}
                  style={{ borderRadius: 999, backgroundColor: '#2E7D32', paddingVertical: spacing.sm, alignItems: 'center', opacity: addingEntry ? 0.5 : 1 }}
                >
                  <Text style={{ ...typography.label, color: '#fff' }}>{addingEntry ? 'Saving…' : 'Add entry'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      )}

      {tab === 'messages' && (
        <ScrollView style={{ flex: 1 }}>
          <Text style={st.sectionLabel}>Agency chat</Text>
          <Text style={st.metaText}>Direct chat with your agency</Text>
          <View style={{ gap: spacing.xs, marginTop: spacing.md }}>
            {bookingThreadIds.length === 0 ? (
              <Text style={st.metaText}>No chats yet. Your agency will appear here after accepting your application.</Text>
            ) : (
              bookingThreadIds.map((id) => {
                const t = getRecruitingThread(id);
                if (!t) return null;
                const agencyLabel = bookingAgencyByThread[id] ?? uiCopy.model.agencyLabel;
                return (
                  <TouchableOpacity key={id} style={st.chatRow} onPress={() => setOpenBookingThreadId(id)}>
                    <View style={{ flex: 1 }}>
                      <Text style={st.chatRowKicker}>{uiCopy.model.agencyLabel}</Text>
                      <Text style={st.chatRowLabel}>{agencyLabel}</Text>
                      <Text style={st.metaText}>{t.modelName}</Text>
                    </View>
                    <Text style={st.chatRowOpen}>Chat</Text>
                  </TouchableOpacity>
                );
              })
            )}
          </View>

          {agencyDirectConvs.length > 0 && (
            <>
              <Text style={[st.sectionLabel, { marginTop: spacing.lg }]}>Direct messages</Text>
              <Text style={st.metaText}>Messages sent directly by your agency</Text>
              <View style={{ gap: spacing.xs, marginTop: spacing.md }}>
                {agencyDirectConvs.map((conv) => (
                  <TouchableOpacity
                    key={conv.id}
                    style={st.chatRow}
                    onPress={() => setOpenDirectConvId(conv.id)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={st.chatRowKicker}>{uiCopy.model.agencyLabel}</Text>
                      <Text style={st.chatRowLabel}>{conv.title ?? uiCopy.model.agencyLabel}</Text>
                    </View>
                    <Text style={st.chatRowOpen}>Chat</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={[st.sectionLabel, { marginTop: spacing.lg }]}>Option chats</Text>
          {options.filter((o) => o.status !== 'rejected').map((o) => (
            <TouchableOpacity key={o.threadId} style={st.chatRow} onPress={() => setSelectedOptionThread(o.threadId)}>
              <View style={{ flex: 1 }}>
                <Text style={st.chatRowLabel}>{o.clientName} · {o.date}</Text>
                <Text style={st.metaText}>{o.modelName}{o.startTime ? ` · ${o.startTime}–${o.endTime}` : ''}</Text>
              </View>
              <Text style={{ ...typography.label, fontSize: 9, color: o.modelApproval === 'approved' ? colors.buttonOptionGreen : '#B8860B' }}>
                {o.modelApproval === 'approved'
                  ? uiCopy.dashboard.optionRequestModelApprovalApproved
                  : o.modelApproval === 'rejected'
                    ? uiCopy.dashboard.optionRequestModelApprovalRejected
                    : uiCopy.dashboard.optionRequestModelApprovalPending}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {tab === 'options' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingBottom: spacing.xl * 2 }}>

          {pendingConfirmations.length > 0 && (
            <>
              <Text style={st.sectionLabel}>Booking requests</Text>
              <Text style={st.metaText}>
                The agency has accepted these bookings on your behalf. Please confirm or decline.
              </Text>
              {pendingConfirmations.map((req) => (
                <View
                  key={req.id}
                  style={{
                    borderWidth: 1,
                    borderColor: '#E65100',
                    borderRadius: 12,
                    padding: spacing.md,
                    marginTop: spacing.sm,
                    backgroundColor: '#FFF3E0',
                  }}
                >
                  <Text style={{ ...typography.label, color: '#BF360C', marginBottom: 2 }}>
                    {req.request_type === 'casting' ? uiCopy.dashboard.threadContextCasting : uiCopy.dashboard.threadContextOption}
                    {req.client_name ? ` · ${req.client_name}` : ''}
                  </Text>
                  <Text style={{ ...typography.body, fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm }}>
                    {req.requested_date}
                    {req.start_time ? ` · ${String(req.start_time).slice(0, 5)}` : ''}
                    {req.end_time ? `–${String(req.end_time).slice(0, 5)}` : ''}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <TouchableOpacity
                      onPress={() => void handleConfirmBooking(req.id)}
                      disabled={confirmingBookingId === req.id || rejectingBookingId === req.id}
                      style={{
                        flex: 1, borderRadius: 999,
                        backgroundColor: colors.accentGreen,
                        paddingVertical: spacing.sm, alignItems: 'center',
                        opacity: (confirmingBookingId === req.id || rejectingBookingId === req.id) ? 0.5 : 1,
                      }}
                    >
                      <Text style={{ ...typography.label, color: '#fff' }}>
                        {confirmingBookingId === req.id ? 'Confirming…' : 'Accept'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => void handleRejectBooking(req.id)}
                      disabled={confirmingBookingId === req.id || rejectingBookingId === req.id}
                      style={{
                        flex: 1, borderRadius: 999, borderWidth: 1,
                        borderColor: colors.buttonSkipRed,
                        paddingVertical: spacing.sm, alignItems: 'center',
                        opacity: (confirmingBookingId === req.id || rejectingBookingId === req.id) ? 0.5 : 1,
                      }}
                    >
                      <Text style={{ ...typography.label, color: colors.buttonSkipRed }}>
                        {rejectingBookingId === req.id ? 'Declining…' : 'Decline'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </>
          )}

          <Text style={[st.sectionLabel, { marginTop: pendingConfirmations.length > 0 ? spacing.xl : 0 }]}>Job tickets</Text>
          <Text style={st.metaText}>
            Confirmed options and jobs. Fee details are not shown to models (agency–client only).
          </Text>
          {jobTickets.length === 0 ? (
            <Text style={[st.metaText, { marginTop: spacing.sm }]}>No confirmed tickets yet.</Text>
          ) : (
            jobTickets.map((o) => (
              <View
                key={o.threadId}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  padding: spacing.md,
                  marginTop: spacing.sm,
                  backgroundColor: colors.surface,
                }}
              >
                <Text style={{ ...typography.label, color: colors.textPrimary }}>
                  {o.requestType === 'casting' ? uiCopy.dashboard.threadContextCasting : uiCopy.dashboard.threadContextOption} · {o.finalStatus === 'job_confirmed' ? uiCopy.dashboard.optionRequestStatusJobConfirmed : uiCopy.dashboard.optionRequestStatusConfirmed}
                </Text>
                <Text style={st.metaText}>
                  {o.clientName} · {o.date}
                  {o.startTime ? ` · ${o.startTime}–${o.endTime}` : ''}
                </Text>
              </View>
            ))
          )}

          <Text style={[st.sectionLabel, { marginTop: spacing.xl }]}>Outstanding options</Text>
          <Text style={st.metaText}>Options that need your approval before the agency can confirm.</Text>
          {outstandingOptions.length === 0 ? (
            <Text style={[st.metaText, { marginTop: spacing.md }]}>No outstanding options.</Text>
          ) : (
            outstandingOptions.map((o) => (
              <View key={o.threadId} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing.md, marginTop: spacing.sm }}>
                <Text style={{ ...typography.body, color: colors.textPrimary }}>{o.clientName} · {o.modelName}</Text>
                <Text style={st.metaText}>{o.date}{o.startTime ? ` · ${o.startTime}–${o.endTime}` : ''}</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                  <TouchableOpacity
                    onPress={() => handleApproveOption(o.threadId)}
                    disabled={actingOnOption}
                    style={{ flex: 1, borderRadius: 999, backgroundColor: colors.buttonOptionGreen, paddingVertical: spacing.sm, alignItems: 'center', opacity: actingOnOption ? 0.5 : 1 }}
                  >
                    <Text style={{ ...typography.label, color: '#fff' }}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleRejectOption(o.threadId)}
                    disabled={actingOnOption}
                    style={{ flex: 1, borderRadius: 999, borderWidth: 1, borderColor: colors.buttonSkipRed, paddingVertical: spacing.sm, alignItems: 'center', opacity: actingOnOption ? 0.5 : 1 }}
                  >
                    <Text style={{ ...typography.label, color: colors.buttonSkipRed }}>Decline</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}

          <Text style={[st.sectionLabel, { marginTop: spacing.xl }]}>All options</Text>
          {options.map((o) => (
            <View key={o.threadId} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <View>
                <Text style={{ ...typography.body, color: colors.textPrimary }}>{o.clientName} · {o.date}</Text>
                <Text style={st.metaText}>{o.modelName}</Text>
              </View>
              <Text style={{ ...typography.label, fontSize: 10, color: o.modelApproval === 'approved' ? colors.buttonOptionGreen : o.modelApproval === 'rejected' ? colors.buttonSkipRed : '#B8860B' }}>
                {o.modelApproval === 'approved'
                  ? uiCopy.dashboard.optionRequestModelApprovalApproved
                  : o.modelApproval === 'rejected'
                    ? uiCopy.dashboard.optionRequestModelApprovalRejected
                    : uiCopy.dashboard.optionRequestModelApprovalPending}
              </Text>
            </View>
          ))}
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
        <View style={{
          position: 'absolute', left: 0, right: 0, top: 0, bottom: bottomTabInset,
          backgroundColor: colors.background, zIndex: 1000,
        }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ ...typography.label, fontSize: 13, color: colors.textSecondary }}>
              {agencyDirectConvs.find((c) => c.id === openDirectConvId)?.title ?? uiCopy.model.agencyLabel}
            </Text>
            <TouchableOpacity onPress={() => setOpenDirectConvId(null)}>
              <Text style={{ ...typography.label, color: colors.textPrimary }}>Close</Text>
            </TouchableOpacity>
          </View>
          <OrgMessengerInline
            conversationId={openDirectConvId}
            headerTitle={agencyDirectConvs.find((c) => c.id === openDirectConvId)?.title ?? uiCopy.model.agencyLabel}
            viewerUserId={userId ?? null}
          />
        </View>
      )}

      <View style={[st.bottomTabBar, { paddingBottom: insets.bottom }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tabRow}>
          {([
            { key: 'calendar' as const, label: 'Calendar' },
            { key: 'messages' as const, label: 'Messages' },
            {
              key: 'options' as const,
              label: `Options${
                outstandingOptions.length + pendingConfirmations.length
                  ? ` (${outstandingOptions.length + pendingConfirmations.length})`
                  : ''
              }`,
            },
            { key: 'profile' as const, label: 'Profile' },
          ]).map((t) => (
            <TouchableOpacity key={t.key} onPress={() => handleModelTabPress(t.key)} style={st.tabItem}>
              <Text style={[st.tabLabel, tab === t.key && st.tabLabelActive]}>{t.label}</Text>
              {tab === t.key && <View style={st.tabUnderline} />}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {selectedOptionThread && (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: bottomTabInset, backgroundColor: 'rgba(0,0,0,0.1)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg, zIndex: 995 }}>
          <View style={{ width: '100%', maxWidth: 420, maxHeight: '80%', backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                {optionChatAgency?.logo_url ? (
                  <Image source={{ uri: optionChatAgency.logo_url }} style={{ width: 32, height: 32, borderRadius: 6 }} resizeMode="contain" />
                ) : null}
                <View>
                  <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary }}>Agency</Text>
                  <Text style={{ ...typography.label, color: colors.textPrimary }}>{optionChatAgency?.name ?? 'Agency'}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setSelectedOptionThread(null)}>
                <Text style={{ ...typography.label, fontSize: 11, color: colors.textSecondary }}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 200, marginBottom: spacing.sm }}>
              {getMessages(selectedOptionThread).map((msg) => (
                <View key={msg.id} style={{ alignSelf: msg.from === 'agency' ? 'flex-end' : 'flex-start', maxWidth: '85%', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: 12, marginBottom: spacing.xs, backgroundColor: msg.from === 'agency' ? colors.buttonOptionGreen : '#E2E0DB' }}>
                  <Text style={{ ...typography.body, fontSize: 12, color: msg.from === 'agency' ? '#fff' : colors.textPrimary }}>{msg.text}</Text>
                </View>
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TextInput value={optChatInput} onChangeText={setOptChatInput} placeholder="Message..." placeholderTextColor={colors.textSecondary}
                style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, ...typography.body, fontSize: 12, color: colors.textPrimary }} />
              <TouchableOpacity onPress={() => { if (optChatInput.trim()) { addMessage(selectedOptionThread, 'model', optChatInput.trim()); setOptChatInput(''); } }}
                style={{ borderRadius: 999, backgroundColor: colors.buttonOptionGreen, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, justifyContent: 'center' }}>
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
            paddingHorizontal: spacing.lg,
          }}
        >
          <View
            style={{
              width: '100%',
              maxWidth: 420,
              maxHeight: '85%',
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
                </View>
              );
            })()}
            <View style={{ marginBottom: spacing.md }}>
              <Text style={st.sectionLabel}>
                {openEntry.option_request_id ? uiCopy.calendar.reschedule : uiCopy.calendar.editEntry}
              </Text>
              <Text style={[st.metaText, { marginBottom: spacing.sm }]}>
                {openEntry.option_request_id
                  ? uiCopy.calendar.optionScheduleHelp
                  : uiCopy.calendar.manualBlockHelp}
              </Text>
              {!openEntry.option_request_id ? (
                <>
                  <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary, marginBottom: 4 }}>Title</Text>
                  <TextInput
                    value={entryScheduleDraft.title}
                    onChangeText={(t) => setEntryScheduleDraft((p) => ({ ...p, title: t }))}
                    placeholderTextColor={colors.textSecondary}
                    style={[st.input, { marginBottom: spacing.sm }]}
                  />
                </>
              ) : null}
              <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary, marginBottom: 4 }}>Date (YYYY-MM-DD)</Text>
              <TextInput
                value={entryScheduleDraft.date}
                onChangeText={(t) => setEntryScheduleDraft((p) => ({ ...p, date: t }))}
                placeholderTextColor={colors.textSecondary}
                style={[st.input, { marginBottom: spacing.sm }]}
              />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary, marginBottom: 4 }}>From</Text>
                  <TextInput
                    value={entryScheduleDraft.start_time}
                    onChangeText={(t) => setEntryScheduleDraft((p) => ({ ...p, start_time: t }))}
                    placeholderTextColor={colors.textSecondary}
                    style={st.input}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...typography.label, fontSize: 10, color: colors.textSecondary, marginBottom: 4 }}>To</Text>
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
                bookingBriefRaw={(openEntry.booking_details as BookingDetails | null)?.booking_brief}
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
                    (openEntry.booking_details as { shared_notes?: SharedBookingNote[] } | null)?.shared_notes ?? []
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
                  value={sharedNoteDraft}
                  onChangeText={setSharedNoteDraft}
                  multiline
                  placeholder={uiCopy.calendar.sharedNotePlaceholder}
                  placeholderTextColor={colors.textSecondary}
                  style={[st.input, { minHeight: 72, textAlignVertical: 'top', borderRadius: 12 }]}
                />
                <TouchableOpacity
                  onPress={async () => {
                    if (!profile || !openEntry?.option_request_id || !sharedNoteDraft.trim()) return;
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
                    {savingSharedNote ? uiCopy.calendar.postingSharedNote : uiCopy.calendar.postSharedNote}
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
          </View>
        </View>
      )}
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
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.xs },
  backArrow: { fontSize: 22, color: colors.textPrimary },
  backLabel: { ...typography.label, fontSize: 11, color: colors.textSecondary },
  brand: { ...typography.heading, color: colors.textPrimary, marginBottom: spacing.xs },
  heading: { ...typography.heading, fontSize: 18, color: colors.textPrimary, marginBottom: spacing.md },
  label: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },
  tabRow: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center', paddingHorizontal: spacing.sm },
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
  tabUnderline: { marginTop: 4, height: 2, width: 24, backgroundColor: colors.accentGreen, borderRadius: 1 },
  section: { marginTop: spacing.lg, gap: spacing.sm },
  sectionLabel: { ...typography.label, color: colors.textSecondary },
  metaText: { ...typography.body, fontSize: 12, color: colors.textSecondary },
  measureRow: { flexDirection: 'row', justifyContent: 'space-between' },
  measureItem: { alignItems: 'flex-start' },
  measureLabel: { ...typography.label, fontSize: 10, color: colors.textSecondary },
  measureValue: { ...typography.body, color: colors.textPrimary },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, ...typography.body, color: colors.textPrimary },
  chatRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
    borderWidth: 1, borderColor: colors.border, borderRadius: 12, marginBottom: spacing.xs,
  },
  chatRowKicker: { ...typography.label, fontSize: 9, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
  chatRowLabel: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  chatRowOpen: { ...typography.label, fontSize: 11, color: colors.textSecondary },
});

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Linking, Alert, ActivityIndicator } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { getModelsFromSupabase, getModelForUserFromSupabase } from '../services/modelsSupabase';
import { supabase } from '../../lib/supabase';
import { getModelBookingThreadIds, getRecruitingThread, getRecruitingMessages, addRecruitingMessage } from '../store/recruitingChats';
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
  upsertCalendarEntry,
  insertCalendarEntry,
  type CalendarEntry,
  type CalendarEntryType,
  updateBookingDetails,
} from '../services/calendarSupabase';
import { BookingChatView } from '../views/BookingChatView';
import { useAuth } from '../context/AuthContext';

type ModelProfile = {
  id: string;
  name: string;
  height: number;
  bust: number;
  waist: number;
  hips: number;
  city: string;
  currentLocation: string;
  hairColor: string;
};

type ModelTab = 'calendar' | 'messages' | 'options' | 'profile';

const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
const ENTRY_COLORS: Record<string, string> = {
  personal: '#2E7D32',
  booking: '#C62828', // Job / booking in red
  option: '#1565C0', // Options in blue
  gosee: '#757575', // Casting / gosee in grey
  casting: '#757575',
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
  const [openChatInput, setOpenChatInput] = useState('');
  const [options, setOptions] = useState<OptionRequest[]>([]);
  const [selectedOptionThread, setSelectedOptionThread] = useState<string | null>(null);
  const [optChatInput, setOptChatInput] = useState('');
  const [locationLoading, setLocationLoading] = useState(false);
  const [openEntry, setOpenEntry] = useState<CalendarEntry | null>(null);
  const [modelNotesDraft, setModelNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  const handleShareLocation = async () => {
    if (!profile) return;
    setLocationLoading(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 10000 })
      );
      const { latitude, longitude } = position.coords;
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json();
      const cityName =
        data.address?.city ?? data.address?.town ?? data.address?.village ?? data.address?.state ?? 'Unknown';

      await supabase.from('models').update({ current_location: cityName }).eq('id', profile.id);
      setProfile((prev) => prev ? { ...prev, currentLocation: cityName } : prev);
      Alert.alert('Location Updated', `Your current city has been set to: ${cityName}`);
    } catch (err: any) {
      Alert.alert('Location Error', err?.message ?? 'Could not retrieve your location.');
    } finally {
      setLocationLoading(false);
    }
  };

  useEffect(() => {
    setBookingThreadIds(getModelBookingThreadIds());
    const interval = setInterval(() => setBookingThreadIds(getModelBookingThreadIds()), 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (userId) {
      getModelForUserFromSupabase(userId).then((m) => {
        if (!m) return;
        setProfile({
          id: m.id, name: m.name, height: m.height,
          bust: m.bust ?? 0, waist: m.waist ?? 0, hips: m.hips ?? 0,
          city: m.city ?? '', currentLocation: m.current_location ?? '', hairColor: m.hair_color ?? '',
        });
        loadCalendar(m.id);
        loadOptionsForModel(m.id);
      });
    } else {
      getModelsFromSupabase().then((list) => {
        const m = list[0];
        if (!m) return;
        setProfile({
          id: m.id, name: m.name, height: m.height,
          bust: m.bust ?? 0, waist: m.waist ?? 0, hips: m.hips ?? 0,
          city: m.city ?? '', currentLocation: m.current_location ?? '', hairColor: m.hair_color ?? '',
        });
        loadCalendar(m.id);
        loadOptionsForModel(m.id);
      });
    }
  }, [userId]);

  useEffect(() => {
    setOptions(getOptionRequests());
    const unsub = subscribe(() => setOptions(getOptionRequests()));
    return unsub;
  }, []);

  const loadCalendar = async (modelId: string) => {
    const entries = await getCalendarForModel(modelId);
    setCalEntries(entries);
  };

  const outstandingOptions = useMemo(() =>
    profile ? getOutstandingOptionsForModel(profile.id) : [],
    [profile, options]
  );

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

  const dateHasEntry = (dateStr: string) => calEntries.some((e) => e.date === dateStr);
  const dateEntryType = (dateStr: string): string | null => {
    const entry = calEntries.find((e) => e.date === dateStr);
    return entry?.entry_type ?? null;
  };

  const handleAddPersonalEntry = async () => {
    if (!profile || !selectedDate) return;
    await insertCalendarEntry(profile.id, selectedDate, 'blocked', {
      start_time: newEntryStart,
      end_time: newEntryEnd,
      title: newEntryTitle.trim() || 'Personal',
      entry_type: 'personal',
    });
    setNewEntryTitle('');
    loadCalendar(profile.id);
  };

  const handleApproveOption = async (threadId: string) => {
    await approveOptionAsModel(threadId);
  };

  const handleRejectOption = async (threadId: string) => {
    await rejectOptionAsModel(threadId);
  };

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

      <View style={st.tabRow}>
        {([
          { key: 'calendar', label: 'Calendar' },
          { key: 'messages', label: 'Messages' },
          { key: 'options', label: `Options${outstandingOptions.length ? ` (${outstandingOptions.length})` : ''}` },
          { key: 'profile', label: 'Profile' },
        ] as { key: ModelTab; label: string }[]).map((t) => (
          <TouchableOpacity key={t.key} onPress={() => setTab(t.key)} style={st.tabItem}>
            <Text style={[st.tabLabel, tab === t.key && st.tabLabelActive]}>{t.label}</Text>
            {tab === t.key && <View style={st.tabUnderline} />}
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'profile' && (
        <ScrollView style={{ flex: 1 }}>
          <View style={st.section}>
            <Text style={st.sectionLabel}>Status</Text>
            <Text style={st.metaText}>Current location: {profile.currentLocation}</Text>
            <Text style={st.metaText}>Base: {profile.city} · Hair: {profile.hairColor}</Text>
          </View>
          <View style={st.section}>
            <Text style={st.sectionLabel}>Share Location</Text>
            <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.xs }}>
              Only your current city will be shared. No exact location data is stored.
            </Text>
            <TouchableOpacity
              onPress={handleShareLocation}
              disabled={locationLoading}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
                borderRadius: 999, backgroundColor: colors.accentGreen, paddingVertical: spacing.sm,
                opacity: locationLoading ? 0.6 : 1,
              }}
            >
              {locationLoading && <ActivityIndicator size="small" color="#fff" />}
              <Text style={{ ...typography.label, color: '#fff' }}>
                {locationLoading ? 'Locating...' : 'Share Location'}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={st.section}>
            <Text style={st.sectionLabel}>Measurements</Text>
            <View style={st.measureRow}>
              <Measure label="Height" value={profile.height} />
              <Measure label="Bust" value={profile.bust} />
              <Measure label="Waist" value={profile.waist} />
              <Measure label="Hips" value={profile.hips} />
            </View>
          </View>

          <View style={[st.section, { marginTop: spacing.xl, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border }]}>
            <Text style={st.sectionLabel}>Account</Text>
            <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm }}>
              Dein Konto und alle zugehörigen Daten können von dir gelöscht werden. Die Daten werden 30 Tage archiviert und danach endgültig entfernt.
            </Text>
            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  'Account löschen',
                  'Dein Konto wird zur Löschung angemeldet. Deine Daten bleiben 30 Tage archiviert und werden danach endgültig gelöscht. Du kannst dich in dieser Zeit nicht mehr anmelden. Fortfahren?',
                  [
                    { text: 'Abbrechen', style: 'cancel' },
                    {
                      text: 'Account löschen',
                      style: 'destructive',
                      onPress: async () => {
                        setDeletingAccount(true);
                        const { requestAccountDeletion } = await import('../services/accountSupabase');
                        const ok = await requestAccountDeletion();
                        setDeletingAccount(false);
                        if (ok) await signOut();
                      },
                    },
                  ]
                );
              }}
              disabled={deletingAccount}
              style={{ borderRadius: 999, borderWidth: 1, borderColor: '#e74c3c', paddingVertical: spacing.sm, alignItems: 'center' }}
            >
              <Text style={{ ...typography.label, fontSize: 12, color: '#e74c3c' }}>{deletingAccount ? 'Wird gelöscht…' : 'Account löschen'}</Text>
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
                            const existing =
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
                <TouchableOpacity onPress={handleAddPersonalEntry} style={{ borderRadius: 999, backgroundColor: '#2E7D32', paddingVertical: spacing.sm, alignItems: 'center' }}>
                  <Text style={{ ...typography.label, color: '#fff' }}>Add entry</Text>
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
                return (
                  <TouchableOpacity key={id} style={st.chatRow} onPress={() => setOpenBookingThreadId(id)}>
                    <Text style={st.chatRowLabel}>{t.modelName} (Agency)</Text>
                    <Text style={st.chatRowOpen}>Open chat</Text>
                  </TouchableOpacity>
                );
              })
            )}
          </View>

          <Text style={[st.sectionLabel, { marginTop: spacing.lg }]}>Option chats</Text>
          {options.filter((o) => o.status !== 'rejected').map((o) => (
            <TouchableOpacity key={o.threadId} style={st.chatRow} onPress={() => setSelectedOptionThread(o.threadId)}>
              <View style={{ flex: 1 }}>
                <Text style={st.chatRowLabel}>{o.clientName} · {o.date}</Text>
                <Text style={st.metaText}>{o.modelName}{o.startTime ? ` · ${o.startTime}–${o.endTime}` : ''}</Text>
              </View>
              <Text style={{ ...typography.label, fontSize: 9, color: o.modelApproval === 'approved' ? colors.buttonOptionGreen : '#B8860B' }}>
                {o.modelApproval === 'approved' ? 'Approved' : o.modelApproval === 'rejected' ? 'Rejected' : 'Pending'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {tab === 'options' && (
        <ScrollView style={{ flex: 1 }}>
          <Text style={st.sectionLabel}>Outstanding options</Text>
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
                    style={{ flex: 1, borderRadius: 999, backgroundColor: colors.buttonOptionGreen, paddingVertical: spacing.sm, alignItems: 'center' }}
                  >
                    <Text style={{ ...typography.label, color: '#fff' }}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleRejectOption(o.threadId)}
                    style={{ flex: 1, borderRadius: 999, borderWidth: 1, borderColor: colors.buttonSkipRed, paddingVertical: spacing.sm, alignItems: 'center' }}
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
                {o.modelApproval === 'approved' ? 'Approved' : o.modelApproval === 'rejected' ? 'Declined' : 'Pending'}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}

      {openBookingThreadId && (
        <BookingChatView
          threadId={openBookingThreadId}
          fromRole="model"
          onClose={() => setOpenBookingThreadId(null)}
        />
      )}

      {selectedOptionThread && (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.1)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg }}>
          <View style={{ width: '100%', maxWidth: 420, maxHeight: '80%', backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
              <Text style={{ ...typography.label, color: colors.textPrimary }}>Option chat</Text>
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
              <TouchableOpacity onPress={() => { if (optChatInput.trim()) { addMessage(selectedOptionThread, 'agency', optChatInput.trim()); setOptChatInput(''); } }}
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
            <Text style={st.sectionLabel}>My notes</Text>
            <TextInput
              value={modelNotesDraft}
              onChangeText={setModelNotesDraft}
              multiline
              placeholder="Notes for this job / casting / option…"
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
                      await upsertCalendarEntry(
                        profile.id,
                        openEntry.date,
                        openEntry.status,
                        modelNotesDraft,
                        {
                          start_time: openEntry.start_time ?? undefined,
                          end_time: openEntry.end_time ?? undefined,
                          title: openEntry.title ?? undefined,
                          entry_type: openEntry.entry_type,
                        },
                      );
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
                  {savingNotes ? 'Saving…' : 'Save notes'}
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
  tabRow: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.sm },
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
  chatRowLabel: { ...typography.body, color: colors.textPrimary },
  chatRowOpen: { ...typography.label, fontSize: 11, color: colors.textSecondary },
});

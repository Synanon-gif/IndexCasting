import React, { useEffect, useMemo, useRef, useState } from 'react';
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
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
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
  type OptionRequest,
  type ChatStatus,
} from '../store/optionRequests';
import { AgencyRecruitingView } from './AgencyRecruitingView';
import { getModelsForAgencyFromSupabase, removeModelFromAgency, type SupabaseModel } from '../services/modelsSupabase';
import {
  getPhotosForModel,
  upsertPhotosForModel,
  syncPortfolioToModel,
  uploadModelPhoto,
} from '../services/modelPhotosSupabase';
import { supabase } from '../../lib/supabase';
import { getBookersForAgency, createBooker, deleteBooker, type Booker } from '../services/bookersSupabase';
import { getAgencies, type Agency } from '../services/agenciesSupabase';
import { createGuestLink, getGuestLinksForAgency, buildGuestUrl, deactivateGuestLink, type GuestLink } from '../services/guestLinksSupabase';
import { getCalendarEntriesForAgency, type AgencyCalendarItem, updateBookingDetails } from '../services/calendarSupabase';
import {
  getManualEventsForOwner,
  insertManualEvent,
  deleteManualEvent,
  MANUAL_EVENT_COLORS,
  type UserCalendarEvent,
} from '../services/userCalendarEventsSupabase';
import { MonthCalendarView, type CalendarDayEvent } from '../components/MonthCalendarView';

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

type AgencyTab =
  | 'dashboard'
  | 'myModels'
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
  const { signOut } = useAuth();
  const [tab, setTab] = useState<AgencyTab>('dashboard');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [models, setModels] = useState<AgencyModel[]>([]);
  const [fullModels, setFullModels] = useState<SupabaseModel[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [bookers, setBookers] = useState<Booker[]>([]);
  const [calendarItems, setCalendarItems] = useState<AgencyCalendarItem[]>([]);
  const [manualCalendarEvents, setManualCalendarEvents] = useState<UserCalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [selectedCalendarItem, setSelectedCalendarItem] = useState<AgencyCalendarItem | null>(null);
  const [selectedManualEvent, setSelectedManualEvent] = useState<UserCalendarEvent | null>(null);
  const [showAddManualEvent, setShowAddManualEvent] = useState(false);
  const [newEventForm, setNewEventForm] = useState({ date: '', start_time: '09:00', end_time: '17:00', title: '', color: MANUAL_EVENT_COLORS[0] });
  const [agencyNotesDraft, setAgencyNotesDraft] = useState('');
  const [savingManualEvent, setSavingManualEvent] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const currentAgencyId = agencies[0]?.id ?? '';

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
    getBookersForAgency(currentAgencyId).then(setBookers);
    loadOptionRequestsForAgency(currentAgencyId);
  }, [currentAgencyId]);

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

  if (tab === 'recruiting') {
    return <AgencyRecruitingView onBack={() => setTab('dashboard')} agencyId={currentAgencyId} />;
  }

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

      <View style={s.tabRow}>
        {([
          { key: 'dashboard', label: 'Dashboard' },
          { key: 'myModels', label: 'My Models' },
          { key: 'messages', label: 'Messages' },
          { key: 'calendar', label: 'Calendar' },
          { key: 'recruiting', label: 'Recruiting' },
          { key: 'bookers', label: 'Bookers' },
          { key: 'guestLinks', label: 'Guest Links' },
          { key: 'settings', label: 'Settings' },
        ] as { key: AgencyTab; label: string }[]).map((t) => (
          <TouchableOpacity key={t.key} onPress={() => setTab(t.key)} style={s.tabItem}>
            <Text style={[s.tabLabel, tab === t.key && s.tabLabelActive]}>{t.label}</Text>
            {tab === t.key && <View style={s.tabUnderline} />}
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'dashboard' && (
        <DashboardTab models={models} />
      )}

      {tab === 'myModels' && (
        <MyModelsTab
          models={fullModels}
          agencyId={currentAgencyId}
          onRefresh={() => getModelsForAgencyFromSupabase(currentAgencyId).then(setFullModels)}
        />
      )}

      {tab === 'messages' && (
        <AgencyMessagesTab />
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
        <BookersTab
          bookers={bookers}
          agencyId={currentAgencyId}
          onRefresh={() => getBookersForAgency(currentAgencyId).then(setBookers)}
        />
      )}

      {tab === 'guestLinks' && (
        <GuestLinksTab agencyId={currentAgencyId} agencyEmail={agencies[0]?.email ?? ''} agencyName={agencies[0]?.name ?? ''} models={fullModels} />
      )}

      {tab === 'settings' && (
        <ScrollView style={{ flex: 1 }}>
          <View style={{ marginTop: spacing.md, marginBottom: spacing.lg }}>
            <Text style={s.sectionLabel}>Account</Text>
            <Text style={[s.metaText, { marginBottom: spacing.sm }]}>
              Your account and all associated data can be deleted by you. Data will be archived for 30 days and then permanently removed.
            </Text>
            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  'Delete account',
                  'Your account will be scheduled for deletion. Your data will be kept for 30 days and then permanently deleted. You will not be able to sign in during this period. Continue?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete account',
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
              <Text style={{ ...typography.label, fontSize: 12, color: '#e74c3c' }}>{deletingAccount ? 'Deleting…' : 'Delete account'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
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
            <Text style={s.sectionLabel}>Agency notes</Text>
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
                    alignSelf: 'flex-auto',
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
                  const created = await insertManualEvent({ owner_id: currentAgencyId, owner_type: 'agency', ...newEventForm });
                  setSavingManualEvent(false);
                  if (created) { await loadAgencyCalendar(); setShowAddManualEvent(false); setNewEventForm({ date: '', start_time: '09:00', end_time: '17:00', title: '', color: MANUAL_EVENT_COLORS[0] }); }
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
            <Text style={s.sectionLabel}>{selectedManualEvent.title}</Text>
            <Text style={s.metaText}>{selectedManualEvent.date} · {selectedManualEvent.start_time || '—'}{selectedManualEvent.end_time ? ` – ${selectedManualEvent.end_time}` : ''}</Text>
            {selectedManualEvent.note ? <Text style={{ ...typography.body, marginTop: spacing.sm }}>{selectedManualEvent.note}</Text> : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <TouchableOpacity style={[s.filterPill, { flex: 1 }]} onPress={async () => { if (await deleteManualEvent(selectedManualEvent.id)) { await loadAgencyCalendar(); setSelectedManualEvent(null); } }}>
                <Text style={[s.filterPillLabel, { color: colors.buttonSkipRed }]}>Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.filterPill, { flex: 1 }]} onPress={() => setSelectedManualEvent(null)}>
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
  <ScrollView style={{ flex: 1 }}>
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
  </ScrollView>
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
    <View style={{ flex: 1 }}>
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

      <ScrollView style={{ flex: 1 }}>
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
      </ScrollView>
    </View>
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
  const [modelPhotos, setModelPhotos] = useState<Array<{id?: string; url: string; visible: boolean}>>([]);
  const [newPhotoUrl, setNewPhotoUrl] = useState('');
  const [showPolasOnProfile, setShowPolasOnProfile] = useState(true);

  const countries = useMemo(() =>
    Array.from(new Set(models.map((m) => m.country || m.city || 'Unknown').filter(Boolean))).sort(),
    [models]
  );

  const filtered = useMemo(() => {
    if (!countryFilter) return models;
    return models.filter((m) => (m.country || m.city || '') === countryFilter);
  }, [models, countryFilter]);

  useEffect(() => {
    if (!selectedModel) {
      setModelPhotos([]);
      return;
    }
    getPhotosForModel(selectedModel.id, 'portfolio').then((photos) => {
      setModelPhotos(
        photos.map((p) => ({ id: p.id, url: p.url, visible: p.visible }))
      );
    });
  }, [selectedModel?.id]);

  const handleAddModel = async () => {
    const name = addFields.name?.trim();
    if (!name || !agencyId) return;
    setAddLoading(true);
    try {
      const { data: created, error } = await supabase
        .from('models')
        .insert({
          agency_id: agencyId,
          name,
          email: addFields.email?.trim() || null,
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
    if (modelPhotos.length < 5) {
      Alert.alert('Minimum 5 photos', 'Please add at least 5 photos. The first photo is the cover (shown when clients swipe).');
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
    await upsertPhotosForModel(selectedModel.id, photoPayload);
    await syncPortfolioToModel(selectedModel.id, modelPhotos.map((p) => p.url));

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
  const togglePhotoVisibility = (photo: any, idx: number) => {
    const next = [...modelPhotos];
    next[idx] = { ...photo, visible: !photo.visible };
    setModelPhotos(next);
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handlePhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target?.files?.[0];
    if (!file || !selectedModel || !file.type.startsWith('image/')) return;
    e.target.value = '';
    setUploadingPhoto(true);
    const url = await uploadModelPhoto(selectedModel.id, file);
    setUploadingPhoto(false);
    if (url) setModelPhotos((prev) => [...prev, { url, visible: true }]);
  };

  if (selectedModel) {
    const ef = (field: string, fallback: any) => editField[field] ?? String(fallback ?? '');
    return (
      <ScrollView style={{ flex: 1 }}>
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
          <Text style={s.sectionLabel}>Model Photos (min. 5)</Text>
          <Text style={{ ...typography.body, fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm }}>
            First photo = cover (shown when clients swipe). Add at least 5 photos.
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
            Photos ({modelPhotos.length}/5 min) — first = cover
          </Text>
          {modelPhotos.map((photo, idx) => (
            <View key={photo.id || `photo-${idx}`} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              {typeof Image !== 'undefined' && photo.url ? (
                <Image source={{ uri: photo.url }} style={{ width: 40, height: 40, borderRadius: 4, marginRight: 8, backgroundColor: colors.border }} resizeMode="cover" />
              ) : null}
              <Text style={{ ...typography.body, fontSize: 11, flex: 1 }} numberOfLines={1}>{photo.url ? (photo.url.length > 50 ? photo.url.slice(0, 47) + '…' : photo.url) : `Photo ${idx + 1}`}</Text>
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
          
          {/* Show on profile toggle */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, gap: spacing.sm }}>
            <TouchableOpacity onPress={() => setShowPolasOnProfile(!showPolasOnProfile)} style={[s.apiBtn, showPolasOnProfile && { borderColor: colors.accent }]}>
              <Text style={s.apiBtnLabel}>{showPolasOnProfile ? '✓ Show polas on profile' : 'Show polas on profile'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity onPress={handleSaveModel} style={s.saveBtn}>
          <Text style={s.saveBtnLabel}>Save changes</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{ marginTop: spacing.xl, paddingVertical: spacing.sm, borderRadius: 8, borderWidth: 1, borderColor: '#e74c3c', alignItems: 'center' }}
          onPress={() => {
            Alert.alert(
              'Remove model',
              'This will unassign the model from your agency and remove all representation (e.g. territories). The model profile remains but is no longer represented by you. Continue?',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
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
          <Text style={{ ...typography.label, fontSize: 12, color: '#e74c3c' }}>Remove model from agency</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }}>
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
          </View>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {m.is_visible_commercial && <View style={s.visTag}><Text style={s.visTagLabel}>C</Text></View>}
            {m.is_visible_fashion && <View style={[s.visTag, { borderColor: colors.accentBrown }]}><Text style={[s.visTagLabel, { color: colors.accentBrown }]}>F</Text></View>}
          </View>
          <Text style={{ fontSize: 14, color: colors.textSecondary, marginLeft: spacing.sm }}>›</Text>
        </TouchableOpacity>
      ))}
      {filtered.length === 0 && <Text style={s.metaText}>No models found.</Text>}
    </ScrollView>
  );
};

const AgencyMessagesTab: React.FC = () => {
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
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
        <Text style={s.sectionLabel}>Messages</Text>
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
                    r.modelApproval === 'approved' && s.approvalBadgeApproved,
                    r.modelApproval === 'rejected' && s.approvalBadgeRejected,
                    r.modelApproval === 'pending' && s.approvalBadgePending,
                  ]}>
                    <Text style={[
                      s.approvalBadgeLabel,
                      r.modelApproval === 'approved' && s.approvalBadgeLabelApproved,
                      r.modelApproval === 'rejected' && s.approvalBadgeLabelRejected,
                      r.modelApproval === 'pending' && s.approvalBadgeLabelPending,
                    ]}>
                      {r.modelApproval === 'approved' ? 'Model ✓' : r.modelApproval === 'rejected' ? 'Model ✗' : 'Model ⏳'}
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
          {request.modelApproval === 'approved' && clientPriceStatus === 'pending' && finalStatus !== 'job_confirmed' && (
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
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <TextInput
                  value={agencyCounterInput}
                  onChangeText={setAgencyCounterInput}
                  placeholder="Counter (e.g. 3000)"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="numeric"
                  style={[s.chatInput, { flex: 1, minWidth: 80 }]}
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
                  <Text style={s.filterPillLabel}>Counter offer</Text>
                </TouchableOpacity>
              </View>
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
    </View>
  );
};

const BookersTab: React.FC<{
  bookers: Booker[];
  agencyId: string;
  onRefresh: () => void;
}> = ({ bookers, agencyId, onRefresh }) => {
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [isMaster, setIsMaster] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim() || !agencyId) return;
    await createBooker({ agency_id: agencyId, display_name: newName.trim(), email: newEmail.trim() || undefined, is_master: isMaster });
    setNewName('');
    setNewEmail('');
    setIsMaster(false);
    onRefresh();
  };

  return (
    <ScrollView style={{ flex: 1 }}>
      <Text style={s.sectionLabel}>Bookers</Text>
      <Text style={s.metaText}>Each booker has their own login. The master account oversees all.</Text>
      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        {bookers.map((b) => (
          <View key={b.id} style={s.modelRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.modelName}>{b.display_name}{b.is_master ? ' (Master)' : ''}</Text>
              <Text style={s.metaText}>{b.email ?? '—'} · {b.bookings_completed} bookings</Text>
            </View>
          </View>
        ))}
      </View>
      <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
        <Text style={s.sectionLabel}>Add booker</Text>
        <TextInput value={newName} onChangeText={setNewName} placeholder="Booker name" placeholderTextColor={colors.textSecondary} style={s.editInput} />
        <TextInput value={newEmail} onChangeText={setNewEmail} placeholder="Email" placeholderTextColor={colors.textSecondary} style={s.editInput} />
        <TouchableOpacity style={[s.filterPill, isMaster && s.filterPillActive]} onPress={() => setIsMaster((o) => !o)}>
          <Text style={[s.filterPillLabel, isMaster && s.filterPillLabelActive]}>Master account</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.saveBtn} onPress={handleCreate}>
          <Text style={s.saveBtnLabel}>Create booker</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
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
    <ScrollView style={{ flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
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
    </ScrollView>
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
  tabRow: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.sm },
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

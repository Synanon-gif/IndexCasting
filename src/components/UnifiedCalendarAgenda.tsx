/**
 * Mobile-first scrollable month agenda: all entries for the visible month as dated cards
 * (replaces dot-only month grid on narrow viewports).
 */
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import type { UnifiedAgencyCalendarRow } from '../utils/agencyCalendarUnified';
import type { CalendarProjectionViewerRole } from '../utils/calendarProjectionLabel';
import {
  getCalendarProjectionBadge,
  getBookingEntryProjectionBadge,
} from '../utils/calendarProjectionLabel';
import { attentionSignalsFromOptionRequestLike } from '../utils/optionRequestAttention';
import { attentionHeaderLabelFromSignals } from '../utils/negotiationAttentionLabels';
import type { ClientAssignmentFlag } from '../services/clientAssignmentsSupabase';
import type { AgencyCalendarItem, CalendarEntry } from '../services/calendarSupabase';

export type UnifiedCalendarAgendaProps = {
  calendarMonth: { year: number; month: number };
  setCalendarMonth: React.Dispatch<React.SetStateAction<{ year: number; month: number }>>;
  selectedDate: string | null;
  setSelectedDate: React.Dispatch<React.SetStateAction<string | null>>;
  rows: UnifiedAgencyCalendarRow[];
  viewerRole: CalendarProjectionViewerRole;
  assignmentByClientOrgId: Record<string, ClientAssignmentFlag>;
  onOpenUnifiedRow: (row: UnifiedAgencyCalendarRow) => void;
};

function rowInCalendarMonth(row: UnifiedAgencyCalendarRow, year: number, month0: number): boolean {
  const d = row.date?.trim();
  if (!d || d.length < 8) return false;
  const parts = d.split('-').map((x) => Number(x));
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return false;
  const y = parts[0];
  const m = parts[1];
  return y === year && m === month0 + 1;
}

function formatSectionDateLabel(ymd: string): string {
  const t = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(t.getTime())) return ymd;
  return t.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export const UnifiedCalendarAgenda: React.FC<UnifiedCalendarAgendaProps> = ({
  calendarMonth,
  setCalendarMonth,
  selectedDate,
  setSelectedDate,
  rows,
  viewerRole,
  assignmentByClientOrgId,
  onOpenUnifiedRow,
}) => {
  const { year, month } = calendarMonth;
  const monthLabel = new Date(year, month).toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const rowsInMonth = useMemo(
    () => rows.filter((r) => rowInCalendarMonth(r, year, month)),
    [rows, year, month],
  );

  const sections = useMemo(() => {
    const byDate = new Map<string, UnifiedAgencyCalendarRow[]>();
    for (const r of rowsInMonth) {
      const list = byDate.get(r.date) ?? [];
      list.push(r);
      byDate.set(r.date, list);
    }
    const dates = [...byDate.keys()].sort();
    return dates.map((date) => ({
      date,
      rows: (byDate.get(date) ?? []).sort((a, b) => a.sortKey.localeCompare(b.sortKey)),
    }));
  }, [rowsInMonth]);

  const renderOptionBadge = (item: AgencyCalendarItem) => {
    const badge = getCalendarProjectionBadge(
      item.option,
      item.calendar_entry,
      uiCopy.calendar.projectionBadge,
      viewerRole,
    );
    return (
      <View style={[styles.badge, { backgroundColor: badge.backgroundColor }]}>
        <Text style={[styles.badgeText, { color: badge.textColor }]}>{badge.label}</Text>
      </View>
    );
  };

  const renderBookingBadge = (entry: CalendarEntry) => {
    const badge = getBookingEntryProjectionBadge(entry, uiCopy.calendar.projectionBadge);
    return (
      <View style={[styles.badge, { backgroundColor: badge.backgroundColor }]}>
        <Text style={[styles.badgeText, { color: badge.textColor }]}>{badge.label}</Text>
      </View>
    );
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() =>
            setCalendarMonth((m) => (m.month === 0 ? { year: m.year - 1, month: 11 } : { year: m.year, month: m.month - 1 }))
          }
          hitSlop={12}
          style={styles.navBtn}
        >
          <Text style={styles.navLabel}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthTitle}>{monthLabel}</Text>
        <TouchableOpacity
          onPress={() =>
            setCalendarMonth((m) => (m.month === 11 ? { year: m.year + 1, month: 0 } : { year: m.year, month: m.month + 1 }))
          }
          hitSlop={12}
          style={styles.navBtn}
        >
          <Text style={styles.navLabel}>›</Text>
        </TouchableOpacity>
      </View>

      {sections.length === 0 ? (
        <Text style={styles.empty}>{uiCopy.calendar.agendaEmptyMonth}</Text>
      ) : (
        sections.map(({ date, rows: dayRows }) => {
          const isSel = selectedDate === date;
          return (
            <View key={date} style={styles.section}>
              <TouchableOpacity
                onPress={() => setSelectedDate(date)}
                style={[styles.sectionHeader, isSel && styles.sectionHeaderSelected]}
                accessibilityRole="button"
                accessibilityLabel={`${formatSectionDateLabel(date)}, tap to select day`}
              >
                <Text style={styles.sectionTitle}>{formatSectionDateLabel(date)}</Text>
                <Text style={styles.sectionYmd}>{date}</Text>
              </TouchableOpacity>
              {dayRows.map((row) => {
                if (row.kind === 'manual') {
                  const ev = row.ev;
                  return (
                    <TouchableOpacity key={row.id} style={styles.card} onPress={() => onOpenUnifiedRow(row)} activeOpacity={0.75}>
                      <View style={styles.cardTop}>
                        <Text style={styles.cardTitle}>{ev.title}</Text>
                        <View style={[styles.dot, { backgroundColor: ev.color || '#888' }]} />
                      </View>
                      <Text style={styles.cardMeta}>
                        {ev.start_time || '—'}
                        {ev.end_time ? ` – ${ev.end_time}` : ''}
                        {ev.note ? ` · ${ev.note}` : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                }
                if (row.kind === 'booking') {
                  const be = row.entry;
                  return (
                    <TouchableOpacity key={row.id} style={styles.card} onPress={() => onOpenUnifiedRow(row)} activeOpacity={0.75}>
                      <View style={styles.cardRow}>
                        <View style={styles.cardBody}>
                          <Text style={styles.cardTitle}>
                            {row.title} · {be.date}
                          </Text>
                          <Text style={styles.cardMeta}>{be.note ?? ''}</Text>
                        </View>
                        {renderBookingBadge(be)}
                      </View>
                    </TouchableOpacity>
                  );
                }
                const item = row.item;
                const { option, calendar_entry } = item;
                const dateStr = calendar_entry?.date ?? option.requested_date;
                const start = calendar_entry?.start_time ?? option.start_time ?? undefined;
                const end = calendar_entry?.end_time ?? option.end_time ?? undefined;
                const calSig = attentionSignalsFromOptionRequestLike({
                  status: option.status,
                  finalStatus: option.final_status,
                  clientPriceStatus: option.client_price_status,
                  modelApproval: option.model_approval,
                  modelAccountLinked: option.model_account_linked,
                  agencyCounterPrice: option.agency_counter_price,
                  proposedPrice: option.proposed_price,
                  hasConflictWarning: false,
                });
                const clientAttention =
                  viewerRole === 'client' && attentionHeaderLabelFromSignals(calSig, 'client') !== null;
                return (
                  <TouchableOpacity
                    key={option.id}
                    style={styles.card}
                    onPress={() => onOpenUnifiedRow(row)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.cardRow}>
                      <View style={styles.cardBody}>
                        <View style={styles.titleRow}>
                          {clientAttention ? (
                            <View style={styles.attentionDot} accessibilityLabel={uiCopy.calendar.actionRequiredA11y} />
                          ) : null}
                          <View style={{ flex: 1 }}>
                            <Text style={styles.cardTitle}>
                              {option.model_name ?? 'Model'} · {dateStr}
                            </Text>
                            <Text style={styles.cardMeta}>
                              {option.client_name ?? 'Client'}
                              {start ? ` · ${start}${end ? `–${end}` : ''}` : ''}
                            </Text>
                            {viewerRole === 'agency' &&
                            option.client_organization_id &&
                            assignmentByClientOrgId[option.client_organization_id] ? (
                              <Text style={styles.cardMeta}>
                                {assignmentByClientOrgId[option.client_organization_id].label}
                                {assignmentByClientOrgId[option.client_organization_id].assignedMemberName
                                  ? ` · ${assignmentByClientOrgId[option.client_organization_id].assignedMemberName}`
                                  : ''}
                              </Text>
                            ) : null}
                            {viewerRole === 'client' &&
                            option.client_organization_id &&
                            assignmentByClientOrgId[option.client_organization_id] ? (
                              <Text style={styles.cardMeta}>
                                {assignmentByClientOrgId[option.client_organization_id].label}
                                {assignmentByClientOrgId[option.client_organization_id].assignedMemberName
                                  ? ` · ${assignmentByClientOrgId[option.client_organization_id].assignedMemberName}`
                                  : ''}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                        {calendar_entry?.booking_details && viewerRole === 'client' && (
                          <Text style={styles.notePreview} numberOfLines={2}>
                            {(calendar_entry.booking_details as { client_notes?: string }).client_notes ??
                              (calendar_entry.booking_details as { agency_notes?: string }).agency_notes ??
                              (calendar_entry.booking_details as { model_notes?: string }).model_notes ??
                              ''}
                          </Text>
                        )}
                      </View>
                      {renderOptionBadge(item)}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  navBtn: { padding: spacing.xs },
  navLabel: { fontSize: 22, color: colors.textPrimary, fontWeight: '600' },
  monthTitle: { ...typography.label, fontSize: 14, color: colors.textPrimary, fontWeight: '700' },
  empty: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    paddingVertical: spacing.md,
  },
  section: { marginBottom: spacing.md },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionHeaderSelected: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: spacing.xs,
  },
  sectionTitle: { ...typography.label, fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  sectionYmd: { ...typography.body, fontSize: 11, color: colors.textSecondary },
  card: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: '#fff',
  },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardTitle: { ...typography.body, fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  cardMeta: { ...typography.body, fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  cardBody: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  attentionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
    backgroundColor: colors.buttonSkipRed,
  },
  notePreview: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 4,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  badge: {
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  badgeText: { ...typography.label, fontSize: 10 },
});

/**
 * Mobile month view: scrollable list of model calendar entries grouped by day (replaces dot grid).
 *
 * **INACTIVE — not wired in the app.** Do not refactor for color in this file until the surface is
 * productized. **Before any activation:** replace entry-only coloring with the canonical hierarchy
 * (`resolveModelCalendarEntryColor` from `modelCalendarSchedule.ts` + option lookup) so option-linked
 * rows match B2B when projection context exists. Until then, `getCalendarEntryBlockColor` here is
 * legacy-only and must not be copied as a pattern for new active UI.
 */
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import type { CalendarEntry } from '../services/calendarSupabase';
import { getCalendarEntryBlockColor } from '../utils/calendarProjectionLabel';
import { dedupeModelCalendarEntries } from '../utils/modelCalendarSchedule';

export type ModelCalendarMonthAgendaProps = {
  calendarMonth: { year: number; month: number };
  setCalendarMonth: React.Dispatch<React.SetStateAction<{ year: number; month: number }>>;
  selectedDate: string | null;
  setSelectedDate: React.Dispatch<React.SetStateAction<string | null>>;
  entries: CalendarEntry[];
  onEntryPress: (entry: CalendarEntry) => void;
  /** When true, suppress the built-in month header (parent already shows one). */
  hideHeader?: boolean;
};

function entryInMonth(e: CalendarEntry, year: number, month0: number): boolean {
  const d = e.date?.trim();
  if (!d || d.length < 8) return false;
  const parts = d.split('-').map((x) => Number(x));
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return false;
  return parts[0] === year && parts[1] === month0 + 1;
}

function formatSectionDateLabel(ymd: string): string {
  const t = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(t.getTime())) return ymd;
  return t.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export const ModelCalendarMonthAgenda: React.FC<ModelCalendarMonthAgendaProps> = ({
  calendarMonth,
  setCalendarMonth,
  selectedDate,
  setSelectedDate,
  entries,
  onEntryPress,
  hideHeader = false,
}) => {
  const { year, month } = calendarMonth;

  const dedupedEntries = useMemo(() => dedupeModelCalendarEntries(entries), [entries]);

  const rowsInMonth = useMemo(
    () => dedupedEntries.filter((e) => entryInMonth(e, year, month)),
    [dedupedEntries, year, month],
  );

  const sections = useMemo(() => {
    const byDate = new Map<string, CalendarEntry[]>();
    for (const e of rowsInMonth) {
      const d = e.date ?? '';
      if (!d) continue;
      const list = byDate.get(d) ?? [];
      list.push(e);
      byDate.set(d, list);
    }
    const dates = [...byDate.keys()].sort();
    return dates.map((date) => ({
      date,
      rows: (byDate.get(date) ?? []).sort((a, b) =>
        (a.start_time ?? '').localeCompare(b.start_time ?? ''),
      ),
    }));
  }, [rowsInMonth]);

  return (
    <View style={styles.wrapper}>
      {!hideHeader && (
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() =>
              setCalendarMonth((m) =>
                m.month === 0
                  ? { year: m.year - 1, month: 11 }
                  : { year: m.year, month: m.month - 1 },
              )
            }
            hitSlop={12}
            style={styles.navBtn}
          >
            <Text style={styles.navLabel}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.monthTitle}>
            {new Date(year, month).toLocaleString('en-US', { month: 'long', year: 'numeric' })}
          </Text>
          <TouchableOpacity
            onPress={() =>
              setCalendarMonth((m) =>
                m.month === 11
                  ? { year: m.year + 1, month: 0 }
                  : { year: m.year, month: m.month + 1 },
              )
            }
            hitSlop={12}
            style={styles.navBtn}
          >
            <Text style={styles.navLabel}>›</Text>
          </TouchableOpacity>
        </View>
      )}

      {sections.length === 0 ? (
        <Text style={styles.empty}>{uiCopy.calendar.agendaEmptyMonth}</Text>
      ) : (
        sections.map(({ date, rows }) => {
          const isSel = selectedDate === date;
          return (
            <View key={date} style={styles.section}>
              <TouchableOpacity
                onPress={() => setSelectedDate(date)}
                style={[styles.sectionHeader, isSel && styles.sectionHeaderSelected]}
                accessibilityRole="button"
              >
                <Text style={styles.sectionTitle}>{formatSectionDateLabel(date)}</Text>
                <Text style={styles.sectionYmd}>{date}</Text>
              </TouchableOpacity>
              {rows.map((entry) => {
                // Entry-only; if this component is reactivated, wire `resolveModelCalendarEntryColor`
                // + option lookup — see file header.
                const bg = getCalendarEntryBlockColor(entry);
                return (
                  <TouchableOpacity
                    key={entry.id}
                    style={[styles.card, { borderLeftWidth: 4, borderLeftColor: bg }]}
                    onPress={() => onEntryPress(entry)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.cardTitle}>
                      {(entry.start_time ?? '').toString().slice(0, 5) || '—'} ·{' '}
                      {entry.title || entry.entry_type}
                    </Text>
                    {entry.note ? <Text style={styles.cardMeta}>{entry.note}</Text> : null}
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
  cardTitle: { ...typography.body, fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  cardMeta: { ...typography.body, fontSize: 12, color: colors.textSecondary, marginTop: 4 },
});

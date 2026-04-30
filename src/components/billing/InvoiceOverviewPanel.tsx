/**
 * InvoiceOverviewPanel — Unified invoice overview (additive Billing sub-tab).
 *
 * Renders rows from BOTH `public.invoices` (Stripe-routed) AND
 * `public.manual_invoices` (manual PDFs), aggregated server-side via
 * `list_invoice_overview`. The panel is read-only on source data and only
 * mutates the operator-internal tracking overlay (status + short note) via
 * dedicated SECDEF RPCs.
 *
 * Boundaries:
 *   - Mounted from `BillingHubView` for both Agency and Client variants.
 *   - Never mounted in model workspace (billing firewall — I-PAY-10).
 *   - Filters/grouping happen client-side over the page returned by the RPC;
 *     `Load more` extends the offset window. The RPC enforces all access
 *     controls (membership, recipient-owner post-send) and never returns rows
 *     the caller can't see.
 *   - Row click opens a safe in-place details modal showing only fields that
 *     are already returned by the visible RPC row. Stripe / manual full-invoice
 *     editors live in their existing sub-tabs (Outgoing/Manual) and are NOT
 *     re-implemented here.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';
import { uiCopy } from '../../constants/uiCopy';
import {
  listInvoiceOverview,
  updateInvoiceTrackingNote,
  updateInvoiceTrackingStatus,
} from '../../services/invoicesOverviewSupabase';
import type {
  InvoiceOverviewDirection,
  InvoiceOverviewFilters,
  InvoiceOverviewRow,
  InvoiceOverviewSourceType,
  InvoiceOverviewTrackingStatus,
} from '../../types/invoiceOverviewTypes';

const PAGE_SIZE = 100;

type Props = {
  organizationId: string | null;
  variant: 'agency' | 'client';
};

export const InvoiceOverviewPanel: React.FC<Props> = ({ organizationId, variant }) => {
  const c = uiCopy.invoiceOverview;

  const [rows, setRows] = useState<InvoiceOverviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endReached, setEndReached] = useState(false);
  const [offset, setOffset] = useState(0);

  // Filters (client maintains them; we re-issue the RPC on change so the
  // server can apply them across the entire dataset, not only the page in mem).
  const [filterYear, setFilterYear] = useState<number | null>(null);
  const [filterMonth, setFilterMonth] = useState<number | null>(null);
  const [filterDirection, setFilterDirection] = useState<InvoiceOverviewDirection | null>(null);
  const [filterSource, setFilterSource] = useState<InvoiceOverviewSourceType | null>(null);
  const [filterTracking, setFilterTracking] = useState<InvoiceOverviewTrackingStatus | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchActive, setSearchActive] = useState('');

  const [openRow, setOpenRow] = useState<InvoiceOverviewRow | null>(null);

  const filtersForRpc: InvoiceOverviewFilters = useMemo(
    () => ({
      year: filterYear,
      month: filterMonth,
      direction: filterDirection,
      sourceType: filterSource,
      trackingStatus: filterTracking,
      search: searchActive.trim().length > 0 ? searchActive.trim() : null,
      limit: PAGE_SIZE,
      offset: 0,
    }),
    [filterYear, filterMonth, filterDirection, filterSource, filterTracking, searchActive],
  );

  const load = useCallback(async () => {
    if (!organizationId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    setEndReached(false);
    setOffset(0);
    try {
      const data = await listInvoiceOverview(organizationId, filtersForRpc);
      setRows(data);
      if (data.length < PAGE_SIZE) setEndReached(true);
      setOffset(data.length);
    } catch (e) {
      console.error('[InvoiceOverviewPanel] load error:', e);
      setError(c.errorLoad);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, filtersForRpc, c.errorLoad]);

  const loadMore = useCallback(async () => {
    if (!organizationId || loading || loadingMore || endReached) return;
    setLoadingMore(true);
    try {
      const data = await listInvoiceOverview(organizationId, {
        ...filtersForRpc,
        offset,
      });
      if (data.length === 0) {
        setEndReached(true);
      } else {
        setRows((prev) => [...prev, ...data]);
        setOffset((prev) => prev + data.length);
        if (data.length < PAGE_SIZE) setEndReached(true);
      }
    } catch (e) {
      console.error('[InvoiceOverviewPanel] loadMore error:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [organizationId, filtersForRpc, offset, loading, loadingMore, endReached]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSearchSubmit = useCallback(() => {
    setSearchActive(searchInput);
  }, [searchInput]);

  const clearAllFilters = useCallback(() => {
    setFilterYear(null);
    setFilterMonth(null);
    setFilterDirection(null);
    setFilterSource(null);
    setFilterTracking(null);
    setSearchInput('');
    setSearchActive('');
  }, []);

  const groups = useMemo(() => groupByMonth(rows), [rows]);

  const directionOptions = useMemo(() => buildDirectionOptions(variant, c), [variant, c]);
  const yearOptions = useMemo(() => buildYearOptions(rows), [rows]);

  const onTrackingChange = useCallback(
    async (row: InvoiceOverviewRow, next: InvoiceOverviewTrackingStatus) => {
      if (next === row.trackingStatus) return;
      const previous = row.trackingStatus;
      setRows((prev) =>
        prev.map((r) =>
          r.sourceType === row.sourceType && r.sourceId === row.sourceId
            ? { ...r, trackingStatus: next }
            : r,
        ),
      );
      const ok = await updateInvoiceTrackingStatus(row.sourceType, row.sourceId, next);
      if (!ok) {
        setRows((prev) =>
          prev.map((r) =>
            r.sourceType === row.sourceType && r.sourceId === row.sourceId
              ? { ...r, trackingStatus: previous }
              : r,
          ),
        );
        setError(c.errorUpdate);
      }
      if (openRow && openRow.sourceType === row.sourceType && openRow.sourceId === row.sourceId) {
        setOpenRow(ok ? { ...openRow, trackingStatus: next } : openRow);
      }
    },
    [openRow, c.errorUpdate],
  );

  const onNoteSave = useCallback(
    async (row: InvoiceOverviewRow, note: string | null) => {
      const ok = await updateInvoiceTrackingNote(row.sourceType, row.sourceId, note);
      if (!ok) {
        setError(c.errorUpdate);
        return false;
      }
      const cleaned = note && note.trim().length > 0 ? note.trim() : null;
      setRows((prev) =>
        prev.map((r) =>
          r.sourceType === row.sourceType && r.sourceId === row.sourceId
            ? { ...r, internalNote: cleaned }
            : r,
        ),
      );
      if (openRow && openRow.sourceType === row.sourceType && openRow.sourceId === row.sourceId) {
        setOpenRow({ ...openRow, internalNote: cleaned });
      }
      return true;
    },
    [openRow, c.errorUpdate],
  );

  if (!organizationId) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{c.headerTitle}</Text>
        <Text style={styles.subtitle}>
          {variant === 'agency' ? c.headerSubtitleAgency : c.headerSubtitleClient}
        </Text>
      </View>

      {/* Filter row */}
      <View style={styles.filterRow}>
        <FilterPicker
          label={c.filterYearLabel}
          value={filterYear === null ? null : String(filterYear)}
          options={yearOptions}
          allLabel={c.filterYearAll}
          onChange={(v) => setFilterYear(v === null ? null : Number(v))}
        />
        <FilterPicker
          label={c.filterMonthLabel}
          value={filterMonth === null ? null : String(filterMonth)}
          options={MONTH_OPTIONS}
          allLabel={c.filterMonthAll}
          onChange={(v) => setFilterMonth(v === null ? null : Number(v))}
        />
        <FilterPicker
          label={c.filterDirectionLabel}
          value={filterDirection}
          options={directionOptions}
          allLabel={c.filterDirectionAll}
          onChange={(v) => setFilterDirection((v as InvoiceOverviewDirection) ?? null)}
        />
        {variant === 'agency' && (
          <FilterPicker
            label={c.filterSourceLabel}
            value={filterSource}
            options={[
              { value: 'system', label: c.filterSourceSystem },
              { value: 'manual', label: c.filterSourceManual },
            ]}
            allLabel={c.filterSourceAll}
            onChange={(v) => setFilterSource((v as InvoiceOverviewSourceType) ?? null)}
          />
        )}
        <FilterPicker
          label={c.filterTrackingLabel}
          value={filterTracking}
          options={[
            { value: 'open', label: c.filterTrackingOpen },
            { value: 'paid', label: c.filterTrackingPaid },
            { value: 'problem', label: c.filterTrackingProblem },
          ]}
          allLabel={c.filterTrackingAll}
          onChange={(v) => setFilterTracking((v as InvoiceOverviewTrackingStatus) ?? null)}
        />
      </View>

      <View style={styles.searchRow}>
        <TextInput
          value={searchInput}
          onChangeText={setSearchInput}
          onSubmitEditing={onSearchSubmit}
          onBlur={onSearchSubmit}
          placeholder={c.searchPlaceholder}
          placeholderTextColor={colors.textSecondary}
          style={styles.search}
          returnKeyType="search"
        />
        <TouchableOpacity
          style={styles.clearBtn}
          onPress={clearAllFilters}
          accessibilityLabel={c.clearFilters}
        >
          <Text style={styles.clearBtnText}>{c.clearFilters}</Text>
        </TouchableOpacity>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.textSecondary} />
          <Text style={styles.muted}>{c.loading}</Text>
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.muted}>
            {hasActiveFilter({
              filterYear,
              filterMonth,
              filterDirection,
              filterSource,
              filterTracking,
              search: searchActive,
            })
              ? c.emptyFiltered
              : c.empty}
          </Text>
        </View>
      ) : (
        <View>
          {groups.map((group) => (
            <View key={group.key} style={styles.group}>
              <Text style={styles.groupHeader}>{group.label}</Text>
              {group.items.map((row) => (
                <InvoiceOverviewRowView
                  key={`${row.sourceType}:${row.sourceId}`}
                  row={row}
                  copy={c}
                  onPress={() => setOpenRow(row)}
                  onTrackingChange={(next) => void onTrackingChange(row, next)}
                />
              ))}
            </View>
          ))}

          {!endReached && (
            <TouchableOpacity
              style={styles.loadMore}
              onPress={() => void loadMore()}
              disabled={loadingMore}
            >
              <Text style={styles.loadMoreText}>{loadingMore ? '…' : 'Load more'}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <InvoiceDetailsModal
        row={openRow}
        copy={c}
        onClose={() => setOpenRow(null)}
        onTrackingChange={onTrackingChange}
        onNoteSave={onNoteSave}
      />
    </View>
  );
};

// ─── Subcomponents ──────────────────────────────────────────────────────────

const InvoiceOverviewRowView: React.FC<{
  row: InvoiceOverviewRow;
  copy: typeof uiCopy.invoiceOverview;
  onPress: () => void;
  onTrackingChange: (next: InvoiceOverviewTrackingStatus) => void;
}> = ({ row, copy, onPress, onTrackingChange }) => {
  return (
    <View style={styles.rowCard}>
      <Pressable style={styles.rowMain} onPress={onPress} accessibilityRole="button">
        <View style={styles.rowTopline}>
          <Text style={styles.rowDate}>{formatDate(row.invoiceDate)}</Text>
          <Text style={styles.rowAmount}>{formatAmount(row.totalAmountCents, row.currency)}</Text>
        </View>
        <View style={styles.rowMeta}>
          <Text style={styles.rowDirection}>{labelForDirection(row.direction, copy)}</Text>
          <Text style={styles.rowSource}>
            {row.sourceType === 'manual' ? copy.filterSourceManual : copy.filterSourceSystem}
          </Text>
          {row.invoiceNumber ? (
            <Text style={styles.rowInvoiceNumber}>#{row.invoiceNumber}</Text>
          ) : null}
        </View>
        <View style={styles.rowParties}>
          {row.senderName ? (
            <Text style={styles.rowParty}>
              {copy.columnFrom}: <Text style={styles.rowPartyValue}>{row.senderName}</Text>
            </Text>
          ) : null}
          {row.recipientName ? (
            <Text style={styles.rowParty}>
              {copy.columnTo}: <Text style={styles.rowPartyValue}>{row.recipientName}</Text>
            </Text>
          ) : null}
          {row.referenceLabel ? (
            <Text style={styles.rowParty}>
              {copy.columnReference}: <Text style={styles.rowPartyValue}>{row.referenceLabel}</Text>
            </Text>
          ) : null}
          {row.internalNote ? (
            <Text style={styles.rowNotePreview} numberOfLines={2}>
              {copy.columnNote}: {row.internalNote}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <View style={styles.rowTrackingArea}>
        <TrackingStatusControl value={row.trackingStatus} copy={copy} onChange={onTrackingChange} />
      </View>
    </View>
  );
};

const TrackingStatusControl: React.FC<{
  value: InvoiceOverviewTrackingStatus;
  copy: typeof uiCopy.invoiceOverview;
  onChange: (next: InvoiceOverviewTrackingStatus) => void;
}> = ({ value, copy, onChange }) => {
  const options: Array<{ key: InvoiceOverviewTrackingStatus; label: string; color: string }> = [
    { key: 'open', label: copy.statusOpenLabel, color: colors.textSecondary },
    { key: 'paid', label: copy.statusPaidLabel, color: colors.success ?? colors.textPrimary },
    {
      key: 'problem',
      label: copy.statusProblemLabel,
      color: colors.errorDark ?? colors.textPrimary,
    },
  ];
  return (
    <View style={styles.statusRow}>
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <TouchableOpacity
            key={opt.key}
            onPress={() => onChange(opt.key)}
            style={[
              styles.statusPill,
              active && { backgroundColor: opt.color, borderColor: opt.color },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${copy.filterTrackingLabel}: ${opt.label}`}
          >
            <Text style={[styles.statusPillText, active && styles.statusPillTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const FilterPicker: React.FC<{
  label: string;
  value: string | null;
  options: Array<{ value: string; label: string }>;
  allLabel: string;
  onChange: (value: string | null) => void;
}> = ({ label, value, options, allLabel, onChange }) => {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={styles.filterCol}>
      <Text style={styles.filterLabel}>{label}</Text>
      <TouchableOpacity style={styles.filterButton} onPress={() => setOpen((o) => !o)}>
        <Text style={styles.filterButtonText}>{current ? current.label : allLabel}</Text>
        <Text style={styles.filterCaret}>{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {open && (
        <View style={styles.filterMenu}>
          <TouchableOpacity
            style={styles.filterMenuItem}
            onPress={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            <Text style={styles.filterMenuItemText}>{allLabel}</Text>
          </TouchableOpacity>
          {options.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={styles.filterMenuItem}
              onPress={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              <Text style={styles.filterMenuItemText}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};

const InvoiceDetailsModal: React.FC<{
  row: InvoiceOverviewRow | null;
  copy: typeof uiCopy.invoiceOverview;
  onClose: () => void;
  onTrackingChange: (row: InvoiceOverviewRow, next: InvoiceOverviewTrackingStatus) => void;
  onNoteSave: (row: InvoiceOverviewRow, note: string | null) => Promise<boolean>;
}> = ({ row, copy, onClose, onTrackingChange, onNoteSave }) => {
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  useEffect(() => {
    setNoteDraft(row?.internalNote ?? '');
  }, [row?.sourceId, row?.sourceType, row?.internalNote]);

  if (!row) return null;
  return (
    <Modal animationType="fade" transparent visible={true} onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <ScrollView contentContainerStyle={{ padding: spacing.md }}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>
                  {row.invoiceNumber ? `#${row.invoiceNumber}` : copy.headerTitle}
                </Text>
                <Text style={styles.modalSubtitle}>
                  {labelForDirection(row.direction, copy)} · {formatDate(row.invoiceDate)}
                </Text>
              </View>
              <TouchableOpacity onPress={onClose} accessibilityLabel="Close">
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <DetailRow
              label={copy.columnSource}
              value={
                row.sourceType === 'manual' ? copy.filterSourceManual : copy.filterSourceSystem
              }
            />
            <DetailRow label={copy.columnFrom} value={row.senderName ?? '—'} />
            <DetailRow label={copy.columnTo} value={row.recipientName ?? '—'} />
            {row.clientName && row.clientName !== row.recipientName && (
              <DetailRow label={copy.columnClient} value={row.clientName} />
            )}
            {row.modelName && <DetailRow label={copy.columnModel} value={row.modelName} />}
            {row.referenceLabel && (
              <DetailRow label={copy.columnReference} value={row.referenceLabel} />
            )}
            <DetailRow
              label={copy.columnAmount}
              value={formatAmount(row.totalAmountCents, row.currency)}
            />
            {row.dueDate && <DetailRow label="Due" value={formatDate(row.dueDate)} />}
            {row.sourceStatus && <DetailRow label="Source status" value={row.sourceStatus} />}

            <Text style={[styles.modalSectionTitle, { marginTop: spacing.md }]}>
              {copy.filterTrackingLabel}
            </Text>
            <TrackingStatusControl
              value={row.trackingStatus}
              copy={copy}
              onChange={(next) => onTrackingChange(row, next)}
            />
            <Text style={styles.helperText}>{copy.statusHelperText}</Text>

            <Text style={[styles.modalSectionTitle, { marginTop: spacing.md }]}>
              {copy.noteEditTitle}
            </Text>
            <TextInput
              value={noteDraft}
              onChangeText={(t) => setNoteDraft(t.slice(0, 1000))}
              placeholder={copy.noteEditPlaceholder}
              placeholderTextColor={colors.textSecondary}
              multiline
              style={styles.noteInput}
            />
            <Text style={styles.muted}>{copy.noteMaxLengthHint(noteDraft.length)}</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionPrimary]}
                onPress={async () => {
                  setSavingNote(true);
                  const ok = await onNoteSave(row, noteDraft);
                  setSavingNote(false);
                  if (ok) onClose();
                }}
                disabled={savingNote}
                accessibilityLabel={copy.noteSave}
              >
                <Text style={styles.actionPrimaryText}>{copy.noteSave}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionSecondary]}
                onPress={async () => {
                  setSavingNote(true);
                  const ok = await onNoteSave(row, null);
                  setSavingNote(false);
                  if (ok) {
                    setNoteDraft('');
                  }
                }}
                disabled={
                  savingNote || (row.internalNote === null && noteDraft.trim().length === 0)
                }
                accessibilityLabel={copy.noteClear}
              >
                <Text style={styles.actionSecondaryText}>{copy.noteClear}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionSecondary]}
                onPress={onClose}
                accessibilityLabel={copy.noteCancel}
              >
                <Text style={styles.actionSecondaryText}>{copy.noteCancel}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{value}</Text>
  </View>
);

// ─── Helpers ────────────────────────────────────────────────────────────────

type Group = { key: string; label: string; items: InvoiceOverviewRow[] };

function groupByMonth(rows: InvoiceOverviewRow[]): Group[] {
  const c = uiCopy.invoiceOverview;
  const map = new Map<string, Group>();
  for (const row of rows) {
    let key = 'unknown';
    let label: string = c.groupHeaderUnknown;
    if (row.invoiceDate) {
      const d = new Date(row.invoiceDate);
      if (!isNaN(d.getTime())) {
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth() + 1;
        key = `${y}-${String(m).padStart(2, '0')}`;
        label = c.groupHeader(y, m);
      }
    }
    if (!map.has(key)) map.set(key, { key, label, items: [] });
    map.get(key)!.items.push(row);
  }
  return Array.from(map.values()).sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

function buildYearOptions(rows: InvoiceOverviewRow[]): Array<{ value: string; label: string }> {
  const years = new Set<number>();
  const currentYear = new Date().getUTCFullYear();
  years.add(currentYear);
  years.add(currentYear - 1);
  for (const row of rows) {
    if (row.invoiceDate) {
      const d = new Date(row.invoiceDate);
      if (!isNaN(d.getTime())) years.add(d.getUTCFullYear());
    }
  }
  return Array.from(years)
    .sort((a, b) => b - a)
    .map((y) => ({ value: String(y), label: String(y) }));
}

const MONTH_OPTIONS: Array<{ value: string; label: string }> = [
  '01 — January',
  '02 — February',
  '03 — March',
  '04 — April',
  '05 — May',
  '06 — June',
  '07 — July',
  '08 — August',
  '09 — September',
  '10 — October',
  '11 — November',
  '12 — December',
].map((label, idx) => ({ value: String(idx + 1), label }));

function buildDirectionOptions(
  variant: 'agency' | 'client',
  c: typeof uiCopy.invoiceOverview,
): Array<{ value: string; label: string }> {
  if (variant === 'client') {
    return [
      { value: 'agency_to_client', label: c.filterDirectionAgencyToClient },
      { value: 'agency_to_agency', label: c.filterDirectionAgencyToAgency },
    ];
  }
  return [
    { value: 'agency_to_client', label: c.filterDirectionAgencyToClient },
    { value: 'agency_to_model', label: c.filterDirectionAgencyToModel },
    { value: 'model_to_agency', label: c.filterDirectionModelToAgency },
    { value: 'agency_to_agency', label: c.filterDirectionAgencyToAgency },
  ];
}

function labelForDirection(d: InvoiceOverviewDirection, c: typeof uiCopy.invoiceOverview): string {
  switch (d) {
    case 'agency_to_client':
      return c.filterDirectionAgencyToClient;
    case 'agency_to_model':
      return c.filterDirectionAgencyToModel;
    case 'model_to_agency':
      return c.filterDirectionModelToAgency;
    case 'agency_to_agency':
    case 'platform_to_agency':
    case 'platform_to_client':
      return c.filterDirectionAgencyToAgency;
    default:
      return d;
  }
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatAmount(cents: number, currency: string): string {
  const n = Number(cents ?? 0) / 100;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  // Use a stable, locale-free format so testing/Web/Native parity holds.
  const major = Math.floor(abs);
  const minor = Math.round((abs - major) * 100);
  const minorStr = String(minor).padStart(2, '0');
  return `${sign}${major}.${minorStr} ${currency || ''}`.trim();
}

function hasActiveFilter(input: {
  filterYear: number | null;
  filterMonth: number | null;
  filterDirection: InvoiceOverviewDirection | null;
  filterSource: InvoiceOverviewSourceType | null;
  filterTracking: InvoiceOverviewTrackingStatus | null;
  search: string;
}): boolean {
  return (
    input.filterYear !== null ||
    input.filterMonth !== null ||
    input.filterDirection !== null ||
    input.filterSource !== null ||
    input.filterTracking !== null ||
    input.search.trim().length > 0
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  header: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  title: {
    ...typography.heading,
    fontSize: 18,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  filterCol: {
    minWidth: 140,
    marginRight: spacing.sm,
    marginBottom: spacing.xs,
  },
  filterLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: colors.surface,
  },
  filterButtonText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  filterCaret: {
    color: colors.textSecondary,
    marginLeft: 6,
  },
  filterMenu: {
    marginTop: 4,
    backgroundColor: colors.surface,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: 240,
  },
  filterMenuItem: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterMenuItemText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  search: {
    flex: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    marginRight: spacing.xs,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : null),
  },
  clearBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
  },
  clearBtnText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  error: {
    ...typography.body,
    color: colors.errorDark ?? colors.textPrimary,
    marginVertical: spacing.xs,
  },
  center: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  muted: {
    ...typography.body,
    color: colors.textSecondary,
  },
  group: {
    marginTop: spacing.sm,
  },
  groupHeader: {
    ...typography.body,
    fontWeight: '700' as const,
    color: colors.textPrimary,
    marginVertical: spacing.xs,
  },
  rowCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.sm,
    marginBottom: spacing.xs,
    flexWrap: 'wrap',
  },
  rowMain: {
    flex: 1,
    minWidth: 200,
  },
  rowTopline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowDate: {
    ...typography.body,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  rowAmount: {
    ...typography.body,
    fontWeight: '700' as const,
    color: colors.textPrimary,
  },
  rowMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 2,
  },
  rowDirection: {
    ...typography.label,
    color: colors.textSecondary,
    marginRight: spacing.xs,
  },
  rowSource: {
    ...typography.label,
    color: colors.textSecondary,
    marginRight: spacing.xs,
  },
  rowInvoiceNumber: {
    ...typography.label,
    color: colors.textSecondary,
  },
  rowParties: {
    marginTop: 4,
  },
  rowParty: {
    ...typography.label,
    color: colors.textSecondary,
  },
  rowPartyValue: {
    color: colors.textPrimary,
  },
  rowNotePreview: {
    ...typography.label,
    color: colors.textPrimary,
    marginTop: 4,
    fontStyle: 'italic',
  },
  rowTrackingArea: {
    marginLeft: spacing.sm,
    minWidth: 220,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    marginLeft: spacing.xs,
    marginTop: 2,
    backgroundColor: colors.surface,
  },
  statusPillText: {
    ...typography.label,
    color: colors.textPrimary,
  },
  statusPillTextActive: {
    color: colors.background,
    fontWeight: '700' as const,
  },
  loadMore: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  loadMoreText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: spacing.md,
  },
  modalCard: {
    backgroundColor: colors.background,
    borderRadius: 10,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  modalTitle: {
    ...typography.heading,
    fontSize: 18,
    color: colors.textPrimary,
  },
  modalSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  modalClose: {
    ...typography.heading,
    fontSize: 18,
    color: colors.textSecondary,
    paddingHorizontal: spacing.sm,
  },
  modalSectionTitle: {
    ...typography.body,
    fontWeight: '700' as const,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  noteInput: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: spacing.sm,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    textAlignVertical: 'top',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : null),
  },
  helperText: {
    ...typography.label,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  modalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.md,
  },
  actionBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: 6,
    marginRight: spacing.xs,
    marginTop: spacing.xs,
  },
  actionPrimary: {
    backgroundColor: colors.textPrimary,
  },
  actionPrimaryText: {
    color: colors.background,
    fontWeight: '700' as const,
  },
  actionSecondary: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  actionSecondaryText: {
    color: colors.textPrimary,
  },
  detailRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailLabel: {
    ...typography.body,
    color: colors.textSecondary,
    width: 120,
  },
  detailValue: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
});

export default InvoiceOverviewPanel;

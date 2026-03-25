/**
 * ModelFiltersPanel — reusable filter UI for model discovery.
 *
 * Shared between:
 *   - Client Discover (ClientWebApp.tsx / DiscoverView)
 *   - Agency My Models (AgencyControllerView.tsx / MyModelsTab)
 *
 * The component owns only its open/closed toggle state and the country-search
 * dropdown state. All filter values are controlled via props.
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import { AGENCY_SEGMENT_TYPES } from '../constants/agencyTypes';
import { FILTER_COUNTRIES, type ModelFilters } from '../utils/modelFilters';

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  filters: ModelFilters;
  onChangeFilters: (f: ModelFilters) => void;
  /** User's detected city — used for the "Near me" pill label. */
  userCity?: string | null;
  /** When provided, a "Save filters" button is shown (client-only). */
  onSaveFilters?: () => void;
  filterSaveStatus?: 'saving' | 'saved' | 'error' | null;
};

// ── Component ─────────────────────────────────────────────────────────────────

const ModelFiltersPanel: React.FC<Props> = ({
  filters,
  onChangeFilters,
  userCity,
  onSaveFilters,
  filterSaveStatus,
}) => {
  const [filterOpen, setFilterOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState('');
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);

  const selectedCountryLabel = useMemo(
    () => FILTER_COUNTRIES.find((c) => c.code === filters.countryCode)?.label ?? null,
    [filters.countryCode],
  );

  const filteredCountryOptions = useMemo(() => {
    if (!countryQuery.trim()) return FILTER_COUNTRIES;
    const q = countryQuery.toLowerCase();
    return FILTER_COUNTRIES.filter(
      (c) => c.label.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [countryQuery]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.size !== 'all') n++;
    if (filters.category) n++;
    if (filters.sportsWinter || filters.sportsSummer) n++;
    if (filters.countryCode || filters.nearby) n++;
    if (filters.hairColor.trim()) n++;
    const pI = (v: string) => !isNaN(parseInt(v, 10));
    if (pI(filters.hipsMin) || pI(filters.hipsMax)) n++;
    if (pI(filters.waistMin) || pI(filters.waistMax)) n++;
    if (pI(filters.chestMin) || pI(filters.chestMax)) n++;
    if (pI(filters.legsInseamMin) || pI(filters.legsInseamMax)) n++;
    return n;
  }, [filters]);

  const resetFilters = () =>
    onChangeFilters({
      size: 'all', countryCode: '', city: '', nearby: false,
      category: '', sportsWinter: false, sportsSummer: false,
      hairColor: '', hipsMin: '', hipsMax: '',
      waistMin: '', waistMax: '', chestMin: '', chestMax: '',
      legsInseamMin: '', legsInseamMax: '',
    });

  return (
    <View>
      {/* ── Toggle button ── */}
      <TouchableOpacity
        style={[styles.filterTrigger, activeFilterCount > 0 && { backgroundColor: colors.textPrimary }]}
        onPress={() => setFilterOpen((o) => !o)}
      >
        <Text style={[styles.filterTriggerLabel, activeFilterCount > 0 && { color: colors.surface }]}>
          {activeFilterCount > 0 ? `Filter (${activeFilterCount})` : 'Filter'}
        </Text>
      </TouchableOpacity>

      {filterOpen && (
        <View style={styles.filterSlideOut}>
          {/* ── Height ── */}
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>Height</Text>
            <View style={styles.filterPills}>
              {([
                { key: 'all',    label: 'All' },
                { key: 'short',  label: '< 175' },
                { key: 'medium', label: '175–182' },
                { key: 'tall',   label: '> 182' },
              ] as const).map((opt) => (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.filterPill, filters.size === opt.key && styles.filterPillActive]}
                  onPress={() => onChangeFilters({ ...filters, size: opt.key })}
                >
                  <Text style={[styles.filterPillLabel, filters.size === opt.key && styles.filterPillLabelActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ── Category ── */}
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>Category</Text>
            <View style={styles.filterPills}>
              <TouchableOpacity
                style={[styles.filterPill, filters.category === '' && styles.filterPillActive]}
                onPress={() => onChangeFilters({ ...filters, category: '' })}
              >
                <Text style={[styles.filterPillLabel, filters.category === '' && styles.filterPillLabelActive]}>
                  All
                </Text>
              </TouchableOpacity>
              {AGENCY_SEGMENT_TYPES.map((seg) => (
                <TouchableOpacity
                  key={seg}
                  style={[styles.filterPill, filters.category === seg && styles.filterPillActive]}
                  onPress={() => onChangeFilters({ ...filters, category: filters.category === seg ? '' : seg })}
                >
                  <Text style={[styles.filterPillLabel, filters.category === seg && styles.filterPillLabelActive]}>
                    {seg}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ── Sports ── */}
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>{uiCopy.sportCategories.filterLabel}</Text>
            <View style={styles.filterPills}>
              <TouchableOpacity
                style={[styles.filterPill, filters.sportsWinter && styles.filterPillActive]}
                onPress={() => onChangeFilters({ ...filters, sportsWinter: !filters.sportsWinter })}
              >
                <Text style={[styles.filterPillLabel, filters.sportsWinter && styles.filterPillLabelActive]}>
                  {uiCopy.sportCategories.winterSports}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterPill, filters.sportsSummer && styles.filterPillActive]}
                onPress={() => onChangeFilters({ ...filters, sportsSummer: !filters.sportsSummer })}
              >
                <Text style={[styles.filterPillLabel, filters.sportsSummer && styles.filterPillLabelActive]}>
                  {uiCopy.sportCategories.summerSports}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Country ── */}
          <View style={[styles.filterGroup, { zIndex: 100 }]}>
            <Text style={styles.filterLabel}>Country</Text>
            {filters.countryCode ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' }}>
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  backgroundColor: colors.textPrimary,
                  borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 4,
                }}>
                  <Text style={{ ...typography.label, fontSize: 11, color: colors.surface }}>
                    {selectedCountryLabel}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      onChangeFilters({ ...filters, countryCode: '', city: '', nearby: false });
                      setCountryQuery('');
                      setCountryDropdownOpen(false);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={{ ...typography.label, fontSize: 13, color: colors.surface, lineHeight: 14 }}>×</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={styles.filterPill}
                  onPress={() => {
                    onChangeFilters({ ...filters, countryCode: '', city: '', nearby: false });
                    setCountryQuery('');
                    setCountryDropdownOpen(true);
                  }}
                >
                  <Text style={styles.filterPillLabel}>Change</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterPill, filters.nearby && styles.filterPillActive]}
                  onPress={() => onChangeFilters({ ...filters, nearby: !filters.nearby, countryCode: '', city: '' })}
                >
                  <Text style={[styles.filterPillLabel, filters.nearby && styles.filterPillLabelActive]}>
                    {userCity ? `Near me (${userCity})` : 'Near me'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ position: 'relative' }}>
                <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
                  <TextInput
                    value={countryQuery}
                    onChangeText={(v) => { setCountryQuery(v); setCountryDropdownOpen(true); }}
                    onFocus={() => setCountryDropdownOpen(true)}
                    placeholder="Search country…"
                    placeholderTextColor={colors.textSecondary}
                    style={[styles.input, { flex: 1, height: 32, paddingVertical: 4, fontSize: 11 }]}
                  />
                  <TouchableOpacity
                    style={[styles.filterPill, filters.nearby && styles.filterPillActive]}
                    onPress={() => {
                      onChangeFilters({ ...filters, nearby: !filters.nearby, countryCode: '', city: '' });
                      setCountryDropdownOpen(false);
                    }}
                  >
                    <Text style={[styles.filterPillLabel, filters.nearby && styles.filterPillLabelActive]}>
                      {userCity ? `Near me (${userCity})` : 'Near me'}
                    </Text>
                  </TouchableOpacity>
                </View>
                {countryDropdownOpen && filteredCountryOptions.length > 0 && (
                  <View style={{
                    position: 'absolute',
                    top: 36, left: 0, right: 0,
                    zIndex: 999,
                    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
                    backgroundColor: colors.surface,
                    maxHeight: 200,
                    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8,
                    shadowOffset: { width: 0, height: 4 }, elevation: 12,
                    overflow: 'hidden',
                  }}>
                    <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled showsVerticalScrollIndicator>
                      {filteredCountryOptions.map((c, i) => (
                        <TouchableOpacity
                          key={c.code}
                          style={{
                            paddingHorizontal: spacing.md, paddingVertical: 9,
                            borderBottomWidth: i < filteredCountryOptions.length - 1 ? 1 : 0,
                            borderBottomColor: colors.border,
                            backgroundColor: colors.surface,
                          }}
                          onPress={() => {
                            onChangeFilters({ ...filters, countryCode: c.code, city: '', nearby: false });
                            setCountryQuery('');
                            setCountryDropdownOpen(false);
                          }}
                        >
                          <Text style={{ ...typography.body, fontSize: 12, color: colors.textPrimary }}>
                            {c.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* ── City (only when country selected) ── */}
          {filters.countryCode && (
            <View style={styles.filterGroup}>
              <Text style={styles.filterLabel}>City</Text>
              <TextInput
                value={filters.city}
                onChangeText={(v) => onChangeFilters({ ...filters, city: v })}
                placeholder="e.g. Berlin, Hamburg, Munich..."
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, { height: 32, paddingVertical: 4, fontSize: 11 }]}
              />
            </View>
          )}

          {/* ── Hair color ── */}
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>Hair color</Text>
            <TextInput
              value={filters.hairColor}
              onChangeText={(v) => onChangeFilters({ ...filters, hairColor: v })}
              placeholder="e.g. Brown, Blonde…"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, { height: 32, paddingVertical: 4, fontSize: 11 }]}
            />
          </View>

          {/* ── Hips + Waist ── */}
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={[styles.filterGroup, { flex: 1 }]}>
              <Text style={styles.filterLabel}>Hips (min–max)</Text>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <TextInput value={filters.hipsMin} onChangeText={(v) => onChangeFilters({ ...filters, hipsMin: v })} placeholder="min" placeholderTextColor={colors.textSecondary} keyboardType="numeric" style={[styles.input, { flex: 1, height: 32, paddingVertical: 4, fontSize: 11 }]} />
                <TextInput value={filters.hipsMax} onChangeText={(v) => onChangeFilters({ ...filters, hipsMax: v })} placeholder="max" placeholderTextColor={colors.textSecondary} keyboardType="numeric" style={[styles.input, { flex: 1, height: 32, paddingVertical: 4, fontSize: 11 }]} />
              </View>
            </View>
            <View style={[styles.filterGroup, { flex: 1 }]}>
              <Text style={styles.filterLabel}>Waist (min–max)</Text>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <TextInput value={filters.waistMin} onChangeText={(v) => onChangeFilters({ ...filters, waistMin: v })} placeholder="min" placeholderTextColor={colors.textSecondary} keyboardType="numeric" style={[styles.input, { flex: 1, height: 32, paddingVertical: 4, fontSize: 11 }]} />
                <TextInput value={filters.waistMax} onChangeText={(v) => onChangeFilters({ ...filters, waistMax: v })} placeholder="max" placeholderTextColor={colors.textSecondary} keyboardType="numeric" style={[styles.input, { flex: 1, height: 32, paddingVertical: 4, fontSize: 11 }]} />
              </View>
            </View>
          </View>

          {/* ── Chest + Legs inseam ── */}
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={[styles.filterGroup, { flex: 1 }]}>
              <Text style={styles.filterLabel}>Chest (min–max)</Text>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <TextInput value={filters.chestMin} onChangeText={(v) => onChangeFilters({ ...filters, chestMin: v })} placeholder="min" placeholderTextColor={colors.textSecondary} keyboardType="numeric" style={[styles.input, { flex: 1, height: 32, paddingVertical: 4, fontSize: 11 }]} />
                <TextInput value={filters.chestMax} onChangeText={(v) => onChangeFilters({ ...filters, chestMax: v })} placeholder="max" placeholderTextColor={colors.textSecondary} keyboardType="numeric" style={[styles.input, { flex: 1, height: 32, paddingVertical: 4, fontSize: 11 }]} />
              </View>
            </View>
            <View style={[styles.filterGroup, { flex: 1 }]}>
              <Text style={styles.filterLabel}>Legs inseam (min–max)</Text>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <TextInput value={filters.legsInseamMin} onChangeText={(v) => onChangeFilters({ ...filters, legsInseamMin: v })} placeholder="min" placeholderTextColor={colors.textSecondary} keyboardType="numeric" style={[styles.input, { flex: 1, height: 32, paddingVertical: 4, fontSize: 11 }]} />
                <TextInput value={filters.legsInseamMax} onChangeText={(v) => onChangeFilters({ ...filters, legsInseamMax: v })} placeholder="max" placeholderTextColor={colors.textSecondary} keyboardType="numeric" style={[styles.input, { flex: 1, height: 32, paddingVertical: 4, fontSize: 11 }]} />
              </View>
            </View>
          </View>

          {/* ── Save / Reset ── */}
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs, alignItems: 'center' }}>
            {onSaveFilters && (
              <TouchableOpacity
                onPress={onSaveFilters}
                disabled={filterSaveStatus === 'saving'}
                style={{
                  flex: 1,
                  borderRadius: 999, paddingVertical: 8, paddingHorizontal: spacing.md, alignItems: 'center',
                  backgroundColor:
                    filterSaveStatus === 'saved'  ? (colors.accentGreen ?? '#2e7d32')
                    : filterSaveStatus === 'error' ? (colors.buttonSkipRed ?? '#c0392b')
                    : colors.textPrimary,
                  opacity: filterSaveStatus === 'saving' ? 0.6 : 1,
                }}
              >
                <Text style={{ ...typography.label, fontSize: 11, color: colors.surface, letterSpacing: 0.4 }}>
                  {filterSaveStatus === 'saving' ? 'Saving…'
                    : filterSaveStatus === 'saved' ? '✓ Filters saved'
                    : filterSaveStatus === 'error' ? 'Save failed — retry'
                    : 'Save filters'}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={resetFilters}
              style={{
                borderRadius: 999, paddingVertical: 8, paddingHorizontal: spacing.md,
                borderWidth: 1, borderColor: colors.border, alignItems: 'center',
              }}
            >
              <Text style={{ ...typography.label, fontSize: 11, color: colors.textSecondary }}>
                Reset
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

export default ModelFiltersPanel;

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  filterTrigger: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    alignSelf: 'flex-start',
  },
  filterTriggerLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  filterSlideOut: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterGroup: {
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
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
});

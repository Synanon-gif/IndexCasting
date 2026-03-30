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
import { FILTER_COUNTRIES, ETHNICITY_OPTIONS, type ModelFilters } from '../utils/modelFilters';

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
  const [ethnicityDropdownOpen, setEthnicityDropdownOpen] = useState(false);

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
    const pI = (v: string) => !isNaN(parseInt(v, 10));
    if (filters.sex !== 'all') n++;
    if (pI(filters.heightMin) || pI(filters.heightMax)) n++;
    if (filters.ethnicities.length > 0) n++;
    if (filters.category) n++;
    if (filters.sportsWinter || filters.sportsSummer) n++;
    if (filters.countryCode || filters.nearby) n++;
    if (filters.hairColor.trim()) n++;
    if (pI(filters.hipsMin) || pI(filters.hipsMax)) n++;
    if (pI(filters.waistMin) || pI(filters.waistMax)) n++;
    if (pI(filters.chestMin) || pI(filters.chestMax)) n++;
    if (pI(filters.legsInseamMin) || pI(filters.legsInseamMax)) n++;
    return n;
  }, [filters]);

  const resetFilters = () =>
    onChangeFilters({
      sex: 'all', heightMin: '', heightMax: '', ethnicities: [], countryCode: '', city: '', nearby: false,
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
          {activeFilterCount > 0 ? uiCopy.filters.triggerLabelWithCount(activeFilterCount) : uiCopy.filters.triggerLabel}
        </Text>
      </TouchableOpacity>

      {filterOpen && (
        <View style={styles.filterSlideOut}>
          {/* ── Sex ── */}
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>{uiCopy.filters.sectionSex}</Text>
            <View style={styles.filterPills}>
              {([
                { key: 'all',    label: uiCopy.filters.sexAll },
                { key: 'female', label: uiCopy.filters.sexFemale },
                { key: 'male',   label: uiCopy.filters.sexMale },
              ] as const).map((opt) => (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.filterPill, filters.sex === opt.key && styles.filterPillActive]}
                  onPress={() => onChangeFilters({ ...filters, sex: opt.key })}
                >
                  <Text style={[styles.filterPillLabel, filters.sex === opt.key && styles.filterPillLabelActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ── Height ── */}
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>{uiCopy.filters.sectionHeight}</Text>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              <TextInput
                value={filters.heightMin}
                onChangeText={(v) => onChangeFilters({ ...filters, heightMin: v })}
                placeholder={uiCopy.filters.heightFromPlaceholder}
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                style={[styles.input, { flex: 1, height: 32, paddingVertical: 4, fontSize: 11 }]}
              />
              <TextInput
                value={filters.heightMax}
                onChangeText={(v) => onChangeFilters({ ...filters, heightMax: v })}
                placeholder={uiCopy.filters.heightToPlaceholder}
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                style={[styles.input, { flex: 1, height: 32, paddingVertical: 4, fontSize: 11 }]}
              />
            </View>
          </View>

          {/* ── Ethnicity (multi-select dropdown) — list expands in layout (no overlay on fields below) ── */}
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>{uiCopy.filters.sectionEthnicity}</Text>

            {/* Selected chips */}
            {filters.ethnicities.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs }}>
                {filters.ethnicities.map((eth) => (
                  <TouchableOpacity
                    key={eth}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 4,
                      backgroundColor: colors.textPrimary,
                      borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 3,
                    }}
                    onPress={() =>
                      onChangeFilters({
                        ...filters,
                        ethnicities: filters.ethnicities.filter((e) => e !== eth),
                      })
                    }
                  >
                    <Text style={{ ...typography.label, fontSize: 10, color: colors.surface }}>
                      {eth}
                    </Text>
                    <Text style={{ ...typography.label, fontSize: 12, color: colors.surface, lineHeight: 14 }}>×</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Toggle button */}
            <View>
              <TouchableOpacity
                style={[
                  styles.filterPill,
                  ethnicityDropdownOpen && { borderColor: colors.accentBrown },
                  { alignSelf: 'flex-start' },
                ]}
                onPress={() => {
                  setEthnicityDropdownOpen((o) => !o);
                  setCountryDropdownOpen(false);
                }}
              >
                <Text style={styles.filterPillLabel}>
                  {filters.ethnicities.length > 0
                    ? uiCopy.filters.ethnicitySelected(filters.ethnicities.length)
                    : uiCopy.filters.ethnicityPlaceholder}
                </Text>
              </TouchableOpacity>

              {ethnicityDropdownOpen && (
                <View style={styles.filterDropdownPanel}>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled showsVerticalScrollIndicator>
                    {ETHNICITY_OPTIONS.map((eth, i) => {
                      const selected = filters.ethnicities.includes(eth);
                      return (
                        <TouchableOpacity
                          key={eth}
                          style={{
                            paddingHorizontal: spacing.md, paddingVertical: 9,
                            borderBottomWidth: i < ETHNICITY_OPTIONS.length - 1 ? 1 : 0,
                            borderBottomColor: colors.border,
                            backgroundColor: selected ? '#F3EEE7' : colors.surface,
                            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                          }}
                          onPress={() => {
                            const next = selected
                              ? filters.ethnicities.filter((e) => e !== eth)
                              : [...filters.ethnicities, eth];
                            onChangeFilters({ ...filters, ethnicities: next });
                          }}
                        >
                          <Text style={{ ...typography.body, fontSize: 12, color: selected ? colors.accentBrown : colors.textPrimary }}>
                            {eth}
                          </Text>
                          {selected && (
                            <Text style={{ ...typography.label, fontSize: 11, color: colors.accentBrown }}>✓</Text>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}
            </View>
          </View>

          {/* ── Category ── */}
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>{uiCopy.filters.sectionCategory}</Text>
            <View style={styles.filterPills}>
              <TouchableOpacity
                style={[styles.filterPill, filters.category === '' && styles.filterPillActive]}
                onPress={() => onChangeFilters({ ...filters, category: '' })}
              >
                <Text style={[styles.filterPillLabel, filters.category === '' && styles.filterPillLabelActive]}>
                  {uiCopy.filters.categoryAll}
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
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>{uiCopy.filters.sectionCountry}</Text>
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
                  <Text style={styles.filterPillLabel}>{uiCopy.filters.countryChangePill}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.filterPill, filters.nearby && styles.filterPillActive]}
                  onPress={() => onChangeFilters({ ...filters, nearby: !filters.nearby, countryCode: '', city: '' })}
                >
                  <Text style={[styles.filterPillLabel, filters.nearby && styles.filterPillLabelActive]}>
                    {userCity ? uiCopy.filters.nearMeLabelWithCity(userCity) : uiCopy.filters.nearMeLabel}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
                  <TextInput
                    value={countryQuery}
                    onChangeText={(v) => { setCountryQuery(v); setCountryDropdownOpen(true); setEthnicityDropdownOpen(false); }}
                    onFocus={() => { setCountryDropdownOpen(true); setEthnicityDropdownOpen(false); }}
                    placeholder={uiCopy.filters.countrySearchPlaceholder}
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
                      {userCity ? uiCopy.filters.nearMeLabelWithCity(userCity) : uiCopy.filters.nearMeLabel}
                    </Text>
                  </TouchableOpacity>
                </View>
                {countryDropdownOpen && filteredCountryOptions.length > 0 && (
                  <View style={styles.filterDropdownPanel}>
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
              <Text style={styles.filterLabel}>{uiCopy.filters.sectionCity}</Text>
              <TextInput
                value={filters.city}
                onChangeText={(v) => onChangeFilters({ ...filters, city: v })}
                placeholder={uiCopy.filters.cityPlaceholder}
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, { height: 32, paddingVertical: 4, fontSize: 11 }]}
              />
            </View>
          )}

          {/* ── Hair color ── */}
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>{uiCopy.filters.sectionHairColor}</Text>
            <TextInput
              value={filters.hairColor}
              onChangeText={(v) => onChangeFilters({ ...filters, hairColor: v })}
              placeholder={uiCopy.filters.hairColorPlaceholder}
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, { height: 32, paddingVertical: 4, fontSize: 11 }]}
            />
          </View>

          {/* ── Hips + Waist ── */}
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={[styles.filterGroup, { flex: 1 }]}>
              <Text style={styles.filterLabel}>{uiCopy.filters.sectionHips}</Text>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <TextInput value={filters.hipsMin} onChangeText={(v) => onChangeFilters({ ...filters, hipsMin: v })} placeholder={uiCopy.filters.measurementMin} placeholderTextColor={colors.textSecondary} keyboardType="numeric" style={[styles.input, { flex: 1, height: 32, paddingVertical: 4, fontSize: 11 }]} />
                <TextInput value={filters.hipsMax} onChangeText={(v) => onChangeFilters({ ...filters, hipsMax: v })} placeholder={uiCopy.filters.measurementMax} placeholderTextColor={colors.textSecondary} keyboardType="numeric" style={[styles.input, { flex: 1, height: 32, paddingVertical: 4, fontSize: 11 }]} />
              </View>
            </View>
            <View style={[styles.filterGroup, { flex: 1 }]}>
              <Text style={styles.filterLabel}>{uiCopy.filters.sectionWaist}</Text>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <TextInput value={filters.waistMin} onChangeText={(v) => onChangeFilters({ ...filters, waistMin: v })} placeholder={uiCopy.filters.measurementMin} placeholderTextColor={colors.textSecondary} keyboardType="numeric" style={[styles.input, { flex: 1, height: 32, paddingVertical: 4, fontSize: 11 }]} />
                <TextInput value={filters.waistMax} onChangeText={(v) => onChangeFilters({ ...filters, waistMax: v })} placeholder={uiCopy.filters.measurementMax} placeholderTextColor={colors.textSecondary} keyboardType="numeric" style={[styles.input, { flex: 1, height: 32, paddingVertical: 4, fontSize: 11 }]} />
              </View>
            </View>
          </View>

          {/* ── Chest + Legs inseam ── */}
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={[styles.filterGroup, { flex: 1 }]}>
              <Text style={styles.filterLabel}>{uiCopy.filters.sectionChest}</Text>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <TextInput value={filters.chestMin} onChangeText={(v) => onChangeFilters({ ...filters, chestMin: v })} placeholder={uiCopy.filters.measurementMin} placeholderTextColor={colors.textSecondary} keyboardType="numeric" style={[styles.input, { flex: 1, height: 32, paddingVertical: 4, fontSize: 11 }]} />
                <TextInput value={filters.chestMax} onChangeText={(v) => onChangeFilters({ ...filters, chestMax: v })} placeholder={uiCopy.filters.measurementMax} placeholderTextColor={colors.textSecondary} keyboardType="numeric" style={[styles.input, { flex: 1, height: 32, paddingVertical: 4, fontSize: 11 }]} />
              </View>
            </View>
            <View style={[styles.filterGroup, { flex: 1 }]}>
              <Text style={styles.filterLabel}>{uiCopy.filters.sectionLegsInseam}</Text>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <TextInput value={filters.legsInseamMin} onChangeText={(v) => onChangeFilters({ ...filters, legsInseamMin: v })} placeholder={uiCopy.filters.measurementMin} placeholderTextColor={colors.textSecondary} keyboardType="numeric" style={[styles.input, { flex: 1, height: 32, paddingVertical: 4, fontSize: 11 }]} />
                <TextInput value={filters.legsInseamMax} onChangeText={(v) => onChangeFilters({ ...filters, legsInseamMax: v })} placeholder={uiCopy.filters.measurementMax} placeholderTextColor={colors.textSecondary} keyboardType="numeric" style={[styles.input, { flex: 1, height: 32, paddingVertical: 4, fontSize: 11 }]} />
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
                  {filterSaveStatus === 'saving' ? uiCopy.filters.saveFiltersSaving
                    : filterSaveStatus === 'saved' ? uiCopy.filters.saveFiltersSaved
                    : filterSaveStatus === 'error' ? uiCopy.filters.saveFiltersError
                    : uiCopy.filters.saveFilters}
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
                {uiCopy.filters.resetFilters}
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
  /** In-flow dropdown: reserves vertical space so following fields are not covered */
  filterDropdownPanel: {
    marginTop: spacing.xs,
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
    maxHeight: 200,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 16,
    overflow: 'hidden',
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

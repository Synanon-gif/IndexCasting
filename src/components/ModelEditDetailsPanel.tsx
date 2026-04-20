/**
 * ModelEditDetailsPanel — model profile edit form for Agency (Owner + Bookers).
 *
 * Visual language mirrors ModelFiltersPanel exactly: same filterGroup/filterLabel/
 * filterPill pattern, same input style, same dropdown UI for country and ethnicity.
 *
 * Covers every field that is filterable in the app so that what the Agency sets
 * here is always consistent with what Clients can filter on.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import { AGENCY_SEGMENT_TYPES } from '../constants/agencyTypes';
import {
  FILTER_COUNTRIES,
  ETHNICITY_OPTIONS,
  HAIR_COLOR_OPTIONS,
  EYE_COLOR_OPTIONS,
} from '../utils/modelFilters';

// ── State shape ───────────────────────────────────────────────────────────────
//
// `ModelEditState` and `buildEditState` live in `src/utils/modelEditState.ts`
// so jest tests (no React Native transform) can import them. We re-export here
// so existing call sites that import from this file keep working.
export { buildEditState, type ModelEditState } from '../utils/modelEditState';
import type { ModelEditState } from '../utils/modelEditState';

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  state: ModelEditState;
  onChange: (patch: Partial<ModelEditState>) => void;
};

// ── Component ─────────────────────────────────────────────────────────────────

const ModelEditDetailsPanel: React.FC<Props> = ({ state, onChange }) => {
  const [countryQuery, setCountryQuery] = useState('');
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const [ethnicityDropdownOpen, setEthnicityDropdownOpen] = useState(false);

  const selectedCountryLabel = useMemo(
    () => FILTER_COUNTRIES.find((c) => c.code === state.country_code)?.label ?? null,
    [state.country_code],
  );

  const filteredCountryOptions = useMemo(() => {
    if (!countryQuery.trim()) return FILTER_COUNTRIES;
    const q = countryQuery.toLowerCase();
    return FILTER_COUNTRIES.filter(
      (c) => c.label.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [countryQuery]);

  const set = (patch: Partial<ModelEditState>) => onChange(patch);

  return (
    <View style={styles.container}>
      {/* ── Identity ── */}
      <Text style={styles.sectionHeader}>{uiCopy.modelEdit.sectionIdentity}</Text>

      <View style={styles.group}>
        <Text style={styles.label}>{uiCopy.modelEdit.nameLabel}</Text>
        <TextInput
          value={state.name}
          onChangeText={(v) => set({ name: v })}
          placeholder={uiCopy.modelEdit.namePlaceholder}
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>{uiCopy.modelEdit.emailLabel}</Text>
        <TextInput
          value={state.email}
          onChangeText={(v) => set({ email: v })}
          placeholder={uiCopy.modelEdit.emailPlaceholder}
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
        />
      </View>

      {/* ── Sex ── */}
      <Text style={styles.sectionHeader}>{uiCopy.modelEdit.sectionSex}</Text>
      <View style={[styles.group, styles.pills]}>
        {(
          [
            { key: null, label: uiCopy.modelEdit.sexNotSpecified },
            { key: 'female', label: uiCopy.modelEdit.sexFemale },
            { key: 'male', label: uiCopy.modelEdit.sexMale },
          ] as const
        ).map((opt) => {
          const active = state.sex === opt.key;
          return (
            <TouchableOpacity
              key={String(opt.key)}
              style={[styles.pill, active && styles.pillActive]}
              onPress={() => set({ sex: opt.key })}
            >
              <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Measurements ── */}
      <Text style={styles.sectionHeader}>{uiCopy.modelEdit.sectionMeasurements}</Text>

      <View style={styles.group}>
        <Text style={styles.label}>{uiCopy.modelEdit.heightLabel}</Text>
        <TextInput
          value={state.height}
          onChangeText={(v) => set({ height: v })}
          placeholder={uiCopy.modelEdit.heightPlaceholder}
          placeholderTextColor={colors.textSecondary}
          keyboardType="numeric"
          style={styles.input}
        />
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={[styles.group, { flex: 1 }]}>
          <Text style={styles.label}>{uiCopy.modelEdit.chestLabel}</Text>
          <TextInput
            value={state.chest}
            onChangeText={(v) => set({ chest: v })}
            placeholder={uiCopy.modelEdit.chestPlaceholder}
            placeholderTextColor={colors.textSecondary}
            keyboardType="numeric"
            style={styles.input}
          />
          <Text style={styles.optionalHelper}>{uiCopy.modelEdit.measurementOptionalHelper}</Text>
        </View>
        <View style={[styles.group, { flex: 1 }]}>
          <Text style={styles.label}>{uiCopy.modelEdit.waistLabel}</Text>
          <TextInput
            value={state.waist}
            onChangeText={(v) => set({ waist: v })}
            placeholder={uiCopy.modelEdit.waistPlaceholder}
            placeholderTextColor={colors.textSecondary}
            keyboardType="numeric"
            style={styles.input}
          />
          <Text style={styles.optionalHelper}>{uiCopy.modelEdit.measurementOptionalHelper}</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={[styles.group, { flex: 1 }]}>
          <Text style={styles.label}>{uiCopy.modelEdit.hipsLabel}</Text>
          <TextInput
            value={state.hips}
            onChangeText={(v) => set({ hips: v })}
            placeholder={uiCopy.modelEdit.hipsPlaceholder}
            placeholderTextColor={colors.textSecondary}
            keyboardType="numeric"
            style={styles.input}
          />
          <Text style={styles.optionalHelper}>{uiCopy.modelEdit.measurementOptionalHelper}</Text>
        </View>
        <View style={[styles.group, { flex: 1 }]}>
          <Text style={styles.label}>{uiCopy.modelEdit.legsInseamLabel}</Text>
          <TextInput
            value={state.legs_inseam}
            onChangeText={(v) => set({ legs_inseam: v })}
            placeholder={uiCopy.modelEdit.legsInseamPlaceholder}
            placeholderTextColor={colors.textSecondary}
            keyboardType="numeric"
            style={styles.input}
          />
          <Text style={styles.optionalHelper}>{uiCopy.modelEdit.measurementOptionalHelper}</Text>
        </View>
      </View>

      <View style={[styles.group, { maxWidth: '50%' }]}>
        <Text style={styles.label}>{uiCopy.modelEdit.shoeSizeLabel}</Text>
        <TextInput
          value={state.shoe_size}
          onChangeText={(v) => set({ shoe_size: v })}
          placeholder={uiCopy.modelEdit.shoeSizePlaceholder}
          placeholderTextColor={colors.textSecondary}
          keyboardType="numeric"
          style={styles.input}
        />
        <Text style={styles.optionalHelper}>{uiCopy.modelEdit.measurementOptionalHelper}</Text>
      </View>

      {/* ── Appearance ── */}
      <Text style={styles.sectionHeader}>{uiCopy.modelEdit.sectionAppearance}</Text>

      {/* Hair Color — pill selector */}
      <View style={styles.group}>
        <Text style={styles.label}>{uiCopy.modelEdit.hairColorLabel}</Text>
        <View style={styles.pills}>
          {HAIR_COLOR_OPTIONS.map((opt) => {
            const active = state.hair_color === opt;
            return (
              <TouchableOpacity
                key={opt}
                style={[styles.pill, active && styles.pillActive]}
                onPress={() => set({ hair_color: active ? '' : opt })}
              >
                <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>{opt}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Eye Color — pill selector */}
      <View style={styles.group}>
        <Text style={styles.label}>{uiCopy.modelEdit.eyeColorLabel}</Text>
        <View style={styles.pills}>
          {EYE_COLOR_OPTIONS.map((opt) => {
            const active = state.eye_color === opt;
            return (
              <TouchableOpacity
                key={opt}
                style={[styles.pill, active && styles.pillActive]}
                onPress={() => set({ eye_color: active ? '' : opt })}
              >
                <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>{opt}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── Ethnicity ── */}
      <Text style={styles.sectionHeader}>{uiCopy.modelEdit.sectionEthnicity}</Text>

      <View style={styles.group}>
        {state.ethnicity && (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: spacing.xs,
              marginBottom: spacing.xs,
            }}
          >
            <TouchableOpacity style={styles.chip} onPress={() => set({ ethnicity: null })}>
              <Text style={styles.chipLabel}>{state.ethnicity}</Text>
              <Text style={styles.chipRemove}>×</Text>
            </TouchableOpacity>
          </View>
        )}

        <View>
          <TouchableOpacity
            style={[styles.pill, ethnicityDropdownOpen && { borderColor: colors.accentBrown }]}
            onPress={() => {
              setEthnicityDropdownOpen((o) => !o);
              setCountryDropdownOpen(false);
            }}
          >
            <Text style={styles.pillLabel}>
              {state.ethnicity ? state.ethnicity : uiCopy.modelEdit.ethnicitySelectLabel}
            </Text>
          </TouchableOpacity>

          {ethnicityDropdownOpen && (
            <View style={styles.dropdown}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                {ETHNICITY_OPTIONS.map((eth, i) => {
                  const selected = state.ethnicity === eth;
                  return (
                    <TouchableOpacity
                      key={eth}
                      style={[
                        styles.dropdownItem,
                        i < ETHNICITY_OPTIONS.length - 1 && styles.dropdownItemBorder,
                        selected && styles.dropdownItemSelected,
                      ]}
                      onPress={() => {
                        set({ ethnicity: selected ? null : eth });
                        setEthnicityDropdownOpen(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.dropdownItemText,
                          selected && styles.dropdownItemTextSelected,
                        ]}
                      >
                        {eth}
                      </Text>
                      {selected && <Text style={styles.checkmark}>✓</Text>}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}
        </View>
      </View>

      {/* ── Location ── */}
      <Text style={styles.sectionHeader}>{uiCopy.modelEdit.sectionLocation}</Text>
      <Text
        style={{
          fontSize: 11,
          color: colors.textSecondary,
          marginBottom: spacing.sm,
          lineHeight: 15,
        }}
      >
        {uiCopy.modelEdit.countryNearMeHint}
      </Text>

      {/* Country dropdown */}
      <View style={styles.group}>
        <Text style={styles.label}>{uiCopy.modelEdit.countryLabel}</Text>

        {state.country_code ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <View style={styles.chip}>
              <Text style={styles.chipLabel}>{selectedCountryLabel}</Text>
              <TouchableOpacity
                onPress={() => {
                  set({ country_code: '', city: '' });
                  setCountryQuery('');
                  setCountryDropdownOpen(false);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.chipRemove}>×</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View>
            <TextInput
              value={countryQuery}
              onChangeText={(v) => {
                setCountryQuery(v);
                setCountryDropdownOpen(true);
                setEthnicityDropdownOpen(false);
              }}
              onFocus={() => {
                setCountryDropdownOpen(true);
                setEthnicityDropdownOpen(false);
              }}
              placeholder={uiCopy.modelEdit.countrySelectLabel}
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, { height: 32, paddingVertical: 4, fontSize: 11 }]}
            />

            {countryDropdownOpen && filteredCountryOptions.length > 0 && (
              <View style={styles.dropdown}>
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                >
                  {filteredCountryOptions.map((c, i) => (
                    <TouchableOpacity
                      key={c.code}
                      style={[
                        styles.dropdownItem,
                        i < filteredCountryOptions.length - 1 && styles.dropdownItemBorder,
                      ]}
                      onPress={() => {
                        set({ country_code: c.code, city: '' });
                        setCountryQuery('');
                        setCountryDropdownOpen(false);
                      }}
                    >
                      <Text style={styles.dropdownItemText}>{c.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        )}
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>{uiCopy.modelEdit.cityLabel}</Text>
        <TextInput
          value={state.city}
          onChangeText={(v) => set({ city: v })}
          placeholder={uiCopy.modelEdit.cityPlaceholder}
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />
      </View>

      {/* ── Segment & Sport ── */}
      <Text style={styles.sectionHeader}>{uiCopy.modelEdit.sectionSegment}</Text>

      {/* Categories */}
      <View style={styles.group}>
        <Text style={styles.label}>
          {uiCopy.modelEdit.categoryLabel}{' '}
          <Text style={{ fontWeight: '400' }}>{uiCopy.modelEdit.categoryHint}</Text>
        </Text>
        <View style={styles.pills}>
          {AGENCY_SEGMENT_TYPES.map((seg) => {
            const active = state.categories.includes(seg);
            return (
              <TouchableOpacity
                key={seg}
                style={[styles.pill, active && styles.pillActive]}
                onPress={() =>
                  set({
                    categories: active
                      ? state.categories.filter((c) => c !== seg)
                      : [...state.categories, seg],
                  })
                }
              >
                <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>{seg}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── Mother Agency ── */}
      <Text style={styles.sectionHeader}>{uiCopy.modelEdit.sectionMotherAgency}</Text>
      <Text
        style={{
          fontSize: 11,
          color: colors.textSecondary,
          marginBottom: spacing.sm,
          lineHeight: 15,
        }}
      >
        {uiCopy.modelEdit.motherAgencyHint}
      </Text>

      <View style={styles.group}>
        <Text style={styles.label}>{uiCopy.modelEdit.motherAgencyNameLabel}</Text>
        <TextInput
          value={state.mother_agency_name}
          onChangeText={(v) => set({ mother_agency_name: v })}
          placeholder={uiCopy.modelEdit.motherAgencyNamePlaceholder}
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
          maxLength={120}
        />
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>{uiCopy.modelEdit.motherAgencyContactLabel}</Text>
        <TextInput
          value={state.mother_agency_contact}
          onChangeText={(v) => set({ mother_agency_contact: v })}
          placeholder={uiCopy.modelEdit.motherAgencyContactPlaceholder}
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
          maxLength={240}
          multiline
        />
        <Text style={styles.optionalHelper}>
          {uiCopy.modelEdit.motherAgencyContactInternalNote}
        </Text>
      </View>

      {/* Sport */}
      <View style={styles.group}>
        <Text style={styles.label}>
          {uiCopy.sportCategories.sectionLabel}{' '}
          <Text style={{ fontWeight: '400' }}>{uiCopy.sportCategories.sectionHint}</Text>
        </Text>
        <View style={styles.pills}>
          <TouchableOpacity
            style={[styles.pill, state.is_sports_winter && styles.pillActive]}
            onPress={() => set({ is_sports_winter: !state.is_sports_winter })}
          >
            <Text style={[styles.pillLabel, state.is_sports_winter && styles.pillLabelActive]}>
              {uiCopy.sportCategories.winterSports}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pill, state.is_sports_summer && styles.pillActive]}
            onPress={() => set({ is_sports_summer: !state.is_sports_summer })}
          >
            <Text style={[styles.pillLabel, state.is_sports_summer && styles.pillLabelActive]}>
              {uiCopy.sportCategories.summerSports}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export default ModelEditDetailsPanel;

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  sectionHeader: {
    ...typography.label,
    fontSize: 11,
    color: colors.textPrimary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  group: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  label: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  pillActive: {
    borderColor: colors.accentBrown,
    backgroundColor: colors.surfaceWarm,
  },
  pillLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  pillLabelActive: {
    color: colors.accentBrown,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.textPrimary,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  chipLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.surface,
  },
  chipRemove: {
    ...typography.label,
    fontSize: 12,
    color: colors.surface,
    lineHeight: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    ...typography.body,
    fontSize: 12,
  },
  optionalHelper: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
  },
  dropdown: {
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
  dropdownItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dropdownItemSelected: {
    backgroundColor: colors.surfaceWarm,
  },
  dropdownItemText: {
    ...typography.body,
    fontSize: 12,
    color: colors.textPrimary,
  },
  dropdownItemTextSelected: {
    color: colors.accentBrown,
  },
  checkmark: {
    ...typography.label,
    fontSize: 11,
    color: colors.accentBrown,
  },
});

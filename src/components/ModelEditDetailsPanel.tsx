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
import {
  FILTER_COUNTRIES,
  ETHNICITY_OPTIONS,
  HAIR_COLOR_OPTIONS,
  EYE_COLOR_OPTIONS,
} from '../utils/modelFilters';

// ── State shape ───────────────────────────────────────────────────────────────

export type ModelEditState = {
  name: string;
  email: string;
  sex: 'male' | 'female' | null;
  height: string;
  chest: string;
  waist: string;
  hips: string;
  legs_inseam: string;
  shoe_size: string;
  hair_color: string;
  eye_color: string;
  ethnicity: string | null;
  country_code: string;
  city: string;
  current_location: string;
  categories: string[];
  is_sports_winter: boolean;
  is_sports_summer: boolean;
};

export function buildEditState(m: {
  name: string;
  email?: string | null;
  sex?: 'male' | 'female' | null;
  height?: number | null;
  chest?: number | null;
  bust?: number | null;
  waist?: number | null;
  hips?: number | null;
  legs_inseam?: number | null;
  shoe_size?: number | null;
  hair_color?: string | null;
  eye_color?: string | null;
  ethnicity?: string | null;
  country_code?: string | null;
  country?: string | null;
  city?: string | null;
  current_location?: string | null;
  categories?: string[] | null;
  is_sports_winter?: boolean;
  is_sports_summer?: boolean;
}): ModelEditState {
  const chestVal = m.chest ?? m.bust;
  return {
    name: m.name ?? '',
    email: m.email ?? '',
    sex: (m.sex as 'male' | 'female' | null) ?? null,
    height: String(m.height ?? ''),
    chest: chestVal != null ? String(chestVal) : '',
    waist: m.waist != null ? String(m.waist) : '',
    hips: m.hips != null ? String(m.hips) : '',
    legs_inseam: m.legs_inseam != null ? String(m.legs_inseam) : '',
    shoe_size: m.shoe_size != null ? String(m.shoe_size) : '',
    hair_color: m.hair_color ?? '',
    eye_color: m.eye_color ?? '',
    ethnicity: m.ethnicity ?? null,
    country_code: m.country_code ?? '',
    city: m.city ?? '',
    current_location: m.current_location ?? '',
    categories: m.categories ?? [],
    is_sports_winter: m.is_sports_winter ?? false,
    is_sports_summer: m.is_sports_summer ?? false,
  };
}

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
        {([
          { key: null,     label: uiCopy.modelEdit.sexNotSpecified },
          { key: 'female', label: uiCopy.modelEdit.sexFemale },
          { key: 'male',   label: uiCopy.modelEdit.sexMale },
        ] as const).map((opt) => {
          const active = state.sex === opt.key;
          return (
            <TouchableOpacity
              key={String(opt.key)}
              style={[styles.pill, active && styles.pillActive]}
              onPress={() => set({ sex: opt.key })}
            >
              <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>
                {opt.label}
              </Text>
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
          <Text style={styles.label}>
            {uiCopy.modelEdit.chestLabel}{' '}
            <Text style={{ fontWeight: '400' }}>{uiCopy.modelEdit.chestHint}</Text>
          </Text>
          <TextInput
            value={state.chest}
            onChangeText={(v) => set({ chest: v })}
            placeholder={uiCopy.modelEdit.chestPlaceholder}
            placeholderTextColor={colors.textSecondary}
            keyboardType="numeric"
            style={styles.input}
          />
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
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs }}>
            <TouchableOpacity
              style={styles.chip}
              onPress={() => set({ ethnicity: null })}
            >
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
              <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled showsVerticalScrollIndicator>
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
                      <Text style={[styles.dropdownItemText, selected && styles.dropdownItemTextSelected]}>
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
      <Text style={{ fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm, lineHeight: 15 }}>
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
                <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled showsVerticalScrollIndicator>
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

      <View style={styles.group}>
        <Text style={styles.label}>{uiCopy.modelEdit.currentLocationLabel}</Text>
        <TextInput
          value={state.current_location}
          onChangeText={(v) => set({ current_location: v })}
          placeholder={uiCopy.modelEdit.currentLocationPlaceholder}
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
    backgroundColor: '#F3EEE7',
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
    backgroundColor: '#F3EEE7',
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

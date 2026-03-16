import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { getModelsFromSupabase } from '../services/modelsSupabase';

type ClientModel = {
  id: string;
  name: string;
  height: number;
  bust: number;
  waist: number;
  hips: number;
  city: string;
  hairColor: string;
  polaroids: string[];
  gallery: string[];
};

type Filters = {
  height: 'all' | 'short' | 'medium' | 'tall';
  city: 'all' | 'Paris' | 'Milan' | 'Berlin';
  hairColor: 'all' | 'Blonde' | 'Dark Brown' | 'Black';
};

const initialFilters: Filters = {
  height: 'all',
  city: 'all',
  hairColor: 'all',
};

const AVAILABLE_DATES = ['2026-03-21', '2026-03-22', '2026-03-23'];

export const CustomerSwipeScreen: React.FC = () => {
  const [models, setModels] = useState<ClientModel[]>([]);
  const [index, setIndex] = useState(0);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [detailModel, setDetailModel] = useState<ClientModel | null>(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isSendingOption, setIsSendingOption] = useState(false);
  const [optionSuccess, setOptionSuccess] = useState<string | null>(null);

  useEffect(() => {
    getModelsFromSupabase().then((list) => {
      setModels(
        list.map((m) => ({
          id: m.id,
          name: m.name,
          height: m.height,
          bust: m.bust ?? 0,
          waist: m.waist ?? 0,
          hips: m.hips ?? 0,
          city: m.city ?? '',
          hairColor: m.hair_color ?? '',
          polaroids: m.polaroids ?? [],
          gallery: m.portfolio_images ?? [],
        })),
      );
    });
  }, []);

  const filteredModels = useMemo(() => {
    return models.filter((m) => {
      if (filters.city !== 'all' && m.city !== filters.city) return false;
      if (filters.hairColor !== 'all' && m.hairColor !== filters.hairColor) {
        return false;
      }
      if (filters.height !== 'all') {
        if (filters.height === 'short' && m.height >= 175) return false;
        if (filters.height === 'medium' && (m.height < 175 || m.height > 182)) {
          return false;
        }
        if (filters.height === 'tall' && m.height <= 182) return false;
      }
      return true;
    });
  }, [models, filters]);

  useEffect(() => {
    if (index >= filteredModels.length) {
      setIndex(0);
    }
  }, [filteredModels, index]);

  const current = filteredModels[index];

  const handleNext = () => {
    if (!filteredModels.length) return;
    if (index < filteredModels.length - 1) {
      setIndex(index + 1);
    } else {
      setIndex(0);
    }
  };

  const handleOpenDetail = (model: ClientModel) => {
    setDetailModel(model);
  };

  const handleOpenDatePicker = () => {
    setIsDatePickerOpen(true);
  };

  const handleSelectDate = (date: string) => {
    setIsDatePickerOpen(false);
    setIsSendingOption(true);
    setOptionSuccess(null);
    setTimeout(() => {
      setIsSendingOption(false);
      setOptionSuccess(`Option sent for ${date} (simulated agency API).`);
      setTimeout(() => setOptionSuccess(null), 2600);
    }, 900);
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.headerLabel}>The Swipe</Text>
        <View style={styles.headerRight}>
          <Text style={styles.counter}>
            {filteredModels.length ? index + 1 : 0}/{filteredModels.length}
          </Text>
          <TouchableOpacity
            style={styles.filterPill}
            onPress={() => setIsFilterOpen(true)}
          >
            <Text style={styles.filterLabel}>Filter</Text>
          </TouchableOpacity>
        </View>
      </View>

      {current ? (
        <TouchableOpacity
          activeOpacity={0.9}
          style={styles.card}
          onPress={() => handleOpenDetail(current)}
        >
          <View style={styles.imageWrapper}>
            <Image
              source={{ uri: current.gallery[0] ?? current.polaroids[0] }}
              style={styles.image}
              resizeMode="cover"
            />
          </View>

          <View style={styles.metaRow}>
            <View style={styles.nameCol}>
              <Text style={styles.name}>{current.name}</Text>
              <Text style={styles.subMeta}>
                {current.city} · {current.hairColor}
              </Text>
            </View>
            <View style={styles.measurementsCol}>
              <Text style={styles.measurementsLabel}>Height</Text>
              <Text style={styles.measurementsValue}>{current.height}</Text>
            </View>
            <View style={styles.measurementsCol}>
              <Text style={styles.measurementsLabel}>Bust</Text>
              <Text style={styles.measurementsValue}>{current.bust}</Text>
            </View>
            <View style={styles.measurementsCol}>
              <Text style={styles.measurementsLabel}>Waist</Text>
              <Text style={styles.measurementsValue}>{current.waist}</Text>
            </View>
            <View style={styles.measurementsCol}>
              <Text style={styles.measurementsLabel}>Hips</Text>
              <Text style={styles.measurementsValue}>{current.hips}</Text>
            </View>
          </View>
        </TouchableOpacity>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No results</Text>
          <Text style={styles.emptyCopy}>
            Adjust filters to see available talent.
          </Text>
        </View>
      )}

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionButton, styles.skipButton]}
          onPress={handleNext}
        >
          <Text style={styles.actionLabelSecondary}>Skip</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.optionButton]}
          onPress={handleOpenDatePicker}
          disabled={!current || isSendingOption}
        >
          <Text style={styles.actionLabelPrimary}>
            {isSendingOption ? 'Sending…' : 'Option'}
          </Text>
        </TouchableOpacity>
      </View>

      {optionSuccess && (
        <View style={styles.successBanner}>
          <Text style={styles.successText}>{optionSuccess}</Text>
        </View>
      )}

      <FilterDrawer
        visible={isFilterOpen}
        filters={filters}
        onClose={() => setIsFilterOpen(false)}
        onChangeFilters={setFilters}
      />

      <DetailModal
        model={detailModel}
        onClose={() => setDetailModel(null)}
      />

      <DatePickerModal
        visible={isDatePickerOpen}
        onClose={() => setIsDatePickerOpen(false)}
        onSelectDate={handleSelectDate}
      />
    </View>
  );
};

type FilterDrawerProps = {
  visible: boolean;
  filters: Filters;
  onClose: () => void;
  onChangeFilters: (f: Filters) => void;
};

const FilterDrawer: React.FC<FilterDrawerProps> = ({
  visible,
  filters,
  onClose,
  onChangeFilters,
}) => {
  const update = (partial: Partial<Filters>) =>
    onChangeFilters({ ...filters, ...partial });

  return (
    <Modal visible={visible} transparent animationType="fade">
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.drawer}>
          <Text style={styles.drawerTitle}>Filters</Text>

          <View style={styles.drawerSection}>
            <Text style={styles.drawerLabel}>Height</Text>
            <View style={styles.chipRow}>
              {[
                { key: 'all', label: 'All' },
                { key: 'short', label: '< 175' },
                { key: 'medium', label: '175–182' },
                { key: 'tall', label: '> 182' },
              ].map((opt) => (
                <Chip
                  key={opt.key}
                  label={opt.label}
                  active={filters.height === opt.key}
                  onPress={() =>
                    update({ height: opt.key as Filters['height'] })
                  }
                />
              ))}
            </View>
          </View>

          <View style={styles.drawerSection}>
            <Text style={styles.drawerLabel}>City</Text>
            <View style={styles.chipRow}>
              {['all', 'Paris', 'Milan', 'Berlin'].map((city) => (
                <Chip
                  key={city}
                  label={city === 'all' ? 'All' : city}
                  active={filters.city === city}
                  onPress={() =>
                    update({ city: city as Filters['city'] })
                  }
                />
              ))}
            </View>
          </View>

          <View style={styles.drawerSection}>
            <Text style={styles.drawerLabel}>Hair</Text>
            <View style={styles.chipRow}>
              {['all', 'Blonde', 'Dark Brown', 'Black'].map((color) => (
                <Chip
                  key={color}
                  label={color === 'all' ? 'All' : color}
                  active={filters.hairColor === color}
                  onPress={() =>
                    update({ hairColor: color as Filters['hairColor'] })
                  }
                />
              ))}
            </View>
          </View>

          <TouchableOpacity
            style={styles.clearButton}
            onPress={() => onChangeFilters(initialFilters)}
          >
            <Text style={styles.clearLabel}>Clear filters</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

type ChipProps = {
  label: string;
  active: boolean;
  onPress: () => void;
};

const Chip: React.FC<ChipProps> = ({ label, active, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.chip, active && styles.chipActive]}
  >
    <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
      {label}
    </Text>
  </TouchableOpacity>
);

type DetailModalProps = {
  model: ClientModel | null;
  onClose: () => void;
};

const DetailModal: React.FC<DetailModalProps> = ({ model, onClose }) => {
  if (!model) return null;

  return (
    <Modal visible transparent animationType="fade">
      <View style={styles.detailOverlay}>
        <View style={styles.detailCard}>
          <ScrollView contentContainerStyle={styles.detailContent}>
            <View style={styles.detailHeaderRow}>
              <Text style={styles.detailName}>{model.name}</Text>
              <TouchableOpacity onPress={onClose}>
                <Text style={styles.closeLabel}>Close</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.detailSub}>
              {model.city} · {model.hairColor}
            </Text>

            <View style={styles.detailHero}>
              <Image
                source={{ uri: model.gallery[0] ?? model.polaroids[0] }}
                style={styles.detailHeroImage}
              />
            </View>

            <View style={styles.detailMeasurementsRow}>
              <DetailMeasurement label="Height" value={model.height} />
              <DetailMeasurement label="Bust" value={model.bust} />
              <DetailMeasurement label="Waist" value={model.waist} />
              <DetailMeasurement label="Hips" value={model.hips} />
            </View>

            <Text style={styles.detailSectionLabel}>Polas</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.polaRow}>
                {model.polaroids.map((url) => (
                  <Image key={url} source={{ uri: url }} style={styles.pola} />
                ))}
              </View>
            </ScrollView>

            <Text style={styles.detailSectionLabel}>Video</Text>
            <View style={styles.videoPlaceholder}>
              <Text style={styles.videoLabel}>Video placeholder</Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

type DetailMeasurementProps = {
  label: string;
  value: number;
};

const DetailMeasurement: React.FC<DetailMeasurementProps> = ({
  label,
  value,
}) => (
  <View style={styles.detailMeasurement}>
    <Text style={styles.detailMeasurementLabel}>{label}</Text>
    <Text style={styles.detailMeasurementValue}>{value}</Text>
  </View>
);

type DatePickerModalProps = {
  visible: boolean;
  onClose: () => void;
  onSelectDate: (date: string) => void;
};

const DatePickerModal: React.FC<DatePickerModalProps> = ({
  visible,
  onClose,
  onSelectDate,
}) => {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <TouchableOpacity
        style={styles.detailOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={styles.dateCard}>
          <Text style={styles.dateTitle}>Send option</Text>
          <Text style={styles.dateSub}>
            Choose a preferred date for the option.
          </Text>
          <View style={styles.chipRow}>
            {AVAILABLE_DATES.map((d) => (
              <Chip
                key={d}
                label={d}
                active={false}
                onPress={() => onSelectDate(d)}
              />
            ))}
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const CARD_RADIUS = 18;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  headerLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  counter: {
    ...typography.label,
    color: colors.textSecondary,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  filterPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  filterLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  card: {
    flex: 1,
    borderRadius: CARD_RADIUS,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  imageWrapper: {
    flex: 1,
    backgroundColor: '#D0CEC7',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  metaRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'flex-end',
    gap: spacing.lg,
  },
  nameCol: {
    flex: 1,
  },
  name: {
    ...typography.heading,
    fontSize: 18,
    color: colors.textPrimary,
  },
  subMeta: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
  },
  measurementsCol: {
    alignItems: 'flex-start',
  },
  measurementsLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  measurementsValue: {
    ...typography.body,
    color: colors.textPrimary,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  actionButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: 999,
    alignItems: 'center',
    borderWidth: 1,
  },
  skipButton: {
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  optionButton: {
    borderColor: colors.accentGreen,
    backgroundColor: colors.accentGreen,
  },
  actionLabelSecondary: {
    ...typography.label,
    color: colors.textSecondary,
  },
  actionLabelPrimary: {
    ...typography.label,
    color: colors.surface,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.08)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
  },
  drawer: {
    width: '72%',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    marginTop: spacing.xl,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  drawerTitle: {
    ...typography.label,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  drawerSection: {
    marginBottom: spacing.md,
  },
  drawerLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chipActive: {
    borderColor: colors.accentBrown,
    backgroundColor: '#F3F0EC',
  },
  chipLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  chipLabelActive: {
    color: colors.accentBrown,
  },
  clearButton: {
    marginTop: spacing.sm,
  },
  clearLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  emptyState: {
    flex: 1,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    ...typography.heading,
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  emptyCopy: {
    ...typography.body,
    color: colors.textSecondary,
  },
  successBanner: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    alignSelf: 'center',
    backgroundColor: '#E4EFE9',
  },
  successText: {
    ...typography.body,
    fontSize: 12,
    color: colors.accentGreen,
  },
  detailOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  detailCard: {
    width: '100%',
    maxHeight: '90%',
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  detailContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  detailHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailName: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  detailSub: {
    ...typography.body,
    color: colors.textSecondary,
  },
  closeLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  detailHero: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#D0CEC7',
  },
  detailHeroImage: {
    width: '100%',
    height: 260,
  },
  detailMeasurementsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  detailMeasurement: {
    alignItems: 'flex-start',
  },
  detailMeasurementLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  detailMeasurementValue: {
    ...typography.body,
    color: colors.textPrimary,
  },
  detailSectionLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  polaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  pola: {
    width: 80,
    height: 120,
    borderRadius: 8,
    backgroundColor: '#D0CEC7',
  },
  videoPlaceholder: {
    height: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  dateCard: {
    width: '84%',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateTitle: {
    ...typography.label,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  dateSub: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
});


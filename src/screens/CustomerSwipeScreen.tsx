import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { StorageImage } from '../components/StorageImage';
import { colors, spacing, typography } from '../theme/theme';
import { getModelsPagedFromSupabase, type SwipeFilters } from '../services/modelsSupabase';
import {
  recordInteraction,
  getDiscoveryModels,
  loadSessionIds,
  saveSessionId,
  clearSessionIds,
  type DiscoveryModel,
  DISCOVERY_PAGE_SIZE,
} from '../services/clientDiscoverySupabase';
import { useAuth } from '../context/AuthContext';
import { uiCopy } from '../constants/uiCopy';
import { addOptionRequest } from '../store/optionRequests';

const SWIPE_PAGE_SIZE = 25;

/** Derives an ISO-2 country code from the hard-coded city filter options. */
const CITY_TO_COUNTRY: Record<string, string> = {
  Paris: 'FR',
  Milan: 'IT',
  Berlin: 'DE',
};

function mapDiscoveryModel(m: DiscoveryModel): ClientModel {
  return {
    id: m.id,
    name: m.name,
    height: m.height,
    bust: m.bust ?? 0,
    waist: m.waist ?? 0,
    hips: m.hips ?? 0,
    city: m.city ?? '',
    hairColor: m.hair_color ?? '',
    gallery: m.portfolio_images ?? [],
  };
}

type ClientModel = {
  id: string;
  name: string;
  height: number;
  bust: number;
  waist: number;
  hips: number;
  city: string;
  hairColor: string;
  gallery: string[];
};

type Filters = SwipeFilters & {
  height: 'all' | 'short' | 'medium' | 'tall';
  city: 'all' | 'Paris' | 'Milan' | 'Berlin';
  hairColor: 'all' | 'Blonde' | 'Dark Brown' | 'Black';
};

const initialFilters: Filters = {
  height: 'all',
  city: 'all',
  hairColor: 'all',
};

/** Generate the next N weekdays (Mon–Fri) starting from tomorrow as ISO date strings. */
function getUpcomingWeekdays(count = 14): string[] {
  const dates: string[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() + 1); // start from tomorrow
  while (dates.length < count) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export const CustomerSwipeScreen: React.FC = () => {
  const auth = useAuth();
  const [clientOrgId, setClientOrgId] = useState<string | null>(null);

  const [models, setModels] = useState<ClientModel[]>([]);
  const [index, setIndex] = useState(0);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [detailModel, setDetailModel] = useState<ClientModel | null>(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isSendingOption, setIsSendingOption] = useState(false);
  const [optionSuccess, setOptionSuccess] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const pageOffsetRef = useRef(0);
  /** Cursor for ranked discovery pagination (null when using legacy fallback path). */
  const [discoveryCursor, setDiscoveryCursor] = useState<import('../services/clientDiscoverySupabase').DiscoveryCursor>(null);

  /**
   * Model IDs already shown in this session — excluded from the visible queue
   * to prevent duplicates. Stored in a ref to avoid re-renders on every add.
   * `sessionSeenCount` is a derived counter that ticks whenever the set grows,
   * allowing `filteredModels` useMemo to correctly invalidate when new IDs are added.
   */
  const sessionSeenIds = useRef<Set<string>>(new Set());
  const [sessionSeenCount, setSessionSeenCount] = useState(0);

  // Resolve client org ID — available directly from profile.organization_id loaded by AuthContext.
  useEffect(() => {
    const userId = auth?.profile?.id;
    if (!userId || auth?.profile?.role !== 'client') return;
    const orgId = auth?.profile?.organization_id;
    if (orgId) {
      setClientOrgId(orgId);
      sessionSeenIds.current = loadSessionIds(orgId);
    }
  }, [auth?.profile?.id, auth?.profile?.role, auth?.profile?.organization_id]);

  const loadNextPage = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const countryIso = filters.city !== 'all' ? (CITY_TO_COUNTRY[filters.city] ?? null) : null;
    try {
      if (clientOrgId && countryIso && discoveryCursor) {
        // Ranked path: load next page via cursor.
        const { models: more, nextCursor } = await getDiscoveryModels(
          clientOrgId,
          { countryCode: countryIso },
          discoveryCursor,
          sessionSeenIds.current,
        );
        setModels((prev) => [...prev, ...more.map(mapDiscoveryModel)]);
        setDiscoveryCursor(nextCursor);
        if (!nextCursor) setHasMore(false);
      } else {
        // Legacy offset path.
        const page = await getModelsPagedFromSupabase(
          pageOffsetRef.current,
          SWIPE_PAGE_SIZE,
          filters,
        );
        const mapped = page.map((m) => ({
          id: m.id, name: m.name, height: m.height,
          bust: m.bust ?? 0, waist: m.waist ?? 0, hips: m.hips ?? 0,
          city: m.city ?? '', hairColor: m.hair_color ?? '',
          gallery: m.portfolio_images ?? [],
        }));
        setModels((prev) => [...prev, ...mapped]);
        pageOffsetRef.current += mapped.length;
        if (page.length < SWIPE_PAGE_SIZE) setHasMore(false);
      }
    } catch (e) {
      console.error('CustomerSwipeScreen: loadNextPage error', e);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, filters, clientOrgId, discoveryCursor]);

  // Initial load — prefer ranked discovery when clientOrgId + countryCode are available.
  useEffect(() => {
    pageOffsetRef.current = 0;
    setModels([]);
    setHasMore(true);
    setIndex(0);
    setDiscoveryCursor(null);
    const countryIso = filters.city !== 'all' ? (CITY_TO_COUNTRY[filters.city] ?? null) : null;
    void (async () => {
      setLoadingMore(true);
      try {
        if (clientOrgId && countryIso) {
          const { models: ranked, nextCursor } = await getDiscoveryModels(
            clientOrgId,
            { countryCode: countryIso },
            null,
            sessionSeenIds.current,
          );
          setModels(ranked.map(mapDiscoveryModel));
          setDiscoveryCursor(nextCursor);
          if (!nextCursor) setHasMore(false);
        } else {
          const page = await getModelsPagedFromSupabase(0, SWIPE_PAGE_SIZE, filters);
          const mapped = page.map((m) => ({
            id: m.id, name: m.name, height: m.height,
            bust: m.bust ?? 0, waist: m.waist ?? 0, hips: m.hips ?? 0,
            city: m.city ?? '', hairColor: m.hair_color ?? '',
            gallery: m.portfolio_images ?? [],
          }));
          setModels(mapped);
          pageOffsetRef.current = mapped.length;
          if (page.length < SWIPE_PAGE_SIZE) setHasMore(false);
        }
      } catch (e) {
        console.error('CustomerSwipeScreen: initial load error', e);
      } finally {
        setLoadingMore(false);
      }
    })();
  }, [filters, clientOrgId]);

  // Reset session dedup when filters change (new discovery context).
  useEffect(() => {
    if (clientOrgId) {
      clearSessionIds(clientOrgId);
    }
    sessionSeenIds.current = new Set();
    setSessionSeenCount(0);
  }, [filters, clientOrgId]);

  const filteredModels = useMemo(() => {
    return models.filter((m) => !sessionSeenIds.current.has(m.id));
    // sessionSeenCount in deps ensures the memo re-evaluates when the seen-set grows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, sessionSeenCount]);

  // Pre-fetch next page when approaching end of queue
  useEffect(() => {
    if (filteredModels.length > 0 && index >= filteredModels.length - 5 && hasMore) {
      void loadNextPage();
    }
  }, [index, filteredModels.length, hasMore, loadNextPage]);

  useEffect(() => {
    if (index >= filteredModels.length && filteredModels.length > 0) {
      setIndex(0);
    }
  }, [filteredModels, index]);

  const current = filteredModels[index] ?? null;

  // Record "viewed", persist to localStorage, and add to in-memory dedup set.
  useEffect(() => {
    if (!current || !clientOrgId) return;
    sessionSeenIds.current.add(current.id);
    setSessionSeenCount(sessionSeenIds.current.size);
    saveSessionId(clientOrgId, current.id);
    void recordInteraction(current.id, 'viewed');
  }, [current?.id, clientOrgId]);

  const handleNext = () => {
    if (!filteredModels.length) return;
    // "Skip" is a neutral browse action; "viewed" is already recorded when the card renders.
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

  const handleSelectDate = useCallback((date: string) => {
    const model = detailModel ?? current;
    if (!model) return;
    setIsDatePickerOpen(false);
    setIsSendingOption(true);
    setOptionSuccess(null);

    const clientName = auth?.profile?.name ?? auth?.profile?.email ?? 'Client';
    addOptionRequest(
      clientName,
      model.name,
      model.id,
      date,
      undefined,
      { requestType: 'option' },
    );

    setIsSendingOption(false);
    setOptionSuccess(uiCopy.swipe.optionSuccessMessage(date));
    setTimeout(() => setOptionSuccess(null), 2600);
  }, [detailModel, current, auth?.profile]);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.headerLabel}>{uiCopy.swipe.headerLabel}</Text>
        <View style={styles.headerRight}>
          <Text style={styles.counter}>
            {filteredModels.length ? index + 1 : 0}/{filteredModels.length}
          </Text>
          <TouchableOpacity
            style={styles.filterPill}
            onPress={() => setIsFilterOpen(true)}
          >
            <Text style={styles.filterLabel}>{uiCopy.swipe.filterButton}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loadingMore && models.length === 0 ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color={colors.accentBrown} />
        </View>
      ) : current ? (
        <TouchableOpacity
          activeOpacity={0.9}
          style={styles.card}
          onPress={() => handleOpenDetail(current)}
        >
          <View style={styles.imageWrapper}>
            <StorageImage
              uri={current.gallery[0]}
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
              <Text style={styles.measurementsLabel}>{uiCopy.swipe.measurementHeight}</Text>
              <Text style={styles.measurementsValue}>{current.height}</Text>
            </View>
            <View style={styles.measurementsCol}>
              <Text style={styles.measurementsLabel}>{uiCopy.swipe.measurementBust}</Text>
              <Text style={styles.measurementsValue}>{current.bust}</Text>
            </View>
            <View style={styles.measurementsCol}>
              <Text style={styles.measurementsLabel}>{uiCopy.swipe.measurementWaist}</Text>
              <Text style={styles.measurementsValue}>{current.waist}</Text>
            </View>
            <View style={styles.measurementsCol}>
              <Text style={styles.measurementsLabel}>{uiCopy.swipe.measurementHips}</Text>
              <Text style={styles.measurementsValue}>{current.hips}</Text>
            </View>
          </View>
        </TouchableOpacity>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{uiCopy.discover.noMoreModels}</Text>
          <Text style={styles.emptyCopy}>{uiCopy.discover.noMoreModelsSub}</Text>
        </View>
      )}

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionButton, styles.skipButton]}
          onPress={handleNext}
        >
          <Text style={styles.actionLabelSecondary}>{uiCopy.swipe.skipAction}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.optionButton]}
          onPress={handleOpenDatePicker}
          disabled={!current || isSendingOption}
        >
          <Text style={styles.actionLabelPrimary}>
            {isSendingOption ? uiCopy.swipe.optionSending : uiCopy.swipe.optionAction}
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
          <Text style={styles.drawerTitle}>{uiCopy.swipe.filterDrawerTitle}</Text>

          <View style={styles.drawerSection}>
            <Text style={styles.drawerLabel}>{uiCopy.swipe.filterHeight}</Text>
            <View style={styles.chipRow}>
              {[
                { key: 'all', label: uiCopy.swipe.filterAll },
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
            <Text style={styles.drawerLabel}>{uiCopy.swipe.filterCity}</Text>
            <View style={styles.chipRow}>
              {['all', 'Paris', 'Milan', 'Berlin'].map((city) => (
                <Chip
                  key={city}
                  label={city === 'all' ? uiCopy.swipe.filterAll : city}
                  active={filters.city === city}
                  onPress={() =>
                    update({ city: city as Filters['city'] })
                  }
                />
              ))}
            </View>
          </View>

          <View style={styles.drawerSection}>
            <Text style={styles.drawerLabel}>{uiCopy.swipe.filterHair}</Text>
            <View style={styles.chipRow}>
              {['all', 'Blonde', 'Dark Brown', 'Black'].map((color) => (
                <Chip
                  key={color}
                  label={color === 'all' ? uiCopy.swipe.filterAll : color}
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
            <Text style={styles.clearLabel}>{uiCopy.swipe.filterClear}</Text>
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
                <Text style={styles.closeLabel}>{uiCopy.swipe.detailClose}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.detailSub}>
              {model.city} · {model.hairColor}
            </Text>

            <View style={styles.detailHero}>
              <StorageImage
                uri={model.gallery[0]}
                style={styles.detailHeroImage}
                resizeMode="cover"
              />
            </View>

            <View style={styles.detailMeasurementsRow}>
              <DetailMeasurement label={uiCopy.swipe.measurementHeight} value={model.height} />
              <DetailMeasurement label={uiCopy.swipe.measurementBust} value={model.bust} />
              <DetailMeasurement label={uiCopy.swipe.measurementWaist} value={model.waist} />
              <DetailMeasurement label={uiCopy.swipe.measurementHips} value={model.hips} />
            </View>

            <Text style={styles.detailSectionLabel}>{uiCopy.swipe.detailVideoLabel}</Text>
            <View style={styles.videoPlaceholder}>
              <Text style={styles.videoLabel}>{uiCopy.swipe.detailVideoPlaceholder}</Text>
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
  const availableDates = useMemo(() => getUpcomingWeekdays(14), []);
  return (
    <Modal visible={visible} transparent animationType="fade">
      <TouchableOpacity
        style={styles.detailOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={styles.dateCard}>
          <Text style={styles.dateTitle}>{uiCopy.swipe.sendOptionTitle}</Text>
          <Text style={styles.dateSub}>{uiCopy.swipe.sendOptionSubtitle}</Text>
          <View style={styles.chipRow}>
            {availableDates.map((d) => (
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


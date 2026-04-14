/**
 * Open-access view for shared selection links.
 * No login required. Recipient sees only the selection of models sent to them.
 * URL format: ?shared=1&name=...&ids=1,2,3
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal } from 'react-native';
import { StorageImage } from '../components/StorageImage';
import { colors, spacing, typography } from '../theme/theme';
import { getModelData } from '../services/apiService';
import { normalizeDocumentspicturesModelImageRef } from '../utils/normalizeModelPortfolioUrl';
import { uiCopy } from '../constants/uiCopy';

type SharedModel = {
  id: string;
  name: string;
  measurements: { height: number; chest: number; waist: number; hips: number };
  coverUrl: string;
  cityLine: string;
};

type SharedSelectionViewProps = {
  shareName: string;
  modelIds: string[];
};

export const SharedSelectionView: React.FC<SharedSelectionViewProps> = ({
  shareName,
  modelIds,
}) => {
  const gutter = spacing.xs / 2;

  const [models, setModels] = useState<SharedModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailOpen, setDetailOpen] = useState<SharedModel | null>(null);
  const modelIdsKey = modelIds.join(',');

  useEffect(() => {
    if (!modelIds.length) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all(modelIds.map((id) => getModelData(id)))
      .then((results) => {
        if (cancelled) return;
        const list: SharedModel[] = results
          .filter(Boolean)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((m: any) => {
            const cityLine =
              (typeof m.effective_city === 'string' && m.effective_city.trim()) ||
              (typeof m.city === 'string' && m.city.trim()) ||
              '';
            return {
              id: m.id,
              name: m.name,
              measurements: m.measurements || { height: 0, chest: 0, waist: 0, hips: 0 },
              coverUrl: normalizeDocumentspicturesModelImageRef(
                m.portfolio?.images?.[0] || m.portfolio?.polaroids?.[0] || '',
                m.id,
              ),
              cityLine,
            };
          });
        setModels(list);
      })
      .catch((e) => {
        console.error('[SharedSelectionView] Failed to load models:', e);
        if (!cancelled) setModels([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelIdsKey]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <Text style={styles.title}>{uiCopy.sharedSelection.title}</Text>
        <Text style={styles.subtitle}>{shareName}</Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <Text style={styles.metaText}>{uiCopy.common.loading}</Text>
        </View>
      ) : models.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.metaText}>{uiCopy.sharedSelection.empty}</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
        >
          <View style={styles.gridRow}>
            {models.map((m) => (
              <View key={m.id} style={[styles.gridCell, { padding: gutter }]}>
                <TouchableOpacity
                  style={styles.tile}
                  activeOpacity={0.9}
                  onPress={() => setDetailOpen(m)}
                  accessibilityRole="button"
                >
                  <View style={styles.tileImageWrap}>
                    <StorageImage uri={m.coverUrl} style={styles.tileImage} resizeMode="contain" />
                  </View>
                  <Text style={styles.tileName} numberOfLines={1}>
                    {m.name}
                  </Text>
                  <Text style={styles.tileMeta} numberOfLines={2}>
                    {uiCopy.discover.detailMeasurementHeight} {m.measurements.height} cm ·{' '}
                    {uiCopy.discover.detailMeasurementChest} {m.measurements.chest} cm
                  </Text>
                  {m.cityLine ? (
                    <Text style={styles.tileCity} numberOfLines={1}>
                      {m.cityLine}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      <Modal
        visible={detailOpen !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailOpen(null)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setDetailOpen(null)}
          />
          <View style={styles.modalCard}>
            <View style={styles.modalTopBar}>
              <TouchableOpacity onPress={() => setDetailOpen(null)} hitSlop={12}>
                <Text style={styles.modalBack}>{uiCopy.discover.backToGallery}</Text>
              </TouchableOpacity>
            </View>
            {detailOpen ? (
              <>
                <View style={styles.modalHeroWrap}>
                  <StorageImage
                    uri={detailOpen.coverUrl}
                    style={styles.modalHero}
                    resizeMode="contain"
                  />
                </View>
                <View style={styles.modalMetaBlock}>
                  <Text style={styles.detailName}>{detailOpen.name}</Text>
                  <Text style={styles.detailMeasurements}>
                    {uiCopy.discover.detailMeasurementHeight} {detailOpen.measurements.height} cm ·{' '}
                    {uiCopy.discover.detailMeasurementChest} {detailOpen.measurements.chest} cm ·{' '}
                    {uiCopy.discover.detailMeasurementWaist} {detailOpen.measurements.waist} cm ·{' '}
                    {uiCopy.discover.detailMeasurementHips} {detailOpen.measurements.hips} cm
                  </Text>
                  {detailOpen.cityLine ? (
                    <Text style={styles.detailCity}>{detailOpen.cityLine}</Text>
                  ) : null}
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  brand: {
    ...typography.headingCompact,
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  title: {
    ...typography.headingCompact,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  subtitle: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  metaText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  gridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
  },
  gridCell: {
    width: '50%',
    marginBottom: 0,
  },
  tile: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingBottom: spacing.sm,
  },
  tileImageWrap: {
    width: '100%',
    aspectRatio: 3 / 4,
    backgroundColor: '#D0CEC7',
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
  tileName: {
    ...typography.label,
    fontSize: 13,
    color: colors.textPrimary,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  tileMeta: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
    paddingHorizontal: spacing.sm,
  },
  tileCity: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
    paddingHorizontal: spacing.sm,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
    backgroundColor: colors.background,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalBack: {
    ...typography.label,
    fontSize: 14,
    color: colors.accent,
    fontWeight: '600',
  },
  modalHeroWrap: {
    width: '100%',
    aspectRatio: 3 / 4,
    backgroundColor: colors.surface,
  },
  modalHero: {
    width: '100%',
    height: '100%',
  },
  modalMetaBlock: {
    padding: spacing.md,
  },
  detailName: {
    ...typography.heading,
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  detailMeasurements: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  detailCity: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
});

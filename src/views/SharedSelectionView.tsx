/**
 * Open-access view for shared selection links.
 * No login required. Recipient sees only the selection of models sent to them.
 * URL format: ?shared=1&name=...&ids=1,2,3
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { StorageImage } from '../components/StorageImage';
import { colors, spacing, typography } from '../theme/theme';
import { getModelData } from '../services/apiService';
import { normalizeDocumentspicturesModelImageRef } from '../utils/normalizeModelPortfolioUrl';

type SharedModel = {
  id: string;
  name: string;
  measurements: { height: number; chest: number; waist: number; hips: number };
  coverUrl: string;
};

type SharedSelectionViewProps = {
  shareName: string;
  modelIds: string[];
};

export const SharedSelectionView: React.FC<SharedSelectionViewProps> = ({
  shareName,
  modelIds,
}) => {
  const [models, setModels] = useState<SharedModel[]>([]);
  const [loading, setLoading] = useState(true);
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
          .map((m: any) => ({
            id: m.id,
            name: m.name,
            measurements: m.measurements || { height: 0, chest: 0, waist: 0, hips: 0 },
            coverUrl: normalizeDocumentspicturesModelImageRef(
              m.portfolio?.images?.[0] || m.portfolio?.polaroids?.[0] || '',
              m.id,
            ),
          }));
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
        <Text style={styles.title}>Shared selection</Text>
        <Text style={styles.subtitle}>{shareName}</Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <Text style={styles.metaText}>Loading…</Text>
        </View>
      ) : models.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.metaText}>No models in this selection.</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
        >
          {models.map((m) => (
            <View key={m.id} style={styles.card}>
              <View style={styles.cardImageWrap}>
                <StorageImage
                  uri={m.coverUrl}
                  style={styles.cardImage}
                  resizeMode="contain"
                />
                <View style={styles.cardOverlay}>
                  <Text style={styles.cardName}>{m.name}</Text>
                  <Text style={styles.cardMeasurements}>
                    Height {m.measurements.height} cm · Chest {m.measurements.chest} cm · Waist {m.measurements.waist} cm · Hips {m.measurements.hips} cm
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
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
    padding: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  card: {
    marginBottom: spacing.md,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardImageWrap: {
    height: 320,
    position: 'relative',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#D0CEC7',
  },
  cardOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: 'transparent',
  },
  cardName: {
    ...typography.heading,
    fontSize: 18,
    color: 'rgba(255,255,255,0.95)',
    marginBottom: 4,
  },
  cardMeasurements: {
    ...typography.label,
    fontSize: 11,
    letterSpacing: 1.2,
    color: 'rgba(255,255,255,0.85)',
  },
});

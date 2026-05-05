/**
 * PublicModelDetailScreen — Phase 3A.1 / Step 3
 *
 * Publicly accessible, read-only model portfolio page.
 * Route: /agency/:agencySlug/model/:modelId
 *
 * No auth required. Data sources:
 *   - model_photos table  (anon SELECT: is_visible_to_clients=true, photo_type='portfolio')
 *   - get_public_agency_profile RPC (agency display name + agencyId for name lookup)
 *   - get_public_agency_models RPC  (model display name via roster lookup)
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { StorageImage } from '../components/StorageImage';
import {
  getPublicAgencyProfile,
  getPublicAgencyModels,
  getPublicModelPhotos,
  type PublicModelPhoto,
} from '../services/publicAgencyProfileSupabase';

// ─── Types ─────────────────────────────────────────────────────────────────

type PhotoLoadState = 'loading' | 'ready' | 'empty' | 'error';

export interface PublicModelDetailScreenProps {
  agencySlug: string;
  modelId: string;
  onBack: () => void;
}

const GRID_GAP = 1;

// ─── Screen ────────────────────────────────────────────────────────────────

export function PublicModelDetailScreen({
  agencySlug,
  modelId,
  onBack,
}: PublicModelDetailScreenProps): React.ReactElement {
  const [photoState, setPhotoState] = useState<PhotoLoadState>('loading');
  const [photos, setPhotos] = useState<PublicModelPhoto[]>([]);
  const [modelName, setModelName] = useState<string | null>(null);
  const [agencyName, setAgencyName] = useState<string | null>(null);

  const { width } = useWindowDimensions();
  const cols = width >= 900 ? 3 : 2;
  const cellWidth = (width - GRID_GAP * (cols - 1)) / cols;
  const cellHeight = cellWidth * 1.35;
  const heroHeight = Math.min(width * 1.35, 720);

  // ── Data loading ──────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setPhotoState('loading');
    setPhotos([]);
    setModelName(null);
    setAgencyName(null);

    async function loadPhotos() {
      try {
        const result = await getPublicModelPhotos(modelId);
        if (cancelled) return;
        setPhotos(result);
        setPhotoState(result.length === 0 ? 'empty' : 'ready');
      } catch {
        if (!cancelled) setPhotoState('error');
      }
    }

    async function loadAgencyAndName() {
      try {
        const profile = await getPublicAgencyProfile(agencySlug);
        if (!profile || cancelled) return;
        if (!cancelled) setAgencyName(profile.name);
        const models = await getPublicAgencyModels(profile.agency_id);
        if (cancelled) return;
        const found = models.find((m) => m.id === modelId);
        setModelName(found?.name ?? null);
      } catch {
        // model name is display-only — silent fail leaves name as null
      }
    }

    void loadPhotos();
    void loadAgencyAndName();

    return () => {
      cancelled = true;
    };
  }, [modelId, agencySlug]);

  // ── Render helpers ────────────────────────────────────────────────────────

  const heroPhoto = photos[0] ?? null;
  const gridPhotos = photos.length > 1 ? photos.slice(1) : [];

  const renderHeader = useCallback(
    () => (
      <>
        {heroPhoto && (
          <StorageImage
            uri={heroPhoto.url}
            style={[
              { width, height: heroHeight },
              // @ts-ignore — web-only: anchor crop at face
              Platform.OS === 'web' ? { objectPosition: 'top center' } : undefined,
            ]}
            resizeMode="cover"
          />
        )}
        <View style={s.nameBlock}>
          {modelName !== null ? <Text style={s.modelName}>{modelName.toUpperCase()}</Text> : null}
        </View>
        {gridPhotos.length > 0 && <View style={s.divider} />}
      </>
    ),
    [heroPhoto, modelName, gridPhotos.length, width, heroHeight],
  );

  const renderPhoto = useCallback(
    ({ item }: ListRenderItemInfo<PublicModelPhoto>) => (
      <StorageImage
        uri={item.url}
        style={[
          { width: cellWidth, height: cellHeight },
          // @ts-ignore — web-only
          Platform.OS === 'web' ? { objectPosition: 'top center' } : undefined,
        ]}
        resizeMode="cover"
      />
    ),
    [cellWidth, cellHeight],
  );

  const keyExtractor = useCallback((item: PublicModelPhoto) => item.id, []);

  const itemSeparator = useCallback(() => <View style={{ height: GRID_GAP }} />, []);

  // ── Layout ────────────────────────────────────────────────────────────────

  return (
    <View style={s.root}>
      {/* Fixed back bar — always visible, does not scroll */}
      <View style={s.backBar}>
        <TouchableOpacity
          onPress={onBack}
          style={s.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back to agency"
        >
          <Text style={s.backBtnText}>{'← ' + (agencyName ?? agencySlug)}</Text>
        </TouchableOpacity>
      </View>

      {/* Loading */}
      {photoState === 'loading' && (
        <View style={s.centeredState}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      )}

      {/* Error */}
      {photoState === 'error' && (
        <View style={s.centeredState}>
          <Text style={s.stateText}>Something went wrong.</Text>
        </View>
      )}

      {/* Empty */}
      {photoState === 'empty' && (
        <View style={s.centeredState}>
          <Text style={s.stateText}>No portfolio photos available.</Text>
        </View>
      )}

      {/* Ready */}
      {photoState === 'ready' && (
        <FlatList
          key={`grid-${cols}`}
          data={gridPhotos}
          numColumns={cols}
          renderItem={renderPhoto}
          keyExtractor={keyExtractor}
          ListHeaderComponent={renderHeader}
          columnWrapperStyle={cols > 1 ? { gap: GRID_GAP } : undefined}
          ItemSeparatorComponent={itemSeparator}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: spacing.xl ?? 40 }}
        />
      )}
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  backBar: {
    height: 48,
    paddingHorizontal: 20,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  backBtn: {
    alignSelf: 'flex-start',
  },
  backBtnText: {
    ...typography.label,
    color: colors.textSecondary,
    textTransform: undefined,
  },
  nameBlock: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  modelName: {
    ...typography.heading,
    fontSize: 22,
    letterSpacing: 3,
    color: colors.textPrimary,
  },
  divider: {
    height: GRID_GAP,
    backgroundColor: colors.border,
    marginBottom: GRID_GAP,
  },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateText: {
    ...typography.label,
    color: colors.textSecondary,
  },
});

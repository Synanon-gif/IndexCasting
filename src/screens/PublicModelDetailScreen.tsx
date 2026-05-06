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
  getPublicModelProfile,
  type PublicModelPhoto,
  type PublicModelProfile,
} from '../services/publicAgencyProfileSupabase';
import { resolveStorageUrlsBatch } from '../storage/storageUrl';

// ─── Types ─────────────────────────────────────────────────────────────────

type PhotoLoadState = 'loading' | 'ready' | 'empty' | 'error';

export interface PublicModelDetailScreenProps {
  agencySlug: string;
  modelId: string;
  onBack: () => void;
}

const GRID_GAP = 1;

// Renders one label/value stat row in the detail page stats block.
function StatDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={sd.statRow}>
      <Text style={sd.statLabel}>{label}</Text>
      <Text style={sd.statValue}>{value}</Text>
    </View>
  );
}

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
  const [profile, setProfile] = useState<PublicModelProfile | null>(null);

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
    setProfile(null);

    async function loadPhotos() {
      try {
        const result = await getPublicModelPhotos(modelId);
        if (cancelled) return;

        // Pre-warm signed-URL cache for all photos in one batch POST.
        const photoUrls = result.map((p) => p.url).filter(Boolean);
        if (photoUrls.length > 0) {
          await resolveStorageUrlsBatch(photoUrls);
        }
        if (cancelled) return;

        setPhotos(result);
        setPhotoState(result.length === 0 ? 'empty' : 'ready');
      } catch {
        if (!cancelled) setPhotoState('error');
      }
    }

    async function loadAgencyAndName() {
      try {
        const agencyProfile = await getPublicAgencyProfile(agencySlug);
        if (!agencyProfile || cancelled) return;
        if (!cancelled) setAgencyName(agencyProfile.name);
        const [models, modelProfile] = await Promise.all([
          getPublicAgencyModels(agencyProfile.agency_id),
          getPublicModelProfile(agencySlug, modelId),
        ]);
        if (cancelled) return;
        const found = models.find((m) => m.id === modelId);
        setModelName(found?.name ?? null);
        setProfile(modelProfile);
      } catch {
        // display-only — silent fail leaves name/profile as null
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

  const renderHeader = useCallback(() => {
    const bust = profile?.sex === 'male' ? profile?.chest : (profile?.bust ?? profile?.chest);
    const bustLabel = profile?.sex === 'male' ? 'CHEST' : 'BUST';
    return (
      <>
        {heroPhoto && (
          <View style={[s.heroContainer, { height: heroHeight }]}>
            <StorageImage
              uri={heroPhoto.url}
              style={StyleSheet.absoluteFill}
              resizeMode="contain"
            />
          </View>
        )}
        <View style={s.nameBlock}>
          {modelName !== null ? <Text style={s.modelName}>{modelName.toUpperCase()}</Text> : null}
          {profile && (
            <View style={s.statsBlock}>
              {profile.height ? (
                <StatDetailRow label="HEIGHT" value={`${profile.height} cm`} />
              ) : null}
              {bust ? <StatDetailRow label={bustLabel} value={`${bust} cm`} /> : null}
              {profile.waist ? <StatDetailRow label="WAIST" value={`${profile.waist} cm`} /> : null}
              {profile.hips ? <StatDetailRow label="HIPS" value={`${profile.hips} cm`} /> : null}
              {profile.legs_inseam ? (
                <StatDetailRow label="INSEAM" value={`${profile.legs_inseam} cm`} />
              ) : null}
              {profile.shoe_size ? (
                <StatDetailRow label="SHOES" value={String(profile.shoe_size)} />
              ) : null}
              {profile.hair_color ? (
                <StatDetailRow label="HAIR" value={profile.hair_color} />
              ) : null}
              {profile.eye_color ? <StatDetailRow label="EYES" value={profile.eye_color} /> : null}
              {profile.city || profile.country ? (
                <StatDetailRow
                  label="BASED"
                  value={[profile.city, profile.country].filter(Boolean).join(', ')}
                />
              ) : null}
              {profile.mother_agency_name ? (
                <StatDetailRow label="MOTHER" value={profile.mother_agency_name} />
              ) : null}
            </View>
          )}
        </View>
        {gridPhotos.length > 0 && <View style={s.divider} />}
      </>
    );
  }, [heroPhoto, modelName, profile, gridPhotos.length, heroHeight]);

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
  heroContainer: {
    width: '100%',
    backgroundColor: '#111',
    overflow: 'hidden',
  },
  nameBlock: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 20,
  },
  modelName: {
    ...typography.heading,
    fontSize: 22,
    letterSpacing: 3,
    color: colors.textPrimary,
    marginBottom: 16,
  },
  statsBlock: {
    gap: 6,
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

// Styles for StatDetailRow (separate sheet keeps s clean)
const sd = StyleSheet.create({
  statRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  statLabel: {
    ...typography.label,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.textSecondary,
    width: 64,
    textTransform: 'uppercase',
  },
  statValue: {
    ...typography.body,
    fontSize: 13,
    color: colors.textPrimary,
    flex: 1,
  },
});

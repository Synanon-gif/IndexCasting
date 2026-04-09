/**
 * PublicAgencyProfileScreen — Phase 3A.1
 *
 * Publicly accessible, read-only agency profile page.
 * No login required. No dashboard chrome. No authenticated UI elements.
 *
 * Route: /agency/:slug
 *
 * Shows:
 *  - Logo, agency name, description, address, website
 *  - Women / Men segmented model roster
 *  - 3-column alphabetical grid (cover image + name)
 *
 * States:
 *  - loading   — data fetch in progress
 *  - not-found — slug not found OR is_public = false OR type ≠ 'agency'
 *  - empty     — profile found but no models in the selected segment
 *  - error     — unexpected failure
 *
 * Security: All data comes from SECURITY DEFINER RPCs that enforce
 *   is_public=true AND organizations.type='agency'. No internal data exposed.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  type PublicAgencyProfile,
  type PublicAgencyModel,
} from '../services/publicAgencyProfileSupabase';

// ─── Types ─────────────────────────────────────────────────────────────────

type Segment = 'women' | 'men';
type LoadState = 'loading' | 'not-found' | 'ready' | 'error';

export interface PublicAgencyProfileScreenProps {
  slug: string;
  onClose?: () => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function filterAndSortPublicModels(
  models: PublicAgencyModel[],
  segment: Segment,
): PublicAgencyModel[] {
  return models
    .filter((m) => (segment === 'women' ? m.sex === 'female' : m.sex === 'male'))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Screen ───────────────────────────────────────────────────────────────

const LOGO_SIZE = 80;

export function PublicAgencyProfileScreen({
  slug,
  onClose,
}: PublicAgencyProfileScreenProps): React.ReactElement {
  const [state, setState] = useState<LoadState>('loading');
  const [profile, setProfile] = useState<PublicAgencyProfile | null>(null);
  const [models, setModels] = useState<PublicAgencyModel[]>([]);
  const [segment, setSegment] = useState<Segment>('women');

  const { width } = useWindowDimensions();
  // 3-column grid — mirror internal screen layout
  const CELL_GAP = spacing.xs;
  const H_PAD = spacing.md * 2;
  const cellWidth = Math.floor((width - H_PAD - CELL_GAP * 2) / 3);
  const cellHeight = Math.floor(cellWidth * 1.35);

  // ── Data loading ──

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState('loading');
      try {
        const prof = await getPublicAgencyProfile(slug);
        if (cancelled) return;

        if (!prof) {
          setState('not-found');
          return;
        }

        setProfile(prof);

        const mods = await getPublicAgencyModels(prof.agency_id);
        if (cancelled) return;

        setModels(mods);
        setState('ready');
      } catch (e) {
        console.error('[PublicAgencyProfileScreen] load error:', e);
        if (!cancelled) setState('error');
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [slug]);

  // ── Filtered model list ──

  const filteredModels = useMemo(
    () => filterAndSortPublicModels(models, segment),
    [models, segment],
  );

  // ── Render helpers ──

  const renderModel = useCallback(
    ({ item }: ListRenderItemInfo<PublicAgencyModel>) => (
      <View style={[s.cell, { width: cellWidth }]}>
        {item.cover_url ? (
          <StorageImage
            uri={item.cover_url}
            style={{ width: cellWidth, height: cellHeight, borderRadius: 4 }}
            resizeMode="cover"
          />
        ) : (
          <View
            style={[
              s.cellPlaceholder,
              { width: cellWidth, height: cellHeight, borderRadius: 4 },
            ]}
          >
            <Text style={s.cellInitial}>{item.name.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <Text style={s.cellName} numberOfLines={1}>
          {item.name}
        </Text>
      </View>
    ),
    [cellWidth, cellHeight],
  );

  const renderHeader = useCallback(() => {
    if (!profile) return null;

    const addrParts = [
      profile.address_line_1,
      profile.city,
      profile.postal_code,
      profile.country,
    ].filter(Boolean);
    const addr = addrParts.join(', ');

    return (
      <View>
        {/* ── Back / close ── */}
        {onClose && (
          <TouchableOpacity
            style={s.closeBtn}
            onPress={onClose}
            accessibilityLabel="Back"
            accessibilityRole="button"
          >
            <Text style={s.closeBtnText}>← Back</Text>
          </TouchableOpacity>
        )}

        {/* ── Profile header ── */}
        <View style={s.headerSection}>
          {/* Logo */}
          <View style={s.logoWrap}>
            {profile.logo_url ? (
              <StorageImage
                uri={profile.logo_url}
                style={s.logo}
                resizeMode="cover"
              />
            ) : (
              <View style={[s.logo, s.logoPlaceholder]}>
                <Text style={s.logoInitial}>
                  {profile.name.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          <Text style={s.orgName}>{profile.name}</Text>

          {profile.description ? (
            <Text style={s.description}>{profile.description}</Text>
          ) : null}

          {addr ? <Text style={s.meta}>{addr}</Text> : null}

          {profile.website_url ? (
            Platform.OS === 'web' ? (
              // @ts-ignore — anchor element web-only
              <a
                href={
                  profile.website_url.startsWith('http')
                    ? profile.website_url
                    : `https://${profile.website_url}`
                }
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'none' }}
              >
                <Text style={[s.meta, s.link]}>{profile.website_url}</Text>
              </a>
            ) : (
              <Text style={s.meta}>{profile.website_url}</Text>
            )
          ) : null}
        </View>

        {/* ── Segment bar ── */}
        <View style={s.segmentBar}>
          {(['women', 'men'] as Segment[]).map((seg) => (
            <TouchableOpacity
              key={seg}
              onPress={() => setSegment(seg)}
              style={s.segmentItem}
              accessibilityRole="tab"
              accessibilityState={{ selected: segment === seg }}
            >
              <Text
                style={[s.segmentLabel, segment === seg && s.segmentLabelActive]}
              >
                {seg === 'women' ? 'Women' : 'Men'}
              </Text>
              {segment === seg && <View style={s.segmentUnderline} />}
            </TouchableOpacity>
          ))}
        </View>

        {/* Empty segment state */}
        {filteredModels.length === 0 && (
          <View style={s.emptyState}>
            <Text style={s.emptyText}>
              No {segment === 'women' ? 'women' : 'men'} models listed yet.
            </Text>
          </View>
        )}
      </View>
    );
  }, [profile, segment, filteredModels.length, onClose]);

  // ── State: loading ──

  if (state === 'loading') {
    return (
      <View style={s.centered}>
        <ActivityIndicator color={colors.textPrimary} size="large" />
      </View>
    );
  }

  // ── State: not-found / error ──

  if (state === 'not-found' || state === 'error') {
    return (
      <View style={s.centered}>
        {onClose && (
          <TouchableOpacity
            style={s.closeBtnAlt}
            onPress={onClose}
            accessibilityRole="button"
          >
            <Text style={s.closeBtnText}>← Back</Text>
          </TouchableOpacity>
        )}
        <Text style={s.notFoundTitle}>Profile not found</Text>
        <Text style={s.notFoundBody}>
          This agency profile is not available or does not exist.
        </Text>
      </View>
    );
  }

  // ── State: ready ──

  return (
    <View style={s.shell}>
      <FlatList<PublicAgencyModel>
        key={segment}
        data={filteredModels}
        numColumns={3}
        keyExtractor={(item) => item.id}
        renderItem={renderModel}
        ListHeaderComponent={renderHeader}
        columnWrapperStyle={filteredModels.length > 0 ? s.row : undefined}
        contentContainerStyle={s.listContent}
        style={s.list}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        initialNumToRender={9}
        maxToRenderPerBatch={9}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: 120,
  },

  // ── Loading / not-found ──
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  notFoundTitle: {
    ...typography.heading,
    fontSize: 18,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  notFoundBody: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  // ── Close / back ──
  closeBtn: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    alignSelf: 'flex-start',
  },
  closeBtnAlt: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.md,
  },
  closeBtnText: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
  },

  // ── Header ──
  headerSection: {
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.md,
  },
  logoWrap: {
    marginBottom: spacing.sm,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: LOGO_SIZE / 2,
    overflow: 'hidden',
  },
  logoPlaceholder: {
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoInitial: {
    ...typography.heading,
    fontSize: 28,
    color: colors.textSecondary,
  },
  orgName: {
    ...typography.heading,
    fontSize: 20,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  description: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  meta: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  link: {
    color: colors.accent,
    textDecorationLine: 'underline',
  },

  // ── Segment bar ──
  segmentBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.sm,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    position: 'relative',
  },
  segmentLabel: {
    ...typography.label,
    fontSize: 13,
    color: colors.textSecondary,
  },
  segmentLabelActive: {
    color: colors.textPrimary,
  },
  segmentUnderline: {
    position: 'absolute',
    bottom: 0,
    left: '20%',
    right: '20%',
    height: 2,
    backgroundColor: colors.textPrimary,
    borderRadius: 1,
  },

  // ── Grid ──
  row: {
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  cell: {
    alignItems: 'center',
  },
  cellPlaceholder: {
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellInitial: {
    fontSize: 22,
    color: colors.textSecondary,
  },
  cellName: {
    ...typography.body,
    fontSize: 11,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 2,
  },

  // ── Empty segment ──
  emptyState: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

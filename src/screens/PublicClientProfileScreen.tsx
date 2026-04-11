/**
 * PublicClientProfileScreen — Phase 3B.1
 *
 * Publicly accessible, read-only client profile page.
 * No login required. No dashboard chrome. No authenticated UI elements.
 *
 * Route: /client/:slug
 *
 * Shows:
 *  - Logo, client name, description, address, website
 *  - 3-column gallery grid (client_gallery images)
 *
 * States:
 *  - loading   — data fetch in progress
 *  - not-found — slug not found OR is_public = false OR type ≠ 'client'
 *  - ready     — profile and gallery loaded
 *  - error     — unexpected failure
 *
 * Security: All data comes from SECURITY DEFINER RPCs that enforce
 *   is_public=true AND organizations.type='client'. No internal data exposed.
 *
 * Mirrors PublicAgencyProfileScreen (Phase 3A.1) — without the Women/Men
 * segment bar (clients have a gallery, not a model roster).
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
  getPublicClientProfile,
  getPublicClientGallery,
  type PublicClientProfile,
  type PublicClientGalleryItem,
} from '../services/publicClientProfileSupabase';

// ─── Types ─────────────────────────────────────────────────────────────────

type LoadState = 'loading' | 'not-found' | 'ready' | 'error';

export interface PublicClientProfileScreenProps {
  slug: string;
  onClose?: () => void;
}

// ─── Screen ───────────────────────────────────────────────────────────────

const LOGO_SIZE = 80;

export function PublicClientProfileScreen({
  slug,
  onClose,
}: PublicClientProfileScreenProps): React.ReactElement {
  const [state, setState] = useState<LoadState>('loading');
  const [profile, setProfile] = useState<PublicClientProfile | null>(null);
  const [gallery, setGallery] = useState<PublicClientGalleryItem[]>([]);

  const { width } = useWindowDimensions();
  const CELL_GAP = spacing.xs;
  const H_PAD = spacing.md * 2;
  const cellWidth = Math.floor((width - H_PAD - CELL_GAP * 2) / 3);
  const cellHeight = Math.floor(cellWidth * 1.2);

  // ── Data loading ──

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState('loading');
      try {
        const prof = await getPublicClientProfile(slug);
        if (cancelled) return;

        if (!prof) {
          setState('not-found');
          return;
        }

        setProfile(prof);

        const items = await getPublicClientGallery(prof.organization_id);
        if (cancelled) return;

        setGallery(items);
        setState('ready');
      } catch (e) {
        console.error('[PublicClientProfileScreen] load error:', e);
        if (!cancelled) setState('error');
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [slug]);

  // ── Render helpers ──

  const renderGalleryItem = useCallback(
    ({ item }: ListRenderItemInfo<PublicClientGalleryItem>) => (
      <View style={[s.cell, { width: cellWidth }]}>
        <StorageImage
          uri={item.image_url}
          style={{ width: cellWidth, height: cellHeight, borderRadius: 4 }}
          resizeMode="cover"
        />
        {item.title ? (
          <Text style={s.cellName} numberOfLines={1}>
            {item.title}
          </Text>
        ) : null}
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

        {/* ── Gallery section label ── */}
        {gallery.length > 0 ? (
          <View style={s.gallerySectionHeader}>
            <Text style={s.gallerySectionTitle}>Gallery</Text>
          </View>
        ) : null}

        {/* ── Empty gallery state ── */}
        {gallery.length === 0 && (
          <View style={s.emptyState}>
            <Text style={s.emptyText}>No gallery images yet.</Text>
          </View>
        )}
      </View>
    );
  }, [profile, gallery.length, onClose]);

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
          This client profile is not available or does not exist.
        </Text>
      </View>
    );
  }

  // ── State: ready ──

  return (
    <View style={s.shell}>
      <FlatList<PublicClientGalleryItem>
        data={gallery}
        numColumns={3}
        keyExtractor={(item) => item.id}
        renderItem={renderGalleryItem}
        ListHeaderComponent={renderHeader}
        columnWrapperStyle={gallery.length > 0 ? s.row : undefined}
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
    padding: spacing.md,
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

  // ── Gallery section ──
  gallerySectionHeader: {
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.xs,
  },
  gallerySectionTitle: {
    ...typography.label,
    fontSize: 12,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  // ── Grid ──
  row: {
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  cell: {
    alignItems: 'center',
  },
  cellName: {
    ...typography.body,
    fontSize: 11,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 2,
  },

  // ── Empty gallery ──
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

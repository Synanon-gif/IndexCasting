/**
 * PublicAgencyProfileScreen — Phase 3A.1 / Phase 2 visual upgrade
 *
 * Publicly accessible, read-only agency profile page.
 * No login required. No dashboard chrome. No authenticated UI elements.
 *
 * Route: /agency/:slug
 *
 * Shows:
 *  - Hero: logo, agency name, description, address, website
 *  - Women / Men editorial tabs
 *  - Responsive model grid (2 / 3 / 4 columns) with cover images + name overlay
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
import { isMobileWidth, isDesktopWidth } from '../theme/breakpoints';
import { appUrl } from '../config/env';
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

// ─── SEO helpers (web-only, no-ops on native) ──────────────────────────────

function upsertMetaTag(attr: 'name' | 'property', key: string, content: string): void {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLinkTag(rel: string, href: string): void {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
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

// ─── Constants ─────────────────────────────────────────────────────────────

const LOGO_SIZE = 140;
const MAX_CONTENT_W = 1280;
const GRID_GAP = spacing.xs;

// ─── Screen ────────────────────────────────────────────────────────────────

export function PublicAgencyProfileScreen({
  slug,
  onClose,
}: PublicAgencyProfileScreenProps): React.ReactElement {
  const [state, setState] = useState<LoadState>('loading');
  const [profile, setProfile] = useState<PublicAgencyProfile | null>(null);
  const [models, setModels] = useState<PublicAgencyModel[]>([]);
  const [segment, setSegment] = useState<Segment>('women');

  const { width } = useWindowDimensions();

  const numCols = isMobileWidth(width) ? 2 : isDesktopWidth(width) ? 4 : 3;
  const H_PAD = isMobileWidth(width) ? spacing.md : spacing.lg;
  const contentW = Math.min(width, MAX_CONTENT_W);
  const cellWidth = Math.floor((contentW - H_PAD * 2 - GRID_GAP * (numCols - 1)) / numCols);
  const cellHeight = Math.floor(cellWidth * 1.42);

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
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // ── SEO meta tags ──

  useEffect(() => {
    if (!profile || Platform.OS !== 'web') return;

    const prevTitle = typeof document !== 'undefined' ? document.title : '';
    const pageTitle = `${profile.name} — IndexCasting`;
    const desc = profile.description?.trim() || `${profile.name} on IndexCasting`;
    const pageUrl = `${appUrl}/agency/${slug}`;
    const ogImage =
      profile.logo_url && profile.logo_url.startsWith('https://') ? profile.logo_url : '';

    if (typeof document !== 'undefined') {
      document.title = pageTitle;
    }
    upsertMetaTag('property', 'og:title', pageTitle);
    upsertMetaTag('property', 'og:site_name', 'IndexCasting');
    upsertMetaTag('property', 'og:type', 'website');
    upsertMetaTag('property', 'og:url', pageUrl);
    upsertMetaTag('property', 'og:description', desc);
    if (ogImage) upsertMetaTag('property', 'og:image', ogImage);
    upsertMetaTag('name', 'description', desc);
    upsertLinkTag('canonical', pageUrl);

    return () => {
      if (typeof document !== 'undefined') {
        document.title = prevTitle;
      }
    };
  }, [profile, slug]);

  // ── Filtered model list ──

  const filteredModels = useMemo(
    () => filterAndSortPublicModels(models, segment),
    [models, segment],
  );

  // ── Render helpers ──

  const renderModel = useCallback(
    ({ item }: ListRenderItemInfo<PublicAgencyModel>) => (
      <View style={[s.cell, { width: cellWidth, height: cellHeight }]}>
        {item.cover_url ? (
          <StorageImage uri={item.cover_url} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, s.cellPlaceholder]}>
            <Text style={s.cellInitial}>{item.name.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        {/* Name overlay */}
        <View style={s.cellOverlay}>
          <Text style={s.cellName} numberOfLines={1}>
            {item.name}
          </Text>
        </View>
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

        {/* ── Hero section ── */}
        <View style={s.heroSection}>
          {/* Logo */}
          <View style={s.logoWrap}>
            {profile.logo_url ? (
              <StorageImage uri={profile.logo_url} style={s.logo} resizeMode="cover" />
            ) : (
              <View style={[s.logo, s.logoPlaceholder]}>
                <Text style={s.logoInitial}>{profile.name.charAt(0).toUpperCase()}</Text>
              </View>
            )}
          </View>

          <Text style={s.agencyName}>{profile.name.toUpperCase()}</Text>

          <View style={s.heroDivider} />

          {profile.description ? <Text style={s.description}>{profile.description}</Text> : null}

          {/* Meta row */}
          {addr || profile.website_url ? (
            <View style={s.metaRow}>
              {addr ? <Text style={s.metaText}>{addr}</Text> : null}
              {addr && profile.website_url ? <Text style={s.metaSep}>·</Text> : null}
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
                    <Text style={[s.metaText, s.link]}>{profile.website_url}</Text>
                  </a>
                ) : (
                  <Text style={s.metaText}>{profile.website_url}</Text>
                )
              ) : null}
            </View>
          ) : null}
        </View>

        {/* ── Editorial segment tabs ── */}
        <View style={s.segmentBar}>
          {(['women', 'men'] as Segment[]).map((seg) => (
            <TouchableOpacity
              key={seg}
              onPress={() => setSegment(seg)}
              style={[s.segmentTab, segment === seg && s.segmentTabActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: segment === seg }}
            >
              <Text style={[s.segmentLabel, segment === seg && s.segmentLabelActive]}>
                {seg === 'women' ? 'Women' : 'Men'}
              </Text>
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
        <Text style={s.brandmark}>INDEX CASTING</Text>
        <View style={s.brandDivider} />
        <ActivityIndicator color={colors.textSecondary} size="small" />
      </View>
    );
  }

  // ── State: not-found / error ──

  if (state === 'not-found' || state === 'error') {
    return (
      <View style={s.centered}>
        {onClose && (
          <TouchableOpacity style={s.closeBtnAlt} onPress={onClose} accessibilityRole="button">
            <Text style={s.closeBtnText}>← Back</Text>
          </TouchableOpacity>
        )}
        <Text style={s.brandmark}>INDEX CASTING</Text>
        <View style={s.brandDivider} />
        <Text style={s.notFoundTitle}>Profile not found</Text>
        <Text style={s.notFoundBody}>This agency profile is not available or does not exist.</Text>
      </View>
    );
  }

  // ── State: ready ──

  return (
    <View style={s.shell}>
      <FlatList<PublicAgencyModel>
        key={`${segment}-${numCols}`}
        data={filteredModels}
        numColumns={numCols}
        keyExtractor={(item) => item.id}
        renderItem={renderModel}
        ListHeaderComponent={renderHeader}
        columnWrapperStyle={
          filteredModels.length > 0 ? { gap: GRID_GAP, marginBottom: GRID_GAP } : undefined
        }
        contentContainerStyle={[
          s.listContent,
          { paddingHorizontal: H_PAD, maxWidth: MAX_CONTENT_W, alignSelf: 'center', width: '100%' },
        ]}
        style={s.list}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        initialNumToRender={numCols * 3}
        maxToRenderPerBatch={numCols * 3}
      />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

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
  brandmark: {
    ...typography.label,
    fontSize: 11,
    letterSpacing: 4,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  brandDivider: {
    width: 32,
    height: 1,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  notFoundTitle: {
    ...typography.heading,
    fontSize: 16,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  notFoundBody: {
    ...typography.body,
    fontSize: 13,
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
    fontSize: 13,
    color: colors.textSecondary,
  },

  // ── Hero ──
  heroSection: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginBottom: spacing.md,
  },
  logoWrap: {
    marginBottom: spacing.md,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: 6,
    overflow: 'hidden',
  },
  logoPlaceholder: {
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoInitial: {
    ...typography.heading,
    fontSize: 42,
    color: colors.textSecondary,
  },
  agencyName: {
    ...typography.heading,
    fontSize: 26,
    letterSpacing: 3.5,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  heroDivider: {
    width: 40,
    height: 1,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  description: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 520,
    marginBottom: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  metaText: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
  },
  metaSep: {
    ...typography.body,
    fontSize: 12,
    color: colors.border,
  },
  link: {
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },

  // ── Segment tabs ──
  segmentBar: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginBottom: spacing.md,
  },
  segmentTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  segmentTabActive: {
    borderBottomColor: colors.textPrimary,
  },
  segmentLabel: {
    ...typography.label,
    fontSize: 12,
    letterSpacing: 1.5,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  segmentLabelActive: {
    color: colors.textPrimary,
  },

  // ── Grid ──
  cell: {
    overflow: 'hidden',
    borderRadius: 3,
    backgroundColor: colors.border,
    position: 'relative',
  },
  cellPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellInitial: {
    fontSize: 28,
    color: colors.textSecondary,
  },
  cellOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 6,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  cellName: {
    ...typography.body,
    fontSize: 10,
    letterSpacing: 0.8,
    color: '#ffffff',
    textAlign: 'center',
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

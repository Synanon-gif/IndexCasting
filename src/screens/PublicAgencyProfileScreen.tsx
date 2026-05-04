/**
 * PublicAgencyProfileScreen — Phase 3A.1 / Phase 2.1 (IMG-style roster)
 *
 * Publicly accessible, read-only agency profile page.
 * No login required. No dashboard chrome. No authenticated UI elements.
 *
 * Route: /agency/:slug
 *
 * Shows:
 *  - Compact agency masthead: logo, name, meta, description
 *  - Women / Men / All tabs with model counts
 *  - Dense responsive model grid (2 / 3 / 5 / 6 columns)
 *  - Per-card name strip (always visible); web hover overlay with name + category
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
import { isMobileWidth } from '../theme/breakpoints';
import { appUrl } from '../config/env';
import {
  getPublicAgencyProfile,
  getPublicAgencyModels,
  type PublicAgencyProfile,
  type PublicAgencyModel,
} from '../services/publicAgencyProfileSupabase';

// ─── Types ─────────────────────────────────────────────────────────────────

type Segment = 'women' | 'men' | 'all';
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
  const filtered =
    segment === 'all'
      ? models
      : models.filter((m) => (segment === 'women' ? m.sex === 'female' : m.sex === 'male'));
  return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Constants ─────────────────────────────────────────────────────────────

const LOGO_SIZE = 64;
const MAX_CONTENT_W = 1280;
const GRID_GAP = 2;
const NAME_STRIP_H = 28;

// ─── Model card ────────────────────────────────────────────────────────────
// Module-scope component so each card manages its own hover state without
// causing FlatList header remounts when hover state changes.

function ModelCard({
  item,
  cellWidth,
  cellHeight,
}: {
  item: PublicAgencyModel;
  cellWidth: number;
  cellHeight: number;
}) {
  const [hovered, setHovered] = useState(false);
  const categoryLabel = item.sex === 'female' ? 'Women' : item.sex === 'male' ? 'Men' : null;

  return (
    <View style={[s.cell, { width: cellWidth }]}>
      {/* Image area — hover events attach here */}
      <View
        style={{ width: cellWidth, height: cellHeight }}
        // @ts-ignore — React Native Web hover events
        onMouseEnter={Platform.OS === 'web' ? () => setHovered(true) : undefined}
        onMouseLeave={Platform.OS === 'web' ? () => setHovered(false) : undefined}
      >
        {item.cover_url ? (
          <StorageImage uri={item.cover_url} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, s.cellPlaceholder]}>
            <Text style={s.cellInitial}>{item.name.charAt(0).toUpperCase()}</Text>
          </View>
        )}

        {/* Hover overlay — web only, shows name + category centered over image */}
        {hovered && Platform.OS === 'web' && (
          <View style={s.hoverOverlay}>
            <Text style={s.hoverName} numberOfLines={2}>
              {item.name.toUpperCase()}
            </Text>
            {categoryLabel ? (
              <Text style={s.hoverCategory}>{categoryLabel.toUpperCase()}</Text>
            ) : null}
          </View>
        )}
      </View>

      {/* Name strip — always visible below image on all platforms */}
      <View style={s.nameStrip}>
        <Text style={s.nameStripText} numberOfLines={1}>
          {item.name.toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

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

  // 2 / 3 / 5 / 6 columns — editorial density
  const numCols = width <= 768 ? 2 : width < 1024 ? 3 : width < 1440 ? 5 : 6;
  const H_PAD = isMobileWidth(width) ? spacing.md : spacing.lg;
  const contentW = Math.min(width, MAX_CONTENT_W);
  const cellWidth = Math.floor((contentW - H_PAD * 2 - GRID_GAP * (numCols - 1)) / numCols);
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

  // ── Model counts (for tab labels) ──

  const womenCount = useMemo(() => models.filter((m) => m.sex === 'female').length, [models]);
  const menCount = useMemo(() => models.filter((m) => m.sex === 'male').length, [models]);

  // ── Filtered model list ──

  const filteredModels = useMemo(
    () => filterAndSortPublicModels(models, segment),
    [models, segment],
  );

  // ── Render helpers ──

  const renderModel = useCallback(
    ({ item }: ListRenderItemInfo<PublicAgencyModel>) => (
      <ModelCard item={item} cellWidth={cellWidth} cellHeight={cellHeight} />
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

    const tabs: Array<{ seg: Segment; label: string; count: number }> = [
      { seg: 'women', label: 'Women', count: womenCount },
      { seg: 'men', label: 'Men', count: menCount },
      { seg: 'all', label: 'All', count: models.length },
    ];

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

        {/* ── Masthead ── */}
        <View style={s.masthead}>
          <View style={s.mastheadRow}>
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

            {/* Name + meta */}
            <View style={s.mastheadInfo}>
              <Text style={s.agencyName} numberOfLines={2}>
                {profile.name.toUpperCase()}
              </Text>
              {addr || profile.website_url ? (
                <View style={s.metaRow}>
                  {addr ? <Text style={s.metaText}>{addr}</Text> : null}
                  {addr && profile.website_url ? <Text style={s.metaSep}> · </Text> : null}
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
          </View>

          {/* Description — below the logo/name row */}
          {profile.description ? <Text style={s.description}>{profile.description}</Text> : null}
        </View>

        {/* ── Tab navigation: Women / Men / All ── */}
        <View style={s.tabRow}>
          {tabs.map(({ seg, label, count }) => (
            <TouchableOpacity
              key={seg}
              onPress={() => setSegment(seg)}
              style={[s.tab, segment === seg && s.tabActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: segment === seg }}
            >
              <Text style={[s.tabLabel, segment === seg && s.tabLabelActive]}>{label}</Text>
              <Text style={[s.tabCount, segment === seg && s.tabCountActive]}>{count}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Empty segment state */}
        {filteredModels.length === 0 && (
          <View style={s.emptyState}>
            <Text style={s.emptyText}>
              {segment === 'all' ? 'No models listed yet.' : `No ${segment} models listed yet.`}
            </Text>
          </View>
        )}
      </View>
    );
  }, [profile, segment, filteredModels.length, onClose, womenCount, menCount, models.length]);

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
          {
            paddingHorizontal: H_PAD,
            maxWidth: MAX_CONTENT_W,
            alignSelf: 'center',
            width: '100%',
          },
        ]}
        style={s.list}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        initialNumToRender={numCols * 4}
        maxToRenderPerBatch={numCols * 4}
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
    paddingTop: spacing.sm,
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

  // ── Masthead ──
  masthead: {
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  mastheadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  logoWrap: {},
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: 4,
    overflow: 'hidden',
  },
  logoPlaceholder: {
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoInitial: {
    ...typography.heading,
    fontSize: 22,
    color: colors.textSecondary,
  },
  mastheadInfo: {
    flex: 1,
  },
  agencyName: {
    ...typography.heading,
    fontSize: 22,
    letterSpacing: 3,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  description: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  metaText: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
  },
  metaSep: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
  },
  link: {
    textDecorationLine: 'underline',
  },

  // ── Tab navigation ──
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  tab: {
    paddingRight: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    alignItems: 'flex-start',
  },
  tabActive: {
    borderBottomColor: colors.textPrimary,
  },
  tabLabel: {
    ...typography.label,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  tabLabelActive: {
    color: colors.textPrimary,
  },
  tabCount: {
    ...typography.body,
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
  },
  tabCountActive: {
    color: colors.textPrimary,
  },

  // ── Grid cells ──
  cell: {
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  cellPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellInitial: {
    fontSize: 24,
    color: colors.textSecondary,
  },

  // Name strip — always visible below the image
  nameStrip: {
    height: NAME_STRIP_H,
    backgroundColor: colors.background,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  nameStripText: {
    ...typography.label,
    fontSize: 9,
    letterSpacing: 0.8,
    color: colors.textPrimary,
    textAlign: 'center',
  },

  // Hover overlay — web only, shown on mouse-enter
  hoverOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.52)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
  },
  hoverName: {
    ...typography.label,
    fontSize: 11,
    letterSpacing: 1,
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 4,
  },
  hoverCategory: {
    ...typography.body,
    fontSize: 10,
    letterSpacing: 1.5,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
    textTransform: 'uppercase',
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

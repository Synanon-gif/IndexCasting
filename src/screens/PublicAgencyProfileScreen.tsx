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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
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
  getPublicModelProfile,
  type PublicAgencyProfile,
  type PublicAgencyModel,
  type PublicModelProfile,
} from '../services/publicAgencyProfileSupabase';
import { navigatePublicPath } from '../utils/publicLegalRoutes';
import { resolveStorageUrlsBatch } from '../storage/storageUrl';

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

const LOGO_SIZE = 72;
const MAX_CONTENT_W = 1280;
const GRID_GAP = 4; // editorial gap between cards
const NAME_STRIP_H = 28;
const SIDE_LABEL_MIN_W = 1100; // viewport width below which vertical label is hidden

// ─── Hover stats cache ─────────────────────────────────────────────────────
// Per page-load, keyed by modelId. Avoids re-fetching on repeated hovers.
const publicModelStatsCache = new Map<string, PublicModelProfile | null>();

// Resolves which stat lines to show in the hover overlay (null values omitted).
function resolveHoverLines(st: PublicModelProfile): Array<{ label: string; value: string }> {
  const lines: Array<{ label: string; value: string }> = [];
  if (st.height) lines.push({ label: 'HEIGHT', value: String(st.height) });
  const bustChest = st.sex === 'male' ? st.chest : (st.bust ?? st.chest);
  const bustLabel = st.sex === 'male' ? 'CHEST' : 'BUST';
  if (bustChest) lines.push({ label: bustLabel, value: String(bustChest) });
  if (st.waist) lines.push({ label: 'WAIST', value: String(st.waist) });
  if (st.hips) lines.push({ label: 'HIPS', value: String(st.hips) });
  if (st.shoe_size) lines.push({ label: 'SHOES', value: String(st.shoe_size) });
  if (st.hair_color) lines.push({ label: 'HAIR', value: st.hair_color });
  if (st.eye_color) lines.push({ label: 'EYES', value: st.eye_color });
  return lines;
}

// ─── Search icon ───────────────────────────────────────────────────────────

function SearchIconView() {
  if (Platform.OS === 'web') {
    return React.createElement(
      'svg',
      {
        xmlns: 'http://www.w3.org/2000/svg',
        width: 18,
        height: 18,
        viewBox: '0 0 18 18',
        fill: 'none',
        stroke: colors.textSecondary,
        strokeWidth: 1.5,
        strokeLinecap: 'round',
      },
      React.createElement('circle', { cx: 7.5, cy: 7.5, r: 5.5 }),
      React.createElement('line', { x1: 11.5, y1: 11.5, x2: 16, y2: 16 }),
    );
  }
  // Native fallback — circle border + diagonal handle
  return (
    <View style={{ width: 18, height: 18 }}>
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 12,
          height: 12,
          borderRadius: 6,
          borderWidth: 1.5,
          borderColor: colors.textSecondary,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 9,
          left: 9,
          width: 1.5,
          height: 7,
          backgroundColor: colors.textSecondary,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

// ─── Model card ────────────────────────────────────────────────────────────
// Module-scope component so each card manages its own hover state without
// causing FlatList header remounts when hover state changes.

function ModelCard({
  item,
  cellWidth,
  cellHeight,
  agencySlug,
}: {
  item: PublicAgencyModel;
  cellWidth: number;
  cellHeight: number;
  agencySlug: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [stats, setStats] = useState<PublicModelProfile | null>(null);

  function handleMouseEnter() {
    setHovered(true);
    if (publicModelStatsCache.has(item.id)) {
      setStats(publicModelStatsCache.get(item.id) ?? null);
      return;
    }
    getPublicModelProfile(agencySlug, item.id).then((result) => {
      publicModelStatsCache.set(item.id, result);
      setStats(result);
    });
  }

  const hoverLines = stats ? resolveHoverLines(stats) : [];

  const cardContent = (
    <>
      {/* Image area */}
      <View style={{ width: cellWidth, height: cellHeight }}>
        {item.cover_url ? (
          <StorageImage
            uri={item.cover_url}
            style={[
              StyleSheet.absoluteFill,
              // @ts-ignore — web-only: anchor image crop at top to keep face in frame
              Platform.OS === 'web' ? { objectPosition: 'top center' } : undefined,
            ]}
            resizeMode="cover"
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, s.cellPlaceholder]}>
            <Text style={s.cellInitial}>{item.name.charAt(0).toUpperCase()}</Text>
          </View>
        )}

        {hovered && hoverLines.length > 0 ? (
          // Stats available — solid dark panel replaces image visually (Elite/IMG style)
          <View style={[s.hoverPanel, { pointerEvents: 'none' }]}>
            <Text style={s.hoverPanelName} numberOfLines={1}>
              {item.name.toUpperCase()}
            </Text>
            <View style={s.hoverDivider} />
            <View style={s.hoverStats}>
              {hoverLines.map(({ label, value }) => (
                <View key={label} style={s.hoverStatRow}>
                  <Text style={s.hoverStatLabel}>{label}</Text>
                  <Text style={s.hoverStatValue}>{value}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : hovered ? (
          // No stats yet — gradient overlay, name only
          <View
            style={[
              s.hoverOverlay,
              { pointerEvents: 'none' },
              // @ts-ignore — web-only gradient; no flat backgroundColor
              { backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 60%)' },
            ]}
          >
            <Text style={s.hoverName} numberOfLines={1}>
              {item.name.toUpperCase()}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Name strip — always visible below image on all platforms */}
      <View style={s.nameStrip}>
        <Text style={s.nameStripText} numberOfLines={1}>
          {item.name.toUpperCase()}
        </Text>
      </View>
    </>
  );

  if (Platform.OS === 'web') {
    return React.createElement(
      'a',
      {
        href: `/agency/${agencySlug}/model/${item.id}`,
        style: {
          ...StyleSheet.flatten([s.cell, { width: cellWidth }]),
          display: 'block',
          textDecoration: 'none',
          color: 'inherit',
          cursor: 'pointer',
        },
        onClick: (e: MouseEvent) => {
          e.preventDefault();
          navigatePublicPath(`/agency/${agencySlug}/model/${item.id}`);
        },
        onMouseEnter: handleMouseEnter,
        onMouseLeave: () => setHovered(false),
      },
      cardContent,
    );
  }

  return <View style={[s.cell, { width: cellWidth }]}>{cardContent}</View>;
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<TextInput>(null);

  const { width } = useWindowDimensions();

  // 2 / 3 / 5 / 6 columns — editorial density
  const numCols = width <= 768 ? 2 : width < 1024 ? 3 : width < 1440 ? 5 : 6;
  const H_PAD = isMobileWidth(width) ? spacing.md : spacing.lg;
  const contentW = Math.min(width, MAX_CONTENT_W);
  const cellWidth = Math.floor((contentW - H_PAD * 2 - GRID_GAP * (numCols - 1)) / numCols);
  const cellHeight = Math.floor(cellWidth * 1.5);

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

        // Pre-warm the signed-URL cache for all cover images in one batch POST
        // instead of N individual createSignedUrl calls (which cause 504 storms).
        const coverUrls = mods.map((m) => m.cover_url).filter(Boolean) as string[];
        if (coverUrls.length > 0) {
          await resolveStorageUrlsBatch(coverUrls);
        }
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

  // Client-side name search — applied on top of segment filter, no backend call
  const searchedModels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return filteredModels;
    return filteredModels.filter((m) => m.name.toLowerCase().includes(q));
  }, [filteredModels, searchQuery]);

  // ── Render helpers ──

  const renderModel = useCallback(
    ({ item }: ListRenderItemInfo<PublicAgencyModel>) => (
      <ModelCard item={item} cellWidth={cellWidth} cellHeight={cellHeight} agencySlug={slug} />
    ),
    [cellWidth, cellHeight, slug],
  );

  const renderHeader = useCallback(() => {
    if (!profile) return null;

    const addrParts = [profile.city, profile.country].filter(Boolean);
    const addr = addrParts.join(', ');

    const tabs: Array<{ seg: Segment; label: string; count: number }> = [
      { seg: 'women', label: 'Women', count: womenCount },
      { seg: 'men', label: 'Men', count: menCount },
      { seg: 'all', label: 'All', count: models.length },
    ];

    const activeTabLabel = segment === 'women' ? 'Women' : segment === 'men' ? 'Men' : 'All';

    return (
      <View>
        {/* ── Top bar: subtle back link + search icon ── */}
        <View style={s.topBar}>
          {onClose ? (
            <TouchableOpacity
              onPress={onClose}
              style={s.backLink}
              accessibilityLabel="Back"
              accessibilityRole="button"
            >
              <Text style={s.backLinkText}>← Back</Text>
            </TouchableOpacity>
          ) : (
            <View />
          )}
          <TouchableOpacity
            onPress={() => {
              if (searchOpen) {
                setSearchOpen(false);
                setSearchQuery('');
              } else {
                setSearchOpen(true);
              }
            }}
            style={s.searchBtn}
            accessibilityRole="button"
            accessibilityLabel={searchOpen ? 'Close search' : 'Search models'}
          >
            <SearchIconView />
          </TouchableOpacity>
        </View>

        {/* ── Centered agency identity ── */}
        <View style={s.agencyIdentity}>
          {profile.logo_url ? (
            <StorageImage uri={profile.logo_url} style={s.logo} resizeMode="cover" />
          ) : (
            <View style={[s.logo, s.logoPlaceholder]}>
              <Text style={s.logoInitial}>{profile.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}

          <Text style={s.agencyName}>{profile.name.toUpperCase()}</Text>

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

          {profile.description ? <Text style={s.description}>{profile.description}</Text> : null}
        </View>

        {/* ── Search input (shown when search is open) ── */}
        {searchOpen && (
          <View style={s.searchBar}>
            <TextInput
              ref={searchInputRef}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search models…"
              placeholderTextColor={colors.textSecondary}
              style={s.searchInput}
              autoFocus
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>
        )}

        {/* ── Tab navigation: Women / Men / All ── */}
        {/* TODO: Phase 4 — add agency markets/locations selector here (e.g. Paris, NYC, Milan) */}
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

        {/* Empty state (accounts for active search filter) */}
        {searchedModels.length === 0 && (
          <View style={s.emptyState}>
            <Text style={s.emptyText}>
              {searchQuery.trim()
                ? `No results for "${searchQuery.trim()}".`
                : segment === 'all'
                  ? 'No models listed yet.'
                  : `No ${activeTabLabel.toLowerCase()} models listed yet.`}
            </Text>
          </View>
        )}
      </View>
    );
  }, [
    profile,
    segment,
    searchOpen,
    searchQuery,
    searchedModels.length,
    onClose,
    womenCount,
    menCount,
    models.length,
  ]);

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
          <TouchableOpacity
            style={[s.backLink, { position: 'absolute', top: spacing.lg, left: spacing.md }]}
            onPress={onClose}
            accessibilityRole="button"
          >
            <Text style={s.backLinkText}>← Back</Text>
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

  // Web: render with native DOM elements so model card <a> clicks are never
  // captured by a React Native ScrollView capture-phase mousedown handler.
  if (Platform.OS === 'web') {
    const sideLabelText =
      profile && width >= SIDE_LABEL_MIN_W
        ? `${profile.name} — ${segment === 'women' ? 'Women' : segment === 'men' ? 'Men' : 'All'}`
        : null;

    return (
      <View style={s.shell}>
        {/* Left vertical label — desktop only, sits in the left gutter */}
        {sideLabelText &&
          React.createElement(
            'div',
            {
              style: {
                position: 'fixed',
                left: 16,
                top: '50vh',
                writingMode: 'vertical-rl',
                transform: 'translateY(-50%) rotate(180deg)',
                color: colors.textSecondary,
                fontSize: 9,
                letterSpacing: 3,
                textTransform: 'uppercase',
                fontFamily: 'inherit',
                pointerEvents: 'none',
                userSelect: 'none',
                opacity: 0.45,
                whiteSpace: 'nowrap',
              },
            },
            sideLabelText,
          )}

        {/* Scrollable content — grid uses native DOM so <a> clicks are never swallowed */}
        {React.createElement(
          'div',
          { style: { flexGrow: 1, overflowY: 'auto' } },
          React.createElement(
            'div',
            {
              style: {
                paddingBottom: 120,
                paddingLeft: H_PAD,
                paddingRight: H_PAD,
                maxWidth: MAX_CONTENT_W,
                marginLeft: 'auto',
                marginRight: 'auto',
              },
            },
            renderHeader(),
            searchedModels.length > 0
              ? React.createElement(
                  'div',
                  { style: { display: 'flex', flexWrap: 'wrap', gap: GRID_GAP } },
                  searchedModels.map((item) =>
                    React.createElement(ModelCard, {
                      key: item.id,
                      item,
                      cellWidth,
                      cellHeight,
                      agencySlug: slug,
                    }),
                  ),
                )
              : null,
          ),
        )}
      </View>
    );
  }

  return (
    <View style={s.shell}>
      <FlatList<PublicAgencyModel>
        key={`${segment}-${numCols}`}
        data={searchedModels}
        numColumns={numCols}
        keyExtractor={(item) => item.id}
        renderItem={renderModel}
        ListHeaderComponent={renderHeader}
        columnWrapperStyle={
          searchedModels.length > 0 ? { gap: GRID_GAP, marginBottom: GRID_GAP } : undefined
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

  // ── Top bar (back link + search icon) ──
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    minHeight: 36,
  },
  backLink: {
    paddingVertical: 4,
    paddingRight: spacing.md,
  },
  backLinkText: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
  },
  searchBtn: {
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Centered agency identity ──
  agencyIdentity: {
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
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
    fontSize: 24,
    color: colors.textSecondary,
  },
  agencyName: {
    ...typography.heading,
    fontSize: 24,
    letterSpacing: 4,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: 2,
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
  description: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 560,
    paddingHorizontal: spacing.sm,
  },

  // ── Search bar ──
  searchBar: {
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  searchInput: {
    height: 38,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 3,
    paddingHorizontal: 12,
    ...typography.body,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.background,
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

  // Hover — gradient overlay (no stats available yet)
  hoverOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    padding: spacing.sm,
  },
  hoverName: {
    ...typography.label,
    fontSize: 10,
    letterSpacing: 1.2,
    color: '#ffffff',
    textAlign: 'left',
  },

  // Hover — solid stats panel (Elite/IMG style; replaces image visually)
  hoverPanel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0e0e0e',
    justifyContent: 'center',
    padding: 14,
  },
  hoverPanelName: {
    ...typography.label,
    fontSize: 12,
    letterSpacing: 2,
    color: '#ffffff',
    textAlign: 'left',
    marginBottom: 14,
  },
  hoverDivider: {
    width: 20,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginBottom: 12,
  },
  hoverStats: {
    gap: 5,
  },
  hoverStatRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  hoverStatLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    letterSpacing: 0.8,
    width: 48,
  },
  hoverStatValue: {
    color: '#ffffff',
    fontSize: 10,
    letterSpacing: 0.3,
    flex: 1,
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

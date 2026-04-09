/**
 * AgencyOrgProfileScreen — Phase 2A/2C.1/2C.2/3A.2/3A.3 (internal)
 *
 * Shows the agency organization's profile:
 *  - Logo, name, description, contact info
 *  - Women / Men segmented model roster
 *  - 3-column alphabetical grid with model cover + name
 *
 * Access: agency owner + booker (RLS enforced server-side).
 * Phase 2C.1: owner can edit text/contact fields via OrgProfileEditModal.
 * Phase 2C.2: owner can upload/replace/delete the organization logo.
 * Phase 3A.2: owner can configure public profile toggle (is_public) and slug.
 * Phase 3A.3: owner can copy / open the live public agency profile URL.
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  Switch,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  useWindowDimensions,
  type ListRenderItemInfo,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { StorageImage } from '../components/StorageImage';
import {
  getOrganizationProfile,
  upsertPublicSettings,
  type OrganizationProfile,
} from '../services/organizationProfilesSupabase';
import { OrgProfileEditModal } from '../components/OrgProfileEditModal';
import {
  uploadOrganizationLogo,
  deleteOrganizationLogo,
} from '../services/organizationLogoSupabase';
import {
  getModelsForAgencyFromSupabase,
  type SupabaseModel,
} from '../services/modelsSupabase';
import {
  filterAndSortModelsBySegment,
  type ModelSegment,
} from '../utils/orgProfileHelpers';
import { normalizeDocumentspicturesModelImageRef } from '../utils/normalizeModelPortfolioUrl';
import {
  validateSlug,
  publicAgencyUrl,
  publicAgencyHref,
} from '../utils/orgProfilePublicSettings';

// ─── Types ────────────────────────────────────────────────────────────────────

type Segment = ModelSegment;

export interface AgencyOrgProfileScreenProps {
  organizationId: string | null;
  agencyId: string | null;
  /** Display name of the organisation (from profile.company_name). */
  orgName: string | null;
  /** 'owner' | 'booker' | null */
  orgMemberRole: string | null;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function AgencyOrgProfileScreen({
  organizationId,
  agencyId,
  orgName,
  orgMemberRole,
}: AgencyOrgProfileScreenProps): React.ReactElement {
  const [orgProfile, setOrgProfile] = useState<OrganizationProfile | null>(null);
  const [models, setModels] = useState<SupabaseModel[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingModels, setLoadingModels] = useState(true);
  const [segment, setSegment] = useState<Segment>('women');
  const [editOpen, setEditOpen] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);

  // ── Phase 3A.2: public settings state (owner-only) ──
  const [slugDraft, setSlugDraft] = useState('');
  const [publicSaving, setPublicSaving] = useState(false);
  const [publicFeedback, setPublicFeedback] = useState<string | null>(null);
  const [publicFeedbackIsError, setPublicFeedbackIsError] = useState(false);

  // ── Phase 3A.3: share link state (owner-only) ──
  const [shareCopied, setShareCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { width } = useWindowDimensions();
  const CELL_GAP = spacing.xs;
  const H_PAD = spacing.md * 2;
  const cellWidth = Math.floor((width - H_PAD - CELL_GAP * 2) / 3);

  const isOwner = orgMemberRole === 'owner';
  const loading = loadingProfile || loadingModels;

  // Load org profile and seed slug draft
  useEffect(() => {
    if (!organizationId) {
      setLoadingProfile(false);
      return;
    }
    setLoadingProfile(true);
    void getOrganizationProfile(organizationId).then((p) => {
      setOrgProfile(p);
      setSlugDraft(p?.slug ?? '');
      setLoadingProfile(false);
    });
  }, [organizationId]);

  // Load agency models
  useEffect(() => {
    if (!agencyId) {
      setLoadingModels(false);
      return;
    }
    setLoadingModels(true);
    void getModelsForAgencyFromSupabase(agencyId).then((m) => {
      setModels(m);
      setLoadingModels(false);
    });
  }, [agencyId]);

  const filteredModels = useMemo(
    () => filterAndSortModelsBySegment(models, segment),
    [models, segment],
  );

  // ── Logo upload handlers (owner-only, web file input pattern) ──

  const handleLogoPress = useCallback(() => {
    if (!isOwner || logoUploading) return;
    fileInputRef.current?.click();
  }, [isOwner, logoUploading]);

  const handleLogoFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !organizationId) return;
      // Reset so the same file can be re-selected after an error
      e.target.value = '';

      setLogoUploading(true);
      const result = await uploadOrganizationLogo(organizationId, file);
      setLogoUploading(false);

      if (result.ok && result.url) {
        setOrgProfile((prev) => (prev ? { ...prev, logo_url: result.url! } : prev));
      } else {
        Alert.alert('Upload failed', result.error ?? 'Could not upload logo. Please try again.');
      }
    },
    [organizationId],
  );

  const handleLogoDelete = useCallback(async () => {
    if (!organizationId || !orgProfile?.logo_url) return;
    Alert.alert('Remove logo', 'Remove the current logo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setLogoUploading(true);
          const ok = await deleteOrganizationLogo(organizationId, orgProfile.logo_url);
          setLogoUploading(false);
          if (ok) {
            setOrgProfile((prev) => (prev ? { ...prev, logo_url: null } : prev));
          } else {
            Alert.alert('Error', 'Could not remove logo. Please try again.');
          }
        },
      },
    ]);
  }, [organizationId, orgProfile?.logo_url]);

  // ── Phase 3A.3: share link handlers (owner-only) ──

  // Derived: truthy only for owners with a live public profile
  const shareUrl = isOwner && orgProfile?.is_public && orgProfile?.slug
    ? publicAgencyHref(orgProfile.slug)
    : null;

  const handleCopyShareLink = useCallback(() => {
    if (!shareUrl) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }
  }, [shareUrl]);

  const handleOpenShareLink = useCallback(() => {
    if (!shareUrl) return;
    void Linking.openURL(shareUrl);
  }, [shareUrl]);

  // ── Phase 3A.2: public settings handlers (owner-only) ──

  const handleToggleIsPublic = useCallback((value: boolean) => {
    setOrgProfile((prev) => (prev ? { ...prev, is_public: value } : prev));
    setPublicFeedback(null);
  }, []);

  const handleSavePublicSettings = useCallback(async () => {
    if (!organizationId || !isOwner || publicSaving) return;

    const trimmedSlug = slugDraft.trim();
    const currentIsPublic = orgProfile?.is_public ?? false;

    // Slug validation is required when profile is public or when a slug is being set
    if (currentIsPublic || trimmedSlug) {
      const err = validateSlug(trimmedSlug);
      if (err) {
        setPublicFeedback(err);
        setPublicFeedbackIsError(true);
        return;
      }
    }

    setPublicSaving(true);
    setPublicFeedback(null);

    const result = await upsertPublicSettings(organizationId, {
      is_public: currentIsPublic,
      slug: trimmedSlug || null,
    });

    setPublicSaving(false);

    if (result.ok) {
      setOrgProfile((prev) => (prev ? { ...prev, slug: trimmedSlug || null } : prev));
      setPublicFeedback('Saved.');
      setPublicFeedbackIsError(false);
    } else if (result.slugTaken) {
      setPublicFeedback('This slug is already taken. Please choose another.');
      setPublicFeedbackIsError(true);
    } else {
      setPublicFeedback('Could not save. Please try again.');
      setPublicFeedbackIsError(true);
    }
  }, [organizationId, isOwner, publicSaving, slugDraft, orgProfile]);

  const renderModel = useCallback(
    ({ item }: ListRenderItemInfo<SupabaseModel>) => {
      const rawCover = item.portfolio_images?.[0] ?? null;
      const coverUri = rawCover ? normalizeDocumentspicturesModelImageRef(rawCover, item.id) : null;
      const imgH = Math.floor(cellWidth * 1.35);
      return (
        <View style={[s.cell, { width: cellWidth }]}>
          {coverUri ? (
            <StorageImage
              uri={coverUri}
              style={{ width: cellWidth, height: imgH, borderRadius: 4 }}
              resizeMode="cover"
            />
          ) : (
            <View
              style={[
                s.cellPlaceholder,
                { width: cellWidth, height: imgH, borderRadius: 4 },
              ]}
            >
              <Text style={s.cellInitial}>{item.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <Text style={s.cellName} numberOfLines={1}>
            {item.name}
          </Text>
        </View>
      );
    },
    [cellWidth],
  );

  const renderHeader = useCallback(() => {
    const addr = [orgProfile?.address_line_1, orgProfile?.city, orgProfile?.country]
      .filter(Boolean)
      .join(', ');

    return (
      <View>
        {/* ── Profile header ── */}
        <View style={s.headerSection}>
          {/* Logo — tappable for owner to upload/replace */}
          <TouchableOpacity
            style={s.logoWrap}
            onPress={handleLogoPress}
            onLongPress={isOwner && orgProfile?.logo_url ? handleLogoDelete : undefined}
            disabled={!isOwner || logoUploading}
            accessibilityLabel={isOwner ? 'Change logo' : undefined}
            accessibilityRole={isOwner ? 'button' : 'image'}
            activeOpacity={isOwner ? 0.7 : 1}
          >
            {orgProfile?.logo_url ? (
              <StorageImage uri={orgProfile.logo_url} style={s.logo} resizeMode="cover" />
            ) : (
              <View style={[s.logo, s.logoPlaceholder]}>
                {logoUploading ? (
                  <ActivityIndicator color={colors.textSecondary} />
                ) : (
                  <Text style={s.logoInitial}>
                    {(orgName ?? '?').charAt(0).toUpperCase()}
                  </Text>
                )}
              </View>
            )}
            {/* Edit overlay badge — visible to owner only */}
            {isOwner && !logoUploading && (
              <View style={s.logoEditBadge}>
                <Text style={s.logoEditBadgeText}>✎</Text>
              </View>
            )}
            {logoUploading && orgProfile?.logo_url ? (
              <View style={s.logoUploadingOverlay}>
                <ActivityIndicator color="#fff" />
              </View>
            ) : null}
          </TouchableOpacity>
          {/* Hidden file input for web */}
          {isOwner && (
            // @ts-ignore — input element only exists on web; ignored on native
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleLogoFileChange}
            />
          )}

          <Text style={s.orgName}>{orgName ?? '—'}</Text>

          {/* Owner-only Edit CTA (Phase 2C.1) */}
          {isOwner && (
            <TouchableOpacity
              style={s.editCta}
              onPress={() => setEditOpen(true)}
              accessibilityLabel="Edit profile"
              accessibilityRole="button"
            >
              <Text style={s.editCtaText}>Edit Profile</Text>
            </TouchableOpacity>
          )}

          {orgProfile?.description ? (
            <Text style={s.description}>{orgProfile.description}</Text>
          ) : null}

          {addr ? <Text style={s.meta}>{addr}</Text> : null}
          {orgProfile?.website_url ? (
            <Text style={s.meta}>{orgProfile.website_url}</Text>
          ) : null}
          {orgProfile?.contact_email ? (
            <Text style={s.meta}>{orgProfile.contact_email}</Text>
          ) : null}
          {orgProfile?.contact_phone ? (
            <Text style={s.meta}>{orgProfile.contact_phone}</Text>
          ) : null}

          {/* Empty profile hint for owner */}
          {isOwner && !orgProfile?.description && !addr && !orgProfile?.website_url && (
            <Text style={s.emptyHint}>
              Add a description, address and contact info to complete your profile.
            </Text>
          )}

          {/* ── Phase 3A.3: Share live public profile (owner-only, visible when live) ── */}
          {shareUrl && isOwner && (
            <View style={s.shareSection}>
              <Text style={s.shareSectionTitle}>Share your profile</Text>
              <Text style={s.shareUrl} numberOfLines={1}>
                {publicAgencyUrl(orgProfile?.slug)}
              </Text>
              <View style={s.shareRow}>
                <TouchableOpacity
                  style={s.shareBtn}
                  onPress={handleCopyShareLink}
                  accessibilityLabel="Copy link"
                  accessibilityRole="button"
                >
                  <Text style={s.shareBtnText}>
                    {shareCopied ? 'Copied!' : 'Copy link'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.shareBtn, s.shareBtnSecondary]}
                  onPress={handleOpenShareLink}
                  accessibilityLabel="Open profile in browser"
                  accessibilityRole="link"
                >
                  <Text style={[s.shareBtnText, s.shareBtnTextSecondary]}>Open ↗</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ── Phase 3A.2: Public Profile settings (owner-only) ── */}
          {isOwner && (
            <View style={s.publicSection}>
              <Text style={s.publicSectionTitle}>Public Profile</Text>

              {/* is_public toggle */}
              <View style={s.publicRow}>
                <Text style={s.publicLabel}>
                  {orgProfile?.is_public ? 'Public' : 'Private'}
                </Text>
                <Switch
                  value={orgProfile?.is_public ?? false}
                  onValueChange={handleToggleIsPublic}
                  trackColor={{ false: colors.border, true: colors.accent }}
                  thumbColor="#fff"
                  accessibilityLabel="Make profile public"
                />
              </View>

              {/* Slug input — shown when public or when there's a slug draft */}
              {(orgProfile?.is_public || slugDraft.length > 0) && (
                <>
                  <Text style={s.publicInputLabel}>Public URL slug</Text>
                  <TextInput
                    style={s.publicInput}
                    value={slugDraft}
                    onChangeText={(v) => {
                      setSlugDraft(v);
                      setPublicFeedback(null);
                    }}
                    placeholder="e.g. my-agency"
                    placeholderTextColor={colors.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="Public URL slug"
                  />
                  {/* Live URL preview */}
                  {slugDraft.trim().length > 0 && (
                    <Text style={s.publicPreviewUrl} numberOfLines={1}>
                      {publicAgencyUrl(slugDraft) ?? ''}
                    </Text>
                  )}
                </>
              )}

              {/* Feedback text */}
              {publicFeedback ? (
                <Text
                  style={[
                    s.publicFeedbackText,
                    publicFeedbackIsError ? s.publicFeedbackError : s.publicFeedbackSuccess,
                  ]}
                >
                  {publicFeedback}
                </Text>
              ) : null}

              {/* Save button */}
              <TouchableOpacity
                style={[
                  s.publicSaveBtn,
                  (publicSaving || (orgProfile?.is_public && !slugDraft.trim())) &&
                    s.publicSaveBtnDisabled,
                ]}
                onPress={() => void handleSavePublicSettings()}
                disabled={publicSaving || (orgProfile?.is_public && !slugDraft.trim())}
                accessibilityLabel="Save public settings"
                accessibilityRole="button"
              >
                {publicSaving ? (
                  <ActivityIndicator color={colors.textSecondary} />
                ) : (
                  <Text style={s.publicSaveBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── Segment bar ── */}
        <View style={s.segmentBar}>
          {(['women', 'men'] as Segment[]).map((seg) => (
            <TouchableOpacity
              key={seg}
              onPress={() => setSegment(seg)}
              style={s.segmentItem}
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

        {/* Empty state — no models in this segment */}
        {!loading && filteredModels.length === 0 && (
          <View style={s.emptyState}>
            <Text style={s.emptyText}>
              No {segment === 'women' ? 'women' : 'men'} models in this roster yet.
            </Text>
          </View>
        )}
      </View>
    );
  }, [
    orgProfile,
    orgName,
    isOwner,
    segment,
    filteredModels.length,
    loading,
    logoUploading,
    handleLogoPress,
    handleLogoDelete,
    handleLogoFileChange,
    // Phase 3A.3
    shareUrl,
    shareCopied,
    handleCopyShareLink,
    handleOpenShareLink,
  ]);

  if (loading) {
    return (
      <View style={s.loaderWrap}>
        <ActivityIndicator color={colors.textPrimary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList<SupabaseModel>
        // key forces re-mount when segment changes to reset scroll position
        key={segment}
        data={filteredModels}
        numColumns={3}
        keyExtractor={(item) => item.id}
        renderItem={renderModel}
        ListHeaderComponent={renderHeader}
        columnWrapperStyle={s.row}
        contentContainerStyle={s.listContent}
        style={{ flex: 1, backgroundColor: colors.background }}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        initialNumToRender={9}
        maxToRenderPerBatch={9}
      />
      {isOwner && organizationId && editOpen && (
        <OrgProfileEditModal
          visible
          onClose={() => setEditOpen(false)}
          organizationId={organizationId}
          initialValues={{
            description: orgProfile?.description ?? null,
            address_line_1: orgProfile?.address_line_1 ?? null,
            city: orgProfile?.city ?? null,
            postal_code: orgProfile?.postal_code ?? null,
            country: orgProfile?.country ?? null,
            website_url: orgProfile?.website_url ?? null,
            contact_email: orgProfile?.contact_email ?? null,
            contact_phone: orgProfile?.contact_phone ?? null,
          }}
          onSaved={(updated) => {
            setOrgProfile((prev) => (prev ? { ...prev, ...updated } : prev));
            setEditOpen(false);
          }}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const LOGO_SIZE = 72;

const s = StyleSheet.create({
  loaderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: 120,
  },
  headerSection: {
    alignItems: 'center',
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.md,
  },
  logoWrap: {
    marginBottom: spacing.sm,
    position: 'relative',
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
  logoEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoEditBadgeText: {
    color: colors.background,
    fontSize: 12,
    lineHeight: 14,
  },
  logoUploadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: LOGO_SIZE / 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgName: {
    ...typography.heading,
    fontSize: 20,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  editCta: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  editCtaText: {
    ...typography.label,
    fontSize: 12,
    color: colors.textPrimary,
  },
  description: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  meta: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyHint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  // Segment bar
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
  // Grid
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
  // Empty state
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
  // ── Phase 3A.2: public settings ──────────────────────────────────────────
  publicSection: {
    marginTop: spacing.md,
    width: '100%',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  publicSectionTitle: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  publicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  publicLabel: {
    ...typography.body,
    fontSize: 14,
    color: colors.textPrimary,
  },
  publicInputLabel: {
    ...typography.label,
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  publicInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    marginBottom: spacing.xs,
  },
  publicPreviewUrl: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginBottom: spacing.xs,
  },
  publicFeedbackText: {
    ...typography.body,
    fontSize: 13,
    marginBottom: spacing.xs,
  },
  publicFeedbackError: {
    color: '#D32F2F',
  },
  publicFeedbackSuccess: {
    color: '#388E3C',
  },
  publicSaveBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  publicSaveBtnDisabled: {
    opacity: 0.4,
  },
  publicSaveBtnText: {
    ...typography.label,
    fontSize: 13,
    color: colors.textPrimary,
  },
  // ── Phase 3A.3: share section ─────────────────────────────────────────────
  shareSection: {
    marginTop: spacing.md,
    width: '100%',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  shareSectionTitle: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  shareUrl: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginBottom: spacing.sm,
  },
  shareRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  shareBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.accent,
  },
  shareBtnSecondary: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  shareBtnText: {
    ...typography.label,
    fontSize: 13,
    color: colors.surface,
  },
  shareBtnTextSecondary: {
    color: colors.textPrimary,
  },
});

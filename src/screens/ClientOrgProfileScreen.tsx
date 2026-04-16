/**
 * ClientOrgProfileScreen — Phase 2A/2C.1/2C.2/2D/3B.2 (internal)
 *
 * Shows the client organization's profile:
 *  - Logo, name, description, contact info
 *  - Gallery section from organization_profile_media (client_gallery)
 *  - Clean empty state when no media has been added yet
 *
 * Access: client owner + employee (RLS enforced server-side).
 * Phase 2C.1: owner can edit text/contact fields via OrgProfileEditModal.
 * Phase 2C.2: owner can upload/replace/delete the organization logo.
 * Phase 2D: owner can upload and delete gallery images.
 * Phase 3B.2: owner can set is_public + slug for the public client profile.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Switch,
  TextInput,
  Linking,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { showAppAlert, showConfirmAlert } from '../utils/crossPlatformAlert';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import { StorageImage } from '../components/StorageImage';
import {
  getOrganizationProfile,
  listOrganizationProfileMedia,
  upsertPublicSettings,
  type OrganizationProfile,
  type OrganizationProfileMedia,
} from '../services/organizationProfilesSupabase';
import { OrgProfileEditModal } from '../components/OrgProfileEditModal';
import {
  uploadOrganizationLogo,
  deleteOrganizationLogo,
} from '../services/organizationLogoSupabase';
import {
  uploadClientGalleryImage,
  deleteClientGalleryImage,
} from '../services/organizationGallerySupabase';
import { validateSlug, publicClientUrl, publicClientHref } from '../utils/orgProfilePublicSettings';
import { isOrganizationOwner } from '../services/orgRoleTypes';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClientOrgProfileScreenProps {
  organizationId: string | null;
  /** Display name of the organisation (from profile.company_name). */
  orgName: string | null;
  /** 'owner' | 'employee' | null */
  orgMemberRole: string | null;
  /** Extra bottom padding when embedded in client web shell with fixed bottom tab bar. */
  scrollBottomInset?: number;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function ClientOrgProfileScreen({
  organizationId,
  orgName,
  orgMemberRole,
  scrollBottomInset = 0,
}: ClientOrgProfileScreenProps): React.ReactElement {
  const [orgProfile, setOrgProfile] = useState<OrganizationProfile | null>(null);
  const [media, setMedia] = useState<OrganizationProfileMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [deletingMediaIds, setDeletingMediaIds] = useState<Set<string>>(new Set());

  // ── Phase 3B.2: public settings state (owner-only) ──
  const [slugDraft, setSlugDraft] = useState('');
  const [publicSaving, setPublicSaving] = useState(false);
  const [publicFeedback, setPublicFeedback] = useState<string | null>(null);
  const [publicFeedbackIsError, setPublicFeedbackIsError] = useState(false);

  // ── Phase 3B.3: share link state (owner-only) ──
  const [shareCopied, setShareCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const { width } = useWindowDimensions();
  const CELL_GAP = spacing.xs;
  const H_PAD = spacing.md * 2;
  const cellWidth = Math.floor((width - H_PAD - CELL_GAP * 2) / 3);
  const cellHeight = Math.floor(cellWidth * 0.85);

  const isOwner = isOrganizationOwner(orgMemberRole);

  // Load profile + media in parallel
  useEffect(() => {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void Promise.all([
      getOrganizationProfile(organizationId),
      listOrganizationProfileMedia(organizationId),
    ]).then(([p, m]) => {
      setOrgProfile(p);
      setSlugDraft(p?.slug ?? '');
      setMedia(m);
      setLoading(false);
    });
  }, [organizationId]);

  // ── Logo upload handlers (owner-only, web file input pattern) ──

  const handleLogoPress = useCallback(() => {
    if (!isOwner || logoUploading) return;
    fileInputRef.current?.click();
  }, [isOwner, logoUploading]);

  const handleLogoFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !organizationId) return;
      e.target.value = '';

      setLogoUploading(true);
      const result = await uploadOrganizationLogo(organizationId, file);
      setLogoUploading(false);

      if (result.ok && result.url) {
        setOrgProfile((prev) => (prev ? { ...prev, logo_url: result.url! } : prev));
      } else {
        showAppAlert(
          uiCopy.organizationProfile.logoUploadFailedTitle,
          result.error ?? uiCopy.organizationProfile.logoUploadFailedMessage,
        );
      }
    },
    [organizationId],
  );

  const handleLogoDelete = useCallback(async () => {
    if (!organizationId || !orgProfile?.logo_url) return;
    const op = uiCopy.organizationProfile;
    showConfirmAlert(
      op.removeLogoTitle,
      op.removeLogoMessage,
      async () => {
        setLogoUploading(true);
        const ok = await deleteOrganizationLogo(organizationId, orgProfile.logo_url);
        setLogoUploading(false);
        if (ok) {
          setOrgProfile((prev) => (prev ? { ...prev, logo_url: null } : prev));
        } else {
          showAppAlert(uiCopy.common.error, op.removeLogoFailed);
        }
      },
      uiCopy.common.remove,
    );
  }, [organizationId, orgProfile?.logo_url]);

  // ── Gallery upload/delete handlers (owner-only) ──

  const handleGalleryUploadPress = useCallback(() => {
    if (!isOwner || galleryUploading) return;
    galleryInputRef.current?.click();
  }, [isOwner, galleryUploading]);

  const handleGalleryFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      e.target.value = '';
      if (files.length === 0 || !organizationId) return;

      setGalleryUploading(true);
      let failCount = 0;
      let lastError: string | undefined;
      const total = files.length;
      try {
        for (const file of files) {
          const result = await uploadClientGalleryImage(organizationId, file);
          if (result.ok && result.media) {
            setMedia((prev) => [...prev, result.media!]);
          } else {
            failCount += 1;
            lastError = result.error;
          }
        }
        if (failCount > 0) {
          const op = uiCopy.organizationProfile;
          if (failCount === total) {
            showAppAlert(
              op.galleryUploadAllFailedTitle,
              lastError ?? op.galleryUploadAllFailedMessage,
            );
          } else {
            showAppAlert(
              op.galleryUploadSomeFailedTitle,
              op.galleryUploadSomeFailedBody
                .replace('{failed}', String(failCount))
                .replace('{total}', String(total)),
            );
          }
        }
      } finally {
        setGalleryUploading(false);
      }
    },
    [organizationId],
  );

  const handleDeleteGalleryImage = useCallback(
    (item: OrganizationProfileMedia) => {
      if (!organizationId || deletingMediaIds.has(item.id)) return;
      const op = uiCopy.organizationProfile;
      showConfirmAlert(
        op.removeGalleryImageTitle,
        op.removeGalleryImageMessage,
        async () => {
          // Per-id inflight lock
          setDeletingMediaIds((prev) => new Set(prev).add(item.id));
          const ok = await deleteClientGalleryImage(organizationId, item.id, item.image_url);
          setDeletingMediaIds((prev) => {
            const next = new Set(prev);
            next.delete(item.id);
            return next;
          });
          if (ok) {
            // Inverse-operation remove: filter out the deleted item
            setMedia((prev) => prev.filter((m) => m.id !== item.id));
          } else {
            showAppAlert(uiCopy.common.error, op.removeGalleryImageFailed);
          }
        },
        uiCopy.common.remove,
      );
    },
    [organizationId, deletingMediaIds],
  );

  // ── Phase 3B.2: public settings handlers (owner-only) ──

  const handleToggleIsPublic = useCallback((value: boolean) => {
    setOrgProfile((prev) => (prev ? { ...prev, is_public: value } : prev));
    setPublicFeedback(null);
  }, []);

  const handleSavePublicSettings = useCallback(async () => {
    if (!organizationId || !isOwner || publicSaving) return;

    const trimmedSlug = slugDraft.trim();
    const currentIsPublic = orgProfile?.is_public ?? false;

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

  // ── Phase 3B.3: share link handlers (owner-only) ──

  // Derived: truthy only for owners with a live public profile
  const shareUrl =
    isOwner && orgProfile?.is_public && orgProfile?.slug ? publicClientHref(orgProfile.slug) : null;

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

  const renderGallery = useCallback(() => {
    const isDeleting = (id: string) => deletingMediaIds.has(id);

    return (
      <View style={s.gallerySection}>
        {/* ── Section header with upload button ── */}
        <View style={s.gallerySectionHeader}>
          <Text style={s.sectionTitle}>Gallery</Text>
          {isOwner && (
            <TouchableOpacity
              style={[s.galleryAddBtn, galleryUploading && s.galleryAddBtnDisabled]}
              onPress={handleGalleryUploadPress}
              disabled={galleryUploading}
              accessibilityLabel="Add gallery image"
              accessibilityRole="button"
            >
              {galleryUploading ? (
                <ActivityIndicator color={colors.textSecondary} size="small" />
              ) : (
                <Text style={s.galleryAddBtnText}>+</Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Hidden file input for web */}
        {isOwner && (
          // @ts-ignore — input element only exists on web; ignored on native
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            style={{ display: 'none' }}
            onChange={handleGalleryFileChange}
          />
        )}

        {/* ── Empty state ── */}
        {media.length === 0 && (
          <View style={s.emptyState}>
            <Text style={s.emptyTitle}>No gallery content yet</Text>
            {isOwner && <Text style={s.emptyHint}>Tap '+' to add your first gallery image.</Text>}
          </View>
        )}

        {/* ── 3-column grid ── */}
        {media.length > 0 &&
          (() => {
            const rows: OrganizationProfileMedia[][] = [];
            for (let i = 0; i < media.length; i += 3) {
              rows.push(media.slice(i, i + 3));
            }
            return rows.map((row, rIdx) => (
              <View key={rIdx} style={s.galleryRow}>
                {row.map((item) => (
                  <View
                    key={item.id}
                    style={[s.galleryCell, { width: cellWidth, height: cellHeight }]}
                  >
                    <StorageImage
                      uri={item.image_url}
                      style={{ width: cellWidth, height: cellHeight, borderRadius: 4 }}
                      resizeMode="contain"
                    />
                    {/* Delete overlay for owner */}
                    {isOwner && !isDeleting(item.id) && (
                      <TouchableOpacity
                        style={s.galleryDeleteBtn}
                        onPress={() => handleDeleteGalleryImage(item)}
                        accessibilityLabel="Remove image"
                        accessibilityRole="button"
                      >
                        <Text style={s.galleryDeleteBtnText}>×</Text>
                      </TouchableOpacity>
                    )}
                    {/* Deleting spinner overlay */}
                    {isDeleting(item.id) && (
                      <View style={s.galleryCellOverlay}>
                        <ActivityIndicator color="#fff" />
                      </View>
                    )}
                  </View>
                ))}
              </View>
            ));
          })()}
      </View>
    );
  }, [
    media,
    isOwner,
    cellWidth,
    cellHeight,
    galleryUploading,
    deletingMediaIds,
    handleGalleryUploadPress,
    handleGalleryFileChange,
    handleDeleteGalleryImage,
  ]);

  if (loading) {
    return (
      <View style={s.loaderWrap}>
        <ActivityIndicator color={colors.textPrimary} />
      </View>
    );
  }

  const addr = [orgProfile?.address_line_1, orgProfile?.city, orgProfile?.country]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={[
          s.scrollContent,
          scrollBottomInset > 0
            ? { paddingBottom: Math.max(120, scrollBottomInset + spacing.lg) }
            : null,
        ]}
        showsVerticalScrollIndicator={false}
      >
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
                  <Text style={s.logoInitial}>{(orgName ?? '?').charAt(0).toUpperCase()}</Text>
                )}
              </View>
            )}
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
              accept="image/*,.heic,.heif"
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
          {orgProfile?.website_url ? <Text style={s.meta}>{orgProfile.website_url}</Text> : null}
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

          {/* ── Phase 3B.2: Public Profile settings (owner-only) ── */}
          {isOwner && (
            <View style={s.publicSection}>
              <Text style={s.publicSectionTitle}>Public Profile</Text>

              {/* is_public toggle */}
              <View style={s.publicRow}>
                <Text style={s.publicLabel}>{orgProfile?.is_public ? 'Public' : 'Private'}</Text>
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
                    placeholder="e.g. my-client"
                    placeholderTextColor={colors.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="Public URL slug"
                  />
                  {/* Live URL preview */}
                  {slugDraft.trim().length > 0 && (
                    <Text style={s.publicPreviewUrl} numberOfLines={1}>
                      {publicClientUrl(slugDraft) ?? ''}
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

          {/* ── Phase 3B.3: Share live public profile (owner-only, visible when live) ── */}
          {shareUrl && isOwner && (
            <View style={s.shareSection}>
              <Text style={s.shareSectionTitle}>Share your profile</Text>
              <Text style={s.shareUrl} numberOfLines={1}>
                {publicClientUrl(orgProfile?.slug)}
              </Text>
              <View style={s.shareRow}>
                <TouchableOpacity
                  style={s.shareBtn}
                  onPress={handleCopyShareLink}
                  accessibilityLabel="Copy link"
                  accessibilityRole="button"
                >
                  <Text style={s.shareBtnText}>{shareCopied ? 'Copied!' : 'Copy link'}</Text>
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
        </View>

        {/* ── Gallery ── */}
        {renderGallery()}
      </ScrollView>
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
  scrollContent: {
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
  // Gallery
  gallerySection: {
    paddingHorizontal: spacing.md,
  },
  gallerySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  galleryAddBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryAddBtnDisabled: {
    opacity: 0.5,
  },
  galleryAddBtnText: {
    color: '#fff',
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '300',
  },
  galleryDeleteBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryDeleteBtnText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 18,
    fontWeight: '600',
  },
  galleryCellOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    ...typography.label,
    fontSize: 13,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    letterSpacing: 0.5,
  },
  galleryRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  galleryCell: {
    overflow: 'hidden',
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  // Empty state
  emptyState: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    alignItems: 'center',
  },
  emptyTitle: {
    ...typography.body,
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  // ── Phase 3B.2: public settings ─────────────────────────────────────────────
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
  // ── Phase 3B.3: share section ─────────────────────────────────────────────
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

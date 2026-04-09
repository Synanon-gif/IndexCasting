/**
 * ClientOrgProfileScreen — Phase 2A/2C.1/2C.2 (internal)
 *
 * Shows the client organization's profile:
 *  - Logo, name, description, contact info
 *  - Gallery section from organization_profile_media
 *  - Clean empty state when no media has been added yet
 *
 * Access: client owner + employee (RLS enforced server-side).
 * Phase 2C.1: owner can edit text/contact fields via OrgProfileEditModal.
 * Phase 2C.2: owner can upload/replace/delete the organization logo.
 * No public access in this phase.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { StorageImage } from '../components/StorageImage';
import {
  getOrganizationProfile,
  listOrganizationProfileMedia,
  type OrganizationProfile,
  type OrganizationProfileMedia,
} from '../services/organizationProfilesSupabase';
import { OrgProfileEditModal } from '../components/OrgProfileEditModal';
import {
  uploadOrganizationLogo,
  deleteOrganizationLogo,
} from '../services/organizationLogoSupabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClientOrgProfileScreenProps {
  organizationId: string | null;
  /** Display name of the organisation (from profile.company_name). */
  orgName: string | null;
  /** 'owner' | 'employee' | null */
  orgMemberRole: string | null;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function ClientOrgProfileScreen({
  organizationId,
  orgName,
  orgMemberRole,
}: ClientOrgProfileScreenProps): React.ReactElement {
  const [orgProfile, setOrgProfile] = useState<OrganizationProfile | null>(null);
  const [media, setMedia] = useState<OrganizationProfileMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { width } = useWindowDimensions();
  const CELL_GAP = spacing.xs;
  const H_PAD = spacing.md * 2;
  const cellWidth = Math.floor((width - H_PAD - CELL_GAP * 2) / 3);
  const cellHeight = Math.floor(cellWidth * 0.85);

  const isOwner = orgMemberRole === 'owner';

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

  const renderGallery = useCallback(() => {
    if (media.length === 0) {
      return (
        <View style={s.emptyState}>
          <Text style={s.emptyTitle}>No gallery content yet</Text>
          {isOwner && (
            <Text style={s.emptyHint}>
              Gallery upload will be available in the next update.
            </Text>
          )}
        </View>
      );
    }

    // 3-column grid — group into rows of 3
    const rows: OrganizationProfileMedia[][] = [];
    for (let i = 0; i < media.length; i += 3) {
      rows.push(media.slice(i, i + 3));
    }

    return (
      <View style={s.gallerySection}>
        <Text style={s.sectionTitle}>Gallery</Text>
        {rows.map((row, rIdx) => (
          <View key={rIdx} style={s.galleryRow}>
            {row.map((item) => (
              <View key={item.id} style={[s.galleryCell, { width: cellWidth, height: cellHeight }]}>
                <StorageImage
                  uri={item.image_url}
                  style={{ width: cellWidth, height: cellHeight, borderRadius: 4 }}
                  resizeMode="cover"
                />
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  }, [media, isOwner, cellWidth, cellHeight]);

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
      contentContainerStyle={s.scrollContent}
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
                <Text style={s.logoInitial}>
                  {(orgName ?? '?').charAt(0).toUpperCase()}
                </Text>
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
});

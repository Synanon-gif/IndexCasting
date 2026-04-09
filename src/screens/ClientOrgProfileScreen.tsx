/**
 * ClientOrgProfileScreen — Phase 2A (internal, read-only)
 *
 * Shows the client organization's profile:
 *  - Logo, name, description, contact info
 *  - Gallery section from organization_profile_media
 *  - Clean empty state when no media has been added yet
 *
 * Access: client owner + employee (RLS enforced server-side).
 * Owner sees a passive "Edit Profile" placeholder (non-functional in Phase 2A).
 * No public access, no edit flow, no media upload in this phase.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
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
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={s.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Profile header ── */}
      <View style={s.headerSection}>
        {/* Logo */}
        <View style={s.logoWrap}>
          {orgProfile?.logo_url ? (
            <StorageImage uri={orgProfile.logo_url} style={s.logo} resizeMode="cover" />
          ) : (
            <View style={[s.logo, s.logoPlaceholder]}>
              <Text style={s.logoInitial}>
                {(orgName ?? '?').charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
        </View>

        <Text style={s.orgName}>{orgName ?? '—'}</Text>

        {/* Owner-only Edit CTA placeholder (non-functional in Phase 2A) */}
        {isOwner && (
          <TouchableOpacity
            disabled
            style={s.editCta}
            accessibilityLabel="Edit profile (coming soon)"
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
  editCta: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    opacity: 0.5,
  },
  editCtaText: {
    ...typography.label,
    fontSize: 12,
    color: colors.textSecondary,
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

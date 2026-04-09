/**
 * OrgProfileModal — Phase 2B
 *
 * Full-screen Modal overlay that renders either AgencyOrgProfileScreen or
 * ClientOrgProfileScreen depending on `orgType`.
 *
 * Used when a chat header org-name is tapped to show the counterparty's
 * profile.  Cross-org viewers always get orgMemberRole=null (no Edit CTA).
 */

import React from 'react';
import {
  Modal,
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  SafeAreaView,
  Platform,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { AgencyOrgProfileScreen } from '../screens/AgencyOrgProfileScreen';
import { ClientOrgProfileScreen } from '../screens/ClientOrgProfileScreen';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface OrgProfileModalProps {
  visible: boolean;
  onClose: () => void;
  orgType: 'agency' | 'client';
  organizationId: string;
  /** Required for agency type to load the model roster. null = roster empty. */
  agencyId: string | null;
  orgName: string | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OrgProfileModal({
  visible,
  onClose,
  orgType,
  organizationId,
  agencyId,
  orgName,
}: OrgProfileModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safeArea}>
        {/* Header bar */}
        <View style={styles.header}>
          <View style={styles.headerTitle}>
            <Text style={styles.headerTitleText} numberOfLines={1}>
              {orgName ?? (orgType === 'agency' ? 'Agency Profile' : 'Client Profile')}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
            accessibilityLabel="Close profile"
            accessibilityRole="button"
          >
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Profile screen — cross-org viewer always has orgMemberRole=null */}
        <View style={styles.content}>
          {orgType === 'agency' ? (
            <AgencyOrgProfileScreen
              organizationId={organizationId}
              agencyId={agencyId}
              orgName={orgName}
              orgMemberRole={null}
            />
          ) : (
            <ClientOrgProfileScreen
              organizationId={organizationId}
              orgName={orgName}
              orgMemberRole={null}
            />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 2,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  headerTitle: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  headerTitleText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  closeBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  closeBtnText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  content: {
    flex: 1,
  },
});

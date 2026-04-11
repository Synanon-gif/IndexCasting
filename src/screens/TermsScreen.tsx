import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Linking,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import { validateUrl } from '../../lib/validation';

type Props = {
  /** Called when the user taps the close/back button. */
  onClose: () => void;
};

/**
 * In-app Terms of Service screen.
 *
 * Operational fix: the external URL https://indexcasting.com/terms was
 * potentially returning 404. This screen provides the legal text in-app
 * as a guaranteed fallback, with a link to the hosted version for reference.
 */
export const TermsScreen: React.FC<Props> = ({ onClose }) => {
  const openExternal = () => {
    if (!validateUrl(uiCopy.legal.tosUrl).ok) return;
    Linking.openURL(uiCopy.legal.tosUrl).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>{uiCopy.legal.termsScreenTitle}</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel={uiCopy.legal.legalScreenClose}>
          <Text style={styles.closeLabel}>{uiCopy.legal.legalScreenClose}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.notice}>{uiCopy.legal.legalPendingTitle}</Text>
        <Text style={styles.noticeBody}>{uiCopy.legal.legalPendingBody}</Text>

        <View style={styles.section}>
          <Text style={styles.heading}>1. Scope & Acceptance</Text>
          <Text style={styles.body}>
            By accessing or using the IndexCasting platform ("Service"), you agree to be bound by
            these Terms of Service ("Terms"). If you do not agree to these Terms, you may not use
            the Service. These Terms apply to all users including Agency Owners, Bookers,
            Client Owners, and Employees.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>2. User Accounts & Roles</Text>
          <Text style={styles.body}>
            You are responsible for maintaining the confidentiality of your account credentials.
            Agency Owners may invite Bookers; Client Owners may invite Employees. Invitations are
            role-limited and may be revoked at any time by the Owner. You must be at least 18 years
            old to register and use this Service.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>3. Acceptable Use</Text>
          <Text style={styles.body}>
            You agree not to misuse the Service, including but not limited to: unauthorized access,
            data scraping, impersonation, harassment of models or other users, or circumventing
            security measures. We reserve the right to suspend or terminate accounts that violate
            these Terms.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>4. Intellectual Property</Text>
          <Text style={styles.body}>
            All content and functionality of the Service (excluding user-uploaded content) is the
            property of IndexCasting. Model portfolio images and personal data remain the property
            of the respective Agency or Model. You grant IndexCasting a limited license to display
            your content solely to provide the Service.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>5. Casting & Booking</Text>
          <Text style={styles.body}>
            IndexCasting facilitates communication between Agencies and Clients for casting and
            booking purposes. IndexCasting is not a party to any booking agreement. Pricing,
            scheduling, and contractual obligations are solely between the Agency and the Client.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>6. Subscription & Payment</Text>
          <Text style={styles.body}>
            Access to premium features requires an active paid subscription. Subscriptions are
            billed in advance on a recurring basis. You may cancel at any time; cancellation takes
            effect at the end of the current billing period. No refunds are provided for partial
            periods.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>7. Data Protection</Text>
          <Text style={styles.body}>
            The processing of personal data is governed by our Privacy Policy, which forms part of
            these Terms. We comply with GDPR (EU) 2016/679. You have the right to request access,
            correction, or deletion of your personal data at any time.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>8. Limitation of Liability</Text>
          <Text style={styles.body}>
            To the maximum extent permitted by applicable law, IndexCasting shall not be liable for
            any indirect, incidental, special, or consequential damages arising from your use of
            the Service. Our total liability shall not exceed the amount paid by you in the
            preceding 12 months.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>9. Changes to Terms</Text>
          <Text style={styles.body}>
            We reserve the right to modify these Terms at any time. We will notify you of material
            changes via email or in-app notification. Continued use of the Service after
            notification constitutes acceptance of the revised Terms.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>10. Governing Law</Text>
          <Text style={styles.body}>
            These Terms are governed by the laws of Germany. Any disputes shall be subject to the
            exclusive jurisdiction of the courts of Germany.
          </Text>
        </View>

        <View style={styles.contactSection}>
          <Text style={styles.contactLabel}>{uiCopy.legal.legalContactHint}</Text>
          <TouchableOpacity onPress={() => Linking.openURL(`mailto:${uiCopy.legal.legalContactEmail}`)}>
            <Text style={styles.contactEmail}>{uiCopy.legal.legalContactEmail}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={openExternal} style={styles.externalLink}>
            <Text style={styles.externalLinkLabel}>View latest version online</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    ...typography.heading,
    fontSize: 18,
    color: colors.textPrimary,
  },
  closeBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  closeLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xl,
    maxWidth: 680,
    alignSelf: 'center',
    width: '100%',
  },
  notice: {
    ...typography.label,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: spacing.xs,
  },
  noticeBody: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
    fontStyle: 'italic',
  },
  section: {
    marginBottom: spacing.xl,
  },
  heading: {
    ...typography.label,
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  contactSection: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
    gap: spacing.xs,
  },
  contactLabel: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
  },
  contactEmail: {
    ...typography.label,
    color: colors.textPrimary,
    textDecorationLine: 'underline',
  },
  externalLink: {
    marginTop: spacing.sm,
  },
  externalLinkLabel: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
});

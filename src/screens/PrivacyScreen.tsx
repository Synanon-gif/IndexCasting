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
 * In-app Privacy Policy screen.
 *
 * Operational fix: the external URL https://indexcasting.com/privacy was
 * potentially returning 404. This screen provides the privacy policy in-app
 * as a guaranteed fallback, with a link to the hosted version for reference.
 */
export const PrivacyScreen: React.FC<Props> = ({ onClose }) => {
  const openExternal = () => {
    if (!validateUrl(uiCopy.legal.privacyUrl).ok) return;
    Linking.openURL(uiCopy.legal.privacyUrl).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>{uiCopy.legal.privacyScreenTitle}</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel={uiCopy.legal.legalScreenClose}>
          <Text style={styles.closeLabel}>{uiCopy.legal.legalScreenClose}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.notice}>{uiCopy.legal.legalPendingTitle}</Text>
        <Text style={styles.noticeBody}>{uiCopy.legal.legalPendingBody}</Text>

        <View style={styles.section}>
          <Text style={styles.heading}>1. Controller</Text>
          <Text style={styles.body}>
            IndexCasting is the data controller for personal data processed through this platform.
            Contact: {uiCopy.legal.legalContactEmail}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>2. Data We Collect</Text>
          <Text style={styles.body}>
            We collect the following categories of personal data:{'\n'}
            • Account data: email address, display name, role, company name.{'\n'}
            • Profile data: for models — height, measurements, portfolio images, location.{'\n'}
            • Usage data: casting requests, booking history, messages exchanged on the platform.{'\n'}
            • Technical data: IP address (hashed), device type, app version, session logs.{'\n'}
            We apply data minimisation principles and only collect data necessary for the Service.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>3. Legal Basis for Processing</Text>
          <Text style={styles.body}>
            We process your personal data on the following legal bases (GDPR Art. 6):{'\n'}
            • Contract performance (Art. 6(1)(b)): to provide the platform and booking functionality.{'\n'}
            • Legitimate interests (Art. 6(1)(f)): security, fraud prevention, audit trails.{'\n'}
            • Legal obligation (Art. 6(1)(c)): tax records, dispute resolution.{'\n'}
            • Consent (Art. 6(1)(a)): where explicitly requested (e.g. geo-location, marketing).
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>4. How We Use Your Data</Text>
          <Text style={styles.body}>
            Your data is used to:{'\n'}
            • Provide, maintain, and improve the Service.{'\n'}
            • Facilitate communication between Agencies, Clients, and Models.{'\n'}
            • Send transactional notifications and platform updates.{'\n'}
            • Detect and prevent fraudulent or abusive activity.{'\n'}
            • Comply with legal obligations and resolve disputes.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>5. Data Sharing</Text>
          <Text style={styles.body}>
            We do not sell your personal data. We may share data with:{'\n'}
            • Other platform users as necessary for the Service (e.g. your profile with Agencies).{'\n'}
            • Sub-processors: Supabase (database & storage), Stripe (payment processing).{'\n'}
            • Law enforcement when required by applicable law.{'\n'}
            All sub-processors are bound by data processing agreements.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>6. Data Retention</Text>
          <Text style={styles.body}>
            We retain your personal data for as long as your account is active, plus:{'\n'}
            • Audit logs: up to 7 years (legal accountability obligation under applicable law).{'\n'}
            • Security event logs: 2 years.{'\n'}
            • Billing records: 10 years (tax obligation).{'\n'}
            • Deleted account data: purged within 30 days of account deletion request.{'\n'}
            You may request deletion at any time (see Your Rights below).
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>7. Your Rights (GDPR)</Text>
          <Text style={styles.body}>
            Under GDPR, you have the right to:{'\n'}
            • Access your personal data (Art. 15).{'\n'}
            • Rectify inaccurate data (Art. 16).{'\n'}
            • Erasure ("right to be forgotten") (Art. 17).{'\n'}
            • Data portability (Art. 20).{'\n'}
            • Object to processing (Art. 21).{'\n'}
            • Withdraw consent at any time (Art. 7(3)).{'\n'}
            To exercise any right, contact: {uiCopy.legal.legalContactEmail}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>8. Security</Text>
          <Text style={styles.body}>
            We implement appropriate technical and organisational measures to protect your personal
            data, including encryption at rest and in transit, Row Level Security policies,
            session management, and regular security audits. In case of a data breach affecting
            your rights, we will notify you within 72 hours as required by GDPR Art. 33.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>9. Cookies & Local Storage</Text>
          <Text style={styles.body}>
            The app stores session tokens and user preferences in local storage for functionality.
            This data is cleared on sign-out. We do not use third-party tracking cookies.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>10. Updates to This Policy</Text>
          <Text style={styles.body}>
            We may update this Privacy Policy from time to time. We will notify you of material
            changes via email or in-app notification. The current version is always available
            in the app and at {uiCopy.legal.privacyUrl}.
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
    paddingHorizontal: spacing.lg,
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
    paddingHorizontal: spacing.lg,
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

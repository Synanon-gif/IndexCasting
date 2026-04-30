import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AI_ASSISTANT_LEGAL_SECTIONS,
  AI_ASSISTANT_CONSENT_CHECKBOX_LABEL,
  AI_ASSISTANT_CONSENT_SCROLL_HINT,
  AI_ASSISTANT_CONSENT_FOOTNOTE_VERSION,
  INDEXCASTING_PUBLIC_PRIVACY_URL,
  INDEXCASTING_PUBLIC_TRUST_GDPR_URL,
} from '../../constants/aiAssistantConsent';
import { colors, spacing, typography } from '../../theme/theme';

export type AiAssistantConsentModalProps = {
  visible: boolean;
  onAccept: () => Promise<void>;
  onDecline: () => void;
};

export function AiAssistantConsentModal({
  visible,
  onAccept,
  onDecline,
}: AiAssistantConsentModalProps) {
  const [agreed, setAgreed] = useState(false);
  const [pending, setPending] = useState(false);

  const layout = useMemo(() => {
    const h = Dimensions.get('window').height;
    return {
      sheetMaxHeight: Math.min(Math.round(h * 0.92), 740),
      scrollMinHeight: Math.min(Math.max(Math.round(h * 0.38), 220), 420),
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      setAgreed(false);
      setPending(false);
    }
  }, [visible]);

  const handleDecline = useCallback(() => {
    setAgreed(false);
    onDecline();
  }, [onDecline]);

  const handleAccept = useCallback(async () => {
    if (!agreed || pending) return;
    setPending(true);
    try {
      await onAccept();
      setAgreed(false);
    } finally {
      setPending(false);
    }
  }, [agreed, onAccept]);

  const openUrl = useCallback((url: string) => {
    void Linking.openURL(url).catch(() => {});
  }, []);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={handleDecline}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} accessibilityElementsHidden accessibilityLabel="" />

        <View
          accessibilityRole="none"
          style={[
            styles.sheet,
            {
              maxHeight: layout.sheetMaxHeight,
            },
          ]}
        >
          <Text style={styles.title}>AI Assistant Usage</Text>
          <Text style={styles.hint}>{AI_ASSISTANT_CONSENT_SCROLL_HINT}</Text>

          <ScrollView
            style={[styles.scroll, { minHeight: layout.scrollMinHeight }]}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            {AI_ASSISTANT_LEGAL_SECTIONS.map((section) => (
              <View key={section.title} style={styles.section}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                {section.paragraphs.map((p, i) => (
                  <Text key={`${section.title}-${i}`} style={styles.paragraph}>
                    {p}
                  </Text>
                ))}
              </View>
            ))}
            <Text style={styles.paragraphMuted}>
              Mandatory external references (scroll above for context):
            </Text>
            <View style={styles.linkRow}>
              <Pressable
                onPress={() => openUrl(INDEXCASTING_PUBLIC_PRIVACY_URL)}
                accessibilityRole="link"
                accessibilityLabel="Open privacy notice in browser"
              >
                <Text style={styles.linkText}>{INDEXCASTING_PUBLIC_PRIVACY_URL}</Text>
              </Pressable>
            </View>
            <View style={styles.linkRow}>
              <Pressable
                onPress={() => openUrl(INDEXCASTING_PUBLIC_TRUST_GDPR_URL)}
                accessibilityRole="link"
                accessibilityLabel="Open trust center GDPR overview in browser"
              >
                <Text style={styles.linkText}>{INDEXCASTING_PUBLIC_TRUST_GDPR_URL}</Text>
              </Pressable>
            </View>
          </ScrollView>

          <View style={styles.meta}>
            <Text style={styles.metaLabel}>Mistral processing (high level)</Text>
            <Text style={styles.metaText}>
              Your typed question plus server-configured guidance and optionally a minimised factual
              JSON envelope may be sent once per request for language generation outside core
              IndexCasting compute. Do not paste credentials, payment data, unstructured legal
              dossiers or health records into the assistant.
            </Text>
          </View>

          <Text style={styles.versionFoot}>{AI_ASSISTANT_CONSENT_FOOTNOTE_VERSION}</Text>

          <Pressable
            style={styles.checkboxWrap}
            onPress={() => setAgreed(!agreed)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
          >
            <View style={[styles.checkboxOuter, agreed ? styles.checkboxOuterOn : null]}>
              {agreed ? <View style={styles.checkboxInner} /> : null}
            </View>
            <Text style={styles.checkboxLabel}>{AI_ASSISTANT_CONSENT_CHECKBOX_LABEL}</Text>
          </Pressable>

          <View style={styles.actions}>
            <Pressable
              style={[styles.secondaryBtn, pending ? styles.btnDisabled : null]}
              onPress={handleDecline}
              accessibilityRole="button"
              accessibilityLabel="Cancel AI assistant consent"
              disabled={pending}
            >
              <Text style={styles.secondaryBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, !agreed || pending ? styles.primaryBtnDisabled : null]}
              onPress={handleAccept}
              accessibilityRole="button"
              accessibilityLabel="Accept AI assistant terms"
              disabled={!agreed || pending}
            >
              {pending ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <Text style={styles.primaryBtnText}>Accept and continue</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: 'rgba(10,14,26,0.45)',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
    flexShrink: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.black,
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    gap: spacing.sm,
  },
  title: {
    ...typography.headingCompact,
    fontSize: 18,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  hint: {
    ...typography.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  scroll: {
    flexGrow: 1,
    flexShrink: 1,
  },
  scrollContent: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
    paddingRight: Platform.OS === 'web' ? 4 : 0,
  },
  section: {
    gap: spacing.xs,
  },
  sectionTitle: {
    ...typography.label,
    fontSize: 12,
    color: colors.textPrimary,
    letterSpacing: 0.35,
    textTransform: 'uppercase',
  },
  paragraph: {
    ...typography.body,
    fontSize: 13,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  paragraphMuted: {
    ...typography.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
  linkRow: {
    alignSelf: 'stretch',
    marginBottom: spacing.xs,
  },
  linkText: {
    ...typography.body,
    fontSize: 13,
    lineHeight: 20,
    color: colors.textPrimary,
    textDecorationLine: 'underline',
  },
  meta: {
    gap: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  metaLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textPrimary,
  },
  metaText: {
    ...typography.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  versionFoot: {
    ...typography.label,
    fontSize: 10,
    letterSpacing: 0.35,
    color: colors.textSecondary,
    marginTop: 2,
  },
  checkboxWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  checkboxOuter: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  checkboxOuterOn: {
    borderColor: colors.textPrimary,
    backgroundColor: colors.textPrimary,
  },
  checkboxInner: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: colors.surface,
  },
  checkboxLabel: {
    flex: 1,
    ...typography.body,
    fontSize: 13,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    flexWrap: 'wrap',
    paddingTop: spacing.xs,
  },
  secondaryBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryBtnText: {
    ...typography.label,
    fontSize: 13,
    color: colors.textPrimary,
  },
  primaryBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: colors.textPrimary,
    minWidth: 160,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
  },
  primaryBtnDisabled: {
    opacity: 0.45,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  primaryBtnText: {
    ...typography.label,
    fontSize: 13,
    color: colors.surface,
  },
});

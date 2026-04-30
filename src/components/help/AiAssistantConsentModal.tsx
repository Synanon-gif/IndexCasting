import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
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

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={handleDecline}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={() => undefined} accessibilityLabel="" />
        <View style={styles.sheet} accessibilityRole="none">
          <Text style={styles.title}>AI Assistant Usage</Text>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
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
          </ScrollView>

          <View style={styles.meta}>
            <Text style={styles.metaLabel}>Mistral processing (what may leave IndexCasting):</Text>
            <Text style={styles.metaText}>
              Your typed question plus strict server instructions configured by IndexCasting,
              optionally a small JSON envelope of facts assembled from authorised read-RPCs
              mirroring UI-visible data. Do not paste sensitive credentials or unstructured
              legal/health archives here.
            </Text>
          </View>

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
    maxWidth: 520,
    maxHeight: Platform.OS === 'web' ? 640 : '90%',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.black,
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    gap: spacing.md,
  },
  title: {
    ...typography.headingCompact,
    fontSize: 18,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  scroll: {
    flexGrow: 0,
    maxHeight: Platform.OS === 'web' ? 320 : 240,
    minHeight: 160,
  },
  scrollContent: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  section: {
    gap: spacing.xs,
  },
  sectionTitle: {
    ...typography.label,
    fontSize: 12,
    color: colors.textPrimary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  paragraph: {
    ...typography.body,
    fontSize: 13,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  meta: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
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
  checkboxWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
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

import React from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, Platform, Pressable } from 'react-native';
import { spacing, typography, uiChrome } from '../theme/theme';

export type ConfirmDestructiveModalProps = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Disables confirm while async work runs */
  confirmDisabled?: boolean;
  /** Extra context lines (e.g. model name, date) — UI only */
  detailLine1?: string;
  detailLine2?: string;
  /** destructive = red danger button; confirm = primary (e.g. model availability accept) */
  tone?: 'destructive' | 'confirm';
};

/**
 * Cross-platform destructive confirmation — replaces `window.confirm` for consistent UX.
 */
export const ConfirmDestructiveModal: React.FC<ConfirmDestructiveModalProps> = ({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  confirmDisabled = false,
  detailLine1,
  detailLine2,
  tone = 'destructive',
}) => (
  <Modal
    visible={visible}
    transparent
    animationType={Platform.OS === 'ios' ? 'fade' : 'fade'}
    onRequestClose={onCancel}
  >
    <Pressable style={styles.backdrop} onPress={onCancel}>
      <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
        <Text style={styles.icon} accessibilityLabel="">
          {tone === 'confirm' ? '✓' : '🗑️'}
        </Text>
        <Text style={styles.title}>{title}</Text>
        {detailLine1 ? <Text style={styles.detail}>{detailLine1}</Text> : null}
        {detailLine2 ? <Text style={styles.detail}>{detailLine2}</Text> : null}
        <Text style={styles.message}>{message}</Text>
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.btnSecondary}
            onPress={onCancel}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.btnSecondaryText}>{cancelLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              tone === 'confirm' ? styles.btnPrimary : styles.btnDanger,
              confirmDisabled && styles.btnDisabled,
            ]}
            onPress={onConfirm}
            disabled={confirmDisabled}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={tone === 'confirm' ? styles.btnPrimaryText : styles.btnDangerText}>
              {confirmLabel}
            </Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Pressable>
  </Modal>
);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: spacing.sm,
  },
  card: {
    backgroundColor: uiChrome.surface,
    borderRadius: 12,
    padding: spacing.md,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: uiChrome.border,
  },
  icon: {
    fontSize: 28,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  title: {
    ...typography.heading,
    fontSize: 18,
    color: uiChrome.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
    textTransform: 'none',
    letterSpacing: 0,
  },
  detail: {
    ...typography.body,
    fontSize: 13,
    color: uiChrome.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  message: {
    ...typography.body,
    fontSize: 14,
    color: uiChrome.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  btnSecondary: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  btnSecondaryText: {
    ...typography.label,
    fontSize: 13,
    color: uiChrome.secondaryActionText,
    textTransform: 'none',
    letterSpacing: 0,
  },
  btnDanger: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: uiChrome.destructiveAction,
    borderRadius: 8,
  },
  btnPrimary: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: uiChrome.primaryAction,
    borderRadius: 8,
  },
  btnDisabled: {
    opacity: uiChrome.disabledOpacity,
  },
  btnPrimaryText: {
    ...typography.label,
    fontSize: 13,
    color: uiChrome.primaryActionText,
    textTransform: 'none',
    letterSpacing: 0,
  },
  btnDangerText: {
    ...typography.label,
    fontSize: 13,
    color: uiChrome.destructiveActionText,
    textTransform: 'none',
    letterSpacing: 0,
  },
});

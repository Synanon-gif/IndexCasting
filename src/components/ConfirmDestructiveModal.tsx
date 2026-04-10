import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Pressable,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';

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
          🗑️
        </Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.btnSecondary} onPress={onCancel} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.btnSecondaryText}>{cancelLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnDanger, confirmDisabled && styles.btnDisabled]}
            onPress={onConfirm}
            disabled={confirmDisabled}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.btnDangerText}>{confirmLabel}</Text>
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
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.lg,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  icon: {
    fontSize: 28,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  title: {
    ...typography.heading,
    fontSize: 18,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
    textTransform: 'none',
    letterSpacing: 0,
  },
  message: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
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
    color: colors.accent,
    textTransform: 'none',
    letterSpacing: 0,
  },
  btnDanger: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.buttonSkipRed,
    borderRadius: 8,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnDangerText: {
    ...typography.label,
    fontSize: 13,
    color: '#fff',
    textTransform: 'none',
    letterSpacing: 0,
  },
});

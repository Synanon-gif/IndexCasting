import React, { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { uiCopy } from '../../constants/uiCopy';
import { colors, typography } from '../../theme/theme';
import { AiAssistantPanel } from './AiAssistantPanel';
import type { AiAssistantViewerRole } from './aiAssistantCopy';

type AiAssistantButtonProps = {
  viewerRole: AiAssistantViewerRole;
};

export function AiAssistantButton({ viewerRole }: AiAssistantButtonProps) {
  const [open, setOpen] = useState(false);
  const label = uiCopy.aiAssistant.buttonLabel;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={10}
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={styles.text}>AI</Text>
      </Pressable>
      <AiAssistantPanel visible={open} viewerRole={viewerRole} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 28,
    height: 24,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  text: {
    ...typography.label,
    fontSize: 10,
    lineHeight: 12,
    color: colors.textSecondary,
  },
});

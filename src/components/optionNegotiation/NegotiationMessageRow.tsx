import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { spacing, typography } from '../../theme/theme';
import { OptionSystemInfoBlock } from './OptionSystemInfoBlock';
import {
  bubbleColorsForSender,
  isSelfMessage,
  type ChatParticipantRole,
} from '../../theme/roleColors';

export type NegotiationMessageRowProps = {
  id: string;
  from: ChatParticipantRole;
  text: string;
  viewerRole: 'agency' | 'client';
};

export const NegotiationMessageRow: React.FC<NegotiationMessageRowProps> = ({
  from,
  text,
  viewerRole,
}) => {
  if (from === 'system') {
    return <OptionSystemInfoBlock text={text} />;
  }

  const self = isSelfMessage(from, viewerRole);
  const { bubbleBackground, bubbleText, borderColor } = bubbleColorsForSender(from);

  return (
    <View style={[styles.row, self ? styles.rowSelf : styles.rowOther]}>
      <View style={[styles.bubble, { backgroundColor: bubbleBackground, borderColor }]}>
        <Text style={[styles.bubbleText, { color: bubbleText }]}>{text}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    width: '100%',
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  rowSelf: {
    justifyContent: 'flex-end',
  },
  rowOther: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '88%',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bubbleText: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 21,
  },
});

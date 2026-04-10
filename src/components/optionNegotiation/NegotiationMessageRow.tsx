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
  /** Tighter top margin when grouped with the previous bubble (same sender role). */
  compactTop?: boolean;
  /** Short time label (e.g. locale time) — shown under the bubble for this message. */
  timeLabel?: string;
};

export const NegotiationMessageRow: React.FC<NegotiationMessageRowProps> = ({
  from,
  text,
  viewerRole,
  compactTop,
  timeLabel,
}) => {
  if (from === 'system') {
    return <OptionSystemInfoBlock text={text} />;
  }

  const self = isSelfMessage(from, viewerRole);
  const { bubbleBackground, bubbleText, borderColor } = bubbleColorsForSender(from);

  return (
    <View style={[styles.row, compactTop && styles.rowCompactTop, self ? styles.rowSelf : styles.rowOther]}>
      <View style={styles.bubbleCol}>
        <View style={[styles.bubble, { backgroundColor: bubbleBackground, borderColor }]}>
          <Text style={[styles.bubbleText, { color: bubbleText }]}>{text}</Text>
        </View>
        {timeLabel ? (
          <Text style={[styles.timeLabel, self ? styles.timeLabelSelf : styles.timeLabelOther]}>{timeLabel}</Text>
        ) : null}
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
  rowCompactTop: {
    marginTop: -4,
    marginBottom: 2,
  },
  rowSelf: {
    justifyContent: 'flex-end',
  },
  rowOther: {
    justifyContent: 'flex-start',
  },
  bubbleCol: {
    maxWidth: '88%',
  },
  bubble: {
    maxWidth: '100%',
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
  timeLabel: {
    ...typography.label,
    fontSize: 10,
    marginTop: 2,
    opacity: 0.75,
  },
  timeLabelSelf: {
    textAlign: 'right',
  },
  timeLabelOther: {
    textAlign: 'left',
  },
});

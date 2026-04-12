import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { spacing, typography } from '../../theme/theme';
import { OptionSystemInfoBlock } from './OptionSystemInfoBlock';
import {
  isSelfMessage,
  negotiationBubbleAppearance,
  type ChatParticipantRole,
  type NegotiationViewerRole,
} from '../../theme/roleColors';
import { CHAT_BUBBLE_MAX_WIDTH } from '../orgMessengerMessageLayout';

export type NegotiationMessageRowProps = {
  id: string;
  from: ChatParticipantRole;
  text: string;
  viewerRole: NegotiationViewerRole;
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
  const { bubbleBackground, bubbleText, borderColor } = negotiationBubbleAppearance(from, viewerRole);

  return (
    <View style={[styles.row, compactTop && styles.rowCompactTop, self ? styles.rowSelf : styles.rowOther]}>
      <View style={[styles.bubbleCol, self && styles.bubbleColSelf]}>
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
    alignItems: 'flex-start',
  },
  /** Outgoing: narrower column + left gutter so the bubble is not flush to the right edge. */
  bubbleColSelf: {
    maxWidth: '76%',
    marginLeft: '12%',
    paddingRight: spacing.sm,
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: CHAT_BUBBLE_MAX_WIDTH,
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

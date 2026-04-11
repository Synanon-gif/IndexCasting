import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/theme';
import { BOTTOM_TAB_BAR_HEIGHT } from '../navigation/bottomTabNavigation';

export type ChatLayoutFixProps = {
  header?: React.ReactNode;
  messageList: React.ReactNode;
  composer: React.ReactNode;
  /** Space reserved below composer for tab bar; default `BOTTOM_TAB_BAR_HEIGHT`. Pass `0` if there is no tab bar. */
  bottomTabInset?: number;
  /** Horizontal padding for messages + composer; use 0 when parent already pads (e.g. card). */
  edgePadding?: number;
};

export default function ChatLayoutFix({
  header,
  messageList,
  composer,
  bottomTabInset,
  edgePadding = 16,
}: ChatLayoutFixProps) {
  const insets = useSafeAreaInsets();

  const tabBarReserve =
    bottomTabInset !== undefined ? bottomTabInset : BOTTOM_TAB_BAR_HEIGHT;
  const composerBottomPadding = tabBarReserve + insets.bottom;

  return (
    <View style={styles.screen}>
      {header ? <View style={styles.header}>{header}</View> : null}

      <View style={styles.content}>
        <ScrollView
          style={styles.messagesScroll}
          contentContainerStyle={[
            styles.messagesContent,
            { paddingHorizontal: edgePadding },
            { flexGrow: 1 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          {messageList}
        </ScrollView>

        <View
          style={[
            styles.composerWrap,
            { paddingBottom: composerBottomPadding, paddingHorizontal: edgePadding },
          ]}
        >
          {composer}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
  },
  header: {
    flexShrink: 0,
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
  messagesScroll: {
    flex: 1,
    minHeight: 0,
  },
  messagesContent: {
    paddingTop: 12,
    paddingBottom: 12,
  },
  composerWrap: {
    flexShrink: 0,
    paddingTop: 10,
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});

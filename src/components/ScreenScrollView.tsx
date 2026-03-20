/**
 * Standard vertical scroll for screens: avoids dead zones, keyboard-friendly (RN + web).
 */
import React from 'react';
import {
  ScrollView,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { spacing } from '../theme/theme';

export type ScreenScrollViewProps = ScrollViewProps & {
  contentStyle?: StyleProp<ViewStyle>;
};

export const ScreenScrollView: React.FC<ScreenScrollViewProps> = ({
  children,
  style,
  contentContainerStyle,
  contentStyle,
  keyboardShouldPersistTaps = 'handled',
  showsVerticalScrollIndicator = false,
  ...rest
}) => (
  <ScrollView
    style={[{ flex: 1 }, style]}
    contentContainerStyle={[
      { flexGrow: 1, paddingBottom: spacing.xl * 2 },
      contentStyle,
      contentContainerStyle,
    ]}
    keyboardShouldPersistTaps={keyboardShouldPersistTaps}
    showsVerticalScrollIndicator={showsVerticalScrollIndicator}
    {...rest}
  >
    {children}
  </ScrollView>
);

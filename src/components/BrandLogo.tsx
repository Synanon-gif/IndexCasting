import React from 'react';
import {
  Image,
  type ImageSourcePropType,
  type ImageStyle,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

/** Canonical square brand mark (PNG under /assets). */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro static asset bundle
const BRAND_MARK: ImageSourcePropType = require('../../assets/index-casting-brand.png');

export type BrandLogoProps = {
  /** Edge length in px (logo is square). Default 160. */
  size?: number;
  /** When set, overrides `size` for width; height stays square. */
  width?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ImageStyle>;
  containerStyle?: StyleProp<ViewStyle>;
};

export function BrandLogo({
  size = 160,
  width,
  accessibilityLabel = 'Index Casting',
  style,
  containerStyle,
}: BrandLogoProps) {
  const edge = width ?? size;
  return (
    <View style={[styles.align, containerStyle]}>
      <Image
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="image"
        importantForAccessibility="yes"
        source={BRAND_MARK}
        style={[{ width: edge, height: edge }, style]}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  align: { alignItems: 'center', justifyContent: 'center' },
});

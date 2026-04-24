/**
 * ImageCarousel — inline image browser with overlaid left/right arrow buttons.
 *
 * Arrow containers use pointerEvents="box-none" so touches on the image area
 * still pass through to the parent. Pressable buttons have zIndex/elevation to
 * guarantee they paint above the image on both web and native.
 *
 * Nested inside a TouchableOpacity (swipe card): on native, Pressable wins the
 * responder; on web, nativeEvent.stopPropagation() prevents the parent click.
 */

import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { StorageImage } from './StorageImage';

interface ImageCarouselProps {
  images: string[];
  /** Outer container style — caller controls sizing (flex, height, etc.). */
  style?: StyleProp<ViewStyle>;
  /** Forwarded to StorageImage. */
  imageStyle?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
  /** Signed-URL lifetime forwarded to StorageImage (defaults to 3 600 s). */
  ttlSeconds?: number;
  /** When provided, tapping the image area (not an arrow) calls this handler. */
  onImagePress?: () => void;
  /**
   * Optional overlay rendered above the image but below the navigation arrows.
   * Use for gradient/metadata overlays that must stay below the arrow z-level.
   * Wrapped in pointerEvents="none" — make overlay content non-interactive.
   */
  overlay?: React.ReactNode;
}

export const ImageCarousel: React.FC<ImageCarouselProps> = ({
  images,
  style,
  imageStyle,
  resizeMode = 'contain',
  ttlSeconds,
  onImagePress,
  overlay,
}) => {
  const [index, setIndex] = useState(0);

  if (images.length === 0) {
    return <View style={style} />;
  }

  const safeIndex = Math.min(index, images.length - 1);
  const hasMultiple = images.length > 1;

  const goPrev = () => setIndex((i) => (i - 1 + images.length) % images.length);
  const goNext = () => setIndex((i) => (i + 1) % images.length);

  /** Stop the parent card's TouchableOpacity from also firing on web. */
  const stopProp = (e: GestureResponderEvent) => {
    if (Platform.OS === 'web') {
      (e.nativeEvent as unknown as { stopPropagation?: () => void }).stopPropagation?.();
    }
  };

  const imageNode = (
    <StorageImage
      uri={images[safeIndex]}
      style={onImagePress ? { width: '100%', height: '100%' } : imageStyle}
      resizeMode={resizeMode}
      ttlSeconds={ttlSeconds}
    />
  );

  return (
    <View style={style}>
      {onImagePress ? (
        <Pressable onPress={onImagePress} style={[StyleSheet.absoluteFill, { zIndex: 0 }]}>
          {imageNode}
        </Pressable>
      ) : (
        imageNode
      )}

      {overlay && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {overlay}
        </View>
      )}

      {hasMultiple && (
        <>
          {/* Left arrow — box-none lets image touches pass through */}
          <View style={[styles.arrowZone, styles.arrowZoneLeft]} pointerEvents="box-none">
            <Pressable
              onPress={(e) => {
                stopProp(e);
                goPrev();
              }}
              style={styles.arrowButton}
              hitSlop={8}
            >
              <Text style={styles.arrowText}>{'‹'}</Text>
            </Pressable>
          </View>

          {/* Right arrow */}
          <View style={[styles.arrowZone, styles.arrowZoneRight]} pointerEvents="box-none">
            <Pressable
              onPress={(e) => {
                stopProp(e);
                goNext();
              }}
              style={styles.arrowButton}
              hitSlop={8}
            >
              <Text style={styles.arrowText}>{'›'}</Text>
            </Pressable>
          </View>

          {/* Dot indicators — purely decorative, no touch */}
          <View style={styles.dots} pointerEvents="none">
            {images.map((_, i) => (
              <View key={i} style={[styles.dot, i === safeIndex && styles.dotActive]} />
            ))}
          </View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  /** Transparent full-height strip; only the Pressable inside is hittable. */
  arrowZone: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 60,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    elevation: 10,
  } as ViewStyle,
  arrowZoneLeft: { left: 0 },
  arrowZoneRight: { right: 0 },

  /** Circular button — visually prominent on any image. */
  arrowButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.52)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    elevation: 10,
  } as ViewStyle,

  arrowText: {
    color: '#ffffff',
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '700',
    textAlign: 'center',
    includeFontPadding: false,
  },

  dots: {
    position: 'absolute',
    bottom: 8,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
    zIndex: 10,
    elevation: 10,
  } as ViewStyle,
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  dotActive: {
    backgroundColor: '#ffffff',
    transform: [{ scale: 1.25 }],
  },
});

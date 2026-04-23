import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  type GestureResponderEvent,
  type StyleProp,
  type ImageStyle,
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
}

/**
 * Inline image carousel with overlaid left/right arrows.
 * Safe to nest inside a TouchableOpacity — arrow Views claim the responder
 * via onStartShouldSetResponder so the parent press does not fire.
 */
export const ImageCarousel: React.FC<ImageCarouselProps> = ({
  images,
  style,
  imageStyle,
  resizeMode = 'contain',
}) => {
  const [index, setIndex] = useState(0);

  if (images.length === 0) {
    return <View style={style} />;
  }

  const safeIndex = Math.min(index, images.length - 1);
  const hasMultiple = images.length > 1;

  const goPrev = () => setIndex((i) => (i - 1 + images.length) % images.length);
  const goNext = () => setIndex((i) => (i + 1) % images.length);

  const makeArrowResponder = (handler: () => void) => ({
    onStartShouldSetResponder: () => true,
    onResponderRelease: (_e: GestureResponderEvent) => handler(),
  });

  return (
    <View style={style}>
      <StorageImage uri={images[safeIndex]} style={imageStyle} resizeMode={resizeMode} />

      {hasMultiple && (
        <>
          <View {...makeArrowResponder(goPrev)} style={[styles.arrow, styles.arrowLeft]}>
            <Text style={styles.arrowText}>{'‹'}</Text>
          </View>
          <View {...makeArrowResponder(goNext)} style={[styles.arrow, styles.arrowRight]}>
            <Text style={styles.arrowText}>{'›'}</Text>
          </View>

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
  arrow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.22)',
    cursor: 'pointer',
  } as ViewStyle,
  arrowLeft: { left: 0 },
  arrowRight: { right: 0 },
  arrowText: {
    color: '#fff',
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '600',
    includeFontPadding: false,
    textAlignVertical: 'center',
    userSelect: 'none',
  } as object,
  dots: {
    position: 'absolute',
    bottom: 8,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  dotActive: {
    backgroundColor: '#fff',
  },
});

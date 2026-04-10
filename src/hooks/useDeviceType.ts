import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { deviceTypeFromWidth, type DeviceType } from '../theme/breakpoints';

export type { DeviceType } from '../theme/breakpoints';

/**
 * Responsive shell helper — same logic on web and native; uses window width.
 */
export function useDeviceType(): {
  deviceType: DeviceType;
  width: number;
  height: number;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
} {
  const { width, height } = useWindowDimensions();

  const deviceType = useMemo(() => deviceTypeFromWidth(width), [width]);

  return {
    deviceType,
    width,
    height,
    isMobile: deviceType === 'mobile',
    isTablet: deviceType === 'tablet',
    isDesktop: deviceType === 'desktop',
  };
}

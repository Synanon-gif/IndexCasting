export const colors = {
  background: '#F8F7F4',
  surface: '#FFFFFF',
  textPrimary: '#111111',
  textSecondary: '#7A7A7A',
  accent: '#111111',
  accentGreen: '#1F3D33',
  accentBrown: '#4A3325',
  border: '#E2E0DB',
  // Premium buttons: high saturation, low brightness
  buttonSkipRed: '#7D2828',
  buttonOptionGreen: '#1A4A38',

  // Semantic tokens — use these instead of raw hex in components
  error: '#E74C3C',
  errorDark: '#C0392B',
  success: '#2E7D32',
  successLight: '#2ECC71',
  warning: '#B8860B',
  warningDark: '#E65100',
  borderLight: '#D0CEC7',
  surfaceAlt: '#E8E6E0',
  surfaceWarm: '#F3EEE7',
  black: '#000000',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

/** Saubere Typografie: Inter (Web) / Helvetica (Fallback). Für native Inter ggf. per expo-font laden. */
const fontFamily = 'Inter, Helvetica Neue, Helvetica, Arial, sans-serif';

export const typography = {
  fontFamily,
  heading: {
    fontFamily,
    fontSize: 25,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
  },
  /** Compact brand wordmark for non-dashboard product screens — significantly smaller than heading. */
  headingCompact: {
    fontFamily,
    fontSize: 13,
    letterSpacing: 1.6,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
  },
  body: {
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500' as const,
  },
  label: {
    fontFamily,
    fontSize: 12,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
  },
};

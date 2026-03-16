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
    fontSize: 24,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
  },
  body: {
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
  },
  label: {
    fontFamily,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
  },
};


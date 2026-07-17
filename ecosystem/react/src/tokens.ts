/** My Ride design tokens — generated from design-system/tokens.json */

export const colors = {
  brand: {
    primary: '#0D9488',
    primaryDark: '#0F766E',
    primaryLight: '#F0FDFA',
    primaryMuted: '#99F6E4',
  },
  semantic: {
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#3B82F6',
  },
  surface: {
    background: '#F8FAFC',
    card: '#FFFFFF',
    elevated: '#FFFFFF',
    driverDark: '#0F172A',
    driverPanel: '#1E293B',
    dispatcherMap: '#1E3A4C',
  },
  text: {
    primary: '#0F172A',
    secondary: '#64748B',
    tertiary: '#94A3B8',
    inverse: '#F8FAFC',
    onBrand: '#FFFFFF',
    link: '#0D9488',
  },
  border: {
    default: '#E2E8F0',
    focus: '#0D9488',
    error: '#EF4444',
  },
  map: {
    route: '#0D9488',
    pickup: '#10B981',
    dropoff: '#F59E0B',
  },
} as const;

export const typography = {
  fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
  fontSize: {
    display: 32,
    h1: 24,
    h2: 20,
    h3: 17,
    body: 15,
    bodyLg: 16,
    caption: 13,
    overline: 11,
  },
  fontWeight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.4,
    relaxed: 1.6,
  },
} as const;

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  14: 56,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 28,
  full: 9999,
} as const;

export const size = {
  touchMin: 44,
  buttonHeight: 56,
  buttonHeightSm: 40,
  inputHeight: 52,
  bottomNav: 56,
} as const;

export const shadow = {
  sm: '0 1px 2px rgba(15, 23, 42, 0.06)',
  md: '0 4px 8px rgba(15, 23, 42, 0.12)',
  lg: '0 8px 24px rgba(15, 23, 42, 0.15)',
} as const;

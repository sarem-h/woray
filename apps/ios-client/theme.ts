import { Platform } from 'react-native';

export const colors = {
  // Background gradient stops (idle)
  bgTop:    '#0B0F1E',
  bgMid:    '#161B33',
  bgBottom: '#0F1424',

  // Glass surface (base layer, behind blur)
  glassSurface:     'rgba(255, 255, 255, 0.08)',
  glassSurfaceHigh: 'rgba(255, 255, 255, 0.12)',
  glassBorder:      'rgba(255, 255, 255, 0.14)',

  // Specular highlight (top of glass)
  specularTop: 'rgba(255, 255, 255, 0.22)',
  specularBot: 'rgba(255, 255, 255, 0.00)',

  // Text
  textPrimary:   '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.62)',
  textTertiary:  'rgba(255, 255, 255, 0.40)',

  // Accents per state
  accentReady:      '#5BE59B', // green breathing dot
  accentConnecting: '#5B8FFF', // blue
  accentListening:  '#7B8FFF', // indigo
  accentSpeaking:   '#FF7A9C', // warm pink
  accentError:      '#FF5C5C',

  // Accent gradient pairs (used in glow, waveform, ring)
  gradientConnecting: ['#5B8FFF', '#5BE5FF'] as const,
  gradientListening:  ['#5B8FFF', '#8B7FFF'] as const,
  gradientSpeaking:   ['#FF7A9C', '#FFB347'] as const,
  gradientError:      ['#FF5C5C', '#FF7A7A'] as const,

  // Shadow under glass panels
  shadowGlass: 'rgba(0, 0, 0, 0.45)',
} as const;

export const blur = {
  // expo-blur intensity (0-100)
  panel: 70,
  ribbon: 50,
  background: 90,
  tint: 'dark' as const,
} as const;

export const radius = {
  pill:   999,
  card:   32,   // squircle feel
  ribbon: 22,
  small:  16,
} as const;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 40,
} as const;

export const typography = {
  // Use system font (SF Pro on iOS). Do not bundle custom fonts.
  display:    { fontFamily: Platform.select({ ios: 'System', default: undefined }), fontSize: 34, fontWeight: '700' as const, letterSpacing: -0.6 },
  title:      { fontFamily: Platform.select({ ios: 'System', default: undefined }), fontSize: 24, fontWeight: '600' as const, letterSpacing: -0.3 },
  body:       { fontFamily: Platform.select({ ios: 'System', default: undefined }), fontSize: 17, fontWeight: '500' as const, letterSpacing: -0.2 },
  transcript: { fontFamily: Platform.select({ ios: 'System', default: undefined }), fontSize: 15, fontWeight: '400' as const, letterSpacing: -0.1 },
  caption:    { fontFamily: Platform.select({ ios: 'System', default: undefined }), fontSize: 13, fontWeight: '500' as const, letterSpacing: 0.2 },
} as const;

export const springs = {
  // Shared spring for state transitions
  state:   { damping: 20, stiffness: 180, mass: 0.8 },
  press:   { damping: 15, stiffness: 400, mass: 0.6 },
  breathe: { damping: 12, stiffness: 30,  mass: 1.2 },
  ribbon:  { damping: 18, stiffness: 220, mass: 0.7 },
} as const;

export const motion = {
  breatheDuration:   3000,  // ms, idle breathing loop
  pressSquish:       0.96,  // scale on press
  waveBarDuration:   420,   // ms, per-bar waveform oscillation
  waveBarStagger:    80,    // ms, offset per bar
  connectingRipple:  1400,  // ms per ripple cycle
} as const;

export const NATIVE_THEMES = ['source', 'pixel', 'flat', 'anime', 'premium'] as const;
export type NativeTheme = typeof NATIVE_THEMES[number];
/** Public, request-scoped theme settings. Never contains source/admin credentials. */
export interface PresentationContext {
  theme: string;
  nativeTheme?: NativeTheme;
  settings: Record<string, unknown>;
}

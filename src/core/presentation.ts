export const NATIVE_THEMES = ['source', 'pixel', 'flat', 'anime', 'premium'] as const;
export type NativeTheme = string;
/** Upstream accepts theme identifiers; presets are not a capability allowlist. */
export function isNativeTheme(value:unknown):value is NativeTheme{return typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value);}
/** Public, request-scoped theme settings. Never contains source/admin credentials. */
export interface PresentationContext {
  theme: string;
  nativeTheme?: NativeTheme;
  settings: Record<string, unknown>;
}

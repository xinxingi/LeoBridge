/** Public, request-scoped theme settings. Never contains source/admin credentials. */
export interface PresentationContext {
  theme: string;
  settings: Record<string, unknown>;
}

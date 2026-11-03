export class BridgeError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
export function safeError(error: unknown): BridgeError {
  if (error instanceof BridgeError) return error;
  if (error && typeof error === 'object' && 'status' in error && error.status === 409) {
    return new BridgeError('IDENTITY_CONFLICT', 409, '服务器身份无法唯一匹配，请检查服务端绑定配置。');
  }
  return new BridgeError('INTERNAL_ERROR', 500, '桥接器内部错误。');
}

import type { WebSocket } from 'ws';
import type { Socket } from '../core/socket.ts';

/** Register before the handshake: ws can emit open and the first frame in one turn. */
export function sourceSocket(ws: WebSocket): Socket {
  let pending: string[] = [], bytes = 0, stopped = false, closed = false, failed = false;
  let message: ((data: string) => void) | undefined;
  let close: (() => void) | undefined, error: (() => void) | undefined;
  ws.on('message', data => {
    if (stopped) return;
    const text = data.toString();
    if (message) { message(text); return; }
    bytes += Buffer.byteLength(text);
    if (pending.length >= 64 || bytes > 12_000_000) {
      stopped = true; pending = []; bytes = 0; failed = true;
      ws.close(1009, 'initial source buffer exceeded');
      error?.();
      return;
    }
    pending.push(text);
  });
  ws.on('close', () => { closed = true; close?.(); });
  ws.on('error', () => { failed = true; error?.(); });
  return {
    send: data => ws.send(data),
    close: (code, reason) => {
      stopped = true; pending = []; bytes = 0; ws.close(code, reason);
    },
    onMessage: callback => {
      // Let the consumer register close/error handlers before replaying early frames.
      queueMicrotask(() => {
        if (stopped) return;
        message = callback;
        const frames = pending; pending = []; bytes = 0;
        for (const frame of frames) { if (stopped) break; callback(frame); }
      });
    },
    onClose: callback => { close = callback; if (closed) queueMicrotask(callback); },
    onError: callback => { error = callback; if (failed) queueMicrotask(callback); },
  };
}

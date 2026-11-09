import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { DiscordAuthError, resolveBearerUser } from './discord.js';

export type RealtimeEvent =
  | {
      type: 'emergency_stop';
      ownerDiscordUserId: string;
      shockerId: number;
      engaged: boolean;
      emergencyStopShockerIds: number[];
      at: number;
    }
  | {
      type: 'activity_share_changed';
      ownerDiscordUserId: string;
      at: number;
    }
  | {
      type: 'participants_invalidate';
      reason?: string;
      at: number;
    }
  | {
      type: 'hello_ok';
      discordUserId: string;
      at: number;
    }
  | {
      type: 'ping';
      at: number;
    };

type RealtimeClient = {
  ws: WebSocket;
  discordUserId: string;
  instanceId: string | null;
};

const clients = new Set<RealtimeClient>();

function pathOnly(url: string | undefined): string {
  if (!url) return '';
  return url.split('?')[0] ?? url;
}

function isRealtimePath(pathname: string): boolean {
  return (
    pathname === '/api/ws' ||
    pathname === '/.proxy/api/ws' ||
    pathname.endsWith('/api/ws')
  );
}

function extractToken(req: IncomingMessage): string | null {
  try {
    const host = req.headers.host ?? 'localhost';
    const url = new URL(req.url ?? '/', `http://${host}`);
    const fromQuery = url.searchParams.get('access_token') ?? url.searchParams.get('token');
    if (fromQuery) return fromQuery;
  } catch {
    // ignore
  }
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim() || null;
  }
  return null;
}

function send(ws: WebSocket, event: RealtimeEvent) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(event));
}

export function broadcastRealtime(event: RealtimeEvent, filter?: {
  instanceId?: string | null;
  discordUserId?: string;
}) {
  for (const client of clients) {
    if (filter?.discordUserId && client.discordUserId !== filter.discordUserId) continue;
    if (filter?.instanceId && client.instanceId && client.instanceId !== filter.instanceId) {
      // Still deliver instance-scoped events to clients that haven't joined an instance yet
      // only when they match user filter; otherwise require same instance when both set.
      if (!filter.discordUserId) continue;
    }
    send(client.ws, event);
  }
}

/** Fan-out to every connected activity client (small N; Discord activity scale). */
export function broadcastRealtimeAll(event: RealtimeEvent) {
  const payload = JSON.stringify(event);
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

export function attachRealtime(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const pathname = pathOnly(req.url);
    if (!isRealtimePath(pathname)) {
      return;
    }

    void (async () => {
      const token = extractToken(req);
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      let discordUserId: string;
      try {
        const user = await resolveBearerUser(token);
        discordUserId = user.id;
      } catch (err) {
        const status = err instanceof DiscordAuthError ? err.status : 401;
        socket.write(`HTTP/1.1 ${status} Unauthorized\r\nConnection: close\r\n\r\n`);
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        const client: RealtimeClient = {
          ws,
          discordUserId,
          instanceId: null,
        };
        clients.add(client);
        send(ws, { type: 'hello_ok', discordUserId, at: Date.now() });

        ws.on('message', (raw) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(String(raw));
          } catch {
            return;
          }
          if (!parsed || typeof parsed !== 'object') return;
          const msg = parsed as { type?: string; instanceId?: string };
          if (msg.type === 'join' && typeof msg.instanceId === 'string' && msg.instanceId) {
            client.instanceId = msg.instanceId;
            send(ws, { type: 'hello_ok', discordUserId, at: Date.now() });
          }
          if (msg.type === 'ping') {
            send(ws, { type: 'ping', at: Date.now() });
          }
        });

        ws.on('close', () => {
          clients.delete(client);
        });
        ws.on('error', () => {
          clients.delete(client);
        });
      });
    })();
  });

  const pingTimer = setInterval(() => {
    const at = Date.now();
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        send(client.ws, { type: 'ping', at });
      }
    }
  }, 25_000);
  pingTimer.unref?.();

  server.on('close', () => {
    clearInterval(pingTimer);
    wss.close();
  });
}

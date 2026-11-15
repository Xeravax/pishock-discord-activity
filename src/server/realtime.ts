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
      ownerUsername?: string | null;
      ownerGlobalName?: string | null;
      /** What changed — clients may show a notice for limits/share edits. */
      reason?: 'limits' | 'availability' | 'shares';
      at: number;
    }
  | {
      type: 'participants_invalidate';
      reason?: string;
      at: number;
    }
  | {
      /** Someone just operated on this user's shared shockers — for PIP last-hit UI */
      type: 'incoming_command';
      targetDiscordUserId: string;
      executorDiscordUserId: string;
      executorUsername: string | null;
      executorGlobalName: string | null;
      executorAvatar: string | null;
      action: string;
      shockerId: number;
      intensity: number;
      durationMs: number;
      success: boolean;
      at: number;
    }
  | {
      /** Wearer's own command queue snapshot (never broadcast to the whole activity). */
      type: 'queue_state';
      ownerDiscordUserId: string;
      enabled: boolean;
      /** Minimum ms before the next queue item may start. */
      progressMs: number;
      maxPerSender: number;
      starOnly: boolean;
      paused: boolean;
      halted: boolean;
      active: {
        id: string;
        executorDiscordUserId: string;
        executorUsername: string | null;
        executorGlobalName: string | null;
        executorAvatar: string | null;
        operation: string;
        intensity: number;
        durationMs: number;
        hold: boolean;
        warning: boolean;
        shockerId: number;
        enqueuedAt: number;
        priority: boolean;
      } | null;
      waiting: Array<{
        id: string;
        executorDiscordUserId: string;
        executorUsername: string | null;
        executorGlobalName: string | null;
        executorAvatar: string | null;
        operation: string;
        intensity: number;
        durationMs: number;
        hold: boolean;
        warning: boolean;
        shockerId: number;
        enqueuedAt: number;
        priority: boolean;
      }>;
      next: {
        id: string;
        executorDiscordUserId: string;
        executorUsername: string | null;
        executorGlobalName: string | null;
        executorAvatar: string | null;
        operation: string;
        intensity: number;
        durationMs: number;
        hold: boolean;
        warning: boolean;
        shockerId: number;
        enqueuedAt: number;
        priority: boolean;
      } | null;
      nextStartsInMs: number | null;
      nextEstimatedStartAt: number | null;
      at: number;
    }
  | {
      /** Sender's place in a wearer's queue. */
      type: 'queue_ticket';
      ownerDiscordUserId: string;
      executorDiscordUserId: string;
      itemId: string;
      status: 'queued' | 'started' | 'done' | 'removed' | 'failed';
      position: number | null;
      paused: boolean;
      estimatedWaitMs: number | null;
      estimatedStartAt: number | null;
      at: number;
    }
  | {
      type: 'hello_ok';
      discordUserId: string;
      at: number;
    }
  | {
      type: 'auth_required';
      at: number;
    }
  | {
      type: 'ping';
      at: number;
    }
  | {
      type: 'server_shutting_down';
      at: number;
    };

type RealtimeClient = {
  ws: WebSocket;
  discordUserId: string;
  instanceId: string | null;
};

const clients = new Set<RealtimeClient>();
const AUTH_TIMEOUT_MS = 5_000;

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

/** Prefer Authorization header; query-string tokens are legacy fallback only. */
function extractToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim() || null;
  }
  try {
    const host = req.headers.host ?? 'localhost';
    const url = new URL(req.url ?? '/', `http://${host}`);
    const fromQuery = url.searchParams.get('access_token') ?? url.searchParams.get('token');
    if (fromQuery) return fromQuery;
  } catch {
    // ignore
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

function attachAuthenticatedClient(ws: WebSocket, discordUserId: string) {
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
}

export function attachRealtime(server: HttpServer): () => void {
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (
    req: IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ) => {
    const pathname = pathOnly(req.url);
    if (!isRealtimePath(pathname)) {
      return;
    }

    console.info(`[realtime] upgrade ${pathname} clients=${clients.size}`);

    void (async () => {
      const token = extractToken(req);

      if (token) {
        let discordUserId: string;
        try {
          const user = await resolveBearerUser(token);
          discordUserId = user.id;
        } catch (err) {
          const status = err instanceof DiscordAuthError ? err.status : 401;
          console.warn(`[realtime] upgrade auth failed status=${status}`);
          socket.write(`HTTP/1.1 ${status} Unauthorized\r\nConnection: close\r\n\r\n`);
          socket.destroy();
          return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
          attachAuthenticatedClient(ws, discordUserId);
        });
        return;
      }

      // No query/header token — accept and require a first-message auth frame
      wss.handleUpgrade(req, socket, head, (ws) => {
        let authed = false;
        const timeout = setTimeout(() => {
          if (!authed) {
            console.warn('[realtime] auth timeout — closing socket');
            try {
              ws.close(4401, 'auth timeout');
            } catch {
              // ignore
            }
          }
        }, AUTH_TIMEOUT_MS);
        timeout.unref?.();

        send(ws, { type: 'auth_required', at: Date.now() });

        ws.on('message', (raw) => {
          if (authed) return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(String(raw));
          } catch {
            return;
          }
          if (!parsed || typeof parsed !== 'object') return;
          const msg = parsed as { type?: string; access_token?: string; token?: string };
          if (msg.type !== 'auth') return;
          const accessToken = String(msg.access_token ?? msg.token ?? '').trim();
          if (!accessToken) {
            ws.close(4401, 'missing token');
            return;
          }
          void resolveBearerUser(accessToken)
            .then((user) => {
              if (authed) return;
              authed = true;
              clearTimeout(timeout);
              // Replace listeners by attaching the authenticated client handlers
              ws.removeAllListeners('message');
              attachAuthenticatedClient(ws, user.id);
              console.info(`[realtime] authed ${user.id} clients=${clients.size}`);
            })
            .catch((err) => {
              console.warn(
                `[realtime] first-message auth failed: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
              try {
                ws.close(4401, 'unauthorized');
              } catch {
                // ignore
              }
            });
        });

        ws.on('close', () => {
          clearTimeout(timeout);
        });
      });
    })();
  };

  server.on('upgrade', onUpgrade);

  const pingTimer = setInterval(() => {
    const at = Date.now();
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        send(client.ws, { type: 'ping', at });
      }
    }
  }, 25_000);
  pingTimer.unref?.();

  const onHttpClose = () => {
    clearInterval(pingTimer);
    wss.close();
  };
  server.on('close', onHttpClose);

  return () => {
    clearInterval(pingTimer);
    server.off('upgrade', onUpgrade);
    server.off('close', onHttpClose);
    for (const client of [...clients]) {
      try {
        client.ws.close(1001, 'server shutting down');
      } catch {
        // ignore
      }
    }
    clients.clear();
    try {
      wss.close();
    } catch {
      // ignore
    }
  };
}

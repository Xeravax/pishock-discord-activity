import { apiBase } from './api';
import { getActivityInstanceId } from './discord';

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
      type: 'hello_ok';
      discordUserId: string;
      at: number;
    }
  | {
      type: 'ping';
      at: number;
    };

function wsUrl(accessToken: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // apiBase() is "/.proxy/api" or "/api" — strip trailing path to build WS path
  const api = apiBase(); // e.g. /.proxy/api
  const path = `${api}/ws`;
  const url = new URL(`${proto}//${window.location.host}${path}`);
  url.searchParams.set('access_token', accessToken);
  return url.toString();
}

export type RealtimeHandle = {
  close: () => void;
};

/**
 * Live activity panel channel through Discord's proxy (WebSocket-supported).
 * Reconnects with backoff while the token is valid.
 */
export function connectRealtime(
  accessToken: string,
  onEvent: (event: RealtimeEvent) => void,
): RealtimeHandle {
  let closed = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let attempt = 0;
  let pingTimer: number | null = null;

  const clearTimers = () => {
    if (reconnectTimer != null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pingTimer != null) {
      window.clearInterval(pingTimer);
      pingTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (closed) return;
    const delay = Math.min(15_000, 800 * 2 ** attempt);
    attempt += 1;
    reconnectTimer = window.setTimeout(open, delay);
  };

  const open = () => {
    if (closed) return;
    clearTimers();
    try {
      ws = new WebSocket(wsUrl(accessToken));
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      attempt = 0;
      const instanceId = getActivityInstanceId();
      if (instanceId) {
        ws?.send(JSON.stringify({ type: 'join', instanceId }));
      }
      pingTimer = window.setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 20_000);
    };

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as RealtimeEvent;
        if (data && typeof data === 'object' && 'type' in data) {
          onEvent(data);
        }
      } catch {
        // ignore malformed
      }
    };

    ws.onclose = () => {
      clearTimers();
      ws = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      // close handler reconnects
      try {
        ws?.close();
      } catch {
        // ignore
      }
    };
  };

  open();

  return {
    close: () => {
      closed = true;
      clearTimers();
      try {
        ws?.close();
      } catch {
        // ignore
      }
      ws = null;
    },
  };
}

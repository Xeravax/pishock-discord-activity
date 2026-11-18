import { apiBase } from './api';
import { getActivityInstanceId } from './discord';
import type { ApprovalRequest } from './safety';

export type AppNotice = { text: string; level: 'info' | 'warning'; expiresAt: string | null; updatedAt: string };

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
      reason?: 'limits' | 'availability' | 'shares';
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
      type: 'queue_state';
      ownerDiscordUserId: string;
      enabled: boolean;
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
  | ({ type: 'approval_request' } & Omit<ApprovalRequest, never>)
  | {
      type: 'approval_resolved';
      approvalId: string;
      ownerDiscordUserId: string;
      executorDiscordUserId: string;
      outcome: 'accepted' | 'denied' | 'expired' | 'canceled';
      at: number;
    }
  | {
      type: 'global_ban';
      ban: { id: string; reason: string; createdAt: string; expiresAt: string | null };
      at: number;
    }
  | { type: 'app_notice'; notice: AppNotice | null; at: number }
  | { type: 'checkin_due'; ownerDiscordUserId: string; deadline: number; at: number }
  | { type: 'checkin_missed'; ownerDiscordUserId: string; at: number }
  | {
      type: 'budget_exhausted';
      ownerDiscordUserId: string;
      usedShocks: number;
      usedShockMs: number;
      at: number;
    }
  | {
      /** Wearer: an admin bypassed your gates / limits for this command (always shown, red). */
      type: 'admin_bypass';
      targetDiscordUserId: string;
      adminDiscordUserId: string;
      adminName: string | null;
      action: string;
      intensity: number;
      durationMs: number;
      gates: string[];
      at: number;
    }
  | {
      /** Room vote: someone wants to spin the roulette wheel on a participant. */
      type: 'roulette_vote_open';
      voteId: string;
      targetDiscordUserId: string;
      starterDiscordUserId: string;
      actions: string[];
      endsAt: number;
      at: number;
    }
  | {
      type: 'roulette_vote_closed';
      voteId: string;
      targetDiscordUserId: string;
      outcome: 'passed' | 'failed' | 'vetoed' | 'canceled';
      yes: number;
      no: number;
      at: number;
    }
  | {
      /** Identical for every viewer: same segments, result and start time. */
      type: 'roulette_spin';
      spinId: string;
      targetDiscordUserId: string;
      starterDiscordUserId: string;
      segments: Array<{ action: 'shock' | 'vibrate' | 'beep' | 'safe'; intensity: number; durationMs: number }>;
      resultIndex: number;
      startAt: number;
      spinMs: number;
      at: number;
    }
  | {
      type: 'roulette_result';
      spinId: string;
      targetDiscordUserId: string;
      outcome: 'sent' | 'queued' | 'safe' | 'refused';
      message: string | null;
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

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const api = apiBase(); // /api — Discord maps this and signs the upgrade
  const path = `${api}/ws`;
  return `${proto}//${window.location.host}${path}`;
}

export type RealtimeHandle = {
  close: () => void;
};

/**
 * Live activity panel channel through Discord's proxy (WebSocket-supported).
 * Authenticates with a first-message token so the Discord access token stays out of the URL.
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
  let authed = false;

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

  const sendAuthAndJoin = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'auth', access_token: accessToken }));
  };

  const afterAuth = () => {
    authed = true;
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

  const open = () => {
    if (closed) return;
    clearTimers();
    authed = false;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      // Send auth immediately; server may also emit auth_required
      sendAuthAndJoin();
    };

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as RealtimeEvent;
        if (!data || typeof data !== 'object' || !('type' in data)) return;
        if (data.type === 'auth_required') {
          sendAuthAndJoin();
          return;
        }
        if (data.type === 'hello_ok' && !authed) {
          afterAuth();
        }
        if (data.type === 'global_ban') {
          // Banned from the app: the server closes the socket; don't keep reconnecting.
          closed = true;
        }
        onEvent(data);
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

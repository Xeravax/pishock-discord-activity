import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { PISHOCK_LOGIN, PISHOCK_RELAY, RELAY_LOGIN_TIMEOUT_MS } from '../../shared/constants.js';

export type RelayCredentials = { UserId: number; Token: string };

type PendingLogin = {
  channel: string;
  loginUrl: string;
  promise: Promise<RelayCredentials>;
  resolve: (value: RelayCredentials) => void;
  reject: (reason: Error) => void;
  createdAt: number;
  settled: boolean;
};

const pendingByDiscordUser = new Map<string, PendingLogin>();

export function getPendingLogin(discordUserId: string) {
  return pendingByDiscordUser.get(discordUserId);
}

export async function startRelayLogin(discordUserId: string): Promise<{ channel: string; loginUrl: string }> {
  const existing = pendingByDiscordUser.get(discordUserId);
  if (existing && !existing.settled) {
    return { channel: existing.channel, loginUrl: existing.loginUrl };
  }

  const channel = randomUUID();
  const loginUrl = `${PISHOCK_LOGIN}?proto=socket&channel=${channel}`;

  let resolve!: (value: RelayCredentials) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<RelayCredentials>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const pending: PendingLogin = {
    channel,
    loginUrl,
    promise,
    resolve,
    reject,
    createdAt: Date.now(),
    settled: false,
  };
  pendingByDiscordUser.set(discordUserId, pending);

  const ws = new WebSocket(`${PISHOCK_RELAY}/${channel}`);
  const timeout = setTimeout(() => {
    settleReject(pending, new Error('PiShock login timed out'));
    try {
      ws.close();
    } catch {
      // ignore
    }
  }, RELAY_LOGIN_TIMEOUT_MS);

  ws.on('message', (data) => {
    const text = data.toString();
    if (text.trim().toLowerCase() === 'connected.') {
      return;
    }
    try {
      const parsed = JSON.parse(text) as { UserId?: number; Token?: string };
      if (typeof parsed.UserId === 'number' && typeof parsed.Token === 'string') {
        clearTimeout(timeout);
        settleResolve(pending, { UserId: parsed.UserId, Token: parsed.Token });
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore non-json
    }
  });

  ws.on('error', (err) => {
    clearTimeout(timeout);
    settleReject(pending, err instanceof Error ? err : new Error(String(err)));
  });

  ws.on('close', () => {
    clearTimeout(timeout);
    if (!pending.settled) {
      settleReject(pending, new Error('PiShock relay closed before credentials arrived'));
    }
  });

  await waitForConnected(ws);

  return { channel, loginUrl };
}

export async function awaitRelayLogin(discordUserId: string): Promise<RelayCredentials> {
  const pending = pendingByDiscordUser.get(discordUserId);
  if (!pending) {
    throw new Error('No PiShock login in progress');
  }
  return pending.promise;
}

function isRelayConnectedMessage(text: string): boolean {
  return text.trim().toLowerCase() === 'connected.';
}

function waitForConnected(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      if (isRelayConnectedMessage(data.toString())) {
        cleanup();
        resolve();
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('Relay closed before connected.'));
    };
    const cleanup = () => {
      ws.off('message', onMessage);
      ws.off('error', onError);
      ws.off('close', onClose);
    };
    ws.on('message', onMessage);
    ws.on('error', onError);
    ws.on('close', onClose);
    if (ws.readyState === WebSocket.OPEN) {
      // still wait for connected. text
    }
  });
}

function settleResolve(pending: PendingLogin, value: RelayCredentials) {
  if (pending.settled) return;
  pending.settled = true;
  pending.resolve(value);
}

function settleReject(pending: PendingLogin, err: Error) {
  if (pending.settled) return;
  pending.settled = true;
  pending.reject(err);
}

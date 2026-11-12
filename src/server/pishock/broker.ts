import WebSocket from 'ws';
import { AGENT_NAME, PISHOCK_BROKER, ShockerOp } from '../../shared/constants.js';
import { ingestBrokerDeviceLog } from './broker-log-ingest.js';
import { isPiShockApiKeyRejected, redactPiShockSecrets, type PiShockCreds } from './client.js';

export type BrokerEvent =
  | { type: 'online'; clientId: string; online: boolean; at: number }
  | { type: 'log'; clientId: string; payload: unknown; at: number }
  | { type: 'status'; message: string; at: number };

type Subscriber = (event: BrokerEvent) => void;

type PendingPublish = {
  payload: string;
  resolve: (ok: boolean) => void;
};

type BrokerSession = {
  ws: WebSocket | null;
  creds: PiShockCreds;
  clientIds: Set<string>;
  subscribers: Set<Subscriber>;
  online: Map<string, boolean>;
  lastSeenAt: Map<string, number>;
  reconnectTimer?: NodeJS.Timeout;
  /** PiShock closes a quiet socket. Pings keep it open until they do. */
  keepAliveTimer?: NodeJS.Timeout;
  reconnectAttempt: number;
  idleTimer?: NodeJS.Timeout;
  logCapture?: Subscriber;
  logCaptureTouchAt?: number;
  logCaptureIdleTimer?: NodeJS.Timeout;
  /** One publish at a time so each ack matches the command that was just sent. */
  publishQueue: PendingPublish[];
  publishActive: { resolve: (ok: boolean) => void; timer: NodeJS.Timeout } | null;
  publishPumping: boolean;
};

function blankSession(creds: PiShockCreds): BrokerSession {
  return {
    ws: null,
    creds,
    clientIds: new Set(),
    subscribers: new Set(),
    online: new Map(),
    lastSeenAt: new Map(),
    publishQueue: [],
    publishActive: null,
    publishPumping: false,
    reconnectAttempt: 0,
  };
}

const sessions = new Map<string, BrokerSession>();
/** Stay under PiShock's idle disconnect. They close the socket; we do not. */
const BROKER_KEEPALIVE_MS = 20_000;
/** Keep `-log` capture warm between Discord activity polls without holding forever. */
const LOG_CAPTURE_IDLE_MS = 15 * 60 * 1000;

/** PiShock's broker accepts credentials only on this query string. */
function brokerUrl(creds: PiShockCreds): string {
  return `${PISHOCK_BROKER}?Username=${encodeURIComponent(creds.username)}&ApiKey=${encodeURIComponent(creds.token)}`;
}

/** Swap credentials. A new token closes the old socket without letting its close clear a replacement. */
function replaceSessionCreds(session: BrokerSession, creds: PiShockCreds): void {
  const tokenChanged = session.creds.token !== creds.token;
  session.creds = creds;
  if (!tokenChanged) return;
  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = undefined;
  }
  // The command already sent on the old socket will not be acked there.
  finishActivePublish(session, false, { pump: false });
  const old = session.ws;
  session.ws = null;
  if (old) {
    try {
      old.close();
    } catch {
      // ignore
    }
  }
  const id = idForSession(session);
  if (id && session.publishQueue.length > 0) void pumpPublishes(id);
}

export function subscribeBroker(
  discordUserId: string,
  creds: PiShockCreds,
  clientIds: string[],
  subscriber: Subscriber,
): () => void {
  if (isPiShockApiKeyRejected(creds.token)) {
    disconnectBroker(discordUserId);
    return () => {};
  }
  let session = sessions.get(discordUserId);
  if (!session) {
    session = blankSession(creds);
    sessions.set(discordUserId, session);
  } else {
    replaceSessionCreds(session, creds);
  }
  clearIdleTimer(session);
  session.subscribers.add(subscriber);

  const added = addClientIds(session, clientIds);

  ensureConnected(discordUserId);
  if (added.length && session.ws?.readyState === WebSocket.OPEN) {
    subscribeTargets(session, added);
  }

  for (const [clientId, online] of session.online) {
    subscriber({ type: 'online', clientId, online, at: Date.now() });
  }

  return () => {
    const current = sessions.get(discordUserId);
    if (!current) return;
    current.subscribers.delete(subscriber);
  };
}

function addClientIds(session: BrokerSession, clientIds: string[]): string[] {
  const added: string[] = [];
  for (const raw of clientIds) {
    const id = normalizeClientId(raw);
    if (!id) continue;
    if (!session.clientIds.has(id)) {
      session.clientIds.add(id);
      added.push(id);
    }
  }
  return added;
}

function clearIdleTimer(session: BrokerSession) {
  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = undefined;
  }
}

function clearLogCaptureIdleTimer(session: BrokerSession) {
  if (session.logCaptureIdleTimer) {
    clearTimeout(session.logCaptureIdleTimer);
    session.logCaptureIdleTimer = undefined;
  }
}

function scheduleLogCaptureIdle(discordUserId: string) {
  const session = sessions.get(discordUserId);
  if (!session?.logCapture) return;
  clearLogCaptureIdleTimer(session);
  session.logCaptureIdleTimer = setTimeout(() => {
    stopLogCapture(discordUserId);
  }, LOG_CAPTURE_IDLE_MS);
  session.logCaptureIdleTimer.unref?.();
}

/**
 * Keep a sticky broker subscriber that persists live `{clientId}-log` frames.
 * PiShock website history is ephemeral — this is the maintained capture path.
 */
export function ensureLogCapture(
  discordUserId: string,
  creds: PiShockCreds,
  clientIds: string[],
) {
  if (isPiShockApiKeyRejected(creds.token)) {
    disconnectBroker(discordUserId);
    return;
  }
  let session = sessions.get(discordUserId);
  if (!session) {
    session = blankSession(creds);
    sessions.set(discordUserId, session);
  } else {
    replaceSessionCreds(session, creds);
  }

  session.logCaptureTouchAt = Date.now();
  clearIdleTimer(session);
  addClientIds(session, clientIds);

  if (!session.logCapture) {
    const capture: Subscriber = (event) => {
      if (event.type !== 'log') return;
      void ingestBrokerDeviceLog(discordUserId, {
        clientId: event.clientId,
        payload: event.payload,
        at: event.at,
      }).catch((err) => {
        console.warn(
          '[broker] log ingest failed',
          redactPiShockSecrets(err instanceof Error ? err.message : String(err)),
        );
      });
    };
    session.logCapture = capture;
    session.subscribers.add(capture);
  }

  ensureConnected(discordUserId);
  if (session.ws?.readyState === WebSocket.OPEN) {
    subscribeTargets(session, [...session.clientIds]);
  }
  scheduleLogCaptureIdle(discordUserId);
}

export function stopLogCapture(discordUserId: string) {
  const session = sessions.get(discordUserId);
  if (!session?.logCapture) return;
  clearLogCaptureIdleTimer(session);
  session.subscribers.delete(session.logCapture);
  session.logCapture = undefined;
  session.logCaptureTouchAt = undefined;
}

/**
 * Short-lived online probe for Discord Activity proxy (SSE gets 524).
 * Keeps the broker socket warm and returns the current online map.
 */
export async function probeOnlineStatus(
  discordUserId: string,
  creds: PiShockCreds,
  clientIds: string[],
  waitMs = 2500,
): Promise<{ online: Record<string, boolean>; lastSeenAt: Record<string, number> }> {
  const ids = clientIds.map((id) => normalizeClientId(id)).filter((id): id is string => Boolean(id));
  let resolveReady: (() => void) | null = null;
  const sawUpdate = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const unsub = subscribeBroker(discordUserId, creds, ids, (event) => {
    if (event.type === 'online') resolveReady?.();
  });

  const session = sessions.get(discordUserId);
  if (session?.ws?.readyState === WebSocket.OPEN) {
    // Re-subscribe so hubs emit a fresh ping frame if they are alive
    subscribeTargets(session, ids.length ? ids : [...session.clientIds]);
    safeSend(session.ws, JSON.stringify({ Operation: 'PING' }));
  }

  const wait = Math.max(0, Math.min(8_000, waitMs));
  await Promise.race([
    sawUpdate,
    new Promise<void>((resolve) => setTimeout(resolve, wait)),
  ]);

  unsub();
  const online = getOnlineMap(discordUserId);
  const lastSeenAt: Record<string, number> = {};
  const current = sessions.get(discordUserId);
  if (current) {
    for (const [id, at] of current.lastSeenAt) lastSeenAt[id] = at;
  }
  return { online, lastSeenAt };
}

function normalizeClientId(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  let id = String(raw).trim();
  if (!id) return null;
  // Publish channels use c{id}-ops; ping channels are usually {id}-ping.
  // Keep a bare numeric/string id as the canonical map key.
  if (/^c\d+$/i.test(id)) id = id.slice(1);
  return id;
}

function pingTargetsFor(clientId: string): string[] {
  const bare = normalizeClientId(clientId) ?? clientId;
  return [`${bare}-ping`, `${bare}-log`, `c${bare}-ping`, `c${bare}-log`];
}

function subscribeTargets(session: BrokerSession, clientIds: string[]) {
  if (!session.ws || session.ws.readyState !== WebSocket.OPEN) return;
  const targets = clientIds.flatMap((id) => pingTargetsFor(id));
  if (targets.length === 0) return;
  safeSend(session.ws, JSON.stringify({ Operation: 'SUBSCRIBE', Targets: targets }));
}

export function getOnlineMap(discordUserId: string): Record<string, boolean> {
  const session = sessions.get(discordUserId);
  if (!session) return {};
  return Object.fromEntries(session.online.entries());
}

/**
 * Publish via broker (hold / warning / emergency stop).
 * Matches pishock.com control page: owned devices use ty "ow", shares use "sc".
 * Body i/d are numbers; emergency stop is m:"e", i:0, d:0.
 */
export async function publishOperate(
  creds: PiShockCreds,
  input: {
    clientId: string | number;
    shockerId: number;
    operation: ShockerOp | 'e';
    intensity: number;
    durationMs: number;
    hold?: boolean;
    warning?: boolean;
    shareCode?: string;
    end?: boolean;
    agentName?: string;
  },
): Promise<boolean> {
  const mode = input.end || input.operation === 'e'
    ? 'e'
    : input.operation === ShockerOp.Shock
      ? 's'
      : input.operation === ShockerOp.Vibrate
        ? 'v'
        : 'b';
  const isEnd = mode === 'e';
  const target = input.shareCode
    ? `c${input.clientId}-sops-${input.shareCode}`
    : `c${input.clientId}-ops`;

  // Match pishock.com OperateV3 body shape exactly (numbers; owned ty "ow")
  const log: Record<string, unknown> = {
    u: Number(creds.userId),
    ty: input.shareCode ? 'sc' : 'ow',
  };
  if (input.warning) log.w = true;
  if (!isEnd && input.hold) log.h = true;
  if (input.agentName || isEnd) {
    log.o = input.agentName || (isEnd ? 'Emergency Stop' : AGENT_NAME);
  } else {
    log.o = AGENT_NAME;
  }

  const body = {
    id: Number(input.shockerId),
    m: mode,
    i: isEnd ? 0 : Number(input.intensity),
    d: isEnd ? 0 : Number(input.durationMs),
    r: true,
    l: log,
  };

  const payload = JSON.stringify({
    Operation: 'PUBLISH',
    PublishCommands: [{ Target: target, Body: body }],
  });

  return publishPayload(creds, payload);
}

function idForSession(session: BrokerSession): string | null {
  for (const [id, current] of sessions) {
    if (current === session) return id;
  }
  return null;
}

/** Prefer the socket already open for this API key. Otherwise keep one per PiShock account. */
function sessionForCreds(creds: PiShockCreds): { id: string; session: BrokerSession } {
  let fallback: { id: string; session: BrokerSession } | null = null;
  for (const [id, session] of sessions) {
    if (session.creds.token !== creds.token) continue;
    if (session.ws?.readyState === WebSocket.OPEN) {
      replaceSessionCreds(session, creds);
      return { id, session };
    }
    if (!fallback) fallback = { id, session };
  }
  if (fallback) {
    replaceSessionCreds(fallback.session, creds);
    return fallback;
  }
  const id = `pishock:${creds.userId}`;
  let session = sessions.get(id);
  if (!session) {
    session = blankSession(creds);
    sessions.set(id, session);
  } else {
    replaceSessionCreds(session, creds);
  }
  return { id, session };
}

function finishActivePublish(
  session: BrokerSession,
  ok: boolean,
  opts?: { pump?: boolean },
): void {
  const active = session.publishActive;
  if (!active) return;
  clearTimeout(active.timer);
  session.publishActive = null;
  active.resolve(ok);
  if (opts?.pump === false) return;
  const id = idForSession(session);
  if (id) void pumpPublishes(id);
}

function dropPendingPublishes(session: BrokerSession): void {
  finishActivePublish(session, false, { pump: false });
  const queued = session.publishQueue.splice(0, session.publishQueue.length);
  for (const job of queued) job.resolve(false);
}

function waitUntilOpen(id: string, session: BrokerSession): Promise<WebSocket | null> {
  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = undefined;
  }
  ensureConnected(id);
  const ws = session.ws;
  if (!ws) return Promise.resolve(null);
  if (ws.readyState === WebSocket.OPEN) return Promise.resolve(ws);
  if (ws.readyState !== WebSocket.CONNECTING) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (sock: WebSocket | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.off('open', onOpen);
      ws.off('close', onClose);
      ws.off('error', onError);
      resolve(sock);
    };
    const timer = setTimeout(() => finish(null), 8000);
    const onOpen = () => finish(ws);
    const onClose = () => finish(null);
    const onError = () => finish(null);
    ws.once('open', onOpen);
    ws.once('close', onClose);
    ws.once('error', onError);
  });
}

async function pumpPublishes(id: string): Promise<void> {
  const session = sessions.get(id);
  if (!session || session.publishActive || session.publishPumping) return;
  const next = session.publishQueue.shift();
  if (!next) return;
  session.publishPumping = true;
  const ws = await waitUntilOpen(id, session);
  const current = sessions.get(id);
  if (!current || current !== session) {
    session.publishPumping = false;
    next.resolve(false);
    return;
  }
  session.publishPumping = false;
  if (!ws || ws.readyState !== WebSocket.OPEN || session.ws !== ws) {
    next.resolve(false);
    void pumpPublishes(id);
    return;
  }
  const timer = setTimeout(() => finishActivePublish(session, false), 8000);
  session.publishActive = { resolve: next.resolve, timer };
  try {
    ws.send(next.payload);
  } catch (err) {
    console.warn(
      '[broker] publish send failed',
      redactPiShockSecrets(err instanceof Error ? err.message : String(err)),
    );
    finishActivePublish(session, false);
  }
}

function publishPayload(creds: PiShockCreds, payload: string): Promise<boolean> {
  if (isPiShockApiKeyRejected(creds.token)) return Promise.resolve(false);
  const { id, session } = sessionForCreds(creds);
  clearIdleTimer(session);
  return new Promise((resolve) => {
    session.publishQueue.push({ payload, resolve });
    void pumpPublishes(id);
  });
}

function isPublishSuccess(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes('publish successful') || lower.includes('publish success')) return true;
  try {
    const parsed = JSON.parse(text) as {
      IsError?: boolean;
      Message?: string;
      Command?: string;
      Payload?: unknown;
    };
    if (parsed.IsError === false && typeof parsed.Message === 'string') {
      const m = parsed.Message.toLowerCase();
      if (m.includes('publish successful') || m.includes('publish success')) return true;
    }
    if (parsed.Command === 'PUBLISH' && Array.isArray(parsed.Payload)) {
      return parsed.Payload.some((p) => String(p).toLowerCase().includes('publish success'));
    }
  } catch {
    // not JSON
  }
  return false;
}

function isPublishError(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { IsError?: boolean; Message?: string };
    return parsed.IsError === true;
  } catch {
    return false;
  }
}

function stopKeepAlive(session: BrokerSession) {
  if (!session.keepAliveTimer) return;
  clearInterval(session.keepAliveTimer);
  session.keepAliveTimer = undefined;
}

function startKeepAlive(id: string, session: BrokerSession, ws: WebSocket) {
  stopKeepAlive(session);
  session.keepAliveTimer = setInterval(() => {
    if (sessions.get(id) !== session || session.ws !== ws || ws.readyState !== WebSocket.OPEN) {
      stopKeepAlive(session);
      return;
    }
    safeSend(ws, JSON.stringify({ Operation: 'PING' }));
  }, BROKER_KEEPALIVE_MS);
  session.keepAliveTimer.unref?.();
}

function scheduleReconnect(id: string, session: BrokerSession) {
  if (session.reconnectTimer) return;
  if (isPiShockApiKeyRejected(session.creds.token)) return;
  if (sessions.get(id) !== session) return;
  const attempt = session.reconnectAttempt;
  const delay = Math.min(15_000, 1_000 * 2 ** Math.min(attempt, 4));
  session.reconnectAttempt = attempt + 1;
  session.reconnectTimer = setTimeout(() => {
    session.reconnectTimer = undefined;
    ensureConnected(id);
  }, delay);
  session.reconnectTimer.unref?.();
}

function ensureConnected(discordUserId: string) {
  const session = sessions.get(discordUserId);
  if (!session) return;
  if (isPiShockApiKeyRejected(session.creds.token)) {
    disconnectBroker(discordUserId);
    return;
  }
  if (session.ws && (session.ws.readyState === WebSocket.OPEN || session.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const url = brokerUrl(session.creds);
  const ws = new WebSocket(url);
  session.ws = ws;

  ws.on('open', () => {
    session.reconnectAttempt = 0;
    startKeepAlive(discordUserId, session, ws);
    broadcast(session, { type: 'status', message: 'broker connected', at: Date.now() });
    safeSend(ws, JSON.stringify({ Operation: 'PING' }));
    subscribeTargets(session, [...session.clientIds]);
  });

  ws.on('message', (data) => {
    // replaceSessionCreds detaches this socket before close; ignore its late frames.
    if (session.ws !== ws) return;
    const text = data.toString();
    if (session.publishActive) {
      if (isPublishSuccess(text)) {
        finishActivePublish(session, true);
        return;
      }
      if (isPublishError(text)) {
        console.warn('[broker] publish error', text.slice(0, 300));
        finishActivePublish(session, false);
        return;
      }
    }
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      handleBrokerMessage(session, parsed);
    } catch {
      // ignore
    }
  });

  ws.on('close', () => {
    if (session.ws !== ws) return;
    session.ws = null;
    stopKeepAlive(session);
    finishActivePublish(session, false);
    broadcast(session, { type: 'status', message: 'broker disconnected', at: Date.now() });
    scheduleReconnect(discordUserId, session);
  });

  ws.on('error', () => {
    // close handler will reconnect
  });
}

function handleBrokerMessage(session: BrokerSession, parsed: Record<string, unknown>) {
  const message = typeof parsed.Message === 'string' ? parsed.Message : '';
  if (message.toLowerCase().includes('subscribed')) {
    // "{id}-ping subscribed to." proves the channel exists; wait for device ping for online.
    return;
  }

  const topic =
    (typeof parsed.Topic === 'string' && parsed.Topic) ||
    (typeof parsed.topic === 'string' && parsed.topic) ||
    (typeof parsed.Target === 'string' && parsed.Target) ||
    (typeof parsed.channel === 'string' && parsed.channel) ||
    '';

  let payload: Record<string, unknown> = {};
  const rawBody = parsed.Body ?? parsed.Payload ?? parsed.data;
  if (typeof rawBody === 'string') {
    try {
      const parsedBody = JSON.parse(rawBody) as unknown;
      if (parsedBody && typeof parsedBody === 'object') {
        payload = parsedBody as Record<string, unknown>;
      }
    } catch {
      payload = { raw: rawBody };
    }
  } else if (rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)) {
    payload = rawBody as Record<string, unknown>;
  } else if (!rawBody && parsed && typeof parsed === 'object') {
    payload = parsed;
  }

  const haystack = `${topic} ${message} ${typeof rawBody === 'string' ? rawBody : ''}`.toLowerCase();

  for (const clientId of session.clientIds) {
    const bare = normalizeClientId(clientId) ?? clientId;
    const pingHit =
      topic === `${bare}-ping` ||
      topic === `c${bare}-ping` ||
      topic.endsWith(`${bare}-ping`) ||
      haystack.includes(`${bare}-ping`) ||
      looksLikePing(payload, bare);
    if (pingHit) {
      const online = inferOnline(payload);
      session.online.set(bare, online);
      session.lastSeenAt.set(bare, Date.now());
      broadcast(session, { type: 'online', clientId: bare, online, at: Date.now() });
      return;
    }
    if (
      topic === `${bare}-log` ||
      topic === `c${bare}-log` ||
      topic.endsWith(`${bare}-log`) ||
      haystack.includes(`${bare}-log`)
    ) {
      // Any log traffic implies the hub is reachable
      session.online.set(bare, true);
      session.lastSeenAt.set(bare, Date.now());
      broadcast(session, { type: 'online', clientId: bare, online: true, at: Date.now() });
      // Prefer unwrapped command body for ingest/UI; fall back to full frame.
      const logPayload =
        Object.keys(payload).length > 0 ? payload : (parsed as unknown);
      broadcast(session, { type: 'log', clientId: bare, payload: logPayload, at: Date.now() });
      return;
    }
  }

  // Fallback: nested arrays from older broker frames
  if (Array.isArray(parsed.Payload)) {
    for (const item of parsed.Payload) {
      if (typeof item === 'string') {
        for (const clientId of session.clientIds) {
          const bare = normalizeClientId(clientId) ?? clientId;
          if (item.includes(`${bare}-ping`)) {
            session.online.set(bare, true);
            session.lastSeenAt.set(bare, Date.now());
            broadcast(session, { type: 'online', clientId: bare, online: true, at: Date.now() });
          }
        }
      }
    }
  }
}

function looksLikePing(payload: Record<string, unknown>, clientId: string): boolean {
  const id = payload.clientId ?? payload.c ?? payload.ClientId ?? payload.hubId ?? payload.HubId;
  if (id == null) return 'online' in payload || 'p' in payload || 'Connected' in payload;
  return normalizeClientId(String(id)) === clientId;
}

function inferOnline(payload: Record<string, unknown>): boolean {
  if ('online' in payload) return Boolean(payload.online);
  if ('p' in payload) return Boolean(payload.p);
  if ('Connected' in payload) return Boolean(payload.Connected);
  if ('Offline' in payload) return !payload.Offline;
  // Receiving a ping frame from the device channel means it is online
  return true;
}

function broadcast(session: BrokerSession, event: BrokerEvent) {
  for (const sub of session.subscribers) {
    try {
      sub(event);
    } catch {
      // ignore subscriber errors
    }
  }
}

function safeSend(ws: WebSocket, data: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(data);
  }
}

function teardown(discordUserId: string) {
  const session = sessions.get(discordUserId);
  if (!session) return;
  if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
  stopKeepAlive(session);
  clearIdleTimer(session);
  clearLogCaptureIdleTimer(session);
  session.logCapture = undefined;
  session.subscribers.clear();
  dropPendingPublishes(session);
  const ws = session.ws;
  session.ws = null;
  sessions.delete(discordUserId);
  try {
    ws?.close();
  } catch {
    // ignore
  }
}

/** Drop the broker socket now. Used when the stored API key is rejected or unlinked. */
export function disconnectBroker(discordUserId: string) {
  teardown(discordUserId);
}

export function disconnectBrokerSessionsForToken(token: string) {
  for (const [id, session] of [...sessions.entries()]) {
    if (session.creds.token === token) teardown(id);
  }
}

/** Close every PiShock broker socket so the process can exit on SIGTERM. */
export function closeAllBrokerSessions() {
  for (const id of [...sessions.keys()]) {
    teardown(id);
  }
}

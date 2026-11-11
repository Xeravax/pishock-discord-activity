import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiBase, apiFetch, isEmbedded } from './api';
import {
  bootstrapDiscord,
  buildPresenceSnapshot,
  fetchInstanceParticipants,
  getActivityInstanceId,
  openExternal,
  resolveActivityLocationHint,
  subscribeParticipants,
  updateRichPresence,
  type AuthState,
} from './discord';
import { SafetyWarning } from './components/SafetyWarning';
import { SafetyNoticeBar } from './components/SafetyNoticeBar';
import { TermsOfService } from './components/TermsOfService';
import { PrivacyPolicy } from './components/PrivacyPolicy';
import { LoginPanel } from './components/LoginPanel';
import { PiShockLinkingScreen } from './components/PiShockLinkingScreen';
import { OfficialController } from './components/OfficialController';
import { AppVersionBadge } from './components/AppVersionBadge';
import { markServerShuttingDown } from './hooks/useAppHealth';
import type { ShockerView } from './components/ShockerCard';
import { SharesPanel } from './components/SharesPanel';
import {
  OfficialLogsFab,
  OfficialLogsPanel,
  normalizePublicLogs,
  type OfficialLogEntry,
} from './components/OfficialLogsPanel';
import { PipIncomingShock, type IncomingShockHit } from './components/PipIncomingShock';
import { participantAvatarUrl } from './participants';
import { AvailabilitySettings } from './components/AvailabilitySettings';
import {
  ActivityLimitsSettings,
  type PersonalLimits,
  type ShareLimitRow,
} from './components/ActivityLimitsSettings';
import { FriendsParticipantList } from './components/FriendsParticipantList';
import {
  isPiShockRowExplicitlyUnpaused,
  isPiShockRowPaused,
} from '../shared/pishock-pause';
import {
  QueueFab,
  QueuePanel,
  type QueuePanelItem,
  type QueuePanelSettings,
} from './components/QueuePanel';
import { PsDialog } from './components/PsDialog';
import { LinkConfirmPanel } from './components/LinkConfirmPanel';
import { ApiKeyRevealPanel } from './components/ApiKeyRevealPanel';
import { AuthLoadingScreen } from './components/AuthLoadingScreen';
import { DefaultMenuPrompt } from './components/DefaultMenuPrompt';
import {
  loadDefaultStartMenu,
  saveDefaultStartMenu,
  type DefaultStartMenu,
} from './defaultMenuPrefs';
import {
  SetupWizard,
  loadSetupPrefs,
  saveSetupPrefs,
  type SetupChoices,
} from './components/SetupWizard';
import { SetupDiscordShareScreen } from './components/SetupDiscordShareScreen';
import type { ActivityShareConfig } from './components/AvailabilitySettings';
import type { DiscordParticipant, ParticipantStatus } from './participants';
import { connectRealtime, type RealtimeEvent } from './realtime';

type MeResponse = {
  user: AuthState['user'];
  consent: boolean;
  pishockLinked: boolean;
  pishockUserId: number | null;
  personal?: PersonalLimits;
  emergencyStopShockerIds?: number[];
  commandQueueEnabled?: boolean;
};

type QueueState = QueuePanelSettings & {
  paused: boolean;
  halted: boolean;
  active: QueuePanelItem | null;
  waiting: QueuePanelItem[];
};

type SenderQueueTicket = {
  ownerDiscordUserId: string;
  itemId: string;
  status: string;
  position: number | null;
  paused: boolean;
  estimatedWaitMs: number | null;
  estimatedStartAt: number | null;
  at: number;
};

function formatQueueEta(waitMs: number | null | undefined): string | null {
  if (waitMs == null || !Number.isFinite(waitMs)) return null;
  if (waitMs <= 0) return 'now';
  const sec = Math.max(1, Math.round(waitMs / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${min}m ${rem}s` : `${min}m`;
}

type DevicesResponse = {
  hubs: Array<Record<string, unknown>>;
  shockers: Array<Record<string, unknown>>;
  shared: Array<Record<string, unknown>>;
  links: Array<Record<string, unknown>>;
  online: Record<string, boolean>;
};

type Overlay = null | 'menu' | 'availability' | 'settings' | 'shares' | 'logs' | 'link';

type LegalView = null | 'terms' | 'privacy';

type PendingLinkConfirm = {
  pishockUserId: number;
  pishockUsername?: string | null;
  hubNames: string[];
};

type PendingApiKeyReveal = {
  apiKey: string;
  apiKeyName: string;
  expiresAt?: string | null;
  pishockUsername?: string | null;
};

const PARTICIPANT_STATUS_TTL_MS = 3 * 60 * 1000;

let participantStatusCache: {
  key: string;
  fetchedAt: number;
  map: Record<string, ParticipantStatus>;
} = { key: '', fetchedAt: 0, map: {} };

export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [pip, setPip] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootProgress, setBootProgress] = useState(4);
  const [bootLabel, setBootLabel] = useState('Starting…');
  const [bootReady, setBootReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<DevicesResponse | null>(null);
  const [online, setOnline] = useState<Record<string, boolean>>({});
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [publicLogs, setPublicLogs] = useState<OfficialLogEntry[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [settingsFocusShockerId, setSettingsFocusShockerId] = useState<number | null>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkConfirm, setLinkConfirm] = useState<PendingLinkConfirm | null>(null);
  const [apiKeyReveal, setApiKeyReveal] = useState<PendingApiKeyReveal | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [manualLinkBusy, setManualLinkBusy] = useState(false);
  const [manualLinkError, setManualLinkError] = useState<string | null>(null);
  const [setupPhase, setSetupPhase] = useState(false);
  const [setupSharePhase, setSetupSharePhase] = useState(false);
  const [setupDevicesReady, setSetupDevicesReady] = useState(false);
  const [setupShareBusy, setSetupShareBusy] = useState(false);
  const [setupShareKey, setSetupShareKey] = useState(0);
  const [defaultMenuPrompt, setDefaultMenuPrompt] = useState(false);
  const defaultMenuAppliedRef = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [legalView, setLegalView] = useState<LegalView>(null);
  const [friendsMode, setFriendsMode] = useState(true);
  const [participants, setParticipants] = useState<DiscordParticipant[]>([]);
  const [participantStatus, setParticipantStatus] = useState<Record<string, ParticipantStatus>>({});
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  const selectedTargetId = selectedTargetIds[0] ?? null;
  const [selectedHubId, setSelectedHubId] = useState<string | null>(null);
  const [pinging, setPinging] = useState(false);
  const [pairDialog, setPairDialog] = useState<ShockerView | null>(null);
  const [lastIncoming, setLastIncoming] = useState<IncomingShockHit | null>(null);
  /** Per-shocker Discord share caps (what guests are limited to) */
  const [discordShareLimits, setDiscordShareLimits] = useState<
    Record<
      number,
      {
        enabled: boolean;
        minIntensity: number;
        maxIntensity: number;
        minDurationMs: number;
        maxDurationMs: number;
      }
    >
  >({});
  const [queueState, setQueueState] = useState<QueueState>({
    enabled: false,
    progressMs: 0,
    maxPerSender: 3,
    starOnly: false,
    paused: false,
    halted: false,
    active: null,
    waiting: [],
  });
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [myQueueTicket, setMyQueueTicket] = useState<SenderQueueTicket | null>(null);
  /** Shocker ids PiShock just rejected with 503, until a device list says otherwise. */
  const [livePausedIds, setLivePausedIds] = useState<Set<number>>(() => new Set());

  const token = auth?.accessToken ?? null;
  const participantsRef = useRef(participants);
  participantsRef.current = participants;
  const selfIdRef = useRef(me?.user?.id ?? null);
  selfIdRef.current = me?.user?.id ?? null;
  const operateInflightRef = useRef(0);
  const linkPollGenRef = useRef(0);
  const presenceStartedAtRef = useRef<number | null>(null);

  const refreshQueue = useCallback(async (accessToken: string) => {
    const data = await apiFetch<QueueState & { stars?: string[] }>('/queue', accessToken);
    setQueueState({
      enabled: Boolean(data.enabled),
      progressMs: Number(data.progressMs) || 0,
      maxPerSender: Number(data.maxPerSender) || 3,
      starOnly: Boolean(data.starOnly),
      paused: Boolean(data.paused),
      halted: Boolean(data.halted),
      active: data.active ?? null,
      waiting: data.waiting ?? [],
    });
    setMe((prev) => (prev ? { ...prev, commandQueueEnabled: Boolean(data.enabled) } : prev));
    return data;
  }, []);

  const refreshMe = useCallback(async (accessToken: string) => {
    const data = await apiFetch<MeResponse>('/me', accessToken);
    setMe(data);
    return data;
  }, []);

  const refreshDevices = useCallback(async (accessToken: string) => {
    const data = await apiFetch<
      DevicesResponse & {
        emergencyStopShockerIds?: number[];
        pausedShockerIds?: number[];
      }
    >('/devices', accessToken);
    setDevices(data);
    setLivePausedIds((prev) => {
      const next = new Set(prev);
      for (const id of data.pausedShockerIds ?? []) {
        if (Number.isFinite(id) && id > 0) next.add(Math.floor(id));
      }
      for (const row of pauseRowsFromDevices(data)) {
        const id = Number(row.ShockerId ?? row.shockerId ?? row.Id ?? row.id);
        if (!Number.isFinite(id) || id <= 0) continue;
        if (isPiShockRowPaused(row)) next.add(Math.floor(id));
        else if (isPiShockRowExplicitlyUnpaused(row)) next.delete(Math.floor(id));
      }
      return next;
    });
    if (Array.isArray(data.emergencyStopShockerIds)) {
      setMe((prev) =>
        prev
          ? { ...prev, emergencyStopShockerIds: data.emergencyStopShockerIds }
          : prev,
      );
    }
    const nextOnline: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(data.online ?? {})) {
      const key = normalizeClientKey(k);
      if (key) nextOnline[key] = Boolean(v);
    }
    setOnline((prev) => ({ ...prev, ...nextOnline }));
    return data;
  }, []);

  const refreshLogs = useCallback(async (accessToken: string) => {
    const data = await apiFetch<{
      public?: Array<Record<string, unknown>>;
      activity?: Array<Record<string, unknown>>;
    }>('/logs?limit=200', accessToken);
    const feed = normalizePublicLogs(
      (data.public ?? []) as Parameters<typeof normalizePublicLogs>[0],
      participantAvatarUrl,
    );
    setPublicLogs(feed);
    // Personal rows still hydrate PIP when the public feed is empty/old
    setLogs(
      (data.public ?? data.activity ?? []).map((row) => {
        const executor = row.executor as Record<string, unknown> | undefined;
        const target = row.target as Record<string, unknown> | undefined;
        if (executor || target) {
          return {
            ...row,
            executorDiscordUserId: executor?.id ?? row.executorDiscordUserId,
            targetDiscordUserId: target?.id ?? row.targetDiscordUserId,
            executorAvatar: executor?.avatar ?? null,
            executorDisplayName: executor?.displayName ?? executor?.globalName ?? executor?.username,
          };
        }
        return row;
      }),
    );
  }, []);

  const refreshParticipantStatus = useCallback(
    async (accessToken: string, roster: DiscordParticipant[], force = false) => {
      const instanceId = getActivityInstanceId();
      if (!instanceId || roster.length === 0) {
        setParticipantStatus({});
        return;
      }
      const idsKey = roster
        .map((p) => p.id)
        .sort()
        .join(',');
      const now = Date.now();
      if (
        !force &&
        participantStatusCache.key === idsKey &&
        now - participantStatusCache.fetchedAt < PARTICIPANT_STATUS_TTL_MS
      ) {
        setParticipantStatus(participantStatusCache.map);
        return;
      }
      const data = await apiFetch<{ participants: ParticipantStatus[] }>(
        '/participants/status',
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            instanceId,
            discordUserIds: roster.map((p) => p.id),
          }),
        },
      );
      const map: Record<string, ParticipantStatus> = {};
      for (const row of data.participants ?? []) {
        map[row.discordUserId] = row;
      }
      participantStatusCache = { key: idsKey, fetchedAt: now, map };
      setParticipantStatus(map);
      setLivePausedIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        for (const row of data.participants ?? []) {
          for (const shocker of row.shockers ?? []) {
            if (!shocker.paused) next.delete(shocker.shockerId);
          }
        }
        return next.size === prev.size ? prev : next;
      });
    },
    [],
  );

  const refreshParticipants = useCallback(
    async (accessToken: string, forceStatus = false) => {
      const roster = await fetchInstanceParticipants();
      setParticipants(roster);
      try {
        await refreshParticipantStatus(accessToken, roster, forceStatus);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      }
    },
    [refreshParticipantStatus],
  );

  useEffect(() => {
    let cancelled = false;
    const report = (progress: number, label: string) => {
      if (cancelled) return;
      setBootProgress(progress);
      setBootLabel(label);
    };

    (async () => {
      try {
        report(4, 'Starting…');
        const authState = await bootstrapDiscord(setPip, ({ progress, label }) => {
          report(progress, label);
        });
        if (cancelled) return;
        setAuth(authState);

        if (!isEmbedded) {
          // Local browser: consent/link screens still render; API calls need real Discord token.
          report(96, 'Ready');
          setMe({
            user: authState.user,
            consent: false,
            pishockLinked: false,
            pishockUserId: null,
          });
          report(100, 'Ready');
          setBootReady(true);
          return;
        }

        report(86, 'Loading your profile…');
        const meData = await refreshMe(authState.accessToken);
        if (cancelled) return;

        if (meData.consent) {
          // Resume pending link confirmation if login finished before confirm.
          try {
            report(90, 'Checking link status…');
            const loginStatus = await apiFetch<{
              status: string;
              pishockUserId?: number;
              pishockUsername?: string | null;
              hubNames?: string[];
            }>('/pishock/login/status', authState.accessToken);
            if (loginStatus.status === 'confirm' && loginStatus.pishockUserId != null) {
              setLinkConfirm({
                pishockUserId: loginStatus.pishockUserId,
                pishockUsername: loginStatus.pishockUsername ?? null,
                hubNames: loginStatus.hubNames ?? [],
              });
              report(100, 'Ready');
              setBootReady(true);
              return;
            }
          } catch {
            // ignore — continue into control
          }

          report(92, 'Loading activity…');
          await refreshLogs(authState.accessToken).catch(() => undefined);
          if (meData.pishockLinked) {
            report(95, 'Loading devices…');
            await refreshDevices(authState.accessToken);
          } else {
            // Discord Friends work without a PiShock login — default into that mode.
            setFriendsMode(true);
          }
          try {
            report(97, 'Loading Discord Shockers…');
            await refreshParticipants(authState.accessToken);
          } catch {
            // participant APIs need bot token; control still works
          }
        }

        if (cancelled) return;
        report(100, 'Ready');
        setBootReady(true);
      } catch (err) {
        if (!cancelled) {
          setBootError(err instanceof Error ? err.message : String(err));
          setBootReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshDevices, refreshLogs, refreshMe, refreshParticipants]);

  // Discord Rich Presence — privacy-safe automatic status + party/Join.
  useEffect(() => {
    if (!isEmbedded || !bootReady || !auth) return;
    if (presenceStartedAtRef.current == null) {
      presenceStartedAtRef.current = Date.now();
    }
    const sharingDevices = Object.values(discordShareLimits).some((row) => row.enabled);
    const selfEStop = (me?.emergencyStopShockerIds?.length ?? 0) > 0;
    const snapshot = buildPresenceSnapshot({
      linked: Boolean(me?.pishockLinked),
      friendsMode,
      participantCount: Math.max(1, participants.length),
      sharingDevices,
      emergencyStop: selfEStop,
      queueHalted: Boolean(queueState.halted),
      queuePaused: Boolean(queueState.paused),
      instanceId: getActivityInstanceId(),
      startedAt: presenceStartedAtRef.current,
    });
    updateRichPresence(snapshot);
  }, [
    bootReady,
    auth,
    me?.pishockLinked,
    me?.emergencyStopShockerIds,
    friendsMode,
    participants.length,
    discordShareLimits,
    queueState.halted,
    queueState.paused,
  ]);

  useEffect(() => {
    if (!isEmbedded || !token) return;
    return subscribeParticipants((roster) => {
      setParticipants(roster);
      void refreshParticipantStatus(token, roster).catch(() => undefined);
    });
  }, [token, refreshParticipantStatus]);

  // Default friends view to the first Discord user with an available PiShock share.
  useEffect(() => {
    if (!friendsMode || selectedTargetIds.length > 0) return;
    const selfId = me?.user?.id;
    const firstAvailable = participants.find((p) => {
      if (selfId && p.id === selfId) return false;
      const status = participantStatus[p.id];
      return Boolean(status?.available && status.shockers?.length);
    });
    if (firstAvailable) setSelectedTargetIds([firstAvailable.id]);
  }, [
    friendsMode,
    selectedTargetIds.length,
    participants,
    participantStatus,
    me?.user?.id,
  ]);

  useEffect(() => {
    if (!isEmbedded || !token || !bootReady || !me?.consent) return;

    let invalidateTimer: number | null = null;

    const applyEmergencyStop = (event: Extract<RealtimeEvent, { type: 'emergency_stop' }>) => {
      const selfId = selfIdRef.current;
      if (selfId && event.ownerDiscordUserId === selfId) {
        setMe((prev) =>
          prev ? { ...prev, emergencyStopShockerIds: event.emergencyStopShockerIds } : prev,
        );
      }

      const stopped = new Set(event.emergencyStopShockerIds);
      setParticipantStatus((prev) => {
        const row = prev[event.ownerDiscordUserId];
        if (!row) return prev;
        const shockers = row.shockers.map((s) => ({
          ...s,
          emergencyStop: stopped.has(s.shockerId),
        }));
        const allStopped =
          shockers.length > 0 && shockers.every((s) => s.emergencyStop);
        return {
          ...prev,
          [event.ownerDiscordUserId]: {
            ...row,
            emergencyStop: allStopped,
            shockers,
          },
        };
      });
      // Keep TTL cache consistent so a soft refresh doesn't overwrite the latch
      if (participantStatusCache.map[event.ownerDiscordUserId]) {
        const row = participantStatusCache.map[event.ownerDiscordUserId];
        const shockers = row.shockers.map((s) => ({
          ...s,
          emergencyStop: stopped.has(s.shockerId),
        }));
        participantStatusCache = {
          ...participantStatusCache,
          map: {
            ...participantStatusCache.map,
            [event.ownerDiscordUserId]: {
              ...row,
              emergencyStop: shockers.length > 0 && shockers.every((s) => s.emergencyStop),
              shockers,
            },
          },
        };
      }
    };

    const handleEvent = (event: RealtimeEvent) => {
      if (event.type === 'ping' || event.type === 'hello_ok') return;
      if (event.type === 'server_shutting_down') {
        markServerShuttingDown();
        return;
      }
      if (event.type === 'emergency_stop') {
        applyEmergencyStop(event);
        return;
      }
      if (event.type === 'incoming_command') {
        if (selfIdRef.current && event.targetDiscordUserId === selfIdRef.current) {
          const fromRoster = participantsRef.current.find(
            (p) => p.id === event.executorDiscordUserId,
          );
          setLastIncoming({
            executorDiscordUserId: event.executorDiscordUserId,
            displayName:
              fromRoster?.displayName ||
              event.executorGlobalName ||
              event.executorUsername ||
              'Someone',
            avatarUrl:
              fromRoster?.avatarUrl ||
              participantAvatarUrl(event.executorDiscordUserId, event.executorAvatar),
            action: event.action,
            intensity: event.intensity,
            durationMs: event.durationMs,
            at: event.at,
            success: event.success,
            kind: 'personal',
            targetDiscordUserId: selfIdRef.current,
          });
          void refreshLogs(token).catch(() => undefined);
        }
        return;
      }
      if (event.type === 'queue_state') {
        if (selfIdRef.current && event.ownerDiscordUserId === selfIdRef.current) {
          setQueueState({
            enabled: Boolean(event.enabled),
            progressMs: Number(event.progressMs) || 0,
            maxPerSender: Number(event.maxPerSender) || 3,
            starOnly: Boolean(event.starOnly),
            paused: Boolean(event.paused),
            halted: Boolean(event.halted),
            active: event.active ?? null,
            waiting: event.waiting ?? [],
          });
          setMe((prev) =>
            prev ? { ...prev, commandQueueEnabled: Boolean(event.enabled) } : prev,
          );
        }
        return;
      }
      if (event.type === 'queue_ticket') {
        if (selfIdRef.current && event.executorDiscordUserId === selfIdRef.current) {
          setMyQueueTicket({
            ownerDiscordUserId: event.ownerDiscordUserId,
            itemId: event.itemId,
            status: event.status,
            position: event.position,
            paused: event.paused,
            estimatedWaitMs: event.estimatedWaitMs,
            estimatedStartAt: event.estimatedStartAt,
            at: event.at,
          });
          if (
            event.status === 'done' ||
            event.status === 'removed' ||
            event.status === 'failed'
          ) {
            window.setTimeout(() => {
              setMyQueueTicket((prev) => (prev?.itemId === event.itemId ? null : prev));
            }, 2500);
          }
        }
        return;
      }
      if (event.type === 'activity_share_changed' || event.type === 'participants_invalidate') {
        participantStatusCache = { key: '', fetchedAt: 0, map: {} };
        if (invalidateTimer != null) window.clearTimeout(invalidateTimer);
        invalidateTimer = window.setTimeout(() => {
          invalidateTimer = null;
          void refreshParticipantStatus(token, participantsRef.current, true).catch(() => undefined);
          void refreshLogs(token).catch(() => undefined);
          void refreshQueue(token).catch(() => undefined);
        }, 150);
        if (
          event.type === 'activity_share_changed' &&
          selfIdRef.current === event.ownerDiscordUserId
        ) {
          void refreshMe(token).catch(() => undefined);
        }
      }
    };

    const handle = connectRealtime(token, (event) => {
      try {
        handleEvent(event);
      } catch (err) {
        console.warn('[realtime] handler failed', event.type, err);
      }
    });
    return () => {
      if (invalidateTimer != null) window.clearTimeout(invalidateTimer);
      handle.close();
    };
  }, [
    token,
    bootReady,
    me?.consent,
    refreshMe,
    refreshParticipantStatus,
    refreshLogs,
    refreshQueue,
  ]);

  const refreshOnlineStatus = useCallback(
    async (accessToken: string, clientIds: string[], waitMs = 2500) => {
      if (!clientIds.length) return;
      const data = await apiFetch<{
        online?: Record<string, boolean>;
        lastSeenAt?: Record<string, number>;
      }>(
        `/broker/status?clientIds=${encodeURIComponent(clientIds.join(','))}&waitMs=${waitMs}`,
        accessToken,
      );
      const nextOnline: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(data.online ?? {})) {
        const key = normalizeClientKey(k);
        if (key) nextOnline[key] = Boolean(v);
      }
      setOnline((prev) => {
        const merged = { ...prev, ...nextOnline };
        // After a full probe, unknown hubs leave "Checking…" and become Offline
        if (waitMs >= 2500) {
          for (const id of clientIds) {
            const key = normalizeClientKey(id);
            if (key && !(key in nextOnline)) merged[key] = false;
          }
        }
        return merged;
      });
    },
    [],
  );

  useEffect(() => {
    if (!token || !me?.pishockLinked || !devices) return;
    const clientIds = collectClientIds(devices);
    if (clientIds.length === 0) return;

    let cancelled = false;
    const run = async (waitMs: number) => {
      try {
        await refreshOnlineStatus(token, clientIds, waitMs);
      } catch {
        // transient; next poll retries
      }
    };

    void run(2800);
    const timer = window.setInterval(() => {
      if (!cancelled) void run(1200);
    }, 8_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token, me?.pishockLinked, devices, refreshOnlineStatus]);

  useEffect(() => {
    if (!token || !me?.pishockLinked) return;
    const id = window.setInterval(() => {
      void refreshDevices(token).catch(() => undefined);
    }, 20_000);
    return () => window.clearInterval(id);
  }, [token, me?.pishockLinked, refreshDevices]);

  useEffect(() => {
    if (!token || !isEmbedded) return;
    const id = window.setInterval(() => {
      const roster = participantsRef.current;
      if (roster.length === 0) return;
      void refreshParticipantStatus(token, roster, true).catch(() => undefined);
    }, 20_000);
    return () => window.clearInterval(id);
  }, [token, refreshParticipantStatus]);

  const personalLimits = useMemo<PersonalLimits>(() => {
    const p = me?.personal;
    const maxI = Math.max(1, Math.min(100, p?.activityMaxIntensity ?? 100));
    const maxD = Math.max(16, Math.min(15_000, p?.activityMaxDurationMs ?? 15_000));
    const vibMaxI = Math.max(1, Math.min(100, p?.activityVibMaxIntensity ?? maxI));
    const vibMaxD = Math.max(16, Math.min(15_000, p?.activityVibMaxDurationMs ?? maxD));
    const beepMaxI = Math.max(1, Math.min(100, p?.activityBeepMaxIntensity ?? maxI));
    const beepMaxD = Math.max(16, Math.min(15_000, p?.activityBeepMaxDurationMs ?? maxD));
    return {
      activityMinIntensity: Math.max(1, Math.min(maxI, p?.activityMinIntensity ?? 1)),
      activityMaxIntensity: maxI,
      activityMinDurationMs: Math.max(16, Math.min(maxD, p?.activityMinDurationMs ?? 16)),
      activityMaxDurationMs: maxD,
      activityVibMinIntensity: Math.max(1, Math.min(vibMaxI, p?.activityVibMinIntensity ?? 1)),
      activityVibMaxIntensity: vibMaxI,
      activityVibMinDurationMs: Math.max(16, Math.min(vibMaxD, p?.activityVibMinDurationMs ?? 16)),
      activityVibMaxDurationMs: vibMaxD,
      activityBeepMinIntensity: Math.max(1, Math.min(beepMaxI, p?.activityBeepMinIntensity ?? 1)),
      activityBeepMaxIntensity: beepMaxI,
      activityBeepMinDurationMs: Math.max(16, Math.min(beepMaxD, p?.activityBeepMinDurationMs ?? 16)),
      activityBeepMaxDurationMs: beepMaxD,
      activityCanShock: true,
      activityCanVibrate: true,
      activityCanBeep: true,
      activityCanHold: true,
      activityRequiredWarningLevel:
        p?.activityRequiredWarningLevel === 'small' ||
        p?.activityRequiredWarningLevel === 'mid' ||
        p?.activityRequiredWarningLevel === 'long'
          ? p.activityRequiredWarningLevel
          : 'none',
    };
  }, [me?.personal]);

  const emergencyStopIds = useMemo(
    () => new Set(me?.emergencyStopShockerIds ?? []),
    [me?.emergencyStopShockerIds],
  );

  const ownedAndShared = useMemo(() => {
    const rows = normalizeShockers(devices, online, personalLimits, emergencyStopIds, livePausedIds);
    return rows.map((s) => {
      if (!s.owned) return s;
      const share = discordShareLimits[s.id];
      if (!share) return s;
      return {
        ...s,
        discordShareEnabled: share.enabled,
        discordShareMinIntensity: share.minIntensity ?? 1,
        discordShareMaxIntensity: share.maxIntensity,
        discordShareMinDuration: share.minDurationMs ?? 16,
        discordShareMaxDuration: share.maxDurationMs,
      };
    });
  }, [devices, online, personalLimits, emergencyStopIds, discordShareLimits, livePausedIds]);

  const hubOptions = useMemo(() => {
    const hubs = devices?.hubs ?? [];
    if (!hubs.length) {
      const fallbackOnline = ownedAndShared.some((s) => s.online);
      return [
        {
          id: ownedAndShared[0]?.clientId
            ? normalizeClientKey(String(ownedAndShared[0].clientId)) || '0'
            : '0',
          name: 'PiShock',
          online: fallbackOnline,
          lastSeen: fallbackOnline ? 'Seen a few seconds ago' : 'Checking…',
        },
      ];
    }
    return hubs.map((h) => {
      const id = normalizeClientKey(hubClientId(h) ?? '') || '0';
      const name = String(h.Name ?? h.name ?? 'Hub');
      const known = id in online ? online[id] : undefined;
      const fromShockers = ownedAndShared.some(
        (s) => normalizeClientKey(String(s.clientId ?? '')) === id && s.online,
      );
      const isOnline = known === true || fromShockers;
      return {
        id,
        name,
        online: isOnline,
        lastSeen:
          known === true || fromShockers
            ? 'Seen a few seconds ago'
            : known === false
              ? 'Offline'
              : 'Checking…',
      };
    });
  }, [devices?.hubs, ownedAndShared, online]);

  useEffect(() => {
    if (!hubOptions.length) return;
    if (!selectedHubId || !hubOptions.some((h) => h.id === selectedHubId)) {
      setSelectedHubId(hubOptions[0]!.id);
    }
  }, [hubOptions, selectedHubId]);

  const selectedFriendStatus = selectedTargetId
    ? participantStatus[selectedTargetId]
    : undefined;

  const friendShockers = useMemo(() => {
    if (!selectedTargetIds.length) return [] as ShockerView[];
    const rows: ShockerView[] = [];
    for (const targetId of selectedTargetIds) {
      const status = participantStatus[targetId];
      const participant = participants.find((p) => p.id === targetId);
      // Blocked: no visibility into their shockers
      if (!status || status.bannedYou) continue;
      // E-stop / paused / etc: still show shockers (buttons disabled via flags)
      if (!status.shockers?.length) continue;
      for (const s of status.shockers) {
        const deviceMaxIntensity = Math.min(100, s.deviceMaxIntensity ?? s.maxIntensity);
        const deviceMaxDuration = Math.min(15_000, s.deviceMaxDurationMs ?? s.maxDurationMs);
        const activityMaxIntensity = Math.min(deviceMaxIntensity, s.maxIntensity);
        const activityMaxDuration = Math.min(deviceMaxDuration, s.maxDurationMs);
        const activityMinIntensity = Math.max(
          1,
          Math.min(activityMaxIntensity, s.minIntensity ?? 1),
        );
        const activityMinDuration = Math.max(
          16,
          Math.min(activityMaxDuration, s.minDurationMs ?? 16),
        );
        const vibMaxIntensity = Math.min(
          deviceMaxIntensity,
          s.vibMaxIntensity ?? activityMaxIntensity,
        );
        const vibMinIntensity = Math.max(
          1,
          Math.min(vibMaxIntensity, s.vibMinIntensity ?? activityMinIntensity),
        );
        const vibMaxDuration = Math.min(
          deviceMaxDuration,
          s.vibMaxDurationMs ?? activityMaxDuration,
        );
        const vibMinDuration = Math.max(
          16,
          Math.min(vibMaxDuration, s.vibMinDurationMs ?? activityMinDuration),
        );
        const beepMaxIntensity = Math.min(
          deviceMaxIntensity,
          s.beepMaxIntensity ?? activityMaxIntensity,
        );
        const beepMinIntensity = Math.max(
          1,
          Math.min(beepMaxIntensity, s.beepMinIntensity ?? activityMinIntensity),
        );
        const beepMaxDuration = Math.min(
          deviceMaxDuration,
          s.beepMaxDurationMs ?? activityMaxDuration,
        );
        const beepMinDuration = Math.max(
          16,
          Math.min(beepMaxDuration, s.beepMinDurationMs ?? activityMinDuration),
        );
        const stopped = Boolean(s.emergencyStop);
        const devicePaused = Boolean(s.paused) || livePausedIds.has(s.shockerId);
        rows.push({
          id: s.shockerId,
          name: s.shockerName,
          hubName:
            s.hubName?.trim() ||
            participant?.displayName ||
            status.globalName ||
            status.username ||
            'Friend',
          clientId: s.hubClientId ?? undefined,
          owned: false,
          targetDiscordUserId: targetId,
          paused: devicePaused,
          canShock: !stopped && !devicePaused && s.canShock,
          canVibrate: !stopped && !devicePaused && s.canVibrate,
          canBeep: !stopped && !devicePaused && s.canBeep,
          canHold: !stopped && !devicePaused && s.canHold,
          canPause: false,
          deviceMaxIntensity,
          deviceMaxDuration,
          activityMinIntensity,
          activityMaxIntensity,
          activityMinDuration,
          activityMaxDuration,
          minIntensity: activityMinIntensity,
          maxIntensity: activityMaxIntensity,
          minDuration: activityMinDuration,
          maxDuration: activityMaxDuration,
          vibMinIntensity,
          vibMaxIntensity,
          vibMinDuration,
          vibMaxDuration,
          beepMinIntensity,
          beepMaxIntensity,
          beepMinDuration,
          beepMaxDuration,
          requiredWarningLevel:
            s.requiredWarningLevel === 'small' ||
            s.requiredWarningLevel === 'mid' ||
            s.requiredWarningLevel === 'long'
              ? s.requiredWarningLevel
              : 'none',
          emergencyStop: stopped,
          isV3: true,
          online: true,
        });
      }
    }
    return rows;
  }, [selectedTargetIds, participantStatus, participants, livePausedIds]);

  const ownShockers = useMemo(() => {
    if (!selectedHubId) return ownedAndShared;
    const filtered = ownedAndShared.filter(
      (s) => !s.clientId || normalizeClientKey(String(s.clientId)) === selectedHubId,
    );
    return filtered.length ? filtered : ownedAndShared;
  }, [ownedAndShared, selectedHubId]);

  const shockers = friendsMode ? friendShockers : ownShockers;

  // Hydrate / refresh PIP “last hit on you” from activity logs
  useEffect(() => {
    if (!me?.user?.id) return;
    const selfId = me.user.id;
    const row = logs.find((entry) => {
      const target = (entry.targetDiscordUserId as string | null | undefined) ?? null;
      if (target !== selfId) return false;
      const action = String(entry.action ?? '').toLowerCase();
      if (
        action === 'end' ||
        action === 'stop' ||
        action === 'participant_end' ||
        action.endsWith('_end')
      ) {
        return false;
      }
      return true;
    });
    if (!row) return;
    const at = new Date(String(row.createdAt)).getTime() || 0;
    if (lastIncoming && lastIncoming.at >= at) return;
    const executorId = String(row.executorDiscordUserId ?? '');
    if (!executorId) return;
    const fromRoster = participants.find((p) => p.id === executorId);
    const status = participantStatus[executorId];
    const fromPublic = publicLogs.find((e) => e.id === String(row.id));
    setLastIncoming({
      executorDiscordUserId: executorId,
      displayName:
        fromPublic?.from.displayName ||
        (row.executorDisplayName as string | undefined) ||
        fromRoster?.displayName ||
        status?.globalName ||
        status?.username ||
        'Someone',
      avatarUrl:
        fromPublic?.from.avatarUrl ||
        fromRoster?.avatarUrl ||
        participantAvatarUrl(
          executorId,
          (row.executorAvatar as string | null | undefined) ?? status?.avatar ?? null,
        ),
      action: String(row.action),
      intensity: (row.intensity as number | null | undefined) ?? null,
      durationMs: (row.durationMs as number | null | undefined) ?? null,
      at: at || Date.now(),
      success: Boolean(row.success),
      kind: 'personal',
      targetDiscordUserId: selfId,
      targetDisplayName: me.user.global_name || me.user.username || 'You',
      targetAvatarUrl: participantAvatarUrl(selfId, me.user.avatar ?? null),
    });
  }, [logs, publicLogs, me?.user?.id, lastIncoming, participants, participantStatus]);

  /** PIP surface: linked users see hits on themselves; unlinked users see the latest log shock + target. */
  const pipHit = useMemo<IncomingShockHit | null>(() => {
    if (me?.pishockLinked) return lastIncoming;
    const entry =
      publicLogs.find((e) => e.action === 'shock') ??
      publicLogs.find((e) => e.action === 'vibrate' || e.action === 'beep') ??
      null;
    if (!entry) return null;
    return {
      executorDiscordUserId: entry.from.id,
      displayName: entry.from.displayName,
      avatarUrl: entry.from.avatarUrl,
      action: entry.action,
      intensity: entry.intensity,
      durationMs:
        entry.durationSec != null ? Math.max(16, Math.round(entry.durationSec * 1000)) : null,
      at: entry.at,
      success: true,
      kind: 'activity',
      targetDiscordUserId: entry.to.id,
      targetDisplayName: entry.to.displayName,
      targetAvatarUrl: entry.to.avatarUrl,
    };
  }, [me?.pishockLinked, lastIncoming, publicLogs]);

  // While PIP is open, refresh logs so hits still show if WS was missed
  useEffect(() => {
    if (!pip || !token || !me?.consent) return;
    const tick = () => {
      void refreshLogs(token).catch(() => undefined);
    };
    tick();
    const id = window.setInterval(tick, 4000);
    return () => window.clearInterval(id);
  }, [pip, token, me?.consent, refreshLogs]);

  useEffect(() => {
    document.documentElement.classList.toggle('pip-mode', pip);
    document.body.classList.toggle('pip-mode', pip);
    return () => {
      document.documentElement.classList.remove('pip-mode');
      document.body.classList.remove('pip-mode');
    };
  }, [pip]);

  const friendBlocked = Boolean(
    friendsMode &&
      selectedTargetIds.length > 0 &&
      selectedTargetIds.every((id) => participantStatus[id]?.bannedYou),
  );
  const friendAllEStop = Boolean(
    friendsMode &&
      !friendBlocked &&
      friendShockers.length > 0 &&
      friendShockers.every((s) => s.emergencyStop),
  );
  const friendAllPaused = Boolean(
    friendsMode &&
      !friendBlocked &&
      !friendAllEStop &&
      friendShockers.length > 0 &&
      friendShockers.every((s) => s.paused || s.emergencyStop),
  );
  const friendQueue = selectedFriendStatus?.queue;
  const friendStarBlocked = Boolean(
    friendsMode &&
      selectedTargetId &&
      !friendBlocked &&
      !friendAllEStop &&
      !friendAllPaused &&
      friendQueue?.starOnly &&
      !friendQueue.starredByThem,
  );
  const friendStarred = Boolean(
    friendsMode &&
      selectedTargetId &&
      !friendBlocked &&
      friendQueue?.starredByThem,
  );
  const friendQueueHalted = Boolean(
    friendsMode &&
      selectedTargetId &&
      !friendBlocked &&
      !friendAllEStop &&
      !friendAllPaused &&
      !friendStarBlocked &&
      friendQueue?.enabled &&
      friendQueue.halted,
  );
  const friendQueuePaused = Boolean(
    friendsMode &&
      selectedTargetId &&
      !friendBlocked &&
      !friendAllEStop &&
      !friendAllPaused &&
      !friendStarBlocked &&
      !friendQueueHalted &&
      friendQueue?.enabled &&
      friendQueue.paused,
  );
  const friendControlsLocked =
    friendBlocked || friendAllEStop || friendAllPaused || friendStarBlocked || friendQueueHalted;

  useEffect(() => {
    // Unlinked users only use Discord Shockers — Claim / My Shockers stay hidden
    if (me && !me.pishockLinked) {
      setFriendsMode(true);
      setSelectedHubId(null);
      setDefaultMenuPrompt(false);
      defaultMenuAppliedRef.current = false;
    }
  }, [me?.pishockLinked, me]);

  // Linked users: apply saved default menu, or ask once if unset.
  useEffect(() => {
    if (!bootReady || !me?.consent || !me.pishockLinked || !me.user?.id) return;
    if (setupSharePhase || setupPhase || linking || linkConfirm || apiKeyReveal) return;
    if (defaultMenuAppliedRef.current) return;
    const pref = loadDefaultStartMenu(me.user.id);
    if (pref == null) {
      setDefaultMenuPrompt(true);
      return;
    }
    defaultMenuAppliedRef.current = true;
    setDefaultMenuPrompt(false);
    setFriendsMode(pref === 'friends');
    if (pref === 'own') setSelectedTargetIds([]);
  }, [
    bootReady,
    me?.consent,
    me?.pishockLinked,
    me?.user?.id,
    setupSharePhase,
    setupPhase,
    linking,
    linkConfirm,
    apiKeyReveal,
  ]);

  const applyDefaultStartMenu = useCallback(
    (menu: DefaultStartMenu) => {
      if (!me?.user?.id) return;
      saveDefaultStartMenu(me.user.id, menu);
      defaultMenuAppliedRef.current = true;
      setDefaultMenuPrompt(false);
      setFriendsMode(menu === 'friends');
      if (menu === 'own') {
        setSelectedTargetIds([]);
        setSelectedHubId(null);
      }
    },
    [me?.user?.id],
  );

  const acceptConsent = async (payload: {
    acknowledged: true;
    items: string[];
    version: number;
  }) => {
    if (!token) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiFetch('/consent', token, { method: 'POST', body: JSON.stringify(payload) });
      await refreshMe(token);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const revokeConsent = async () => {
    if (!token) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiFetch('/consent', token, { method: 'DELETE' });
      setOverlay(null);
      await refreshMe(token);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const abortLinkPoll = () => {
    linkPollGenRef.current += 1;
  };

  const startPiShockLogin = async () => {
    if (!token) return;
    abortLinkPoll();
    setLinking(true);
    setLinkError(null);
    setOverlay(null);
    setSetupPhase(false);
    try {
      const result = await apiFetch<{ loginUrl: string }>('/pishock/login/start', token, {
        method: 'POST',
        body: '{}',
      });
      setLoginUrl(result.loginUrl);
      await openExternal(result.loginUrl);
      pollLogin(token);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : String(err));
      setLinking(false);
    }
  };

  const pollLogin = (accessToken: string) => {
    const gen = ++linkPollGenRef.current;
    const started = Date.now();
    const tick = async () => {
      if (linkPollGenRef.current !== gen) return;
      try {
        const status = await apiFetch<{
          status: string;
          error?: string;
          pishockUserId?: number;
          pishockUsername?: string | null;
          hubNames?: string[];
        }>('/pishock/login/status', accessToken);
        if (linkPollGenRef.current !== gen) return;
        if (status.status === 'confirm' && status.pishockUserId != null) {
          setLinking(false);
          setLoginUrl(null);
          setOverlay(null);
          setLinkError(null);
          setActionError(null);
          setLinkConfirm({
            pishockUserId: status.pishockUserId,
            pishockUsername: status.pishockUsername ?? null,
            hubNames: status.hubNames ?? [],
          });
          return;
        }
        if (status.status === 'linked') {
          // Already confirmed/linked earlier — just refresh.
          const meData = await refreshMe(accessToken);
          if (linkPollGenRef.current !== gen) return;
          if (meData.pishockLinked) {
            setLinking(false);
            setLoginUrl(null);
            setOverlay(null);
            setLinkConfirm(null);
            setActionError(null);
            await refreshDevices(accessToken);
            await refreshLogs(accessToken).catch(() => undefined);
            return;
          }
        }
        if (status.status === 'error') {
          setLinkError(status.error ?? 'Login failed');
          setLinking(false);
          return;
        }
      } catch (err) {
        if (linkPollGenRef.current !== gen) return;
        setLinkError(err instanceof Error ? err.message : String(err));
        setLinking(false);
        return;
      }
      if (Date.now() - started > 5 * 60 * 1000) {
        if (linkPollGenRef.current !== gen) return;
        setLinkError('Login timed out');
        setLinking(false);
        return;
      }
      window.setTimeout(tick, 2000);
    };
    void tick();
  };

  const cancelPiShockLoginWait = async () => {
    abortLinkPoll();
    setLinking(false);
    setLoginUrl(null);
    setLinkError(null);
    if (!token) return;
    try {
      await apiFetch('/pishock/login/cancel', token, { method: 'POST', body: '{}' });
    } catch {
      // ignore
    }
  };

  const confirmPiShockLink = async () => {
    if (!token || !linkConfirm) return;
    setConfirmBusy(true);
    setLinkError(null);
    try {
      const result = await apiFetch<{
        ok: boolean;
        apiKey?: string;
        apiKeyName?: string;
        expiresAt?: string;
        pishockUsername?: string | null;
      }>('/pishock/login/confirm', token, { method: 'POST', body: '{}' });
      setLinkConfirm(null);
      if (result.apiKey) {
        setApiKeyReveal({
          apiKey: result.apiKey,
          apiKeyName: result.apiKeyName || 'Discord Activity',
          expiresAt: result.expiresAt ?? null,
          pishockUsername: result.pishockUsername ?? linkConfirm.pishockUsername ?? null,
        });
      } else {
        await continueAfterApiKeyReveal(token);
      }
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirmBusy(false);
    }
  };

  const continueAfterApiKeyReveal = async (accessToken: string) => {
    setApiKeyReveal(null);
    setSetupDevicesReady(false);
    setSetupSharePhase(true);
    try {
      const meData = await refreshMe(accessToken);
      if (meData.pishockLinked) {
        await refreshDevices(accessToken);
        await refreshLogs(accessToken).catch(() => undefined);
        setSetupDevicesReady(true);
      } else {
        setSetupSharePhase(false);
        setSetupDevicesReady(false);
      }
    } catch (err) {
      setSetupSharePhase(false);
      setSetupDevicesReady(false);
      setLinkError(err instanceof Error ? err.message : String(err));
    }
  };

  const openLinkFlow = () => {
    if (!me) return;
    setLinkError(null);
    setManualLinkError(null);
    const prefs = loadSetupPrefs(me.user.id);
    if (!prefs.seen) {
      setSetupPhase(true);
      setOverlay(null);
      return;
    }
    setSetupPhase(false);
    setOverlay('link');
  };

  const finishSetup = (choices: SetupChoices) => {
    if (!me) return;
    saveSetupPrefs(me.user.id, choices);
    setSetupPhase(false);
    void startPiShockLogin();
  };

  const cancelPiShockLink = async () => {
    abortLinkPoll();
    if (!token) {
      setLinkConfirm(null);
      setLinking(false);
      setLoginUrl(null);
      return;
    }
    setConfirmBusy(true);
    try {
      await apiFetch('/pishock/login/cancel', token, { method: 'POST', body: '{}' });
    } catch {
      // ignore
    } finally {
      setConfirmBusy(false);
      setLinkConfirm(null);
      setLinking(false);
      setLoginUrl(null);
      setLinkError(null);
    }
  };

  const submitManualApiKey = async (input: { username: string; apiKey: string }) => {
    if (!token) return;
    abortLinkPoll();
    setManualLinkBusy(true);
    setManualLinkError(null);
    setLinkError(null);
    try {
      await apiFetch('/pishock/session/api-key', token, {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setOverlay(null);
      setLoginUrl(null);
      setLinking(false);
      setLinkConfirm(null);
      await continueAfterApiKeyReveal(token);
    } catch (err) {
      setManualLinkError(err instanceof Error ? err.message : String(err));
    } finally {
      setManualLinkBusy(false);
    }
  };

  const handleReloginNeeded = async () => {
    setMe((prev) => (prev ? { ...prev, pishockLinked: false, pishockUserId: null } : prev));
    setDevices(null);
    setLoginUrl(null);
  };

  const requirePiShockLink = (reason: string) => {
    setActionError(reason);
    openLinkFlow();
  };

  const operate = async (input: Record<string, unknown>) => {
    if (!token) return;
    operateInflightRef.current += 1;
    setBusy(true);
    setActionError(null);
    try {
      const targetId =
        typeof input.targetDiscordUserId === 'string'
          ? input.targetDiscordUserId
          : selectedTargetId && friendsMode
            ? selectedTargetId
            : null;
      const instanceId = getActivityInstanceId();
      const locationHint = await resolveActivityLocationHint(token).catch(() => null);
      if (targetId) {
        const result = await apiFetch<{
          ok?: boolean;
          queued?: boolean;
          itemId?: string;
          position?: number;
          paused?: boolean;
          estimatedWaitMs?: number;
          estimatedStartAt?: number;
        }>(`/participants/${targetId}/operate`, token, {
          method: 'POST',
          body: JSON.stringify({ ...input, instanceId, locationHint }),
        });
        if (result.queued && result.itemId) {
          setMyQueueTicket({
            ownerDiscordUserId: targetId,
            itemId: result.itemId,
            status: 'queued',
            position: result.position ?? null,
            paused: Boolean(result.paused),
            estimatedWaitMs: result.estimatedWaitMs ?? null,
            estimatedStartAt: result.estimatedStartAt ?? null,
            at: Date.now(),
          });
        }
      } else if (!me?.pishockLinked) {
        requirePiShockLink(
          'Link PiShock to control your own shockers or website shares. Discord Shockers work without linking.',
        );
        return;
      } else {
        await apiFetch('/operate', token, {
          method: 'POST',
          body: JSON.stringify({ ...input, instanceId, locationHint }),
        });
      }
      await refreshLogs(token).catch(() => undefined);
      const sentId = Number(input.shockerId);
      if (Number.isFinite(sentId) && sentId > 0) {
        setLivePausedIds((prev) => {
          if (!prev.has(sentId)) return prev;
          const next = new Set(prev);
          next.delete(sentId);
          return next;
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PISHOCK_RELOGIN') {
        await handleReloginNeeded();
        requirePiShockLink('PiShock API key expired — link again to control your own devices.');
      } else if (err instanceof ApiError && err.code === 'EMERGENCY_STOP') {
        setActionError('Emergency stop is engaged — owner must release STOP');
        if (token) void refreshParticipantStatus(token, participants, true).catch(() => undefined);
      } else if (err instanceof ApiError && err.code === 'STAR_ONLY') {
        setActionError('They only accept commands from starred people');
        if (token) void refreshParticipantStatus(token, participants, true).catch(() => undefined);
      } else if (err instanceof ApiError && err.code === 'QUEUE_HALTED') {
        setActionError('Their queue is closed to new commands');
        if (token) void refreshParticipantStatus(token, participants, true).catch(() => undefined);
      } else if (
        err instanceof ApiError &&
        (err.code === 'QUEUE_SENDER_FULL' || err.code === 'QUEUE_FULL')
      ) {
        setActionError(err.message);
      } else if (err instanceof ApiError && err.code === 'PISHOCK_PAUSED') {
        const pausedId = Number(input.shockerId);
        if (Number.isFinite(pausedId) && pausedId > 0) {
          setLivePausedIds((prev) => {
            const next = new Set(prev);
            next.add(pausedId);
            return next;
          });
        }
        setActionError(
          'This shocker is paused on PiShock. Controls stay off until it is unpaused there.',
        );
        void refreshDevices(token).catch(() => undefined);
        if (participantsRef.current.length) {
          void refreshParticipantStatus(token, participantsRef.current, true).catch(() => undefined);
        }
      } else {
        setActionError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      operateInflightRef.current = Math.max(0, operateInflightRef.current - 1);
      if (operateInflightRef.current === 0) setBusy(false);
    }
  };

  const applyQueueState = (result: Partial<QueueState> & { enabled?: boolean }) => {
    setQueueState((prev) => ({
      enabled: typeof result.enabled === 'boolean' ? result.enabled : prev.enabled,
      progressMs:
        typeof result.progressMs === 'number' && Number.isFinite(result.progressMs)
          ? result.progressMs
          : prev.progressMs,
      maxPerSender:
        typeof result.maxPerSender === 'number' && Number.isFinite(result.maxPerSender)
          ? result.maxPerSender
          : prev.maxPerSender,
      starOnly: typeof result.starOnly === 'boolean' ? result.starOnly : prev.starOnly,
      paused: typeof result.paused === 'boolean' ? result.paused : prev.paused,
      halted: typeof result.halted === 'boolean' ? result.halted : prev.halted,
      active: result.active !== undefined ? result.active : prev.active,
      waiting: result.waiting !== undefined ? result.waiting : prev.waiting,
    }));
  };

  const patchQueueSettings = async (patch: Partial<QueuePanelSettings>) => {
    if (!token) return;
    setQueueBusy(true);
    setActionError(null);
    try {
      const result = await apiFetch<QueueState & { ok: boolean }>('/queue/settings', token, {
        method: 'POST',
        body: JSON.stringify(patch),
      });
      applyQueueState(result);
      if (typeof result.enabled === 'boolean') {
        setMe((prev) => (prev ? { ...prev, commandQueueEnabled: result.enabled } : prev));
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueBusy(false);
    }
  };

  const setQueuePaused = async (paused: boolean) => {
    if (!token) return;
    setQueueBusy(true);
    setActionError(null);
    try {
      const result = await apiFetch<QueueState & { ok: boolean }>('/queue/pause', token, {
        method: 'POST',
        body: JSON.stringify({ paused }),
      });
      applyQueueState({ ...result, enabled: true });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueBusy(false);
    }
  };

  const setQueueHalted = async (halted: boolean) => {
    if (!token) return;
    setQueueBusy(true);
    setActionError(null);
    try {
      const result = await apiFetch<QueueState & { ok: boolean }>('/queue/halt', token, {
        method: 'POST',
        body: JSON.stringify({ halted }),
      });
      applyQueueState({ ...result, enabled: true });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueBusy(false);
    }
  };

  const skipQueue = async () => {
    if (!token) return;
    setQueueBusy(true);
    setActionError(null);
    try {
      const result = await apiFetch<QueueState & { ok: boolean }>('/queue/skip', token, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      applyQueueState({ ...result, enabled: true });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueBusy(false);
    }
  };

  const clearQueue = async () => {
    if (!token) return;
    setQueueBusy(true);
    setActionError(null);
    try {
      const result = await apiFetch<QueueState & { ok: boolean }>('/queue/clear', token, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      applyQueueState({ ...result, enabled: true });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueBusy(false);
    }
  };

  const removeQueueItem = async (itemId: string) => {
    if (!token) return;
    setQueueBusy(true);
    setActionError(null);
    try {
      const result = await apiFetch<QueueState & { ok: boolean }>(
        `/queue/items/${encodeURIComponent(itemId)}`,
        token,
        { method: 'DELETE' },
      );
      applyQueueState({ ...result, enabled: true });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueBusy(false);
    }
  };

  const toggleQueueStar = async (discordUserId: string, starred: boolean) => {
    if (!token) return;
    setActionError(null);
    try {
      await apiFetch(`/queue/stars/${encodeURIComponent(discordUserId)}`, token, {
        method: 'PUT',
        body: JSON.stringify({ starred }),
      });
      setParticipantStatus((prev) => {
        const row = prev[discordUserId];
        if (!row) return prev;
        return { ...prev, [discordUserId]: { ...row, priority: starred } };
      });
      if (participantStatusCache.map[discordUserId]) {
        const row = participantStatusCache.map[discordUserId];
        participantStatusCache = {
          ...participantStatusCache,
          map: {
            ...participantStatusCache.map,
            [discordUserId]: { ...row, priority: starred },
          },
        };
      }
      if (queueState.enabled) {
        void refreshQueue(token).catch(() => undefined);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const setEmergencyStop = async (input: {
    shockerId: number;
    shockerIds?: number[];
    clientId?: number | string;
    engaged: boolean;
  }) => {
    if (!token) return;
    if (!me?.pishockLinked) {
      requirePiShockLink('Link PiShock to use emergency stop on your devices.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const result = await apiFetch<{
        emergencyStopShockerIds: number[];
        websitePauseSynced?: boolean;
        websitePauseErrors?: string[];
      }>('/emergency-stop', token, {
        method: 'PUT',
        body: JSON.stringify({
          shockerId: input.shockerId,
          shockerIds: input.shockerIds,
          clientId: input.clientId,
          engaged: input.engaged,
        }),
      });
      setMe((prev) =>
        prev ? { ...prev, emergencyStopShockerIds: result.emergencyStopShockerIds } : prev,
      );
      if (input.engaged) {
        setLivePausedIds((prev) => {
          const next = new Set(prev);
          for (const id of input.shockerIds?.length ? input.shockerIds : [input.shockerId]) {
            if (Number.isFinite(id) && id > 0) next.add(Math.floor(id));
          }
          return next;
        });
      } else {
        setLivePausedIds((prev) => {
          const next = new Set(prev);
          for (const id of input.shockerIds?.length ? input.shockerIds : [input.shockerId]) {
            next.delete(Math.floor(id));
          }
          return next;
        });
      }
      if (result.websitePauseSynced === false && result.websitePauseErrors?.length) {
        setActionError(
          `STOP latched here, but PiShock.com pause failed: ${result.websitePauseErrors[0]}`,
        );
      }
      participantStatusCache = { key: '', fetchedAt: 0, map: {} };
      await refreshDevices(token).catch(() => undefined);
      await refreshLogs(token).catch(() => undefined);
      if (participants.length) {
        await refreshParticipantStatus(token, participants, true).catch(() => undefined);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PISHOCK_RELOGIN') {
        await handleReloginNeeded();
        requirePiShockLink('PiShock API key expired — link again to control your own devices.');
      } else {
        setActionError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const loadAvailability = useCallback(async () => {
    if (!token) throw new Error('Not authenticated');
    return apiFetch<{
      shares: ActivityShareConfig[];
      bannedDiscordUserIds: string[];
      available: boolean;
      personal?: PersonalLimits;
    }>('/activity/share', token);
  }, [token]);

  const saveAvailability = useCallback(
    async (payload: {
      shares: ActivityShareConfig[];
      bannedDiscordUserIds: string[];
    }) => {
      if (!token) throw new Error('Not authenticated');
      await apiFetch('/activity/share', token, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      participantStatusCache = { key: '', fetchedAt: 0, map: {} };
      if (participants.length) {
        await refreshParticipantStatus(token, participants, true);
      }
    },
    [token, participants, refreshParticipantStatus],
  );

  const finishSetupShare = useCallback(() => {
    setSetupSharePhase(false);
    setSetupDevicesReady(false);
    setSetupShareBusy(false);
    setLinkError(null);
  }, []);

  const startDiscordSetupRedo = useCallback(async () => {
    if (!token || !me?.pishockLinked) return;
    setOverlay(null);
    setLinkError(null);
    setSetupShareBusy(false);
    setSetupDevicesReady(false);
    setSetupShareKey((k) => k + 1);
    setSetupSharePhase(true);
    try {
      await refreshDevices(token);
      setSetupDevicesReady(true);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : String(err));
      setSetupDevicesReady(true);
    }
  }, [token, me?.pishockLinked, refreshDevices]);

  const applyDiscordShareLimits = useCallback((shares: ShareLimitRow[]) => {
    const next: Record<
      number,
      {
        enabled: boolean;
        minIntensity: number;
        maxIntensity: number;
        minDurationMs: number;
        maxDurationMs: number;
      }
    > = {};
    for (const row of shares) {
      next[row.shockerId] = {
        enabled: row.enabled,
        minIntensity: row.minIntensity ?? 1,
        maxIntensity: row.maxIntensity,
        minDurationMs: row.minDurationMs ?? 16,
        maxDurationMs: row.maxDurationMs,
      };
    }
    setDiscordShareLimits(next);
  }, []);

  const loadSettings = useCallback(async () => {
    if (!token) throw new Error('Not authenticated');
    const data = await apiFetch<{ personal: PersonalLimits; shares: ShareLimitRow[] }>(
      '/activity/settings',
      token,
    );
    applyDiscordShareLimits(data.shares);
    return data;
  }, [token, applyDiscordShareLimits]);

  const saveSettings = useCallback(
    async (payload: { personal: PersonalLimits; shares: ShareLimitRow[] }) => {
      if (!token) throw new Error('Not authenticated');
      const result = await apiFetch<{ personal: PersonalLimits; shares: ShareLimitRow[] }>(
        '/activity/settings',
        token,
        { method: 'PUT', body: JSON.stringify(payload) },
      );
      setMe((prev) => (prev ? { ...prev, personal: result.personal } : prev));
      applyDiscordShareLimits(result.shares);
      participantStatusCache = { key: '', fetchedAt: 0, map: {} };
      if (participants.length) {
        await refreshParticipantStatus(token, participants, true);
      }
    },
    [token, participants, refreshParticipantStatus, applyDiscordShareLimits],
  );

  const saveSetupDiscordShares = useCallback(
    async (result: {
      shares: ActivityShareConfig[];
      personal: PersonalLimits;
      queue?: QueuePanelSettings;
    }) => {
      setSetupShareBusy(true);
      setLinkError(null);
      try {
        const shares: ShareLimitRow[] = result.shares.map((s) => ({
          shockerId: s.shockerId,
          shockerName: s.shockerName,
          hubClientId: s.hubClientId ?? null,
          hubName: s.hubName ?? null,
          enabled: s.enabled,
          paused: s.paused,
          deviceMaxIntensity: s.deviceMaxIntensity ?? s.maxIntensity,
          deviceMaxDurationMs: s.deviceMaxDurationMs ?? s.maxDurationMs,
          minIntensity: s.minIntensity ?? 1,
          maxIntensity: s.maxIntensity,
          minDurationMs: s.minDurationMs ?? 16,
          maxDurationMs: s.maxDurationMs,
          vibMinIntensity: s.vibMinIntensity ?? s.minIntensity ?? 1,
          vibMaxIntensity: s.vibMaxIntensity ?? s.maxIntensity,
          vibMinDurationMs: s.vibMinDurationMs ?? s.minDurationMs ?? 16,
          vibMaxDurationMs: s.vibMaxDurationMs ?? s.maxDurationMs,
          beepMinIntensity: s.beepMinIntensity ?? s.minIntensity ?? 1,
          beepMaxIntensity: s.beepMaxIntensity ?? s.maxIntensity,
          beepMinDurationMs: s.beepMinDurationMs ?? s.minDurationMs ?? 16,
          beepMaxDurationMs: s.beepMaxDurationMs ?? s.maxDurationMs,
          canShock: s.canShock,
          canVibrate: s.canVibrate,
          canBeep: s.canBeep,
          canHold: s.canHold,
          requiredWarningLevel: s.requiredWarningLevel ?? 'none',
        }));
        await saveSettings({ personal: result.personal, shares });
        if (result.queue && token) {
          const queueResult = await apiFetch<QueueState & { ok: boolean }>('/queue/settings', token, {
            method: 'POST',
            body: JSON.stringify(result.queue),
          });
          applyQueueState(queueResult);
          setMe((prev) =>
            prev ? { ...prev, commandQueueEnabled: Boolean(queueResult.enabled) } : prev,
          );
        }
        finishSetupShare();
      } catch (err) {
        setLinkError(err instanceof Error ? err.message : String(err));
        setSetupShareBusy(false);
      }
    },
    [saveSettings, finishSetupShare, token],
  );

  useEffect(() => {
    if (!token || !me?.pishockLinked || !me.consent) return;
    void loadSettings().catch(() => undefined);
  }, [token, me?.pishockLinked, me?.consent, loadSettings]);

  useEffect(() => {
    if (!token || !me?.pishockLinked || !me.consent) return;
    void refreshQueue(token).catch(() => undefined);
  }, [token, me?.pishockLinked, me?.consent, refreshQueue]);

  const primaryHub = (() => {
    if (friendsMode) {
      const target = participants.find((p) => p.id === selectedTargetId);
      return {
        id: selectedTargetId ?? 'friends',
        name: target?.displayName ?? 'Discord Shockers',
        online: friendShockers.length > 0 && !friendBlocked,
        lastSeen: friendBlocked
          ? 'You are blocked'
          : friendAllEStop
            ? 'Emergency stop armed'
            : friendAllPaused
              ? 'Paused on PiShock'
            : friendStarBlocked
              ? 'Stars only — ask them to star you'
              : friendQueueHalted
                ? 'Queue closed to new commands'
                : friendQueuePaused
                  ? 'Queue paused — you can still join'
                  : friendStarred
                    ? 'You are starred'
                    : friendShockers.length > 0
                      ? 'Activity share'
                      : selectedTargetId
                        ? 'No shockers shared'
                        : 'Select a participant',
      };
    }
    if (!me?.pishockLinked) {
      return {
        id: 'link',
        name: 'Link PiShock',
        online: false,
        lastSeen: 'Needed for your devices · Discord Shockers work without linking',
      };
    }
    const selected =
      hubOptions.find((h) => h.id === selectedHubId) ?? hubOptions[0] ?? {
        id: '0',
        name: 'PiShock',
        online: ownShockers.some((s) => s.online),
        lastSeen: ownShockers.some((s) => s.online) ? 'Seen a few seconds ago' : 'Checking…',
      };
    return selected;
  })();

  const pingHub = async () => {
    if (!token || !me?.pishockLinked || friendsMode) return;
    setPinging(true);
    setActionError(null);
    try {
      const clientIds = devices ? collectClientIds(devices) : [];
      const focus = selectedHubId ? [selectedHubId, ...clientIds] : clientIds;
      await refreshOnlineStatus(token, [...new Set(focus)], 3500);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPinging(false);
    }
  };

  if (legalView === 'terms') {
    return <TermsOfService onBack={() => setLegalView(null)} />;
  }
  if (legalView === 'privacy') {
    return <PrivacyPolicy onBack={() => setLegalView(null)} />;
  }

  if (!bootReady || !auth || !me) {
    return (
      <AuthLoadingScreen
        progress={bootProgress}
        label={bootError ? 'Failed' : bootLabel}
        error={bootError}
      />
    );
  }

  if (setupPhase) {
    return (
      <SetupWizard
        discordName={me.user.global_name || me.user.username}
        onComplete={(choices) => {
          finishSetup(choices);
        }}
        onSkipToLogin={(choices) => {
          finishSetup(choices);
        }}
      />
    );
  }

  if (apiKeyReveal) {
    return (
      <ApiKeyRevealPanel
        apiKey={apiKeyReveal.apiKey}
        apiKeyName={apiKeyReveal.apiKeyName}
        expiresAt={apiKeyReveal.expiresAt}
        pishockUsername={apiKeyReveal.pishockUsername}
        onContinue={() => {
          if (!token) {
            setApiKeyReveal(null);
            return;
          }
          void continueAfterApiKeyReveal(token);
        }}
      />
    );
  }

  if (linkConfirm) {
    return (
      <LinkConfirmPanel
        pishockUserId={linkConfirm.pishockUserId}
        pishockUsername={linkConfirm.pishockUsername}
        hubNames={linkConfirm.hubNames}
        discordName={me.user.global_name || me.user.username}
        busy={confirmBusy}
        error={linkError}
        onConfirm={confirmPiShockLink}
        onCancel={cancelPiShockLink}
      />
    );
  }

  if (setupSharePhase) {
    const ownedForSetup = ownedAndShared.filter((s) => s.owned);
    const initialSelectedIds = Object.entries(discordShareLimits)
      .filter(([, row]) => row.enabled)
      .map(([id]) => Number(id))
      .filter((id) => ownedForSetup.some((s) => s.id === id));
    return (
      <SetupDiscordShareScreen
        key={setupShareKey}
        shockers={ownedForSetup}
        initialPersonal={personalLimits}
        initialSelectedIds={initialSelectedIds}
        devicesReady={setupDevicesReady}
        busy={setupShareBusy}
        error={linkError}
        onComplete={saveSetupDiscordShares}
        onSkip={finishSetupShare}
      />
    );
  }

  if (me.pishockLinked && defaultMenuPrompt) {
    const canDismissDefaultMenu =
      Boolean(me.user?.id) && loadDefaultStartMenu(me.user.id) != null;
    return (
      <DefaultMenuPrompt
        discordName={me.user.global_name || me.user.username}
        onChoose={applyDefaultStartMenu}
        onDismiss={canDismissDefaultMenu ? () => setDefaultMenuPrompt(false) : undefined}
      />
    );
  }

  // Waiting on browser PiShock login — same boot aesthetic as Discord auth
  if (linking || linkError) {
    return (
      <PiShockLinkingScreen
        label={loginUrl ? 'Waiting for PiShock login…' : 'Opening PiShock login…'}
        error={linkError}
        canReopen={Boolean(loginUrl)}
        onReopen={() => loginUrl && openExternal(loginUrl)}
        onCancel={() => void cancelPiShockLoginWait()}
        onRetry={() => void startPiShockLogin()}
      />
    );
  }

  if (me.consent) {
    const ownedShockers = ownedAndShared.filter((s) => s.owned);

    const officialLogEntries = publicLogs;

    const openOfficialLogs = () => {
      setLogsOpen(true);
      if (token) void refreshLogs(token).catch(() => undefined);
    };

    const openLinkedOverlay = (next: Overlay) => {
      if (
        !me.pishockLinked &&
        (next === 'availability' || next === 'shares' || next === 'settings')
      ) {
        requirePiShockLink(
          next === 'availability'
            ? 'Link PiShock to make your shockers available in this Discord activity.'
            : next === 'settings'
              ? 'Link PiShock to configure Activity Limits for your devices.'
              : 'Link PiShock to manage your website shares and links.',
        );
        return;
      }
      if (next !== 'settings') setSettingsFocusShockerId(null);
      setOverlay(next);
    };

    // PIP: nothing but the last hit — no header, menu, safety bar, or controls
    if (pip) {
      return <PipIncomingShock hit={pipHit} />;
    }

    return (
      <div className="official-activity-root">
        {actionError ? (
          <div className="q-banner bg-negative text-white official-error-toast" style={{ zIndex: 7000 }}>
            <div className="q-banner__content col text-body2">{actionError}</div>
            <button
              type="button"
              className="q-btn q-btn-item non-selectable no-outline q-btn--flat q-btn--round text-white q-btn--dense"
              onClick={() => setActionError(null)}
              aria-label="Dismiss"
            >
              <span className="q-btn__wrapper col row q-anchor--skip">
                <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                  <i className="q-icon mdi mdi-close" aria-hidden />
                </span>
              </span>
            </button>
          </div>
        ) : null}

        <OfficialController
          hub={primaryHub}
          hubs={hubOptions}
          shockers={shockers}
          busy={busy}
          pip={pip}
          friendsOpen={friendsMode}
          selectedHubId={selectedHubId}
          pinging={pinging}
          showLinkAccount={!me.pishockLinked}
          showOwnMode={me.pishockLinked}
          emptyMessage={
            friendBlocked
              ? 'You are blocked by this user. You cannot view or use any of their shockers.'
              : friendsMode && selectedTargetIds.length > 0
                ? 'No shockers shared by the selected participants.'
                : friendsMode
                  ? me.pishockLinked
                    ? 'Select Discord Shockers to control.'
                    : 'Not linked to PiShock — open Discord Shockers and pick someone who shared devices.'
                  : 'No shockers'
          }
          accessBanner={
            friendBlocked ? (
              <div className="access-banner access-banner--blocked q-mt-sm q-pa-sm">
                <div className="text-negative text-subtitle2">You are blocked</div>
                <div className="text-grey-4 text-body2">
                  This user blocked you. You cannot view or use any of their shockers.
                </div>
              </div>
            ) : friendAllEStop ? (
              <div className="access-banner access-banner--estop q-mt-sm q-pa-sm">
                <div className="text-negative text-subtitle2">Emergency stop armed</div>
                <div className="text-grey-4 text-body2">
                  The owner engaged emergency stop. Shockers stay visible, but all controls are
                  disabled until they release it.
                </div>
              </div>
            ) : friendAllPaused ? (
              <div className="access-banner access-banner--estop q-mt-sm q-pa-sm">
                <div className="text-negative text-subtitle2">Paused on PiShock</div>
                <div className="text-grey-4 text-body2">
                  These shockers are paused on pishock.com. Controls stay off until they are
                  unpaused there.
                </div>
              </div>
            ) : friendStarBlocked ? (
              <div className="access-banner access-banner--star-blocked q-mt-sm q-pa-sm">
                <div className="text-warning text-subtitle2">Stars only</div>
                <div className="text-grey-4 text-body2">
                  They only accept commands from starred people. Ask them to star you — controls
                  stay locked until then.
                </div>
              </div>
            ) : friendQueueHalted ? (
              <div className="access-banner access-banner--queue-halted q-mt-sm q-pa-sm">
                <div className="text-warning text-subtitle2">Queue closed</div>
                <div className="text-grey-4 text-body2">
                  They halted new queue entries. Existing waiting commands are kept, but you
                  cannot send anything new until they open the queue again.
                </div>
              </div>
            ) : friendQueuePaused ? (
              <div className="access-banner access-banner--queue-paused q-mt-sm q-pa-sm">
                <div className="text-warning text-subtitle2">Queue paused</div>
                <div className="text-grey-4 text-body2">
                  Processing is paused, but you can still send commands into their queue. They’ll
                  run when the owner resumes.
                </div>
              </div>
            ) : null
          }
          starredPanel={friendStarred}
          starredPanelStarOnly={Boolean(friendQueue?.starOnly)}
          forceControlsLocked={friendControlsLocked}
          safetyBanner={!pip ? <SafetyNoticeBar /> : null}
          friendsPanel={({
            multiShock,
            onToggleMultiShock,
            individualIntensity,
            onToggleIndividualIntensity,
          }) => (
            <FriendsParticipantList
              participants={participants}
              statuses={participantStatus}
              currentUserId={me.user.id}
              selectedTargetId={selectedTargetId}
              selectedTargetIds={selectedTargetIds}
              multiSelect={multiShock}
              onToggleMultiSelect={onToggleMultiShock}
              individualIntensity={individualIntensity}
              onToggleIndividualIntensity={onToggleIndividualIntensity}
              onSelect={(id) => {
                if (!id) {
                  setSelectedTargetIds([]);
                  return;
                }
                if (multiShock) {
                  setSelectedTargetIds((prev) =>
                    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                  );
                  return;
                }
                setSelectedTargetIds((prev) =>
                  prev.length === 1 && prev[0] === id ? [] : [id],
                );
              }}
              onRefresh={() => token && refreshParticipants(token, true)}
              onTogglePriority={
                me.pishockLinked
                  ? (id, starred) => void toggleQueueStar(id, starred)
                  : undefined
              }
            />
          )}
          onOperate={(input) =>
            operate({
              ...input,
              targetDiscordUserId:
                typeof input.targetDiscordUserId === 'string'
                  ? input.targetDiscordUserId
                  : friendsMode
                    ? selectedTargetId
                    : undefined,
            })
          }
          estopShockers={ownedAndShared.filter((s) => s.owned)}
          onEmergencyStop={setEmergencyStop}
          onSelectHub={(hubId) => {
            if (!me.pishockLinked) return;
            setFriendsMode(false);
            setSelectedTargetIds([]);
            setSelectedHubId(hubId);
          }}
          onOpenOwnShockers={() => {
            if (!me.pishockLinked) return;
            setFriendsMode(false);
            setSelectedTargetIds([]);
          }}
          onOpenFriends={() => {
            setFriendsMode(true);
            if (token) void refreshParticipants(token, true);
          }}
          onOpenMenu={() => setOverlay('menu')}
          onOpenLinkAccount={openLinkFlow}
          onOpenShockerSettings={(s) => {
            if (!me.pishockLinked || !s.owned) {
              requirePiShockLink(
                'Link PiShock to edit Activity Limits and device settings for your shockers.',
              );
              return;
            }
            setSettingsFocusShockerId(s.id);
            openLinkedOverlay('settings');
          }}
          onPingHub={() => {
            if (!me.pishockLinked) {
              requirePiShockLink('Link PiShock to ping your hub.');
              return;
            }
            void pingHub();
          }}
          onPair={(s) => {
            if (!me.pishockLinked || !s.owned) {
              requirePiShockLink('Link PiShock to pair your own shockers.');
              return;
            }
            setPairDialog(s);
          }}
          onShareShocker={async (s) => {
            if (!me.pishockLinked) {
              requirePiShockLink('Link PiShock to create share codes for your own shockers.');
              return;
            }
            if (!token || !s.owned) return;
            setBusy(true);
            try {
              await apiFetch('/shares', token, {
                method: 'POST',
                body: JSON.stringify({ ShockerId: s.id }),
              });
              await refreshDevices(token);
              setOverlay('shares');
            } catch (err) {
              setActionError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        />

        <PsDialog
          open={Boolean(pairDialog)}
          title={pairDialog ? `Pair ${pairDialog.name}` : 'Pair'}
          onClose={() => setPairDialog(null)}
        >
          <div className="column q-gutter-sm">
            <div className="text-body2 text-grey-3">
              Put the shocker into pairing mode (power on, then hold the button ~3 seconds). While
              the shocker is pairing, send a vibrate from here to complete pairing.
            </div>
            <button
              type="button"
              className="q-btn q-btn--standard bg-secondary text-dark q-btn--rectangle"
              disabled={busy || !pairDialog}
              onClick={() => {
                if (!pairDialog) return;
                void operate({
                  shockerId: pairDialog.id,
                  clientId: pairDialog.clientId,
                  operation: 'vibrate',
                  intensity: Math.min(20, pairDialog.maxIntensity || 20),
                  durationMs: 1000,
                  canShock: pairDialog.canShock,
                  canVibrate: true,
                  canBeep: pairDialog.canBeep,
                  canHold: pairDialog.canHold,
                  maxIntensity: pairDialog.maxIntensity,
                  maxDuration: pairDialog.maxDuration,
                });
              }}
            >
              Send pair vibrate
            </button>
            <button
              type="button"
              className="q-btn q-btn--outline text-secondary q-btn--rectangle"
              onClick={() => setPairDialog(null)}
            >
              Done
            </button>
          </div>
        </PsDialog>

        <PsDialog open={overlay === 'menu'} title="Menu" onClose={() => setOverlay(null)}>
          <div className="q-list q-list--dark menu-action-list">
            <div className="q-pa-sm text-caption text-grey-5">
              {me.pishockLinked
                ? 'PiShock linked — manage Discord availability, limits, and shares here. Mode switching is in the bottom-left dock.'
                : 'No PiShock login needed to control Discord Shockers. Link only to share yourself or use your own devices.'}
            </div>
            {(
              [
                ['availability', 'Available in Discord', 'mdi-account-check'],
                ['settings', 'Activity Limits', 'mdi-tune'],
                ['shares', 'Shares & links', 'mdi-share-variant'],
                ['logs', 'Logs', 'mdi-message-text-clock'],
              ] as const
            )
              .filter(([id]) => me.pishockLinked || id === 'logs')
              .map(([id, label, icon]) => (
              <button
                key={id}
                type="button"
                className="q-item q-item-type row no-wrap q-item--dark q-item--clickable cursor-pointer full-width bg-transparent text-left"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (id === 'logs') {
                    setOverlay(null);
                    openOfficialLogs();
                    return;
                  }
                  if (id === 'settings') setSettingsFocusShockerId(null);
                  openLinkedOverlay(id);
                }}
              >
                <div className="q-item__section column q-item__section--avatar q-item__section--side justify-center">
                  <i className={`q-icon mdi ${icon} text-secondary`} aria-hidden />
                </div>
                <div className="q-item__section column q-item__section--main justify-center">
                  <div className="q-item__label text-grey-3">{label}</div>
                </div>
              </button>
            ))}
            {me.pishockLinked ? (
              <button
                type="button"
                className="q-item q-item-type row no-wrap q-item--dark q-item--clickable cursor-pointer full-width bg-transparent text-left"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOverlay(null);
                  setDefaultMenuPrompt(true);
                }}
              >
                <div className="q-item__section column q-item__section--avatar q-item__section--side justify-center">
                  <i className="q-icon mdi mdi-view-dashboard-outline text-secondary" aria-hidden />
                </div>
                <div className="q-item__section column q-item__section--main justify-center">
                  <div className="q-item__label text-grey-3">Default start menu</div>
                  <div className="q-item__label q-item__label--caption text-grey-5">
                    Discord Shockers or My Shockers on launch
                  </div>
                </div>
              </button>
            ) : null}
            {me.pishockLinked ? (
              <button
                type="button"
                className="q-item q-item-type row no-wrap q-item--dark q-item--clickable cursor-pointer full-width bg-transparent text-left"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void startDiscordSetupRedo();
                }}
              >
                <div className="q-item__section column q-item__section--avatar q-item__section--side justify-center">
                  <i className="q-icon mdi mdi-replay text-secondary" aria-hidden />
                </div>
                <div className="q-item__section column q-item__section--main justify-center">
                  <div className="q-item__label text-grey-3">Redo Discord setup</div>
                  <div className="q-item__label q-item__label--caption text-grey-5">
                    Start again from shocker select
                  </div>
                </div>
              </button>
            ) : null}
            {me.pishockLinked ? (
              <button
                type="button"
                className="q-item q-item-type row no-wrap q-item--dark q-item--clickable cursor-pointer full-width bg-transparent text-left"
                onMouseDown={(e) => e.preventDefault()}
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!token) return;
                  setOverlay(null);
                  try {
                    await apiFetch('/pishock/session', token, { method: 'DELETE' });
                    setFriendsMode(true);
                    await handleReloginNeeded();
                  } catch (err) {
                    setActionError(err instanceof Error ? err.message : String(err));
                  }
                }}
              >
                <div className="q-item__section column q-item__section--avatar q-item__section--side justify-center">
                  <i className="q-icon mdi mdi-link-off text-negative" aria-hidden />
                </div>
                <div className="q-item__section column q-item__section--main justify-center">
                  <div className="q-item__label text-negative">Unlink PiShock</div>
                </div>
              </button>
            ) : (
              <button
                type="button"
                className="q-item q-item-type row no-wrap q-item--dark q-item--clickable cursor-pointer full-width bg-transparent text-left"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openLinkFlow();
                }}
              >
                <div className="q-item__section column q-item__section--avatar q-item__section--side justify-center">
                  <i className="q-icon mdi mdi-link-variant text-secondary" aria-hidden />
                </div>
                <div className="q-item__section column q-item__section--main justify-center">
                  <div className="q-item__label text-secondary">Link PiShock Account</div>
                </div>
              </button>
            )}
          </div>
        </PsDialog>

        <PsDialog
          open={overlay === 'link'}
          title="Link PiShock"
          onClose={() => setOverlay(null)}
          wide
        >
          <LoginPanel
            linking={linking}
            loginUrl={null}
            error={null}
            onStart={startPiShockLogin}
            onOpen={() => undefined}
            onRefresh={() => undefined}
            onManualSubmit={submitManualApiKey}
            manualBusy={manualLinkBusy}
            manualError={manualLinkError}
          />
        </PsDialog>

        <PsDialog
          open={overlay === 'availability'}
          title="Available in Discord"
          onClose={() => setOverlay(null)}
          wide
        >
          <AvailabilitySettings
            ownedShockers={ownedShockers}
            participants={participants}
            currentUserId={me.user.id}
            busy={busy}
            onLoad={loadAvailability}
            onSave={async (payload) => {
              await saveAvailability(payload);
              setOverlay(null);
            }}
          />
        </PsDialog>

        <PsDialog
          open={overlay === 'settings'}
          title="Activity Limits"
          onClose={() => {
            setOverlay(null);
            setSettingsFocusShockerId(null);
          }}
          fill
        >
          <ActivityLimitsSettings
            ownedShockers={ownedShockers}
            busy={busy}
            focusShockerId={settingsFocusShockerId}
            onLoad={loadSettings}
            onRevokeConsent={revokeConsent}
            onSave={async (payload) => {
              await saveSettings(payload);
              setOverlay(null);
              setSettingsFocusShockerId(null);
            }}
          />
        </PsDialog>

        <PsDialog open={overlay === 'shares'} title="Shares & links" onClose={() => setOverlay(null)} wide>
          <SharesPanel
            links={(devices?.links as Array<Record<string, unknown>>) ?? []}
            shared={
              Array.isArray(devices?.shared)
                ? (devices?.shared as Array<Record<string, unknown>>)
                : []
            }
            shockers={ownedShockers.map((s) => ({ id: s.id, name: s.name }))}
            busy={busy}
            onCreate={async (payload) => {
              if (!token) return;
              setBusy(true);
              try {
                await apiFetch('/links', token, { method: 'POST', body: JSON.stringify(payload) });
                await refreshDevices(token);
              } catch (err) {
                setActionError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
            onPause={async (linkId, pauseState) => {
              if (!token) return;
              setBusy(true);
              try {
                await apiFetch('/pause', token, {
                  method: 'POST',
                  body: JSON.stringify({ linkId, pauseState }),
                });
                await refreshDevices(token);
              } catch (err) {
                setActionError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
            onDelete={async (linkId) => {
              if (!token) return;
              setBusy(true);
              try {
                await apiFetch(`/links/${linkId}`, token, { method: 'DELETE' });
                await refreshDevices(token);
              } catch (err) {
                setActionError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
            onCreateShare={async (shockerId) => {
              if (!token) return;
              setBusy(true);
              try {
                await apiFetch('/shares', token, {
                  method: 'POST',
                  body: JSON.stringify({
                    ShockerId: shockerId,
                    MaxIntensity: 100,
                    MaxDuration: 15,
                    CanShock: true,
                    CanVibrate: true,
                    CanBeep: true,
                  }),
                });
                await refreshDevices(token);
              } catch (err) {
                setActionError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
            onClaimShare={async (code) => {
              if (!token) return;
              setBusy(true);
              try {
                await apiFetch('/shares', token, {
                  method: 'PUT',
                  body: JSON.stringify({ code }),
                });
                await refreshDevices(token);
              } catch (err) {
                setActionError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          />
        </PsDialog>

        <div className="official-right-rail">
          {me.pishockLinked && queueOpen ? (
            <QueuePanel
              settings={{
                enabled: queueState.enabled,
                progressMs: queueState.progressMs,
                maxPerSender: queueState.maxPerSender,
                starOnly: queueState.starOnly,
              }}
              paused={queueState.paused}
              halted={queueState.halted}
              active={queueState.active}
              waiting={queueState.waiting}
              busy={queueBusy}
              onClose={() => setQueueOpen(false)}
              onSettingsChange={(patch) => void patchQueueSettings(patch)}
              onTogglePaused={(paused) => void setQueuePaused(paused)}
              onToggleHalted={(halted) => void setQueueHalted(halted)}
              onSkip={() => void skipQueue()}
              onClear={() => void clearQueue()}
              onRemove={(itemId) => void removeQueueItem(itemId)}
              onToggleStar={(id, starred) => void toggleQueueStar(id, starred)}
              displayNameFor={(item) => {
                const fromRoster = participants.find((p) => p.id === item.executorDiscordUserId);
                return (
                  fromRoster?.displayName ||
                  item.executorGlobalName ||
                  item.executorUsername ||
                  'Someone'
                );
              }}
              avatarUrlFor={(item) => {
                const fromRoster = participants.find((p) => p.id === item.executorDiscordUserId);
                return (
                  fromRoster?.avatarUrl ||
                  participantAvatarUrl(item.executorDiscordUserId, item.executorAvatar)
                );
              }}
            />
          ) : null}
          {myQueueTicket &&
          (myQueueTicket.status === 'queued' || myQueueTicket.status === 'started') ? (
            <div className="queue-ticket-banner text-caption">
              {myQueueTicket.status === 'started' ? (
                <>
                  <div className="queue-ticket-banner__title">Your command is running</div>
                </>
              ) : (
                <>
                  <div className="queue-ticket-banner__title">
                    {myQueueTicket.paused ? 'Queue paused' : 'In queue'}
                    {myQueueTicket.position != null ? ` · #${myQueueTicket.position}` : ''}
                  </div>
                  <div className="queue-ticket-banner__eta">
                    {(() => {
                      const eta = formatQueueEta(myQueueTicket.estimatedWaitMs);
                      if (myQueueTicket.paused) {
                        return eta && eta !== 'now'
                          ? `~${eta} after they resume`
                          : 'Waiting for them to resume';
                      }
                      if (!eta) return 'Estimating wait…';
                      if (eta === 'now') return 'Starting soon';
                      return `Wait ~${eta}`;
                    })()}
                  </div>
                </>
              )}
            </div>
          ) : null}
          <div className="official-right-rail__fabs">
            {me.pishockLinked ? (
              <QueueFab
                count={queueState.waiting.length}
                enabled={queueState.enabled}
                paused={queueState.paused}
                halted={queueState.halted}
                active={Boolean(queueState.active)}
                onClick={() => setQueueOpen((open) => !open)}
              />
            ) : null}
            <OfficialLogsFab count={officialLogEntries.length} onClick={openOfficialLogs} />
          </div>
        </div>
        <OfficialLogsPanel
          open={logsOpen || overlay === 'logs'}
          entries={officialLogEntries}
          onClose={() => {
            setLogsOpen(false);
            if (overlay === 'logs') setOverlay(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className={`app-shell official-preflight consent-shell ${pip ? 'pip' : ''}`}>
      <div className="consent-shell__brand">
        <h1 className="auth-boot__brand auth-boot__brand-row">
          <span className="auth-boot__brand-name">
            Pi<span>Shock</span>
          </span>
          <AppVersionBadge />
        </h1>
        <p className="auth-boot__sub">Discord Activity</p>
        <span className="status-pill consent-shell__user">
          <span className="dot on" />
          {me.user.global_name || me.user.username}
        </span>
      </div>

      {!isEmbedded ? (
        <div className="q-card q-card--dark q-dark q-pa-md" style={{ border: '1px solid rgba(121,198,219,.35)', maxWidth: 480, width: '100%' }}>
          <div className="text-secondary text-h6" style={{ fontFamily: 'geo, Oxanium, sans-serif' }}>
            Local preview
          </div>
          <p className="text-grey-5 text-body2">
            Open this activity inside Discord for real auth. Use <code>/?demo=1</code> for the
            official UI clone.
          </p>
        </div>
      ) : null}

      {actionError ? <div className="error-banner">{actionError}</div> : null}

      <SafetyWarning
        onAccept={acceptConsent}
        busy={busy}
        onOpenTerms={() => setLegalView('terms')}
        onOpenPrivacy={() => setLegalView('privacy')}
      />
    </div>
  );
}

function normalizeClientKey(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  let id = String(raw).trim();
  if (!id) return null;
  if (/^c\d+$/i.test(id)) id = id.slice(1);
  return id;
}

function hubClientId(row: Record<string, unknown>): string | null {
  const id = row.ClientId ?? row.clientId ?? row.HubId ?? row.hubId ?? row.Id ?? row.id;
  return normalizeClientKey(id != null ? String(id) : null);
}

function shockerClientId(row: Record<string, unknown>): string | null {
  const id = row.ClientId ?? row.clientId ?? row.HubId ?? row.hubId;
  return normalizeClientKey(id != null ? String(id) : null);
}

/** Official API MaxDuration is seconds; operate path expects ms */
function maxDurationMs(row: Record<string, unknown>): number {
  const raw = Number(row.MaxDuration ?? row.maxDuration ?? 15);
  if (!Number.isFinite(raw) || raw <= 0) return 15_000;
  return raw <= 60 ? Math.round(raw * 1000) : Math.round(raw);
}

function collectClientIds(devices: DevicesResponse): string[] {
  const ids = new Set<string>();
  for (const hub of devices.hubs ?? []) {
    const id = hubClientId(hub);
    if (id) ids.add(id);
  }
  for (const s of devices.shockers ?? []) {
    const id = shockerClientId(s);
    if (id) ids.add(id);
  }
  const sharedList = Array.isArray(devices.shared)
    ? devices.shared
    : devices.shared && typeof devices.shared === 'object'
      ? Object.values(devices.shared as Record<string, unknown>).flatMap((v) =>
          Array.isArray(v) ? v : [v],
        )
      : [];
  for (const s of sharedList as Array<Record<string, unknown>>) {
    const id = shockerClientId(s);
    if (id) ids.add(id);
  }
  return [...ids];
}

function pauseRowsFromDevices(devices: DevicesResponse): Array<Record<string, unknown>> {
  const shared = Array.isArray(devices.shared)
    ? devices.shared
    : devices.shared && typeof devices.shared === 'object'
      ? Object.values(devices.shared as Record<string, unknown>).flatMap((v) =>
          Array.isArray(v) ? v : [v],
        )
      : [];
  return [...(devices.shockers ?? []), ...(shared as Array<Record<string, unknown>>)];
}

function dropResolvedPause(
  live: Set<number>,
  rows: Array<Record<string, unknown>>,
): Set<number> {
  if (live.size === 0) return live;
  const next = new Set(live);
  for (const row of rows) {
    const id = Number(row.ShockerId ?? row.shockerId ?? row.Id ?? row.id);
    if (!Number.isFinite(id)) continue;
    if (isPiShockRowPaused(row) || isPiShockRowExplicitlyUnpaused(row)) next.delete(id);
  }
  return next.size === live.size ? live : next;
}

function rowIsPaused(
  row: Record<string, unknown>,
  id: number,
  livePausedIds: Set<number>,
): boolean {
  if (isPiShockRowPaused(row)) return true;
  if (isPiShockRowExplicitlyUnpaused(row)) return false;
  return livePausedIds.has(id);
}

function normalizeShockers(
  devices: DevicesResponse | null,
  online: Record<string, boolean>,
  personal: PersonalLimits,
  emergencyStopIds: Set<number>,
  livePausedIds: Set<number>,
): ShockerView[] {
  if (!devices) return [];
  const hubNameByClient = new Map<string, string>();
  for (const hub of devices.hubs ?? []) {
    const id = hubClientId(hub);
    const name = String(hub.Name ?? hub.name ?? 'Hub');
    if (id) hubNameByClient.set(id, name);
  }

  const fallbackHubId = [...hubNameByClient.keys()][0] ?? null;

  const owned: ShockerView[] = (devices.shockers ?? []).map((s) => {
    const id = Number(s.ShockerId ?? s.shockerId ?? s.Id ?? s.id);
    const clientKey = shockerClientId(s) ?? fallbackHubId ?? '';
    const deviceMaxIntensity = Math.max(
      1,
      Math.min(100, Number(s.MaxIntensity ?? s.maxIntensity ?? 100)),
    );
    const deviceMaxDuration = maxDurationMs(s);
    const activityMaxIntensity = Math.min(deviceMaxIntensity, personal.activityMaxIntensity);
    const activityMaxDuration = Math.min(deviceMaxDuration, personal.activityMaxDurationMs);
    const activityMinIntensity = Math.max(
      1,
      Math.min(activityMaxIntensity, personal.activityMinIntensity),
    );
    const activityMinDuration = Math.max(
      16,
      Math.min(activityMaxDuration, personal.activityMinDurationMs),
    );
    const vibMaxIntensity = Math.min(deviceMaxIntensity, personal.activityVibMaxIntensity);
    const vibMinIntensity = Math.max(
      1,
      Math.min(vibMaxIntensity, personal.activityVibMinIntensity),
    );
    const vibMaxDuration = Math.min(deviceMaxDuration, personal.activityVibMaxDurationMs);
    const vibMinDuration = Math.max(
      16,
      Math.min(vibMaxDuration, personal.activityVibMinDurationMs),
    );
    const beepMaxIntensity = Math.min(deviceMaxIntensity, personal.activityBeepMaxIntensity);
    const beepMinIntensity = Math.max(
      1,
      Math.min(beepMaxIntensity, personal.activityBeepMinIntensity),
    );
    const beepMaxDuration = Math.min(deviceMaxDuration, personal.activityBeepMaxDurationMs);
    const beepMinDuration = Math.max(
      16,
      Math.min(beepMaxDuration, personal.activityBeepMinDurationMs),
    );
    return {
      id,
      name: String(s.Name ?? s.name ?? `Shocker ${id}`),
      hubName: clientKey ? hubNameByClient.get(clientKey) : undefined,
      clientId: clientKey || undefined,
      owned: true,
      paused: rowIsPaused(s, id, livePausedIds),
      canShock: true,
      canVibrate: true,
      canBeep: true,
      canHold: true,
      canPause: Boolean(s.CanPause ?? s.canPause ?? false),
      deviceMaxIntensity,
      deviceMaxDuration,
      activityMinIntensity,
      activityMaxIntensity,
      activityMinDuration,
      activityMaxDuration,
      minIntensity: activityMinIntensity,
      maxIntensity: activityMaxIntensity,
      minDuration: activityMinDuration,
      maxDuration: activityMaxDuration,
      vibMinIntensity,
      vibMaxIntensity,
      vibMinDuration,
      vibMaxDuration,
      beepMinIntensity,
      beepMaxIntensity,
      beepMinDuration,
      beepMaxDuration,
      requiredWarningLevel: personal.activityRequiredWarningLevel,
      emergencyStop: emergencyStopIds.has(id),
      isV3: Boolean(s.IsV3 ?? s.isV3 ?? true),
      online: clientKey ? online[clientKey] === true : undefined,
    };
  });

  const sharedList = Array.isArray(devices.shared)
    ? devices.shared
    : devices.shared && typeof devices.shared === 'object'
      ? Object.values(devices.shared as Record<string, unknown>).flatMap((v) =>
          Array.isArray(v) ? v : [v],
        )
      : [];

  const shared: ShockerView[] = (sharedList as Array<Record<string, unknown>>).map((s) => {
    const id = Number(s.Id ?? s.id ?? s.ShockerId ?? s.shockerId);
    const clientKey = shockerClientId(s) ?? '';
    const deviceMaxIntensity = Math.max(
      1,
      Math.min(100, Number(s.MaxIntensity ?? s.maxIntensity ?? 100)),
    );
    const deviceMaxDuration = maxDurationMs(s);
    return {
      id,
      name: String(s.Name ?? s.name ?? `Shared ${id}`),
      hubName: String(s.OwnedBy ?? s.ownedBy ?? ''),
      clientId: clientKey || undefined,
      owned: false,
      paused: rowIsPaused(s, id, livePausedIds),
      shareCode: s.ShareCode != null ? String(s.ShareCode) : s.shareCode != null ? String(s.shareCode) : undefined,
      shareId: s.ShareId != null ? Number(s.ShareId) : s.shareId != null ? Number(s.shareId) : undefined,
      canShock: Boolean(s.CanShock ?? s.canShock ?? true),
      canVibrate: Boolean(s.CanVibrate ?? s.canVibrate ?? true),
      canBeep: Boolean(s.CanBeep ?? s.canBeep ?? true),
      canHold: Boolean(s.CanHold ?? s.canHold ?? true),
      canPause: Boolean(s.CanPause ?? s.canPause ?? false),
      deviceMaxIntensity,
      deviceMaxDuration,
      activityMinIntensity: 1,
      activityMaxIntensity: deviceMaxIntensity,
      activityMinDuration: 16,
      activityMaxDuration: deviceMaxDuration,
      minIntensity: 1,
      maxIntensity: deviceMaxIntensity,
      minDuration: 16,
      maxDuration: deviceMaxDuration,
      isV3: Boolean(s.IsV3 ?? s.isV3 ?? true),
      online: clientKey ? online[clientKey] === true : undefined,
    };
  });

  return [...owned, ...shared];
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiBase, apiFetch, isEmbedded } from './api';
import {
  bootstrapDiscord,
  fetchInstanceParticipants,
  getActivityInstanceId,
  openExternal,
  subscribeParticipants,
  type AuthState,
} from './discord';
import { SafetyWarning } from './components/SafetyWarning';
import { SafetyNoticeBar } from './components/SafetyNoticeBar';
import { TermsOfService } from './components/TermsOfService';
import { PrivacyPolicy } from './components/PrivacyPolicy';
import { LoginPanel } from './components/LoginPanel';
import { OfficialController } from './components/OfficialController';
import type { ShockerView } from './components/ShockerCard';
import { SharesPanel } from './components/SharesPanel';
import { CommandLog } from './components/CommandLog';
import { AvailabilitySettings } from './components/AvailabilitySettings';
import {
  ActivityLimitsSettings,
  type PersonalLimits,
  type ShareLimitRow,
} from './components/ActivityLimitsSettings';
import { FriendsParticipantList } from './components/FriendsParticipantList';
import { PsDialog } from './components/PsDialog';
import { LinkConfirmPanel } from './components/LinkConfirmPanel';
import { AuthLoadingScreen } from './components/AuthLoadingScreen';
import {
  SetupWizard,
  loadSetupPrefs,
  saveSetupPrefs,
  type SetupChoices,
} from './components/SetupWizard';
import type { DiscordParticipant, ParticipantStatus } from './participants';
import { connectRealtime, type RealtimeEvent } from './realtime';

type MeResponse = {
  user: AuthState['user'];
  consent: boolean;
  pishockLinked: boolean;
  pishockUserId: number | null;
  personal?: PersonalLimits;
  emergencyStopShockerIds?: number[];
};

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
  hubNames: string[];
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
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkConfirm, setLinkConfirm] = useState<PendingLinkConfirm | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [setupPhase, setSetupPhase] = useState(false);
  const [setupChoices, setSetupChoices] = useState<SetupChoices>({ wantsDiscordShare: true });
  const [actionError, setActionError] = useState<string | null>(null);
  const [legalView, setLegalView] = useState<LegalView>(null);
  const [friendsMode, setFriendsMode] = useState(false);
  const [participants, setParticipants] = useState<DiscordParticipant[]>([]);
  const [participantStatus, setParticipantStatus] = useState<Record<string, ParticipantStatus>>({});
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedHubId, setSelectedHubId] = useState<string | null>(null);
  const [pinging, setPinging] = useState(false);
  const [pairDialog, setPairDialog] = useState<ShockerView | null>(null);

  const token = auth?.accessToken ?? null;
  const participantsRef = useRef(participants);
  participantsRef.current = participants;
  const selfIdRef = useRef(me?.user?.id ?? null);
  selfIdRef.current = me?.user?.id ?? null;

  const refreshMe = useCallback(async (accessToken: string) => {
    const data = await apiFetch<MeResponse>('/me', accessToken);
    setMe(data);
    return data;
  }, []);

  const refreshDevices = useCallback(async (accessToken: string) => {
    const data = await apiFetch<DevicesResponse>('/devices', accessToken);
    setDevices(data);
    const nextOnline: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(data.online ?? {})) {
      const key = normalizeClientKey(k);
      if (key) nextOnline[key] = Boolean(v);
    }
    setOnline((prev) => ({ ...prev, ...nextOnline }));
    return data;
  }, []);

  const refreshLogs = useCallback(async (accessToken: string) => {
    const data = await apiFetch<{ activity: Array<Record<string, unknown>> }>('/logs', accessToken);
    setLogs(data.activity ?? []);
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
              hubNames?: string[];
            }>('/pishock/login/status', authState.accessToken);
            if (loginStatus.status === 'confirm' && loginStatus.pishockUserId != null) {
              setLinkConfirm({
                pishockUserId: loginStatus.pishockUserId,
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

  useEffect(() => {
    if (!isEmbedded || !token) return;
    return subscribeParticipants((roster) => {
      setParticipants(roster);
      void refreshParticipantStatus(token, roster).catch(() => undefined);
    });
  }, [token, refreshParticipantStatus]);

  useEffect(() => {
    if (!isEmbedded || !token || !bootReady || !me?.consent) return;

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
      if (event.type === 'emergency_stop') {
        applyEmergencyStop(event);
        return;
      }
      if (event.type === 'activity_share_changed' || event.type === 'participants_invalidate') {
        participantStatusCache = { key: '', fetchedAt: 0, map: {} };
        void refreshParticipantStatus(token, participantsRef.current, true).catch(() => undefined);
        if (
          event.type === 'activity_share_changed' &&
          selfIdRef.current === event.ownerDiscordUserId
        ) {
          void refreshMe(token).catch(() => undefined);
        }
      }
    };

    const handle = connectRealtime(token, handleEvent);
    return () => handle.close();
  }, [token, bootReady, me?.consent, refreshMe, refreshParticipantStatus]);

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

  const personalLimits = useMemo<PersonalLimits>(
    () =>
      me?.personal ?? {
        activityMaxIntensity: 100,
        activityMaxDurationMs: 15_000,
      },
    [me?.personal?.activityMaxIntensity, me?.personal?.activityMaxDurationMs],
  );

  const emergencyStopIds = useMemo(
    () => new Set(me?.emergencyStopShockerIds ?? []),
    [me?.emergencyStopShockerIds],
  );

  const ownedAndShared = useMemo(
    () => normalizeShockers(devices, online, personalLimits, emergencyStopIds),
    [devices, online, personalLimits, emergencyStopIds],
  );

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
    if (!selectedTargetId) return [] as ShockerView[];
    const status = participantStatus[selectedTargetId];
    const participant = participants.find((p) => p.id === selectedTargetId);
    // Blocked: no visibility into their shockers
    if (!status || status.bannedYou) return [];
    // E-stop / paused / etc: still show shockers (buttons disabled via flags)
    if (!status.shockers?.length) return [];
    return status.shockers.map((s): ShockerView => {
      const deviceMaxIntensity = Math.min(100, s.deviceMaxIntensity ?? s.maxIntensity);
      const deviceMaxDuration = Math.min(15_000, s.deviceMaxDurationMs ?? s.maxDurationMs);
      const activityMaxIntensity = Math.min(deviceMaxIntensity, s.maxIntensity);
      const activityMaxDuration = Math.min(deviceMaxDuration, s.maxDurationMs);
      const stopped = Boolean(s.emergencyStop);
      return {
        id: s.shockerId,
        name: s.shockerName,
        hubName: participant?.displayName ?? status.globalName ?? status.username ?? 'Friend',
        clientId: s.hubClientId ?? undefined,
        owned: false,
        targetDiscordUserId: selectedTargetId,
        paused: s.paused,
        canShock: !stopped && s.canShock,
        canVibrate: !stopped && s.canVibrate,
        canBeep: !stopped && s.canBeep,
        canHold: !stopped && s.canHold,
        canPause: false,
        deviceMaxIntensity,
        deviceMaxDuration,
        activityMaxIntensity,
        activityMaxDuration,
        maxIntensity: activityMaxIntensity,
        maxDuration: activityMaxDuration,
        emergencyStop: stopped,
        isV3: true,
        online: true,
      };
    });
  }, [selectedTargetId, participantStatus, participants]);

  const ownShockers = useMemo(() => {
    if (!selectedHubId) return ownedAndShared;
    const filtered = ownedAndShared.filter(
      (s) => !s.clientId || normalizeClientKey(String(s.clientId)) === selectedHubId,
    );
    return filtered.length ? filtered : ownedAndShared;
  }, [ownedAndShared, selectedHubId]);

  const shockers = friendsMode ? friendShockers : ownShockers;
  const friendBlocked = Boolean(friendsMode && selectedTargetId && selectedFriendStatus?.bannedYou);
  const friendEStop = Boolean(
    friendsMode &&
      selectedTargetId &&
      !friendBlocked &&
      (selectedFriendStatus?.emergencyStop ||
        friendShockers.some((s) => s.emergencyStop)),
  );

  const acceptConsent = async () => {
    if (!token) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiFetch('/consent', token, { method: 'POST', body: '{}' });
      await refreshMe(token);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const startPiShockLogin = async () => {
    if (!token) return;
    setLinking(true);
    setLinkError(null);
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
    const started = Date.now();
    const tick = async () => {
      try {
        const status = await apiFetch<{
          status: string;
          error?: string;
          pishockUserId?: number;
          hubNames?: string[];
        }>('/pishock/login/status', accessToken);
        if (status.status === 'confirm' && status.pishockUserId != null) {
          setLinking(false);
          setLoginUrl(null);
          setOverlay(null);
          setLinkError(null);
          setActionError(null);
          setLinkConfirm({
            pishockUserId: status.pishockUserId,
            hubNames: status.hubNames ?? [],
          });
          return;
        }
        if (status.status === 'linked') {
          // Already confirmed/linked earlier — just refresh.
          const meData = await refreshMe(accessToken);
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
        setLinkError(err instanceof Error ? err.message : String(err));
        setLinking(false);
        return;
      }
      if (Date.now() - started > 5 * 60 * 1000) {
        setLinkError('Login timed out');
        setLinking(false);
        return;
      }
      window.setTimeout(tick, 2000);
    };
    void tick();
  };

  const confirmPiShockLink = async () => {
    if (!token || !linkConfirm) return;
    setConfirmBusy(true);
    setLinkError(null);
    try {
      await apiFetch('/pishock/login/confirm', token, { method: 'POST', body: '{}' });
      setLinkConfirm(null);
      const meData = await refreshMe(token);
      if (meData.pishockLinked) {
        await refreshDevices(token);
        await refreshLogs(token).catch(() => undefined);
        if (setupChoices.wantsDiscordShare) {
          setOverlay('availability');
        }
      }
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirmBusy(false);
    }
  };

  const openLinkFlow = () => {
    if (!me) return;
    const prefs = loadSetupPrefs(me.user.id);
    setSetupChoices({ wantsDiscordShare: prefs.wantsDiscordShare });
    if (!prefs.seen) {
      setSetupPhase(true);
      setOverlay('link');
      return;
    }
    setSetupPhase(false);
    setOverlay('link');
  };

  const finishSetup = (choices: SetupChoices) => {
    if (!me) return;
    saveSetupPrefs(me.user.id, choices);
    setSetupChoices(choices);
    setSetupPhase(false);
  };

  const cancelPiShockLink = async () => {
    if (!token) {
      setLinkConfirm(null);
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
    setBusy(true);
    setActionError(null);
    try {
      const targetId =
        typeof input.targetDiscordUserId === 'string'
          ? input.targetDiscordUserId
          : selectedTargetId && friendsMode
            ? selectedTargetId
            : null;
      if (targetId) {
        const instanceId = getActivityInstanceId();
        await apiFetch(`/participants/${targetId}/operate`, token, {
          method: 'POST',
          body: JSON.stringify({ ...input, instanceId }),
        });
      } else if (!me?.pishockLinked) {
        requirePiShockLink(
          'Link PiShock to control your own shockers or website shares. Discord Shockers work without linking.',
        );
        return;
      } else {
        await apiFetch('/operate', token, { method: 'POST', body: JSON.stringify(input) });
      }
      await refreshLogs(token).catch(() => undefined);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PISHOCK_RELOGIN') {
        await handleReloginNeeded();
        requirePiShockLink('PiShock session expired — link again to control your own devices.');
      } else if (err instanceof ApiError && err.code === 'EMERGENCY_STOP') {
        setActionError('Emergency stop is engaged — owner must release STOP');
        if (token) void refreshParticipantStatus(token, participants, true).catch(() => undefined);
      } else {
        setActionError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const setEmergencyStop = async (input: {
    shockerId: number;
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
      const result = await apiFetch<{ emergencyStopShockerIds: number[] }>(
        '/emergency-stop',
        token,
        {
          method: 'PUT',
          body: JSON.stringify(input),
        },
      );
      setMe((prev) =>
        prev ? { ...prev, emergencyStopShockerIds: result.emergencyStopShockerIds } : prev,
      );
      participantStatusCache = { key: '', fetchedAt: 0, map: {} };
      await refreshLogs(token).catch(() => undefined);
      if (participants.length) {
        await refreshParticipantStatus(token, participants, true).catch(() => undefined);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PISHOCK_RELOGIN') {
        await handleReloginNeeded();
        requirePiShockLink('PiShock session expired — link again to control your own devices.');
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
      shares: Array<{
        shockerId: number;
        shockerName: string;
        hubClientId?: string | null;
        enabled: boolean;
        paused: boolean;
        deviceMaxIntensity?: number;
        deviceMaxDurationMs?: number;
        maxIntensity: number;
        maxDurationMs: number;
        canShock: boolean;
        canVibrate: boolean;
        canBeep: boolean;
        canHold: boolean;
      }>;
      bannedDiscordUserIds: string[];
      available: boolean;
      personal?: PersonalLimits;
    }>('/activity/share', token);
  }, [token]);

  const saveAvailability = useCallback(
    async (payload: {
      shares: Array<{
        shockerId: number;
        shockerName: string;
        hubClientId?: string | null;
        enabled: boolean;
        paused: boolean;
        deviceMaxIntensity?: number;
        deviceMaxDurationMs?: number;
        maxIntensity: number;
        maxDurationMs: number;
        canShock: boolean;
        canVibrate: boolean;
        canBeep: boolean;
        canHold: boolean;
      }>;
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

  const loadSettings = useCallback(async () => {
    if (!token) throw new Error('Not authenticated');
    return apiFetch<{ personal: PersonalLimits; shares: ShareLimitRow[] }>(
      '/activity/settings',
      token,
    );
  }, [token]);

  const saveSettings = useCallback(
    async (payload: { personal: PersonalLimits; shares: ShareLimitRow[] }) => {
      if (!token) throw new Error('Not authenticated');
      const result = await apiFetch<{ personal: PersonalLimits; shares: ShareLimitRow[] }>(
        '/activity/settings',
        token,
        { method: 'PUT', body: JSON.stringify(payload) },
      );
      setMe((prev) => (prev ? { ...prev, personal: result.personal } : prev));
      participantStatusCache = { key: '', fetchedAt: 0, map: {} };
      if (participants.length) {
        await refreshParticipantStatus(token, participants, true);
      }
    },
    [token, participants, refreshParticipantStatus],
  );

  const primaryHub = (() => {
    if (friendsMode) {
      const target = participants.find((p) => p.id === selectedTargetId);
      return {
        id: selectedTargetId ?? 'friends',
        name: target?.displayName ?? 'Discord Shockers',
        online: friendShockers.length > 0 && !friendBlocked,
        lastSeen: friendBlocked
          ? 'You are blocked'
          : friendEStop
            ? 'Emergency stop armed'
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

  if (linkConfirm) {
    return (
      <div className="app-shell official-preflight link-confirm-screen">
        <div className="brand-bar">
          <h1 className="brand">
            Pi<span>Shock</span> Activity
          </h1>
        </div>
        <div
          className="q-card q-card--dark q-dark q-pa-md"
          style={{ border: '1px solid rgba(121,198,219,.35)', maxWidth: 560, width: '100%', margin: '24px auto' }}
        >
          {linkError ? (
            <div className="bg-negative text-white q-pa-sm q-mb-md" style={{ borderRadius: 4 }}>
              {linkError}
            </div>
          ) : null}
          <LinkConfirmPanel
            pishockUserId={linkConfirm.pishockUserId}
            hubNames={linkConfirm.hubNames}
            discordName={me.user.global_name || me.user.username}
            busy={confirmBusy}
            onConfirm={confirmPiShockLink}
            onCancel={cancelPiShockLink}
          />
        </div>
      </div>
    );
  }

  if (me.consent) {
    const logRows = logs.map((row) => ({
      id: String(row.id),
      action: String(row.action),
      shockerId: row.shockerId as number | null | undefined,
      intensity: row.intensity as number | null | undefined,
      durationMs: row.durationMs as number | null | undefined,
      success: Boolean(row.success),
      detail: (row.detail as string | null | undefined) ?? null,
      createdAt: String(row.createdAt),
      executorDiscordUserId: (row.executorDiscordUserId as string | null | undefined) ?? null,
      targetDiscordUserId: (row.targetDiscordUserId as string | null | undefined) ?? null,
    }));

    const ownedShockers = ownedAndShared.filter((s) => s.owned);
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
      setOverlay(next);
    };

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
          emptyMessage={
            friendBlocked
              ? 'You are blocked by this user. You cannot view or use any of their shockers.'
              : friendsMode && selectedTargetId
                ? 'This user has no shockers shared in the activity.'
                : friendsMode
                  ? 'Select a Discord Shocker to control.'
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
            ) : friendEStop ? (
              <div className="access-banner access-banner--estop q-mt-sm q-pa-sm">
                <div className="text-negative text-subtitle2">Emergency stop armed</div>
                <div className="text-grey-4 text-body2">
                  The owner engaged emergency stop. Shockers stay visible, but all controls are
                  disabled until they release it.
                </div>
              </div>
            ) : null
          }
          safetyBanner={!pip ? <SafetyNoticeBar /> : null}
          friendsPanel={
            <FriendsParticipantList
              participants={participants}
              statuses={participantStatus}
              currentUserId={me.user.id}
              selectedTargetId={selectedTargetId}
              onSelect={(id) => setSelectedTargetId(id)}
              onRefresh={() => token && refreshParticipants(token, true)}
            />
          }
          onOperate={(input) =>
            operate({
              ...input,
              targetDiscordUserId: friendsMode ? selectedTargetId : undefined,
            })
          }
          onEmergencyStop={setEmergencyStop}
          onSelectHub={(hubId) => {
            setFriendsMode(false);
            setSelectedTargetId(null);
            setSelectedHubId(hubId);
          }}
          onOpenOwnShockers={() => {
            setFriendsMode(false);
            setSelectedTargetId(null);
          }}
          onOpenFriends={() => {
            setFriendsMode(true);
            if (token) void refreshParticipants(token, true);
          }}
          onOpenClaim={() => openLinkedOverlay('availability')}
          onOpenMenu={() => setOverlay('menu')}
          onOpenLinkAccount={openLinkFlow}
          onShareHub={() => {
            if (!me.pishockLinked) {
              requirePiShockLink('Link PiShock to manage hub shares and links.');
              return;
            }
            setOverlay('shares');
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
          <div className="q-list q-list--dark">
            <div className="q-pa-sm text-caption text-grey-5">
              {me.pishockLinked
                ? 'PiShock linked — you can control your devices and opt in to Discord Shockers.'
                : 'No PiShock login needed to control Discord Shockers. Link only to share yourself or use your own devices.'}
            </div>
            {(
              [
                ['availability', 'Available in Discord', 'mdi-account-check'],
                ['settings', 'Activity Limits', 'mdi-tune'],
                ['shares', 'Shares & links', 'mdi-share-variant'],
                ['logs', 'Command log', 'mdi-history'],
              ] as const
            ).map(([id, label, icon]) => (
              <button
                key={id}
                type="button"
                className="q-item q-item-type row no-wrap q-item--dark q-item--clickable q-link cursor-pointer full-width bg-transparent text-left"
                onClick={() => openLinkedOverlay(id)}
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
                className="q-item q-item-type row no-wrap q-item--dark q-item--clickable q-link cursor-pointer full-width bg-transparent text-left"
                onClick={async () => {
                  if (!token) return;
                  await apiFetch('/pishock/session', token, { method: 'DELETE' });
                  setOverlay(null);
                  setFriendsMode(true);
                  await handleReloginNeeded();
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
                className="q-item q-item-type row no-wrap q-item--dark q-item--clickable q-link cursor-pointer full-width bg-transparent text-left"
                onClick={openLinkFlow}
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
          title={setupPhase ? 'First-time setup' : 'Link PiShock'}
          onClose={() => {
            setOverlay(null);
            setSetupPhase(false);
          }}
          wide
        >
          <div className="column q-gutter-md">
            {setupPhase ? (
              <SetupWizard
                discordName={me.user.global_name || me.user.username}
                onComplete={(choices) => {
                  finishSetup(choices);
                }}
                onSkipToLogin={(choices) => {
                  finishSetup(choices);
                }}
              />
            ) : (
              <>
                <div className="text-grey-5 text-body2">
                  A browser window will open for PiShock login. After you sign in there, return here
                  — we will ask you to confirm the account before linking. Discord Shockers can be
                  controlled without linking; link only to receive shocks or use your own devices.
                </div>
                <LoginPanel
                  linking={linking}
                  loginUrl={loginUrl}
                  error={linkError}
                  onStart={startPiShockLogin}
                  onOpen={() => loginUrl && openExternal(loginUrl)}
                  onRefresh={() => token && pollLogin(token)}
                />
              </>
            )}
          </div>
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
          onClose={() => setOverlay(null)}
          wide
        >
          <ActivityLimitsSettings
            ownedShockers={ownedShockers}
            busy={busy}
            onLoad={loadSettings}
            onSave={async (payload) => {
              await saveSettings(payload);
              setOverlay(null);
            }}
          />
        </PsDialog>

        <PsDialog open={overlay === 'shares'} title="Shares & links" onClose={() => setOverlay(null)} wide>
          <SharesPanel
            links={(devices?.links as Array<Record<string, unknown>>) ?? []}
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
                  body: JSON.stringify({ ShockerId: shockerId }),
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

        <PsDialog open={overlay === 'logs'} title="Command log" onClose={() => setOverlay(null)} wide>
          <CommandLog rows={logRows} />
        </PsDialog>
      </div>
    );
  }

  return (
    <div className={`app-shell official-preflight consent-shell ${pip ? 'pip' : ''}`}>
      <div className="consent-shell__brand">
        <h1 className="auth-boot__brand">
          Pi<span>Shock</span>
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

function normalizeShockers(
  devices: DevicesResponse | null,
  online: Record<string, boolean>,
  personal: PersonalLimits,
  emergencyStopIds: Set<number>,
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
    return {
      id,
      name: String(s.Name ?? s.name ?? `Shocker ${id}`),
      hubName: clientKey ? hubNameByClient.get(clientKey) : undefined,
      clientId: clientKey || undefined,
      owned: true,
      paused: Boolean(s.Paused ?? s.paused),
      canShock: true,
      canVibrate: true,
      canBeep: true,
      canHold: true,
      canPause: Boolean(s.CanPause ?? s.canPause ?? false),
      deviceMaxIntensity,
      deviceMaxDuration,
      activityMaxIntensity,
      activityMaxDuration,
      maxIntensity: activityMaxIntensity,
      maxDuration: activityMaxDuration,
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
      paused: Boolean(s.Paused ?? s.paused ?? s.SharePaused ?? s.sharePaused),
      shareCode: s.ShareCode != null ? String(s.ShareCode) : s.shareCode != null ? String(s.shareCode) : undefined,
      shareId: s.ShareId != null ? Number(s.ShareId) : s.shareId != null ? Number(s.shareId) : undefined,
      canShock: Boolean(s.CanShock ?? s.canShock ?? true),
      canVibrate: Boolean(s.CanVibrate ?? s.canVibrate ?? true),
      canBeep: Boolean(s.CanBeep ?? s.canBeep ?? true),
      canHold: Boolean(s.CanHold ?? s.canHold ?? true),
      canPause: Boolean(s.CanPause ?? s.canPause ?? false),
      deviceMaxIntensity,
      deviceMaxDuration,
      activityMaxIntensity: deviceMaxIntensity,
      activityMaxDuration: deviceMaxDuration,
      maxIntensity: deviceMaxIntensity,
      maxDuration: deviceMaxDuration,
      isV3: Boolean(s.IsV3 ?? s.isV3 ?? true),
      online: clientKey ? online[clientKey] === true : undefined,
    };
  });

  return [...owned, ...shared];
}

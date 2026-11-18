import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { ShockerView } from './ShockerCard';
import { AnnouncementBanner } from './AnnouncementBanner';
import { AppVersionBadge } from './AppVersionBadge';
import { IndividualIntensityToggle, MultiShockToggle } from './MultiShockToggle';
import { MultiTargetTray } from './MultiTargetTray';
import {
  atLeastWarning,
  cycleWarningLevel,
  normalizeWarningLevel,
  warningButtonLabel,
  type WarningLevel,
} from '../../shared/warning';
import {
  clamp,
  formatDurationSec,
  intensityLabel,
  loadControlPrefs,
  multiColorForShocker,
  multiColorKey,
  nudgeIntensity,
  passShockerChipWheel,
  rollIntensity,
  saveControlPrefs,
  shockerUsableDur,
  shockerUsableInt,
  shockerUsableMinDur,
  shockerUsableMinInt,
  type ModeBandOp,
} from './official/helpers';
import {
  CenterControl,
  DurationMetric,
  IntensityEdgeRail,
  MetricStack,
  VerticalQuasarSlider,
} from './official/controls';

export type OfficialOperateInput = {
  shockerId: number;
  shareCode?: string;
  clientId?: number | string;
  /** Friend operate routing — set per shocker in multishock */
  targetDiscordUserId?: string;
  operation: 'shock' | 'vibrate' | 'beep' | 'hold' | 'warning' | 'stop' | 'end';
  intensity: number;
  durationMs: number;
  canShock: boolean;
  canVibrate: boolean;
  canBeep: boolean;
  canHold: boolean;
  maxIntensity: number;
  maxDuration: number;
  warning?: {
    Active: boolean;
    /** Warning vibe intensity (1–100) */
    Intensity?: number;
    /** Warning vibe duration in ms */
    DurationMs?: number;
    Min?: number;
    Max?: number;
  } | null;
  hold?: boolean;
  /** Per-target warning sent with a shock or hold. The server publishes the one vibration. */
  warningLevel?: WarningLevel;
};

type HubInfo = {
  id: string;
  name: string;
  lastSeen?: string;
  online?: boolean;
};

type Props = {
  hub: HubInfo;
  shockers: ShockerView[];
  busy?: boolean;
  pip?: boolean;
  hubs?: HubInfo[];
  friendsOpen?: boolean;
  friendsPanel?: ReactNode | ((ctx: {
    multiShock: boolean;
    onToggleMultiShock: () => void;
    individualIntensity: boolean;
    onToggleIndividualIntensity: () => void;
  }) => ReactNode);
  safetyBanner?: ReactNode;
  /** Shown above controls (e.g. blocked / e-stop notices) */
  accessBanner?: ReactNode;
  /** Force-disable operate buttons (star-only / queue halted / etc.) */
  forceControlsLocked?: boolean;
  /** Gold border glow when the selected friend has starred you */
  starredPanel?: boolean;
  /** Whether their queue is stars-only (copy for the starred panel caption) */
  starredPanelStarOnly?: boolean;
  /** Empty-state copy when there are no shockers to show */
  emptyMessage?: string;
  /** Show header CTA when the user has not linked PiShock yet */
  showLinkAccount?: boolean;
  /** Own hubs require a linked PiShock session */
  showOwnMode?: boolean;
  /** Linked PiShock profile (from /Account when the API key can read Images) */
  linkedAccount?: {
    username?: string | null;
    avatarUrl?: string | null;
  } | null;
  onOperate: (input: OfficialOperateInput) => void;
  /** Owned shockers used by the All emergency-stop scope (not hub-filtered). */
  estopShockers?: ShockerView[];
  /** Owner-only kill-switch latch (press in / press out). */
  onEmergencyStop?: (input: {
    shockerId: number;
    shockerIds?: number[];
    clientId?: number | string;
    engaged: boolean;
  }) => void;
  onSelectHub?: (hubId: string) => void;
  onOpenFriends?: () => void;
  /** Switch back to the user's own hubs/shockers */
  onOpenOwnShockers?: () => void;
  onOpenMenu?: () => void;
  onOpenLinkAccount?: () => void;
  /** Opens account / menu when the linked-avatar button is pressed */
  onOpenLinkedAccount?: () => void;
  /** Cog / SO control — open Activity Limits focused on this shocker */
  onOpenShockerSettings?: (shocker: ShockerView) => void;
  onShareShocker?: (shocker: ShockerView) => void;
  onPair?: (shocker: ShockerView) => void;
  /** Manual hub/shocker reachability check (top-left !) */
  onPingHub?: () => void;
  pinging?: boolean;
  selectedHubId?: string | null;
  /** Display name for a Discord user (multishock tray grouping). */
  personName?: (discordUserId: string) => string;
  /**
   * Multishock: called once per fire before the per-target commands go out, so the
   * caller can show one combined result ("Sent to 3 · skipped 1").
   */
  onBatchPlanned?: (info: { count: number; skipped: Array<{ name: string; reason: string }> }) => void;
  /** Multi toggled — own mode then lists shockers from every hub. */
  onMultiShockChange?: (on: boolean) => void;
};

/** Exact Quasar DOM structure + classes from pishock.com/#/control */
export function OfficialController({
  hub,
  shockers,
  busy,
  pip = false,
  hubs = [],
  friendsOpen = false,
  friendsPanel,
  safetyBanner,
  accessBanner,
  forceControlsLocked = false,
  starredPanel = false,
  starredPanelStarOnly = false,
  emptyMessage = 'No shockers',
  showLinkAccount = false,
  showOwnMode = true,
  linkedAccount = null,
  onOperate,
  estopShockers,
  onEmergencyStop,
  onSelectHub,
  onOpenFriends,
  onOpenOwnShockers,
  onOpenMenu,
  onOpenLinkAccount,
  onOpenLinkedAccount,
  onOpenShockerSettings,
  onShareShocker,
  onPair,
  onPingHub,
  pinging = false,
  selectedHubId = null,
  personName = () => 'Someone',
  onBatchPlanned,
  onMultiShockChange,
}: Props) {
  const initialPrefs = useMemo(() => loadControlPrefs(), []);
  const [activeId, setActiveId] = useState(
    () => initialPrefs.activeId ?? shockers[0]?.id ?? 0,
  );
  const [hubMenuOpen, setHubMenuOpen] = useState(false);
  const [multiShock, setMultiShock] = useState(initialPrefs.multiShock);
  const [individualIntensity, setIndividualIntensity] = useState(
    initialPrefs.individualIntensity,
  );
  const [perShockIntensity, setPerShockIntensity] = useState<Record<string, number>>(
    () => ({ ...initialPrefs.perShockIntensity }),
  );
  /** Individual mode: per-target duration (ms), keyed like perShockIntensity. */
  const [perShockDuration, setPerShockDuration] = useState<Record<string, number>>({});
  /** Why each target was skipped on the last multishock fire (shown in the tray). */
  const [lastSkipped, setLastSkipped] = useState<Record<number, string>>({});
  const [selectedIds, setSelectedIds] = useState<number[]>(() => {
    const first = initialPrefs.activeId ?? shockers[0]?.id;
    return first != null ? [first] : [];
  });
  /** Collapsed mode dock on compact viewports so it doesn't cover the remote */
  const [modeDockOpen, setModeDockOpen] = useState(true);
  const [estopAll, setEstopAll] = useState(false);
  const [compactDock, setCompactDock] = useState(false);
  const shockerChipsRef = useRef<HTMLDivElement | null>(null);
  const showShockerChips = (friendsOpen || shockers.length > 1) && shockers.length > 0;

  const active = useMemo(
    () => shockers.find((s) => s.id === activeId) ?? shockers[0],
    [shockers, activeId],
  );

  const selectedShockers = useMemo(() => {
    if (!multiShock) return active ? [active] : [];
    // An explicit "None" really means none — no silent fallback to the active shocker.
    return selectedIds
      .map((id) => shockers.find((s) => s.id === id))
      .filter((s): s is ShockerView => Boolean(s));
  }, [multiShock, selectedIds, shockers, active]);

  useEffect(() => {
    if (!shockers.some((s) => s.id === activeId)) {
      const next = shockers[0]?.id ?? 0;
      setActiveId(next);
      setSelectedIds(next ? [next] : []);
    }
  }, [shockers, activeId]);

  useEffect(() => {
    setSelectedIds((prev) => {
      const visible = shockers.map((s) => s.id);
      const valid = prev.filter((id) => visible.includes(id));
      if (!multiShock) {
        if (valid.length) return valid.slice(0, 1);
        return shockers[0] ? [shockers[0].id] : [];
      }
      // Multishock: keep exactly what was picked (new shockers are not auto-added).
      return valid;
    });
  }, [shockers, multiShock]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 999px)');
    const apply = () => {
      const compact = mq.matches || Boolean(pip);
      setCompactDock(compact);
      if (compact) setModeDockOpen(false);
      else setModeDockOpen(true);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pip]);

  const [shockIntensity, setShockIntensity] = useState(initialPrefs.shockIntensity);
  const [shockDurationMs, setShockDurationMs] = useState(initialPrefs.shockDurationMs);
  const [shockRandom, setShockRandom] = useState(initialPrefs.shockRandom);
  const [shockMin, setShockMin] = useState(initialPrefs.shockMin);
  const [shockMax, setShockMax] = useState(initialPrefs.shockMax);
  const [vibIntensity, setVibIntensity] = useState(initialPrefs.vibIntensity);
  const [vibDurationMs, setVibDurationMs] = useState(initialPrefs.vibDurationMs);
  const [durationMenu, setDurationMenu] = useState<'shock' | 'vibrate' | null>(null);
  const [warningLevel, setWarningLevel] = useState<WarningLevel>(initialPrefs.warningLevel);
  /** Use Mode: press-and-hold Operate/Beep until release (official Remote-style). */
  const [tapMode, setTapMode] = useState(initialPrefs.tapMode);
  const [hubsOpen, setHubsOpen] = useState(false);
  const [holdingOp, setHoldingOp] = useState<'shock' | 'vibrate' | 'beep' | null>(null);
  const holdingOpRef = useRef<'shock' | 'vibrate' | 'beep' | null>(null);
  const holdTargetRef = useRef<{
    shockerId: number;
    clientId?: number | string;
    shareCode?: string;
    targetDiscordUserId?: string;
  } | null>(null);

  const limitPool = selectedShockers.length
    ? selectedShockers
    : active
      ? [active]
      : [];

  const toggleMultiShock = () => {
    setMultiShock((v) => {
      const next = !v;
      if (next) {
        if (holdingOpRef.current) endHold();
        setTapMode(false);
        setSelectedIds(active ? [active.id] : []);
      } else {
        setIndividualIntensity(false);
      }
      return next;
    });
  };

  const seedPerShockIntensities = (pool: ShockerView[], fallback: number) => {
    setPerShockIntensity((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const s of pool) {
        const key = multiColorKey(s);
        const cap = shockerUsableInt(s);
        const desired =
          next[key] == null ? clamp(fallback, 0, cap) : clamp(next[key]!, 0, cap);
        if (next[key] !== desired) {
          next[key] = desired;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  };

  const toggleIndividualIntensity = () => {
    if (!multiShock) return;
    setIndividualIntensity((on) => {
      const next = !on;
      if (next) {
        setShockRandom(false);
        const pool = selectedShockers.length ? selectedShockers : active ? [active] : [];
        setPerShockIntensity((prev) => {
          const map = { ...prev };
          for (const s of pool) {
            const key = multiColorKey(s);
            const cap = shockerUsableInt(s);
            map[key] =
              map[key] == null ? clamp(shockIntensity, 0, cap) : clamp(map[key]!, 0, cap);
          }
          if (active) {
            const key = multiColorKey(active);
            setShockIntensity(clamp(map[key] ?? shockIntensity, 0, shockerUsableInt(active)));
          }
          return map;
        });
      }
      return next;
    });
  };

  const focusShockerIntensity = (s: ShockerView) => {
    if (!individualIntensity || !multiShock) return;
    const key = multiColorKey(s);
    const cap = shockerUsableInt(s);
    setPerShockIntensity((prev) => {
      const seeded = clamp(prev[key] ?? shockIntensity, 0, cap);
      setShockIntensity(seeded);
      if (prev[key] === seeded) return prev;
      return { ...prev, [key]: seeded };
    });
  };

  const multiLimitMarkers = useMemo(() => {
    const pool = selectedShockers.length ? selectedShockers : active ? [active] : [];
    if (!multiShock || pool.length < 2) {
      return [] as Array<{
        key: string;
        color: string;
        intensity: number;
        value?: number;
        durationMs: number;
        label: string;
      }>;
    }
    const seen = new Set<string>();
    const markers: Array<{
      key: string;
      color: string;
      intensity: number;
      value?: number;
      durationMs: number;
      label: string;
    }> = [];
    for (const s of pool) {
      const key = multiColorKey(s);
      if (seen.has(key)) continue;
      seen.add(key);
      const limit = shockerUsableInt(s);
      markers.push({
        key,
        color: multiColorForShocker(s),
        intensity: limit,
        value:
          individualIntensity
            ? clamp(perShockIntensity[key] ?? shockIntensity, 0, limit)
            : undefined,
        durationMs: shockerUsableDur(s),
        label: s.hubName && !s.owned ? `${s.hubName}: ${s.name}` : s.name,
      });
    }
    return markers.sort((a, b) => a.intensity - b.intensity);
  }, [
    multiShock,
    selectedShockers,
    active,
    individualIntensity,
    perShockIntensity,
    shockIntensity,
  ]);

  // Slider / duration UI uses the *highest* caps so the bar can reach the topmost limit.
  // Operate still clamps per shocker to that person's own limit.
  const deviceMaxInt = limitPool.length
    ? Math.max(...limitPool.map((s) => s.deviceMaxIntensity ?? s.maxIntensity ?? 100))
    : 100;
  const deviceMaxDur = limitPool.length
    ? Math.max(...limitPool.map((s) => s.deviceMaxDuration ?? s.maxDuration ?? 15_000))
    : 15_000;
  const activityMaxInt = limitPool.length
    ? Math.max(...limitPool.map((s) => shockerUsableInt(s)))
    : 100;
  const activityMaxDur = limitPool.length
    ? Math.max(...limitPool.map((s) => shockerUsableDur(s)))
    : 15_000;
  const maxInt = Math.min(deviceMaxInt, activityMaxInt);
  const maxDur = Math.min(deviceMaxDur, activityMaxDur);
  const minInt = limitPool.length
    ? Math.max(...limitPool.map((s) => shockerUsableMinInt(s)))
    : 1;
  const minDur = limitPool.length
    ? Math.max(...limitPool.map((s) => shockerUsableMinDur(s)))
    : 16;
  const vibMaxInt = limitPool.length
    ? Math.max(...limitPool.map((s) => shockerUsableInt(s, 'vibrate')))
    : maxInt;
  const vibMinInt = limitPool.length
    ? Math.max(...limitPool.map((s) => shockerUsableMinInt(s, 'vibrate')))
    : minInt;
  const vibMaxDur = limitPool.length
    ? Math.max(...limitPool.map((s) => shockerUsableDur(s, 'vibrate')))
    : maxDur;
  const vibMinDur = limitPool.length
    ? Math.max(...limitPool.map((s) => shockerUsableMinDur(s, 'vibrate')))
    : minDur;
  /** Individual targets have their own sliders in the tray; the main slider is the default. */
  const shockEditCap = maxInt;
  const shockEditFloor = minInt;
  const requiredWarningFloor = limitPool.reduce<WarningLevel>(
    (floor, s) => atLeastWarning(floor, normalizeWarningLevel(s.requiredWarningLevel)),
    'none',
  );
  const activeBlocked = Boolean(active && (active.emergencyStop || active.paused));
  const selectedAllBlocked =
    selectedShockers.length > 0 &&
    selectedShockers.every((s) => s.emergencyStop || s.paused);
  const controlsLocked =
    forceControlsLocked ||
    (multiShock ? selectedShockers.length === 0 || selectedAllBlocked : activeBlocked);
  const modeEligible = (mode: 'shock' | 'vibrate' | 'beep') => {
    const pool = multiShock ? selectedShockers : active ? [active] : [];
    return pool.some((s) => {
      if (s.emergencyStop || s.paused) return false;
      if (mode === 'shock') return s.canShock;
      if (mode === 'vibrate') return s.canVibrate;
      return s.canBeep;
    });
  };
  const estopPool = (estopShockers ?? shockers).filter((s) => s.owned);
  const stopTargets = estopAll ? estopPool : active?.owned ? [active] : [];
  const stopArmed = stopTargets.length > 0 && stopTargets.every((s) => s.emergencyStop);

  const setActiveShockIntensity = (n: number) => {
    // Thumb moves freely up to the activity ceiling; mins are enforced on fire.
    setShockIntensity(clamp(n, 0, shockEditCap));
  };

  useEffect(() => {
    setShockIntensity((v) => clamp(v, 0, shockEditCap));
    setVibIntensity((v) => clamp(v, 0, vibMaxInt));
    setShockMin((v) => clamp(v, 0, shockEditCap));
    setShockMax((v) => clamp(v, 0, shockEditCap));
    // Duration chips stay inside the allowed band (no free-drag analog).
    setShockDurationMs((v) => clamp(v, minDur, maxDur));
    setVibDurationMs((v) => clamp(v, vibMinDur, vibMaxDur));
  }, [maxInt, maxDur, minDur, vibMaxInt, vibMaxDur, vibMinDur, shockEditCap, activeId]);

  useEffect(() => {
    if (!individualIntensity || !multiShock) return;
    const pool = selectedShockers.length ? selectedShockers : active ? [active] : [];
    seedPerShockIntensities(pool, shockIntensity);
  }, [individualIntensity, multiShock, selectedIds.join(',')]);

  useEffect(() => {
    onMultiShockChange?.(multiShock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiShock]);

  useEffect(() => {
    saveControlPrefs({
      shockIntensity,
      shockDurationMs,
      shockRandom,
      shockMin,
      shockMax,
      vibIntensity,
      vibDurationMs,
      warningLevel,
      tapMode,
      multiShock,
      individualIntensity,
      perShockIntensity,
      activeId: active?.id ?? activeId,
    });
  }, [
    shockIntensity,
    shockDurationMs,
    shockRandom,
    shockMin,
    shockMax,
    vibIntensity,
    vibDurationMs,
    warningLevel,
    tapMode,
    multiShock,
    individualIntensity,
    perShockIntensity,
    active?.id,
    activeId,
  ]);

  useEffect(() => {
    if (!durationMenu) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('.official-duration-wrap')) return;
      setDurationMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [durationMenu]);

  useEffect(() => {
    if (!hubMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('.official-hub-menu-wrap')) return;
      setHubMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [hubMenuOpen]);

  const resolveShockIntensity = () =>
    shockRandom && !(individualIntensity && multiShock)
      ? Math.max(1, rollIntensity(shockMin, Math.min(shockMax, shockEditCap)))
      : Math.max(1, shockIntensity || 1);

  const resolveShockIntensityFor = (shocker: ShockerView) => {
    const cap = shockerUsableInt(shocker);
    if (individualIntensity && multiShock) {
      const key = multiColorKey(shocker);
      const stored = perShockIntensity[key];
      return Math.max(1, clamp(stored ?? shockIntensity, 0, cap) || 1);
    }
    if (shockRandom) {
      return Math.max(1, rollIntensity(shockMin, Math.min(shockMax, cap)));
    }
    return Math.max(1, clamp(shockIntensity, 0, cap) || 1);
  };

  useEffect(() => {
    if (activeBlocked) {
      setWarningLevel('none');
      // Owner STOP already cuts the broker op; just clear local press state
      holdingOpRef.current = null;
      holdTargetRef.current = null;
      setHoldingOp(null);
    }
  }, [activeBlocked]);

  const resolveFireTargets = (opts?: {
    target?: {
      shockerId: number;
      clientId?: number | string;
      shareCode?: string;
      targetDiscordUserId?: string;
    };
    hold?: boolean;
  }): ShockerView[] => {
    if (opts?.target) {
      const existing = shockers.find((s) => s.id === opts.target!.shockerId);
      if (existing) {
        return [
          {
            ...existing,
            clientId: opts.target.clientId ?? existing.clientId,
            shareCode: opts.target.shareCode ?? existing.shareCode,
            targetDiscordUserId:
              opts.target.targetDiscordUserId ?? existing.targetDiscordUserId,
          },
        ];
      }
      if (!active) return [];
      return [
        {
          ...active,
          id: opts.target.shockerId,
          clientId: opts.target.clientId ?? active.clientId,
          shareCode: opts.target.shareCode ?? active.shareCode,
          targetDiscordUserId:
            opts.target.targetDiscordUserId ?? active.targetDiscordUserId,
        },
      ];
    }
    // Hold stays single-target; multishock uses one-shot fan-out
    if (opts?.hold || !multiShock) return active ? [active] : [];
    return selectedShockers;
  };

  const fire = (
    operation: OfficialOperateInput['operation'],
    intensity: number,
    durationMs: number,
    opts?: {
      hold?: boolean;
      target?: {
        shockerId: number;
        clientId?: number | string;
        shareCode?: string;
        targetDiscordUserId?: string;
      };
    },
  ) => {
    if (operation === 'stop') return;
    if (controlsLocked && operation !== 'end') return;
    const targets = resolveFireTargets(opts);
    if (!targets.length) return;

    const dispatch = (
      shocker: ShockerView,
      op: OfficialOperateInput['operation'],
      inten: number,
      dur: number,
      warning: OfficialOperateInput['warning'] = null,
    ) => {
      const mode: ModeBandOp =
        op === 'vibrate' ? 'vibrate' : op === 'beep' ? 'beep' : 'shock';
      // Per-person / per-shocker caps — never raise someone past their own limit
      const sMaxInt = shockerUsableInt(shocker, mode);
      const sMinInt = shockerUsableMinInt(shocker, mode);
      const sMaxDur = shockerUsableDur(shocker, mode);
      const sMinDur = shockerUsableMinDur(shocker, mode);
      const shockLike = op === 'shock' || op === 'hold';
      onOperate({
        shockerId: shocker.id,
        shareCode: shocker.shareCode,
        clientId: shocker.clientId ?? hub.id,
        targetDiscordUserId: shocker.targetDiscordUserId,
        canShock: shocker.canShock,
        canVibrate: shocker.canVibrate,
        canBeep: shocker.canBeep,
        canHold: shocker.canHold,
        maxIntensity: sMaxInt,
        maxDuration: sMaxDur,
        hold: Boolean(opts?.hold),
        warning,
        warningLevel: shockLike
          ? atLeastWarning(warningLevel, normalizeWarningLevel(shocker.requiredWarningLevel))
          : undefined,
        operation: op,
        intensity: clamp(inten, sMinInt, sMaxInt),
        durationMs: clamp(dur, sMinDur, sMaxDur),
      });
    };

    const skipped: Array<{ shocker: ShockerView; reason: string }> = [];
    const ready: ShockerView[] = [];
    for (const shocker of targets) {
      const reason =
        operation !== 'end' && shocker.emergencyStop
          ? 'E-STOP'
          : operation !== 'end' && shocker.paused
            ? 'paused'
            : operation === 'shock' && !shocker.canShock
              ? 'shock not allowed'
              : operation === 'vibrate' && !shocker.canVibrate
                ? 'vibrate not allowed'
                : operation === 'beep' && !shocker.canBeep
                  ? 'beep not allowed'
                  : null;
      if (reason) skipped.push({ shocker, reason });
      else ready.push(shocker);
    }
    if (multiShock && targets.length > 1 && operation !== 'end') {
      setLastSkipped(Object.fromEntries(skipped.map((x) => [x.shocker.id, x.reason])));
      onBatchPlanned?.({
        count: ready.length,
        skipped: skipped.map((x) => ({
          name: x.shocker.targetDiscordUserId
            ? `${personName(x.shocker.targetDiscordUserId)}: ${x.shocker.name}`
            : x.shocker.name,
          reason: x.reason,
        })),
      });
    }
    const individual = individualIntensity && multiShock && operation !== 'end';
    for (const shocker of ready) {
      const key = multiColorKey(shocker);
      const perIntensity =
        individual && (operation === 'shock' || operation === 'vibrate')
          ? operation === 'shock'
            ? resolveShockIntensityFor(shocker)
            : Math.max(1, perShockIntensity[key] ?? intensity)
          : intensity;
      const perDuration = individual ? (perShockDuration[key] ?? durationMs) : durationMs;
      dispatch(shocker, operation, perIntensity, perDuration, null);
    }
  };

  const endHold = () => {
    if (!holdingOpRef.current) return;
    const target = holdTargetRef.current;
    holdingOpRef.current = null;
    holdTargetRef.current = null;
    setHoldingOp(null);
    fire('end', 0, 16, { target: target ?? undefined });
  };

  const beginHold = (
    operation: 'shock' | 'vibrate' | 'beep',
    intensity: number,
    ev: ReactPointerEvent<HTMLElement>,
  ) => {
    if (multiShock || !active || controlsLocked || holdingOpRef.current) return;
    if (active.emergencyStop || active.paused) return;
    if (operation === 'shock' && !active.canShock) return;
    if (operation === 'vibrate' && !active.canVibrate) return;
    if (operation === 'beep' && !active.canBeep) return;
    try {
      (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    } catch {
      // ignore — still listen for pointerup on the element
    }
    holdTargetRef.current = {
      shockerId: active.id,
      clientId: active.clientId ?? hub.id,
      shareCode: active.shareCode,
      targetDiscordUserId: active.targetDiscordUserId,
    };
    holdingOpRef.current = operation;
    setHoldingOp(operation);
    // Hold for the active mode's max; release sends broker end (m:"e"). The server warns first.
    const holdMode: ModeBandOp =
      operation === 'vibrate' ? 'vibrate' : operation === 'beep' ? 'beep' : 'shock';
    const holdMaxDur = shockerUsableDur(active, holdMode);
    fire(operation, Math.max(1, intensity), holdMaxDur, { hold: true });
  };

  useEffect(() => {
    // Press-and-hold needs broker hold permission
    if (tapMode && active && !active.canHold) {
      if (holdingOpRef.current) endHold();
      setTapMode(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tapMode, active?.canHold, activeId]);

  useEffect(() => {
    // Multishock and continuous TAP hold don't mix
    if (multiShock && tapMode) {
      if (holdingOpRef.current) endHold();
      setTapMode(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiShock]);

  useEffect(() => {
    const el = shockerChipsRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => passShockerChipWheel(el, event);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [showShockerChips]);

  useEffect(() => {
    if (!holdingOp) return;
    const onBlur = () => endHold();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endHold();
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKey);
    };
    // endHold closes over latest fire/active
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingOp, activeId, maxDur]);

  return (
    <div className="bg-dark q-layout q-layout--standard official-root">
      <header
        className="q-header q-layout__section--marginal custom-header fixed-top"
        style={{ borderBottom: '1px solid rgb(121, 198, 219)' }}
      >
        <div
          role="toolbar"
          className="q-toolbar row no-wrap items-center bg-secondary no-padding row justify-between official-header-toolbar"
        >
          <div className="official-header-version">
            <AppVersionBadge />
          </div>
          <div className="official-header-brand">
            <div className="text-dark text-h3 q-toolbar__title" style={{ margin: 0 }}>
              <div
                className="official-header-brand__row"
                style={{ fontFamily: 'geo, Oxanium, sans-serif' }}
              >
                <span className="text-grey-3">PiShock</span>
              </div>
            </div>
          </div>
          <div className="flex row no-wrap items-center">
            {showLinkAccount ? (
              <button
                type="button"
                className="q-btn q-btn-item non-selectable no-outline q-ml-sm q-btn--standard q-btn--rectangle bg-dark text-secondary q-btn--actionable q-focusable q-hoverable q-btn--wrap q-btn--dense"
                onClick={onOpenLinkAccount}
              >
                <span className="q-btn__wrapper col row q-anchor--skip">
                  <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row no-wrap">
                    <i className="q-icon on-left mdi mdi-link-variant" aria-hidden />
                    <span className="block">Link</span>
                  </span>
                </span>
              </button>
            ) : linkedAccount?.avatarUrl ? (
              <button
                type="button"
                className="q-btn q-btn-item non-selectable no-outline q-ml-sm q-btn--standard q-btn--rectangle bg-dark text-secondary q-btn--actionable q-focusable q-hoverable q-btn--wrap q-btn--dense official-account-btn"
                onClick={onOpenLinkedAccount ?? onOpenMenu}
                title={
                  linkedAccount.username
                    ? `Linked as ${linkedAccount.username}`
                    : 'Linked PiShock account'
                }
                aria-label={
                  linkedAccount.username
                    ? `Linked PiShock account ${linkedAccount.username}`
                    : 'Linked PiShock account'
                }
              >
                <span className="q-btn__wrapper col row q-anchor--skip">
                  <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                    <img
                      className="official-account-btn__avatar"
                      src={linkedAccount.avatarUrl}
                      alt=""
                      width={28}
                      height={28}
                      decoding="async"
                      referrerPolicy="no-referrer"
                    />
                  </span>
                </span>
              </button>
            ) : null}
            <button
              type="button"
              className="q-btn q-btn-item non-selectable no-outline q-mx-sm q-btn--outline q-btn--rectangle text-dark q-btn--actionable q-focusable q-hoverable q-btn--wrap"
              onClick={onOpenMenu}
            >
              <span className="q-btn__wrapper col row q-anchor--skip">
                <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                  <span className="block">Menu</span>
                </span>
              </span>
            </button>
          </div>
        </div>
        {safetyBanner}
      </header>

      <div className="q-page-container">
        <main className="q-page flex column items-center justify-start">
          <div className="text-h4 flex q-pa-sm col-md-8 col-xs-12 full-height full-width official-control-surface">
            <div className="full-width">
              <div
                className={`column official-control-column${
                  starredPanel ? ' official-control-column--starred' : ''
                }`}
              >
                {starredPanel ? (
                  <div className="official-starred-caption" role="status">
                    <i className="q-icon mdi mdi-star official-starred-caption__icon" aria-hidden />
                    <div className="official-starred-caption__copy">
                      <div className="official-starred-caption__title">You’re starred</div>
                      <div className="official-starred-caption__hint">
                        {starredPanelStarOnly
                          ? 'Stars-only queue is on — you can control them, and your commands also get priority.'
                          : 'Your commands get queue priority. If they turn on stars-only, you stay allowed.'}
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="row justify-between items-start official-hub-status-row">
                  <div className="column official-hub-status">
                    <span className="text-secondary official-hub-status__name">{hub.name}</span>
                    <div className="flex row q-gutter-xs items-center official-hub-status__meta">
                      <button
                        type="button"
                        title="Ping hub"
                        disabled={pinging || !onPingHub}
                        className="q-btn q-btn-item non-selectable no-outline q-btn--outline q-btn--rectangle text-secondary q-btn--actionable q-focusable q-hoverable q-btn--wrap q-btn--dense official-hub-ping"
                        style={{ fontSize: 8 }}
                        onClick={() => onPingHub?.()}
                      >
                        <span className="q-btn__wrapper col row q-anchor--skip">
                          <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                            <i
                              className={`q-icon mdi ${pinging ? 'mdi-loading mdi-spin' : 'mdi-exclamation'}`}
                              aria-hidden
                            />
                          </span>
                        </span>
                      </button>
                      <span
                        className={`text-overline ${
                          hub.online ? 'text-positive' : hub.lastSeen ? 'text-grey-3' : 'text-grey-5'
                        }`}
                      >
                        {pinging
                          ? 'Pinging…'
                          : hub.online
                            ? hub.lastSeen || 'Seen a few seconds ago'
                            : hub.lastSeen || 'Offline'}
                      </span>
                    </div>
                  </div>
                  <div className="relative-position official-hub-menu-wrap">
                    <button
                      type="button"
                      className="q-btn q-btn-item non-selectable no-outline q-btn--flat q-btn--rectangle text-secondary q-btn--actionable q-focusable q-hoverable q-btn--wrap"
                      onClick={() => setHubMenuOpen((v) => !v)}
                      aria-label="Hub menu"
                      aria-expanded={hubMenuOpen}
                    >
                      <span className="q-btn__wrapper col row q-anchor--skip">
                        <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                          <i className="q-icon mdi mdi-dots-vertical" aria-hidden />
                        </span>
                      </span>
                    </button>
                    {hubMenuOpen ? (
                      <div
                        className="q-menu q-position-engine scroll q-menu--dark official-hub-menu"
                        style={{
                          position: 'absolute',
                          right: 0,
                          top: '100%',
                          zIndex: 6000,
                          minWidth: 180,
                        }}
                      >
                        <div className="q-list q-list--dark official-hub-menu__list" style={{ padding: 4 }}>
                          <div className="q-item q-item-type row no-wrap q-item--dark full-width">
                            <div className="q-item__section column q-item__section--main justify-center">
                              <div className="q-item__label text-secondary">Hub ID</div>
                              <div
                                className="q-item__label q-item__label--caption text-grey-5"
                                style={{ fontFamily: 'ui-monospace, monospace', userSelect: 'all' }}
                              >
                                {hub.id}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="q-item q-item-type row no-wrap q-item--dark q-item--clickable full-width bg-transparent text-left"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setHubMenuOpen(false);
                              onPingHub?.();
                            }}
                          >
                            <div className="q-item__section column q-item__section--main justify-center">
                              <div className="q-item__label text-grey-3">Ping hub</div>
                            </div>
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                {accessBanner}
                {!accessBanner && active?.emergencyStop ? (
                  <div className="access-banner access-banner--estop q-mt-sm q-pa-sm">
                    <div className="text-negative text-subtitle2">Emergency stop armed</div>
                    <div className="text-grey-4 text-body2">
                      Commands are blocked on {active.name} until you press STOP out.
                    </div>
                  </div>
                ) : null}
                {!accessBanner && !active?.emergencyStop && active?.paused ? (
                  <div className="access-banner access-banner--estop q-mt-sm q-pa-sm">
                    <div className="text-negative text-subtitle2">Paused on PiShock</div>
                    <div className="text-grey-4 text-body2">
                      {active.name} is paused on pishock.com. Controls stay off until it is
                      unpaused there.
                    </div>
                  </div>
                ) : null}

                {!friendsOpen &&
                active?.owned &&
                active.discordShareEnabled &&
                active.discordShareMaxIntensity != null &&
                active.discordShareMaxDuration != null ? (
                  <div className="access-banner access-banner--share-bypass q-mt-sm q-pa-sm">
                    <div className="text-secondary text-subtitle2">
                      Discord share limit · {active.discordShareMaxIntensity}% ·{' '}
                      {formatDurationSec(active.discordShareMaxDuration)}s
                    </div>
                    <div className="text-grey-4 text-body2">
                      {maxInt > active.discordShareMaxIntensity ||
                      maxDur > active.discordShareMaxDuration
                        ? 'You set Activity Limits for this shared shocker, and your personal control panel can go higher — you are bypassing those shared limits here.'
                        : 'Guests in Discord Shockers are capped to this Activity Limit on this shocker.'}
                    </div>
                  </div>
                ) : null}

                {friendsOpen || shockers.length > 1 || (estopShockers?.length ?? 0) > 1 ? (
                  <div className="column q-gutter-xs q-mt-sm">
                    <div className="row items-center q-gutter-sm" style={{ flexWrap: 'wrap' }}>
                      <MultiShockToggle
                        active={multiShock}
                        onToggle={toggleMultiShock}
                        title={
                          friendsOpen
                            ? 'Pick several people / shockers and operate them together'
                            : 'Select several shockers (any hub) and operate them together'
                        }
                      />
                      {multiShock ? (
                        <IndividualIntensityToggle
                          active={individualIntensity}
                          onToggle={toggleIndividualIntensity}
                        />
                      ) : null}
                      {multiShock ? (
                        <span className="text-caption text-grey-5">
                          {individualIntensity
                            ? 'Each target uses its own sliders below'
                            : 'Same values for all · each capped to its own limit'}
                        </span>
                      ) : null}
                    </div>
                    {multiShock ? (
                      <MultiTargetTray
                        shockers={shockers}
                        selectedIds={selectedIds}
                        individual={individualIntensity}
                        values={Object.fromEntries(
                          shockers.map((s) => {
                            const key = multiColorKey(s);
                            return [
                              key,
                              {
                                intensity: perShockIntensity[key] ?? shockIntensity,
                                durationMs: perShockDuration[key] ?? shockDurationMs,
                              },
                            ];
                          }),
                        )}
                        defaults={{ intensity: shockIntensity, durationMs: shockDurationMs }}
                        keyFor={multiColorKey}
                        colorFor={multiColorForShocker}
                        personName={personName}
                        maxIntensityFor={(s) => shockerUsableInt(s)}
                        minIntensityFor={(s) => shockerUsableMinInt(s)}
                        maxDurationFor={(s) => shockerUsableDur(s)}
                        minDurationFor={(s) => shockerUsableMinDur(s)}
                        skipped={lastSkipped}
                        onToggle={(id) =>
                          setSelectedIds((prev) =>
                            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                          )
                        }
                        onSetGroup={(ids, on) =>
                          setSelectedIds((prev) =>
                            on
                              ? [...prev, ...ids.filter((id) => !prev.includes(id))]
                              : prev.filter((id) => !ids.includes(id)),
                          )
                        }
                        onValue={(key, v) => {
                          setPerShockIntensity((prev) => ({ ...prev, [key]: v.intensity }));
                          setPerShockDuration((prev) => ({ ...prev, [key]: v.durationMs }));
                        }}
                      />
                    ) : null}
                    {shockers.length > 0 && !multiShock ? (
                      <div ref={shockerChipsRef} className="official-shocker-chips">
                        {shockers.map((s) => {
                          const selected = multiShock
                            ? selectedIds.includes(s.id)
                            : s.id === active?.id;
                          const focused = s.id === active?.id;
                          const chipKey = s.targetDiscordUserId
                            ? `${s.targetDiscordUserId}:${s.id}`
                            : String(s.id);
                          const color = multiShock ? multiColorForShocker(s) : undefined;
                          const limit = shockerUsableInt(s);
                          const setInt =
                            individualIntensity && multiShock
                              ? clamp(
                                  perShockIntensity[multiColorKey(s)] ?? shockIntensity,
                                  0,
                                  limit,
                                )
                              : null;
                          return (
                            <button
                              key={chipKey}
                              type="button"
                              className={`q-btn q-btn-item non-selectable no-outline q-btn--${
                                selected && !multiShock
                                  ? 'standard bg-secondary text-dark'
                                  : multiShock
                                    ? 'standard'
                                    : 'outline text-secondary'
                              } q-btn--rectangle q-btn--actionable q-btn--dense`}
                              style={
                                multiShock && color
                                  ? selected
                                    ? {
                                        background: color,
                                        borderColor: color,
                                        color: '#121212',
                                        outline:
                                          individualIntensity && focused
                                            ? '2px solid #fff'
                                            : undefined,
                                        outlineOffset:
                                          individualIntensity && focused ? 1 : undefined,
                                      }
                                    : {
                                        background: 'transparent',
                                        border: `1px solid ${color}`,
                                        color,
                                        opacity: 0.55,
                                      }
                                  : undefined
                              }
                              onClick={() => {
                                if (!multiShock) {
                                  setActiveId(s.id);
                                  setSelectedIds([s.id]);
                                  return;
                                }
                                if (individualIntensity && selectedIds.includes(s.id)) {
                                  setActiveId(s.id);
                                  focusShockerIntensity(s);
                                  return;
                                }
                                setSelectedIds((prev) => {
                                  const has = prev.includes(s.id);
                                  if (has) {
                                    const next = prev.filter((id) => id !== s.id);
                                    if (!next.length) return prev;
                                    if (activeId === s.id) {
                                      const fallback =
                                        shockers.find((x) => x.id === next[0]) ?? null;
                                      setActiveId(next[0]!);
                                      if (fallback) focusShockerIntensity(fallback);
                                    }
                                    return next;
                                  }
                                  setActiveId(s.id);
                                  focusShockerIntensity(s);
                                  return [...prev, s.id];
                                });
                              }}
                            >
                              <span className="q-btn__wrapper col row q-anchor--skip">
                                <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                                  <span className="block">
                                    {multiShock && s.hubName && !s.owned ? `${s.hubName}: ` : ''}
                                    {s.name}
                                    {multiShock
                                      ? setInt != null
                                        ? ` · ${setInt}/${limit}%`
                                        : ` · ${limit}%`
                                      : ''}
                                    {s.emergencyStop ? ' · E-STOP' : s.paused ? ' · Paused' : ''}
                                  </span>
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {active ? (
                  <div className="q-my-sm q-gutter-sm full-width">
                    <div className="full-width flex column">
                      <div className="flex column official-remote-cluster">
                        <div className="official-remote-frame">
                          <div className="q-card q-card--dark q-dark q-card--flat no-shadow official-remote-card">
                            <div className="full-width no-padding q-card__section q-card__section--vert">
                              <div className="official-remote-head">
                                <span className="cursor-pointer official-remote-head__name">{active.name}</span>
                                <div className="official-remote-head__actions">
                                  {active.owned && onShareShocker ? (
                                    <button
                                      type="button"
                                      className="q-btn q-btn-item non-selectable no-outline q-btn--flat q-btn--rectangle text-secondary q-btn--actionable q-focusable q-hoverable q-btn--wrap q-btn--dense"
                                      onClick={() => onShareShocker(active)}
                                      title="Create a PiShock share code for this shocker"
                                    >
                                      <span className="q-btn__wrapper col row q-anchor--skip">
                                        <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                                          <i className="q-icon on-left mdi mdi-share-variant" aria-hidden />
                                          <span className="block">Share</span>
                                        </span>
                                      </span>
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="q-btn q-btn-item non-selectable no-outline q-btn--flat q-btn--rectangle text-secondary q-btn--actionable q-focusable q-hoverable q-btn--wrap q-btn--dense"
                                    onClick={() => onPair?.(active)}
                                  >
                                    <span className="q-btn__wrapper col row q-anchor--skip">
                                      <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                                        <i className="q-icon on-left mdi mdi-human-greeting-proximity" aria-hidden />
                                        <span className="block">Pair</span>
                                      </span>
                                    </span>
                                  </button>
                                </div>
                              </div>

                              <div className="official-remote-row">
                                {/* SHOCK */}
                                <div className="official-remote-side">
                                  <div className="official-panel-shell">
                                    <div className="border-color-secondary q-card q-card--dark q-dark q-card--bordered">
                                      <div className="q-item__label text-center bg-dark text-secondary q-mb-xs border-color-secondary q-item__label--overline text-overline">
                                        SHOCK
                                      </div>
                                      <div className="q-card__section q-card__section--horiz row no-wrap">
                                        <div className="column justify-between items-center q-ml-xs">
                                          <div className="flex column q-gutter-sm">
                                            <MetricStack
                                              icon="mdi-flash"
                                              value={intensityLabel(
                                                shockRandom &&
                                                  !(individualIntensity && multiShock),
                                                shockIntensity,
                                                shockMin,
                                                shockMax,
                                              )}
                                              label={
                                                individualIntensity && multiShock
                                                  ? active.name
                                                  : tapMode
                                                    ? 'Hold'
                                                    : 'Operate'
                                              }
                                              filled
                                              active={holdingOp === 'shock'}
                                              disabled={
                                                (busy && !holdingOp) ||
                                                controlsLocked ||
                                                !modeEligible('shock')
                                              }
                                              onClick={
                                                tapMode
                                                  ? undefined
                                                  : () =>
                                                      fire(
                                                        'shock',
                                                        resolveShockIntensity(),
                                                        shockDurationMs,
                                                      )
                                              }
                                              onPointerDown={
                                                tapMode
                                                  ? (ev) =>
                                                      beginHold(
                                                        'shock',
                                                        resolveShockIntensity(),
                                                        ev,
                                                      )
                                                  : undefined
                                              }
                                              onPointerUp={tapMode ? () => endHold() : undefined}
                                              onPointerCancel={
                                                tapMode ? () => endHold() : undefined
                                              }
                                            />
                                            <DurationMetric
                                              valueMs={shockDurationMs}
                                              minMs={minDur}
                                              maxMs={maxDur}
                                              open={durationMenu === 'shock'}
                                              disabled={tapMode}
                                              side="right"
                                              limitMarkers={multiLimitMarkers}
                                              onToggle={() =>
                                                setDurationMenu((m) =>
                                                  m === 'shock' ? null : 'shock',
                                                )
                                              }
                                              onSelect={(ms) => {
                                                setShockDurationMs(clamp(ms, minDur, maxDur));
                                                setDurationMenu(null);
                                              }}
                                            />
                                          </div>
                                          <div className="q-mt-sm q-mb-xs flex column">
                                            <button
                                              type="button"
                                              className="q-btn q-btn-item non-selectable no-outline q-btn--push q-btn--round text-accent q-btn--actionable q-focusable q-hoverable q-btn--wrap"
                                              disabled={controlsLocked}
                                              title={
                                                requiredWarningFloor === 'none'
                                                  ? 'Vibrate before shock: None → SMALL → MID → LONG'
                                                  : `Wearer requires at least ${warningButtonLabel(requiredWarningFloor)} warning`
                                              }
                                              onClick={() =>
                                                setWarningLevel((level) => cycleWarningLevel(level))
                                              }
                                            >
                                              <span className="q-btn__wrapper col row q-anchor--skip">
                                                <span className="q-btn__content text-center col items-center q-anchor--skip justify-center column">
                                                  <i
                                                    className="q-icon mdi mdi-car-brake-alert"
                                                    aria-hidden
                                                  />
                                                  <span className="block">
                                                    {warningButtonLabel(warningLevel)}
                                                  </span>
                                                </span>
                                              </span>
                                            </button>
                                            <div
                                              className="q-chip row inline no-wrap items-center text-center no-margin bg-secondary text-dark q-chip--colored q-chip--dense q-chip--square"
                                              style={{ fontSize: 10 }}
                                            >
                                              <div className="q-chip__content col row no-wrap items-center q-anchor--skip">
                                                <div className="full-width text-center text-caption">
                                                  <span>Warning</span>
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                        <VerticalQuasarSlider
                                          value={shockIntensity}
                                          minValue={shockMin}
                                          maxValue={shockMax}
                                          random={
                                            shockRandom &&
                                            !(individualIntensity && multiShock)
                                          }
                                          deviceMax={deviceMaxInt}
                                          activityMin={shockEditFloor}
                                          activityMax={shockEditCap}
                                          limitMarkers={multiLimitMarkers}
                                          onChange={setActiveShockIntensity}
                                          onChangeMin={setShockMin}
                                          onChangeMax={setShockMax}
                                          disabled={controlsLocked || !active.canShock}
                                          trackMargin="left"
                                          rail={
                                            <IntensityEdgeRail
                                              place="shock"
                                              disabled={controlsLocked || !active.canShock}
                                              random={
                                                shockRandom &&
                                                !(individualIntensity && multiShock)
                                              }
                                              showRandom={!(individualIntensity && multiShock)}
                                              onUp={() =>
                                                nudgeIntensity({
                                                  random:
                                                    shockRandom &&
                                                    !(individualIntensity && multiShock),
                                                  value: shockIntensity,
                                                  min: shockMin,
                                                  max: shockMax,
                                                  cap: shockEditCap,
                                                  delta: 1,
                                                  setValue: setActiveShockIntensity,
                                                  setMin: setShockMin,
                                                  setMax: setShockMax,
                                                })
                                              }
                                              onDown={() =>
                                                nudgeIntensity({
                                                  random:
                                                    shockRandom &&
                                                    !(individualIntensity && multiShock),
                                                  value: shockIntensity,
                                                  min: shockMin,
                                                  max: shockMax,
                                                  cap: shockEditCap,
                                                  delta: -1,
                                                  setValue: setActiveShockIntensity,
                                                  setMin: setShockMin,
                                                  setMax: setShockMax,
                                                })
                                              }
                                              onToggleRandom={() => {
                                                if (individualIntensity && multiShock) return;
                                                setShockRandom((on) => {
                                                  if (!on) {
                                                    // Spread thumbs full range so they aren't stacked
                                                    setShockMin(0);
                                                    setShockMax(shockEditCap);
                                                  } else {
                                                    setActiveShockIntensity(
                                                      clamp(
                                                        Math.round((shockMin + shockMax) / 2),
                                                        0,
                                                        shockEditCap,
                                                      ),
                                                    );
                                                  }
                                                  return !on;
                                                });
                                              }}
                                            />
                                          }
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* CENTER */}
                                <div className="official-remote-center">
                                  <CenterControl
                                    icon="mdi-cursor-pointer"
                                    caption="Tap"
                                    chip="Use Mode"
                                    outline
                                    active={tapMode}
                                    disabled={!active.canHold || multiShock}
                                    onClick={() => {
                                      if (multiShock) return;
                                      if (holdingOpRef.current) endHold();
                                      setTapMode((v) => !v);
                                    }}
                                  />
                                  {active?.owned ? (
                                    <div className="flex column items-center">
                                      <CenterControl
                                        icon="mdi-alert-octagon"
                                        chip={stopArmed ? 'ARMED' : 'STOP'}
                                        danger
                                        padding={16}
                                        active={stopArmed}
                                        disabled={busy || !onEmergencyStop || stopTargets.length === 0}
                                        onClick={() => {
                                          if (!active || !onEmergencyStop || stopTargets.length === 0) return;
                                          onEmergencyStop({
                                            shockerId: active.id,
                                            shockerIds: stopTargets.map((s) => s.id),
                                            clientId: active.clientId ?? hub.id,
                                            engaged: !stopArmed,
                                          });
                                        }}
                                      />
                                      <div className="estop-scope" role="group" aria-label="Emergency stop scope">
                                        <button
                                          type="button"
                                          className={estopAll ? '' : 'on'}
                                          onClick={() => setEstopAll(false)}
                                        >
                                          This
                                        </button>
                                        <button
                                          type="button"
                                          className={estopAll ? 'on' : ''}
                                          onClick={() => setEstopAll(true)}
                                        >
                                          All
                                        </button>
                                      </div>
                                    </div>
                                  ) : active?.emergencyStop ? (
                                    <CenterControl
                                      icon="mdi-alert-octagon"
                                      chip="E-STOP"
                                      danger
                                      padding={16}
                                      active
                                      disabled
                                    />
                                  ) : null}
                                  <CenterControl
                                    icon="mdi-bell-alert"
                                    chip="Beep"
                                    padding={8}
                                    active={holdingOp === 'beep'}
                                    disabled={
                                      (busy && !holdingOp) ||
                                      controlsLocked ||
                                      !modeEligible('beep')
                                    }
                                    onClick={
                                      tapMode ? undefined : () => fire('beep', 1, 300)
                                    }
                                    onPointerDown={
                                      tapMode
                                        ? (ev) => beginHold('beep', 1, ev)
                                        : undefined
                                    }
                                    onPointerUp={tapMode ? () => endHold() : undefined}
                                    onPointerCancel={tapMode ? () => endHold() : undefined}
                                  />
                                  <CenterControl
                                    icon="mdi-cogs"
                                    chip="SO"
                                    flat
                                    disabled={!onOpenShockerSettings || !active}
                                    onClick={() => {
                                      if (active) onOpenShockerSettings?.(active);
                                    }}
                                  />
                                </div>

                                {/* VIBRATE */}
                                <div className="official-remote-side">
                                  <div className="official-panel-shell">
                                    <div className="border-color-secondary q-card q-card--dark q-dark q-card--bordered">
                                      <div className="q-item__label text-center bg-dark text-secondary q-mb-xs q-item__label--overline text-overline">
                                        VIBRATE
                                      </div>
                                      <div className="q-card__section q-card__section--horiz row no-wrap">
                                        <VerticalQuasarSlider
                                          value={vibIntensity}
                                          deviceMax={deviceMaxInt}
                                          activityMin={vibMinInt}
                                          activityMax={vibMaxInt}
                                          limitMarkers={multiLimitMarkers}
                                          onChange={setVibIntensity}
                                          disabled={controlsLocked || !active.canVibrate}
                                          trackMargin="right"
                                          rail={
                                            <IntensityEdgeRail
                                              place="vibrate"
                                              disabled={controlsLocked || !active.canVibrate}
                                              onUp={() =>
                                                nudgeIntensity({
                                                  random: false,
                                                  value: vibIntensity,
                                                  min: 0,
                                                  max: vibIntensity,
                                                  cap: vibMaxInt,
                                                  delta: 1,
                                                  setValue: setVibIntensity,
                                                })
                                              }
                                              onDown={() =>
                                                nudgeIntensity({
                                                  random: false,
                                                  value: vibIntensity,
                                                  min: 0,
                                                  max: vibIntensity,
                                                  cap: vibMaxInt,
                                                  delta: -1,
                                                  setValue: setVibIntensity,
                                                })
                                              }
                                            />
                                          }
                                        />
                                        <div className="column justify-between items-center q-mr-xs">
                                          <div className="flex column q-gutter-sm">
                                            <MetricStack
                                              icon="mdi-vibrate"
                                              value={String(vibIntensity)}
                                              label={tapMode ? 'Hold' : 'Operate'}
                                              filled
                                              active={holdingOp === 'vibrate'}
                                              disabled={
                                                (busy && !holdingOp) ||
                                                controlsLocked ||
                                                !modeEligible('vibrate')
                                              }
                                              onClick={
                                                tapMode
                                                  ? undefined
                                                  : () =>
                                                      fire(
                                                        'vibrate',
                                                        Math.max(1, vibIntensity || 1),
                                                        vibDurationMs,
                                                      )
                                              }
                                              onPointerDown={
                                                tapMode
                                                  ? (ev) =>
                                                      beginHold(
                                                        'vibrate',
                                                        Math.max(1, vibIntensity || 1),
                                                        ev,
                                                      )
                                                  : undefined
                                              }
                                              onPointerUp={tapMode ? () => endHold() : undefined}
                                              onPointerCancel={
                                                tapMode ? () => endHold() : undefined
                                              }
                                            />
                                            <DurationMetric
                                              valueMs={vibDurationMs}
                                              minMs={vibMinDur}
                                              maxMs={vibMaxDur}
                                              open={durationMenu === 'vibrate'}
                                              disabled={tapMode}
                                              side="left"
                                              limitMarkers={multiLimitMarkers}
                                              onToggle={() =>
                                                setDurationMenu((m) =>
                                                  m === 'vibrate' ? null : 'vibrate',
                                                )
                                              }
                                              onSelect={(ms) => {
                                                setVibDurationMs(clamp(ms, vibMinDur, vibMaxDur));
                                                setDurationMenu(null);
                                              }}
                                            />
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-grey-3 q-pa-xl text-center" style={{ maxWidth: 420, margin: '0 auto' }}>
                    {emptyMessage}
                  </div>
                )}

                <AnnouncementBanner />
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Mode switcher + hub/friends panels (collapses on compact / phone) */}
      <div
        className={`fixed-bottom-left q-pa-md official-mode-dock${
          compactDock ? ' official-mode-dock--compact' : ''
        }${modeDockOpen ? ' is-open' : ''}`}
        style={{ zIndex: 2000 }}
      >
        {compactDock ? (
          <button
            type="button"
            className={`q-btn q-btn-item non-selectable no-outline official-mode-fab q-btn--${
              modeDockOpen ? 'standard bg-secondary text-dark' : 'outline text-secondary'
            } q-btn--round q-btn--actionable`}
            aria-label={modeDockOpen ? 'Hide mode menu' : 'Show mode menu'}
            aria-expanded={modeDockOpen}
            onClick={() => setModeDockOpen((v) => !v)}
          >
            <span className="q-btn__wrapper col row q-anchor--skip">
              <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                <i
                  className={`q-icon mdi ${modeDockOpen ? 'mdi-close' : 'mdi-menu'}`}
                  aria-hidden
                />
              </span>
            </span>
          </button>
        ) : null}

        {modeDockOpen || !compactDock ? (
          <div className="official-mode-switch">
            {showOwnMode ? (
              <button
                type="button"
                className={`q-btn q-btn-item non-selectable no-outline official-mode-btn q-btn--${
                  !friendsOpen ? 'standard bg-secondary text-dark' : 'outline text-secondary'
                } q-btn--rectangle q-btn--rounded q-btn--actionable q-btn--wrap`}
                onClick={() => {
                  if (friendsOpen) onOpenOwnShockers?.();
                  else setHubsOpen((v) => !v);
                }}
              >
                <span className="q-btn__wrapper col row q-anchor--skip">
                  <span className="q-btn__content text-center col items-center q-anchor--skip justify-start row no-wrap">
                    <i
                      className="q-icon on-left mdi mdi-access-point"
                      style={{ fontSize: 16 }}
                      aria-hidden
                    />
                    <div style={{ textAlign: 'left' }}>
                      <div className="mode-title">My Shockers</div>
                      <div className="mode-sub">Your hubs &amp; devices</div>
                    </div>
                  </span>
                </span>
              </button>
            ) : null}

            <button
              type="button"
              className={`q-btn q-btn-item non-selectable no-outline official-mode-btn q-btn--${
                friendsOpen ? 'standard bg-secondary text-dark' : 'outline text-secondary'
              } q-btn--rectangle q-btn--rounded q-btn--actionable q-btn--wrap`}
              onClick={onOpenFriends}
            >
              <span className="q-btn__wrapper col row q-anchor--skip">
                <span className="q-btn__content text-center col items-center q-anchor--skip justify-start row no-wrap">
                  <i
                    className="q-icon on-left mdi mdi-account-group"
                    style={{ fontSize: 16 }}
                    aria-hidden
                  />
                  <div style={{ textAlign: 'left' }}>
                    <div className="mode-title">Discord Shockers</div>
                    <div className="mode-sub">Friends in this activity</div>
                  </div>
                </span>
              </span>
            </button>

            {friendsOpen
              ? typeof friendsPanel === 'function'
                ? friendsPanel({
                    multiShock,
                    onToggleMultiShock: toggleMultiShock,
                    individualIntensity,
                    onToggleIndividualIntensity: toggleIndividualIntensity,
                  })
                : friendsPanel
              : null}

            {showOwnMode && !friendsOpen && hubsOpen ? (
              <div className="official-hub-picker column flex q-pa-xs bg-dark">
                <div className="text-caption text-secondary q-px-xs q-pb-xs">Your hubs</div>
                <div className="official-hub-picker__scroll">
                {(hubs.length ? hubs : [hub]).map((h) => {
                  const selected = selectedHubId ? selectedHubId === h.id : h.id === hub.id;
                  return (
                    <button
                      key={h.id}
                      type="button"
                      className={`q-btn q-btn-item non-selectable no-outline full-width q-my-xs q-btn--${
                        selected ? 'standard bg-secondary text-dark' : 'outline text-secondary'
                      } q-btn--rectangle q-btn--rounded q-btn--actionable q-btn--wrap`}
                      onClick={() => onSelectHub?.(h.id)}
                    >
                      <span className="q-btn__wrapper col row q-anchor--skip">
                        <span className="q-btn__content text-center col items-center q-anchor--skip justify-between row no-wrap">
                          <span className="block ellipsis">{h.name}</span>
                          <span
                            className={`q-icon mdi mdi-circle ${
                              h.online ? 'text-positive' : 'text-grey-6'
                            }`}
                            style={{ fontSize: 8 }}
                            aria-hidden
                          />
                        </span>
                      </span>
                    </button>
                  );
                })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

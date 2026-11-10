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
  friendsPanel?: ReactNode | ((ctx: { multiShock: boolean }) => ReactNode);
  safetyBanner?: ReactNode;
  /** Shown above controls (e.g. blocked / e-stop notices) */
  accessBanner?: ReactNode;
  /** Empty-state copy when there are no shockers to show */
  emptyMessage?: string;
  /** Show header CTA when the user has not linked PiShock yet */
  showLinkAccount?: boolean;
  /** Own hubs require a linked PiShock session */
  showOwnMode?: boolean;
  onOperate: (input: OfficialOperateInput) => void;
  /** Owner-only kill-switch latch (press in / press out) */
  onEmergencyStop?: (input: { shockerId: number; clientId?: number | string; engaged: boolean }) => void;
  onSelectHub?: (hubId: string) => void;
  onOpenFriends?: () => void;
  /** Switch back to the user's own hubs/shockers */
  onOpenOwnShockers?: () => void;
  onOpenMenu?: () => void;
  onOpenLinkAccount?: () => void;
  /** Cog / SO control — open Activity Limits focused on this shocker */
  onOpenShockerSettings?: (shocker: ShockerView) => void;
  onShareShocker?: (shocker: ShockerView) => void;
  onPair?: (shocker: ShockerView) => void;
  /** Manual hub/shocker reachability check (top-left !) */
  onPingHub?: () => void;
  pinging?: boolean;
  selectedHubId?: string | null;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** Stable palette for multishock people / shockers */
const MULTI_COLORS = [
  '#79c6db',
  '#ce93d8',
  '#81c784',
  '#ffb74d',
  '#f48fb1',
  '#90caf9',
  '#aed581',
  '#ff8a65',
] as const;

function multiColorKey(s: ShockerView): string {
  if (s.targetDiscordUserId) return `u:${s.targetDiscordUserId}`;
  if (s.owned) return `own:${s.id}`;
  return `s:${s.id}`;
}

function multiColorForKey(key: string, _keys?: string[]): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return MULTI_COLORS[hash % MULTI_COLORS.length]!;
}

function shockerUsableInt(s: ShockerView): number {
  return Math.min(
    s.deviceMaxIntensity ?? s.maxIntensity ?? 100,
    s.activityMaxIntensity ?? s.maxIntensity ?? 100,
  );
}

function shockerUsableDur(s: ShockerView): number {
  return Math.min(
    s.deviceMaxDuration ?? s.maxDuration ?? 15_000,
    s.activityMaxDuration ?? s.maxDuration ?? 15_000,
  );
}

function formatDurationSec(ms: number) {
  const s = ms / 1000;
  return Number.isInteger(s) ? String(s) : s.toFixed(1);
}

/** Official remote duration chips (seconds). */
const DURATION_PRESETS_SEC = [0.1, 0.3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

function rollIntensity(min: number, max: number) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (hi <= lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function intensityLabel(random: boolean, value: number, min: number, max: number) {
  if (!random) return String(value);
  return `${Math.min(min, max)}-${Math.max(min, max)}`;
}

/** Warning cycles before a shock: vibrate, then shock. */
type WarningLevel = 'none' | 'small' | 'mid' | 'long';

const WARNING_ORDER: WarningLevel[] = ['none', 'small', 'mid', 'long'];

const WARNING_PRESETS: Record<
  Exclude<WarningLevel, 'none'>,
  { intensity: number; durationMs: number; label: string }
> = {
  small: { intensity: 25, durationMs: 500, label: 'SMALL' },
  mid: { intensity: 50, durationMs: 500, label: 'MID' },
  long: { intensity: 50, durationMs: 1000, label: 'LONG' },
};

function nextWarningLevel(current: WarningLevel): WarningLevel {
  const i = WARNING_ORDER.indexOf(current);
  return WARNING_ORDER[(i + 1) % WARNING_ORDER.length]!;
}

function warningButtonLabel(level: WarningLevel): string {
  return level === 'none' ? 'None' : WARNING_PRESETS[level].label;
}

function nudgeIntensity(input: {
  random: boolean;
  value: number;
  min: number;
  max: number;
  cap: number;
  delta: number;
  setValue: (n: number) => void;
  setMin?: (n: number) => void;
  setMax?: (n: number) => void;
}) {
  const lo = clamp(Math.min(input.min, input.max), 0, input.cap);
  const hi = clamp(Math.max(input.min, input.max), 0, input.cap);
  if (!input.random) {
    input.setValue(clamp(input.value + input.delta, 0, input.cap));
    return;
  }
  if (input.delta > 0) input.setMax?.(clamp(hi + input.delta, lo, input.cap));
  else input.setMin?.(clamp(lo + input.delta, 0, hi));
}

const CONTROL_PREFS_KEY = 'pishock.official-controls.v1';

type ControlPrefs = {
  shockIntensity: number;
  shockDurationMs: number;
  shockRandom: boolean;
  shockMin: number;
  shockMax: number;
  vibIntensity: number;
  vibDurationMs: number;
  warningLevel: WarningLevel;
  tapMode: boolean;
  multiShock: boolean;
  activeId?: number;
};

const DEFAULT_CONTROL_PREFS: ControlPrefs = {
  shockIntensity: 0,
  shockDurationMs: 300,
  shockRandom: false,
  shockMin: 0,
  shockMax: 100,
  vibIntensity: 69,
  vibDurationMs: 1000,
  warningLevel: 'none',
  tapMode: false,
  multiShock: false,
};

function loadControlPrefs(): ControlPrefs {
  try {
    const raw = localStorage.getItem(CONTROL_PREFS_KEY);
    if (!raw) return { ...DEFAULT_CONTROL_PREFS };
    const parsed = JSON.parse(raw) as Partial<ControlPrefs>;
    return {
      ...DEFAULT_CONTROL_PREFS,
      ...parsed,
      shockIntensity: Number(parsed.shockIntensity ?? DEFAULT_CONTROL_PREFS.shockIntensity),
      shockDurationMs: Number(parsed.shockDurationMs ?? DEFAULT_CONTROL_PREFS.shockDurationMs),
      shockRandom: Boolean(parsed.shockRandom),
      shockMin: Number(parsed.shockMin ?? 0),
      shockMax: Number(parsed.shockMax ?? 100),
      vibIntensity: Number(parsed.vibIntensity ?? DEFAULT_CONTROL_PREFS.vibIntensity),
      vibDurationMs: Number(parsed.vibDurationMs ?? DEFAULT_CONTROL_PREFS.vibDurationMs),
      warningLevel: (['none', 'small', 'mid', 'long'] as const).includes(
        parsed.warningLevel as WarningLevel,
      )
        ? (parsed.warningLevel as WarningLevel)
        : (parsed as { warningOn?: boolean }).warningOn
          ? 'small'
          : 'none',
      tapMode: Boolean(parsed.tapMode),
      multiShock: Boolean(parsed.multiShock),
      activeId:
        parsed.activeId == null || Number.isNaN(Number(parsed.activeId))
          ? undefined
          : Number(parsed.activeId),
    };
  } catch {
    return { ...DEFAULT_CONTROL_PREFS };
  }
}

function saveControlPrefs(prefs: ControlPrefs) {
  try {
    localStorage.setItem(CONTROL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // private mode / quota
  }
}

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
  emptyMessage = 'No shockers',
  showLinkAccount = false,
  showOwnMode = true,
  onOperate,
  onEmergencyStop,
  onSelectHub,
  onOpenFriends,
  onOpenOwnShockers,
  onOpenMenu,
  onOpenLinkAccount,
  onOpenShockerSettings,
  onShareShocker,
  onPair,
  onPingHub,
  pinging = false,
  selectedHubId = null,
}: Props) {
  const initialPrefs = useMemo(() => loadControlPrefs(), []);
  const [activeId, setActiveId] = useState(
    () => initialPrefs.activeId ?? shockers[0]?.id ?? 0,
  );
  const [hubMenuOpen, setHubMenuOpen] = useState(false);
  const [multiShock, setMultiShock] = useState(initialPrefs.multiShock);
  const [selectedIds, setSelectedIds] = useState<number[]>(() => {
    const first = initialPrefs.activeId ?? shockers[0]?.id;
    return first != null ? [first] : [];
  });
  /** Collapsed mode dock on compact viewports so it doesn't cover the remote */
  const [modeDockOpen, setModeDockOpen] = useState(true);
  const [compactDock, setCompactDock] = useState(false);

  const active = useMemo(
    () => shockers.find((s) => s.id === activeId) ?? shockers[0],
    [shockers, activeId],
  );

  const selectedShockers = useMemo(() => {
    if (!multiShock) return active ? [active] : [];
    const picked = selectedIds
      .map((id) => shockers.find((s) => s.id === id))
      .filter((s): s is ShockerView => Boolean(s));
    return picked.length ? picked : active ? [active] : [];
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
      // Multishock: keep selection and auto-include newly visible shockers
      const merged = [...valid];
      for (const id of visible) {
        if (!merged.includes(id)) merged.push(id);
      }
      return merged.length ? merged : shockers[0] ? [shockers[0].id] : [];
    });
  }, [shockers, multiShock]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px), (max-height: 640px)');
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
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const multiColorKeys = useMemo(() => {
    const pool = selectedShockers.length ? selectedShockers : active ? [active] : [];
    const keys: string[] = [];
    for (const s of pool) {
      const key = multiColorKey(s);
      if (!keys.includes(key)) keys.push(key);
    }
    return keys;
  }, [selectedShockers, active]);

  const multiLimitMarkers = useMemo(() => {
    const pool = selectedShockers.length ? selectedShockers : active ? [active] : [];
    if (!multiShock || pool.length < 2) {
      return [] as Array<{ key: string; color: string; intensity: number; label: string }>;
    }
    const keys: string[] = [];
    for (const s of pool) {
      const key = multiColorKey(s);
      if (!keys.includes(key)) keys.push(key);
    }
    const seen = new Set<string>();
    const markers: Array<{ key: string; color: string; intensity: number; label: string }> = [];
    for (const s of pool) {
      const key = multiColorKey(s);
      if (seen.has(key)) continue;
      seen.add(key);
      markers.push({
        key,
        color: multiColorForKey(key, keys),
        intensity: shockerUsableInt(s),
        label: s.hubName && !s.owned ? s.hubName : s.name,
      });
    }
    return markers.sort((a, b) => a.intensity - b.intensity);
  }, [multiShock, selectedShockers, active]);

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
  const eStop = selectedShockers.some((s) => s.emergencyStop);
  const controlsLocked = eStop;

  useEffect(() => {
    setShockIntensity((v) => clamp(v, 0, maxInt));
    setVibIntensity((v) => clamp(v, 0, maxInt));
    setShockMin((v) => clamp(v, 0, maxInt));
    setShockMax((v) => clamp(v, 0, maxInt));
    setShockDurationMs((v) => clamp(v, 16, maxDur));
    setVibDurationMs((v) => clamp(v, 16, maxDur));
  }, [maxInt, maxDur, activeId]);

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
    shockRandom
      ? Math.max(1, rollIntensity(shockMin, Math.min(shockMax, maxInt)))
      : Math.max(1, shockIntensity || 1);

  useEffect(() => {
    if (eStop) {
      setWarningLevel('none');
      if (warningTimerRef.current) {
        clearTimeout(warningTimerRef.current);
        warningTimerRef.current = null;
      }
      // Owner STOP already cuts the broker op; just clear local press state
      holdingOpRef.current = null;
      holdTargetRef.current = null;
      setHoldingOp(null);
    }
  }, [eStop]);

  useEffect(
    () => () => {
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    },
    [],
  );

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
    return selectedShockers.length ? selectedShockers : active ? [active] : [];
  };

  const fire = (
    operation: OfficialOperateInput['operation'],
    intensity: number,
    durationMs: number,
    opts?: {
      hold?: boolean;
      skipWarning?: boolean;
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
      // Per-person / per-shocker caps — never raise someone past their own limit
      const sMaxInt = shockerUsableInt(shocker);
      const sMaxDur = shockerUsableDur(shocker);
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
        operation: op,
        intensity: clamp(inten, 0, sMaxInt),
        durationMs: clamp(dur, 16, sMaxDur),
      });
    };

    // Vibrate-before-shock for SMALL / MID / LONG (fan-out to all targets)
    if (
      operation === 'shock' &&
      !opts?.skipWarning &&
      !opts?.hold &&
      warningLevel !== 'none'
    ) {
      const preset = WARNING_PRESETS[warningLevel];
      let warnWaitMs = preset.durationMs;
      for (const shocker of targets) {
        if (shocker.emergencyStop || shocker.paused || !shocker.canVibrate) continue;
        const sMaxInt = shockerUsableInt(shocker);
        const sMaxDur = shockerUsableDur(shocker);
        const warnIntensity = clamp(preset.intensity, 1, sMaxInt);
        const warnDuration = clamp(preset.durationMs, 16, sMaxDur);
        warnWaitMs = Math.max(warnWaitMs, warnDuration);
        dispatch(shocker, 'vibrate', warnIntensity, warnDuration, {
          Active: true,
          Intensity: warnIntensity,
          DurationMs: warnDuration,
          Min: warnIntensity,
          Max: warnIntensity,
        });
      }
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
      warningTimerRef.current = setTimeout(() => {
        warningTimerRef.current = null;
        if (controlsLocked) return;
        for (const shocker of targets) {
          if (shocker.emergencyStop || shocker.paused || !shocker.canShock) continue;
          dispatch(shocker, 'shock', intensity, durationMs, null);
        }
      }, warnWaitMs + 50);
      return;
    }

    for (const shocker of targets) {
      if (operation !== 'end' && (shocker.emergencyStop || shocker.paused)) continue;
      if (operation === 'shock' && !shocker.canShock) continue;
      if (operation === 'vibrate' && !shocker.canVibrate) continue;
      if (operation === 'beep' && !shocker.canBeep) continue;
      dispatch(shocker, operation, intensity, durationMs, null);
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
    if (operation === 'shock' && (!active.canShock || active.paused)) return;
    if (operation === 'vibrate' && (!active.canVibrate || active.paused)) return;
    if (operation === 'beep' && (!active.canBeep || active.paused)) return;
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

    const startHold = () => {
      if (holdingOpRef.current !== operation) return;
      // Hold for activity max; release sends broker end (m:"e")
      fire(operation, Math.max(1, intensity), maxDur, { hold: true, skipWarning: true });
    };

    // Warn vibrate, then start continuous shock hold
    if (
      operation === 'shock' &&
      warningLevel !== 'none' &&
      active.canVibrate
    ) {
      const preset = WARNING_PRESETS[warningLevel];
      fire('vibrate', clamp(preset.intensity, 1, maxInt), clamp(preset.durationMs, 16, maxDur), {
        skipWarning: true,
        target: holdTargetRef.current,
      });
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
      warningTimerRef.current = setTimeout(() => {
        warningTimerRef.current = null;
        startHold();
      }, preset.durationMs + 50);
      return;
    }

    startHold();
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
          <div className="text-h4 flex q-pa-sm col-md-8 col-xs-12 full-height full-width">
            <div className="full-width">
              <div className="column">
                <div className="row justify-between items-start">
                  <div className="column">
                    <span className="text-secondary">{hub.name}</span>
                    <div className="flex row q-gutter-xs items-center">
                      <button
                        type="button"
                        title="Ping hub"
                        disabled={pinging || !onPingHub}
                        className="q-btn q-btn-item non-selectable no-outline q-btn--outline q-btn--rectangle text-secondary q-btn--actionable q-focusable q-hoverable q-btn--wrap q-btn--dense"
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
                          background: '#1e1e1e',
                          border: '1px solid rgba(121,198,219,.35)',
                          borderRadius: 4,
                        }}
                      >
                        <div className="q-list q-list--dark" style={{ padding: 4 }}>
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
                {!accessBanner && eStop ? (
                  <div className="access-banner access-banner--estop q-mt-sm q-pa-sm">
                    <div className="text-negative text-subtitle2">Emergency stop armed</div>
                    <div className="text-grey-4 text-body2">
                      All commands are blocked on this shocker until you press STOP out.
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

                {friendsOpen || shockers.length > 1 ? (
                  <div className="column q-gutter-xs q-mt-sm">
                    <div className="row items-center q-gutter-sm">
                      <button
                        type="button"
                        className={`q-btn q-btn-item non-selectable no-outline q-btn--${
                          multiShock ? 'standard bg-secondary text-dark' : 'outline text-secondary'
                        } q-btn--rectangle q-btn--actionable q-btn--dense`}
                        onClick={() => {
                          setMultiShock((v) => {
                            const next = !v;
                            if (next) {
                              if (holdingOpRef.current) endHold();
                              setTapMode(false);
                              setSelectedIds(active ? [active.id] : []);
                            }
                            return next;
                          });
                        }}
                        title="Select several people / shockers and operate them together"
                      >
                        <span className="q-btn__wrapper col row q-anchor--skip">
                          <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row no-wrap">
                            <i className="q-icon on-left mdi mdi-checkbox-multiple-marked-outline" aria-hidden />
                            <span className="block">Multi</span>
                          </span>
                        </span>
                      </button>
                      {multiShock ? (
                        <span className="text-caption text-grey-5">
                          {selectedShockers.length} selected · each capped to their own limit
                        </span>
                      ) : null}
                    </div>
                    {multiShock && multiLimitMarkers.length > 1 ? (
                      <div className="row q-gutter-xs items-center" style={{ flexWrap: 'wrap' }}>
                        {multiLimitMarkers.map((m) => (
                          <span
                            key={m.key}
                            className="text-caption"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              color: m.color,
                            }}
                          >
                            <span
                              aria-hidden
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 999,
                                background: m.color,
                                flexShrink: 0,
                              }}
                            />
                            {m.label} · {m.intensity}%
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {shockers.length > 0 ? (
                      <div className="row q-gutter-sm">
                        {shockers.map((s) => {
                          const selected = multiShock
                            ? selectedIds.includes(s.id)
                            : s.id === active?.id;
                          const chipKey = s.targetDiscordUserId
                            ? `${s.targetDiscordUserId}:${s.id}`
                            : String(s.id);
                          const colorKey = multiColorKey(s);
                          const color = multiShock
                            ? multiColorForKey(colorKey, multiColorKeys.length ? multiColorKeys : [colorKey])
                            : undefined;
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
                                setSelectedIds((prev) => {
                                  const has = prev.includes(s.id);
                                  if (has) {
                                    const next = prev.filter((id) => id !== s.id);
                                    if (!next.length) return prev;
                                    if (activeId === s.id) setActiveId(next[0]!);
                                    return next;
                                  }
                                  setActiveId(s.id);
                                  return [...prev, s.id];
                                });
                              }}
                            >
                              <span className="q-btn__wrapper col row q-anchor--skip">
                                <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                                  <span className="block">
                                    {multiShock && s.hubName && !s.owned ? `${s.hubName}: ` : ''}
                                    {s.name}
                                    {multiShock ? ` · ${shockerUsableInt(s)}%` : ''}
                                    {s.emergencyStop ? ' · E-STOP' : ''}
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
                      <div className="flex column q-ma-xl" style={{ scale: '1.25' }}>
                        <div className="full-width flex row justify-center q-px-md">
                          <div className="q-my-sm q-card q-card--dark q-dark q-card--flat no-shadow col-sm-9 col-xs-12">
                            <div className="full-width no-padding q-card__section q-card__section--vert">
                              <div className="flex row justify-between items-center no-wrap">
                                <span className="cursor-pointer text-h6 q-ml-sm">{active.name}</span>
                                <div className="flex row justify-center items-center">
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
                                          <span className="block">Code</span>
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

                              <div className="flex row no-wrap justify-center q-mt-md">
                                {/* SHOCK */}
                                <div className="flex col-4 justify-end">
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
                                                shockRandom,
                                                shockIntensity,
                                                shockMin,
                                                shockMax,
                                              )}
                                              label={tapMode ? 'Hold' : 'Operate'}
                                              filled
                                              active={holdingOp === 'shock'}
                                              disabled={
                                                (busy && !holdingOp) ||
                                                controlsLocked ||
                                                !active.canShock ||
                                                !!active.paused
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
                                              maxMs={maxDur}
                                              open={durationMenu === 'shock'}
                                              disabled={tapMode}
                                              side="right"
                                              onToggle={() =>
                                                setDurationMenu((m) =>
                                                  m === 'shock' ? null : 'shock',
                                                )
                                              }
                                              onSelect={(ms) => {
                                                setShockDurationMs(ms);
                                                setDurationMenu(null);
                                              }}
                                            />
                                          </div>
                                          <div className="q-mt-sm q-mb-xs flex column">
                                            <button
                                              type="button"
                                              className="q-btn q-btn-item non-selectable no-outline q-btn--push q-btn--round text-accent q-btn--actionable q-focusable q-hoverable q-btn--wrap"
                                              disabled={controlsLocked}
                                              title="Vibrate before shock: None → SMALL → MID → LONG"
                                              onClick={() =>
                                                setWarningLevel((level) => nextWarningLevel(level))
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
                                          random={shockRandom}
                                          deviceMax={deviceMaxInt}
                                          activityMax={maxInt}
                                          limitMarkers={multiLimitMarkers}
                                          onChange={setShockIntensity}
                                          onChangeMin={setShockMin}
                                          onChangeMax={setShockMax}
                                          disabled={controlsLocked || !active.canShock}
                                        />
                                      </div>
                                    </div>
                                    <IntensityEdgeRail
                                      side="right"
                                      disabled={controlsLocked || !active.canShock}
                                      random={shockRandom}
                                      showRandom
                                      onUp={() =>
                                        nudgeIntensity({
                                          random: shockRandom,
                                          value: shockIntensity,
                                          min: shockMin,
                                          max: shockMax,
                                          cap: maxInt,
                                          delta: 1,
                                          setValue: setShockIntensity,
                                          setMin: setShockMin,
                                          setMax: setShockMax,
                                        })
                                      }
                                      onDown={() =>
                                        nudgeIntensity({
                                          random: shockRandom,
                                          value: shockIntensity,
                                          min: shockMin,
                                          max: shockMax,
                                          cap: maxInt,
                                          delta: -1,
                                          setValue: setShockIntensity,
                                          setMin: setShockMin,
                                          setMax: setShockMax,
                                        })
                                      }
                                      onToggleRandom={() => {
                                        setShockRandom((on) => {
                                          if (!on) {
                                            // Spread thumbs full range so they aren't stacked
                                            setShockMin(0);
                                            setShockMax(maxInt);
                                          } else {
                                            setShockIntensity(
                                              clamp(
                                                Math.round((shockMin + shockMax) / 2),
                                                0,
                                                maxInt,
                                              ),
                                            );
                                          }
                                          return !on;
                                        });
                                      }}
                                    />
                                  </div>
                                </div>

                                {/* CENTER */}
                                <div
                                  className="flex col-auto items-center justify-around column q-mx-sm"
                                  style={{ minWidth: 60 }}
                                >
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
                                    <CenterControl
                                      icon="mdi-alert-octagon"
                                      chip={eStop ? 'ARMED' : 'STOP'}
                                      danger
                                      padding={16}
                                      active={eStop}
                                      disabled={busy || !onEmergencyStop}
                                      onClick={() => {
                                        if (!active || !onEmergencyStop) return;
                                        setWarningLevel('none');
                                        if (warningTimerRef.current) {
                                          clearTimeout(warningTimerRef.current);
                                          warningTimerRef.current = null;
                                        }
                                        onEmergencyStop({
                                          shockerId: active.id,
                                          clientId: active.clientId ?? hub.id,
                                          engaged: !eStop,
                                        });
                                      }}
                                    />
                                  ) : eStop ? (
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
                                      !active.canBeep ||
                                      !!active.paused
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
                                <div className="flex col-4 justify-start">
                                  <div className="official-panel-shell">
                                    <IntensityEdgeRail
                                      side="left"
                                      disabled={controlsLocked || !active.canVibrate}
                                      onUp={() =>
                                        nudgeIntensity({
                                          random: false,
                                          value: vibIntensity,
                                          min: 0,
                                          max: vibIntensity,
                                          cap: maxInt,
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
                                          cap: maxInt,
                                          delta: -1,
                                          setValue: setVibIntensity,
                                        })
                                      }
                                    />
                                    <div className="border-color-secondary q-card q-card--dark q-dark q-card--bordered">
                                      <div className="q-item__label text-center bg-dark text-secondary q-mb-xs q-item__label--overline text-overline">
                                        VIBRATE
                                      </div>
                                      <div className="q-card__section q-card__section--horiz row no-wrap">
                                        <VerticalQuasarSlider
                                          value={vibIntensity}
                                          deviceMax={deviceMaxInt}
                                          activityMax={maxInt}
                                          limitMarkers={multiLimitMarkers}
                                          onChange={setVibIntensity}
                                          disabled={controlsLocked || !active.canVibrate}
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
                                                !active.canVibrate ||
                                                !!active.paused
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
                                              maxMs={maxDur}
                                              open={durationMenu === 'vibrate'}
                                              disabled={tapMode}
                                              side="left"
                                              onToggle={() =>
                                                setDurationMenu((m) =>
                                                  m === 'vibrate' ? null : 'vibrate',
                                                )
                                              }
                                              onSelect={(ms) => {
                                                setVibDurationMs(ms);
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
                ? friendsPanel({ multiShock })
                : friendsPanel
              : null}

            {showOwnMode && !friendsOpen && hubsOpen ? (
              <div
                className="column flex q-pa-xs bg-dark"
                style={{ borderRadius: 14, border: '1px solid rgba(121,198,219,.35)' }}
              >
                <div className="text-caption text-secondary q-px-xs q-pb-xs">Your hubs</div>
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
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DurationMetric({
  valueMs,
  maxMs,
  open,
  disabled,
  side,
  onToggle,
  onSelect,
}: {
  valueMs: number;
  maxMs: number;
  open: boolean;
  disabled?: boolean;
  side: 'left' | 'right';
  onToggle: () => void;
  onSelect: (ms: number) => void;
}) {
  const presets = DURATION_PRESETS_SEC.filter((sec) => Math.round(sec * 1000) <= maxMs);
  return (
    <div className="official-duration-wrap">
      <MetricStack
        icon="mdi-clock"
        value={formatDurationSec(valueMs)}
        label="Duration"
        disabled={disabled}
        onClick={onToggle}
      />
      {open && !disabled ? (
        <div
          className={`official-duration-menu official-duration-menu--${side}`}
          role="listbox"
          aria-label="Duration presets"
        >
          {presets.map((sec) => {
            const ms = Math.round(sec * 1000);
            const label = sec < 1 ? `.${String(sec).split('.')[1]}` : String(sec);
            const selected = valueMs === ms;
            return (
              <button
                key={sec}
                type="button"
                role="option"
                aria-selected={selected}
                className={`official-duration-chip${selected ? ' is-selected' : ''}`}
                onClick={() => onSelect(ms)}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function MetricStack({
  icon,
  value,
  label,
  filled,
  active,
  disabled,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
}: {
  icon: string;
  value: string;
  label: string;
  filled?: boolean;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onPointerDown?: (ev: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp?: () => void;
  onPointerCancel?: () => void;
}) {
  return (
    <div className="flex column" style={{ borderRadius: 3 }}>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => {
          if (onPointerDown) e.preventDefault();
        }}
        className={`q-btn q-btn-item non-selectable no-outline q-btn--${
          filled ? 'standard bg-secondary text-dark' : 'outline text-secondary'
        } q-btn--rectangle q-btn--actionable q-focusable q-hoverable q-btn--wrap`}
        style={{
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          boxShadow: active ? 'inset 0 0 0 2px #fff' : undefined,
          touchAction: onPointerDown ? 'none' : undefined,
          userSelect: onPointerDown ? 'none' : undefined,
        }}
      >
        <span className="q-btn__wrapper col row q-anchor--skip">
          <span className="q-btn__content text-center col items-center q-anchor--skip justify-center column">
            <i className={`q-icon mdi ${icon}`} aria-hidden />
            <span className="block">{value}</span>
          </span>
        </span>
      </button>
      <div
        className={`q-chip row inline no-wrap items-center text-center no-margin ${
          filled ? 'bg-dark text-secondary' : 'bg-secondary text-dark'
        } border-color-secondary q-chip--dense q-chip--square`}
        style={{
          fontSize: 10,
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          border: '1px solid',
        }}
      >
        <div className="q-chip__content col row no-wrap items-center q-anchor--skip">
          <div className="full-width text-center text-caption">
            <span>{label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CenterControl({
  icon,
  caption,
  chip,
  outline,
  flat,
  danger,
  padding,
  active,
  disabled,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
}: {
  icon: string;
  caption?: string;
  chip: string;
  outline?: boolean;
  flat?: boolean;
  danger?: boolean;
  padding?: number;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onPointerDown?: (ev: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp?: () => void;
  onPointerCancel?: () => void;
}) {
  const btnClass = outline
    ? 'q-btn--outline text-secondary'
    : flat
      ? 'q-btn--flat text-secondary'
      : danger
        ? 'q-btn--standard bg-secondary text-negative'
        : 'q-btn--standard bg-secondary text-dark';

  return (
    <div className="flex column">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => {
          if (onPointerDown) e.preventDefault();
        }}
        className={`q-btn q-btn-item non-selectable no-outline ${btnClass} q-btn--rectangle q-btn--actionable q-focusable q-hoverable q-btn--wrap ${
          outline || flat ? 'q-btn--dense' : ''
        } ${active && !danger ? 'bg-secondary text-dark' : ''} ${
          active && danger ? 'bg-negative text-white' : ''
        }`}
        style={{
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          fontSize: flat ? 10 : undefined,
          boxShadow: active ? 'inset 0 0 0 2px #fff' : undefined,
          touchAction: onPointerDown ? 'none' : undefined,
          userSelect: onPointerDown ? 'none' : undefined,
        }}
      >
        <span
          className="q-btn__wrapper col row q-anchor--skip"
          style={padding ? { padding, minWidth: 0, minHeight: 0 } : undefined}
        >
          <span
            className={`q-btn__content text-center col items-center q-anchor--skip justify-center ${
              caption ? 'column' : 'row'
            }`}
          >
            <i className={`q-icon mdi ${icon}`} aria-hidden />
            {caption ? <div className="text-caption" style={{ fontSize: 9 }}>{caption}</div> : null}
          </span>
        </span>
      </button>
      <div
        className={`q-chip row inline no-wrap items-center text-center no-margin ${
          active && danger
            ? 'bg-negative text-white'
            : outline
              ? 'bg-secondary text-dark'
              : 'bg-dark text-secondary'
        } border-color-secondary q-chip--dense ${flat ? '' : 'q-chip--square'}`}
        style={{
          fontSize: 10,
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          border: '1px solid',
        }}
      >
        <div className="q-chip__content col row no-wrap items-center q-anchor--skip">
          <div className="full-width text-center text-caption">
            <span>{chip}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function IntensityEdgeRail({
  side,
  disabled,
  random,
  showRandom,
  onUp,
  onDown,
  onToggleRandom,
}: {
  side: 'left' | 'right';
  disabled?: boolean;
  random?: boolean;
  showRandom?: boolean;
  onUp: () => void;
  onDown: () => void;
  onToggleRandom?: () => void;
}) {
  return (
    <div className={`official-edge-rail official-edge-rail--${side}`} aria-hidden={false}>
      <button
        type="button"
        className="official-edge-btn"
        disabled={disabled}
        aria-label="Increase intensity"
        onClick={onUp}
      >
        <i className="q-icon mdi mdi-chevron-double-up" aria-hidden />
      </button>
      {showRandom ? (
        <button
          type="button"
          className={`official-edge-btn official-edge-btn--dice${random ? ' is-active' : ''}`}
          disabled={disabled}
          aria-pressed={random}
          aria-label="Random intensity"
          title="Random intensity"
          onClick={onToggleRandom}
        >
          <i className="q-icon mdi mdi-dice-multiple" aria-hidden />
        </button>
      ) : null}
      <button
        type="button"
        className="official-edge-btn"
        disabled={disabled}
        aria-label="Decrease intensity"
        onClick={onDown}
      >
        <i className="q-icon mdi mdi-chevron-double-down" aria-hidden />
      </button>
    </div>
  );
}

function VerticalQuasarSlider({
  value,
  minValue = 0,
  maxValue = 0,
  random = false,
  deviceMax,
  activityMax,
  limitMarkers = [],
  onChange,
  onChangeMin,
  onChangeMax,
  disabled,
}: {
  value: number;
  minValue?: number;
  maxValue?: number;
  random?: boolean;
  /** PiShock hard ceiling — red zone above this (scale 0–100) */
  deviceMax: number;
  /** Highest usable Activity Limit among the selection — thumb may reach this */
  activityMax: number;
  /** Multishock: per-person limit ticks (color-coded) */
  limitMarkers?: Array<{ key: string; color: string; intensity: number; label: string }>;
  onChange: (n: number) => void;
  onChangeMin?: (n: number) => void;
  onChangeMax?: (n: number) => void;
  disabled?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<'value' | 'min' | 'max' | null>(null);
  const scaleMax = 100;
  const device = clamp(deviceMax, 1, scaleMax);
  const activity = clamp(activityMax, 1, device);
  const usable = clamp(value, 0, activity);
  const lo = clamp(Math.min(minValue, maxValue), 0, activity);
  const hi = clamp(Math.max(minValue, maxValue), 0, activity);
  const pct = (usable / scaleMax) * 100;
  const loPct = (lo / scaleMax) * 100;
  const hiPct = (hi / scaleMax) * 100;
  const redFrom = device;
  const redHeight = Math.max(0, 100 - redFrom);
  const activityCapBottom = activity;

  const applyFromClientY = (clientY: number, mode: 'value' | 'min' | 'max') => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) return;
    const ratio = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
    const raw = Math.round(ratio * scaleMax);
    if (raw > device) return;
    const next = clamp(raw, 0, activity);
    if (mode === 'value') {
      onChange(next);
      return;
    }
    if (mode === 'min') {
      onChangeMin?.(clamp(next, 0, hi));
      return;
    }
    onChangeMax?.(clamp(next, lo, activity));
  };

  const pickHandle = (clientY: number): 'value' | 'min' | 'max' => {
    if (!random) return 'value';
    const el = trackRef.current;
    if (!el) return 'max';
    const rect = el.getBoundingClientRect();
    const ratio = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
    const at = ratio * scaleMax;
    return Math.abs(at - lo) <= Math.abs(at - hi) ? 'min' : 'max';
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    const mode = pickHandle(e.clientY);
    dragRef.current = mode;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    applyFromClientY(e.clientY, mode);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    applyFromClientY(e.clientY, dragRef.current);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const nudge = (delta: number) => {
    if (disabled) return;
    if (!random) {
      onChange(clamp(usable + delta, 0, activity));
      return;
    }
    if (delta > 0) onChangeMax?.(clamp(hi + delta, lo, activity));
    else onChangeMin?.(clamp(lo + delta, 0, hi));
  };

  return (
    <div
      className="q-card__section q-card__section--vert official-slider-col"
      style={{ padding: '0px 5px', marginLeft: 5, position: 'relative' }}
    >
      <div className="flex column items-center q-gutter-sm justify-between">
        <div
          role="slider"
          aria-valuemin={0}
          aria-valuemax={activity}
          aria-orientation="vertical"
          aria-valuenow={random ? hi : usable}
          aria-valuetext={random ? `${lo}-${hi}` : String(usable)}
          className="q-slider q-slider--v q-slider--inactive inline no-wrap row q-slider--enabled q-slider--editable q-slider--label q-slider--dark q-slider--dense q-slider--dense--v"
        >
          <div
            ref={trackRef}
            tabIndex={disabled ? -1 : 0}
            className="q-slider__track-container q-slider__track-container--v official-slider-hit"
            style={{ touchAction: 'none', cursor: disabled ? 'not-allowed' : 'ns-resize' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
                e.preventDefault();
                nudge(1);
              } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
                e.preventDefault();
                nudge(-1);
              }
            }}
          >
            <div
              className="q-slider__track relative-position no-outline"
              style={{ width: limitMarkers.length > 1 ? Math.min(4 + limitMarkers.length * 4, 22) : 5 }}
            >
              <div className="q-slider__inner absolute" style={{ bottom: '0%', height: '100%' }} />
              {activity < device ? (
                <div
                  className="absolute"
                  title="Above Activity Limit"
                  style={{
                    left: 0,
                    right: 0,
                    bottom: `${activityCapBottom}%`,
                    height: `${device - activity}%`,
                    background: 'rgba(244, 214, 0, 0.35)',
                    pointerEvents: 'none',
                  }}
                />
              ) : null}
              {redHeight > 0 ? (
                <div
                  className="absolute"
                  title="Above PiShock device limit"
                  style={{
                    left: 0,
                    right: 0,
                    bottom: `${redFrom}%`,
                    height: `${redHeight}%`,
                    background: 'rgba(229, 57, 53, 0.55)',
                    pointerEvents: 'none',
                  }}
                />
              ) : null}
              {limitMarkers.length > 1 ? (
                <div
                  className="absolute"
                  style={{
                    left: 0,
                    right: 0,
                    bottom: 0,
                    top: 0,
                    display: 'flex',
                    gap: 1,
                    pointerEvents: 'none',
                    zIndex: 1,
                  }}
                >
                  {limitMarkers.map((m) => {
                    const fillTo = random
                      ? Math.min(hi, m.intensity)
                      : Math.min(usable, m.intensity);
                    const fillFrom = random ? Math.min(lo, fillTo) : 0;
                    const height = Math.max(0, fillTo - fillFrom);
                    return (
                      <div key={m.key} style={{ flex: 1, position: 'relative' }}>
                        <div
                          title={`${m.label} · up to ${m.intensity}%`}
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            bottom: `${(fillFrom / scaleMax) * 100}%`,
                            height: `${(height / scaleMax) * 100}%`,
                            background: m.color,
                            borderRadius: 1,
                          }}
                        />
                        <div
                          style={{
                            position: 'absolute',
                            left: -1,
                            right: -1,
                            bottom: `calc(${(clamp(m.intensity, 0, scaleMax) / scaleMax) * 100}% - 1px)`,
                            height: 2,
                            background: m.color,
                            boxShadow: '0 0 0 1px rgba(0,0,0,.35)',
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : random ? (
                <div
                  className="q-slider__selection absolute text-secondary"
                  style={{ bottom: `${loPct}%`, height: `${Math.max(0, hiPct - loPct)}%` }}
                />
              ) : (
                <div
                  className="q-slider__selection absolute text-secondary"
                  style={{ bottom: '0%', height: `${pct}%` }}
                />
              )}
              <div
                className="q-slider__markers q-slider__markers--v absolute overflow-hidden"
                style={{ bottom: '0%', height: '100%', backgroundSize: '2px 10%' }}
              />
              {random ? (
                <>
                  <div
                    className="q-slider__thumb q-slider__thumb--v q-slider__thumb--v-rtl absolute non-selectable text-secondary"
                    style={{ width: 20, height: 20, bottom: `${loPct}%` }}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden className="q-slider__thumb-shape absolute-full">
                      <path d="M 4, 10 a 6,6 0 1,0 12,0 a 6,6 0 1,0 -12,0" />
                    </svg>
                  </div>
                  <div
                    className="q-slider__thumb q-slider__thumb--v q-slider__thumb--v-rtl absolute non-selectable text-secondary"
                    style={{ width: 20, height: 20, bottom: `${hiPct}%` }}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden className="q-slider__thumb-shape absolute-full">
                      <path d="M 4, 10 a 6,6 0 1,0 12,0 a 6,6 0 1,0 -12,0" />
                    </svg>
                  </div>
                </>
              ) : (
                <div
                  className="q-slider__thumb q-slider__thumb--v q-slider__thumb--v-rtl absolute non-selectable text-secondary"
                  style={{ width: 20, height: 20, bottom: `${pct}%` }}
                >
                  <svg viewBox="0 0 20 20" aria-hidden className="q-slider__thumb-shape absolute-full">
                    <path d="M 4, 10 a 6,6 0 1,0 12,0 a 6,6 0 1,0 -12,0" />
                  </svg>
                  <div className="q-slider__focus-ring fit" />
                </div>
              )}
            </div>
          </div>
        </div>
        <i className="q-icon mdi mdi-speedometer" style={{ fontSize: 24 }} aria-hidden />
      </div>
    </div>
  );
}

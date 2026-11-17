import type { ShockerView } from '../components/ShockerCard';
import type { DiscordParticipant, ParticipantStatus } from '../participants';

/**
 * Builds the controllable shocker list for the selected friends from their server-reported
 * status. UI gating only (the server re-enforces everything): an engaged e-stop or a paused
 * device disables every mode, and ceilings are clamped to the device maximum.
 */
export function buildFriendShockers(
  selectedTargetIds: string[],
  participantStatus: Record<string, ParticipantStatus>,
  participants: DiscordParticipant[],
  livePausedIds: ReadonlySet<number>,
): ShockerView[] {
  if (!selectedTargetIds.length) return [];
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
}

import type { AuthState } from '../discord';
import type { PersonalLimits } from '../components/ActivityLimitsSettings';
import type { QueuePanelItem, QueuePanelSettings } from '../components/QueuePanel';

export type MeResponse = {
  user: AuthState['user'];
  consent: boolean;
  pishockLinked: boolean;
  pishockUserId: number | null;
  pishockUsername?: string | null;
  pishockAvatarUrl?: string | null;
  pishockBannerUrl?: string | null;
  personal?: PersonalLimits;
  emergencyStopShockerIds?: number[];
  commandQueueEnabled?: boolean;
  /** Shows the admin bypass toggle; the server re-checks on every command. */
  isAdmin?: boolean;
};

export type QueueState = QueuePanelSettings & {
  paused: boolean;
  halted: boolean;
  active: QueuePanelItem | null;
  waiting: QueuePanelItem[];
  next: QueuePanelItem | null;
  nextStartsInMs: number | null;
  nextEstimatedStartAt: number | null;
};

export type SenderQueueTicket = {
  ownerDiscordUserId: string;
  itemId: string;
  status: string;
  position: number | null;
  paused: boolean;
  estimatedWaitMs: number | null;
  estimatedStartAt: number | null;
  at: number;
};

export type DevicesResponse = {
  hubs: Array<Record<string, unknown>>;
  shockers: Array<Record<string, unknown>>;
  shared: Array<Record<string, unknown>>;
  online: Record<string, boolean>;
};

export type Overlay =
  | null
  | 'menu'
  | 'availability'
  | 'settings'
  | 'shares'
  | 'logs'
  | 'link'
  | 'logPrivacy'
  | 'safety'
  | 'myData'
  | 'history';

export type LegalView = null | 'terms' | 'privacy';

export type PendingLinkConfirm = {
  pishockUserId: number;
  pishockUsername?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  hubNames: string[];
};

export type PendingApiKeyReveal = {
  apiKey: string;
  apiKeyName: string;
  expiresAt?: string | null;
  pishockUsername?: string | null;
};

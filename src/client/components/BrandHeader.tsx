import markUrl from '../assets/pishock-mark.png';
import { AppVersionBadge } from './AppVersionBadge';

type Props = {
  /** Small caption under the wordmark (e.g. "Discord Activity", "Setup · 1/3") */
  sub?: string;
  /** Optional mdi icon name shown as a context badge on the logo (e.g. "mdi-key-variant") */
  badgeIcon?: string;
  /** Animate the logo glow (cyan ↔ yellow) while something is in progress */
  pulse?: boolean;
  /** Smaller variant for headers that sit above dense content */
  compact?: boolean;
  className?: string;
};

/** PiShock logo tile + wordmark used on boot, setup and pre-controller screens */
export function BrandHeader({ sub, badgeIcon, pulse, compact, className }: Props) {
  return (
    <div
      className={`ps-brand${compact ? ' ps-brand--compact' : ''}${className ? ` ${className}` : ''}`}
    >
      <div className={`ps-brand__mark${pulse ? ' ps-brand__mark--pulse' : ''}`} aria-hidden>
        <img className="ps-brand__logo" src={markUrl} alt="" draggable={false} />
        {badgeIcon ? (
          <span className="ps-brand__badge">
            <i className={`q-icon mdi ${badgeIcon}`} />
          </span>
        ) : null}
      </div>
      <h1 className="ps-brand__title">
        <span className="ps-brand__name">
          Pi<span>Shock</span>
        </span>
        <AppVersionBadge />
      </h1>
      {sub ? <p className="ps-brand__sub">{sub}</p> : null}
    </div>
  );
}

/** Small inline logo for dialog headers */
export function BrandGlyph({ size = 20 }: { size?: number }) {
  return (
    <img
      className="ps-brand-glyph"
      src={markUrl}
      alt=""
      aria-hidden
      draggable={false}
      width={size}
      height={size}
    />
  );
}

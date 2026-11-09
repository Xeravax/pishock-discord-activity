import { useState } from 'react';

type Props = {
  onAccept: () => void;
  busy?: boolean;
  onOpenTerms?: () => void;
  onOpenPrivacy?: () => void;
};

const SAFETY_ITEMS = [
  'I accept full responsibility for safe use and understand my actions will deliver real electronic shocks to other users',
  'I understand device owners can block me and developers cannot override these blocks or restore my access',
  'I understand this controls real electronic shock devices physically attached to other users',
  'I understand developers bear no liability for any harm, injury, or adverse effects from using this application',
  'I confirm voluntary participation with full knowledge of risks',
];

export function SafetyWarning({ onAccept, busy, onOpenTerms, onOpenPrivacy }: Props) {
  const [acknowledged, setAcknowledged] = useState<boolean[]>(() => SAFETY_ITEMS.map(() => false));
  const allAcknowledged = acknowledged.every(Boolean);

  const toggle = (index: number) => {
    setAcknowledged((prev) => prev.map((v, i) => (i === index ? !v : v)));
  };

  return (
    <section className="safety-gate">
      <div className="safety-gate-card">
        <div className="safety-gate-header">
          <div className="safety-gate-icon" aria-hidden>
            ⚠
          </div>
          <h1>Safety Warning</h1>
          <p>
            This application controls electrical shock devices. Read and acknowledge these terms
            to proceed.
          </p>
        </div>

        <div className="safety-gate-list">
          {SAFETY_ITEMS.map((item, index) => (
            <label key={item} className="safety-gate-item">
              <input
                type="checkbox"
                checked={acknowledged[index]}
                onChange={() => toggle(index)}
              />
              <span>{item}</span>
            </label>
          ))}
        </div>

        <div className="safety-gate-important">
          <strong>Important:</strong> Use at your own risk. Developers assume no responsibility
          for harm or injury. You must be 18+, obtain explicit consent, establish safe words /
          emergency stop procedures, start at the lowest intensity, and comply with local laws.
        </div>

        <div className="safety-gate-links">
          {onOpenTerms ? (
            <button type="button" className="btn secondary" onClick={onOpenTerms}>
              Terms of Service
            </button>
          ) : null}
          {onOpenPrivacy ? (
            <button type="button" className="btn secondary" onClick={onOpenPrivacy}>
              Privacy Policy
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className="btn accent safety-gate-accept"
          disabled={!allAcknowledged || busy}
          onClick={onAccept}
        >
          I Acknowledge and Accept All Terms
        </button>
      </div>
    </section>
  );
}

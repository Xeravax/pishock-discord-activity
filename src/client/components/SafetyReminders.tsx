export function SafetyReminders({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="official-safety-banner">
        <div className="row items-center no-wrap justify-center q-gutter-xs">
          <i className="q-icon mdi mdi-shield-alert-outline" aria-hidden style={{ fontSize: 14 }} />
          <div className="text-caption ellipsis official-safety-banner__text">
            <strong>Safety</strong>
            <span className="official-safety-banner__sep">·</span>
            start low
            <span className="official-safety-banner__sep">·</span>
            keep STOP ready
            <span className="official-safety-banner__sep">·</span>
            actions are logged
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="safety-reminders">
      <div className="safety-reminders-inner">
        <span className="safety-reminders-icon" aria-hidden>
          ⚠
        </span>
        <div>
          <h3>Safety Reminders</h3>
          <div className="safety-reminders-grid">
            <span>• Always ensure explicit consent</span>
            <span>• Start with lowest intensity</span>
            <span>• Have emergency procedures ready</span>
            <span>• All actions are publicly logged</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SafetyNotice() {
  return (
    <div className="q-card q-card--dark q-dark q-pa-md" style={{ border: '1px solid rgba(229,57,53,.45)' }}>
      <div className="row items-center q-gutter-sm q-mb-sm">
        <i className="q-icon mdi mdi-alert text-negative" aria-hidden />
        <span className="text-negative text-subtitle2">Safety Notice</span>
      </div>
      <p className="text-body2" style={{ color: '#ffc9c9', margin: 0 }}>
        This application controls electrical shock devices. Only use with explicit consent, proper
        safety measures, and in compliance with all applicable laws.
      </p>
    </div>
  );
}

type Props = {
  active: boolean;
  onToggle: () => void;
  title?: string;
  compact?: boolean;
};

/** Soft pill toggle for multishock selection. */
export function MultiShockToggle({
  active,
  onToggle,
  title = 'Select several people / shockers and operate them together',
  compact,
}: Props) {
  return (
    <button
      type="button"
      className={`multi-shock-toggle${active ? ' is-on' : ''}${compact ? ' is-compact' : ''}`}
      onClick={onToggle}
      title={title}
      aria-pressed={active}
    >
      <i className="q-icon mdi mdi-checkbox-multiple-marked-outline" aria-hidden />
      <span>Multi</span>
    </button>
  );
}

/** Soft pill toggle for per-person shock intensity while Multi is on. */
export function IndividualIntensityToggle({
  active,
  onToggle,
  title = 'Set shock intensity separately for each selected person',
  compact,
}: Props) {
  return (
    <button
      type="button"
      className={`multi-shock-toggle multi-shock-toggle--indiv${active ? ' is-on' : ''}${
        compact ? ' is-compact' : ''
      }`}
      onClick={onToggle}
      title={title}
      aria-pressed={active}
    >
      <i className="q-icon mdi mdi-account-edit" aria-hidden />
      <span>Each</span>
    </button>
  );
}

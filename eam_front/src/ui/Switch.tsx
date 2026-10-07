/** An on/off switch, announced as one. */
export function Switch({ label, on, disabled, onChange }: { label: string; on: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={'relative h-6 w-10 flex-none rounded-full transition disabled:opacity-50 ' + (on ? 'bg-good' : 'bg-line-strong')}
    >
      <span className={'absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all ' + (on ? 'left-[19px]' : 'left-[3px]')} />
    </button>
  );
}

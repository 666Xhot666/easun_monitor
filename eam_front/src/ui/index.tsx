import type { ButtonHTMLAttributes, ReactNode } from 'react';

const cx = (...parts: (string | false | undefined)[]) =>
  parts.filter((part): part is string => part !== false && part !== undefined).join(' ');

interface CardProps {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div';
}

/** A bordered surface that groups one topic. */
export function Card({ children, className, as = 'section' }: CardProps) {
  const classes = cx('rounded-xl border border-line bg-surface p-5', className);

  if (as === 'div') {
    return <div className={classes}>{children}</div>;
  }

  return <section className={classes}>{children}</section>;
}

interface CardTitleProps {
  children: ReactNode;
  hint?: ReactNode;
}

/** A card's heading, with an optional quiet hint after it. */
export function CardTitle({ children, hint }: CardTitleProps) {
  return (
    <h2 className="text-[15px] font-semibold text-ink">
      {children}
      {hint ? <span className="ml-2 text-xs font-normal text-muted">{hint}</span> : null}
    </h2>
  );
}

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

/** The page's title and subtitle, with actions on the right. */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft';
  size?: 'sm' | 'md';
}

/** A button in one of the app variants; type="button" unless given. */
export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50';
  const sizeClasses = size === 'md' ? 'h-10 px-4 text-sm' : 'h-8 px-3 text-[13px]';
  const variantClasses = {
    primary: 'bg-ink text-page hover:opacity-90',
    secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
    ghost: 'text-ink hover:bg-surface-2',
    danger: 'bg-crit text-white hover:opacity-90',
    'danger-soft': 'border border-crit-line bg-crit-bg text-crit-ink hover:opacity-90',
  }[variant];

  return <button type={type} className={cx(base, sizeClasses, variantClasses, className)} {...rest} />;
}

interface SegmentedProps<T extends string> {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}

/** A segmented control: one choice of a few, as a radio group. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  disabled,
}: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex flex-wrap gap-0.5 rounded-[9px] bg-surface-2 p-[3px]">
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cx(
              'rounded-md px-3 font-medium transition',
              size === 'md' ? 'min-h-[34px] text-[13px]' : 'min-h-[28px] text-xs',
              selected ? 'bg-sel text-on-sel shadow-sm' : 'text-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface BadgeProps {
  tone?: 'neutral' | 'good' | 'warn' | 'crit';
  children: ReactNode;
}

/** A small rounded label, neutral or in a status tone. */
export function Badge({ tone = 'neutral', children }: BadgeProps) {
  const toneClasses = {
    neutral: 'bg-surface-2 text-muted',
    good: 'bg-good-bg text-good-ink',
    warn: 'bg-warn-bg text-warn-ink',
    crit: 'bg-crit-bg text-crit-ink',
  }[tone];

  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', toneClasses)}>
      {children}
    </span>
  );
}

interface DotProps {
  tone: 'good' | 'warn' | 'crit' | 'idle';
}

/** A small status dot, hidden from screen readers. */
export function Dot({ tone }: DotProps) {
  const toneClasses = {
    good: 'bg-good',
    warn: 'bg-warn',
    crit: 'bg-crit',
    idle: 'bg-idle',
  }[tone];

  return <span aria-hidden="true" className={cx('inline-block h-2 w-2 flex-none rounded-full', toneClasses)} />;
}

interface StatProps {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
}

/** A labelled figure with an optional unit and line under it. */
export function Stat({ label, value, unit, sub }: StatProps) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
        {value}
        {unit ? <span className="ml-1 text-xs font-normal text-muted">{unit}</span> : null}
      </p>
      {sub ? <p className="text-xs text-muted">{sub}</p> : null}
    </div>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}

/** What a page shows instead of content: what is missing and what to do. */
export function EmptyState({ icon, title, children, action }: EmptyStateProps) {
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-line bg-surface p-7">
      {icon ? <div className="mb-3 text-ink">{icon}</div> : null}
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {children ? <div className="mt-2 text-sm leading-relaxed text-muted">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

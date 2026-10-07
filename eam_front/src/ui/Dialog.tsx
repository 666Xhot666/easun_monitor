import { useEffect, useId, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  title: ReactNode;
  children?: ReactNode;
  /** The buttons, right-aligned under the content. */
  actions: ReactNode;
  /** Esc and a click outside call this. */
  onClose: () => void;
  width?: number;
}

/** A modal dialog: focus moves into it, Esc or a click on the backdrop closes it. */
export function Dialog({ open, title, children, actions, onClose, width = 480 }: DialogProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    panel.current?.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ maxWidth: width }}
        className="flex w-full flex-col gap-3.5 rounded-[14px] border border-line bg-surface p-6 text-ink shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {children && <div className="text-sm leading-relaxed text-muted">{children}</div>}
        <div className="flex flex-wrap justify-end gap-2">{actions}</div>
      </div>
    </div>
  );
}

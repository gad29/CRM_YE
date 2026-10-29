'use client';

// Modal, side drawer and dropdown menu. All close on Escape and on a click
// outside, return focus to what opened them, and lock page scroll while open.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconX } from '@/components/ui/icons';

function useOverlay(onClose: () => void) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);
}

function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size,
  head,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'wide' | 'narrow';
  /** Extra content in the header (e.g. wizard steps). */
  head?: ReactNode;
}) {
  useOverlay(onClose);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Focus the first field, else the dialog itself.
    const first = panel.current?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea, button:not(.icon-button)');
    (first ?? panel.current)?.focus();
  }, []);
  return (
    <Portal>
      <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div ref={panel} className={`modal ${size ?? ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
          <div className="modal-head">
            <div style={{ display: 'grid', gap: 8 }}>
              <div className="modal-title">{title}</div>
              {subtitle && <div className="muted small">{subtitle}</div>}
              {head}
            </div>
            <button type="button" className="icon-button small" onClick={onClose} aria-label="סגירה">
              <IconX size={16} />
            </button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

export function Drawer({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useOverlay(onClose);
  return (
    <Portal>
      <div className="overlay side" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <aside className="drawer" role="dialog" aria-modal="true">
          <div className="modal-head">
            <div className="modal-title">{title}</div>
            <button type="button" className="icon-button small" onClick={onClose} aria-label="סגירה">
              <IconX size={16} />
            </button>
          </div>
          <div className="modal-body" style={{ flex: 1 }}>{children}</div>
          {footer && <div className="modal-foot" style={{ borderRadius: 0 }}>{footer}</div>}
        </aside>
      </div>
    </Portal>
  );
}

/** A button that opens a small menu of actions. */
export function Menu({ trigger, children, label }: { trigger: ReactNode; children: ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={wrap}>
      <button type="button" className="icon-button" aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {trigger}
      </button>
      {open && (
        <div className="menu" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

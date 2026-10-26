import { useEffect, useRef } from 'react';
import type { Toast } from '../lib/types';

interface Props {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

export function ToastStack({ toasts, onDismiss }: Props) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    timer.current = window.setTimeout(() => onDismiss(toast.id), toast.kind === 'error' ? 7000 : 4000);
    return () => window.clearTimeout(timer.current);
  }, [toast.id, toast.kind, onDismiss]);

  return (
    <div className={`toast toast-${toast.kind}`}>
      <div className="toast-body">
        <strong>{toast.title}</strong>
        {toast.text && <span>{toast.text}</span>}
      </div>
      <button className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="Закрыть">
        ×
      </button>
    </div>
  );
}

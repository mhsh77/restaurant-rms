import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, Bell, X } from 'lucide-react';

const ToastContext = createContext(null);
let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (kind, message, { timeout = kind === 'error' ? 6000 : 3500, onClick } = {}) => {
      const id = nextId++;
      setToasts((list) => [...list.slice(-4), { id, kind, message, onClick }]);
      if (timeout) setTimeout(() => dismiss(id), timeout);
    },
    [dismiss],
  );

  const api = useMemo(
    () => ({
      success: (m, o) => push('success', m, o),
      error: (m, o) => push('error', m, o),
      notify: (m, o) => push('notify', m, o),
    }),
    [push],
  );

  const icons = { success: CheckCircle2, error: AlertTriangle, notify: Bell };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = icons[t.kind];
          return (
            <div key={t.id} className={`toast toast-${t.kind}`}>
              <button
                type="button"
                className="toast-body"
                onClick={() => {
                  t.onClick?.();
                  dismiss(t.id);
                }}
              >
                <Icon size={20} aria-hidden />
                <span>{t.message}</span>
              </button>
              <button type="button" className="toast-close" onClick={() => dismiss(t.id)} aria-label="بستن">
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

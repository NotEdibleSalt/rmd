import { useEditorStore } from './store';

export function ToastContainer() {
  const toasts = useEditorStore((s) => s.toasts);
  const removeToast = useEditorStore((s) => s.removeToast);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`} onClick={() => removeToast(t.id)} role="alert">
          {t.type === 'error' && <span className="toast-icon">✕</span>}
          {t.type === 'success' && <span className="toast-icon">✓</span>}
          {t.type === 'info' && <span className="toast-icon">i</span>}
          <span className="toast-message">{t.message}</span>
        </div>
      ))}
    </div>
  );
}

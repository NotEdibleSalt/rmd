import { useCallback, useEffect, useRef } from 'react';

/* ─────────────── Props ─────────────── */

interface SavePromptModalProps {
  /** If provided, overrides the default message */
  message?: string;
  hasFile?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

/* ─────────────── Component ─────────────── */

export function SavePromptModal({ message, hasFile = false, onSave, onDiscard, onCancel }: SavePromptModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus the dialog on mount for keyboard events
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Escape key → cancel
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    },
    [onCancel],
  );

  // Click on backdrop → cancel
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onCancel();
      }
    },
    [onCancel],
  );

  return (
    <div className="dialog-overlay" onClick={handleOverlayClick}>
      <div
        ref={dialogRef}
        className="dialog save-prompt-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="save-prompt-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="dialog-body save-prompt-body">
          {/* Icon */}
          <div className="save-prompt-icon-wrap">
            <svg
              className="save-prompt-icon"
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
              <path d="M14 2v6h6" />
              <circle cx="12" cy="16" r="2" />
              <path d="M12 10v4" />
            </svg>
          </div>

          {/* Title */}
          <h2 id="save-prompt-title" className="save-prompt-title">
            未保存的更改
          </h2>

          {/* Message */}
          <p className="save-prompt-message">
            {message ?? (hasFile
              ? '文档有未保存的更改，要保存吗？'
              : '当前文档未保存，关闭将丢失所有更改。')}
          </p>
        </div>

        {/* Footer with actions */}
        <div className="dialog-footer save-prompt-footer">
          <button className="btn save-prompt-btn discard-btn" onClick={onDiscard}>
            不保存
          </button>
          <button className="btn save-prompt-btn cancel-btn" onClick={onCancel}>
            取消
          </button>
          <button className="btn btn-primary save-prompt-btn save-btn" onClick={onSave} autoFocus>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

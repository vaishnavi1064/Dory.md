import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { deleteAccount } from '@/lib/api';
import { clearTokens } from '@/lib/tokens';

interface DeleteAccountModalProps {
  onClose: () => void;
}

const CONFIRM_WORD = 'DELETE';

export function DeleteAccountModal({ onClose }: DeleteAccountModalProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus the confirmation input when the modal opens.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const confirmed = value === CONFIRM_WORD;

  async function handleConfirm() {
    if (!confirmed || busy) return;
    setBusy(true);
    setError('');
    try {
      await deleteAccount();
      // Match the app's logout teardown, then hard-redirect so React/Auth state
      // is fully reset. `replace` keeps the dead session out of history.
      clearTokens();
      localStorage.removeItem('dory-session');
      window.location.replace('/login?deleted=1');
    } catch {
      setError('Something went wrong. Please try again or contact support.');
      setBusy(false);
    }
  }

  // Escape closes only when the input is empty, so a typed "DELETE" isn't lost
  // by accident. Tab is trapped within the modal for keyboard accessibility.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      if (value.length === 0 && !busy) onClose();
      return;
    }
    if (e.key === 'Tab' && panelRef.current) {
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input, [href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
      onKeyDown={onKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-title"
    >
      <div ref={panelRef} className="app-card flex w-full max-w-md flex-col shadow-[var(--shadow)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] text-[var(--danger)]">
              <AlertTriangle size={20} />
            </span>
            <h3 id="delete-account-title" className="font-bold text-[var(--text-1)]">Delete your account?</h3>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost h-8 w-8 p-0" title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 px-5 py-5">
          <p className="text-sm leading-6 text-[var(--text-2)]">
            This permanently deletes your account, all your notes, all your review history, and all data
            Dory has about you. We cannot recover it. This action is final.
          </p>
          <p className="text-sm font-bold text-[var(--text-2)]">Type DELETE below to confirm.</p>
          <input
            ref={inputRef}
            className="corp-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Type DELETE to confirm"
            aria-label="Type DELETE to confirm"
            autoComplete="off"
            spellCheck={false}
          />
          {error && (
            <p className="text-sm font-bold text-[var(--danger)]">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={handleConfirm}
            disabled={!confirmed || busy}
            aria-label="Delete account permanently"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {busy ? 'Deleting…' : 'Delete account permanently'}
          </button>
        </div>
      </div>
    </div>
  );
}

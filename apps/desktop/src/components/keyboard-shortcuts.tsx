import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Centralized keyboard shortcut manager.
 * Mount once in the Shell component.
 */
export default function KeyboardShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    function isInputFocused(e: KeyboardEvent): boolean {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if ((e.target as HTMLElement)?.isContentEditable) return true;
      return false;
    }

    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;

      // Cmd+, — settings
      if (meta && !e.shiftKey && e.key === ',') {
        e.preventDefault();
        navigate('/settings');
        return;
      }

      // Cmd+F — focus search
      if (meta && !e.shiftKey && e.key === 'f') {
        window.dispatchEvent(new CustomEvent('codevetter:focus-search'));
        return;
      }

      if (isInputFocused(e)) return;
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  return null;
}

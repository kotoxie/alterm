import { useMemo, useRef, useState, useCallback } from 'react';

// ─── Char → keyboard code mapping ─────────────────────────────────────────────
// Maps a printable character to the US-QWERTY KeyboardEvent.code and whether
// Shift is required.  These codes match the CODE_TO_SCANCODE table in
// RdpSession.tsx, so the RDP handler will produce the correct scancode.

interface KeyInfo { code: string; shift: boolean }

function charToKeyInfo(char: string): KeyInfo | null {
  if (char >= 'a' && char <= 'z') return { code: 'Key' + char.toUpperCase(), shift: false };
  if (char >= 'A' && char <= 'Z') return { code: 'Key' + char,               shift: true  };
  if (char >= '0' && char <= '9') return { code: 'Digit' + char,             shift: false };
  if (char === ' ')  return { code: 'Space',  shift: false };
  if (char === '\n' || char === '\r') return { code: 'Enter', shift: false };
  if (char === '\t') return { code: 'Tab',    shift: false };

  // Unshifted punctuation (US layout)
  const unshifted: Record<string, string> = {
    '-': 'Minus', '=': 'Equal',
    '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash',
    ';': 'Semicolon', "'": 'Quote',
    ',': 'Comma', '.': 'Period', '/': 'Slash', '`': 'Backquote',
  };
  if (unshifted[char]) return { code: unshifted[char], shift: false };

  // Shifted punctuation (US layout)
  const shifted: Record<string, string> = {
    '!': 'Digit1', '@': 'Digit2', '#': 'Digit3', '$': 'Digit4', '%': 'Digit5',
    '^': 'Digit6', '&': 'Digit7', '*': 'Digit8', '(': 'Digit9', ')': 'Digit0',
    '_': 'Minus',  '+': 'Equal',
    '{': 'BracketLeft', '}': 'BracketRight', '|': 'Backslash',
    ':': 'Semicolon', '"': 'Quote',
    '<': 'Comma', '>': 'Period', '?': 'Slash', '~': 'Backquote',
  };
  if (shifted[char]) return { code: shifted[char], shift: true };

  return null; // unknown / non-Latin-keyboard char
}

// Named keys that map directly to a code (no char needed)
const NAMED_KEY_CODES: Record<string, string> = {
  Backspace: 'Backspace',
  Enter:     'Enter',
  Tab:       'Tab',
  Escape:    'Escape',
  Delete:    'Delete',
  Home:      'Home',
  End:       'End',
  Insert:    'Insert',
  ArrowLeft:  'ArrowLeft',
  ArrowRight: 'ArrowRight',
  ArrowUp:    'ArrowUp',
  ArrowDown:  'ArrowDown',
};

// Dispatch a synthetic KeyboardEvent on window.
// The RDP onKey capture-phase listener on window will receive it.
// The whitelist in RdpSession allows events through when the active element
// has data-mobile-keyboard="true".
function dispatchSynthetic(code: string, key: string, down: boolean, shiftKey = false) {
  window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', {
    bubbles: true, cancelable: true, composed: true,
    code, key, shiftKey,
  }));
}

// Send a printable character to RDP via synthetic keyboard events.
// If the char requires Shift (uppercase, symbols), send Shift down+up around the key.
function sendCharToRdp(char: string) {
  const info = charToKeyInfo(char);
  if (!info) return;

  if (info.shift) {
    dispatchSynthetic('ShiftLeft', 'Shift', true,  true);
  }
  dispatchSynthetic(info.code, char, true,  info.shift);
  dispatchSynthetic(info.code, char, false, info.shift);
  if (info.shift) {
    dispatchSynthetic('ShiftLeft', 'Shift', false, false);
  }
}

// ─── Keyboard icon ─────────────────────────────────────────────────────────────

function IconKeyboard() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" ry="2" />
      <line x1="6"  y1="10" x2="6"  y2="10" strokeWidth="3" />
      <line x1="10" y1="10" x2="10" y2="10" strokeWidth="3" />
      <line x1="14" y1="10" x2="14" y2="10" strokeWidth="3" />
      <line x1="18" y1="10" x2="18" y2="10" strokeWidth="3" />
      <line x1="6"  y1="14" x2="6"  y2="14" strokeWidth="3" />
      <line x1="18" y1="14" x2="18" y2="14" strokeWidth="3" />
      <line x1="10" y1="14" x2="14" y2="14" strokeWidth="3" />
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const SENTINEL = 'x';

interface RdpMobileKeyboardProps {
  /** Pass true only while RDP is fully connected. */
  connected: boolean;
}

export function RdpMobileKeyboard({ connected }: RdpMobileKeyboardProps) {
  // Reliable touch-device detection: (pointer: coarse) means the primary pointer
  // is a finger/stylus.  navigator.maxTouchPoints is unreliable on Windows 11
  // Edge even without a physical touchscreen.  useMemo is synchronous so the
  // component returns null on first render for non-touch — no flash.
  const isTouch = useMemo(() => window.matchMedia('(pointer: coarse)').matches, []);
  const [active, setActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (!isTouch) return null;

  // ── Key forwarding ────────────────────────────────────────────────────────

  // keydown: fires reliably for named keys (Backspace, Enter, arrows) on mobile.
  // We call preventDefault() to stop the textarea content from changing —
  // this prevents a duplicate dispatch via the input handler.
  // The NATIVE keydown event still bubbles to window so RDP's capture-phase
  // listener handles it directly (whitelisted by data-mobile-keyboard).
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (NAMED_KEY_CODES[e.key]) {
      // Stop the default action (e.g. delete char in textarea, move focus for Tab).
      // The native DOM event still propagates to window → RDP handles it.
      e.preventDefault();
    }
    // For 'Unidentified' keys (printable chars on Android IME): do nothing here;
    // the input event extracts the char and sends it via synthetic events.
  }, []);

  // input: fires for every actual content change in the textarea.
  // On mobile IME, printable chars land here (keydown has key='Unidentified').
  // We diff against the sentinel, extract new chars, and dispatch synthetic events.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;

    const current = el.value;

    if (current.length > SENTINEL.length) {
      // New characters typed (IME/predictive text committed)
      const added = current.slice(SENTINEL.length);
      for (const char of added) {
        sendCharToRdp(char);
      }
    }
    // Reset to sentinel; named-key deletions are prevented in keydown so we
    // should never see length < SENTINEL.length, but reset handles it anyway.
    el.value = SENTINEL;
    el.setSelectionRange(SENTINEL.length, SENTINEL.length);
  }, []);

  // ── Toggle ────────────────────────────────────────────────────────────────

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const toggleKeyboard = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (active) {
      el.blur();
      setActive(false);
    } else {
      el.value = SENTINEL;
      el.focus();
      el.setSelectionRange(SENTINEL.length, SENTINEL.length);
      setActive(true);
    }
  }, [active]);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const handleBlur = useCallback(() => setActive(false), []);

  return (
    <>
      {/*
        data-mobile-keyboard="true" — this attribute is the whitelist token read
        by RdpSession's onKey handler.  When document.activeElement is this
        textarea and it carries this attribute, the RDP handler does NOT skip
        the event (whereas it normally skips all INPUT/TEXTAREA elements).

        The textarea must be in the visible viewport (iOS requirement) but
        visually hidden.  font-size:16px prevents iOS page zoom on focus.
      */}
      <textarea
        ref={textareaRef}
        defaultValue={SENTINEL}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        onBlur={handleBlur}
        data-mobile-keyboard="true"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        aria-hidden="true"
        tabIndex={-1}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '1px',
          height: '1px',
          opacity: 0,
          fontSize: '16px',
          border: 'none',
          outline: 'none',
          padding: 0,
          pointerEvents: 'none',
        }}
      />

      <button
        onClick={toggleKeyboard}
        disabled={!connected}
        title={active ? 'Hide keyboard' : 'Show keyboard'}
        aria-label={active ? 'Hide keyboard' : 'Show keyboard'}
        className={`
          absolute bottom-4 left-1/2 -translate-x-1/2
          flex items-center justify-center
          w-12 h-12 rounded-full shadow-lg z-10
          transition-colors duration-150
          disabled:opacity-30 disabled:pointer-events-none
          ${active
            ? 'bg-accent text-white ring-2 ring-accent/50'
            : 'bg-black/60 text-gray-300 hover:bg-black/80 hover:text-white'}
        `}
      >
        <IconKeyboard />
      </button>
    </>
  );
}

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Tab } from '../pages/MainLayout';
import { useAuth } from '../hooks/useAuth';

let rdpInitialized = false;
let Backend: Record<string, unknown> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let displayControl: ((enable: boolean) => any) | null = null;

async function initRdp() {
  if (rdpInitialized) return;
  const rdpModule = await import('@devolutions/iron-remote-desktop-rdp');
  await rdpModule.init('info');
  Backend = rdpModule.Backend as Record<string, unknown>;
  displayControl = rdpModule.displayControl;
  rdpInitialized = true;
}

// PS/2 Set-1 scancode → KeyboardEvent.code mapping
const SCANCODE_TO_CODE: Record<number, string> = {
  0x0001:'Escape',0x0002:'Digit1',0x0003:'Digit2',0x0004:'Digit3',0x0005:'Digit4',
  0x0006:'Digit5',0x0007:'Digit6',0x0008:'Digit7',0x0009:'Digit8',0x000A:'Digit9',
  0x000B:'Digit0',0x000C:'Minus',0x000D:'Equal',0x000E:'Backspace',0x000F:'Tab',
  0x0010:'KeyQ',0x0011:'KeyW',0x0012:'KeyE',0x0013:'KeyR',0x0014:'KeyT',
  0x0015:'KeyY',0x0016:'KeyU',0x0017:'KeyI',0x0018:'KeyO',0x0019:'KeyP',
  0x001A:'BracketLeft',0x001B:'BracketRight',0x001C:'Enter',0x001D:'ControlLeft',
  0x001E:'KeyA',0x001F:'KeyS',0x0020:'KeyD',0x0021:'KeyF',0x0022:'KeyG',
  0x0023:'KeyH',0x0024:'KeyJ',0x0025:'KeyK',0x0026:'KeyL',0x0027:'Semicolon',
  0x0028:'Quote',0x0029:'Backquote',0x002A:'ShiftLeft',0x002B:'Backslash',
  0x002C:'KeyZ',0x002D:'KeyX',0x002E:'KeyC',0x002F:'KeyV',0x0030:'KeyB',
  0x0031:'KeyN',0x0032:'KeyM',0x0033:'Comma',0x0034:'Period',0x0035:'Slash',
  0x0036:'ShiftRight',0x0037:'NumpadMultiply',0x0038:'AltLeft',0x0039:'Space',
  0x003A:'CapsLock',0x003B:'F1',0x003C:'F2',0x003D:'F3',0x003E:'F4',
  0x003F:'F5',0x0040:'F6',0x0041:'F7',0x0042:'F8',0x0043:'F9',0x0044:'F10',
  0x0045:'Pause',0x0046:'ScrollLock',0x0047:'Numpad7',0x0048:'Numpad8',
  0x0049:'Numpad9',0x004A:'NumpadSubtract',0x004B:'Numpad4',0x004C:'Numpad5',
  0x004D:'Numpad6',0x004E:'NumpadAdd',0x004F:'Numpad1',0x0050:'Numpad2',
  0x0051:'Numpad3',0x0052:'Numpad0',0x0053:'NumpadDecimal',0x0056:'IntlBackslash',
  0x0057:'F11',0x0058:'F12',0x0059:'NumpadEqual',
  0x0064:'F13',0x0065:'F14',0x0066:'F15',0x0067:'F16',0x0068:'F17',
  0x0069:'F18',0x006A:'F19',0x006B:'F20',0x006C:'F21',0x006D:'F22',
  0x006E:'F23',0x0070:'KanaMode',0x0071:'Lang2',0x0072:'Lang1',0x0073:'IntlRo',
  0x0076:'F24',0x0079:'Convert',0x007B:'NonConvert',0x007D:'IntlYen',0x007E:'NumpadComma',
  0xE010:'MediaTrackPrevious',0xE019:'MediaTrackNext',0xE01C:'NumpadEnter',
  0xE01D:'ControlRight',0xE022:'MediaPlayPause',0xE024:'MediaStop',
  0xE032:'BrowserHome',0xE035:'NumpadDivide',0xE037:'PrintScreen',
  0xE038:'AltRight',0xE045:'NumLock',0xE047:'Home',0xE048:'ArrowUp',
  0xE049:'PageUp',0xE04B:'ArrowLeft',0xE04D:'ArrowRight',0xE04F:'End',
  0xE050:'ArrowDown',0xE051:'PageDown',0xE052:'Insert',0xE053:'Delete',
  0xE05B:'MetaLeft',0xE05C:'MetaRight',0xE05D:'ContextMenu',
  0xE06C:'LaunchMail',0xE020:'AudioVolumeMute',0xE02E:'AudioVolumeDown',0xE030:'AudioVolumeUp',
};
const CODE_TO_SCANCODE: Record<string, number> = Object.fromEntries(
  Object.entries(SCANCODE_TO_CODE).map(([sc, code]) => [code, Number(sc)])
);

const RESIZE_DEBOUNCE_MS = 150;

// Keys locked via Keyboard Lock API when in fullscreen.
// This lets the browser forward shortcuts it would normally intercept
// (Ctrl+Tab, Ctrl+W, Ctrl+T, F11, etc.) to our keydown handler instead.
// OS-level shortcuts (Alt+Tab, Win+R, Win+D) remain with the OS regardless.
const KEYBOARD_LOCK_KEYS = [
  'Tab', 'Escape', 'MetaLeft', 'MetaRight',
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
];

interface RdpSessionProps {
  tab: Tab;
  onStatusChange: (tabId: string, status: Tab['status']) => void;
  onClose: (tabId: string) => void;
}

export function RdpSession({ tab, onStatusChange, onClose }: RdpSessionProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionRef = useRef<any>(null);
  const { token } = useAuth();
  const [status, setStatus] = useState<string>('Initializing...');
  const [disconnected, setDisconnected] = useState(false);
  const [disconnectMessage, setDisconnectMessage] = useState('');
  const [reconnectCount, setReconnectCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // ── Fullscreen + Keyboard Lock ─────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      outerRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      const inFs = !!document.fullscreenElement;
      setIsFullscreen(inFs);
      if (inFs) {
        // Lock browser-intercepted keys so they pass through to our keydown handler
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (navigator as any).keyboard?.lock(KEYBOARD_LOCK_KEYS).catch(() => {});
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (navigator as any).keyboard?.unlock?.();
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // ── Reconnect handler ──────────────────────────────────────────────────────
  const handleReconnect = useCallback(() => {
    setDisconnected(false);
    setDisconnectMessage('');
    setStatus('Initializing...');
    setReconnectCount((n) => n + 1);
  }, []);

  // ── RDP session ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    const showDisconnect = (msg: string) => {
      setDisconnected(true);
      setDisconnectMessage(msg);
      onStatusChange(tab.id, 'disconnected');
    };

    const run = async () => {
      if (!token || !containerRef.current) return;

      try {
        setStatus('Loading RDP module...');
        await initRdp();
        if (cancelled) return;

        setStatus('Fetching connection info...');
        const sessionRes = await fetch(`/api/v1/connections/${tab.connectionId}/session`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!sessionRes.ok) throw new Error('Failed to fetch connection credentials');
        const sessionInfo: { host: string; port: number; username: string; password: string } =
          await sessionRes.json();
        if (cancelled) return;

        const container = containerRef.current!;
        const canvas = document.createElement('canvas');
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        canvas.tabIndex = 0;
        canvas.width = container.clientWidth || 1280;
        canvas.height = container.clientHeight || 720;
        container.innerHTML = '';
        container.appendChild(canvas);

        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${proto}//${window.location.host}/ws/rdp-raw?token=${encodeURIComponent(token)}&connectionId=${encodeURIComponent(tab.connectionId)}`;

        setStatus('Connecting...');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { SessionBuilder, DesktopSize, ClipboardData } = Backend as any;

        let localClipboardText = '';

        const pushClipboardToGuest = (text: string) => {
          if (!sessionRef.current) return;
          const data = new ClipboardData();
          data.addText('text/plain', text);
          sessionRef.current.onClipboardPaste(data).catch(() => {});
        };

        const syncHostClipboardToGuest = () => {
          navigator.clipboard.readText().then((text) => {
            if (text && text !== localClipboardText) {
              localClipboardText = text;
              pushClipboardToGuest(text);
            }
          }).catch(() => {});
        };

        const session = await new SessionBuilder()
          .username(sessionInfo.username)
          .password(sessionInfo.password)
          .destination(`${sessionInfo.host}:${sessionInfo.port}`)
          .proxyAddress(wsUrl)
          .authToken(token)
          .desktopSize(new DesktopSize(canvas.width, canvas.height))
          .renderCanvas(canvas)
          .setCursorStyleCallbackContext(null)
          .setCursorStyleCallback(
            (kind: string, data: string | undefined, hx: number, hy: number) => {
              if (kind === 'none') {
                canvas.style.cursor = 'none';
              } else if (kind === 'url' && data) {
                canvas.style.cursor = `url(${data}) ${hx} ${hy}, auto`;
              } else {
                canvas.style.cursor = 'default';
              }
            },
          )
          .remoteClipboardChangedCallback((clipData: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            const items = (clipData.items() as any[]) ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
            const textItem = items.find((i: any) => i.mimeType() === 'text/plain'); // eslint-disable-line @typescript-eslint/no-explicit-any
            if (textItem) {
              const text = String(textItem.value());
              localClipboardText = text;
              navigator.clipboard.writeText(text).catch(() => {});
            }
          })
          .forceClipboardUpdateCallback(() => {
            pushClipboardToGuest(localClipboardText);
            syncHostClipboardToGuest();
          })
          .extension(displayControl!(true))
          .connect();

        if (cancelled) {
          session.shutdown();
          return;
        }

        sessionRef.current = session;
        setStatus('Connected');
        onStatusChange(tab.id, 'connected');

        // ── Auto-resize (debounced) ────────────────────────────────────────
        resizeObserver = new ResizeObserver(() => {
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            if (!sessionRef.current || !containerRef.current) return;
            const w = containerRef.current.clientWidth;
            const h = Math.max(containerRef.current.clientHeight, 1);
            if (w <= 0 || h <= 0) return;
            sessionRef.current.resize(w, h);
          }, RESIZE_DEBOUNCE_MS);
        });
        resizeObserver.observe(container);

        // ── Input event wiring ─────────────────────────────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { InputTransaction, DeviceEvent } = Backend as any;

        const applyEvents = (...events: unknown[]) => {
          const tx = new InputTransaction();
          events.forEach((e) => tx.addEvent(e));
          session.applyInputs(tx);
        };

        const onMouseMove = (e: MouseEvent) => {
          const scaleX = canvas.width / canvas.clientWidth;
          const scaleY = canvas.height / canvas.clientHeight;
          applyEvents(DeviceEvent.mouseMove(Math.round(e.offsetX * scaleX), Math.round(e.offsetY * scaleY)));
        };

        let clipboardPermissionRequested = false;
        const onMouseDown = (e: MouseEvent) => {
          canvas.focus();
          e.preventDefault();
          applyEvents(DeviceEvent.mouseButtonPressed(e.button));
          if (e.button === 2) {
            syncHostClipboardToGuest();
          } else if (!clipboardPermissionRequested) {
            clipboardPermissionRequested = true;
            syncHostClipboardToGuest();
          }
        };
        const onMouseUp = (e: MouseEvent) => {
          e.preventDefault();
          applyEvents(DeviceEvent.mouseButtonReleased(e.button));
        };
        const onWheel = (e: WheelEvent) => {
          e.preventDefault();
          const isVertical = Math.abs(e.deltaY) >= Math.abs(e.deltaX);
          const delta = isVertical ? e.deltaY : e.deltaX;
          applyEvents(DeviceEvent.wheelRotations(isVertical, -delta, 0));
        };

        // Keyboard — capture phase so our preventDefault fires before browser shortcuts.
        // Ctrl+C / Ctrl+V are excluded so browser copy/paste events still fire for
        // the clipboard bridge. OS-level shortcuts (Alt+Tab, Win+*) are unreachable
        // from JS; use fullscreen + Keyboard Lock for browser-level ones (Ctrl+Tab etc.).
        const onKey = (e: KeyboardEvent) => {
          // Don't capture keyboard when a text input elsewhere on the page has focus
          // (e.g. the connection modal, search boxes, etc.)
          const active = document.activeElement;
          if (
            active &&
            active !== canvas &&
            (active.tagName === 'INPUT' ||
              active.tagName === 'TEXTAREA' ||
              active.tagName === 'SELECT' ||
              (active as HTMLElement).isContentEditable)
          ) return;

          const isBrowserClipboard =
            (e.code === 'KeyC' || e.code === 'KeyV') && e.ctrlKey && !e.altKey && !e.metaKey;
          if (!isBrowserClipboard) e.preventDefault();

          const pressed = e.type === 'keydown';
          const scancode = CODE_TO_SCANCODE[e.code];
          if (scancode !== undefined) {
            applyEvents(pressed ? DeviceEvent.keyPressed(scancode) : DeviceEvent.keyReleased(scancode));
          } else if (pressed && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            applyEvents(DeviceEvent.unicodePressed(e.key));
          } else if (!pressed && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            applyEvents(DeviceEvent.unicodeReleased(e.key));
          }
        };

        const onBlur = () => session.releaseAllInputs();
        const onWindowFocus = () => syncHostClipboardToGuest();
        const onContextMenu = (e: Event) => e.preventDefault();

        const onCopy = (e: ClipboardEvent) => {
          if (localClipboardText) {
            e.clipboardData?.setData('text/plain', localClipboardText);
            e.preventDefault();
          }
        };

        const onPaste = (e: ClipboardEvent) => {
          const text = e.clipboardData?.getData('text/plain') ?? '';
          if (text) {
            localClipboardText = text;
            pushClipboardToGuest(text);
          }
        };

        canvas.addEventListener('mousemove', onMouseMove);
        canvas.addEventListener('mousedown', onMouseDown);
        canvas.addEventListener('mouseup', onMouseUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        canvas.addEventListener('contextmenu', onContextMenu);
        // Capture phase: our handler runs before the browser acts on shortcuts
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('keyup', onKey, true);
        window.addEventListener('blur', onBlur, false);
        window.addEventListener('focus', onWindowFocus, false);
        document.addEventListener('copy', onCopy, true);
        window.addEventListener('paste', onPaste, false);

        await session.run();

        resizeObserver?.disconnect();
        if (resizeTimer) clearTimeout(resizeTimer);
        canvas.removeEventListener('mousemove', onMouseMove);
        canvas.removeEventListener('mousedown', onMouseDown);
        canvas.removeEventListener('mouseup', onMouseUp);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('contextmenu', onContextMenu);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('keyup', onKey, true);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('focus', onWindowFocus);
        document.removeEventListener('copy', onCopy, true);
        window.removeEventListener('paste', onPaste);

        if (!cancelled) showDisconnect('The remote session has ended.');
      } catch (err) {
        if (!cancelled) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const e = err as any;
          let msg: string;
          if (e && typeof e.kind === 'function') {
            const kindNum: number = e.kind();
            const kindNames: Record<number, string> = {
              0: 'General', 1: 'WrongPassword', 2: 'LogonFailure',
              3: 'AccessDenied', 4: 'RDCleanPath', 5: 'ProxyConnect', 6: 'NegotiationFailure',
            };
            const kindName = kindNames[kindNum] ?? `Unknown(${kindNum})`;
            const backtrace = typeof e.backtrace === 'function' ? e.backtrace() : '';
            msg = `IronError [${kindName}]${backtrace ? ': ' + backtrace : ''}`;
          } else {
            msg = err instanceof Error ? err.message : String(err);
          }
          console.error('[RDP] Session error:', err, msg);
          showDisconnect(msg);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      if (sessionRef.current) {
        try { sessionRef.current.shutdown(); } catch { /* ignore */ }
        sessionRef.current = null;
      }
    };
    // reconnectCount is intentionally included: incrementing it re-runs this effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.connectionId, token, onStatusChange, reconnectCount]);

  return (
    <div ref={outerRef} className="flex flex-col flex-1 bg-black relative overflow-hidden">
      <div ref={containerRef} className="flex-1 w-full" />

      {/* Disconnect overlay */}
      {disconnected && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-20">
          <div className="bg-surface border border-border rounded-xl p-6 shadow-2xl flex flex-col items-center gap-4 w-72">
            <div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <circle cx="12" cy="16" r="0.5" fill="currentColor" />
              </svg>
            </div>
            <div className="text-center">
              <h3 className="text-text-primary font-semibold">Session Disconnected</h3>
              {disconnectMessage && (
                <p className="text-text-secondary text-xs mt-1 break-words max-w-xs">
                  {disconnectMessage}
                </p>
              )}
            </div>
            <div className="flex gap-3 w-full">
              <button
                onClick={() => onClose(tab.id)}
                className="flex-1 py-2 px-3 text-sm border border-border rounded-lg hover:bg-surface-hover text-text-secondary transition-colors"
              >
                Exit
              </button>
              <button
                onClick={handleReconnect}
                className="flex-1 py-2 px-3 text-sm bg-accent text-white rounded-lg hover:bg-accent-hover font-medium transition-colors"
              >
                Reconnect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Right-side flyout panel */}
      {/* Backdrop — closes panel when clicking the session canvas */}
      {panelOpen && (
        <div
          className="absolute inset-0 z-10"
          onClick={() => setPanelOpen(false)}
        />
      )}

      {/* Tab trigger — always visible on the right edge */}
      <button
        onClick={() => setPanelOpen((o) => !o)}
        title="Session controls"
        className="absolute right-0 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center justify-center gap-1.5 w-5 py-3 bg-black/60 hover:bg-black/80 text-gray-400 hover:text-white transition-colors rounded-l-md"
        style={{ writingMode: 'vertical-rl' }}
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            disconnected ? 'bg-red-500' : status === 'Connected' ? 'bg-green-500' : 'bg-yellow-500'
          }`}
          style={{ writingMode: 'horizontal-tb' }}
        />
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ writingMode: 'horizontal-tb' }} className={`transition-transform ${panelOpen ? 'rotate-180' : ''}`}>
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      {/* Flyout panel */}
      <div
        className={`absolute right-5 top-1/2 -translate-y-1/2 z-20 w-52 bg-surface/95 backdrop-blur-sm border border-border rounded-xl shadow-2xl flex flex-col gap-1 p-3 transition-all duration-200 ${
          panelOpen ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-0 translate-x-4 pointer-events-none'
        }`}
      >
        {/* Status */}
        <div className="flex items-center gap-2 px-1 py-1.5 border-b border-border mb-1">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              disconnected ? 'bg-red-500' : status === 'Connected' ? 'bg-green-500' : 'bg-yellow-500'
            }`}
          />
          <span className="text-sm text-text-primary font-medium truncate">
            {disconnected ? 'Disconnected' : status}
          </span>
        </div>

        {/* Connection name */}
        <div className="px-1 py-0.5">
          <p className="text-xs text-text-secondary truncate">{tab.name}</p>
        </div>

        {/* Fullscreen */}
        <button
          onClick={() => { toggleFullscreen(); setPanelOpen(false); }}
          className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-hover text-text-primary text-sm transition-colors text-left w-full"
        >
          {isFullscreen ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              </svg>
              Exit Fullscreen
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
              Fullscreen
            </>
          )}
        </button>

        {/* Keyboard note */}
        {!isFullscreen && (
          <p className="text-xs text-text-secondary px-2 pb-1 leading-relaxed">
            Enter fullscreen to capture Ctrl+Tab, F-keys and other browser shortcuts.
          </p>
        )}
      </div>
    </div>
  );
}

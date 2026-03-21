import { useEffect, useRef, useState } from 'react';
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

const STATUS_BAR_H = 24;
// Debounce resize calls — avoid hammering session.resize during continuous drag/resize
const RESIZE_DEBOUNCE_MS = 150;

interface RdpSessionProps {
  tab: Tab;
  onStatusChange: (tabId: string, status: Tab['status']) => void;
}

export function RdpSession({ tab, onStatusChange }: RdpSessionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionRef = useRef<any>(null);
  const { token } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('Initializing...');

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

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
        canvas.width = container.clientWidth || 1280;
        canvas.height = Math.max((container.clientHeight || 720) - STATUS_BAR_H, 1);
        container.innerHTML = '';
        container.appendChild(canvas);

        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${proto}//${window.location.host}/ws/rdp-raw?token=${encodeURIComponent(token)}&connectionId=${encodeURIComponent(tab.connectionId)}`;

        setStatus('Connecting...');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { SessionBuilder, DesktopSize, ClipboardData } = Backend as any;

        // Local clipboard text cache — used synchronously in forceClipboardUpdateCallback
        // (IronRDP may not await async callbacks)
        let localClipboardText = '';

        const pushClipboardToGuest = (text: string) => {
          if (!sessionRef.current) return;
          const data = new ClipboardData();
          data.addText('text/plain', text);
          sessionRef.current.onClipboardPaste(data).catch(() => {});
        };

        // Read host clipboard and push to guest. Requires clipboard-read permission:
        // - Chrome shows a one-time permission prompt on the first call from a user gesture.
        // - After the user grants it, all subsequent calls are silent.
        const syncHostClipboardToGuest = () => {
          navigator.clipboard.readText().then((text) => {
            if (text && text !== localClipboardText) {
              localClipboardText = text;
              pushClipboardToGuest(text);
            }
          }).catch(() => { /* permission denied or not yet granted */ });
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
          // Guest clipboard → host: guest copied something, write to browser clipboard
          .remoteClipboardChangedCallback((clipData: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            const items = (clipData.items() as any[]) ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
            const textItem = items.find((i: any) => i.mimeType() === 'text/plain'); // eslint-disable-line @typescript-eslint/no-explicit-any
            if (textItem) {
              const text = String(textItem.value());
              localClipboardText = text;
              navigator.clipboard.writeText(text).catch(() => {});
            }
          })
          // IronRDP requests current local clipboard (e.g. when guest wants to paste).
          // Push cached value synchronously first, then also trigger an async refresh so
          // subsequent pastes pick up the latest host clipboard (covers right-click paste).
          .forceClipboardUpdateCallback(() => {
            pushClipboardToGuest(localClipboardText);
            syncHostClipboardToGuest();
          })
          // Enable RDPEDISP virtual channel so session.resize() actually changes
          // the guest desktop resolution (not just the local canvas).
          .extension(displayControl!(true))
          .connect();

        if (cancelled) {
          session.shutdown();
          return;
        }

        sessionRef.current = session;
        setStatus('Connected');
        onStatusChange(tab.id, 'connected');

        // ── Auto-resize (debounced) ──────────────────────────────────────────
        resizeObserver = new ResizeObserver(() => {
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            if (!sessionRef.current || !containerRef.current) return;
            const w = containerRef.current.clientWidth;
            const h = Math.max(containerRef.current.clientHeight - STATUS_BAR_H, 1);
            if (w <= 0 || h <= 0) return;
            // session.resize() updates canvas dimensions internally (IronRDP owns it).
            // Do NOT set canvas.width/height here — that clears the framebuffer.
            sessionRef.current.resize(w, h);
          }, RESIZE_DEBOUNCE_MS);
        });
        resizeObserver.observe(container);

        // ── Input event wiring ───────────────────────────────────────────────
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
          e.preventDefault();
          applyEvents(DeviceEvent.mouseButtonPressed(e.button));
          if (e.button === 2) {
            // Right-click: refresh clipboard cache NOW. The user still needs to navigate
            // the guest context menu before forceClipboardUpdateCallback fires (~500ms+),
            // so this async read completes in time.
            syncHostClipboardToGuest();
          } else if (!clipboardPermissionRequested) {
            // First left-click in the canvas: request clipboard-read permission once.
            // Doing it here (not on right-click) avoids the Chrome permission dialog
            // appearing simultaneously with the guest right-click context menu.
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
          applyEvents(DeviceEvent.wheelRotations(isVertical, -delta, 0 /* Pixel */));
        };

        const onKey = (e: KeyboardEvent) => {
          // Do NOT preventDefault for Ctrl+C / Ctrl+V so browser copy/paste events fire.
          // Ctrl+C → browser 'copy' event → our onCopy handler writes localClipboardText to clipboard.
          // Ctrl+V → browser 'paste' event → our onPaste handler reads clipboardData and pushes to guest.
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
        // When the browser window regains focus (user Alt+Tabs back after copying something),
        // refresh the clipboard cache so subsequent right-click paste has the latest content.
        const onWindowFocus = () => syncHostClipboardToGuest();
        const onContextMenu = (e: Event) => e.preventDefault();

        // Clipboard: guest → host via browser 'copy' event.
        // navigator.clipboard.writeText() can fail silently from a WASM callback context.
        // Intercepting the copy event is reliable: it fires synchronously from the user's
        // Ctrl+C keystroke (which we no longer preventDefault) and needs no API permission.
        const onCopy = (e: ClipboardEvent) => {
          if (localClipboardText) {
            e.clipboardData?.setData('text/plain', localClipboardText);
            e.preventDefault();
          }
        };

        // Clipboard: host → guest via browser 'paste' event.
        // Fires when Ctrl+V is pressed (no longer preventDefault'd). We read the actual
        // clipboard text from the event and push it to the guest immediately.
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
        window.addEventListener('keydown', onKey, false);
        window.addEventListener('keyup', onKey, false);
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
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('focus', onWindowFocus);
        document.removeEventListener('copy', onCopy, true);
        window.removeEventListener('paste', onPaste);

        if (!cancelled) {
          setStatus('Disconnected');
          onStatusChange(tab.id, 'disconnected');
        }
      } catch (err) {
        if (!cancelled) {
          let msg: string;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const e = err as any;
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
          setError(`RDP error: ${msg}`);
          onStatusChange(tab.id, 'disconnected');
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
  }, [tab.id, tab.connectionId, token, onStatusChange]);

  return (
    <div className="flex flex-col flex-1 bg-black relative overflow-hidden">
      {error && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-4 py-2 rounded text-sm z-10 max-w-md text-center">
          {error}
        </div>
      )}
      <div ref={containerRef} className="flex-1 w-full" />
      <div className="absolute bottom-0 left-0 right-0 h-6 bg-black/60 flex items-center px-3 text-xs text-gray-400">
        <span className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              error ? 'bg-red-500' : status === 'Connected' ? 'bg-green-500' : 'bg-yellow-500'
            }`}
          />
          {status}
        </span>
      </div>
    </div>
  );
}

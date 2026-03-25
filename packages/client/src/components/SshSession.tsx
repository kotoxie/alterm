import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { Tab } from '../pages/MainLayout';
import { useAuth } from '../hooks/useAuth';
import { useSshPrefs } from '../hooks/useSshPrefs';
import { SSH_THEMES } from '../lib/sshThemes';
import { getWsTicket } from '../lib/wsTicket';

interface SshSessionProps {
  tab: Tab;
  isActive: boolean;
  /** Pixel width of the pane rect — passed from SessionsLayer so fit() is driven by React state */
  paneWidth: number;
  /** Pixel height of the pane rect */
  paneHeight: number;
  onStatusChange: (tabId: string, status: Tab['status']) => void;
  onClose: (tabId: string) => void;
}

interface TunnelInfo {
  localPort: number;
  remoteHost: string;
  remotePort: number;
}

export function SshSession({ tab, isActive, paneWidth, paneHeight, onStatusChange, onClose }: SshSessionProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const { token } = useAuth();
  const sshPrefs = useSshPrefs();
  const [disconnected, setDisconnected] = useState(false);
  const [disconnectMessage, setDisconnectMessage] = useState('');
  const [reconnectCount, setReconnectCount] = useState(0);
  const [activeTunnels, setActiveTunnels] = useState<TunnelInfo[]>([]);

  // Destructure per-user SSH prefs (fetched from /api/v1/profile/ssh-prefs)
  const { fontSize: sshFontSize, fontFamily: sshFontFamily, scrollback: sshScrollback,
          cursorStyle: sshCursorStyle, cursorBlink: sshCursorBlink, theme: sshThemeName } = sshPrefs;
  const sshTheme = SSH_THEMES[sshThemeName] ?? SSH_THEMES['vscode-dark'];

  const handleReconnect = useCallback(() => {
    setDisconnected(false);
    setDisconnectMessage('');
    setActiveTunnels([]);
    setReconnectCount((n) => n + 1);
  }, []);

  // Re-fit when the pane rect changes (sidebar drag, window resize, split pane resize).
  // paneWidth/paneHeight come directly from React state (leafRects), so this fires
  // synchronously in the React commit cycle — more reliable than a ResizeObserver chain.
  useEffect(() => {
    if (paneWidth === 0 || paneHeight === 0) return;
    const fit = fitAddonRef.current;
    const term = terminalRef.current;
    const ws = wsRef.current;
    if (!fit || !term) return;
    fit.fit();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }, [paneWidth, paneHeight]);

  // Re-fit + focus terminal when this tab becomes active (was hidden before)
  useEffect(() => {
    if (!isActive) return;
    const timer = setTimeout(() => {
      const fit = fitAddonRef.current;
      const term = terminalRef.current;
      const ws = wsRef.current;
      if (!fit || !term) return;
      fit.fit();
      term.focus();
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [isActive]);

  useEffect(() => {
    if (!termRef.current || !token) return;
    let cancelled = false;

    const term = new Terminal({
      cursorBlink: sshCursorBlink,
      fontSize: sshFontSize,
      fontFamily: sshFontFamily,
      cursorStyle: sshCursorStyle,
      theme: {
        background: sshTheme.bg,
        foreground: sshTheme.fg,
        cursor: sshTheme.cursor,
        selectionBackground: sshTheme.selection,
        black: sshTheme.black,
        red: sshTheme.red,
        green: sshTheme.green,
        yellow: sshTheme.yellow,
        blue: sshTheme.blue,
        magenta: sshTheme.magenta,
        cyan: sshTheme.cyan,
        white: sshTheme.white,
        brightBlack: sshTheme.brightBlack,
        brightRed: sshTheme.brightRed,
        brightGreen: sshTheme.brightGreen,
        brightYellow: sshTheme.brightYellow,
        brightBlue: sshTheme.brightBlue,
        brightMagenta: sshTheme.brightMagenta,
        brightCyan: sshTheme.brightCyan,
        brightWhite: sshTheme.brightWhite,
      },
      allowTransparency: false,
      scrollback: sshScrollback,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termRef.current);
    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Fit synchronously — the flex container is already laid out when this effect
    // runs (paneWidth/paneHeight are non-zero). This ensures term.cols/rows are
    // correct BEFORE the WebSocket opens and sends the initial resize message.
    fitAddon.fit();

    // Mutable slots accessible by both the async IIFE and the cleanup function
    let dataDispose: ReturnType<typeof term.onData> | null = null;

    (async () => {
      let ticket: string;
      try {
        ticket = await getWsTicket(token);
        if (cancelled) return;
      } catch {
        if (!cancelled) term.write('\r\nFailed to obtain session ticket.\r\n');
        return;
      }

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws/ssh?ticket=${encodeURIComponent(ticket)}&connectionId=${encodeURIComponent(tab.connectionId)}&sessionId=${encodeURIComponent(tab.clientSessionId)}`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        // By the time the WebSocket handshake completes the fit has run
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      };

      ws.onmessage = (e) => {
        if (typeof e.data === 'string') {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'status' && (msg.message === 'Connected' || msg.message === 'Reattached')) {
              onStatusChange(tab.id, 'connected');
              term.focus();
              // Re-send current dimensions now that the server is ready to accept resize
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
              }
            } else if (msg.type === 'error') {
              if (!cancelled) { setDisconnectMessage(msg.message); setDisconnected(true); onStatusChange(tab.id, 'disconnected'); }
            } else if (msg.type === 'tunnels') {
              setActiveTunnels(msg.tunnels || []);
            }
            return;
          } catch { /* not JSON — write as terminal data */ }
          term.write(e.data);
        } else {
          term.write(new Uint8Array(e.data as ArrayBuffer));
        }
      };

      const handleClose = (reason: string) => {
        if (!cancelled) { setDisconnected(true); setDisconnectMessage(reason); onStatusChange(tab.id, 'disconnected'); }
      };
      ws.onclose = (e) => { if (e.code === 4001) return; handleClose(e.reason || 'Disconnected'); };
      ws.onerror = () => handleClose('Connection error');

      dataDispose = term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'data', data }));
      });
    })();

    return () => {
      cancelled = true;
      dataDispose?.dispose();
      const ws = wsRef.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close();
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, [tab.id, tab.connectionId, token, onStatusChange, reconnectCount, sshFontSize, sshFontFamily, sshScrollback, sshCursorStyle]);

  return (
    <div className="absolute inset-0 bg-[#0d0d0d]">
      <div ref={termRef} className="absolute inset-0" />

      {activeTunnels.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-10 bg-black/80 border-t border-border/30 px-3 py-1.5 flex items-center gap-3 flex-wrap">
          <span className="text-xs text-text-secondary shrink-0">Tunnels:</span>
          {activeTunnels.map((t, i) => (
            <span key={i} className="text-xs font-mono bg-surface-hover/50 px-2 py-0.5 rounded text-accent">
              :{t.localPort} → {t.remoteHost}:{t.remotePort}
            </span>
          ))}
        </div>
      )}

      {disconnected && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-20">
          <div className="bg-surface border border-border rounded-xl p-6 shadow-2xl flex flex-col items-center gap-4 w-72">
            <div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" />
                <circle cx="12" cy="16" r="0.5" fill="currentColor" />
              </svg>
            </div>
            <div className="text-center">
              <h3 className="text-text-primary font-semibold">Session Disconnected</h3>
              {disconnectMessage && (
                <p className="text-text-secondary text-xs mt-1 break-words max-w-xs">{disconnectMessage}</p>
              )}
            </div>
            <div className="flex gap-3 w-full">
              <button onClick={() => onClose(tab.id)}
                className="flex-1 py-2 px-3 text-sm border border-border rounded-lg hover:bg-surface-hover text-text-secondary transition-colors">
                Exit
              </button>
              <button onClick={handleReconnect}
                className="flex-1 py-2 px-3 text-sm bg-accent text-white rounded-lg hover:bg-accent-hover font-medium transition-colors">
                Reconnect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

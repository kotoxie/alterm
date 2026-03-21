import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { Tab } from '../pages/MainLayout';
import { useAuth } from '../hooks/useAuth';

interface SshSessionProps {
  tab: Tab;
  onStatusChange: (tabId: string, status: Tab['status']) => void;
  onClose: (tabId: string) => void;
}

export function SshSession({ tab, onStatusChange, onClose }: SshSessionProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const { token } = useAuth();
  const [disconnected, setDisconnected] = useState(false);
  const [disconnectMessage, setDisconnectMessage] = useState('');
  const [reconnectCount, setReconnectCount] = useState(0);

  const handleReconnect = useCallback(() => {
    setDisconnected(false);
    setDisconnectMessage('');
    setReconnectCount((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!termRef.current || !token) return;
    let cancelled = false;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Cascadia Code", "Fira Code", Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0d0d0d',
        foreground: '#d4d4d4',
        cursor: '#a6a6a6',
        selectionBackground: '#264f78',
        black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
        blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
        brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b',
        brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6',
        brightCyan: '#29b8db', brightWhite: '#e5e5e5',
      },
      allowTransparency: false,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termRef.current);

    // Defer first fit so the DOM has dimensions
    requestAnimationFrame(() => { if (!cancelled) fitAddon.fit(); });

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/ssh?token=${encodeURIComponent(token)}&connectionId=${encodeURIComponent(tab.connectionId)}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'status' && msg.message === 'Connected') {
            onStatusChange(tab.id, 'connected');
            term.focus();
          } else if (msg.type === 'error') {
            if (!cancelled) { setDisconnectMessage(msg.message); setDisconnected(true); onStatusChange(tab.id, 'disconnected'); }
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
    ws.onclose = (e) => handleClose(e.reason || 'Disconnected');
    ws.onerror = () => handleClose('Connection error');

    const dataDispose = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'data', data }));
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    });
    if (termRef.current) resizeObserver.observe(termRef.current);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      dataDispose.dispose();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      term.dispose();
    };
  }, [tab.id, tab.connectionId, token, onStatusChange, reconnectCount]);

  return (
    <div className="flex flex-col flex-1 bg-[#0d0d0d] relative overflow-hidden">
      <div ref={termRef} className="flex-1 w-full overflow-hidden" />

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

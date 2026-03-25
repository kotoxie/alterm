import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getWsTicket } from '../lib/wsTicket';
import { DisconnectOverlay } from './DisconnectOverlay';

interface VncSessionProps {
  connectionId: string;
  connectionName: string;
  isActive: boolean;
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected') => void;
  onClose?: (connectionId: string) => void;
}

export function VncSession({ connectionId, connectionName, isActive, onStatusChange, onClose }: VncSessionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<import('@novnc/novnc/lib/rfb.js').default | null>(null);
  const { token } = useAuth();
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const [reconnectCount, setReconnectCount] = useState(0);

  function setAndNotify(s: 'connecting' | 'connected' | 'disconnected') {
    setStatus(s);
    onStatusChange?.(s);
  }

  const handleReconnect = useCallback(() => {
    setErrorMsg('');
    setReconnectCount((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!isActive) return;
    if (!containerRef.current || !token) return;

    let cancelled = false;
    let sessionRevoked = false;
    let rfb: import('@novnc/novnc/lib/rfb.js').default | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const onRevoked = () => { sessionRevoked = true; };
    window.addEventListener('alterm:unauthorized', onRevoked);

    async function connect() {
      try {
        // Fetch password from session endpoint
        const res = await fetch(`/api/v1/connections/${connectionId}/session`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to fetch connection credentials');
        const info: { password?: string } = await res.json();
        if (cancelled) return;

        const RFB = (await import('@novnc/novnc/lib/rfb.js')).default;
        if (cancelled) return;

        const ticket = await getWsTicket(token!);
        if (cancelled) return;

        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${proto}//${window.location.host}/ws/vnc/${connectionId}?ticket=${encodeURIComponent(ticket)}`;

        const container = containerRef.current!;
        container.innerHTML = '';

        rfb = new RFB(container, wsUrl, {
          credentials: info.password ? { password: info.password } : undefined,
        });

        rfb.scaleViewport = true;
        rfb.resizeSession = true;
        rfbRef.current = rfb;

        rfb.addEventListener('connect', () => {
          if (!cancelled) setAndNotify('connected');
        });

        rfb.addEventListener('disconnect', (e: Event) => {
          if (!cancelled && !sessionRevoked) {
            const detail = (e as CustomEvent).detail;
            if (detail?.clean === false) {
              setErrorMsg('Connection lost unexpectedly');
            }
            setAndNotify('disconnected');
          }
        });

        rfb.addEventListener('securityfailure', () => {
          if (!cancelled && !sessionRevoked) {
            setErrorMsg('VNC authentication failed');
            setAndNotify('disconnected');
          }
        });

        // ResizeObserver to trigger viewport scale update
        resizeObserver = new ResizeObserver(() => {
          if (rfbRef.current && rfbRef.current.scaleViewport) {
            // Accessing scaleViewport setter triggers re-scale
            rfbRef.current.scaleViewport = true;
          }
        });
        resizeObserver.observe(container);
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Connection failed');
          setAndNotify('disconnected');
        }
      }
    }

    setAndNotify('connecting');
    setErrorMsg('');
    connect();

    return () => {
      cancelled = true;
      window.removeEventListener('alterm:unauthorized', onRevoked);
      resizeObserver?.disconnect();
      if (rfbRef.current) {
        try { rfbRef.current.disconnect(); } catch { /* ignore */ }
        rfbRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, token, isActive, reconnectCount]);

  return (
    <div className="absolute inset-0 bg-black flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-alt border-b border-border/40 shrink-0 text-xs text-text-secondary">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            status === 'connected'
              ? 'bg-green-500'
              : status === 'connecting'
              ? 'bg-yellow-500'
              : 'bg-red-500'
          }`}
        />
        <span className="font-medium text-text-primary">{connectionName}</span>
        <span className="opacity-50">VNC</span>
        {status === 'connecting' && <span className="opacity-50">Connecting...</span>}
        {errorMsg && <span className="text-red-400 ml-auto">{errorMsg}</span>}
      </div>

      <div ref={containerRef} className="flex-1 overflow-hidden" style={{ background: '#000' }} />

      <DisconnectOverlay
        show={status === 'disconnected'}
        message={errorMsg}
        onExit={() => onClose?.(connectionId)}
        onReconnect={handleReconnect}
      />
    </div>
  );
}

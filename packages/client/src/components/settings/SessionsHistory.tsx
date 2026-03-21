import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

interface SessionRow {
  id: string;
  protocol: string;
  startedAt: string;
  endedAt: string | null;
  hasRecording: boolean;
  connectionName: string | null;
  username: string | null;
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return 'Active';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatDate(iso: string) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

interface CastEvent { time: number; data: string; }
interface CastHeader { width: number; height: number; }

function parseCast(text: string): { header: CastHeader; events: CastEvent[] } {
  const lines = text.trim().split('\n');
  const header = JSON.parse(lines[0]) as CastHeader;
  const events: CastEvent[] = [];
  for (let i = 1; i < lines.length; i++) {
    try {
      const [time, type, data] = JSON.parse(lines[i]) as [number, string, string];
      if (type === 'o') events.push({ time, data });
    } catch { /* skip bad lines */ }
  }
  return { header, events };
}

function RecordingPlayer({ sessionId, token, onClose }: { sessionId: string; token: string; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventsRef = useRef<CastEvent[]>([]);

  useEffect(() => {
    return () => {
      termRef.current?.dispose();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({ cols: 120, rows: 30, fontSize: 13, theme: { background: '#141414' }, convertEol: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;

    async function load() {
      try {
        const res = await fetch(`/api/v1/sessions/${sessionId}/recording`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to load recording');
        const text = await res.text();
        const { events } = parseCast(text);
        eventsRef.current = events;
        setLoading(false);
        // Start playing
        playEvents(events, term, speed);
        setPlaying(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed');
        setLoading(false);
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, token]);

  function playEvents(events: CastEvent[], term: Terminal, spd: number) {
    if (timerRef.current) clearTimeout(timerRef.current);
    term.reset();
    let i = 0;
    function scheduleNext() {
      if (i >= events.length) { setPlaying(false); return; }
      const event = events[i];
      const delay = i === 0 ? 0 : Math.max(0, (event.time - events[i - 1].time) * 1000 / spd);
      timerRef.current = setTimeout(() => {
        term.write(event.data);
        i++;
        scheduleNext();
      }, delay);
    }
    scheduleNext();
  }

  function handleReplay() {
    if (!termRef.current) return;
    setPlaying(true);
    playEvents(eventsRef.current, termRef.current, speed);
  }

  function handleSpeedChange(newSpeed: number) {
    setSpeed(newSpeed);
    if (playing && termRef.current) {
      playEvents(eventsRef.current, termRef.current, newSpeed);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
      <div className="bg-surface-alt border border-border rounded-lg shadow-2xl w-[900px] max-w-[95vw] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <span className="text-sm font-semibold text-text-primary">Session Recording</span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-secondary">Speed:</span>
            {[0.5, 1, 2, 4].map((s) => (
              <button key={s} onClick={() => handleSpeedChange(s)}
                className={`px-2 py-0.5 text-xs rounded ${speed === s ? 'bg-accent text-white' : 'border border-border text-text-secondary hover:bg-surface-hover'}`}>
                {s}×
              </button>
            ))}
            <button onClick={handleReplay} disabled={loading || playing}
              className="px-3 py-1 text-xs bg-surface-hover border border-border rounded text-text-primary hover:bg-surface disabled:opacity-40">
              Replay
            </button>
            <button onClick={onClose} className="p-1 rounded hover:bg-surface-hover text-text-secondary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden bg-[#141414] rounded-b-lg p-2">
          {loading && <p className="text-text-secondary text-sm p-4">Loading recording...</p>}
          {error && <p className="text-red-400 text-sm p-4">{error}</p>}
          <div ref={containerRef} className="w-full h-full" style={{ display: loading || error ? 'none' : 'block' }} />
        </div>
      </div>
    </div>
  );
}

export function SessionsHistory() {
  const { token } = useAuth();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);

  async function loadSessions() {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/v1/sessions?limit=100', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const d = await res.json();
        setSessions(d.sessions);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { loadSessions(); }, [token]);

  if (loading) return <p className="text-text-secondary text-sm">Loading sessions...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-text-primary">Session History</h2>
        <button onClick={loadSessions} className="text-xs text-text-secondary hover:text-text-primary px-2 py-1 rounded hover:bg-surface-hover">Refresh</button>
      </div>
      {sessions.length === 0 && <p className="text-text-secondary text-sm">No sessions recorded yet.</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-text-secondary">
              <th className="pb-2 pr-4 font-medium">Connection</th>
              <th className="pb-2 pr-4 font-medium">User</th>
              <th className="pb-2 pr-4 font-medium">Protocol</th>
              <th className="pb-2 pr-4 font-medium">Started</th>
              <th className="pb-2 pr-4 font-medium">Duration</th>
              <th className="pb-2 font-medium">Recording</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-b-0">
                <td className="py-2 pr-4 text-text-primary">{s.connectionName ?? '—'}</td>
                <td className="py-2 pr-4 text-text-secondary">{s.username ?? '—'}</td>
                <td className="py-2 pr-4">
                  <span className="px-1.5 py-0.5 rounded text-xs bg-surface-hover text-text-secondary uppercase font-mono">{s.protocol}</span>
                </td>
                <td className="py-2 pr-4 text-text-secondary text-xs">{formatDate(s.startedAt)}</td>
                <td className="py-2 pr-4 text-text-secondary text-xs">{formatDuration(s.startedAt, s.endedAt)}</td>
                <td className="py-2">
                  {s.hasRecording ? (
                    <button
                      onClick={() => setPlayingId(s.id)}
                      className="px-2 py-1 text-xs bg-accent/10 text-accent rounded hover:bg-accent/20 border border-accent/20"
                    >
                      Play
                    </button>
                  ) : (
                    <span className="text-xs text-text-secondary opacity-50">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {playingId && token && (
        <RecordingPlayer sessionId={playingId} token={token} onClose={() => setPlayingId(null)} />
      )}
    </div>
  );
}

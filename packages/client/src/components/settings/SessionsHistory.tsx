import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDate as formatDateTz } from '../../utils/formatDate';
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

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface CastEvent { time: number; data: string; }
interface CastHeader { width: number; height: number; title?: string; }

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

function VideoPlayer({
  sessionId, token, onClose,
}: { sessionId: string; token: string; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    async function load() {
      try {
        const res = await fetch(`/api/v1/sessions/${sessionId}/recording`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Recording not found');
        const blob = await res.blob();
        const typedBlob = blob.type === 'video/webm' ? blob : new Blob([blob], { type: 'video/webm' });
        url = URL.createObjectURL(typedBlob);
        setBlobUrl(url);
        // Dismiss loading immediately — don't wait for onLoadedMetadata.
        // MediaRecorder WebM files often lack a Duration element so the browser
        // may never fire loadedmetadata; we show the video element right away.
        setLoading(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
        setLoading(false);
      }
    }
    load();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [sessionId, token]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/recording`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `rdp-recording-${sessionId}.webm`; a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
    setDownloading(false);
  }

  function onVideoMeta() {
    const v = videoRef.current;
    if (!v) return;
    // duration is Infinity for MediaRecorder live WebM — treat as unknown
    if (isFinite(v.duration)) setTotalTime(v.duration);
  }

  function onCanPlay() {
    const v = videoRef.current;
    if (!v) return;
    if (isFinite(v.duration)) setTotalTime(v.duration);
    v.play().catch(() => {});
  }

  function onVideoError() {
    const v = videoRef.current;
    const code = v?.error?.code ?? 0;
    const msgs: Record<number, string> = {
      1: 'Playback aborted', 2: 'Network error', 3: 'Decode error', 4: 'Format not supported',
    };
    console.error('[VideoPlayer] media error code', code, v?.error?.message);
    // Only surface fatal errors — don't hide the video element
    if (code === 4) setError(msgs[code]);
  }

  function onTimeUpdate() {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    if (isFinite(v.duration)) setTotalTime(v.duration);
  }

  function onPlayPause() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); } else { v.pause(); }
  }

  function onSeek(val: number) {
    const v = videoRef.current;
    if (v) { v.currentTime = val; setCurrentTime(val); }
  }

  function setPlaybackSpeed(s: number) {
    const v = videoRef.current;
    setSpeed(s);
    if (v) v.playbackRate = s;
  }

  const progress = totalTime > 0 ? (currentTime / totalTime) * 100 : 0;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#0a0a0a]">
      <div className="flex items-center gap-3 px-4 py-2 bg-[#141414] border-b border-[#2e2e2e] shrink-0">
        <span className="text-sm font-semibold text-[#efefef]">RDP Recording</span>
        <div className="flex-1" />
        <button
          onClick={() => void handleDownload()}
          disabled={downloading || !!error}
          className="p-1.5 rounded hover:bg-[#272727] text-[#888] hover:text-[#efefef] disabled:opacity-40 flex items-center gap-1.5 text-xs"
          title="Download .webm"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download
        </button>
        <button onClick={onClose} className="p-1.5 rounded hover:bg-[#272727] text-[#888] hover:text-[#efefef]" title="Close (Esc)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center overflow-hidden bg-black relative">
        {loading && <p className="text-[#888] text-sm absolute">Loading recording...</p>}
        {error && <p className="text-red-400 text-sm absolute top-4">{error}</p>}
        {blobUrl && (
          <video
            ref={videoRef}
            src={blobUrl}
            className="max-w-full max-h-full"
            muted={false}
            preload="auto"
            onLoadedMetadata={onVideoMeta}
            onCanPlay={onCanPlay}
            onTimeUpdate={onTimeUpdate}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={onVideoError}
          />
        )}
      </div>
      <div className="shrink-0 px-4 py-3 bg-[#141414] border-t border-[#2e2e2e] space-y-2">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-[#888]">{formatTime(currentTime)}</span>
          <span className="text-[#555]">
            {playing ? (
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
                PLAYING {speed !== 1 ? `(${speed}×)` : ''}
              </span>
            ) : currentTime >= totalTime && totalTime > 0 ? (
              <span className="text-green-500/70">FINISHED</span>
            ) : 'PAUSED'}
          </span>
          <span className="text-[#888]">{totalTime > 0 ? formatTime(totalTime) : '--:--'}</span>
        </div>
        <div className="relative">
          <div className="absolute top-1/2 left-0 h-1 rounded-full bg-blue-500/60 pointer-events-none -translate-y-1/2" style={{ width: `${progress}%` }} />
          <input
            type="range" min={0} max={totalTime || 1} step={0.1} value={currentTime}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            disabled={!!error || totalTime === 0}
            className="w-full h-1 appearance-none bg-[#2e2e2e] rounded-full cursor-pointer disabled:opacity-40
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:cursor-pointer
              [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full
              [&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:cursor-pointer"
            style={{ background: 'transparent' }}
          />
        </div>
        <div className="flex items-center justify-center gap-2 pt-0.5">
          <button
            onClick={onPlayPause}
            disabled={!!error}
            className="px-3 py-1.5 text-xs border border-[#2e2e2e] rounded text-[#efefef] hover:bg-[#1c1c1c] disabled:opacity-40 flex items-center gap-1.5"
          >
            {playing
              ? (<><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>Pause</>)
              : (<><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>{currentTime > 0 ? 'Resume' : 'Play'}</>)
            }
          </button>
          <button
            onClick={() => onSeek(0)}
            disabled={loading || !!error}
            className="px-3 py-1.5 text-xs border border-[#2e2e2e] rounded text-[#888] hover:text-[#efefef] hover:bg-[#1c1c1c] disabled:opacity-40"
          >
            ↺ Replay
          </button>
          <div className="w-px h-4 bg-[#2e2e2e] mx-1" />
          <span className="text-xs text-[#555]">Speed:</span>
          {[0.25, 0.5, 1, 2, 4, 8].map((s) => (
            <button
              key={s}
              onClick={() => setPlaybackSpeed(s)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${speed === s ? 'bg-blue-500 text-white' : 'border border-[#2e2e2e] text-[#888] hover:border-[#444] hover:text-[#efefef]'}`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function RecordingPlayer({
  sessionId, token, onClose,
}: { sessionId: string; token: string; onClose: () => void }) {const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  const [title, setTitle] = useState('');
  const [downloading, setDownloading] = useState(false);

  const eventsRef = useRef<CastEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const isSeeking = useRef(false);

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/recording`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `ssh-recording-${sessionId}.cast`; a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
    setDownloading(false);
  }

  const cancelPlayback = useCallback(() => {
    playingRef.current = false;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const scheduleFrom = useCallback((startIdx: number) => {
    const events = eventsRef.current;
    if (startIdx >= events.length) { setPlaying(false); return; }
    playingRef.current = true;
    setPlaying(true);
    let i = startIdx;
    function next() {
      if (!playingRef.current) return;
      if (i >= events.length) { setPlaying(false); return; }
      const ev = events[i];
      const prevTime = i > 0 ? events[i - 1].time : ev.time;
      const delay = i === startIdx ? 0 : Math.max(0, Math.min(2000, (ev.time - prevTime) * 1000 / speedRef.current));
      timerRef.current = setTimeout(() => {
        if (!playingRef.current) return;
        termRef.current?.write(ev.data);
        setCurrentTime(ev.time);
        i++;
        next();
      }, delay);
    }
    next();
  }, []);

  const seekTo = useCallback((targetTime: number, resume = true) => {
    cancelPlayback();
    if (!termRef.current) return;
    const events = eventsRef.current;
    termRef.current.reset();
    let nextIdx = 0;
    for (let i = 0; i < events.length; i++) {
      if (events[i].time <= targetTime) {
        termRef.current.write(events[i].data);
        nextIdx = i + 1;
      } else { break; }
    }
    setCurrentTime(targetTime);
    if (resume && nextIdx < events.length) scheduleFrom(nextIdx);
    else setPlaying(false);
  }, [cancelPlayback, scheduleFrom]);

  useEffect(() => {
    return () => { cancelPlayback(); termRef.current?.dispose(); };
  }, [cancelPlayback]);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({
      fontSize: 14,
      fontFamily: 'Cascadia Code, Fira Code, Menlo, Monaco, Courier New, monospace',
      theme: { background: '#0a0a0a', foreground: '#efefef', cursor: '#3b82f6' },
      convertEol: true,
      disableStdin: true,
      scrollback: 0,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    async function load() {
      try {
        const res = await fetch(`/api/v1/sessions/${sessionId}/recording`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Recording not found or unavailable');
        const text = await res.text();
        const { header, events } = parseCast(text);
        eventsRef.current = events;
        const duration = events.length > 0 ? events[events.length - 1].time : 0;
        setTotalTime(duration);
        setTitle(header.title ?? '');
        setLoading(false);
        scheduleFrom(0);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
        setLoading(false);
      }
    }
    load();
    const observer = new ResizeObserver(() => { fitRef.current?.fit(); });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, token]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const progress = totalTime > 0 ? (currentTime / totalTime) * 100 : 0;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#0a0a0a]">
      <div className="flex items-center gap-3 px-4 py-2 bg-[#141414] border-b border-[#2e2e2e] shrink-0">
        <span className="text-sm font-semibold text-[#efefef] truncate">{title || 'Session Recording'}</span>
        <div className="flex-1" />
        <button
          onClick={() => void handleDownload()}
          disabled={downloading || loading || !!error}
          className="p-1.5 rounded hover:bg-[#272727] text-[#888] hover:text-[#efefef] disabled:opacity-40 flex items-center gap-1.5 text-xs"
          title="Download .cast"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download
        </button>
        <button onClick={onClose} className="p-1.5 rounded hover:bg-[#272727] text-[#888] hover:text-[#efefef]" title="Close (Esc)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-hidden p-3">
        {loading && <div className="flex items-center justify-center h-full text-[#888] text-sm">Loading recording...</div>}
        {error && <div className="flex items-center justify-center h-full text-red-400 text-sm">{error}</div>}
        <div ref={containerRef} className="w-full h-full" style={{ display: loading || error ? 'none' : 'block' }} />
      </div>
      <div className="shrink-0 px-4 py-3 bg-[#141414] border-t border-[#2e2e2e] space-y-2">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-[#888]">{formatTime(currentTime)}</span>
          <span className="text-[#555]">
            {playing ? (
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
                PLAYING {speed !== 1 ? `(${speed}×)` : ''}
              </span>
            ) : currentTime >= totalTime && totalTime > 0 ? (
              <span className="text-green-500/70">FINISHED</span>
            ) : 'PAUSED'}
          </span>
          <span className="text-[#888]">{formatTime(totalTime)}</span>
        </div>
        <div className="relative">
          <div className="absolute top-1/2 left-0 h-1 rounded-full bg-blue-500/60 pointer-events-none -translate-y-1/2" style={{ width: `${progress}%` }} />
          <input type="range" min={0} max={totalTime || 1} step={0.1} value={currentTime}
            onChange={(e) => { isSeeking.current = true; seekTo(parseFloat(e.target.value), false); }}
            onMouseUp={(e) => { isSeeking.current = false; seekTo(parseFloat((e.target as HTMLInputElement).value), true); }}
            onTouchEnd={(e) => { isSeeking.current = false; seekTo(parseFloat((e.target as HTMLInputElement).value), true); }}
            disabled={loading || !!error || totalTime === 0}
            className="w-full h-1 appearance-none bg-[#2e2e2e] rounded-full cursor-pointer disabled:opacity-40
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:cursor-pointer
              [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full
              [&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:cursor-pointer"
            style={{ background: 'transparent' }} />
        </div>
        <div className="flex items-center justify-center gap-2 pt-0.5">
          <button onClick={() => playing ? (cancelPlayback(), setPlaying(false)) : seekTo(currentTime, true)}
            disabled={loading || !!error}
            className="px-3 py-1.5 text-xs border border-[#2e2e2e] rounded text-[#efefef] hover:bg-[#1c1c1c] disabled:opacity-40 flex items-center gap-1.5">
            {playing ? (<><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>Pause</>) : (<><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>{currentTime > 0 ? 'Resume' : 'Play'}</>)}
          </button>
          <button onClick={() => seekTo(0, true)} disabled={loading || !!error}
            className="px-3 py-1.5 text-xs border border-[#2e2e2e] rounded text-[#888] hover:text-[#efefef] hover:bg-[#1c1c1c] disabled:opacity-40">
            ↺ Replay
          </button>
          <div className="w-px h-4 bg-[#2e2e2e] mx-1" />
          <span className="text-xs text-[#555]">Speed:</span>
          {[0.25, 0.5, 1, 2, 4, 8].map((s) => (
            <button key={s} onClick={() => { setSpeed(s); speedRef.current = s; if (playingRef.current) seekTo(currentTime, true); }}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${speed === s ? 'bg-blue-500 text-white' : 'border border-[#2e2e2e] text-[#888] hover:border-[#444] hover:text-[#efefef]'}`}>
              {s}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const PROTOCOLS = ['ssh', 'rdp', 'smb', 'vnc', 'sftp', 'ftp'] as const;

function FilterBar({
  search, setSearch,
  protocol, setProtocol,
  userFilter, setUserFilter,
  dateFrom, setDateFrom,
  dateTo, setDateTo,
  userOptions,
  onReset,
}: {
  search: string; setSearch: (v: string) => void;
  protocol: string; setProtocol: (v: string) => void;
  userFilter: string; setUserFilter: (v: string) => void;
  dateFrom: string; setDateFrom: (v: string) => void;
  dateTo: string; setDateTo: (v: string) => void;
  userOptions: string[];
  onReset: () => void;
}) {
  const hasFilters = search || protocol !== 'all' || userFilter !== 'all' || dateFrom || dateTo;
  const inputCls = 'px-2.5 py-1.5 bg-surface border border-border rounded text-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-accent';

  return (
    <div className="flex flex-wrap gap-2 items-center p-3 bg-surface-alt rounded-lg border border-border">
      {/* Search */}
      <div className="flex items-center gap-1.5 flex-1 min-w-36">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-secondary shrink-0">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="text"
          placeholder="Search connection…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputCls} flex-1`}
        />
      </div>

      {/* Protocol */}
      <select value={protocol} onChange={(e) => setProtocol(e.target.value)} className={inputCls}>
        <option value="all">All protocols</option>
        {PROTOCOLS.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
      </select>

      {/* User (only shown if there are multiple users) */}
      {userOptions.length > 1 && (
        <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className={inputCls}>
          <option value="all">All users</option>
          {userOptions.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      )}

      {/* Date range */}
      <div className="flex items-center gap-1">
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
          className={inputCls} title="From date" />
        <span className="text-text-secondary text-xs">–</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
          className={inputCls} title="To date" />
      </div>

      {/* Reset */}
      {hasFilters && (
        <button onClick={onReset}
          className="px-2.5 py-1.5 text-xs border border-border rounded text-text-secondary hover:bg-surface-hover flex items-center gap-1">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          Clear filters
        </button>
      )}
    </div>
  );
}

export function SessionsHistory() {
  const { token } = useAuth();
  const timezone = useTimezone();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playingProtocol, setPlayingProtocol] = useState<string>('ssh');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [protocol, setProtocol] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  async function loadSessions() {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/v1/sessions?limit=2000', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const d = await res.json() as { sessions: SessionRow[] };
        // Only keep sessions that have a recording
        setSessions(d.sessions.filter((s) => s.hasRecording));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function downloadRecording(s: SessionRow) {
    if (!token || downloadingId) return;
    setDownloadingId(s.id);
    try {
      const res = await fetch(`/api/v1/sessions/${s.id}/recording`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const ext = s.protocol === 'rdp' ? 'webm' : 'cast';
      const name = `${s.connectionName ?? 'session'}_${s.startedAt.replace(/[: ]/g, '-').slice(0, 19)}.${ext}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
    setDownloadingId(null);
  }

  useEffect(() => { void loadSessions(); }, [token]);

  // Distinct user list for filter dropdown
  const userOptions = useMemo(() => {
    const names = [...new Set(sessions.map((s) => s.username).filter(Boolean) as string[])].sort();
    return names;
  }, [sessions]);

  // Client-side filtered view
  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (search && !s.connectionName?.toLowerCase().includes(search.toLowerCase())) return false;
      if (protocol !== 'all' && s.protocol !== protocol) return false;
      if (userFilter !== 'all' && s.username !== userFilter) return false;
      if (dateFrom) {
        const from = new Date(dateFrom + 'T00:00:00Z').getTime();
        if (new Date(s.startedAt.replace(' ', 'T') + 'Z').getTime() < from) return false;
      }
      if (dateTo) {
        const to = new Date(dateTo + 'T23:59:59Z').getTime();
        if (new Date(s.startedAt.replace(' ', 'T') + 'Z').getTime() > to) return false;
      }
      return true;
    });
  }, [sessions, search, protocol, userFilter, dateFrom, dateTo]);

  function resetFilters() {
    setSearch('');
    setProtocol('all');
    setUserFilter('all');
    setDateFrom('');
    setDateTo('');
  }

  if (loading) return <p className="text-text-secondary text-sm">Loading recordings...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-text-primary">Session Recordings</h2>
        <button onClick={() => void loadSessions()}
          className="text-xs text-text-secondary hover:text-text-primary px-2 py-1 rounded hover:bg-surface-hover">
          ↻ Refresh
        </button>
      </div>

      <FilterBar
        search={search} setSearch={setSearch}
        protocol={protocol} setProtocol={setProtocol}
        userFilter={userFilter} setUserFilter={setUserFilter}
        dateFrom={dateFrom} setDateFrom={setDateFrom}
        dateTo={dateTo} setDateTo={setDateTo}
        userOptions={userOptions}
        onReset={resetFilters}
      />

      {/* Result count */}
      {(filtered.length !== sessions.length || sessions.length > 0) && (
        <p className="text-xs text-text-secondary">
          Showing <span className="font-medium text-text-primary">{filtered.length}</span> of {sessions.length} recordings
        </p>
      )}

      {filtered.length === 0 && sessions.length > 0 && (
        <p className="text-text-secondary text-sm py-4 text-center">No recordings match the current filters.</p>
      )}
      {sessions.length === 0 && (
        <p className="text-text-secondary text-sm">No recordings yet. Enable session recording in Settings › General › Recordings.</p>
      )}

      {filtered.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-secondary">
                <th className="pb-2 pr-4 font-medium">Connection</th>
                <th className="pb-2 pr-4 font-medium">User</th>
                <th className="pb-2 pr-4 font-medium">Protocol</th>
                <th className="pb-2 pr-4 font-medium">Started</th>
                <th className="pb-2 pr-4 font-medium">Duration</th>
                <th className="pb-2 pr-4 font-medium">Play</th>
                <th className="pb-2 font-medium">Download</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-b-0">
                  <td className="py-2 pr-4 text-text-primary">{s.connectionName ?? '—'}</td>
                  <td className="py-2 pr-4 text-text-secondary">{s.username ?? '—'}</td>
                  <td className="py-2 pr-4">
                    <span className="px-1.5 py-0.5 rounded text-xs bg-surface-hover text-text-secondary uppercase font-mono">
                      {s.protocol}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-text-secondary text-xs">{formatDateTz(s.startedAt, timezone)}</td>
                  <td className="py-2 pr-4 text-xs text-text-secondary">{formatDuration(s.startedAt, s.endedAt)}</td>
                  <td className="py-2 pr-4">
                    <button onClick={() => { setPlayingId(s.id); setPlayingProtocol(s.protocol); }}
                      className="px-2 py-1 text-xs bg-accent/10 text-accent rounded hover:bg-accent/20 border border-accent/20 flex items-center gap-1">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                      Play
                    </button>
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => void downloadRecording(s)}
                      disabled={downloadingId === s.id}
                      className="px-2 py-1 text-xs border border-border text-text-secondary rounded hover:bg-surface-hover hover:text-text-primary disabled:opacity-50 flex items-center gap-1"
                      title={`Download as .${s.protocol === 'rdp' ? 'webm' : 'cast'}`}
                    >
                      {downloadingId === s.id ? (
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                      ) : (
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                      )}
                      {downloadingId === s.id ? '…' : 'Download'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {playingId && token && playingProtocol === 'rdp' && (
        <VideoPlayer sessionId={playingId} token={token} onClose={() => setPlayingId(null)} />
      )}
      {playingId && token && playingProtocol !== 'rdp' && (
        <RecordingPlayer sessionId={playingId} token={token} onClose={() => setPlayingId(null)} />
      )}
    </div>
  );
}

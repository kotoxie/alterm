import { useEffect, useRef, useState, useCallback, type RefObject } from 'react';

type RFBInstance = import('@novnc/novnc').default;

interface VncControlPanelProps {
  rfbRef: RefObject<RFBInstance | null>;
  status: 'connecting' | 'connected' | 'disconnected';
  /** The outermost session container — used for the Fullscreen API. */
  sessionRef: RefObject<HTMLDivElement | null>;
  onDisconnect: () => void;
}

// ─── Small icon primitives ────────────────────────────────────────────────────

function IconChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
function IconChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
function IconClipboard() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <path d="M9 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-3" />
    </svg>
  );
}
function IconFullscreen() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}
function IconExitFullscreen() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="8 3 3 3 3 8" />
      <polyline points="21 8 21 3 16 3" />
      <polyline points="3 16 3 21 8 21" />
      <polyline points="16 21 21 21 21 16" />
    </svg>
  );
}
function IconPower() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  );
}

// ─── Toggle row ───────────────────────────────────────────────────────────────

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-between gap-3 cursor-pointer select-none ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <span className="text-xs text-text-primary">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus:outline-none ${checked ? 'bg-accent' : 'bg-border'}`}
      >
        <span
          className={`inline-block h-4 w-4 translate-y-0.5 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </button>
    </label>
  );
}

// ─── Slider row ───────────────────────────────────────────────────────────────

function SliderRow({ label, value, min, max, onChange, disabled }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-primary">{label}</span>
        <span className="text-xs text-text-secondary tabular-nums w-4 text-right">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full accent-accent cursor-pointer"
      />
    </div>
  );
}

// ─── Section heading ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">{title}</span>
      {children}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function VncControlPanel({ rfbRef, status, sessionRef, onDisconnect }: VncControlPanelProps) {
  const [open, setOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Mirror RFB properties in local state so controls update the display
  const [scaleViewport, setScaleViewport] = useState(true);
  const [clipViewport, setClipViewport] = useState(false);
  const [viewOnly, setViewOnly] = useState(false);
  const [qualityLevel, setQualityLevel] = useState(6);
  const [compressionLevel, setCompressionLevel] = useState(2);

  const [clipboardMsg, setClipboardMsg] = useState('');
  const clipboardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const connected = status === 'connected';

  // Sync local state from RFB when panel opens (or connection arrives)
  useEffect(() => {
    if (!open || !rfbRef.current) return;
    const r = rfbRef.current;
    setScaleViewport(r.scaleViewport);
    setClipViewport(r.clipViewport);
    setViewOnly(r.viewOnly);
    setQualityLevel(r.qualityLevel);
    setCompressionLevel(r.compressionLevel);
  }, [open, rfbRef, status]);

  // Track fullscreen changes (user pressing Esc exits fullscreen externally)
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  // ── RFB setters ─────────────────────────────────────────────────────────────

  const setScale = useCallback((v: boolean) => {
    setScaleViewport(v);
    if (rfbRef.current) rfbRef.current.scaleViewport = v;
  }, [rfbRef]);

  const setClip = useCallback((v: boolean) => {
    setClipViewport(v);
    if (rfbRef.current) rfbRef.current.clipViewport = v;
  }, [rfbRef]);

  const setViewOnlyMode = useCallback((v: boolean) => {
    setViewOnly(v);
    if (rfbRef.current) rfbRef.current.viewOnly = v;
  }, [rfbRef]);

  const setQuality = useCallback((v: number) => {
    setQualityLevel(v);
    if (rfbRef.current) rfbRef.current.qualityLevel = v;
  }, [rfbRef]);

  const setCompression = useCallback((v: number) => {
    setCompressionLevel(v);
    if (rfbRef.current) rfbRef.current.compressionLevel = v;
  }, [rfbRef]);

  const handleClipboardPaste = useCallback(async () => {
    if (!rfbRef.current) return;
    try {
      const text = await navigator.clipboard.readText();
      rfbRef.current.clipboardPasteFrom(text);
      setClipboardMsg('Pasted!');
    } catch {
      setClipboardMsg('No permission');
    } finally {
      if (clipboardTimer.current) clearTimeout(clipboardTimer.current);
      clipboardTimer.current = setTimeout(() => setClipboardMsg(''), 2000);
    }
  }, [rfbRef]);

  const handleFullscreen = useCallback(() => {
    const el = sessionRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, [sessionRef]);

  const handleCtrlAltDel = useCallback(() => {
    rfbRef.current?.sendCtrlAltDel();
  }, [rfbRef]);

  return (
    // The panel + tab handle are absolutely positioned inside the VNC session
    <div ref={panelRef} className="absolute inset-y-0 right-0 flex items-center z-10 pointer-events-none">

      {/* Slide-out panel */}
      <div
        className={`
          pointer-events-auto
          h-full flex flex-col gap-5 overflow-y-auto
          bg-surface-alt/95 backdrop-blur-sm border-l border-border
          transition-all duration-250 ease-in-out
          ${open ? 'w-56 px-4 py-5 opacity-100' : 'w-0 px-0 py-0 opacity-0 overflow-hidden'}
        `}
        aria-hidden={!open}
      >
        {open && (
          <>
            <Section title="Display">
              <Toggle label="Scale to fit" checked={scaleViewport} onChange={setScale} disabled={!connected} />
              <Toggle label="Clip viewport" checked={clipViewport} onChange={setClip} disabled={!connected} />
            </Section>

            <div className="border-t border-border" />

            <Section title="Quality">
              <SliderRow label="Video quality" value={qualityLevel} min={0} max={9} onChange={setQuality} disabled={!connected} />
              <SliderRow label="Compression" value={compressionLevel} min={0} max={9} onChange={setCompression} disabled={!connected} />
            </Section>

            <div className="border-t border-border" />

            <Section title="Input">
              <Toggle label="View only" checked={viewOnly} onChange={setViewOnlyMode} disabled={!connected} />
              <button
                onClick={handleClipboardPaste}
                disabled={!connected}
                className="flex items-center gap-2 text-xs text-text-primary px-2 py-1.5 rounded-md hover:bg-surface-hover transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                <IconClipboard />
                <span>{clipboardMsg || 'Paste clipboard'}</span>
              </button>
              <button
                onClick={handleCtrlAltDel}
                disabled={!connected}
                className="flex items-center gap-2 text-xs text-text-primary px-2 py-1.5 rounded-md hover:bg-surface-hover transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                <span className="font-mono text-[11px] text-text-secondary">⌨</span>
                <span>Ctrl+Alt+Del</span>
              </button>
            </Section>

            <div className="border-t border-border" />

            <Section title="Window">
              <button
                onClick={handleFullscreen}
                className="flex items-center gap-2 text-xs text-text-primary px-2 py-1.5 rounded-md hover:bg-surface-hover transition-colors"
              >
                {isFullscreen ? <IconExitFullscreen /> : <IconFullscreen />}
                <span>{isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}</span>
              </button>
            </Section>

            <div className="mt-auto border-t border-border pt-4">
              <button
                onClick={onDisconnect}
                className="flex items-center gap-2 text-xs text-red-400 px-2 py-1.5 rounded-md hover:bg-red-500/10 transition-colors w-full"
              >
                <IconPower />
                <span>Disconnect</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Sticky tab handle — always visible */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close VNC controls' : 'Open VNC controls'}
        className="
          pointer-events-auto
          flex flex-col items-center justify-center gap-1
          w-5 py-5 shrink-0
          bg-surface-alt/90 backdrop-blur-sm
          border border-r-0 border-border
          rounded-l-md
          text-text-secondary hover:text-text-primary hover:bg-surface-hover
          transition-colors
          cursor-pointer
        "
        style={{ writingMode: 'vertical-rl' }}
      >
        {open ? <IconChevronRight /> : <IconChevronLeft />}
        <span
          className="text-[10px] tracking-widest font-medium select-none"
          style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}
        >
          CONTROLS
        </span>
      </button>
    </div>
  );
}

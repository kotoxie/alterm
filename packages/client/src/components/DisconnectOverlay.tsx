import { useEffect, useState } from 'react';

const AUTO_CLOSE_SECONDS = 15;

interface DisconnectOverlayProps {
  show: boolean;
  message?: string;
  onExit: () => void;
  onReconnect: () => void;
}

export function DisconnectOverlay({ show, message, onExit, onReconnect }: DisconnectOverlayProps) {
  const [countdown, setCountdown] = useState(AUTO_CLOSE_SECONDS);

  useEffect(() => {
    if (!show) { setCountdown(AUTO_CLOSE_SECONDS); return; }

    setCountdown(AUTO_CLOSE_SECONDS);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) { clearInterval(interval); onExit(); return 0; }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  if (!show) return null;

  const circumference = 2 * Math.PI * 18; // r=18
  const progress = (countdown / AUTO_CLOSE_SECONDS) * circumference;

  return (
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
          {message && (
            <p className="text-text-secondary text-xs mt-1 break-words max-w-xs">{message}</p>
          )}
        </div>

        {/* Countdown ring */}
        <div className="flex flex-col items-center gap-1">
          <div className="relative w-12 h-12">
            <svg className="w-12 h-12 -rotate-90" viewBox="0 0 44 44">
              <circle cx="22" cy="22" r="18" fill="none" stroke="currentColor" strokeWidth="3" className="text-border" />
              <circle
                cx="22" cy="22" r="18" fill="none" stroke="currentColor" strokeWidth="3"
                className="text-red-400 transition-all duration-1000 ease-linear"
                strokeDasharray={circumference}
                strokeDashoffset={circumference - progress}
                strokeLinecap="round"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-text-primary tabular-nums">
              {countdown}
            </span>
          </div>
          <p className="text-xs text-text-secondary">Closing tab automatically</p>
        </div>

        <div className="flex gap-3 w-full">
          <button onClick={onExit}
            className="flex-1 py-2 px-3 text-sm border border-border rounded-lg hover:bg-surface-hover text-text-secondary transition-colors">
            Close now
          </button>
          <button onClick={onReconnect}
            className="flex-1 py-2 px-3 text-sm bg-accent text-white rounded-lg hover:bg-accent-hover font-medium transition-colors">
            Reconnect
          </button>
        </div>
      </div>
    </div>
  );
}

import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { useSettings } from '../hooks/useSettings';
import { useVersionCheck } from '../hooks/useVersionCheck';

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-yellow-500',
  'bg-red-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-500',
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function getAvatarColor(username: string) {
  return AVATAR_COLORS[hashStr(username) % AVATAR_COLORS.length];
}

function autoInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return displayName.slice(0, 2).toUpperCase();
}

interface HeaderProps {
  onToggleSidebar: () => void;
  onOpenSettings: (section?: string) => void;
}

export function Header({ onToggleSidebar, onOpenSettings }: HeaderProps) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { settings } = useSettings();
  const { current: appVersion, updateAvailable, latest, releaseUrl } = useVersionCheck();

  const appName = settings['app.name'] ?? 'Alterm';
  const username = user?.username ?? '';
  const displayName = user?.displayName ?? username;
  const initials = autoInitials(displayName || username);
  const avatarColor = getAvatarColor(username);

  return (
    <header className="flex items-center justify-between h-12 px-4 bg-surface-alt border-b border-border shrink-0">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="p-1.5 rounded hover:bg-surface-hover text-text-secondary"
          title="Toggle sidebar"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>
        <span className="text-lg font-bold text-text-primary tracking-tight">{appName}</span>
        <span className="text-xs text-text-secondary opacity-60 font-mono">v{appVersion}</span>
        {updateAvailable && releaseUrl && (
          <a
            href={releaseUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/15 text-accent text-xs font-medium hover:bg-accent/25 transition-colors"
            title={`New version available: v${latest}`}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12l7-7 7 7" />
            </svg>
            v{latest} available
          </a>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded hover:bg-surface-hover text-text-secondary"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        {/* Gear / settings button */}
        <button
          onClick={() => onOpenSettings()}
          className="p-1.5 rounded hover:bg-surface-hover text-text-secondary"
          title="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {/* Avatar — opens profile section */}
        <button
          onClick={() => onOpenSettings('profile')}
          className={`w-7 h-7 rounded-full ${avatarColor} flex items-center justify-center text-white text-xs font-bold shrink-0 hover:opacity-80 transition-opacity`}
          title={`${displayName} — Profile`}
        >
          {initials}
        </button>

        <div className="flex items-center gap-1 text-sm">
          <span className="text-text-secondary">{displayName}</span>
          <button
            onClick={logout}
            className="px-2 py-1 text-text-secondary hover:text-text-primary hover:bg-surface-hover rounded text-sm"
          >
            Sign Out
          </button>
        </div>
      </div>
    </header>
  );
}

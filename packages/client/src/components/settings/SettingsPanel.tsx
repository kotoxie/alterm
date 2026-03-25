import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { ProfileSettings } from './ProfileSettings';
import { SshPrefsSettings } from './SshPrefsSettings';
import { SecuritySettings } from './SecuritySettings';
import { UsersSettings } from './UsersSettings';
import { AuditTrail } from './AuditTrail';
import { GlobalSettings } from './GlobalSettings';
import { SessionsHistory } from './SessionsHistory';
import { AuthProvidersSettings } from './AuthProvidersSettings';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialSection?: string;
}

type Section = 'profile' | 'ssh-prefs' | 'security' | 'users' | 'audit' | 'global' | 'sessions' | 'authentication';

interface NavItem {
  id: Section;
  label: string;
  adminOnly?: boolean;
  icon: React.ReactNode;
}

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 .49-3.85" />
    </svg>
  );
}

function IPIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2l-9.6 9.6" />
      <path d="M15.5 7.5l3 3L22 7l-3-3" />
    </svg>
  );
}

const MY_SETTINGS_NAV: NavItem[] = [
  { id: 'profile', label: 'Profile', icon: <UserIcon /> },
  { id: 'ssh-prefs', label: 'SSH Terminal', icon: <TerminalIcon /> },
];

const ADMIN_NAV: NavItem[] = [
  { id: 'global', label: 'General', icon: <SlidersIcon />, adminOnly: true },
  { id: 'security', label: 'Security', icon: <ShieldIcon />, adminOnly: true },
  { id: 'authentication', label: 'Authentication', icon: <KeyIcon />, adminOnly: true },
  { id: 'sessions', label: 'Recordings', icon: <HistoryIcon />, adminOnly: true },
  { id: 'audit', label: 'Audit', icon: <ListIcon />, adminOnly: true },
  { id: 'users', label: 'Users', icon: <UsersIcon />, adminOnly: true },
];

// Combine for validation
const ALL_NAV: NavItem[] = [...MY_SETTINGS_NAV, ...ADMIN_NAV];

const NAV_LABEL_MAP: Record<Section, string> = {
  'profile': 'Profile',
  'ssh-prefs': 'SSH Terminal',
  'security': 'Security',
  'users': 'Users',
  'audit': 'Audit Trail',
  'global': 'General',
  'sessions': 'Session Recordings',
  'authentication': 'Authentication',
};

export function SettingsPanel({ isOpen, onClose, initialSection }: SettingsPanelProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [expanded, setExpanded] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>(() => {
    if (initialSection && ALL_NAV.some((n) => n.id === initialSection)) {
      return initialSection as Section;
    }
    return 'profile';
  });

  useEffect(() => {
    if (initialSection && ALL_NAV.some((n) => n.id === initialSection)) {
      setActiveSection(initialSection as Section);
    }
  }, [initialSection]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  function NavButton({ item }: { item: NavItem }) {
    return (
      <button
        key={item.id}
        onClick={() => setActiveSection(item.id)}
        className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors text-left ${
          activeSection === item.id
            ? 'bg-accent/10 text-accent font-medium'
            : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
        }`}
      >
        <span className="shrink-0">{item.icon}</span>
        <span>{item.label}</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-x-0 top-12 bottom-0 z-40 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      {/* Panel — slides in from right, full height below header */}
      <div className={`absolute right-0 top-0 bottom-0 w-full flex bg-surface shadow-2xl border-l border-border transition-[max-width] duration-200 ${expanded ? 'max-w-full' : 'max-w-[1280px]'}`}>
        {/* Left nav */}
        <div className="w-52 bg-surface-alt border-r border-border flex flex-col shrink-0">
          <div className="h-12 flex items-center px-4 border-b border-border">
            <span className="text-sm font-semibold text-text-primary">Settings</span>
          </div>
          <nav className="flex-1 py-2 overflow-y-auto">
            {/* My Settings section */}
            <div className="px-4 pt-2 pb-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary/60">My Settings</span>
            </div>
            {MY_SETTINGS_NAV.map((item) => (
              <NavButton key={item.id} item={item} />
            ))}

            {/* Administration section — admin only */}
            {isAdmin && (
              <>
                <div className="px-4 pt-4 pb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary/60">Administration</span>
                </div>
                {ADMIN_NAV.map((item) => (
                  <NavButton key={item.id} item={item} />
                ))}
              </>
            )}
          </nav>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header with close button */}
          <div className="h-12 flex items-center justify-between px-6 border-b border-border shrink-0">
            <span className="text-sm font-semibold text-text-primary">
              {NAV_LABEL_MAP[activeSection]}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setExpanded((e) => !e)}
                className="p-1.5 rounded hover:bg-surface-hover text-text-secondary"
                title={expanded ? 'Restore size' : 'Expand to full width'}
              >
                {expanded ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                  </svg>
                )}
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded hover:bg-surface-hover text-text-secondary"
                title="Close settings"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeSection === 'profile' && <ProfileSettings />}
            {activeSection === 'ssh-prefs' && <SshPrefsSettings />}
            {activeSection === 'security' && isAdmin && <SecuritySettings />}
            {activeSection === 'authentication' && isAdmin && <AuthProvidersSettings />}
            {activeSection === 'users' && isAdmin && <UsersSettings />}
            {activeSection === 'audit' && isAdmin && <AuditTrail />}
            {activeSection === 'global' && isAdmin && <GlobalSettings />}
            {activeSection === 'sessions' && isAdmin && <SessionsHistory />}
          </div>
        </div>
      </div>
    </div>
  );
}

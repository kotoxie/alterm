import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { ProfileSettings } from './ProfileSettings';
import { SecuritySettings } from './SecuritySettings';
import { UsersSettings } from './UsersSettings';
import { AuditTrail } from './AuditTrail';
import { GlobalSettings } from './GlobalSettings';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialSection?: string;
}

type Section = 'profile' | 'security' | 'users' | 'audit' | 'global';

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

const NAV_ITEMS: NavItem[] = [
  { id: 'profile', label: 'Profile', icon: <UserIcon /> },
  { id: 'security', label: 'Login & Security', icon: <ShieldIcon /> },
  { id: 'users', label: 'Users', icon: <UsersIcon />, adminOnly: true },
  { id: 'audit', label: 'Audit Trail', icon: <ListIcon /> },
  { id: 'global', label: 'Global Settings', icon: <SlidersIcon />, adminOnly: true },
];

export function SettingsPanel({ isOpen, onClose, initialSection }: SettingsPanelProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [expanded, setExpanded] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>(() => {
    if (initialSection && NAV_ITEMS.some((n) => n.id === initialSection)) {
      return initialSection as Section;
    }
    return 'profile';
  });

  useEffect(() => {
    if (initialSection && NAV_ITEMS.some((n) => n.id === initialSection)) {
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

  const visibleNav = NAV_ITEMS.filter((n) => !n.adminOnly || isAdmin);

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
            {visibleNav.map((item) => (
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
            ))}
          </nav>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header with close button */}
          <div className="h-12 flex items-center justify-between px-6 border-b border-border shrink-0">
            <span className="text-sm font-semibold text-text-primary">
              {visibleNav.find((n) => n.id === activeSection)?.label}
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
            {activeSection === 'security' && <SecuritySettings />}
            {activeSection === 'users' && isAdmin && <UsersSettings />}
            {activeSection === 'audit' && <AuditTrail />}
            {activeSection === 'global' && isAdmin && <GlobalSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}

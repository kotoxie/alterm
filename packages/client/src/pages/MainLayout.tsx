import { useState, useCallback, useRef, useEffect } from 'react';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { TabBar } from '../components/TabBar';
import { SessionArea } from '../components/SessionArea';
import { SettingsPanel } from '../components/settings/SettingsPanel';
import { useSettings } from '../hooks/useSettings';
import { useAuth } from '../hooks/useAuth';

function IdleMonitor() {
  const { settings } = useSettings();
  const { logout } = useAuth();
  const lastActivity = useRef(Date.now());
  const idleMs = parseInt(settings['security.idle_timeout_minutes'] ?? '0', 10) * 60 * 1000;

  useEffect(() => {
    if (idleMs <= 0) return;
    const resetTimer = () => { lastActivity.current = Date.now(); };
    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('keydown', resetTimer);
    window.addEventListener('click', resetTimer);
    window.addEventListener('scroll', resetTimer, true);
    const interval = setInterval(() => {
      if (Date.now() - lastActivity.current > idleMs) logout();
    }, 30_000);
    return () => {
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('click', resetTimer);
      window.removeEventListener('scroll', resetTimer, true);
      clearInterval(interval);
    };
  }, [idleMs, logout]);

  return null;
}

export interface Tab {
  id: string;
  connectionId: string;
  name: string;
  protocol: 'ssh' | 'rdp' | 'smb';
  status: 'connecting' | 'connected' | 'disconnected';
}

const SIDEBAR_MIN = 150;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 240;

export function MainLayout() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string | undefined>(undefined);

  const onOpenSettings = useCallback((section?: string) => {
    setSettingsSection(section);
    setSettingsOpen(true);
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      setSidebarWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, dragStartWidth.current + delta)));
    };
    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      setIsDraggingSidebar(false);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const onDragStart = (e: React.MouseEvent) => {
    isDragging.current = true;
    setIsDraggingSidebar(true);
    dragStartX.current = e.clientX;
    dragStartWidth.current = sidebarWidth;
    e.preventDefault();
  };

  const openTab = useCallback((connection: { id: string; name: string; protocol: 'ssh' | 'rdp' | 'smb' }) => {
    const existing = tabs.find((t) => t.connectionId === connection.id && t.status !== 'disconnected');
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const tab: Tab = {
      id: crypto.randomUUID(),
      connectionId: connection.id,
      name: connection.name,
      protocol: connection.protocol,
      status: 'connecting',
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, [tabs]);

  const duplicateTab = useCallback((source: { id: string; name: string; protocol: 'ssh' | 'rdp' | 'smb' }) => {
    const tab: Tab = {
      id: crypto.randomUUID(),
      connectionId: source.id,
      name: source.name,
      protocol: source.protocol,
      status: 'connecting',
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {
        const idx = prev.findIndex((t) => t.id === tabId);
        const newActive = next[Math.min(idx, next.length - 1)]?.id ?? null;
        setActiveTabId(newActive);
      }
      return next;
    });
  }, [activeTabId]);

  const updateTabStatus = useCallback((tabId: string, status: Tab['status']) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status } : t)));
  }, []);

  return (
    <div className="flex flex-col h-screen bg-surface select-none">
      <IdleMonitor />
      <Header onToggleSidebar={() => setSidebarOpen((o) => !o)} onOpenSettings={onOpenSettings} />
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && (
          <>
            <Sidebar onConnect={openTab} onDuplicate={duplicateTab} width={sidebarWidth} />
            <div
              className="w-1 cursor-col-resize bg-border hover:bg-accent/60 active:bg-accent transition-colors shrink-0"
              onMouseDown={onDragStart}
            />
          </>
        )}
        <div className="flex flex-col flex-1 overflow-hidden relative">
          <TabBar tabs={tabs} activeTabId={activeTabId} onSelect={setActiveTabId} onClose={closeTab} onDuplicate={duplicateTab} />
          <SessionArea tabs={tabs} activeTabId={activeTabId} onStatusChange={updateTabStatus} onClose={closeTab} />

          {/* Overlay during sidebar drag — blocks mouse events reaching the RDP canvas
              and keeps the col-resize cursor consistent across the entire screen */}
          {isDraggingSidebar && (
            <div className="absolute inset-0 z-50 cursor-col-resize" />
          )}
        </div>
      </div>

      <SettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialSection={settingsSection}
      />
    </div>
  );
}

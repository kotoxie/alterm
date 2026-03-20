import { useState, useCallback } from 'react';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { TabBar } from '../components/TabBar';
import { SessionArea } from '../components/SessionArea';

export interface Tab {
  id: string;
  connectionId: string;
  name: string;
  protocol: 'ssh' | 'rdp' | 'smb';
  status: 'connecting' | 'connected' | 'disconnected';
}

export function MainLayout() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

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

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div className="flex flex-col h-screen bg-surface">
      <Header onToggleSidebar={() => setSidebarOpen((o) => !o)} />
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && <Sidebar onConnect={openTab} />}
        <div className="flex flex-col flex-1 overflow-hidden">
          <TabBar tabs={tabs} activeTabId={activeTabId} onSelect={setActiveTabId} onClose={closeTab} />
          <SessionArea tab={activeTab} onStatusChange={updateTabStatus} />
        </div>
      </div>
    </div>
  );
}

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { TabBar } from '../components/TabBar';
import { SessionsLayer } from '../components/SessionsLayer';
import { PaneOverlay } from '../components/PaneOverlay';
import { SettingsPanel } from '../components/settings/SettingsPanel';
import { useSettings } from '../hooks/useSettings';
import { useAuth } from '../hooks/useAuth';
import type { PaneNode } from '../types/panes';
import {
  addSplit,
  removeLeaf,
  countLeaves,
  getLeafIds,
  computeLeafRects,
  updateRatio,
} from '../utils/panes';

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
  protocol: 'ssh' | 'rdp' | 'smb' | 'vnc' | 'sftp' | 'ftp';
  status: 'connecting' | 'connected' | 'disconnected';
}

const SIDEBAR_MIN = 150;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 240;

const INIT_PANE = 'pane-0';

export function MainLayout() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [paneRoot, setPaneRoot] = useState<PaneNode>({ type: 'leaf', id: INIT_PANE });
  const [paneTabMap, setPaneTabMap] = useState<Record<string, string | null>>({ [INIT_PANE]: null });
  const [activePaneId, setActivePaneId] = useState<string>(INIT_PANE);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const sessionsContainerRef = useRef<HTMLDivElement>(null);

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

  // Measure sessions container for pane rect computation
  useEffect(() => {
    const el = sessionsContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sidebar drag
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

  const openTab = useCallback(
    (connection: { id: string; name: string; protocol: 'ssh' | 'rdp' | 'smb' | 'vnc' | 'sftp' | 'ftp' }) => {
      setTabs((prevTabs) => {
        const existing = prevTabs.find(
          (t) => t.connectionId === connection.id && t.status !== 'disconnected',
        );
        if (existing) {
          // Focus the pane showing this tab
          setPaneTabMap((prevMap) => {
            const entry = Object.entries(prevMap).find(([, tId]) => tId === existing.id);
            if (entry) setActivePaneId(entry[0]);
            return prevMap;
          });
          return prevTabs;
        }

        const tab: Tab = {
          id: crypto.randomUUID(),
          connectionId: connection.id,
          name: connection.name,
          protocol: connection.protocol,
          status: 'connecting',
        };

        setPaneTabMap((prevMap) => {
          // Try active pane if empty
          if (prevMap[activePaneId] === null || prevMap[activePaneId] === undefined) {
            setActivePaneId(activePaneId);
            return { ...prevMap, [activePaneId]: tab.id };
          }
          // Try any empty pane
          const emptyEntry = Object.entries(prevMap).find(([, tId]) => tId === null);
          if (emptyEntry) {
            setActivePaneId(emptyEntry[0]);
            return { ...prevMap, [emptyEntry[0]]: tab.id };
          }
          // Assign to active pane (replace)
          setActivePaneId(activePaneId);
          return { ...prevMap, [activePaneId]: tab.id };
        });

        return [...prevTabs, tab];
      });
    },
    [activePaneId],
  );

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => prev.filter((t) => t.id !== tabId));
    setPaneTabMap((prev) => {
      const next: Record<string, string | null> = {};
      for (const [pId, tId] of Object.entries(prev)) {
        next[pId] = tId === tabId ? null : tId;
      }
      return next;
    });
  }, []);

  const splitPane = useCallback(
    (tabId: string, dir: 'h' | 'v') => {
      setPaneRoot((prevRoot) => {
        if (countLeaves(prevRoot) >= 4) return prevRoot;

        const paneId =
          Object.entries(paneTabMap).find(([, t]) => t === tabId)?.[0] ?? activePaneId;
        const newPaneId = crypto.randomUUID();

        const newRoot = addSplit(prevRoot, paneId, dir, newPaneId);

        setPaneTabMap((prev) => ({ ...prev, [newPaneId]: null }));
        setActivePaneId(newPaneId);

        return newRoot;
      });
    },
    [paneTabMap, activePaneId],
  );

  const closePane = useCallback(
    (paneId: string) => {
      setPaneRoot((prevRoot) => {
        if (countLeaves(prevRoot) <= 1) return prevRoot;

        const tabId = paneTabMap[paneId];
        if (tabId) {
          setTabs((prev) => prev.filter((t) => t.id !== tabId));
        }

        const newRoot = removeLeaf(prevRoot, paneId);
        if (!newRoot) return prevRoot; // shouldn't happen since we checked count

        setPaneTabMap((prev) => {
          const next = { ...prev };
          delete next[paneId];
          return next;
        });

        if (paneId === activePaneId) {
          const remaining = getLeafIds(newRoot);
          setActivePaneId(remaining[0] ?? INIT_PANE);
        }

        return newRoot;
      });
    },
    [paneTabMap, activePaneId],
  );

  const handleTabSelect = useCallback(
    (tabId: string) => {
      // Find the pane already showing this tab
      const entry = Object.entries(paneTabMap).find(([, tId]) => tId === tabId);
      if (entry) {
        setActivePaneId(entry[0]);
      } else {
        // Assign to active pane
        setPaneTabMap((prev) => ({ ...prev, [activePaneId]: tabId }));
      }
    },
    [paneTabMap, activePaneId],
  );

  const handleUpdateRatio = useCallback((splitId: string, ratio: number) => {
    setPaneRoot((prev) => updateRatio(prev, splitId, ratio));
  }, []);

  const updateTabStatus = useCallback((tabId: string, status: Tab['status']) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status } : t)));
  }, []);

  const leafRects = useMemo(() => {
    if (containerSize.w === 0) return {};
    return computeLeafRects(paneRoot, 0, 0, containerSize.w, containerSize.h);
  }, [paneRoot, containerSize]);

  const paneCount = useMemo(() => countLeaves(paneRoot), [paneRoot]);
  const canSplit = paneCount < 4;

  // Derive activeTabId for TabBar highlighting: tab shown in active pane
  const activeTabId = paneTabMap[activePaneId] ?? null;

  return (
    <div className="flex flex-col h-screen bg-surface select-none">
      <IdleMonitor />
      <Header onToggleSidebar={() => setSidebarOpen((o) => !o)} onOpenSettings={onOpenSettings} />
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && (
          <>
            <Sidebar onConnect={openTab} width={sidebarWidth} />
            <div
              className="w-1 cursor-col-resize bg-border hover:bg-accent/60 active:bg-accent transition-colors shrink-0"
              onMouseDown={onDragStart}
            />
          </>
        )}
        <div className="flex flex-col flex-1 overflow-hidden relative">
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onTabSelect={handleTabSelect}
            onClose={closeTab}
            onSplitH={(tabId) => splitPane(tabId, 'h')}
            onSplitV={(tabId) => splitPane(tabId, 'v')}
            canSplit={canSplit}
          />

          {/* Sessions container: relative parent for both layers */}
          <div
            ref={sessionsContainerRef}
            className="flex-1 relative overflow-hidden"
          >
            <SessionsLayer
              tabs={tabs}
              paneTabMap={paneTabMap}
              leafRects={leafRects}
              activePaneId={activePaneId}
              onStatusChange={updateTabStatus}
              onClose={closeTab}
            />
            <PaneOverlay
              paneRoot={paneRoot}
              leafRects={leafRects}
              paneTabMap={paneTabMap}
              activePaneId={activePaneId}
              tabs={tabs}
              onFocusPane={setActivePaneId}
              onClosePane={closePane}
              onUpdateRatio={handleUpdateRatio}
              containerW={containerSize.w}
              containerH={containerSize.h}
            />

            {/* No sessions at all: full empty state */}
            {tabs.length === 0 && paneCount === 1 && (
              <div className="absolute inset-0 flex items-center justify-center bg-surface pointer-events-none">
                <div className="text-center text-text-secondary">
                  <p className="text-lg">No active session</p>
                  <p className="text-sm mt-1">Select a connection from the sidebar to begin</p>
                </div>
              </div>
            )}

            {/* Sidebar drag overlay: blocks mouse reaching session canvas */}
            {isDraggingSidebar && (
              <div className="absolute inset-0 z-50 cursor-col-resize" />
            )}
          </div>
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

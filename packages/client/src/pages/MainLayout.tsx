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

export interface ViewData {
  id: string;
  paneRoot: PaneNode;
  paneTabMap: Record<string, string | null>;
  activePaneId: string;
}

export interface TabBarItem {
  id: string;
  label: string;
  protocol: 'ssh' | 'rdp' | 'smb' | 'vnc' | 'sftp' | 'ftp' | 'split';
  status: 'connecting' | 'connected' | 'disconnected';
}

const SIDEBAR_MIN = 150;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 240;

function deriveTabBarItems(views: ViewData[], tabs: Tab[]): TabBarItem[] {
  return views.map((view) => {
    const paneCount = countLeaves(view.paneRoot);
    const isSplit = paneCount > 1;

    const tabIds = Object.values(view.paneTabMap).filter(Boolean) as string[];
    const viewTabs = tabIds.map((id) => tabs.find((t) => t.id === id)).filter(Boolean) as Tab[];

    let label: string;
    let protocol: TabBarItem['protocol'];
    if (isSplit) {
      label = 'Split';
      protocol = 'split';
    } else {
      const tab = viewTabs[0];
      label = tab?.name ?? 'Empty';
      protocol = tab?.protocol ?? 'ssh';
    }

    let status: Tab['status'] = 'connected';
    if (viewTabs.some((t) => t.status === 'disconnected')) status = 'disconnected';
    else if (viewTabs.some((t) => t.status === 'connecting')) status = 'connecting';

    return { id: view.id, label, protocol, status };
  });
}

export function MainLayout() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [views, setViews] = useState<ViewData[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

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

  // Refs for synchronous reads inside event-triggered callbacks
  const viewsRef = useRef<ViewData[]>(views);
  const activeViewIdRef = useRef<string | null>(activeViewId);
  useEffect(() => { viewsRef.current = views; }, [views]);
  useEffect(() => { activeViewIdRef.current = activeViewId; }, [activeViewId]);

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

  // ---------- openTab ----------
  // Opens a session from the sidebar.
  // Rule: if active view has an empty pane, fill it; otherwise create a new view.

  const openTab = useCallback(
    (connection: { id: string; name: string; protocol: 'ssh' | 'rdp' | 'smb' | 'vnc' | 'sftp' | 'ftp' }) => {
      const currentViews = viewsRef.current;
      const currentActiveViewId = activeViewIdRef.current;
      const activeView = currentActiveViewId
        ? currentViews.find((v) => v.id === currentActiveViewId) ?? null
        : null;

      const newTab: Tab = {
        id: crypto.randomUUID(),
        connectionId: connection.id,
        name: connection.name,
        protocol: connection.protocol,
        status: 'connecting',
      };

      // Case 1: active view has an empty pane — fill it
      if (activeView) {
        const emptyPaneEntry = Object.entries(activeView.paneTabMap).find(
          ([, tId]) => tId === null,
        );
        if (emptyPaneEntry) {
          const [emptyPaneId] = emptyPaneEntry;
          setTabs((prev) => [...prev, newTab]);
          setViews((prev) =>
            prev.map((v) =>
              v.id === activeView.id
                ? {
                    ...v,
                    paneTabMap: { ...v.paneTabMap, [emptyPaneId]: newTab.id },
                    activePaneId: emptyPaneId,
                  }
                : v,
            ),
          );
          return;
        }
      }

      // Case 2: create a new view
      const newPaneId = crypto.randomUUID();
      const newView: ViewData = {
        id: crypto.randomUUID(),
        paneRoot: { type: 'leaf', id: newPaneId },
        paneTabMap: { [newPaneId]: newTab.id },
        activePaneId: newPaneId,
      };
      setTabs((prev) => [...prev, newTab]);
      setViews((prev) => [...prev, newView]);
      setActiveViewId(newView.id);
    },
    [],
  );

  // ---------- splitView ----------
  // Adds a new empty pane to the specified view's pane tree alongside activePaneId.

  const splitView = useCallback((viewId: string, dir: 'h' | 'v') => {
    setViews((prev) =>
      prev.map((v) => {
        if (v.id !== viewId) return v;
        if (countLeaves(v.paneRoot) >= 4) return v;

        const newPaneId = crypto.randomUUID();
        const newRoot = addSplit(v.paneRoot, v.activePaneId, dir, newPaneId);
        return {
          ...v,
          paneRoot: newRoot,
          paneTabMap: { ...v.paneTabMap, [newPaneId]: null },
          activePaneId: newPaneId,
        };
      }),
    );
  }, []);

  // ---------- closePaneInView ----------
  // Closes the session in a pane and removes that pane from the view's layout.
  // If it was the last pane, removes the entire view.

  const closePaneInView = useCallback((paneId: string) => {
    const currentViews = viewsRef.current;
    const currentActiveViewId = activeViewIdRef.current;

    const ownerView = currentViews.find((v) => paneId in v.paneTabMap);
    if (!ownerView) return;

    const tabIdInPane = ownerView.paneTabMap[paneId] ?? null;
    const paneCount = countLeaves(ownerView.paneRoot);

    if (paneCount <= 1) {
      // Last pane — close the entire view
      if (tabIdInPane) {
        setTabs((prev) => prev.filter((t) => t.id !== tabIdInPane));
      }
      setViews((prev) => prev.filter((v) => v.id !== ownerView.id));
      if (currentActiveViewId === ownerView.id) {
        const remaining = currentViews.filter((v) => v.id !== ownerView.id);
        setActiveViewId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
      }
      return;
    }

    // Multiple panes: remove this pane from layout and close its tab
    if (tabIdInPane) {
      setTabs((prev) => prev.filter((t) => t.id !== tabIdInPane));
    }
    setViews((prev) =>
      prev.map((v) => {
        if (v.id !== ownerView.id) return v;
        const newRoot = removeLeaf(v.paneRoot, paneId);
        if (!newRoot) return v;
        const newPaneTabMap = { ...v.paneTabMap };
        delete newPaneTabMap[paneId];
        const newActivePaneId =
          v.activePaneId === paneId
            ? (getLeafIds(newRoot)[0] ?? v.activePaneId)
            : v.activePaneId;
        return {
          ...v,
          paneRoot: newRoot,
          paneTabMap: newPaneTabMap,
          activePaneId: newActivePaneId,
        };
      }),
    );
  }, []);

  // ---------- closeTabCallback ----------
  // Called from SessionsLayer when a session closes itself (passes tabId).
  // Finds which pane holds the tab and delegates to closePaneInView.

  const closeTabCallback = useCallback(
    (tabId: string) => {
      const currentViews = viewsRef.current;
      for (const v of currentViews) {
        for (const [paneId, tId] of Object.entries(v.paneTabMap)) {
          if (tId === tabId) {
            closePaneInView(paneId);
            return;
          }
        }
      }
      // Fallback: tab not in any pane map — just remove from tabs list
      setTabs((prev) => prev.filter((t) => t.id !== tabId));
    },
    [closePaneInView],
  );

  // ---------- closeView ----------
  // Closes all sessions in a view and removes it from the bar.

  const closeView = useCallback((viewId: string) => {
    const currentViews = viewsRef.current;
    const currentActiveViewId = activeViewIdRef.current;

    const view = currentViews.find((v) => v.id === viewId);
    if (!view) return;

    const tabIdsInView = Object.values(view.paneTabMap).filter(Boolean) as string[];
    setTabs((prev) => prev.filter((t) => !tabIdsInView.includes(t.id)));
    setViews((prev) => prev.filter((v) => v.id !== viewId));

    if (currentActiveViewId === viewId) {
      const remaining = currentViews.filter((v) => v.id !== viewId);
      setActiveViewId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }
  }, []);

  // ---------- focusPaneInView ----------

  const focusPaneInView = useCallback((paneId: string) => {
    setViews((prev) =>
      prev.map((v) => {
        if (!(paneId in v.paneTabMap)) return v;
        return { ...v, activePaneId: paneId };
      }),
    );
  }, []);

  // ---------- updateRatioInView ----------

  const updateRatioInView = useCallback((splitId: string, ratio: number) => {
    const currentActiveViewId = activeViewIdRef.current;
    setViews((prev) =>
      prev.map((v) => {
        if (v.id !== currentActiveViewId) return v;
        return { ...v, paneRoot: updateRatio(v.paneRoot, splitId, ratio) };
      }),
    );
  }, []);

  // ---------- updateTabStatus ----------

  const updateTabStatus = useCallback((tabId: string, status: Tab['status']) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, status } : t)));
  }, []);

  // ---------- Derived values ----------

  const activeView = useMemo(
    () => views.find((v) => v.id === activeViewId) ?? null,
    [views, activeViewId],
  );

  const leafRects = useMemo(() => {
    if (!activeView || containerSize.w === 0) return {};
    return computeLeafRects(activeView.paneRoot, 0, 0, containerSize.w, containerSize.h);
  }, [activeView, containerSize]);

  const tabBarItems = useMemo(() => deriveTabBarItems(views, tabs), [views, tabs]);

  const canSplit = useMemo(
    () => (activeView ? countLeaves(activeView.paneRoot) < 4 : false),
    [activeView],
  );

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
            tabs={tabBarItems}
            activeTabId={activeViewId}
            onTabSelect={setActiveViewId}
            onClose={closeView}
            onSplitH={(viewId) => splitView(viewId, 'h')}
            onSplitV={(viewId) => splitView(viewId, 'v')}
            canSplit={canSplit}
          />

          {/* Sessions container: relative parent for both layers */}
          <div
            ref={sessionsContainerRef}
            className="flex-1 relative overflow-hidden"
          >
            <SessionsLayer
              tabs={tabs}
              views={views}
              activeViewId={activeViewId}
              leafRects={leafRects}
              activePaneId={activeView?.activePaneId ?? null}
              onStatusChange={updateTabStatus}
              onClose={closeTabCallback}
            />

            {activeView && (
              <PaneOverlay
                paneRoot={activeView.paneRoot}
                leafRects={leafRects}
                paneTabMap={activeView.paneTabMap}
                activePaneId={activeView.activePaneId}
                tabs={tabs}
                onFocusPane={focusPaneInView}
                onClosePane={closePaneInView}
                onUpdateRatio={updateRatioInView}
                containerW={containerSize.w}
                containerH={containerSize.h}
              />
            )}

            {/* No views: full empty state */}
            {views.length === 0 && (
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

import { useState, useEffect, useRef, useCallback } from 'react';
interface FileEntry {
  filename: string;
  fileAttributes: number;
}

const ATTR_DIRECTORY = 0x10;

function isDir(f: FileEntry): boolean {
  return (f.fileAttributes & ATTR_DIRECTORY) !== 0;
}

function getFileExt(name: string): string {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}

function getFileCategory(name: string): 'image' | 'video' | 'audio' | 'archive' | 'code' | 'other' {
  const ext = getFileExt(name);
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico'].includes(ext)) return 'image';
  if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'flac', 'ogg', 'aac'].includes(ext)) return 'audio';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) return 'archive';
  if (['txt', 'md', 'json', 'xml', 'yaml', 'yml', 'js', 'ts', 'tsx', 'jsx', 'py', 'sh', 'html', 'css', 'log', 'conf', 'ini', 'toml'].includes(ext)) return 'code';
  return 'other';
}

function getTypeBadge(f: FileEntry): string {
  if (isDir(f)) return 'FOLDER';
  const ext = getFileExt(f.filename);
  return ext ? ext.toUpperCase() : 'FILE';
}

function FolderIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="text-amber-400 shrink-0">
      <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
    </svg>
  );
}

function FileIcon({ category, size = 20 }: { category: 'image' | 'video' | 'audio' | 'archive' | 'code' | 'other'; size?: number }) {
  const colorMap = {
    image: 'text-purple-400',
    video: 'text-pink-400',
    audio: 'text-green-400',
    archive: 'text-orange-400',
    code: 'text-blue-400',
    other: 'text-text-secondary',
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      className={`${colorMap[category]} shrink-0`}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

interface FileBrowserProps {
  connectionId: string;
  connectionName: string;
  isActive: boolean;
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected') => void;
  /** API path prefix, e.g. '/api/v1/sftp' */
  apiBase: string;
  /** Path separator: '/' for SFTP/FTP, '\\' for SMB */
  pathSep?: string;
}

export function FileBrowser({
  connectionId,
  connectionName,
  isActive,
  onStatusChange,
  apiBase,
  pathSep = '/',
}: FileBrowserProps) {
  const [path, setPath] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: FileEntry } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    function handleMouseDown(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setContextMenu(null);
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  // For SFTP/FTP (pathSep='/'), always produce absolute paths.
  // For SMB (pathSep='\\'), keep existing relative-join behaviour.
  const joinPath = (base: string, name: string) => {
    if (pathSep === '/') return base ? `${base}/${name}` : `/${name}`;
    return base ? `${base}${pathSep}${name}` : name;
  };

  const listDir = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError('');
    setContextMenu(null);
    setSelectedFiles(new Set());
    const isInitialConnect = dirPath === '' || dirPath === '/';    try {
      const res = await fetch(`${apiBase}/${connectionId}/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ path: dirPath }),
      });
      let d: { files?: FileEntry[]; error?: string };
      try { d = await res.json(); } catch { throw new Error(`Server error (${res.status})`); }
      if (!res.ok) throw new Error(d.error || `Server error (${res.status})`);
      setFiles((d.files as FileEntry[]).filter((f) => f.filename !== '.' && f.filename !== '..'));
      setStatus('connected');
      setPath(dirPath);
      onStatusChange?.('connected');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error';
      setError(msg);
      // Only treat the initial connection failure as a full disconnect.
      // Errors navigating subfolders (permission denied, etc.) show an inline
      // error message but keep the session alive so the user can go back.
      if (isInitialConnect) {
        setStatus('error');
        onStatusChange?.('disconnected');
      } else {
        setStatus('connected');
      }
    } finally {
      setLoading(false);
    }
  }, [connectionId, apiBase, pathSep, onStatusChange]);

  useEffect(() => {
    if (isActive) listDir(pathSep === '/' ? '/' : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, isActive]);

  function navigateTo(name: string) {
    listDir(joinPath(path, name));
  }

  function navigateUp() {
    if (pathSep === '/') {
      const parts = path.split('/').filter(Boolean);
      parts.pop();
      listDir(parts.length ? `/${parts.join('/')}` : '/');
    } else {
      const parts = path.split(pathSep).filter(Boolean);
      parts.pop();
      listDir(parts.join(pathSep));
    }
  }

  async function downloadFile(name: string) {
    const filePath = joinPath(path, name);
    try {
      const res = await fetch(`${apiBase}/${connectionId}/download?path=${encodeURIComponent(filePath)}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        let msg = 'Download failed';
        try { const d = await res.json() as { error?: string }; msg = d.error || msg; } catch { /* ignore */ }
        setError(msg); return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } catch { setError('Download failed'); }
  }

  async function deleteFile(name: string) {
    if (!window.confirm(`Delete "${name}"?`)) return;
    const filePath = joinPath(path, name);
    const res = await fetch(`${apiBase}/${connectionId}/file?path=${encodeURIComponent(filePath)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) listDir(path);
    else { const d = await res.json(); setError(d.error || 'Delete failed'); }
  }

  async function createFolder() {
    if (!newFolderName.trim()) return;
    const dirPath = joinPath(path, newFolderName.trim());
    const res = await fetch(`${apiBase}/${connectionId}/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ path: dirPath }),
    });
    if (res.ok) { setNewFolderMode(false); setNewFolderName(''); listDir(path); }
    else { const d = await res.json(); setError(d.error || 'Failed'); }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const filePath = joinPath(path, file.name);
    setUploadProgress(`Uploading ${file.name}...`);
    try {
      const res = await fetch(`${apiBase}/${connectionId}/upload?path=${encodeURIComponent(filePath)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        credentials: 'include',
        body: file,
      });
      if (res.ok) listDir(path);
      else { const d = await res.json(); setError(d.error || 'Upload failed'); }
    } catch { setError('Upload failed'); }
    setUploadProgress(null);
    e.target.value = '';
  }

  async function downloadSelected() {
    for (const name of selectedFiles) {
      const f = files.find((fi) => fi.filename === name);
      if (f && !isDir(f)) await downloadFile(name);
    }
  }

  async function deleteSelected() {
    if (!window.confirm(`Delete ${selectedFiles.size} item(s)?`)) return;
    for (const name of [...selectedFiles]) {
      const filePath = joinPath(path, name);
      await fetch(`${apiBase}/${connectionId}/file?path=${encodeURIComponent(filePath)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
    }
    setSelectedFiles(new Set());
    listDir(path);
  }

  function toggleSelect(name: string) {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function handleRowClick(f: FileEntry) {
    if (isDir(f)) navigateTo(f.filename);
  }

  function handleContextMenu(e: React.MouseEvent, f: FileEntry) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, file: f });
  }

  const pathParts = path ? path.split(pathSep).filter(Boolean) : [];
  const anySelected = selectedFiles.size > 0;
  const selectedFileCount = [...selectedFiles].filter((name) => {
    const f = files.find((fi) => fi.filename === name);
    return f && !isDir(f);
  }).length;

  const sortedFiles = [...files].sort((a, b) => {
    const aDir = isDir(a), bDir = isDir(b);
    if (aDir && !bDir) return -1;
    if (!aDir && bDir) return 1;
    return a.filename.localeCompare(b.filename);
  });

  return (
    <div className="absolute inset-0 bg-surface flex flex-col font-sans text-sm select-none">

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-alt shrink-0 border-b border-border/40">
        <div className="flex items-center gap-1 text-xs flex-1 min-w-0 overflow-x-auto">
          <span className="font-semibold text-text-primary shrink-0 mr-1">{connectionName}</span>
          <span className="text-text-secondary shrink-0">/</span>
          <button
            onClick={() => listDir(pathSep === '/' ? '/' : '')}
            className="text-text-secondary hover:text-text-primary transition-colors shrink-0 px-1"
          >
            Root
          </button>
          {pathParts.map((part, i) => (
            <span key={i} className="flex items-center gap-1 shrink-0">
              <span className="text-border">/</span>
              <button
                onClick={() => {
                  const joined = pathParts.slice(0, i + 1).join(pathSep);
                  listDir(pathSep === '/' ? `/${joined}` : joined);
                }}
                className={i === pathParts.length - 1
                  ? 'text-text-primary font-medium px-1'
                  : 'text-text-secondary hover:text-text-primary transition-colors px-1'}
              >
                {part}
              </button>
            </span>
          ))}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {path && (
            <button onClick={navigateUp} title="Go up"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <polyline points="18 15 12 9 6 15" />
              </svg>
              Up
            </button>
          )}
          <button onClick={() => listDir(path)} title="Refresh"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Refresh
          </button>
          <div className="w-px h-4 bg-border/40 mx-1" />
          <button onClick={() => setNewFolderMode(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </svg>
            New Folder
          </button>
          <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs bg-accent text-white hover:bg-accent-hover transition-colors cursor-pointer">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <polyline points="16 16 12 12 8 16" />
              <line x1="12" y1="12" x2="12" y2="21" />
              <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
            </svg>
            Upload
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
          </label>
        </div>
      </div>

      {newFolderMode && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-surface-alt shrink-0">
          <FolderIcon size={16} />
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createFolder();
              if (e.key === 'Escape') { setNewFolderMode(false); setNewFolderName(''); }
            }}
            placeholder="Folder name..."
            className="flex-1 px-2 py-1 text-sm bg-surface border border-border rounded-md text-text-primary placeholder-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button onClick={createFolder} className="px-3 py-1 text-xs bg-accent text-white rounded-md hover:bg-accent-hover transition-colors">Create</button>
          <button onClick={() => { setNewFolderMode(false); setNewFolderName(''); }}
            className="px-3 py-1 text-xs border border-border rounded-md text-text-secondary hover:bg-surface-hover transition-colors">Cancel</button>
        </div>
      )}

      {(error || uploadProgress || status === 'connecting') && (
        <div className={`px-3 py-1.5 text-xs shrink-0 flex items-center gap-2 ${
          error ? 'bg-red-500/10 text-red-400 border-b border-red-500/20' : 'bg-accent/10 text-accent border-b border-accent/20'
        }`}>
          {error ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
              <button onClick={() => setError('')} className="ml-auto hover:opacity-70">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </>
          ) : (uploadProgress || 'Connecting...')}
        </div>
      )}

      {anySelected && (
        <div className="flex items-center gap-3 px-3 py-2 bg-accent/8 border-b border-accent/20 shrink-0">
          <span className="inline-flex items-center gap-1.5 bg-accent/15 text-accent text-xs font-medium px-2 py-0.5 rounded-full">
            {selectedFiles.size} selected
          </span>
          <button onClick={() => setSelectedFiles(new Set())} className="text-xs text-text-secondary hover:text-text-primary transition-colors">Clear</button>
          <div className="flex-1" />
          {selectedFileCount > 0 && (
            <button onClick={downloadSelected}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download {selectedFileCount} file{selectedFileCount !== 1 ? 's' : ''}
            </button>
          )}
          <button onClick={deleteSelected}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            Delete {selectedFiles.size}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-24 text-text-secondary text-sm gap-2">
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            Loading...
          </div>
        )}
        {!loading && files.length === 0 && status === 'connected' && (
          <div className="flex flex-col items-center justify-center h-24 gap-2 text-text-secondary text-sm">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            Empty folder
          </div>
        )}
        {!loading && sortedFiles.length > 0 && (
          <div className="px-2 py-1.5">
            {sortedFiles.map((f) => {
              const isSelected = selectedFiles.has(f.filename);
              const category = isDir(f) ? 'other' : getFileCategory(f.filename);
              const badge = getTypeBadge(f);
              return (
                <div
                  key={f.filename}
                  className={`group flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-accent/20 ring-1 ring-accent/40 hover:bg-accent/25'
                      : 'hover:bg-surface-hover'
                  }`}
                  onClick={() => handleRowClick(f)}
                  onDoubleClick={() => { if (!isDir(f)) downloadFile(f.filename); }}
                  onContextMenu={(e) => handleContextMenu(e, f)}
                >
                  <div
                    className={`flex items-center justify-center w-4 h-4 rounded border-2 transition-all shrink-0 ${
                      isSelected
                        ? 'bg-accent border-accent text-white shadow-sm'
                        : anySelected
                          ? 'border-border/70 text-transparent hover:border-accent/60'
                          : 'border-transparent text-transparent group-hover:border-border/70'
                    }`}
                    onClick={(e) => { e.stopPropagation(); toggleSelect(f.filename); }}
                  >
                    {isSelected && <CheckIcon />}
                  </div>
                  <div className="shrink-0">
                    {isDir(f) ? <FolderIcon size={20} /> : <FileIcon category={category} size={20} />}
                  </div>
                  <span className="flex-1 text-text-primary truncate text-sm leading-none">{f.filename}</span>
                  <span className="shrink-0 text-[10px] font-medium text-text-secondary/60 tracking-wide uppercase px-1.5 py-0.5 rounded bg-surface-hover/0 group-hover:bg-surface">
                    {badge}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[140px] py-1 bg-surface-alt border border-border/60 rounded-lg shadow-xl text-sm"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {isDir(contextMenu.file) ? (
            <button
              onClick={() => { navigateTo(contextMenu.file.filename); setContextMenu(null); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-text-primary hover:bg-surface-hover transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              Open
            </button>
          ) : (
            <button
              onClick={() => { downloadFile(contextMenu.file.filename); setContextMenu(null); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-text-primary hover:bg-surface-hover transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download
            </button>
          )}
          <div className="my-1 border-t border-border/40" />
          <button
            onClick={() => { deleteFile(contextMenu.file.filename); setContextMenu(null); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

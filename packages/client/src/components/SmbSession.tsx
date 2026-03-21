import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';

interface FileEntry {
  filename: string;
  fileAttributes: number;
}

const ATTR_DIRECTORY = 0x10;

function isDir(f: FileEntry): boolean {
  return (f.fileAttributes & ATTR_DIRECTORY) !== 0;
}

interface SmbSessionProps {
  connectionId: string;
  connectionName: string;
  isActive: boolean;
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected') => void;
}

export function SmbSession({ connectionId, connectionName, isActive, onStatusChange }: SmbSessionProps) {
  const { token } = useAuth();
  const [path, setPath] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function listDir(dirPath: string) {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/smb/${connectionId}/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ path: dirPath }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      setFiles((d.files as FileEntry[]).filter((f) => f.filename !== '.' && f.filename !== '..'));
      setStatus('connected');
      setPath(dirPath);
      onStatusChange?.('connected');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error');
      setStatus('error');
      onStatusChange?.('disconnected');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isActive) listDir('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, isActive]);

  function navigateTo(name: string) {
    const newPath = path ? `${path}\\${name}` : name;
    listDir(newPath);
  }

  function navigateUp() {
    const parts = path.split('\\').filter(Boolean);
    parts.pop();
    listDir(parts.join('\\'));
  }

  async function downloadFile(name: string) {
    if (!token) return;
    const filePath = path ? `${path}\\${name}` : name;
    const res = await fetch(`/api/v1/smb/${connectionId}/download?path=${encodeURIComponent(filePath)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { setError('Download failed'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  async function deleteFile(name: string) {
    if (!token || !window.confirm(`Delete "${name}"?`)) return;
    const filePath = path ? `${path}\\${name}` : name;
    const res = await fetch(`/api/v1/smb/${connectionId}/file?path=${encodeURIComponent(filePath)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) listDir(path);
    else { const d = await res.json(); setError(d.error || 'Delete failed'); }
  }

  async function createFolder() {
    if (!token || !newFolderName.trim()) return;
    const dirPath = path ? `${path}\\${newFolderName.trim()}` : newFolderName.trim();
    const res = await fetch(`/api/v1/smb/${connectionId}/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ path: dirPath }),
    });
    if (res.ok) { setNewFolderMode(false); setNewFolderName(''); listDir(path); }
    else { const d = await res.json(); setError(d.error || 'Failed'); }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    const filePath = path ? `${path}\\${file.name}` : file.name;
    setUploadProgress(`Uploading ${file.name}...`);
    try {
      const res = await fetch(`/api/v1/smb/${connectionId}/upload?path=${encodeURIComponent(filePath)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${token}` },
        body: file,
      });
      if (res.ok) listDir(path);
      else { const d = await res.json(); setError(d.error || 'Upload failed'); }
    } catch { setError('Upload failed'); }
    setUploadProgress(null);
    e.target.value = '';
  }

  const pathParts = path ? path.split('\\').filter(Boolean) : [];

  return (
    <div className="absolute inset-0 bg-surface flex flex-col font-sans text-sm">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface-alt shrink-0 flex-wrap">
        <span className="font-semibold text-text-primary">{connectionName}</span>
        <span className="text-text-secondary">·</span>
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-xs flex-1 min-w-0 overflow-x-auto">
          <button onClick={() => listDir('')} className="text-accent hover:underline shrink-0">Root</button>
          {pathParts.map((part, i) => (
            <span key={i} className="flex items-center gap-1 shrink-0">
              <span className="text-text-secondary">/</span>
              <button
                onClick={() => listDir(pathParts.slice(0, i + 1).join('\\'))}
                className="text-accent hover:underline"
              >
                {part}
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {path && (
            <button onClick={navigateUp}
              className="px-2 py-1 text-xs border border-border rounded text-text-secondary hover:bg-surface-hover">
              Up
            </button>
          )}
          <button onClick={() => listDir(path)}
            className="px-2 py-1 text-xs border border-border rounded text-text-secondary hover:bg-surface-hover">
            Refresh
          </button>
          <button onClick={() => setNewFolderMode(true)}
            className="px-2 py-1 text-xs border border-border rounded text-text-secondary hover:bg-surface-hover">
            + Folder
          </button>
          <label className="px-2 py-1 text-xs bg-accent text-white rounded hover:bg-accent-hover cursor-pointer">
            Upload
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
          </label>
        </div>
      </div>

      {/* New folder input */}
      {newFolderMode && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface-alt shrink-0">
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createFolder(); if (e.key === 'Escape') setNewFolderMode(false); }}
            placeholder="Folder name"
            className="px-2 py-1 text-sm bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button onClick={createFolder} className="px-2 py-1 text-xs bg-accent text-white rounded">Create</button>
          <button onClick={() => setNewFolderMode(false)} className="px-2 py-1 text-xs border border-border rounded text-text-secondary">Cancel</button>
        </div>
      )}

      {/* Status bar */}
      {(error || uploadProgress || status === 'connecting') && (
        <div className={`px-3 py-1.5 text-xs shrink-0 ${error ? 'bg-red-500/10 text-red-400' : 'bg-accent/10 text-accent'}`}>
          {error || uploadProgress || 'Connecting...'}
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="flex items-center justify-center h-20 text-text-secondary text-sm">Loading...</div>}
        {!loading && files.length === 0 && status === 'connected' && (
          <div className="flex items-center justify-center h-20 text-text-secondary text-sm">Empty folder</div>
        )}
        {!loading && files.length > 0 && (
          <table className="w-full">
            <thead className="sticky top-0 bg-surface-alt border-b border-border">
              <tr className="text-xs text-text-secondary">
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium w-16">Type</th>
                <th className="px-3 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {[...files].sort((a, b) => {
                const aDir = isDir(a), bDir = isDir(b);
                if (aDir && !bDir) return -1;
                if (!aDir && bDir) return 1;
                return a.filename.localeCompare(b.filename);
              }).map((f) => (
                <tr key={f.filename}
                  className="border-b border-border/50 hover:bg-surface-hover group"
                  onDoubleClick={() => isDir(f) ? navigateTo(f.filename) : downloadFile(f.filename)}
                >
                  <td className="px-3 py-2 flex items-center gap-2 cursor-pointer">
                    {isDir(f) ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-yellow-400 shrink-0">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-secondary shrink-0">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    )}
                    <span className="text-text-primary truncate">{f.filename}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary">{isDir(f) ? 'Folder' : 'File'}</td>
                  <td className="px-3 py-2">
                    <div className="hidden group-hover:flex items-center justify-end gap-1">
                      {!isDir(f) && (
                        <button onClick={() => downloadFile(f.filename)}
                          className="p-1 rounded text-text-secondary hover:text-accent hover:bg-surface"
                          title="Download">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                        </button>
                      )}
                      <button onClick={() => deleteFile(f.filename)}
                        className="p-1 rounded text-text-secondary hover:text-red-400 hover:bg-surface"
                        title="Delete">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

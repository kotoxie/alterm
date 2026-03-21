import { useCallback, useEffect, useRef, useState } from 'react';

interface FileEntry {
  name: string;
  size: number;
  mtime: number;
}

interface FileManagerProps {
  connectionId: string;
  token: string;
  onClose: () => void;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileManager({ connectionId, token, onClose }: FileManagerProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [hostPath, setHostPath] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/connections/${connectionId}/files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setFiles(data.files ?? []);
      setHostPath(data.hostPath ?? '');
    } catch {
      // ignore
    }
  }, [connectionId, token]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    for (const file of Array.from(fileList)) {
      setUploadProgress(`Uploading ${file.name}…`);
      try {
        await fetch(
          `/api/v1/connections/${connectionId}/files/${encodeURIComponent(file.name)}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/octet-stream',
            },
            body: file,
          },
        );
      } catch {
        // ignore individual failures
      }
    }
    setUploading(false);
    setUploadProgress(null);
    fetchFiles();
  };

  const handleDelete = async (name: string) => {
    await fetch(
      `/api/v1/connections/${connectionId}/files/${encodeURIComponent(name)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    fetchFiles();
  };

  const handleDownload = (name: string) => {
    const a = document.createElement('a');
    a.href = `/api/v1/connections/${connectionId}/files/${encodeURIComponent(name)}`;
    a.download = name;
    // Auth header can't be set on anchor; open in new tab — browser will use session cookie fallback.
    // For Bearer-only auth, fetch and use blob URL instead.
    fetch(a.href, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      })
      .catch(() => {});
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleUpload(e.dataTransfer.files);
  };

  return (
    <div
      className="absolute bottom-6 left-0 right-0 bg-surface border-t border-border shadow-2xl z-30 flex flex-col"
      style={{ maxHeight: '40%', minHeight: 160 }}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-secondary">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span className="text-xs font-medium text-text-primary flex-1">File Transfer</span>
        {hostPath && (
          <span className="text-xs text-text-secondary font-mono truncate max-w-xs" title={hostPath}>
            Server: {hostPath}
          </span>
        )}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="text-xs px-2 py-0.5 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 transition-colors"
        >
          {uploading ? uploadProgress ?? 'Uploading…' : '+ Upload'}
        </button>
        <button
          onClick={onClose}
          className="ml-1 opacity-60 hover:opacity-100 transition-opacity"
          title="Close file manager"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-secondary text-xs gap-1 py-6">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-40">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>Drop files here or click Upload</span>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-text-secondary">
                <th className="text-left px-3 py-1.5 font-medium">Name</th>
                <th className="text-right px-3 py-1.5 font-medium w-20">Size</th>
                <th className="text-right px-3 py-1.5 font-medium w-36">Modified</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.name} className="border-b border-border/50 hover:bg-surface-hover group">
                  <td className="px-3 py-1.5 text-text-primary font-mono truncate max-w-xs">{f.name}</td>
                  <td className="px-3 py-1.5 text-text-secondary text-right">{fmtSize(f.size)}</td>
                  <td className="px-3 py-1.5 text-text-secondary text-right">{new Date(f.mtime).toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleDownload(f.name)}
                        title="Download"
                        className="text-accent hover:text-accent-hover"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(f.name)}
                        title="Delete"
                        className="text-red-400 hover:text-red-300"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6m4-6v6" />
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

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleUpload(e.target.files)}
      />
    </div>
  );
}

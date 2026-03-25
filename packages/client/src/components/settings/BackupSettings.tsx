import { useState, useRef } from 'react';

export function BackupSettings() {
  const [exportPassword, setExportPassword] = useState('');
  const [exportConfirm, setExportConfirm] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [importPassword, setImportPassword] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importMsg, setImportMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleExport(e: React.FormEvent) {
    e.preventDefault();
    setExportMsg(null);
    if (exportPassword.length < 8) { setExportMsg({ type: 'error', text: 'Password must be at least 8 characters.' }); return; }
    if (exportPassword !== exportConfirm) { setExportMsg({ type: 'error', text: 'Passwords do not match.' }); return; }
    setExportLoading(true);
    try {
      const res = await fetch('/api/v1/backup/export', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: exportPassword }),
      });
      if (!res.ok) { const d = await res.json() as { error: string }; setExportMsg({ type: 'error', text: d.error || 'Export failed.' }); return; }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') ?? '';
      const fname = cd.match(/filename="([^"]+)"/)?.[1] ?? 'alterm-backup.aeb';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = fname; a.click();
      URL.revokeObjectURL(url);
      setExportMsg({ type: 'success', text: `Backup downloaded: ${fname}` });
      setExportPassword(''); setExportConfirm('');
    } catch { setExportMsg({ type: 'error', text: 'Network error during export.' }); }
    finally { setExportLoading(false); }
  }

  async function doImport() {
    if (!importFile || !importPassword) return;
    setImportLoading(true); setImportMsg(null); setShowConfirm(false);
    try {
      const arrayBuf = await importFile.arrayBuffer();
      const res = await fetch('/api/v1/backup/import', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Backup-Password': importPassword },
        body: arrayBuf,
      });
      const d = await res.json() as { ok?: boolean; message?: string; error?: string; recordingsRestored?: number };
      if (!res.ok) { setImportMsg({ type: 'error', text: d.error || 'Import failed.' }); return; }
      setImportMsg({ type: 'success', text: `${d.message ?? 'Restored.'} (${d.recordingsRestored ?? 0} recordings restored)` });
      setImportFile(null); setImportPassword('');
      if (fileRef.current) fileRef.current.value = '';
    } catch { setImportMsg({ type: 'error', text: 'Network error during import.' }); }
    finally { setImportLoading(false); }
  }

  return (
    <div className="max-w-lg space-y-8">
      <section>
        <h2 className="text-base font-semibold text-text-primary mb-1">Export Backup</h2>
        <p className="text-sm text-text-secondary mb-4">
          Creates an encrypted backup containing the full database, all recordings, and the encryption key.
          Protected with AES-256-CTR + PBKDF2(200k iterations).
        </p>
        <form onSubmit={handleExport} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Backup password</label>
            <input type="password" value={exportPassword} onChange={e => setExportPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Confirm password</label>
            <input type="password" value={exportConfirm} onChange={e => setExportConfirm(e.target.value)}
              placeholder="Repeat password"
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" />
          </div>
          {exportMsg && <p className={`text-sm ${exportMsg.type === 'success' ? 'text-green-500' : 'text-red-500'}`}>{exportMsg.text}</p>}
          <button type="submit" disabled={exportLoading}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 text-sm font-medium">
            {exportLoading ? 'Creating backup…' : '↓ Download Backup'}
          </button>
        </form>
      </section>

      <hr className="border-border" />

      <section>
        <h2 className="text-base font-semibold text-text-primary mb-1">Import / Restore Backup</h2>
        <p className="text-sm text-text-secondary mb-1">
          Restores the system from a <code className="bg-surface-hover px-1 rounded text-xs">.aeb</code> backup file.
        </p>
        <p className="text-sm text-red-400 font-medium mb-4">⚠ This overwrites ALL current data — users, connections, and recordings.</p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Backup file (.aeb)</label>
            <input ref={fileRef} type="file" accept=".aeb" onChange={e => setImportFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-text-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-border file:bg-surface-hover file:text-text-primary file:cursor-pointer hover:file:bg-surface" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Backup password</label>
            <input type="password" value={importPassword} onChange={e => setImportPassword(e.target.value)}
              placeholder="Password used during export"
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" />
          </div>
          {showConfirm && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400 space-y-2">
              <p className="font-medium">This will permanently overwrite all current data. Continue?</p>
              <div className="flex gap-2">
                <button onClick={doImport} className="px-3 py-1.5 bg-red-600 text-white rounded text-sm hover:bg-red-700">Yes, restore</button>
                <button onClick={() => setShowConfirm(false)} className="px-3 py-1.5 border border-border rounded text-text-secondary hover:bg-surface-hover text-sm">Cancel</button>
              </div>
            </div>
          )}
          {importMsg && <p className={`text-sm ${importMsg.type === 'success' ? 'text-green-500' : 'text-red-500'}`}>{importMsg.text}</p>}
          {!showConfirm && (
            <button onClick={() => {
              if (!importFile) { setImportMsg({ type: 'error', text: 'Select a backup file first.' }); return; }
              if (!importPassword) { setImportMsg({ type: 'error', text: 'Enter the backup password.' }); return; }
              setImportMsg(null); setShowConfirm(true);
            }} disabled={importLoading}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 text-sm font-medium">
              {importLoading ? 'Restoring…' : '↑ Restore Backup'}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

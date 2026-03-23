import { useEffect, useState, type FormEvent } from 'react';
import type React from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useSettings, invalidateSettings } from '../../hooks/useSettings';

type Tab = 'general' | 'sessions';

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'sessions', label: 'Sessions' },
];

// All IANA timezones supported by the runtime (Intl API)
const TIMEZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
})();

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        value ? 'bg-accent' : 'bg-surface-hover border border-border'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          value ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function GlobalSettings() {
  const { token } = useAuth();
  const { settings, refresh } = useSettings();
  const [activeTab, setActiveTab] = useState<Tab>('general');

  // General
  const [appName, setAppName] = useState('Alterm');
  const [timezone, setTimezone] = useState('UTC');
  const [generalMsg, setGeneralMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savingGeneral, setSavingGeneral] = useState(false);

  // Logo
  const [logoPreview, setLogoPreview] = useState<string>('');

  // Sessions
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const [recordingRetention, setRecordingRetention] = useState('90');
  const [maxConcurrent, setMaxConcurrent] = useState('0');
  const [auditRetention, setAuditRetention] = useState('90');
  const [sessionMsg, setSessionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savingSession, setSavingSession] = useState(false);

  // Purge session history
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeMsg, setPurgeMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setAppName(settings['app.name'] ?? 'Alterm');
    setTimezone(settings['app.timezone'] ?? 'UTC');
    setLogoPreview(settings['app.logo'] ?? '');
    setRecordingEnabled(settings['session.recording_enabled'] === 'true');
    setRecordingRetention(settings['session.recording_retention_days'] ?? '90');
    setMaxConcurrent(settings['session.max_concurrent'] ?? '0');
    setAuditRetention(settings['audit.retention_days'] ?? '90');
  }, [settings]);

  async function saveSettings(updates: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    if (!token) return { ok: false, error: 'Not authenticated' };
    const res = await fetch('/api/v1/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      await refresh();
      invalidateSettings();
      return { ok: true };
    }
    const d = await res.json() as { error?: string };
    return { ok: false, error: d.error || 'Failed to save.' };
  }

  async function handleGeneralSave(e: FormEvent) {
    e.preventDefault();
    setSavingGeneral(true);
    setGeneralMsg(null);
    try {
      const result = await saveSettings({ 'app.name': appName, 'app.timezone': timezone, 'app.logo': logoPreview });
      setGeneralMsg(result.ok ? { type: 'success', text: 'Saved.' } : { type: 'error', text: result.error! });
    } catch {
      setGeneralMsg({ type: 'error', text: 'Network error.' });
    } finally {
      setSavingGeneral(false);
    }
  }

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') setLogoPreview(reader.result); };
    reader.readAsDataURL(file);
    e.target.value = ''; // reset so same file can be re-selected
  }

  async function handlePurge() {
    if (!token) return;
    setPurging(true);
    setPurgeMsg(null);
    try {
      const res = await fetch('/api/v1/sessions', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await res.json() as { ok?: boolean; deletedSessions?: number; deletedRecordings?: number; error?: string };
      if (res.ok) {
        setPurgeMsg({ type: 'success', text: `Deleted ${d.deletedSessions ?? 0} sessions and ${d.deletedRecordings ?? 0} recordings.` });
        setShowPurgeConfirm(false);
      } else {
        setPurgeMsg({ type: 'error', text: d.error || 'Failed to purge.' });
      }
    } catch {
      setPurgeMsg({ type: 'error', text: 'Network error.' });
    } finally {
      setPurging(false);
    }
  }

  async function handleSessionSave(e: FormEvent) {
    e.preventDefault();
    setSavingSession(true);
    setSessionMsg(null);
    try {
      const result = await saveSettings({
        'session.recording_enabled': String(recordingEnabled),
        'session.recording_retention_days': recordingRetention,
        'session.max_concurrent': maxConcurrent,
        'audit.retention_days': auditRetention,
      });
      setSessionMsg(result.ok ? { type: 'success', text: 'Saved.' } : { type: 'error', text: result.error! });
    } catch {
      setSessionMsg({ type: 'error', text: 'Network error.' });
    } finally {
      setSavingSession(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-border mb-6 shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === t.id
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* General */}
      {activeTab === 'general' && (
        <form onSubmit={handleGeneralSave} className="space-y-4 max-w-lg">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">App Name</label>
            <input
              type="text"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Timezone</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
            <p className="text-xs text-text-secondary mt-1">Used to display timestamps across the app.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">App Logo</label>
            <div className="flex items-center gap-3">
              {logoPreview ? (
                <img src={logoPreview} alt="Logo preview" className="h-9 w-auto max-w-[120px] object-contain rounded border border-border bg-surface p-1" />
              ) : (
                <div className="h-9 w-20 rounded border border-dashed border-border flex items-center justify-center text-xs text-text-secondary">No logo</div>
              )}
              <label className="px-3 py-1.5 bg-surface-hover border border-border rounded text-sm text-text-primary hover:bg-surface cursor-pointer">
                Upload image
                <input type="file" accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp" className="hidden" onChange={handleLogoFile} />
              </label>
              {logoPreview && (
                <button type="button" onClick={() => setLogoPreview('')}
                  className="px-3 py-1.5 border border-border rounded text-sm text-text-secondary hover:bg-surface-hover">
                  Remove
                </button>
              )}
            </div>
            <p className="text-xs text-text-secondary mt-1">PNG, JPEG, SVG or WebP, max 4 MB. Replaces the text title in the header.</p>
          </div>
          {generalMsg && (
            <p className={`text-sm ${generalMsg.type === 'success' ? 'text-green-500' : 'text-red-500'}`}>
              {generalMsg.text}
            </p>
          )}
          <button
            type="submit"
            disabled={savingGeneral}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 text-sm font-medium"
          >
            {savingGeneral ? 'Saving...' : 'Save'}
          </button>
        </form>
      )}

      {/* Sessions */}
      {activeTab === 'sessions' && (
        <div className="space-y-6 max-w-lg">
        <form onSubmit={handleSessionSave} className="space-y-4">
          <div className="flex items-center gap-3">
            <Toggle value={recordingEnabled} onChange={setRecordingEnabled} />
            <span className="text-sm text-text-secondary">Session recording enabled</span>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Recording retention (days)</label>
            <input
              type="number"
              min="1"
              value={recordingRetention}
              onChange={(e) => setRecordingRetention(e.target.value)}
              className="w-40 px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Max concurrent sessions <span className="font-normal">(0 = unlimited)</span>
            </label>
            <input
              type="number"
              min="0"
              value={maxConcurrent}
              onChange={(e) => setMaxConcurrent(e.target.value)}
              className="w-40 px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Audit log retention (days)</label>
            <input
              type="number"
              min="1"
              value={auditRetention}
              onChange={(e) => setAuditRetention(e.target.value)}
              className="w-40 px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
            />
          </div>
          {sessionMsg && (
            <p className={`text-sm ${sessionMsg.type === 'success' ? 'text-green-500' : 'text-red-500'}`}>
              {sessionMsg.text}
            </p>
          )}
          <button
            type="submit"
            disabled={savingSession}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 text-sm font-medium"
          >
            {savingSession ? 'Saving...' : 'Save'}
          </button>
        </form>

        {/* Danger zone */}
        <div className="mt-8 border border-red-500/20 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-red-400 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Danger Zone
          </h3>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-text-primary">Delete all session history</p>
              <p className="text-xs text-text-secondary mt-0.5">Permanently deletes all session records and associated recordings from disk.</p>
            </div>
            <button
              type="button"
              onClick={() => { setShowPurgeConfirm(true); setPurgeMsg(null); }}
              className="shrink-0 px-3 py-1.5 border border-red-500/40 rounded text-sm text-red-400 hover:bg-red-500/10 font-medium"
            >
              Delete History
            </button>
          </div>
          {purgeMsg && (
            <p className={`text-sm ${purgeMsg.type === 'success' ? 'text-green-500' : 'text-red-500'}`}>{purgeMsg.text}</p>
          )}
        </div>

        {/* Purge confirmation modal */}
        {showPurgeConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setShowPurgeConfirm(false); }}>
            <div className="bg-surface-alt border border-border rounded-lg shadow-xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-text-primary">Delete all session history?</h3>
                  <p className="text-sm text-text-secondary mt-1">
                    This will permanently delete <strong className="text-text-primary">all session records and every recording file</strong> from disk.
                    This action <strong className="text-red-400">cannot be undone</strong>.
                  </p>
                  <p className="text-sm text-text-secondary mt-2">An entry will be written to the Audit Trail recording this deletion.</p>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handlePurge}
                  disabled={purging}
                  className="flex-1 py-2 px-4 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 font-medium text-sm"
                >
                  {purging ? 'Deleting…' : 'Yes, delete everything'}
                </button>
                <button
                  onClick={() => setShowPurgeConfirm(false)}
                  className="px-4 py-2 border border-border rounded text-text-secondary hover:bg-surface-hover text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
        </div>
      )}
    </div>
  );
}

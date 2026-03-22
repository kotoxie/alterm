import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useSettings, invalidateSettings } from '../../hooks/useSettings';

type Tab = 'general' | 'sessions';

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'sessions', label: 'Sessions' },
];

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Vancouver',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Helsinki',
  'Europe/Athens',
  'Europe/Istanbul',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Manila',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Perth',
  'Pacific/Auckland',
  'Pacific/Honolulu',
  'Africa/Cairo',
  'Africa/Lagos',
  'Africa/Johannesburg',
];

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

  // Sessions
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const [recordingRetention, setRecordingRetention] = useState('90');
  const [maxConcurrent, setMaxConcurrent] = useState('0');
  const [auditRetention, setAuditRetention] = useState('90');
  const [sessionMsg, setSessionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savingSession, setSavingSession] = useState(false);

  useEffect(() => {
    setAppName(settings['app.name'] ?? 'Alterm');
    setTimezone(settings['app.timezone'] ?? 'UTC');
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
      const result = await saveSettings({ 'app.name': appName, 'app.timezone': timezone });
      setGeneralMsg(result.ok ? { type: 'success', text: 'Saved.' } : { type: 'error', text: result.error! });
    } catch {
      setGeneralMsg({ type: 'error', text: 'Network error.' });
    } finally {
      setSavingGeneral(false);
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
            <p className="text-sm text-text-secondary italic">Logo upload coming soon.</p>
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
        <form onSubmit={handleSessionSave} className="space-y-4 max-w-lg">
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
      )}
    </div>
  );
}

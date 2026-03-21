import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useSettings, invalidateSettings } from '../../hooks/useSettings';

type Tab = 'general' | 'sessions' | 'ssh' | 'rdp';

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'ssh', label: 'SSH' },
  { id: 'rdp', label: 'RDP' },
];

export function GlobalSettings() {
  const { token } = useAuth();
  const { settings, refresh } = useSettings();
  const [activeTab, setActiveTab] = useState<Tab>('general');

  // General
  const [appName, setAppName] = useState('Alterm');
  const [generalMsg, setGeneralMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savingGeneral, setSavingGeneral] = useState(false);

  // Sessions
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const [recordingRetention, setRecordingRetention] = useState('90');
  const [maxConcurrent, setMaxConcurrent] = useState('0');
  const [auditRetention, setAuditRetention] = useState('90');
  const [sessionMsg, setSessionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savingSession, setSavingSession] = useState(false);

  // SSH
  const [sshFontSize, setSshFontSize] = useState('14');
  const [sshFontFamily, setSshFontFamily] = useState('Cascadia Code, Fira Code, Menlo, Monaco, Courier New, monospace');
  const [sshScrollback, setSshScrollback] = useState('5000');
  const [sshCursorStyle, setSshCursorStyle] = useState<'block' | 'bar' | 'underline'>('block');
  const [sshMsg, setSshMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savingSsh, setSavingSsh] = useState(false);

  // RDP
  const [rdpPort, setRdpPort] = useState('3389');
  const [rdpWidth, setRdpWidth] = useState('1920');
  const [rdpHeight, setRdpHeight] = useState('1080');
  const [rdpMsg, setRdpMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savingRdp, setSavingRdp] = useState(false);

  useEffect(() => {
    setAppName(settings['app.name'] ?? 'Alterm');
    setRecordingEnabled(settings['session.recording_enabled'] === 'true');
    setRecordingRetention(settings['session.recording_retention_days'] ?? '90');
    setMaxConcurrent(settings['session.max_concurrent'] ?? '0');
    setAuditRetention(settings['audit.retention_days'] ?? '90');
    setSshFontSize(settings['ssh.font_size'] ?? '14');
    setSshFontFamily(settings['ssh.font_family'] ?? 'Cascadia Code, Fira Code, Menlo, Monaco, Courier New, monospace');
    setSshScrollback(settings['ssh.scrollback'] ?? '5000');
    setSshCursorStyle((settings['ssh.cursor_style'] as 'block' | 'bar' | 'underline') ?? 'block');
    setRdpPort(settings['rdp.default_port'] ?? '3389');
    setRdpWidth(settings['rdp.default_width'] ?? '1920');
    setRdpHeight(settings['rdp.default_height'] ?? '1080');
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
    const d = await res.json();
    return { ok: false, error: d.error || 'Failed to save.' };
  }

  async function handleGeneralSave(e: FormEvent) {
    e.preventDefault();
    setSavingGeneral(true);
    setGeneralMsg(null);
    try {
      const result = await saveSettings({ 'app.name': appName });
      setGeneralMsg(result.ok
        ? { type: 'success', text: 'Saved.' }
        : { type: 'error', text: result.error! });
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
      setSessionMsg(result.ok
        ? { type: 'success', text: 'Saved.' }
        : { type: 'error', text: result.error! });
    } catch {
      setSessionMsg({ type: 'error', text: 'Network error.' });
    } finally {
      setSavingSession(false);
    }
  }

  async function handleSshSave(e: FormEvent) {
    e.preventDefault();
    setSavingSsh(true);
    setSshMsg(null);
    try {
      const result = await saveSettings({
        'ssh.font_size': sshFontSize,
        'ssh.font_family': sshFontFamily,
        'ssh.scrollback': sshScrollback,
        'ssh.cursor_style': sshCursorStyle,
      });
      setSshMsg(result.ok
        ? { type: 'success', text: 'Saved. New sessions will use these settings.' }
        : { type: 'error', text: result.error! });
    } catch {
      setSshMsg({ type: 'error', text: 'Network error.' });
    } finally {
      setSavingSsh(false);
    }
  }

  async function handleRdpSave(e: FormEvent) {
    e.preventDefault();
    setSavingRdp(true);
    setRdpMsg(null);
    try {
      const result = await saveSettings({
        'rdp.default_port': rdpPort,
        'rdp.default_width': rdpWidth,
        'rdp.default_height': rdpHeight,
      });
      setRdpMsg(result.ok
        ? { type: 'success', text: 'Saved.' }
        : { type: 'error', text: result.error! });
    } catch {
      setRdpMsg({ type: 'error', text: 'Network error.' });
    } finally {
      setSavingRdp(false);
    }
  }

  const sshPreviewStyle = {
    fontFamily: sshFontFamily,
    fontSize: `${sshFontSize}px`,
  };

  return (
    <div className="space-y-6 max-w-lg">
      {/* Tab bar */}
      <div className="flex border-b border-border">
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
        <form onSubmit={handleGeneralSave} className="space-y-4">
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
            <label className="block text-sm font-medium text-text-secondary mb-1">App Logo</label>
            <p className="text-sm text-text-secondary italic">Logo upload coming soon.</p>
          </div>
          {generalMsg && (
            <p className={`text-sm ${generalMsg.type === 'success' ? 'text-green-500' : 'text-red-500'}`}>
              {generalMsg.text}
            </p>
          )}
          <button type="submit" disabled={savingGeneral}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 text-sm font-medium">
            {savingGeneral ? 'Saving...' : 'Save'}
          </button>
        </form>
      )}

      {/* Sessions */}
      {activeTab === 'sessions' && (
        <form onSubmit={handleSessionSave} className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setRecordingEnabled((v) => !v)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                recordingEnabled ? 'bg-accent' : 'bg-surface-hover border border-border'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                recordingEnabled ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </button>
            <span className="text-sm text-text-secondary">Session recording enabled</span>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Recording retention (days)</label>
            <input type="number" min="1" value={recordingRetention} onChange={(e) => setRecordingRetention(e.target.value)}
              className="w-40 px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Max concurrent sessions <span className="font-normal">(0 = unlimited)</span>
            </label>
            <input type="number" min="0" value={maxConcurrent} onChange={(e) => setMaxConcurrent(e.target.value)}
              className="w-40 px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Audit log retention (days)</label>
            <input type="number" min="1" value={auditRetention} onChange={(e) => setAuditRetention(e.target.value)}
              className="w-40 px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" />
          </div>

          {sessionMsg && (
            <p className={`text-sm ${sessionMsg.type === 'success' ? 'text-green-500' : 'text-red-500'}`}>
              {sessionMsg.text}
            </p>
          )}
          <button type="submit" disabled={savingSession}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 text-sm font-medium">
            {savingSession ? 'Saving...' : 'Save'}
          </button>
        </form>
      )}

      {/* SSH */}
      {activeTab === 'ssh' && (
        <form onSubmit={handleSshSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Font Size (px)</label>
              <input type="number" min="8" max="32" value={sshFontSize} onChange={(e) => setSshFontSize(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Scrollback Lines</label>
              <input type="number" min="100" max="100000" value={sshScrollback} onChange={(e) => setSshScrollback(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Font Family</label>
            <input type="text" value={sshFontFamily} onChange={(e) => setSshFontFamily(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm font-mono" />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Cursor Style</label>
            <select value={sshCursorStyle} onChange={(e) => setSshCursorStyle(e.target.value as 'block' | 'bar' | 'underline')}
              className="px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm">
              <option value="block">Block</option>
              <option value="bar">Bar</option>
              <option value="underline">Underline</option>
            </select>
          </div>

          {/* Preview */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Preview</label>
            <div className="bg-[#0d0d0d] rounded p-3 overflow-hidden" style={sshPreviewStyle}>
              <span className="text-[#d4d4d4]">user@server:~$ </span>
              <span className="text-[#0dbc79]">ls -la /etc</span>
              <br />
              <span className="text-[#2472c8]">drwxr-xr-x</span>
              <span className="text-[#d4d4d4]">  2 root root 4096 Mar 21</span>
              <br />
              <span className="text-[#d4d4d4]">user@server:~$ </span>
              <span className="bg-[#a6a6a6] text-[#0d0d0d]">&nbsp;</span>
            </div>
          </div>

          {sshMsg && (
            <p className={`text-sm ${sshMsg.type === 'success' ? 'text-green-500' : 'text-red-500'}`}>
              {sshMsg.text}
            </p>
          )}
          <button type="submit" disabled={savingSsh}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 text-sm font-medium">
            {savingSsh ? 'Saving...' : 'Save'}
          </button>
        </form>
      )}

      {/* RDP */}
      {activeTab === 'rdp' && (
        <form onSubmit={handleRdpSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Default Port</label>
            <input type="number" min="1" max="65535" value={rdpPort} onChange={(e) => setRdpPort(e.target.value)}
              className="w-40 px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Default Width (px)</label>
            <input type="number" min="640" value={rdpWidth} onChange={(e) => setRdpWidth(e.target.value)}
              className="w-40 px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Default Height (px)</label>
            <input type="number" min="480" value={rdpHeight} onChange={(e) => setRdpHeight(e.target.value)}
              className="w-40 px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm" />
          </div>
          {rdpMsg && (
            <p className={`text-sm ${rdpMsg.type === 'success' ? 'text-green-500' : 'text-red-500'}`}>
              {rdpMsg.text}
            </p>
          )}
          <button type="submit" disabled={savingRdp}
            className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 text-sm font-medium">
            {savingRdp ? 'Saving...' : 'Save'}
          </button>
        </form>
      )}
    </div>
  );
}

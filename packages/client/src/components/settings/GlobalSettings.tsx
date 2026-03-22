import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useSettings, invalidateSettings } from '../../hooks/useSettings';
import { SSH_THEMES, THEME_NAMES, DEFAULT_THEME, type SshThemeName } from '../../lib/sshThemes';

type Tab = 'general' | 'sessions' | 'ssh';

const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'ssh', label: 'SSH' },
];

const FONT_FAMILIES = [
  { label: 'Monospace', value: 'monospace' },
  { label: 'Fira Code', value: '"Fira Code", monospace' },
  { label: 'Source Code Pro', value: '"Source Code Pro", monospace' },
  { label: 'Inconsolata', value: '"Inconsolata", monospace' },
  { label: 'Ubuntu Mono', value: '"Ubuntu Mono", monospace' },
  { label: 'Roboto Mono', value: '"Roboto Mono", monospace' },
  { label: 'Hack', value: '"Hack", monospace' },
];

const FONT_SIZES = Array.from({ length: 23 }, (_, i) => i + 10); // 10..32

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

function Select<T extends string>({
  value,
  onChange,
  options,
  className = '',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={`px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function SshPreview({
  fontFamily,
  fontSize,
  cursorStyle,
  cursorBlink,
  theme,
}: {
  fontFamily: string;
  fontSize: string;
  cursorStyle: 'block' | 'bar' | 'underline';
  cursorBlink: boolean;
  theme: SshThemeName;
}) {
  const t = SSH_THEMES[theme];
  const [blink, setBlink] = useState(true);

  useEffect(() => {
    if (!cursorBlink) { setBlink(true); return; }
    const interval = setInterval(() => setBlink((v) => !v), 530);
    return () => clearInterval(interval);
  }, [cursorBlink]);

  const cursorEl =
    cursorStyle === 'block' ? (
      <span
        style={{
          display: 'inline-block',
          width: '0.6em',
          height: '1.2em',
          background: blink ? t.cursor : 'transparent',
          verticalAlign: 'text-bottom',
        }}
      />
    ) : cursorStyle === 'underline' ? (
      <span
        style={{
          display: 'inline-block',
          width: '0.6em',
          height: '2px',
          background: blink ? t.cursor : 'transparent',
          verticalAlign: 'baseline',
          marginBottom: '-1px',
        }}
      />
    ) : (
      <span
        style={{
          display: 'inline-block',
          width: '2px',
          height: '1.2em',
          background: blink ? t.cursor : 'transparent',
          verticalAlign: 'text-bottom',
        }}
      />
    );

  return (
    <div
      className="rounded overflow-hidden flex-1 min-h-0"
      style={{ background: t.bg, fontFamily, fontSize: `${fontSize}px`, lineHeight: 1.5, padding: '14px 16px' }}
    >
      {/* Line 1: prompt + command */}
      <div>
        <span style={{ color: t.green }}>user@server</span>
        <span style={{ color: t.fg }}>:</span>
        <span style={{ color: t.blue }}>~</span>
        <span style={{ color: t.fg }}>$ </span>
        <span style={{ color: t.fg }}>ls -la /var/log</span>
      </div>
      {/* Line 2: output */}
      <div>
        <span style={{ color: t.blue }}>drwxr-xr-x</span>
        <span style={{ color: t.fg }}> 2 root root </span>
        <span style={{ color: t.yellow }}>4096</span>
        <span style={{ color: t.fg }}> Mar 22 10:41 </span>
        <span style={{ color: t.cyan }}>syslog</span>
      </div>
      {/* Line 3: output */}
      <div>
        <span style={{ color: t.blue }}>-rw-r--r--</span>
        <span style={{ color: t.fg }}> 1 root root </span>
        <span style={{ color: t.yellow }}>18234</span>
        <span style={{ color: t.fg }}> Mar 22 09:15 </span>
        <span style={{ color: t.fg }}>kern.log</span>
      </div>
      {/* Line 4: new prompt with cursor */}
      <div>
        <span style={{ color: t.green }}>user@server</span>
        <span style={{ color: t.fg }}>:</span>
        <span style={{ color: t.blue }}>~</span>
        <span style={{ color: t.fg }}>$ </span>
        {cursorEl}
      </div>
    </div>
  );
}

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
  const [sshFontFamily, setSshFontFamily] = useState('"Fira Code", monospace');
  const [sshScrollback, setSshScrollback] = useState('5000');
  const [sshCursorStyle, setSshCursorStyle] = useState<'block' | 'bar' | 'underline'>('block');
  const [sshCursorBlink, setSshCursorBlink] = useState(true);
  const [sshTheme, setSshTheme] = useState<SshThemeName>(DEFAULT_THEME);
  const [sshMsg, setSshMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savingSsh, setSavingSsh] = useState(false);

  useEffect(() => {
    setAppName(settings['app.name'] ?? 'Alterm');
    setRecordingEnabled(settings['session.recording_enabled'] === 'true');
    setRecordingRetention(settings['session.recording_retention_days'] ?? '90');
    setMaxConcurrent(settings['session.max_concurrent'] ?? '0');
    setAuditRetention(settings['audit.retention_days'] ?? '90');
    setSshFontSize(settings['ssh.font_size'] ?? '14');
    setSshFontFamily(settings['ssh.font_family'] ?? '"Fira Code", monospace');
    setSshScrollback(settings['ssh.scrollback'] ?? '5000');
    setSshCursorStyle((settings['ssh.cursor_style'] as 'block' | 'bar' | 'underline') ?? 'block');
    setSshCursorBlink(settings['ssh.cursor_blink'] !== 'false');
    setSshTheme((settings['ssh.theme'] as SshThemeName) ?? DEFAULT_THEME);
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
        'ssh.cursor_blink': String(sshCursorBlink),
        'ssh.theme': sshTheme,
      });
      setSshMsg(
        result.ok
          ? { type: 'success', text: 'Saved. New sessions will use these settings.' }
          : { type: 'error', text: result.error! },
      );
    } catch {
      setSshMsg({ type: 'error', text: 'Network error.' });
    } finally {
      setSavingSsh(false);
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

      {/* SSH — two-column: controls | preview */}
      {activeTab === 'ssh' && (
        <form onSubmit={handleSshSave} className="flex gap-8 flex-1 min-h-0">
          {/* Left: controls */}
          <div className="flex flex-col gap-5 w-72 shrink-0 overflow-y-auto pr-2">
            {/* Font */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3">Font</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Font Family</label>
                  <Select
                    value={sshFontFamily}
                    onChange={setSshFontFamily}
                    options={FONT_FAMILIES.map((f) => ({ value: f.value, label: f.label }))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Font Size</label>
                  <Select
                    value={sshFontSize}
                    onChange={setSshFontSize}
                    options={FONT_SIZES.map((s) => ({ value: String(s), label: `${s}px` }))}
                    className="w-full"
                  />
                </div>
              </div>
            </section>

            {/* Cursor */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3">Cursor</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Cursor Style</label>
                  <Select
                    value={sshCursorStyle}
                    onChange={setSshCursorStyle}
                    options={[
                      { value: 'block', label: 'Block' },
                      { value: 'underline', label: 'Underline' },
                      { value: 'bar', label: 'Bar' },
                    ]}
                    className="w-full"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text-secondary">Cursor Blinking</span>
                  <Toggle value={sshCursorBlink} onChange={setSshCursorBlink} />
                </div>
              </div>
            </section>

            {/* Theme */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3">Theme</h3>
              <Select
                value={sshTheme}
                onChange={setSshTheme}
                options={THEME_NAMES.map((t) => ({ value: t.id, label: t.name }))}
                className="w-full"
              />
            </section>

            {/* Scrollback */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3">Advanced</h3>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Scrollback Lines</label>
                <input
                  type="number"
                  min="100"
                  max="100000"
                  value={sshScrollback}
                  onChange={(e) => setSshScrollback(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-border rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                />
              </div>
            </section>

            {/* Save */}
            <div>
              {sshMsg && (
                <p className={`text-sm mb-2 ${sshMsg.type === 'success' ? 'text-green-500' : 'text-red-500'}`}>
                  {sshMsg.text}
                </p>
              )}
              <button
                type="submit"
                disabled={savingSsh}
                className="px-4 py-2 bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50 text-sm font-medium w-full"
              >
                {savingSsh ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          {/* Right: live preview */}
          <div className="flex-1 flex flex-col min-h-0">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3 shrink-0">
              Preview
            </h3>
            <SshPreview
              fontFamily={sshFontFamily}
              fontSize={sshFontSize}
              cursorStyle={sshCursorStyle}
              cursorBlink={sshCursorBlink}
              theme={sshTheme}
            />
          </div>
        </form>
      )}
    </div>
  );
}

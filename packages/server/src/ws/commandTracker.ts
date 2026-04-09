/**
 * SSH Command Tracker — accumulates user input, detects Enter key,
 * watches shell output for prompt patterns, and logs commands with timestamps.
 *
 * Strategy:
 * - Buffer incoming keystrokes (from `type:'data'` messages)
 * - On Enter (`\r`), snapshot the input buffer as a candidate command
 * - Watch shell output for prompt patterns to mark previous command as "complete"
 * - Detect password prompts in output → redact the next Enter input
 * - Persist each command to the ssh_commands table
 */

import { v4 as uuid } from 'uuid';
import { execute } from '../db/helpers.js';

// Common shell prompt endings: $, #, %, >, »
const PROMPT_RE = /[$#%>»]\s*$/;

// Password prompt patterns — triggers redaction of the next keystroke input.
// Matches prompts like:
//   [sudo] password for user:
//   Password:
//   Enter passphrase for key '...':
//   Enter password:
//   PIN:
const PASSWORD_PROMPT_RE = /\bpassword\b[^:]*:\s*$|enter\s+passphrase\b[^:]*:\s*$|enter\s+password\s*:\s*$|\bpin\s*:\s*$/i;

export class CommandTracker {
  private sessionDbId: string;
  private castStart: number;

  // Input accumulation
  private inputBuf = '';
  // Escape sequence consumer — true while we're inside an ANSI/VT100 escape sequence
  private inEscapeSeq = false;

  // Last command that was submitted (Enter pressed) but not yet stored
  private pendingCommand: string | null = null;
  private pendingTimestamp: string | null = null;
  private pendingElapsed = 0;

  // Collect output after the command is sent
  private outputBuf = '';
  private outputLines = 0;
  private static readonly MAX_OUTPUT_PREVIEW_LINES = 10;
  private static readonly MAX_OUTPUT_PREVIEW_CHARS = 2000;

  // Track whether we've seen the first prompt (skip login banner)
  private seenFirstPrompt = false;

  // Password prompt detection — next Enter input will be redacted
  private awaitingPassword = false;

  // Flush timer — if no prompt detected within a timeout, store command anyway
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly FLUSH_TIMEOUT_MS = 10_000;

  constructor(sessionDbId: string, castStart: number) {
    this.sessionDbId = sessionDbId;
    this.castStart = castStart;
  }

  /** Feed user input data (keystrokes heading to SSH). */
  feedInput(data: string): void {
    for (const ch of data) {
      // ── Escape-sequence consumer ─────────────────────────────────────────
      // ANSI/VT100 sequences start with ESC (\x1b).  The chars that follow
      // (e.g. "[A" for Up-arrow, "[1;5D" for Ctrl+Left, "OP" for F1) must be
      // swallowed whole, otherwise they land in inputBuf as printable garbage.
      if (ch === '\x1b') {
        this.inEscapeSeq = true;
        continue;
      }
      if (this.inEscapeSeq) {
        // Sequences terminate at a letter or '~'; also bail on unexpected
        // control chars so we never get stuck in escape-seq mode.
        if (/[a-zA-Z~]/.test(ch) || ch.charCodeAt(0) < 32 || ch === '\x7f') {
          this.inEscapeSeq = false;
        }
        continue;
      }
      // ────────────────────────────────────────────────────────────────────

      if (ch === '\r' || ch === '\n') {
        this.onEnter();
      } else if (ch === '\x7f' || ch === '\b') {
        // Backspace — remove last char from buffer
        this.inputBuf = this.inputBuf.slice(0, -1);
      } else if (ch === '\x03') {
        // Ctrl+C — clear input buffer and cancel password wait
        this.inputBuf = '';
        this.awaitingPassword = false;
        // If there's a pending command waiting for output, store it now
        if (this.pendingCommand !== null) {
          this.storeCommand('^C');
        }
      } else if (ch === '\x15') {
        // Ctrl+U — clear line
        this.inputBuf = '';
      } else if (ch === '\x17') {
        // Ctrl+W — delete last word
        this.inputBuf = this.inputBuf.replace(/\S+\s*$/, '');
      } else if (ch.charCodeAt(0) >= 32) {
        // Printable chars only.  Tab (\t = 0x09) is intentionally excluded:
        // the shell may complete "./inst<Tab>" → "./install.sh", so adding \t
        // to inputBuf would produce a truncated / incorrect command entry.
        this.inputBuf += ch;
      }
      // Ignore remaining control chars (Ctrl+D, Ctrl+Z, etc.)
    }
  }

  /** Feed shell output data (from the remote server). */
  feedOutput(data: string): void {
    if (this.pendingCommand !== null) {
      // Accumulate output for the pending command
      this.outputBuf += data;
      this.outputLines += (data.match(/\n/g) || []).length;
    }

    // Check the tail of recent output for prompt or password-prompt patterns
    const tail = (this.pendingCommand !== null ? this.outputBuf : data).slice(-400);
    const lastLine = tail.split('\n').pop() || '';

    // Detect password prompts — flag next input as sensitive
    if (PASSWORD_PROMPT_RE.test(lastLine)) {
      this.awaitingPassword = true;
      // Don't treat this as a normal prompt — return early
      return;
    }

    if (PROMPT_RE.test(lastLine)) {
      if (!this.seenFirstPrompt) {
        this.seenFirstPrompt = true;
        return;
      }
      // Prompt detected — store the pending command
      if (this.pendingCommand !== null) {
        this.storeCommand();
      }
    }
  }

  /** Called when the session ends — flush any pending command. */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pendingCommand !== null) {
      this.storeCommand();
    }
  }

  private onEnter(): void {
    // If a password prompt was detected, discard the typed input and store a redacted marker
    if (this.awaitingPassword) {
      this.inputBuf = '';
      this.awaitingPassword = false;
      // Store a redacted entry so the audit log shows something happened
      this.pendingCommand = '[password]';
      this.pendingTimestamp = new Date().toISOString();
      this.pendingElapsed = (Date.now() - this.castStart) / 1000;
      this.outputBuf = '';
      this.outputLines = 0;
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = setTimeout(() => {
        if (this.pendingCommand !== null) this.storeCommand();
      }, CommandTracker.FLUSH_TIMEOUT_MS);
      return;
    }

    const command = this.inputBuf.trim();
    this.inputBuf = '';

    if (!command) return;
    if (!this.seenFirstPrompt) return;

    // Store previous pending command if still waiting
    if (this.pendingCommand !== null) {
      this.storeCommand();
    }

    this.pendingCommand = command;
    this.pendingTimestamp = new Date().toISOString();
    this.pendingElapsed = (Date.now() - this.castStart) / 1000;
    this.outputBuf = '';
    this.outputLines = 0;

    // Start flush timer
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      if (this.pendingCommand !== null) {
        this.storeCommand();
      }
    }, CommandTracker.FLUSH_TIMEOUT_MS);
  }

  private storeCommand(override?: string): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const command = override ?? this.pendingCommand;
    if (!command) { this.resetPending(); return; }

    // Build output preview — strip the first line (echo of the command itself)
    let preview = this.outputBuf;
    // For redacted password entries, don't include any output preview
    if (command === '[password]') {
      preview = '';
    } else {
      const firstNewline = preview.indexOf('\n');
      if (firstNewline !== -1) {
        preview = preview.slice(firstNewline + 1);
      }
      // Trim to reasonable size
      const lines = preview.split('\n');
      if (lines.length > CommandTracker.MAX_OUTPUT_PREVIEW_LINES) {
        preview = lines.slice(0, CommandTracker.MAX_OUTPUT_PREVIEW_LINES).join('\n') + '\n...';
      }
      if (preview.length > CommandTracker.MAX_OUTPUT_PREVIEW_CHARS) {
        preview = preview.slice(0, CommandTracker.MAX_OUTPUT_PREVIEW_CHARS) + '...';
      }
      // Strip ANSI escape codes for cleaner storage
      preview = preview.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').trim();
    }

    const timestamp = this.pendingTimestamp || new Date().toISOString();
    const elapsed = this.pendingElapsed || (Date.now() - this.castStart) / 1000;

    try {
      execute(
        'INSERT INTO ssh_commands (id, session_id, timestamp, elapsed, command, output_preview) VALUES (?, ?, ?, ?, ?, ?)',
        [uuid(), this.sessionDbId, timestamp, elapsed, command, preview || null],
      );
    } catch (err) {
      console.error('[CommandTracker] Failed to store command:', err);
    }

    this.resetPending();
  }

  private resetPending(): void {
    this.pendingCommand = null;
    this.pendingTimestamp = null;
    this.pendingElapsed = 0;
    this.outputBuf = '';
    this.outputLines = 0;
  }
}

/**
 * SSH Command Tracker — accumulates user input, detects Enter key,
 * watches shell output for prompt patterns, and logs commands with timestamps.
 *
 * Strategy:
 * - Buffer incoming keystrokes (from `type:'data'` messages)
 * - On Enter (`\r`), snapshot the input buffer as a candidate command
 * - Watch shell output for prompt patterns to mark previous command as "complete"
 * - Persist each command to the ssh_commands table
 */

import { v4 as uuid } from 'uuid';
import { execute } from '../db/helpers.js';

// Common shell prompt endings: $, #, %, >, »
const PROMPT_RE = /[$#%>»]\s*$/;

export class CommandTracker {
  private sessionDbId: string;
  private castStart: number;

  // Input accumulation
  private inputBuf = '';

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
      if (ch === '\r' || ch === '\n') {
        this.onEnter();
      } else if (ch === '\x7f' || ch === '\b') {
        // Backspace — remove last char from buffer
        this.inputBuf = this.inputBuf.slice(0, -1);
      } else if (ch === '\x03') {
        // Ctrl+C — clear input buffer
        this.inputBuf = '';
        // If there's a pending command waiting for output, store it now
        if (this.pendingCommand !== null) {
          this.storeCommand('^C');
        }
      } else if (ch === '\x15') {
        // Ctrl+U — clear line
        this.inputBuf = '';
      } else if (ch.charCodeAt(0) >= 32 || ch === '\t') {
        // Printable chars and tab
        this.inputBuf += ch;
      }
      // Ignore other control chars (arrows, escape sequences)
    }
  }

  /** Feed shell output data (from the remote server). */
  feedOutput(data: string): void {
    if (this.pendingCommand !== null) {
      // Accumulate output for the pending command
      this.outputBuf += data;
      this.outputLines += (data.match(/\n/g) || []).length;
    }

    // Check if output ends with a prompt pattern
    // Use last 200 chars to avoid scanning huge output
    const tail = (this.pendingCommand !== null ? this.outputBuf : data).slice(-200);
    const lastLine = tail.split('\n').pop() || '';

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

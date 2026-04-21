import { useState, useRef, useEffect, useCallback } from 'react';

interface DateTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  label?: string;
  align?: 'left' | 'right';
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

export function DateTimePicker({ value, onChange, className = '', placeholder, label, align = 'left' }: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Parse value (format: "YYYY-MM-DDTHH:MM")
  const parsed = value ? new Date(value) : null;
  const [viewYear, setViewYear] = useState(parsed?.getFullYear() ?? new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth() ?? new Date().getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(parsed?.getDate() ?? null);
  const [hour, setHour] = useState(parsed?.getHours() ?? 0);
  const [minute, setMinute] = useState(parsed?.getMinutes() ?? 0);

  // Sync state when value prop changes externally
  useEffect(() => {
    if (!value) {
      setSelectedDay(null);
      return;
    }
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
      setSelectedDay(d.getDate());
      setHour(d.getHours());
      setMinute(d.getMinutes());
    }
  }, [value]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const emit = useCallback((y: number, m: number, d: number, h: number, min: number) => {
    onChange(`${y}-${pad(m + 1)}-${pad(d)}T${pad(h)}:${pad(min)}`);
  }, [onChange]);

  function handleDayClick(day: number) {
    setSelectedDay(day);
    emit(viewYear, viewMonth, day, hour, minute);
  }

  function handleHourChange(h: number) {
    setHour(h);
    if (selectedDay) emit(viewYear, viewMonth, selectedDay, h, minute);
  }

  function handleMinuteChange(m: number) {
    setMinute(m);
    if (selectedDay) emit(viewYear, viewMonth, selectedDay, hour, m);
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  }

  function handleClear() {
    setSelectedDay(null);
    onChange('');
    setOpen(false);
  }

  function handleToday() {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    setSelectedDay(now.getDate());
    setHour(now.getHours());
    setMinute(now.getMinutes());
    emit(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
  }

  // Build calendar grid
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const totalDays = daysInMonth(viewYear, viewMonth);
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);

  const displayValue = value
    ? `${pad(new Date(value).getMonth() + 1)}/${pad(new Date(value).getDate())}/${new Date(value).getFullYear()} ${pad(hour)}:${pad(minute)}`
    : '';

  return (
    <div className="relative" ref={ref}>
      {label && <span className="block text-[10px] font-medium text-text-secondary/60 mb-0.5">{label}</span>}
      <input
        type="text"
        readOnly
        value={displayValue}
        placeholder={placeholder ?? 'Select date & time'}
        onClick={() => setOpen(!open)}
        className={`cursor-pointer ${className}`}
      />
      {open && (
        <div className={`absolute top-full mt-1 z-50 bg-surface-alt border border-border rounded-lg shadow-xl p-3 w-[280px] ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={prevMonth} className="p-1 rounded hover:bg-surface-hover text-text-secondary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <span className="text-sm font-medium text-text-primary">{MONTHS[viewMonth]} {viewYear}</span>
            <button type="button" onClick={nextMonth} className="p-1 rounded hover:bg-surface-hover text-text-secondary">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 text-center mb-1">
            {DAYS.map((d) => (
              <span key={d} className="text-[10px] font-medium text-text-secondary/60">{d}</span>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, i) => {
              if (day === null) return <span key={`e-${i}`} />;
              const isSelected = day === selectedDay && viewYear === (parsed?.getFullYear() ?? -1) && viewMonth === (parsed?.getMonth() ?? -1);
              const isToday = day === new Date().getDate() && viewMonth === new Date().getMonth() && viewYear === new Date().getFullYear();
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => handleDayClick(day)}
                  className={`w-8 h-8 rounded text-xs font-medium transition-colors ${
                    isSelected
                      ? 'bg-accent text-white'
                      : isToday
                        ? 'bg-accent/15 text-accent hover:bg-accent/25'
                        : 'text-text-primary hover:bg-surface-hover'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Time selectors */}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-secondary shrink-0">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            <select
              value={hour}
              onChange={(e) => handleHourChange(Number(e.target.value))}
              className="px-2 py-1 bg-surface border border-border rounded text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>{pad(h)}</option>
              ))}
            </select>
            <span className="text-text-secondary font-bold">:</span>
            <select
              value={minute}
              onChange={(e) => handleMinuteChange(Number(e.target.value))}
              className="px-2 py-1 bg-surface border border-border rounded text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {MINUTES.map((m) => (
                <option key={m} value={m}>{pad(m)}</option>
              ))}
            </select>
          </div>

          {/* Footer */}
          <div className="flex justify-between mt-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={handleToday}
              className="px-2 py-1 text-xs text-accent hover:text-accent-hover hover:bg-surface-hover rounded font-medium"
            >
              Today
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover rounded"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

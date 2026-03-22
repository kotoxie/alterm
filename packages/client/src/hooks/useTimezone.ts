import { useSettings } from './useSettings';

export function useTimezone(): string {
  const { settings } = useSettings();
  return settings['app.timezone'] || 'UTC';
}

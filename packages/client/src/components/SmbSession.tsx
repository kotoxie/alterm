import { FileBrowser } from './FileBrowser';

interface SmbSessionProps {
  connectionId: string;
  connectionName: string;
  isActive: boolean;
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected') => void;
}

export function SmbSession(props: SmbSessionProps) {
  return <FileBrowser {...props} apiBase="/api/v1/smb" pathSep="\\" />;
}

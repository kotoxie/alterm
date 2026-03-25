import { FileBrowser } from './FileBrowser';

interface FtpSessionProps {
  connectionId: string;
  connectionName: string;
  isActive: boolean;
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected') => void;
}

export function FtpSession(props: FtpSessionProps) {
  return <FileBrowser {...props} apiBase="/api/v1/ftp" pathSep="/" />;
}

/** All supported connection protocols */
export type Protocol = 'ssh' | 'rdp' | 'smb' | 'vnc' | 'sftp' | 'ftp' | 'telnet' | 'postgres' | 'mysql';

/** Protocols that open a live remote session (tab) */
export type SessionProtocol = Protocol | 'split';

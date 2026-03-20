declare module '@devolutions/iron-remote-desktop-rdp' {
  export function init(logLevel: string): Promise<void>;

  export const Backend: {
    DesktopSize: new (width: number, height: number) => DesktopSize;
    InputTransaction: new () => InputTransaction;
    SessionBuilder: new () => SessionBuilder;
    ClipboardData: new () => ClipboardData;
    DeviceEvent: typeof DeviceEvent;
  };

  export interface DesktopSize {
    width: number;
    height: number;
    free(): void;
  }

  export interface InputTransaction {
    addEvent(event: DeviceEvent): void;
    free(): void;
  }

  export interface SessionBuilder {
    username(name: string): SessionBuilder;
    password(pass: string): SessionBuilder;
    destination(dest: string): SessionBuilder;
    proxyAddress(addr: string): SessionBuilder;
    authToken(token: string): SessionBuilder;
    serverDomain(domain: string): SessionBuilder;
    desktopSize(size: DesktopSize): SessionBuilder;
    renderCanvas(canvas: HTMLCanvasElement): SessionBuilder;
    setCursorStyleCallback(cb: (style: string) => void): SessionBuilder;
    setCursorStyleCallbackContext(ctx: unknown): SessionBuilder;
    extension(ext: Extension): SessionBuilder;
    connect(): Promise<Session>;
    free(): void;
  }

  export interface Session {
    run(): Promise<SessionTerminationInfo>;
    shutdown(): void;
    free(): void;
  }

  export interface SessionTerminationInfo {
    reason: string;
  }

  export interface ClipboardData {
    addText(text: string): void;
    addBinary(data: Uint8Array): void;
    free(): void;
  }

  export class DeviceEvent {
    static mouseButtonPressed(button: number): DeviceEvent;
    static mouseButtonReleased(button: number): DeviceEvent;
    static mouseMove(x: number, y: number): DeviceEvent;
    static wheelRotations(vertical: boolean, amount: number, unit: number): DeviceEvent;
    static keyPressed(scancode: number): DeviceEvent;
    static keyReleased(scancode: number): DeviceEvent;
    static unicodePressed(unicode: number): DeviceEvent;
    static unicodeReleased(unicode: number): DeviceEvent;
    free(): void;
  }

  export interface Extension {
    free(): void;
  }

  export function preConnectionBlob(pcb: string): Extension;
  export function displayControl(enable: boolean): Extension;
  export function kdcProxyUrl(url: string): Extension;
  export function enableCredssp(enable: boolean): Extension;
}

declare module '@devolutions/iron-remote-desktop' {
  // This module registers the <iron-remote-desktop> custom element
  // No explicit exports needed — the side effect of importing registers the element
}

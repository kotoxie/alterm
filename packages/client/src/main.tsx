import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './hooks/useAuth';
import { ThemeProvider } from './hooks/useTheme';
import './styles/globals.css';

// Global fetch intercept — fires 'alterm:unauthorized' whenever any API
// request comes back with 401. Patched once at startup, never re-patched.
const _origFetch = window.fetch.bind(window);
window.fetch = async function patchedFetch(...args: Parameters<typeof fetch>) {
  const res = await _origFetch(...args);
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('alterm:unauthorized'));
  }
  return res;
};

// Global WebSocket close intercept — fires 'alterm:unauthorized' when any
// WebSocket closes with code 4001 (session revoked by server).
const _OrigWS = window.WebSocket;
class PatchedWebSocket extends _OrigWS {
  constructor(...args: ConstructorParameters<typeof WebSocket>) {
    super(...(args as [string]));
    this.addEventListener('close', (e: CloseEvent) => {
      if (e.code === 4001) {
        window.dispatchEvent(new CustomEvent('alterm:unauthorized'));
      }
    });
  }
}
window.WebSocket = PatchedWebSocket as typeof WebSocket;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

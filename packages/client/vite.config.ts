import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

const { version } = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8')) as { version: string };

// noVNC ships a CJS build that uses top-level `await` in util/browser.js.
// This shim converts the top-level await expression to a synchronous call
// so Rollup's commonjs plugin can process the file without errors.
// The feature (WebCodecs H264 decode check) degrades gracefully when sync.
function novncTopLevelAwaitShim(): Plugin {
  return {
    name: 'novnc-toplevel-await-shim',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@novnc') || !id.includes('browser.js')) return null;
      // Replace the top-level await assignment with a synchronous no-op placeholder
      const patched = code.replace(
        /exports\.supportsWebCodecsH264Decode\s*=\s*supportsWebCodecsH264Decode\s*=\s*await\s+_checkWebCodecsH264DecodeSupport\(\);/,
        '// top-level await removed by build shim\nexports.supportsWebCodecsH264Decode = supportsWebCodecsH264Decode = false;',
      );
      if (patched === code) return null;
      return { code: patched, map: null };
    },
  };
}

export default defineConfig({
  plugins: [novncTopLevelAwaitShim(), react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['@novnc/novnc'],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://localhost:7443',
        secure: false,
      },
      '/ws': {
        target: 'wss://localhost:7443',
        secure: false,
        ws: true,
      },
    },
  },
});

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { readFileSync } from 'fs';

const { version } = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8')) as { version: string };

// noVNC ships a Babel-compiled CJS build that contains top-level `await` in
// util/browser.js (a WebCodecs H.264 capability check).  Rollup's commonjs
// plugin cannot process CJS files that contain `await` at the module scope,
// so we replace that single line with a synchronous fallback before Rollup
// ever sees the file.  The replaced feature degrades gracefully when sync.
//
// IMPORTANT: if @novnc/novnc is ever upgraded and this regex no longer
// matches, the build will throw a clear error here rather than silently
// producing a broken bundle where `RFB` ends up undefined at runtime.
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
      if (patched === code) {
        // Pattern not found — @novnc/novnc may have been upgraded and changed
        // its output.  Fail loudly here rather than producing a silent runtime
        // crash where `new RFB(...)` throws "Object is not a constructor".
        throw new Error(
          '[novnc-toplevel-await-shim] Expected pattern not found in ' + id + '. ' +
          'The @novnc/novnc package may have been updated. ' +
          'Inspect browser.js and update the regex in vite.config.ts.',
        );
      }
      return { code: patched, map: null };
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), novncTopLevelAwaitShim(), react()],
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
    // Rollup 4's @rollup/plugin-commonjs can mis-handle the `exports["default"] = void 0`
    // initialiser pattern in noVNC's Babel-compiled rfb.js, capturing the initial `void 0`
    // instead of the final RFB class.  Enabling transformMixedEsModules ensures that the
    // entire CJS wrapper is re-evaluated and the final export value is used.
    commonjsOptions: {
      transformMixedEsModules: true,
    },
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

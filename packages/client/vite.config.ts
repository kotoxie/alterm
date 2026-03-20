import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
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

import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }
          const modulePath = id.split('node_modules/')[1];
          const parts = modulePath.split('/');
          const packageName = parts[0].startsWith('@')
            ? `${parts[0]}/${parts[1]}`
            : parts[0];

          if (packageName === 'react' || packageName === 'react-dom') {
            return 'react-vendor';
          }
          if (packageName === 'motion') {
            return undefined;
          }
          if (id.includes('recharts')) {
            return 'charts-vendor';
          }
          if (id.includes('react-router')) {
            return 'router-vendor';
          }
          if (id.includes('lucide-react')) {
            return 'icons-vendor';
          }
          return `vendor-${packageName.replace('@', '').replace('/', '-')}`;
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 5173
  }
});

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src')
    }
  },
  server: {
    port: 5173,
    proxy: { '/v1/telemetry': { target: 'http://127.0.0.1:8080', ws: true } },
    host: '0.0.0.0'
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('three')) {
              return 'three';
            }
            if (id.includes('echarts')) {
              return 'echarts';
            }
            if (id.includes('gsap')) {
              return 'gsap';
            }
            return 'vendor';
          }
        }
      }
    }
  }
});
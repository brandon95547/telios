import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = `http://localhost:${process.env.TELIOS_API_PORT ?? 5178}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5179,
    proxy: { '/api': api, '/files': api },
  },
});

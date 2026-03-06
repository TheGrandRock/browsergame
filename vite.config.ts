import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
console.log('[vite.config] VITE_SPACETIMEAUTH_CLIENT_ID =', process.env.VITE_SPACETIMEAUTH_CLIENT_ID ?? '(not set)');

export default defineConfig({
  plugins: [react()],
});

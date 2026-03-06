import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  console.log('[vite.config] VITE_SPACETIMEAUTH_CLIENT_ID =', env.VITE_SPACETIMEAUTH_CLIENT_ID ?? '(not set)');
  return {
    plugins: [react()],
  };
});

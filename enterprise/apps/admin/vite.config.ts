import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  const apiTarget = environment.ADMIN_API_PROXY_TARGET || 'http://127.0.0.1:4190';

  return {
    plugins: [react()],
    server: {
      port: 4179,
      strictPort: true,
      proxy: {
        '/runtime/status': apiTarget,
        '/v1/admin': apiTarget,
      },
    },
    preview: {
      port: 4179,
      strictPort: true,
    },
  };
});

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  const apiTarget = environment.USAGE_API_PROXY_TARGET || 'http://127.0.0.1:4190';
  const authTarget = environment.USAGE_AUTH_PROXY_TARGET || 'http://127.0.0.1:4170';

  return {
    base: '/ecorex-agent/usage-panel/',
    plugins: [react()],
    server: {
      port: 4178,
      strictPort: true,
      proxy: {
        '/v1/admin': apiTarget,
        '/v1/tasks': apiTarget,
        '/v1/usage': apiTarget,
        '/v1/auth': authTarget,
      },
    },
    preview: {
      port: 4178,
      strictPort: true,
    },
  };
});

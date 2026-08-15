import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  const apiTarget = environment.USAGE_API_PROXY_TARGET || 'http://127.0.0.1:4190';

  return {
    plugins: [react()],
    server: {
      port: 4178,
      strictPort: true,
      proxy: {
        '/v1/tasks': apiTarget,
        '/v1/usage': apiTarget,
      },
    },
    preview: {
      port: 4178,
      strictPort: true,
    },
  };
});

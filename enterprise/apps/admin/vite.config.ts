import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  const apiTarget = environment.ADMIN_API_PROXY_TARGET || 'http://127.0.0.1:4190';
  const authTarget = environment.AUTH_API_PROXY_TARGET || 'http://127.0.0.1:4188';
  const modelTarget = environment.MODEL_API_PROXY_TARGET || 'http://127.0.0.1:4189';

  return {
    base: environment.ADMIN_PUBLIC_BASE || '/ecorex-agent/admin/',
    plugins: [react()],
    server: {
      port: 4179,
      strictPort: true,
      proxy: {
        '/v1/admin': apiTarget,
        '/v1/auth': authTarget,
        '/e-mate/model-api': {
          target: modelTarget,
          rewrite: (path) => path.replace(/^\/e-mate\/model-api/, ''),
        },
      },
    },
    preview: {
      port: 4179,
      strictPort: true,
    },
  };
});

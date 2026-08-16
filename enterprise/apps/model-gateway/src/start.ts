import { pathToFileURL } from 'node:url';
import { startProductionModelGateway } from './production.ts';

export async function main(configurationFile = process.env.E_MATE_MODEL_GATEWAY_CONFIG_FILE): Promise<void> {
  if (!configurationFile) {
    throw new Error('E_MATE_MODEL_GATEWAY_CONFIG_FILE is required');
  }
  const gateway = await startProductionModelGateway(configurationFile);
  const stop = () => {
    void gateway.close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.exitCode = 1;
  });
}

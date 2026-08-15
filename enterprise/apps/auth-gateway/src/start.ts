import { startProductionAuthGateway } from './production.ts';

const configPath = process.env.E_MATE_AUTH_GATEWAY_CONFIG_FILE;
if (!configPath) throw new Error('E_MATE_AUTH_GATEWAY_CONFIG_FILE is required');

const gateway = await startProductionAuthGateway(configPath);
let closing = false;

async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await gateway.close();
}

function requestClose(): void {
  void close().catch(() => {
    process.exitCode = 1;
  });
}

process.once('SIGINT', requestClose);
process.once('SIGTERM', requestClose);

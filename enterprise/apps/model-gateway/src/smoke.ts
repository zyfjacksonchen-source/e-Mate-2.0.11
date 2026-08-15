import { pathToFileURL } from 'node:url';
import { runModelSmoke, ModelSmokeError } from './modelSmoke.ts';
import { loadProductionConfiguration } from './production.ts';

function options(args: readonly string[]): { configurationFile?: string; operator: string } {
  let configurationFile: string | undefined;
  let operator: string | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!value || (name !== '--config' && name !== '--operator')) throw new Error('Invalid smoke options');
    if (name === '--config' && configurationFile === undefined) configurationFile = value;
    else if (name === '--operator' && operator === undefined) operator = value;
    else throw new Error('Invalid smoke options');
  }
  if (!operator) throw new Error('Invalid smoke options');
  return { configurationFile, operator };
}

export async function main(
  args = process.argv.slice(2),
  environment: Readonly<Record<string, string | undefined>> = process.env
): Promise<void> {
  const parsed = options(args);
  const configurationFile = parsed.configurationFile ?? environment.E_MATE_MODEL_GATEWAY_CONFIG_FILE;
  if (!configurationFile) throw new Error('Invalid smoke options');
  const configuration = loadProductionConfiguration(configurationFile);
  const approval = await runModelSmoke({
    routes: configuration.routes,
    catalogSha256: configuration.configurationSha256,
    operator: parsed.operator,
    timeoutMs: configuration.upstreamTimeoutMs,
    onResult: (result) => {
      process.stderr.write(`${JSON.stringify(result)}\n`);
    },
  });
  process.stdout.write(`${JSON.stringify(approval, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        status: 'FAILED',
        code: error instanceof ModelSmokeError ? error.code : 'SMOKE_SETUP_FAILED',
        ...(error instanceof ModelSmokeError && error.routeId ? { routeId: error.routeId } : {}),
      })}\n`
    );
    process.exitCode = 1;
  });
}

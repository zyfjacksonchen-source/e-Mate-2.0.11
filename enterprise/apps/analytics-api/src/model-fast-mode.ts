import { execFile } from 'node:child_process';
import { parseAdminModelFastMode, type AdminModelFastMode, type AdminModelFastModeUpdate } from '@e-mate/admin-contract';
import type { RuntimeRegistryPrincipal } from './runtime-registry.ts';

export type ModelFastModeConfiguration = {
  tenantId: string;
  sshHost: string;
  privateKeyFile: string;
  knownHostsFile: string;
};

export class ModelFastModeError extends Error {
  readonly code: 'CONFLICT' | 'UNAVAILABLE' | 'FORBIDDEN';
  constructor(code: 'CONFLICT' | 'UNAVAILABLE' | 'FORBIDDEN') {
    super(code);
    this.code = code;
  }
}

export type ModelFastModeControl = {
  read(principal: RuntimeRegistryPrincipal): Promise<AdminModelFastMode>;
  update(principal: RuntimeRegistryPrincipal, input: AdminModelFastModeUpdate): Promise<AdminModelFastMode>;
};

const MAX_CONCURRENT_SSH_CONTROLS = 2;

export function createModelFastModeControl(configuration: ModelFastModeConfiguration): ModelFastModeControl {
  let activeControls = 0;
  let writeGeneration = 0;
  let readFlight: { generation: number; promise: Promise<AdminModelFastMode> } | undefined;

  const reject = (code: 'FORBIDDEN' | 'UNAVAILABLE') => Promise.reject<AdminModelFastMode>(new ModelFastModeError(code));
  const execute = (principal: RuntimeRegistryPrincipal, update?: AdminModelFastModeUpdate) => {
    activeControls += 1;
    return new Promise<string>((resolve, rejectExecution) => {
      const child = execFile('ssh', [
        '-F', '/dev/null', '-T', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
        '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5',
        '-o', `UserKnownHostsFile=${configuration.knownHostsFile}`,
        '-i', configuration.privateKeyFile, `root@${configuration.sshHost}`, 'emate-gpt-fast-mode-v1',
      ], { timeout: 15_000, maxBuffer: 64 * 1024, encoding: 'utf8' }, (error, output) => {
        if (error) rejectExecution(new ModelFastModeError('UNAVAILABLE'));
        else resolve(output);
      });
      child.stdin?.on('error', () => rejectExecution(new ModelFastModeError('UNAVAILABLE')));
      child.stdin?.end(JSON.stringify({ tenantId: principal.tenantId, actorId: principal.userId, ...(update ? { update } : {}) }));
    }).then((stdout) => {
      const value = JSON.parse(stdout);
      if (value?.error === 'CONFLICT') throw new ModelFastModeError('CONFLICT');
      return parseAdminModelFastMode(value);
    }).catch((error: unknown) => {
      if (error instanceof ModelFastModeError) throw error;
      throw new ModelFastModeError('UNAVAILABLE');
    }).finally(() => {
      activeControls -= 1;
    });
  };

  const read = (principal: RuntimeRegistryPrincipal) => {
    if (principal.tenantId !== configuration.tenantId) return reject('FORBIDDEN');
    const generation = writeGeneration;
    if (readFlight?.generation === generation) return readFlight.promise;
    if (activeControls >= MAX_CONCURRENT_SSH_CONTROLS) return reject('UNAVAILABLE');
    const flight = { generation, promise: execute(principal) };
    readFlight = flight;
    void flight.promise.finally(() => {
      if (readFlight === flight) readFlight = undefined;
    }).catch(() => undefined);
    return flight.promise;
  };

  const update = (principal: RuntimeRegistryPrincipal, input: AdminModelFastModeUpdate) => {
    if (principal.tenantId !== configuration.tenantId) return reject('FORBIDDEN');
    if (activeControls >= MAX_CONCURRENT_SSH_CONTROLS) return reject('UNAVAILABLE');
    writeGeneration += 1;
    return execute(principal, input);
  };

  return { read, update };
}

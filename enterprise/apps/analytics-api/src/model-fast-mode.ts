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

export function createModelFastModeControl(configuration: ModelFastModeConfiguration): ModelFastModeControl {
  const execute = async (principal: RuntimeRegistryPrincipal, update?: AdminModelFastModeUpdate) => {
    if (principal.tenantId !== configuration.tenantId) throw new ModelFastModeError('FORBIDDEN');
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile('ssh', [
        '-F', '/dev/null', '-T', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
        '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5',
        '-o', `UserKnownHostsFile=${configuration.knownHostsFile}`,
        '-i', configuration.privateKeyFile, `root@${configuration.sshHost}`, 'emate-gpt-fast-mode-v1',
      ], { timeout: 15_000, maxBuffer: 64 * 1024, encoding: 'utf8' }, (error, output) => {
        if (error) reject(new ModelFastModeError('UNAVAILABLE'));
        else resolve(output);
      });
      child.stdin?.on('error', () => reject(new ModelFastModeError('UNAVAILABLE')));
      child.stdin?.end(JSON.stringify({ tenantId: principal.tenantId, actorId: principal.userId, ...(update ? { update } : {}) }));
    });
    try {
      const value = JSON.parse(stdout);
      if (value?.error === 'CONFLICT') throw new ModelFastModeError('CONFLICT');
      return parseAdminModelFastMode(value);
    } catch (error) {
      if (error instanceof ModelFastModeError) throw error;
      throw new ModelFastModeError('UNAVAILABLE');
    }
  };
  return { read: (principal) => execute(principal), update: (principal, input) => execute(principal, input) };
}

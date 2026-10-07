/** Shared deployment validation for Host and container analysis environments. @module */
import Schema from '@deepseek-ai/schemastery'
import { isAbsolute } from 'node:path'
import type { SecurityEnvironment } from './workbench/providers.ts'

/** Operator fields shared by the profile schema and standalone environment files. */
export const securityEnvironmentSchema: Schema<SecurityEnvironment> = Schema.object({
  id: Schema.string().required(),
  kind: Schema.union(['local', 'docker', 'android'] as const).required(),
  label: Schema.string().required(),
  cwd: Schema.string().required(),
  deviceId: Schema.string(),
  image: Schema.string(),
  externalContainer: Schema.union([Schema.const(undefined), Schema.object({
    name: Schema.string().pattern(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u).required(),
    workdir: Schema.string().pattern(/^\/[^\0]*$/u).required(),
  })]),
  tools: Schema.array(Schema.object({
    id: Schema.string().required(), command: Schema.string().required(),
    prefixArgs: Schema.array(Schema.string()),
    versionArgs: Schema.array(Schema.string()).required(), source: Schema.string().required(),
  })).required(),
})

/** Validate relationships after field validation and before any execution.
 * @param environments - configured analysis environments.
 */
export function validateSecurityEnvironments(environments: readonly SecurityEnvironment[]): void {
  if (new Set(environments.map(environment => environment.id)).size !== environments.length)
    throw new Error('Environment IDs must be unique')
  for (const environment of environments) {
    if (['containerId', 'resolvedImageId', 'exchangeRoot', 'webTarget', 'manifest'].some(key => Object.hasOwn(environment, key)))
      throw new Error('Environment configuration cannot contain manager-owned runtime fields')
    if (!isAbsolute(environment.cwd)) throw new Error('Environment working directories must be absolute Host paths')
    if (new Set(environment.tools.map(tool => tool.id)).size !== environment.tools.length)
      throw new Error('Tool IDs must be unique within an environment')
    if (environment.externalContainer && (environment.kind !== 'docker' || environment.image !== undefined))
      throw new Error('externalContainer requires a Docker environment without an image')
    if (environment.kind === 'docker' && !environment.tools.some(tool => tool.id === 'docker'))
      throw new Error('Docker environments require a configured docker tool for the Host endpoint')
  }
}

/** Parse an operator-owned environment document without probing or starting containers.
 * @param input - decoded JSON deployment data.
 * @returns validated environments with no measured runtime state.
 */
export function parseSecurityEnvironments(input: unknown): SecurityEnvironment[] {
  const parse = Schema.array(securityEnvironmentSchema).required() as Schema<unknown, SecurityEnvironment[], 'defined'>
  const environments = parse(input)
  validateSecurityEnvironments(environments)
  return environments
}

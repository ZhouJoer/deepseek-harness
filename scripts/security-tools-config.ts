/** Source security launcher's tool catalog and execution-environment overlay. @module */
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { load, dump } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { parseSecurityEnvironments } from '../packages/experimental/security-analysis/src/security-environment-config.ts'
import type { SecurityEnvironment } from '../packages/experimental/security-analysis/src/workbench/providers.ts'
import { writeSecurityToolsFile } from '../packages/experimental/security-analysis/src/local-tools.ts'
export { readSecurityTools, standaloneTool, writeSecurityToolsFile } from '../packages/experimental/security-analysis/src/local-tools.ts'

/** Checkout-local installations; .dsh is excluded from version control. */
export const securityToolsFile = resolve('.dsh/security-tools.json')

/** Environments merged by identity into the security profile. */
export interface SecurityEnvironmentsConfiguration {
  environments: SecurityEnvironment[]
  defaultEnvironmentIds?: string[]
}

/** Read environment declarations with the same validation as the workbench.
 * @param path - operator-owned JSON file; an absent file contributes no environments.
 * @returns validated declarations with relative working directories resolved beside the file.
 */
export function readSecurityEnvironments(path: string): SecurityEnvironmentsConfiguration {
  let input: string
  try { input = readFileSync(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { environments: [] }
    throw error
  }
  const data: unknown = JSON.parse(input)
  if (!data || typeof data !== 'object' || Array.isArray(data) || !('environments' in data))
    throw new Error(`${path}: expected an object with an environments array`)
  const environments = parseSecurityEnvironments(Array.isArray(data.environments) ? data.environments.map((environment: unknown) => {
    if (environment && typeof environment === 'object' && 'cwd' in environment && typeof environment.cwd === 'string' && environment.cwd.trim())
      return { ...environment, cwd: resolve(dirname(path), environment.cwd) }
    return environment
  }) : data.environments)
  if (!('defaultEnvironmentIds' in data)) return { environments }
  const defaults: unknown = data.defaultEnvironmentIds
  if (!Array.isArray(defaults) || defaults.length === 0 ||
    !defaults.every((id: unknown): id is string => typeof id === 'string' && id.length > 0) || new Set(defaults).size !== defaults.length)
    throw new Error(`${path}: defaultEnvironmentIds must be a nonempty array of unique environment IDs`)
  return { environments, defaultEnvironmentIds: defaults }
}

/** Save installations if the configuration is unchanged and every environment remains valid.
 * @param path - existing environment configuration file.
 * @param configuration - validated deployment declarations to replace it.
 * @param expected - complete file text captured before probing or editing.
 */
export function writeSecurityEnvironments(path: string, configuration: SecurityEnvironmentsConfiguration, expected: string): void {
  const current = readFileSync(path, 'utf8')
  if (current !== expected) throw new Error('Security environments changed; run the command again before saving')
  parseSecurityEnvironments(configuration.environments)
  const original: unknown = JSON.parse(current)
  const declared = original && typeof original === 'object' && 'environments' in original && Array.isArray(original.environments)
    ? original.environments : []
  const environments = configuration.environments.map((environment) => {
    const previous: unknown = declared.find((item: unknown) => item && typeof item === 'object' && 'id' in item && item.id === environment.id)
    if (previous && typeof previous === 'object' && 'cwd' in previous && typeof previous.cwd === 'string' &&
      !isAbsolute(previous.cwd) && resolve(dirname(path), previous.cwd) === environment.cwd)
      return { ...environment, cwd: previous.cwd }
    return environment
  })
  writeSecurityToolsFile(path, JSON.stringify({ ...configuration, environments }, null, 2) + '\n')
}

/** Point the source security profile at the configuration shared with its operator UI.
 * @param template - repository security-workbench patch file.
 * @param path - local installation JSON file.
 * @param environmentsPath - optional execution-environment JSON beside the installation file.
 * @returns generated overlay path, preserving template fields and expressions.
 */
export function prepareSecurityToolsPatch(template: string, path: string = securityToolsFile,
  environmentsPath: string = join(dirname(path), 'security-environments.json')): string {
  const entries = load(readFileSync(template, 'utf8'), { schema: entryListSchema }) as {
    id: string
    config: {
      toolCatalogPath?: string
      toolConfiguration?: { path: string; environmentId: string }
      environments?: SecurityEnvironment[]
      taskIntake?: { defaultEnvironmentIds?: string[] }
    }
  }[]
  const workbench = entries.find(entry => entry.id === 'security-workbench')
  if (!workbench) throw new Error('Security tool configuration requires the source workbench template')
  const configured = readSecurityEnvironments(environmentsPath)
  const environments = new Map((workbench.config.environments ?? []).map(environment => [environment.id, environment]))
  for (const environment of configured.environments) environments.set(environment.id, environment)
  workbench.config.environments = [...environments.values()]
  if (configured.defaultEnvironmentIds) {
    if (!workbench.config.taskIntake) throw new Error('Default environments require taskIntake in the source workbench template')
    workbench.config.taskIntake.defaultEnvironmentIds = configured.defaultEnvironmentIds
  }
  for (const id of workbench.config.taskIntake?.defaultEnvironmentIds ?? []) {
    if (!environments.has(id)) throw new Error(`Unknown default security environment: ${id}`)
  }
  if (environments.get('local')?.kind !== 'local') throw new Error('The source security profile requires a local environment named local')
  workbench.config.toolConfiguration = { path, environmentId: 'local' }
  workbench.config.toolCatalogPath = join(dirname(path), 'security-tool-packs.json')
  const overlay = join(dirname(path), 'security-tools.generated.patch.yml')
  writeSecurityToolsFile(overlay, dump(entries, { schema: entryListSchema, lineWidth: -1, noRefs: true }))
  return overlay
}

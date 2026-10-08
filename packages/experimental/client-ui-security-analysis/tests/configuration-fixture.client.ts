/** Resolved security settings shared by client fixtures. @module */
import type { WorkbenchConfiguration } from '@deepseek-ai/dsh-experimental-security-analysis/client'

/** Build the complete configuration returned by the Host.
 * @param overrides - settings changed by one scenario.
 * @returns typed configuration snapshot.
 */
export function workbenchConfiguration(overrides: Partial<WorkbenchConfiguration> = {}): WorkbenchConfiguration {
  return {
    workspace: { cwd: '/workspace', revision: 0, configured: true, environmentIds: ['local'], maxAttempts: 3 },
    materialLimits: { bytes: 1024, entries: 10 }, projects: [],
    environments: [{ id: 'local', label: 'Lab', tools: [], kind: 'local' }], providers: [], knowledgeIntervalMs: 0,
    ...overrides,
  }
}

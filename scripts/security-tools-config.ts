/** Source security launcher's local tool configuration overlay. @module */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { load, dump } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { writeSecurityToolsFile } from '../packages/experimental/security-analysis/src/local-tools.ts'
export { readSecurityTools, standaloneTool, writeSecurityToolsFile } from '../packages/experimental/security-analysis/src/local-tools.ts'

/** Checkout-local installations; .dsh is excluded from version control. */
export const securityToolsFile = resolve('.dsh/security-tools.json')

/** Point the source security profile at the configuration shared with its operator UI.
 * @param template - repository security-workbench patch file.
 * @param path - local installation JSON file.
 * @returns generated overlay path, preserving template fields and expressions.
 */
export function prepareSecurityToolsPatch(template: string, path: string = securityToolsFile): string {
  const entries = load(readFileSync(template, 'utf8'), { schema: entryListSchema }) as {
    id: string
    config: { toolConfiguration?: { path: string; environmentId: string } }
  }[]
  const workbench = entries.find(entry => entry.id === 'security-workbench')
  if (!workbench) throw new Error('Security tool configuration requires the source workbench template')
  workbench.config.toolConfiguration = { path, environmentId: 'local' }
  const overlay = join(dirname(path), 'security-tools.generated.patch.yml')
  writeSecurityToolsFile(overlay, dump(entries, { schema: entryListSchema, lineWidth: -1, noRefs: true }))
  return overlay
}

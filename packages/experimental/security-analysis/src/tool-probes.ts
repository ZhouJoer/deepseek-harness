/** Generic probe arguments and result decoding shared by Host and CLI. @module */
import { z } from 'zod'
import type { ToolDefinition } from './tool-definitions.ts'
/** Python import and distribution names may differ.
 * @param module - importable module name.
 * @param distribution - package metadata name, defaults to the module name.
 * @returns arguments for a bounded interpreter subprocess.
 */
export function pythonModuleProbe(module: string, distribution: string = module): string[] {
  return ['-c', `import json,importlib,importlib.metadata; m=importlib.import_module(${JSON.stringify(module)}); print(json.dumps({'version':importlib.metadata.version(${JSON.stringify(distribution)}),'location':m.__file__ or ''}))`]
}
/** Resolve read-only query arguments from the definition.
 * @param tool - captured definition.
 * @param override - configured version arguments for command probes.
 * @returns query arguments without executable prefix arguments.
 */
export function probeArguments(tool: ToolDefinition, override?: string[]): string[] {
  return tool.probe.kind === 'python-module' ? pythonModuleProbe(tool.probe.module, tool.probe.distribution)
    : tool.probe.kind === 'command' ? override ?? tool.args : tool.args
}
/** Decode the declared probe format; null means an absent plugin.
 * @param tool - captured definition.
 * @param output - bounded successful subprocess output.
 * @returns measured identity, or null when the requested plugin is absent.
 */
export function probeIdentity(tool: ToolDefinition, output: string): { version: string; location?: string } | null {
  if (!output) throw new Error('Version query returned no output')
  if (tool.probe.kind === 'json-plugin') {
    const name = tool.probe.name
    const plugins = z.array(z.object({ name: z.string(), version: z.string().optional(), path: z.string().optional() }))
      .parse(JSON.parse(output))
    const plugin = plugins.find(item => item.name === name)
    return plugin ? { version: plugin.version ?? '', location: plugin.path ?? '' } : null
  }
  if (tool.probe.kind === 'identity' || tool.probe.kind === 'python-module')
    return z.object({ version: z.string(), location: z.string() }).parse(JSON.parse(output))
  return { version: output }
}

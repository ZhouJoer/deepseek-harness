/** Candidate paths declared by tool packs, shared by CLI and Host probes. @module */
import { accessSync, constants, globSync, statSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import type { ToolDefinition } from './tool-definitions.ts'
/** Find existing executables without executing them.
 * @param tool - captured definition with optional environment-relative search directories.
 * @param directories - explicit recursive search roots selected by the operator.
 * @returns distinct executable file candidates; configured pins are handled by the caller.
 */
export function toolCandidates(tool: ToolDefinition, directories: readonly string[] = []): string[] {
  const roots = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const location of tool.searchPaths) {
    const root = process.env[location.environment]
    if (root) roots.push(join(root, ...location.path))
  }
  const suffixes = process.platform === 'win32' ? ['', ...(process.env.PATHEXT ?? '.EXE;.COM').toLowerCase().split(';')] : ['']
  const names = tool.commands.flatMap(command => suffixes.map(suffix => command + suffix))
  const paths = roots.flatMap(root => names.map(name => resolve(root.replace(/^"|"$/g, ''), name)))
  for (const directory of directories) {
    if (!statSync(directory).isDirectory()) throw new Error('Search directory is not a directory: ' + directory)
    for (const name of names) paths.push(...globSync('**/' + name, {
      cwd: directory, exclude: ['**/node_modules/**', '**/.git/**'],
    }).map(path => resolve(directory, path)))
  }
  return [...new Set(paths)].filter((path) => {
    try {
      if (!statSync(path).isFile()) return false
      accessSync(path, constants.X_OK)
      return true
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) return false
      throw error
    }
  })
}

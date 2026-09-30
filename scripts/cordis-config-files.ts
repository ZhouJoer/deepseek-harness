/** Cordis Loader configuration file discovery. */

import { existsSync, globSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, posix, sep } from 'node:path'

/**
 * Return repository-relative Cordis Loader YAML paths under `root`.
 *
 * Translation consistency records are YAML sidecars, never Loader inputs.
 * Tracked link aliases resolve to their canonical config on Windows checkouts with text links.
 *
 * @param root Repository root to scan.
 * @returns Sorted repository-relative Loader configuration paths.
 */
export function cordisConfigFiles(root: string): string[] {
  const files = globSync(['**/*cordis*.yml', '**/*cordis*.yaml'], {
    cwd: root,
    exclude: ['.claude/**', 'node_modules/**', 'vendor/**', '**/*.i18n.yaml'],
  }).sort()
  const links = new Map<string, string>()
  if (existsSync(join(root, '.git'))) {
    const index = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    for (const row of index.split('\0')) {
      const match = /^120000 [a-f0-9]+ 0\t(.+)$/u.exec(row)
      if (!match?.[1]) continue
      const file = match[1]
      links.set(file, execFileSync('git', ['show', ':' + file], { cwd: root, encoding: 'utf8' }).trim())
    }
  }
  return resolveCordisConfigAliases(files, links).map(file => file.replaceAll('/', sep))
}

/**
 * Resolve tracked config aliases without changing checkout files.
 * @param files - Discovered repository-relative config paths.
 * @param links - Git link paths and their relative targets.
 * @returns Sorted unique canonical config paths; cyclic or escaping aliases throw.
 */
export function resolveCordisConfigAliases(files: readonly string[], links: ReadonlyMap<string, string>): string[] {
  const canonical = files.map((file) => {
    let path = file.replaceAll('\\', '/')
    const seen = new Set<string>()
    for (;;) {
      const target = links.get(path)
      if (target === undefined) break
      if (seen.has(path)) throw new Error(`Cordis config link cycle: ${path}`)
      seen.add(path)
      if (posix.isAbsolute(target)) throw new Error(`Cordis config link escapes repository: ${path}`)
      path = posix.normalize(posix.join(posix.dirname(path), target))
      if (path === '..' || path.startsWith('../')) throw new Error(`Cordis config link escapes repository: ${file}`)
    }
    return path
  })
  return [...new Set(canonical)].sort()
}

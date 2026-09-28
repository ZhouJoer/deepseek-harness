/** Inspect and pin existing local executables for pnpm security. @module */
import { accessSync, constants, existsSync, globSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { execa } from 'execa'
import { toolboxCatalog, pythonModuleProbe } from '../packages/experimental/security-analysis/src/toolbox.ts'
import { scrubbedParentEnv } from '../packages/subprocess/subprocess/src/index.ts'
import { readSecurityTools, securityToolsFile, standaloneTool, writeSecurityToolsFile } from './security-tools-config.ts'

function candidates(id: string, directories: string[]): string[] {
  const tool = standaloneTool(id)
  const roots = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  if (process.platform === 'win32') {
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter((root): root is string => !!root)) {
      if (id === 'tshark') roots.push(join(root, 'Wireshark'))
      if (id === 'nmap') roots.push(join(root, 'Nmap'))
    }
    if (id === 'jadx') {
      if (process.env.JADX_HOME) roots.push(join(process.env.JADX_HOME, 'bin'))
      if (process.env.USERPROFILE) roots.push(join(process.env.USERPROFILE, 'scoop', 'apps', 'jadx', 'current', 'bin'))
    }
  }
  const suffixes = process.platform === 'win32' ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').toLowerCase().split(';')] : ['']
  const names = tool.commands.flatMap(command => suffixes.map(suffix => command + suffix))
  const paths = roots.flatMap(root => names.map(name => resolve(root.replace(/^"|"$/g, ''), name)))
  for (const directory of directories) {
    if (!statSync(directory).isDirectory()) throw new Error(`Search directory is not a directory: ${directory}`)
    for (const name of names) paths.push(...globSync(`**/${name}`, {
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

async function probe(command: string, args: string[]): Promise<string> {
  if (process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(command))
    throw new Error('Select the interpreter executable and supply its launcher arguments with --arg')
  const result = await execa(command, args, {
    timeout: 15000, maxBuffer: 65536, stdin: 'ignore', windowsHide: true,
    env: scrubbedParentEnv(), extendEnv: false,
  })
  const version = (result.stdout || result.stderr).trim()
  if (!version) throw new Error('Version query returned no output')
  return version
}

/** Execute the local tool manager without installing software or starting the application.
 * @param args - action, tool identifiers and optional configuration/search paths.
 * @returns completion after read-only probes and requested pin updates.
 */
export async function manageSecurityTools(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    arg: { type: 'string', multiple: true },
    'version-arg': { type: 'string', multiple: true },
    config: { type: 'string' }, dir: { type: 'string', multiple: true }, save: { type: 'boolean' }, help: { type: 'boolean' },
  } })
  if (values.help) {
    console.log('pnpm security:tools [list | doctor [ids...] | scan [ids...] [--dir DIR] [--save] | set ID PATH | remove ID]\nOptions: --config FILE; --dir DIR (repeatable), --save (scan/doctor only); --arg=ARG, --version-arg=ARG (repeatable, set only). doctor checks Python environment details, Python modules (unicorn, r2pipe, frida) and native tools. Custom IDs supported. Refresh the toolbox after changes.')
    return
  }
  const [action = 'list', ...selected] = positionals
  if (!['list', 'scan', 'doctor', 'set', 'remove'].includes(action)) throw new Error(`Unknown action: ${action}`)
  if (values.save && action !== 'scan' && action !== 'doctor') throw new Error('--save is only valid with scan or doctor')
  if (values.dir && action !== 'scan' && action !== 'doctor') throw new Error('--dir is only valid with scan or doctor')
  if ((action === 'list' && selected.length) || (action === 'set' && selected.length !== 2) || (action === 'remove' && selected.length !== 1))
    throw new Error('Expected list, scan [ids...], set ID PATH, or remove ID; use --help')
  if (values.arg && action !== 'set') throw new Error('--arg is only valid with set')
  if (values['version-arg'] && action !== 'set') throw new Error('--version-arg is only valid with set')
  const file = resolve(values.config ?? securityToolsFile)
  let pins = readSecurityTools(file)
  const ids = action === 'set' ? selected.slice(0, 1) : selected
  for (const id of ids) {
    if (!['doctor', 'scan'].includes(action) || !toolboxCatalog.find(tool => tool.id === id)?.dependency) standaloneTool(id)
  }
  let unhealthy = false
  let available = 0
  let missing = 0
  let unchecked = 0
  if (action === 'list') {
    const custom = Object.keys(pins).filter(id => !toolboxCatalog.some(tool => tool.id === id)).map(standaloneTool)
    console.table([...toolboxCatalog, ...custom].map(tool => ({ tool: tool.id, command: pins[tool.id]?.command ?? tool.commands.join(' / '),
      prefixArgs: (pins[tool.id]?.prefixArgs ?? []).join(' '),
      versionArgs: (pins[tool.id]?.versionArgs ?? tool.args).join(' '),
      via: tool.dependency ?? tool.invocation ?? 'shell' })))
  } else if (action === 'remove') {
    pins = Object.fromEntries(Object.entries(pins).filter(([id]) => id !== selected[0]))
  } else {
    const requestedPath = action === 'set' ? selected[1] : undefined
    const requested = ids.length ? ids : [
      ...toolboxCatalog.filter(tool => tool.commands.length || tool.dependency).map(tool => tool.id), ...Object.keys(pins),
    ]
    const ordered = new Set<string>()
    for (const id of requested) {
      const dependency = toolboxCatalog.find(tool => tool.id === id)?.dependency
      if (dependency) ordered.add(dependency)
      ordered.add(id)
    }
    const resolved = new Map<string, { command: string; prefixArgs: string[] }>()
    for (const id of ordered) {
      const entry = toolboxCatalog.find(tool => tool.id === id)
      if (entry?.dependency) {
        const runtime = resolved.get(entry.dependency)
        if (!runtime) {
          unchecked++
          console.log(`${id}: not checked | ${entry.dependency} is unavailable; configure its executable first`)
          continue
        }
        try {
          const output = await probe(runtime.command, [...runtime.prefixArgs,
            ...(entry.invocation === 'python' ? pythonModuleProbe(id) : entry.args)])
          const plugin = entry.invocation === 'plugin'
            ? (JSON.parse(output) as { name: string; version?: string; path?: string }[]).find(plugin => plugin.name === id) : undefined
          if (entry.invocation === 'plugin' && !plugin) {
            missing++
            console.log(`${id}: optional/missing | via ${runtime.command}`)
            continue
          }
          available++
          const identity = entry.invocation === 'python' ? JSON.parse(output) as { version: string; location: string } : undefined
          console.log(`${id}: available | via ${runtime.command} | ${identity?.version ?? plugin?.version ?? 'installed'}`)
          if (identity) console.log(`  module: ${identity.location}`)
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          const absent = /ModuleNotFoundError|PackageNotFoundError/.test(detail)
          if (absent) missing++
          else unhealthy = true
          console.log(`${id}: ${absent ? 'optional/missing' : 'probe error'} | via ${runtime.command} | ${detail.split('\n').filter(Boolean).at(-1)}`)
        }
        continue
      }
      const explicit = requestedPath === undefined ? pins[id]?.command : resolve(requestedPath)
      const prefixArgs = action === 'set' ? values.arg ?? [] : pins[id]?.prefixArgs ?? []
      const versionArgs = id === 'python' ? standaloneTool(id).args : values['version-arg'] ?? pins[id]?.versionArgs ?? standaloneTool(id).args
      const paths = explicit ? [explicit] : candidates(id, values.dir ?? [])
      let failure = 'Executable not found; use --dir or set ID PATH'
      let found = false
      for (const command of paths) {
        try {
          if (!isAbsolute(command) || !existsSync(command) || !statSync(command).isFile()) throw new Error('Executable file does not exist')
          const version = await probe(command, [...prefixArgs, ...versionArgs])
          if (id === 'python') {
            const identity = JSON.parse(version) as {
              version: string
              location: string
              prefix: string
              basePrefix: string
              virtualEnvironment: boolean
              pipAvailable: boolean
            }
            console.log(`${id}: available | ${identity.location} | ${identity.version}`)
            console.log(`  environment: ${identity.virtualEnvironment ? 'virtualenv' : 'base'} | ${identity.prefix}`)
            console.log(`  base: ${identity.basePrefix} | pip: ${identity.pipAvailable ? 'available' : 'missing'}`)
          } else console.log(`${id}: available | ${command} | ${version.split(/\r?\n/)[0]}`)
          if (action === 'set' || values.save) pins[id] = { command, prefixArgs, versionArgs }
          resolved.set(id, { command, prefixArgs })
          available++
          found = true
          break
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error)
        }
      }
      if (!found) {
        if (action !== 'doctor' && (action === 'set' || explicit)) throw new Error(`${id}: ${failure}`)
        if (explicit) unhealthy = true
        else missing++
        console.log(`${id}: ${explicit ? 'invalid configuration' : 'optional/missing'} | ${failure.split('\n')[0]}`)
      }
    }
  }
  if (action === 'doctor') {
    console.log(`Tool check: ${available} available, ${missing} optional tools missing, ${unchecked} dependencies unchecked. Configured paths: ${file}`)
    if (unhealthy) {
      console.error('Fix invalid configurations with set or remove, or repair the reported runtime/module. No configuration changes were saved.')
      process.exitCode = 1
      return
    }
    if (!values.save) console.log('To discover portable tools and save paths: pnpm security:doctor --dir DIRECTORY --save')
  }
  if (action === 'set' || action === 'remove' || values.save) {
    writeSecurityToolsFile(file, JSON.stringify(pins, null, 2) + '\n')
    console.log(`Saved ${file}. Refresh the toolbox to apply.`)
  } else console.log(`Configuration: ${file}`)
}

if (import.meta.main) {
  try { await manageSecurityTools(process.argv.slice(2)) } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

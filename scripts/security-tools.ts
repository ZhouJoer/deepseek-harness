/** Manage definition packs and inspect installations in selected security environments. @module */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { ToolCatalog } from '../packages/experimental/security-analysis/src/tool-catalog.ts'
import { discoverTools, type ToolDefinition } from '../packages/experimental/security-analysis/src/tool-definitions.ts'
import { inspectToolbox } from '../packages/experimental/security-analysis/src/toolbox.ts'
import type { ToolCatalogSnapshot } from '../packages/experimental/security-analysis/src/tool-catalog.ts'
import type { SecurityEnvironment } from '../packages/experimental/security-analysis/src/workbench/providers.ts'
import type { ToolboxInventory } from '../packages/experimental/security-analysis/src/toolbox-types.ts'
import { readSecurityEnvironments, readSecurityTools, securityToolsFile, standaloneTool, writeSecurityEnvironments, writeSecurityToolsFile } from './security-tools-config.ts'

async function inspectTools(environment: SecurityEnvironment, requested: string[], catalog: ToolDefinition[],
  directories: readonly string[] = []): Promise<ToolboxInventory> {
  const ctx = new Context()
  try {
    await ctx.plugin(LocalSubprocess)
    return await inspectToolbox(ctx, environment, { durationMs: 15000, maxOutputBytes: 65536, graceMs: 3000 },
      new AbortController().signal, requested, catalog, directories)
  } finally {
    await ctx.fiber.dispose()
  }
}

interface EnvironmentSelection {
  id: string
  file: string
  snapshot: ToolCatalogSnapshot
  tags?: string[] | undefined
  collections?: string[] | undefined
  prefixArgs?: string[] | undefined
  versionArgs?: string[] | undefined
  save?: boolean | undefined
}

async function manageEnvironmentTools(action: string, selected: string[], options: EnvironmentSelection): Promise<void> {
  const expected = readFileSync(options.file, 'utf8')
  const configuration = readSecurityEnvironments(options.file)
  const environment = configuration.environments.find(item => item.id === options.id)
  if (!environment) throw new Error(`Unknown security environment: ${options.id}; configure it in ${options.file}`)
  const { snapshot } = options
  const ids = action === 'set' ? selected.slice(0, 1) : selected
  const custom = [...new Set([...environment.tools.map(tool => tool.id), ...ids])]
    .filter(id => !snapshot.tools.some(tool => tool.id === id)).map(id => standaloneTool(id, snapshot.tools))
  const catalog = [...snapshot.tools, ...custom]
  const definitions = discoverTools(catalog, snapshot.collections, { tags: options.tags, collectionIds: options.collections })
  if (action === 'list') {
    console.table(definitions.map((tool) => {
      const installation = environment.tools.find(item => item.id === tool.id)
      return { environment: environment.id, tool: tool.id, command: installation?.command ?? tool.commands.join(' / '),
        prefixArgs: (installation?.prefixArgs ?? []).join(' '), versionArgs: (installation?.versionArgs ?? tool.args).join(' '),
        via: tool.dependency ?? tool.invocation }
    }))
    console.log(`Environments: ${options.file}`)
    return
  }
  if (action === 'remove') {
    environment.tools = environment.tools.filter(tool => tool.id !== selected[0])
  } else {
    if (action === 'set') {
      const id = selected[0] ?? '', command = selected[1] ?? ''
      if (!command.trim()) throw new Error('An executable command is required')
      const definition = standaloneTool(id, catalog)
      const previous = environment.tools.find(tool => tool.id === id)
      environment.tools = [...environment.tools.filter(tool => tool.id !== id), {
        id, command, prefixArgs: options.prefixArgs ?? [], versionArgs: options.versionArgs ?? definition.args,
        source: previous?.source ?? 'Operator installation',
      }]
    }
    const requested = ids.length ? ids : definitions.filter(tool => tool.commands.length || tool.dependency).map(tool => tool.id)
    const inventory = await inspectTools(environment, requested, catalog)
    for (const tool of inventory.tools)
      console.log(`${tool.id}: ${tool.status} | ${JSON.stringify([tool.command, ...tool.prefixArgs ?? []])}${tool.version ? ' | ' + tool.version : ''}${tool.detail ? ' | ' + tool.detail : ''}`)
    console.log(`Environment ${environment.id}: ${inventory.runtime}${inventory.detail ? ' | ' + inventory.detail : ''}`)
    const invalid = inventory.runtime !== 'ready' || inventory.tools.some(tool => tool.status === 'error') ||
      (action === 'set' && inventory.tools.some(tool => tool.id === ids[0] && tool.status !== 'available'))
    if (invalid) {
      console.error('Repair the selected environment or installation. No configuration changes were saved.')
      process.exitCode = 1
      return
    }
    if (options.save) {
      for (const tool of inventory.tools) {
        const definition = catalog.find(item => item.id === tool.id)
        if (tool.status !== 'available' || !definition || definition.dependency) continue
        const previous = environment.tools.find(item => item.id === tool.id)
        const installation = tool.installation ?? { command: tool.command, prefixArgs: tool.prefixArgs ?? [] }
        environment.tools = [...environment.tools.filter(item => item.id !== tool.id), {
          id: tool.id, ...installation,
          versionArgs: previous?.versionArgs ?? definition.args, source: previous?.source ?? tool.source,
        }]
      }
    }
  }
  if (action === 'set' || action === 'remove' || options.save) {
    writeSecurityEnvironments(options.file, configuration, expected)
    console.log(`Saved ${options.file}. Restart the security profile to apply environment changes.`)
  } else console.log(`Environments: ${options.file}`)
}

/** Execute the tool manager without installing software or starting the application.
 * @param args - action, tool identifiers and optional configuration/search paths.
 * @returns completion after read-only probes and requested pin updates.
 */
export async function manageSecurityTools(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    catalog: { type: 'string' }, tag: { type: 'string', multiple: true }, collection: { type: 'string', multiple: true },
    replace: { type: 'boolean' },
    arg: { type: 'string', multiple: true },
    'version-arg': { type: 'string', multiple: true },
    environment: { type: 'string' }, environments: { type: 'string' },
    config: { type: 'string' }, dir: { type: 'string', multiple: true }, save: { type: 'boolean' }, help: { type: 'boolean' },
  } })
  if (values.help) {
    console.log('pnpm security:tools [import PACK.json [--replace] | export PACK_ID FILE.json | list | doctor [ids...] | scan [ids...] [--dir DIR] [--save] | set ID COMMAND | remove ID]\nOptions: --environment ID; --environments FILE; --config FILE (local pins); --catalog FILE; --tag TAG; --collection ID; --dir DIR (local scan/doctor, repeatable); --save (scan/doctor only); --arg=ARG, --version-arg=ARG (repeatable, set only). Definitions describe discovery commands and probes; installations belong to the selected environment. Environment changes require restarting the security profile.')
    return
  }
  const [action = 'list', ...selected] = positionals
  if (!['list', 'scan', 'doctor', 'set', 'remove', 'import', 'export'].includes(action)) throw new Error(`Unknown action: ${action}`)
  if (values.save && action !== 'scan' && action !== 'doctor') throw new Error('--save is only valid with scan or doctor')
  if (values.dir && action !== 'scan' && action !== 'doctor') throw new Error('--dir is only valid with scan or doctor')
  if ((action === 'list' && selected.length) || (action === 'set' && selected.length !== 2) || (action === 'remove' && selected.length !== 1))
    throw new Error('Expected list, scan [ids...], set ID PATH, or remove ID; use --help')
  if (values.arg && action !== 'set') throw new Error('--arg is only valid with set')
  if (values['version-arg'] && action !== 'set') throw new Error('--version-arg is only valid with set')
  const file = resolve(values.config ?? securityToolsFile)
  const environmentsFile = resolve(values.environments ?? join(dirname(file), 'security-environments.json'))
  if (values.environments && !values.environment) throw new Error('--environments requires --environment')
  if (values.environment && values.dir) throw new Error('--dir searches the Host filesystem; use catalog command names or set ID COMMAND for a selected environment')
  if (values.environment && values.config) throw new Error('--config selects local pins; use --environments for a selected environment')
  const store = new ToolCatalog(resolve(values.catalog ?? join(dirname(values.environment ? environmentsFile : file), 'security-tool-packs.json')))
  if (action === 'import') {
    if (selected.length !== 1) throw new Error('Expected import PACK.json')
    const input = readFileSync(resolve(selected[0] ?? ''), 'utf8'), preview = store.preview(input)
    console.log('Import preview: ' + JSON.stringify({ id: preview.pack.id, tools: preview.pack.tools.map(tool => tool.id), conflicts: preview.conflicts }))
    store.import(input, preview.revision, values.replace ?? false)
    console.log('Registered definitions; use doctor to explicitly check installations.')
    return
  }
  if (action === 'export') {
    if (selected.length !== 2) throw new Error('Expected export PACK_ID FILE.json')
    const pack = store.read().packs.find(pack => pack.id === selected[0])
    if (!pack) throw new Error('Unknown tool pack: ' + (selected[0] ?? ''))
    writeSecurityToolsFile(resolve(selected[1] ?? ''), JSON.stringify(pack, null, 2) + '\n')
    return
  }
  const snapshot = store.read()
  if (values.environment) {
    await manageEnvironmentTools(action, selected, { id: values.environment, file: environmentsFile, snapshot,
      tags: values.tag, collections: values.collection, prefixArgs: values.arg, versionArgs: values['version-arg'], save: values.save })
    return
  }
  const toolboxCatalog = snapshot.tools
  const toolDefinition = (id: string) => standaloneTool(id, toolboxCatalog)
  let pins = readSecurityTools(file, toolboxCatalog)
  const ids = action === 'set' ? selected.slice(0, 1) : selected
  for (const id of ids) {
    if (!['doctor', 'scan'].includes(action) || !toolboxCatalog.find(tool => tool.id === id)?.dependency) toolDefinition(id)
  }
  let unhealthy = false
  let available = 0
  let missing = 0
  let unchecked = 0
  if (action === 'list') {
    const custom = Object.keys(pins).filter(id => !toolboxCatalog.some(tool => tool.id === id)).map(toolDefinition)
    console.table(discoverTools([...toolboxCatalog, ...custom], snapshot.collections, { tags: values.tag, collectionIds: values.collection }).map(tool => ({ tool: tool.id, command: pins[tool.id]?.command ?? tool.commands.join(' / '),
      prefixArgs: (pins[tool.id]?.prefixArgs ?? []).join(' '),
      versionArgs: (pins[tool.id]?.versionArgs ?? tool.args).join(' '),
      via: tool.dependency ?? tool.invocation })))
  } else if (action === 'remove') {
    pins = Object.fromEntries(Object.entries(pins).filter(([id]) => id !== selected[0]))
  } else {
    if (action === 'set') {
      const [id, command] = selected
      assert(id !== undefined && command !== undefined, 'Validated set requires a tool ID and command')
      pins[id] = { command: resolve(command), prefixArgs: values.arg ?? [], versionArgs: values['version-arg'] ?? toolDefinition(id).args }
    }
    const custom = [...new Set([...Object.keys(pins), ...ids])]
      .filter(id => !toolboxCatalog.some(tool => tool.id === id)).map(toolDefinition)
    const definitions = [...toolboxCatalog, ...custom]
    const filtered = discoverTools(definitions, snapshot.collections, { tags: values.tag, collectionIds: values.collection })
    const requested = ids.length ? ids : filtered.filter(tool => tool.commands.length || tool.dependency).map(tool => tool.id)
    const inventory = await inspectTools({ id: 'local', kind: 'local', label: 'Local', cwd: process.cwd(),
      tools: Object.entries(pins).map(([id, pin]) => ({ id, ...pin, source: 'Local tool configuration' })) }, requested, definitions, values.dir)
    for (const tool of inventory.tools) {
      const { id, status } = tool
      if (status === 'available') {
        available++
        console.log(`${id}: available | ${tool.dependency ? 'via ' : ''}${tool.python ? tool.location : tool.command} | ${tool.version.split(/\r?\n/)[0]}`)
        if (tool.python) {
          console.log(`  environment: ${tool.python.virtualEnvironment ? 'virtualenv' : 'base'} | ${tool.python.prefix}`)
          console.log(`  base: ${tool.python.basePrefix} | pip: ${tool.python.pipAvailable ? 'available' : 'missing'}`)
        } else if (tool.dependency && tool.location) console.log('  module: ' + tool.location)
        if (!tool.dependency && (action === 'set' || values.save)) pins[id] = { command: tool.command,
          prefixArgs: tool.prefixArgs ?? [], versionArgs: pins[id]?.versionArgs ?? toolDefinition(id).args }
      } else {
        if (status === 'error') unhealthy = true
        else if (status === 'missing') missing++
        else unchecked++
        const label = status === 'error' ? pins[id] ? 'invalid configuration' : 'probe error'
          : status === 'missing' ? 'optional/missing' : 'not checked'
        console.log(`${id}: ${label} | ${tool.detail || status}`)
        if (action === 'set' && id === ids[0]) unhealthy = true
      }
    }
  }
  if (action === 'doctor') {
    console.log(`Tool check: ${available} available, ${missing} optional tools missing, ${unchecked} dependencies unchecked. Configured paths: ${file}`)
    if (!values.save) console.log('To discover portable tools and save paths: pnpm security:doctor --dir DIRECTORY --save')
  }
  if (unhealthy) {
    console.error('Fix invalid configurations with set or remove, or repair the reported runtime/module. No configuration changes were saved.')
    process.exitCode = 1
    return
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

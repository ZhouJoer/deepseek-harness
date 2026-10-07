/** Tool diagnostics report broken saved paths without losing working installations. @module */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it, vi } from 'vitest'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { prepareSecurityToolsPatch, readSecurityEnvironments, writeSecurityEnvironments } from './security-tools-config.ts'
import { manageSecurityTools } from './security-tools.ts'

it('doctor reports every selected installation and preserves the file when a saved path is invalid', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-tool-doctor-'))
  const file = join(directory, 'tools.json')
  const saved = JSON.stringify({
    'working-tool': { command: process.execPath, versionArgs: ['--version'] },
    'broken-tool': { command: join(directory, 'absent-tool'), versionArgs: ['--version'] },
  })
  try {
    await writeFile(file, saved)
    const result = await execa(process.execPath, ['--import', import.meta.resolve('tsx/esm'),
      fileURLToPath(new URL('./security-tools.ts', import.meta.url)), 'doctor', 'broken-tool', 'working-tool',
      '--config', file, '--save'], {
      cwd: directory, reject: false, timeout: 30_000, stdin: 'ignore',
      env: { TSX_TSCONFIG_PATH: fileURLToPath(new URL('../tsconfig.base.json', import.meta.url)) },
    })
    expect(result.exitCode, result.stderr).toBe(1)
    expect(result.stdout).toContain('broken-tool: invalid configuration')
    expect(result.stdout).toContain('working-tool: available')
    expect(result.stderr).toContain('No configuration changes were saved')
    expect(await readFile(file, 'utf8')).toBe(saved)
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}, 40_000)

it('set registers a previously unknown executable without requiring a definition first', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-tool-set-'))
  const file = join(directory, 'tools.json')
  try {
    const result = await execa(process.execPath, ['--import', import.meta.resolve('tsx/esm'),
      fileURLToPath(new URL('./security-tools.ts', import.meta.url)), 'set', 'new-command', process.execPath, '--config', file], {
      cwd: directory, reject: false, timeout: 30_000, stdin: 'ignore',
      env: { TSX_TSCONFIG_PATH: fileURLToPath(new URL('../tsconfig.base.json', import.meta.url)) },
    })
    expect(result.exitCode, result.stderr).toBe(0)
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ 'new-command': { command: process.execPath, versionArgs: ['--version'] } })
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

async function executeTools(directory: string, args: string[]) {
  return executeToolProcess(directory, [fileURLToPath(new URL('./security-tools.ts', import.meta.url)), ...args])
}

async function executeToolProcess(directory: string, args: string[]) {
  const result = await execa(process.execPath, ['--import', import.meta.resolve('tsx/esm'), ...args], {
    cwd: directory, reject: false, timeout: 30_000, stdin: 'ignore',
    env: { TSX_TSCONFIG_PATH: fileURLToPath(new URL('../tsconfig.base.json', import.meta.url)) },
  })
  expect(result.timedOut).toBe(false)
  expect(result.signal).toBeUndefined()
  return result
}

async function executeToolSequence(file: string, actions: string[][]) {
  const steps: { error: string | null; exitCode: typeof process.exitCode; contents: string }[] = []
  const stdout: string[] = [], previousExitCode = process.exitCode
  const log = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => { stdout.push(values.map(String).join(' ')) })
  try {
    for (const args of actions) {
      process.exitCode = 0
      let error: string | null = null
      try { await manageSecurityTools(args) } catch (failure) { error = String(failure) }
      steps.push({ error, exitCode: process.exitCode, contents: await readFile(file, 'utf8') })
    }
    return { steps, stdout: stdout.join('\n') }
  } finally {
    process.exitCode = previousExitCode
    log.mockRestore()
  }
}

async function dockerFixture(directory: string, running = true) {
  const executable = join(directory, 'docker-fixture.mjs'), log = join(directory, 'docker-argv.jsonl')
  await writeFile(executable, `import { appendFileSync } from 'node:fs'
const args = process.argv.slice(3)
appendFileSync(process.argv[2], JSON.stringify(args) + '\\n')
if (args[0] !== '--context' || args[1] !== 'remote-test') throw new Error('Missing remote Docker context')
const request = args.slice(2)
if (request[0] === 'info') console.log('27.1.0')
else if (request[0] === 'inspect') console.log(${JSON.stringify(String(running))})
else if (request[0] === 'exec' && request[3] === '/opt/analysis' && request[4] === 'kali-test' && ['inspect-console', 'alternate-console'].includes(request[5])) console.log('Tool fixture 1.2.3')
else throw new Error('Unexpected request: ' + JSON.stringify(request))
`)
  const file = join(directory, 'security-environments.json')
  const saved = JSON.stringify({ environments: [{
    id: 'remote', label: 'Remote Kali', kind: 'docker', cwd: '.',
    externalContainer: { name: 'kali-test', workdir: '/opt/analysis' },
    tools: [{ id: 'docker', command: process.execPath, prefixArgs: [executable, log, '--context', 'remote-test'],
      versionArgs: ['--version'], source: 'Test fixture' }],
  }] }, null, 2)
  await writeFile(file, saved)
  return { file, log, saved }
}

it('imports portable definitions and saves container discovery without pinning the Host launcher', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-tools-'))
  try {
    const { file, log } = await dockerFixture(directory)
    const pack = join(directory, 'portable-pack.json')
    await writeFile(pack, JSON.stringify({ version: 1, id: 'portable', label: 'Portable inspection', tools: [{
      id: 'inspection', label: 'Inspection console', platforms: ['linux'], commands: ['inspect-console'], args: ['--version'],
    }] }))
    const selection = ['--environment', 'remote', '--environments', file]
    const result = await executeToolSequence(file, [
      ['import', pack, ...selection],
      ['doctor', 'inspection', '--save', ...selection],
      ['doctor', 'inspection', ...selection],
    ])
    expect(result.steps.map(({ error, exitCode }) => ({ error, exitCode }))).toEqual([
      { error: null, exitCode: 0 }, { error: null, exitCode: 0 }, { error: null, exitCode: 0 },
    ])
    expect(result.stdout.match(/inspection: available/g)).toHaveLength(2)
    const saved = JSON.parse(result.steps[1]?.contents ?? '') as { environments: { cwd: string; tools: object[] }[] }
    expect(saved.environments[0]?.cwd).toBe('.')
    expect(saved.environments[0]?.tools).toContainEqual({ id: 'inspection', command: 'inspect-console',
      prefixArgs: [], versionArgs: ['--version'], source: 'PATH' })
    expect(await readFile(file, 'utf8')).toBe(result.steps[1]?.contents)
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[])
    expect(calls.filter(args => args.includes('exec'))).toEqual([
      ['--context', 'remote-test', 'exec', '-i', '--workdir', '/opt/analysis', 'kali-test', 'inspect-console', '--version'],
      ['--context', 'remote-test', 'exec', '-i', '--workdir', '/opt/analysis', 'kali-test', 'inspect-console', '--version'],
    ])
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

it('sets and removes a custom container command without requiring a Host executable path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-set-'))
  try {
    const { file, log } = await dockerFixture(directory)
    const selection = ['--environment', 'remote', '--environments', file]
    const original = await readFile(file, 'utf8')
    const result = await executeToolSequence(file, [
      ['remove', 'docker', ...selection],
      ['set', 'custom-tool', 'alternate-console', '--arg=--quiet', ...selection],
      ['remove', 'custom-tool', ...selection],
    ])
    expect(result.steps[0]?.error).toContain('Docker environments require a configured docker tool')
    expect(result.steps[0]?.contents).toBe(original)
    expect(result.steps.slice(1).map(({ error, exitCode }) => ({ error, exitCode }))).toEqual([
      { error: null, exitCode: 0 }, { error: null, exitCode: 0 },
    ])
    const saved = JSON.parse(result.steps[1]?.contents ?? '') as { environments: { tools: object[] }[] }
    expect(saved.environments[0]?.tools).toContainEqual({ id: 'custom-tool', command: 'alternate-console',
      prefixArgs: ['--quiet'], versionArgs: ['--version'], source: 'Operator installation' })
    expect(await readFile(log, 'utf8')).toContain('"alternate-console","--quiet","--version"')
    expect(readSecurityEnvironments(file).environments[0]?.tools.map(tool => tool.id)).toEqual(['docker'])
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

it('reports a stopped external container without saving installations or starting it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-stopped-'))
  try {
    const { file, log, saved } = await dockerFixture(directory, false)
    const result = await executeTools(directory, ['doctor', 'metasploit', '--save', '--environment', 'remote', '--environments', file])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('Environment remote: stopped')
    expect(result.stderr).toContain('No configuration changes were saved')
    expect(await readFile(file, 'utf8')).toBe(saved)
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[])
    expect(calls.map(args => args[2])).toEqual(['info', 'inspect'])
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

it('merges configured environments and task defaults into the source profile while preserving expressions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-environment-overlay-'))
  try {
    const environments = join(directory, 'security-environments.json'), tools = join(directory, 'tools.json')
    const template = join(directory, 'template.yml')
    await writeFile(template, '- id: security-workbench\n  config:\n    root: !!js process.cwd()\n    taskIntake:\n      defaultEnvironmentIds: [local]\n    environments:\n      - id: local\n        kind: local\n        cwd: !!js process.cwd()\n        tools: []\n')
    await writeFile(environments, JSON.stringify({ environments: [{ id: 'remote', kind: 'docker', label: 'Kali', cwd: '.',
      externalContainer: { name: 'kali-test', workdir: '/tmp' },
      tools: [{ id: 'docker', command: 'docker', versionArgs: ['--version'], source: 'Operator installation' }],
    }], defaultEnvironmentIds: ['local', 'remote'] }))
    const overlay = await readFile(prepareSecurityToolsPatch(template, tools), 'utf8')
    const entries = load(overlay, { schema: entryListSchema }) as {
      config: { environments: { id: string; cwd: string }[]; taskIntake: object }
    }[]
    expect(entries[0]?.config.environments.map(environment => environment.id)).toEqual(['local', 'remote'])
    expect(entries[0]?.config.environments[1]?.cwd).toBe(directory)
    expect(entries[0]?.config.taskIntake).toMatchObject({ defaultEnvironmentIds: ['local', 'remote'] })
    expect(overlay).toContain('!!js process.cwd()')
    await writeFile(environments, JSON.stringify({ environments: [], defaultEnvironmentIds: ['unknown'] }))
    expect(() => prepareSecurityToolsPatch(template, tools)).toThrow('Unknown default security environment: unknown')
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

it('rejects saving observations after another operator changes the environment configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-environment-revision-'))
  try {
    const { file, saved } = await dockerFixture(directory)
    const inspected = readSecurityEnvironments(file)
    const replacement = JSON.stringify({ environments: [] })
    await writeFile(file, replacement)
    expect(() => { writeSecurityEnvironments(file, inspected, saved) }).toThrow('Security environments changed')
    expect(await readFile(file, 'utf8')).toBe(replacement)
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

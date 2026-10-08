/** Tool diagnostics report broken saved paths without losing working installations. @module */
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it, onTestFinished } from 'vitest'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { prepareSecurityToolsPatch, readSecurityEnvironments, writeSecurityEnvironments } from './security-tools-config.ts'

const cliDeadlineMs = 30_000

// Each child owns a deadline; the case also allows temporary-file setup and cleanup.
function cliTestOptions(calls: number) { return { timeout: calls * cliDeadlineMs + 10_000 } }

it('doctor reports every selected installation and preserves the file when a saved path is invalid', cliTestOptions(1), async ({ signal }) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-tool-doctor-'))
  const file = join(directory, 'tools.json')
  const saved = JSON.stringify({
    'working-tool': { command: process.execPath, versionArgs: ['--version'] },
    'broken-tool': { command: join(directory, 'absent-tool'), versionArgs: ['--version'] },
  })
  try {
    await writeFile(file, saved)
    const result = await executeTools(directory, ['doctor', 'broken-tool', 'working-tool', '--config', file, '--save'], signal)
    expect(result.exitCode, result.stderr).toBe(1)
    expect(result.stdout).toContain('broken-tool: invalid configuration')
    expect(result.stdout).toContain('working-tool: available')
    expect(result.stderr).toContain('No configuration changes were saved')
    expect(await readFile(file, 'utf8')).toBe(saved)
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

it('set registers a previously unknown executable without requiring a definition first', cliTestOptions(1), async ({ signal }) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-tool-set-'))
  const file = join(directory, 'tools.json')
  try {
    const result = await executeTools(directory, ['set', 'new-command', process.execPath, '--config', file], signal)
    expect(result.exitCode, result.stderr).toBe(0)
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ 'new-command': { command: process.execPath, versionArgs: ['--version'] } })
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

it('discovers a portable executable through an explicit search directory and saves the measured path', cliTestOptions(1), async ({ signal }) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-portable-tools-'))
  const file = join(directory, 'tools.json'), command = join(directory, 'portable-fixture-node' + extname(process.execPath))
  try {
    await copyFile(process.execPath, command)
    await chmod(command, 0o755)
    const result = await executeTools(directory, ['scan', 'portable-fixture-node', '--dir', directory, '--config', file, '--save'], signal)
    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.stdout).toContain('portable-fixture-node: available')
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ 'portable-fixture-node': {
      command, prefixArgs: [], versionArgs: ['--version'],
    } })
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

it('prints the complete Python environment from a launcher and preserves configuration after a failed probe', cliTestOptions(2), async ({ signal }) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-python-tools-'))
  const file = join(directory, 'tools.json'), launcher = join(directory, 'python-fixture.mjs')
  try {
    await writeFile(launcher, `console.log(JSON.stringify(${JSON.stringify({ version: '3.13', location: process.execPath,
      prefix: directory, basePrefix: '/python-base', virtualEnvironment: true, pipAvailable: true })}))\n`)
    const selected = ['--config', file]
    const result = await executeTools(directory, ['set', 'python', process.execPath, '--arg=' + launcher, ...selected], signal)
    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.stdout).toContain('environment: virtualenv | ' + directory)
    expect(result.stdout).toContain('base: /python-base | pip: available')
    const saved = await readFile(file, 'utf8')
    expect(JSON.parse(saved)).toMatchObject({ python: { command: process.execPath, prefixArgs: [launcher] } })
    await writeFile(launcher, 'console.log("malformed identity")\n')
    const failed = await executeTools(directory, ['scan', 'python', '--save', ...selected], signal)
    expect(failed.exitCode).toBe(1)
    expect(failed.stdout).toContain('python: invalid configuration')
    expect(failed.stderr).toContain('No configuration changes were saved')
    expect(await readFile(file, 'utf8')).toBe(saved)
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

async function executeTools(directory: string, args: string[], signal: AbortSignal) {
  const child = execa(process.execPath, ['--import', import.meta.resolve('tsx/esm'),
    fileURLToPath(new URL('./security-tools.ts', import.meta.url)), ...args], {
    cwd: directory, reject: false, timeout: cliDeadlineMs, stdin: 'ignore', cancelSignal: signal, killSignal: 'SIGKILL',
    env: { TSX_TSCONFIG_PATH: fileURLToPath(new URL('../tsconfig.base.json', import.meta.url)) },
  })
  const closed = new Promise<void>(resolve => child.nodeChildProcess.once('close', () => { resolve() }))
  const completed = Promise.all([child, closed])
  onTestFinished(async () => { child.kill('SIGKILL'); await completed })
  const [result] = await completed
  expect(result.timedOut, result.stderr).toBe(false)
  expect(result.isCanceled, result.stderr).toBe(false)
  expect(result.signal, result.stderr).toBeUndefined()
  return result
}

async function executeToolSequence(file: string, actions: string[][], signal: AbortSignal) {
  const steps: { exitCode: number | undefined; stdout: string; stderr: string; contents: string }[] = []
  for (const args of actions) {
    const { exitCode, stdout, stderr } = await executeTools(dirname(file), args, signal)
    steps.push({ exitCode, stdout, stderr, contents: await readFile(file, 'utf8') })
  }
  return { steps, stdout: steps.map(step => step.stdout).join('\n') }
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

it('imports portable definitions and saves container discovery without pinning the Host launcher', cliTestOptions(3), async ({ signal }) => {
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
    ], signal)
    expect(result.steps.map(({ stderr, exitCode }) => ({ stderr, exitCode }))).toEqual([
      { stderr: '', exitCode: 0 }, { stderr: '', exitCode: 0 }, { stderr: '', exitCode: 0 },
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

it('sets and removes a custom container command without requiring a Host executable path', cliTestOptions(3), async ({ signal }) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-set-'))
  try {
    const { file, log } = await dockerFixture(directory)
    const selection = ['--environment', 'remote', '--environments', file]
    const original = await readFile(file, 'utf8')
    const result = await executeToolSequence(file, [
      ['remove', 'docker', ...selection],
      ['set', 'custom-tool', 'alternate-console', '--arg=--quiet', ...selection],
      ['remove', 'custom-tool', ...selection],
    ], signal)
    expect(result.steps[0]?.exitCode).toBe(1)
    expect(result.steps[0]?.stderr).toContain('Docker environments require a configured docker tool')
    expect(result.steps[0]?.contents).toBe(original)
    expect(result.steps.slice(1).map(({ stderr, exitCode }) => ({ stderr, exitCode }))).toEqual([
      { stderr: '', exitCode: 0 }, { stderr: '', exitCode: 0 },
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

it('reports a stopped external container without saving installations or starting it', cliTestOptions(1), async ({ signal }) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-stopped-'))
  try {
    const { file, log, saved } = await dockerFixture(directory, false)
    const result = await executeTools(directory, ['doctor', 'metasploit', '--save', '--environment', 'remote', '--environments', file], signal)
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

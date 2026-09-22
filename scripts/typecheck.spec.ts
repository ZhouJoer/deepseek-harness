/** Exercise the Git hook runner without package-manager launchers or lifecycle variables. */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'

it.each([
  { args: [], fail: '', status: 0, phases: ['host', 'bundle', 'client'] },
  { args: ['--host-only'], fail: '', status: 0, phases: ['host', 'bundle'] },
  { args: [], fail: 'host', status: 37, phases: ['host'] },
  { args: [], fail: 'bundle', status: 37, phases: ['host', 'bundle'] },
  { args: [], fail: 'client', status: 37, phases: ['host', 'bundle', 'client'] },
])('runs without PATH tools and propagates failure: $fail $args', ({ args, fail, status, phases }) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh typecheck '))
  try {
    const write = (path: string, text: string) => {
      const target = join(root, path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, text)
    }
    write('scripts/typecheck.mjs', '')
    copyFileSync(new URL('./typecheck.mjs', import.meta.url), join(root, 'scripts/typecheck.mjs'))
    write('node_modules/typescript/package.json', JSON.stringify({ name: 'typescript' }))
    write('node_modules/typescript/bin/tsc', `
      const { appendFileSync } = require('node:fs')
      const phase = process.argv.includes('tsconfig.host.json') ? 'host' : 'client'
      appendFileSync('phases.txt', phase + '\\n')
      if (process.env.DSH_TEST_FAIL_PHASE === phase) process.exit(37)
    `)
    write('node_modules/tsdown/package.json', JSON.stringify({
      name: 'tsdown', type: 'module', exports: { './run': './run.mjs' },
    }))
    write('node_modules/tsdown/run.mjs', `
      import { appendFileSync } from 'node:fs'
      appendFileSync('phases.txt', 'bundle\\n')
      if (process.env.DSH_TEST_FAIL_PHASE === 'bundle') process.exit(37)
    `)
    const environment = Object.fromEntries(Object.entries(process.env)
      .filter(([key]) => !/^(path|npm_execpath)$/iu.test(key)))
    const result = spawnSync(process.execPath, [join(root, 'scripts/typecheck.mjs'), ...args], {
      cwd: tmpdir(),
      env: { ...environment, PATH: '', DSH_TEST_FAIL_PHASE: fail },
      encoding: 'utf8',
      timeout: 30_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, result.stderr).toBe(status)
    expect(readFileSync(join(root, 'phases.txt'), 'utf8').trim().split('\n')).toEqual(phases)
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

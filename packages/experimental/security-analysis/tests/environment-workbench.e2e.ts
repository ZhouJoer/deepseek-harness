/** Opt-in Docker lifecycle against an operator-selected, already installed image. @module */
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it, expect } from 'vitest'
import { LocalEnvironmentManager } from '../src/environment-local.ts'
import type { SecurityEnvironment } from '../src/workbench/providers.ts'
import { runProcess, requireProcessSuccess } from '../src/workbench/process.ts'

it.skipIf(!process.env.DSH_SECURITY_DOCKER_IMAGE)('pins and releases one Docker environment while rejecting a concurrent start', async () => {
  const image = process.env.DSH_SECURITY_DOCKER_IMAGE
  assert(image, 'Selected Docker fixture image is required')
  const root = await mkdtemp(join(tmpdir(), 'dsh-security-docker-'))
  const ctx = new Context()
  const environment: SecurityEnvironment = {
    id: 'owned-docker-test', label: 'Owned Docker fixture', kind: 'docker', cwd: root,
    image,
    tools: [
      { id: 'docker', command: 'docker', versionArgs: ['--version'], source: 'Host installation' },
      { id: 'python', command: 'python3', versionArgs: ['--version'], source: 'Selected image' },
    ],
  }
  const manager = new LocalEnvironmentManager(ctx, {
    timeoutMs: 30000, maxOutputBytes: 65536, graceMs: 5000, memoryMb: 256, cpus: 1, pids: 64, temporaryMb: 32,
  })
  try {
    await ctx.plugin(LocalSubprocess)
    const starting = manager.start(environment, new AbortController().signal)
    await expect(manager.start(environment, new AbortController().signal)).rejects.toThrow(/starting/)
    const container = await starting
    expect(container).toBe(environment.containerId)
    expect(environment.resolvedImageId).toMatch(/^sha256:[a-f0-9]{64}$/u)
    const result = await runProcess(ctx, environment, 'python', ['-c', 'print("owned-container")'], { signal: new AbortController().signal, durationMs: 10000, maxOutputBytes: 8192, graceMs: 3000 })
    requireProcessSuccess(result)
    expect(result.stdout.trim()).toBe('owned-container')
    await manager.stop(environment, new AbortController().signal)
    expect(environment.containerId).toBeUndefined()
    await expect(manager.stop(environment, new AbortController().signal)).rejects.toThrow(/does not own/)
  } finally {
    if (environment.containerId) await manager.stop(environment, new AbortController().signal)
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 60000)

/** Opt-in real Frida validation against a process created only for this test. @module */
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { it, expect, vi } from 'vitest'
import { FridaProvider } from '../src/frida-provider.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { assetSchema, operationSchema } from '../src/workbench/model.ts'

it.skipIf(!process.env.DSH_SECURITY_FRIDA_PYTHON || !process.env.DSH_SECURITY_FRIDA_TARGET).each(['duration', 'cancel'])(
  'runs and cleans up an owned executable after %s through real Frida Python bindings',
  async (mode) => {
    const python = process.env.DSH_SECURITY_FRIDA_PYTHON!
    const target = process.env.DSH_SECURITY_FRIDA_TARGET!
    const root = await mkdtemp(join(tmpdir(), 'dsh-frida-real-'))
    const ctx = new Context()
    try {
      await ctx.plugin(LocalSubprocess)
      const artifacts = new ArtifactStore(root, 16777216)
      const measured = await artifacts.import(target, [dirname(target)])
      const asset = assetSchema.parse({
        id: 'sample',
        engagementId: 'owned-test',
        label: 'Owned Python process',
        ...measured,
        identity: 'measured',
      })
      const marker = join(root, 'ready')
      const abort = new AbortController()
      const script = await artifacts.put(
        Buffer.from(`const file = new File(${JSON.stringify(marker)}, 'w'); file.write('ready'); file.close(); send({marker:'owned-fixture',platform:Process.platform});`),
        'text/javascript',
      )
      const context = {
        environment: {
          id: 'local',
          kind: 'local' as const,
          label: 'Owned test',
          cwd: dirname(target),
          tools: [{ id: 'python', command: python, versionArgs: ['--version'], source: 'isolated test installation' }],
        },
        asset,
        artifacts,
        signal: abort.signal,
        durationMs: mode === 'cancel' ? 15000 : 250,
        maxOutputBytes: 65536,
      }
      const provider = new FridaProvider(ctx, 5000)
      const request = provider.resolve(
        operationSchema.parse({
          provider: 'frida',
          operation: 'script',
          assetId: asset.id,
          environmentId: 'local',
          parameters: { target: { mode: 'spawn', argv: [target, '-c', 'import time; time.sleep(60)'] } },
          script,
          impact: 'target-write',
        }),
        context,
      )
      const pending = provider.run(request, context)
      if (mode === 'cancel') {
        try {
          await vi.waitFor(async () => { expect(await readFile(marker, 'utf8')).toBe('ready') }, { timeout: 15000 })
        } finally {
          abort.abort(new Error('Operator stopped the owned test'))
        }
      }
      const result = await pending
      expect(result.toolVersion).toMatch(/^\d+\.\d+\.\d+$/u)
      expect(result.incomplete).toBe(mode === 'cancel')
      expect(Buffer.from(result.bytes).toString()).toContain('owned-fixture')
      expect(Buffer.from(result.bytes).toString()).toContain('owned-process-stopped')
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  },
  30000,
)

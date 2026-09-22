/** Opt-in offline execution against an existing image; inputs are distributable fixtures. @module */
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it, expect } from 'vitest'
import { OfflineProvider } from '../src/offline-provider.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { importSource } from '../src/workbench/source.ts'
import { sourceAssetSchema, operationSchema } from '../src/workbench/model.ts'

it.skipIf(!process.env.DSH_SECURITY_OFFLINE_IMAGE).each(['python', 'browser'] as const)(
  'runs %s with immutable input and no external network', async (operation) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-offline-real-'))
    const ctx = new Context()
    try {
      await ctx.plugin(LocalSubprocess)
      const source = join(root, 'source')
      await mkdir(source)
      await writeFile(join(source, 'index.html'), '<!doctype html><title>Owned offline fixture</title><button onclick="this.textContent=navigator.bluetooth.fixture">Probe</button>')
      const artifacts = new ArtifactStore(join(root, 'store'), 65536)
      const artifact = await importSource(artifacts, source, [root], { entries: 10, bytes: 65536 })
      const script = await artifacts.put(Buffer.from(operation === 'python' ? `
import json, os, socket, sys
from pathlib import Path
assert Path(os.environ['DSH_SOURCE_ROOT'], 'index.html').is_file()
try:
    Path(os.environ['DSH_SOURCE_ROOT'], 'mutated').write_text('bad')
    raise AssertionError('input was writable')
except OSError:
    pass
assert socket.if_nameindex() == [(1, 'lo')]
print(json.dumps({'passed': True, 'runtime': sys.version, 'network': 'loopback only'}))
` : `
export default async ({ page, context, open }) => {
 await context.addInitScript(() => Object.defineProperty(navigator, 'bluetooth', { value: { fixture: 'simulated' } }))
 await open('index.html')
 await page.getByRole('button', { name: 'Probe' }).click()
 if (await page.getByRole('button').innerText() !== 'simulated') throw new Error('Mock not installed')
 const blocked = await page.evaluate(async () => { try { await fetch('https://example.invalid/'); return false } catch { return true } })
 if (!blocked) throw new Error('External request admitted')
 console.log(JSON.stringify({ passed: true, browser: await page.evaluate(() => navigator.userAgent) }))
}
`), operation === 'python' ? 'text/x-python' : 'text/javascript')
      const context = { asset: sourceAssetSchema.parse({ kind: 'source', id: 'asset', engagementId: 'project', label: 'Fixture', artifact, identity: 'measured' }),
        environment: { id: 'local', kind: 'local' as const, label: 'Local', cwd: root,
          tools: [{ id: 'docker', command: process.env.DSH_SECURITY_DOCKER_COMMAND ?? 'docker', versionArgs: ['--version'], source: 'Operator image' }] },
        artifacts, signal: new AbortController().signal, durationMs: 30000, maxOutputBytes: 16384 }
      const provider = new OfflineProvider(ctx, { image: process.env.DSH_SECURITY_OFFLINE_IMAGE!,
        memoryMb: 1024, cpus: 1, pids: 256, temporaryMb: 128, graceMs: 3000 })
      const request = await provider.prepare(operationSchema.parse({ provider: 'offline', operation, assetId: 'asset', environmentId: 'local', parameters: {}, impact: 'observe', script }), context)
      const result = await provider.run(request, context)
      expect(result, Buffer.from(result.bytes).toString()).toMatchObject({ incomplete: false, method: 'simulation', cleanup: 'Owned offline container removed' })
      const raw = JSON.parse(Buffer.from(result.bytes).toString()) as { stdout: string }
      expect(JSON.parse(raw.stdout)).toMatchObject({ passed: true })
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  }, 60000)

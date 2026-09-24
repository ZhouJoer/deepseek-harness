/** Durable workspace selections isolate resources and serialize revision checks. @module */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { describe, expect, it, onTestFinished } from 'vitest'
import { openWorkspaceIntake, type WorkspaceIntakeStore } from '../src/workspace-intake.ts'

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workspace-intake-'))
  const hosts: (() => Promise<void>)[] = []
  onTestFinished(async () => {
    for (const close of hosts.reverse()) await close()
    await rm(root, { recursive: true, force: true })
  })
  const start = async () => {
    const ctx = new Context()
    const backend = new JsonStorageBackend(root)
    const handles: { facility?: DomainFacility; store?: WorkspaceIntakeStore } = {}
    let closing: Promise<void> | undefined
    const close = (): Promise<void> => closing ??= (async () => {
      await handles.store?.close()
      await handles.facility?.closeAll()
      await backend.close()
      await ctx.fiber.dispose()
    })()
    hosts.push(close)
    await ctx.plugin(Storage)
    ctx.storage.backend.register('test', backend)
    const facility = new DomainFacility(ctx, { backend: 'test' })
    handles.facility = facility
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    const store = await openWorkspaceIntake(ctx, ['local', 'device'])
    handles.store = store
    return { store, close }
  }
  return { root, start }
}

const selection = { expectedRevision: 0, environmentIds: ['local'], maxAttempts: 3 }

describe('workspace resource configuration', () => {
  it('keeps independently selected workspaces separate and normalizes their directory spelling', async () => {
    const { root, start } = await harness()
    const { store } = await start()
    const first = join(root, 'first')
    const second = join(root, 'second')
    expect(store.get(first)).toBeUndefined()
    await Promise.all([
      store.set(first, selection),
      store.set(second, { ...selection, environmentIds: ['device'], maxAttempts: 5 }),
    ])
    expect(store.get(join(first, 'child', '..'))).toEqual({ environmentIds: ['local'], maxAttempts: 3, revision: 1 })
    expect(store.get(second)).toEqual({ environmentIds: ['device'], maxAttempts: 5, revision: 1 })
    expect(store.get(join(first, 'nested'))).toBeUndefined()
  })

  it('restores saved and explicitly disabled selections in a fresh Host', async () => {
    const { root, start } = await harness()
    const first = await start()
    await first.store.set(root, selection)
    await first.store.set(join(root, 'disabled'), { ...selection, environmentIds: [] })
    await first.close()
    const bytes = await readFile(join(root, 'security_workspace_intake.json'), 'utf8')
    expect(bytes).toContain('local')
    const second = await start()
    expect(second.store.get(root)).toEqual({ environmentIds: ['local'], maxAttempts: 3, revision: 1 })
    expect(second.store.get(join(root, 'disabled'))).toEqual({ environmentIds: [], maxAttempts: 3, revision: 1 })
    expect(second.store.get(join(root, 'unconfigured'))).toBeUndefined()
  })

  it('accepts only one concurrent first write for the same observed revision', async () => {
    const { root, start } = await harness()
    const { store } = await start()
    const outcomes = await Promise.allSettled([
      store.set(root, selection),
      store.set(root, { ...selection, environmentIds: ['device'] }),
    ])
    expect(outcomes.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(store.get(root)).toEqual({ environmentIds: ['local'], maxAttempts: 3, revision: 1 })
    await expect(store.set(root, selection)).rejects.toThrow('changed; reload before saving')
    await expect(store.set(root, { ...selection, expectedRevision: 1, environmentIds: [] }))
      .resolves.toEqual({ environmentIds: [], maxAttempts: 3, revision: 2 })
  })

  it.each([
    { ...selection, environmentIds: ['unknown'] },
    { ...selection, environmentIds: ['local', 'local'] },
    { ...selection, maxAttempts: 0 },
    { ...selection, maxAttempts: 1.5 },
    { ...selection, expectedRevision: -1 },
    { ...selection, importRoots: ['/another-root'] },
  ])('rejects invalid wire input without saving resources: %j', async (input) => {
    const { root, start } = await harness()
    const { store } = await start()
    await expect(store.set(root, input)).rejects.toThrow()
    expect(store.get(root)).toBeUndefined()
  })

  it('names an unavailable environment and rejects relative workspace directories', async () => {
    const { root, start } = await harness()
    const { store } = await start()
    await expect(store.set(root, { ...selection, environmentIds: ['missing-device'] }))
      .rejects.toThrow('Unknown workspace environment: missing-device')
    await expect(store.set('relative', selection)).rejects.toThrow('absolute cwd')
    expect(() => store.get('relative')).toThrow('absolute cwd')
  })

  it('keeps caller-owned arrays and returned records separate from saved permissions', async () => {
    const { root, start } = await harness()
    const { store } = await start()
    const input = { ...selection, environmentIds: ['local'] }
    const pending = store.set(root, input)
    input.environmentIds.push('device')
    const saved = await pending
    saved.environmentIds.push('device')
    const read = store.get(root)
    expect(read?.environmentIds).toEqual(['local'])
    read?.environmentIds.push('device')
    expect(store.get(root)?.environmentIds).toEqual(['local'])
  })

  it('drains an accepted save while refusing new writes after close begins', async () => {
    const { root, start } = await harness()
    const host = await start()
    const pending = host.store.set(root, selection)
    const closing = host.store.close()
    await expect(host.store.set(join(root, 'late'), selection)).rejects.toThrow('closing')
    await expect(pending).resolves.toMatchObject({ revision: 1 })
    await closing
    await host.close()
    const reopened = await start()
    expect(reopened.store.get(root)?.environmentIds).toEqual(['local'])
    expect(reopened.store.get(join(root, 'late'))).toBeUndefined()
  })
})

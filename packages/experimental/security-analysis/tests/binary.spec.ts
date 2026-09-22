/** Built-in sample inspection preserves identity and explicit paging limits. @module */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { BinaryProvider } from '../src/workbench/binary.ts'
import { fileAssetSchema } from '../src/workbench/model.ts'

async function fixture(bytes: Buffer) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-binary-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const artifacts = new ArtifactStore(root, 65536)
  const artifact = await artifacts.put(bytes, 'application/octet-stream')
  const context = { artifacts, asset: fileAssetSchema.parse({ id: 'sample', engagementId: 'project', label: 'owned',
    artifact, format: 'other', identity: 'measured' }),
  environment: { id: 'local', kind: 'local' as const, label: 'Host', cwd: root, tools: [] },
  signal: new AbortController().signal, durationMs: 1000, maxOutputBytes: 4096 }
  const provider = new BinaryProvider()
  const request = (operation: string, parameters: Record<string, string | number> = {}) => provider.resolve({
    provider: 'binary', operation, assetId: 'sample', environmentId: 'local', parameters, impact: 'observe',
  }, context)
  const run = (operation: string, parameters: Record<string, string | number> = {}) => provider.run(request(operation, parameters), context)
  return { context, provider, request, run }
}

describe('immutable binary inspection', () => {
  it('records exact bytes and partial string coverage with offsets', async () => {
    const { run } = await fixture(Buffer.from('secret\0other\0'))
    const page = await run('strings', { offset: 0, length: 7 })
    expect(page.incomplete).toBe(true)
    expect(JSON.parse(Buffer.from(page.bytes).toString())).toMatchObject({ nextOffset: 7, hasMore: true,
      strings: [{ offset: 0, text: 'secret' }] })
    expect(JSON.parse(Buffer.from((await run('hex', { offset: 7, length: 6 })).bytes).toString()))
      .toMatchObject({ offset: 7, hex: '6f7468657200', hasMore: false })
    await expect(run('hex', { offset: 14, length: 1 })).rejects.toThrow('Offset')
  })
  it('reads UTF-16LE printable strings and marks partial pages', async () => {
    const { run } = await fixture(Buffer.from('hello\0', 'utf16le'))
    const result = await run('strings', { encoding: 'utf16le' })
    expect(result.incomplete).toBe(false)
    expect(JSON.parse(Buffer.from(result.bytes).toString()) as unknown).toMatchObject({ strings: [{ offset: 0, text: 'hello' }] })
  })
  it('measures selected PE and ELF header fields without claiming full format validation', async () => {
    const pe = Buffer.alloc(128)
    pe.write('MZ'); pe.writeUInt32LE(64, 60); pe.write('PE', 64); pe.writeUInt16LE(0x8664, 68)
    const { run, context } = await fixture(pe)
    const identity: unknown = JSON.parse(Buffer.from((await run('identity')).bytes).toString())
    expect(identity).toMatchObject({ sha256: context.asset.artifact.sha256, size: 128, header: { machine: 0x8664 } })
    const elf = Buffer.alloc(64)
    elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 2]); elf.writeUInt16BE(183, 18)
    const other = await fixture(elf)
    expect(JSON.parse(Buffer.from((await other.run('identity')).bytes).toString()) as unknown)
      .toMatchObject({ header: { bits: 64, endian: 'big', machine: 183 } })
  })
  it('rejects malformed headers, oversized requests, writes and cancelled collection', async () => {
    for (const bytes of [Buffer.from('MZ'), Buffer.from('7f454c4602', 'hex'), Buffer.alloc(64, 0x4d)]) {
      if (bytes.length === 64) bytes.write('MZ')
      const { run } = await fixture(bytes)
      await expect(run('identity')).rejects.toThrow(/header|identification/)
    }
    const { context, provider, request } = await fixture(Buffer.from('owned'))
    expect(() => request('strings', { length: 65536 })).toThrow()
    expect(() => request('shell')).toThrow('read-only')
    expect(() => provider.resolve({ ...request('identity'), impact: 'target-write' }, context)).toThrow('read-only')
    await expect(provider.run(request('identity'), { ...context, signal: AbortSignal.abort(new Error('stopped')) }))
      .rejects.toThrow('stopped')
  })
})

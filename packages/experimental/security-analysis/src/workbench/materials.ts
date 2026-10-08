/** Operator-selected files and pasted text converted to immutable analysis assets. @module */
import assert from 'node:assert/strict'
import { lstat } from 'node:fs/promises'
import { basename } from 'node:path'
import { z } from 'zod'
import { ArtifactStore, detectFileFormat } from './artifacts.ts'
import { importSource, isSourceText, saveSourceManifest, sourceManifestSchema } from './source.ts'
import type { Artifact, FileAsset, SourceAsset } from './model.ts'

const name = sourceManifestSchema.shape.files.element.shape.path
/** Explicit UI material selection; host paths authorize only the selected file or tree. */
export const materialInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('path'), path: z.string().trim().min(1) }).strict(),
  z.object({ kind: z.literal('text'), name, text: z.string().refine(value => value.trim().length > 0) }).strict(),
  z.object({ kind: z.literal('files'), directory: z.boolean(), files: z.array(z.object({
    name, base64: z.string(),
  }).strict()).min(1) }).strict(),
])
/** Measured asset fields awaiting project assignment and durable identities. */
export type MaterialAsset = Omit<FileAsset, 'id' | 'engagementId'> | Omit<SourceAsset, 'id' | 'engagementId'>

/** Import user-selected bytes without running them or expanding model filesystem authority.
 * @param store - immutable artifact owner.
 * @param input - parsed operator selection.
 * @param limits - deployment-owned aggregate byte and entry limits.
 * @returns measured assets; invalid names, encodings and oversized selections reject before publication.
 */
export async function prepareMaterials(store: ArtifactStore, input: z.infer<typeof materialInputSchema>,
  limits: { bytes: number; entries: number }): Promise<MaterialAsset[]> {
  if (input.kind === 'path') {
    const selected = await lstat(input.path)
    if (selected.isDirectory()) return [{ kind: 'source', label: basename(input.path), identity: 'measured',
      artifact: await importSource(store, input.path, [input.path], limits) }]
    if (!selected.isFile()) throw new Error('Select a regular file or directory')
    const measured = await store.import(input.path, [input.path])
    return [await file(basename(input.path), await store.read(measured.artifact), measured.artifact, measured.format)]
  }
  if (input.kind === 'files' && (input.files.length > limits.entries
    || input.files.reduce((sum, item) => sum + item.base64.length, 0) > 4 * Math.ceil(limits.bytes / 3) + 4 * input.files.length))
    throw new Error('Material selection exceeds the configured limits')
  const files = input.kind === 'text' ? [{ name: input.name, bytes: Buffer.from(input.text, 'utf8') }]
    : input.files.map((item) => {
      const bytes = Buffer.from(item.base64, 'base64')
      if (bytes.toString('base64') !== item.base64) throw new Error('Invalid uploaded file encoding')
      return { name: item.name, bytes }
    })
  if (files.length > limits.entries || new Set(files.map(item => item.name)).size !== files.length)
    throw new Error('Material selection exceeds the entry limit or contains duplicate paths')
  if (files.reduce((sum, item) => sum + item.bytes.length, 0) > limits.bytes)
    throw new Error('Material selection exceeds the configured byte limit')
  if (input.kind === 'files' && input.directory) {
    const first = files[0]
    assert(first)
    const members = await Promise.all(files.map(async item => ({ path: item.name,
      artifact: await store.put(item.bytes, 'application/octet-stream'), text: isSourceText(item.bytes) })))
    return [{ kind: 'source', label: first.name.slice(0, first.name.indexOf('/') < 0 ? first.name.length : first.name.indexOf('/')), identity: 'measured',
      artifact: await saveSourceManifest(store, { version: 1, files: members, excluded: [] }) }]
  }
  return Promise.all(files.map(async item => file(item.name, item.bytes,
    await store.put(item.bytes, 'application/octet-stream'), detectFileFormat(item.bytes, item.name))))

  async function file(label: string, bytes: Buffer, artifact: Artifact, format: FileAsset['format']): Promise<MaterialAsset> {
    if (format !== 'other' || !isSourceText(bytes)) return { label, artifact, format, identity: 'measured' }
    return { kind: 'source', label, identity: 'measured',
      artifact: await saveSourceManifest(store, { version: 1, files: [{ path: label, artifact, text: true }], excluded: [] }) }
  }
}

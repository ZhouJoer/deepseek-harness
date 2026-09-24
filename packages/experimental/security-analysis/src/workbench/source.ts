/** Immutable source snapshots and bounded, line-addressed observations. @module */
import assert from 'node:assert/strict'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { z } from 'zod'
import { artifactSchema, type Artifact, type AnalysisOperation } from './model.ts'
import type { ArtifactStore } from './artifacts.ts'
import type { AnalysisProvider, AnalysisContext, AnalysisResult } from './providers.ts'

const memberPath = z.string().min(1).refine(value =>
  !value.includes('\\') && !value.includes(':') && !value.includes('\0') &&
  value.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'Expected a relative source path')
/** Persisted member identities and explicit snapshot exclusions. */
export const sourceManifestSchema = z.object({
  version: z.literal(1),
  files: z.array(z.object({ path: memberPath, artifact: artifactSchema, text: z.boolean() }).strict()),
  excluded: z.array(z.object({ path: memberPath, reason: z.string() }).strict()),
}).strict().refine(value => new Set([...value.files, ...value.excluded].map(item => item.path)).size ===
  value.files.length + value.excluded.length, 'Duplicate source path')

/**
 * Snapshot regular files without following links or executing source.
 * @param store - immutable artifact owner.
 * @param path - selected directory.
 * @param roots - operator-approved import roots.
 * @param limits - maximum visited entries and cumulative file bytes.
 * @returns measured manifest artifact.
 */
export async function importSource(store: ArtifactStore, path: string, roots: string[],
  limits: { entries: number; bytes: number }): Promise<Artifact> {
  if (!isAbsolute(path)) throw new Error('Select an absolute source directory')
  const root = await realpath(path)
  const approved = await Promise.all(roots.map(value => realpath(value)))
  if (!approved.some((value) => {
    const tail = relative(value, root)
    return tail !== '..' && !tail.startsWith('..' + sep) && !isAbsolute(tail)
  })) throw new Error('Source directory is outside the configured import roots')
  if (!(await lstat(root)).isDirectory()) throw new Error('Source import requires a directory')
  const manifest: z.infer<typeof sourceManifestSchema> = { version: 1, files: [], excluded: [] }
  let entries = 0
  let bytes = 0
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const names = (await readdir(directory)).sort()
    for (const name of names) {
      if (++entries > limits.entries) throw new Error('Source directory exceeds the configured entry limit')
      const path = memberPath.parse(prefix + name)
      const absolute = join(directory, name)
      const stat = await lstat(absolute)
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        manifest.excluded.push({ path, reason: 'Not a regular file or directory' })
      } else if (stat.isDirectory()) {
        const resolved = await realpath(absolute)
        const tail = relative(root, resolved)
        if (tail === '..' || tail.startsWith('..' + sep) || isAbsolute(tail)) throw new Error('Source directory changed during import')
        await visit(absolute, path + '/')
      } else {
        if (bytes + stat.size > limits.bytes) throw new Error('Source snapshot exceeds the configured byte limit')
        const imported = await store.import(absolute, [root])
        bytes += imported.artifact.size
        if (bytes > limits.bytes) throw new Error('Source snapshot exceeds the configured byte limit')
        const content = await store.read(imported.artifact)
        let text = !content.includes(0)
        if (text) {
          try { new TextDecoder('utf-8', { fatal: true }).decode(content) }
          catch (error) { if (!(error instanceof TypeError)) throw error; text = false }
        }
        manifest.files.push({ path, artifact: imported.artifact, text })
      }
    }
  }
  await visit(root, '')
  return store.put(Buffer.from(JSON.stringify(sourceManifestSchema.parse(manifest))), 'application/vnd.dsh.source-tree+json')
}

/** Read the manifest of the assigned source asset.
 * @param context - admitted asset and artifact store.
 * @returns verified directory entries. */
export async function sourceManifest(context: AnalysisContext): Promise<z.infer<typeof sourceManifestSchema>> {
  if (!('kind' in context.asset) || context.asset.kind !== 'source') throw new Error('Select an imported source directory')
  return sourceManifestSchema.parse(JSON.parse((await context.artifacts.read(context.asset.artifact)).toString('utf8')))
}

/** Source observations use immutable bytes without external execution. */
export class SourceProvider implements AnalysisProvider {
  resourceKey(): null { return null }
  readonly id = 'source'
  readonly operations = ['list', 'read', 'search']
  readonly inputGuide = 'list accepts offset and limit. read requires path and accepts startLine (1-based), limit. search requires a literal query and accepts path, offset and limit. Paths belong to the immutable source manifest, never the live filesystem. Results include file hashes, line numbers, exclusions and continuation positions.'
  resolve(request: AnalysisOperation, context: AnalysisContext): AnalysisOperation {
    if (!('kind' in context.asset) || context.asset.kind !== 'source') throw new Error('Select an imported source directory')
    if (request.script || request.impact !== 'observe') throw new Error('Source inspection is read-only')
    const page = { offset: z.number().int().nonnegative().default(0), limit: z.number().int().positive().default(100) }
    const schema = request.operation === 'list' ? z.object(page).strict()
      : request.operation === 'read' ? z.object({ path: memberPath, startLine: z.number().int().positive().default(1), limit: page.limit }).strict()
        : request.operation === 'search' ? z.object({ ...page, query: z.string().min(1), path: memberPath.optional() }).strict() : undefined
    if (!schema) throw new Error('Unsupported source operation')
    return { ...request, parameters: schema.parse(request.parameters) }
  }
  async run(request: AnalysisOperation, context: AnalysisContext): Promise<AnalysisResult> {
    const manifest = await sourceManifest(context)
    const query = request.parameters.query
    if (request.operation === 'search') assert(typeof query === 'string', 'Resolved source search requires text')
    const items: object[] = []
    const offset = Number(request.parameters.offset ?? Number(request.parameters.startLine ?? 1) - 1)
    const limit = Number(request.parameters.limit)
    let count = 0
    let hasMore = false
    const payload = () => ({ snapshot: 'artifact' in context.asset ? context.asset.artifact.sha256 : '',
      operation: request.operation, items, nextOffset: offset + items.length,
      ...(request.operation === 'read' ? { nextLine: offset + items.length + 1 } : {}), hasMore,
      excludedCount: manifest.excluded.length })
    const append = (item: object): boolean => {
      if (count++ < offset) return true
      items.push(item)
      if (items.length > limit || Buffer.byteLength(JSON.stringify(payload())) + 32 > context.maxOutputBytes) {
        items.pop()
        if (!items.length) throw new Error('One source result exceeds the output budget')
        hasMore = true
        return false
      }
      return true
    }
    if (request.operation === 'list') {
      for (const item of [...manifest.files, ...manifest.excluded]) {
        context.signal.throwIfAborted()
        if (!append(item)) break
      }
    } else {
      const files = manifest.files.filter(file => request.parameters.path === undefined || file.path === request.parameters.path)
      if (request.parameters.path !== undefined && !files.length) throw new Error('Source path is absent from the snapshot')
      outer: for (const file of files) {
        context.signal.throwIfAborted()
        if (!file.text) {
          if (request.operation === 'read') throw new Error('Source member is not UTF-8 text')
          continue
        }
        const lines = new TextDecoder('utf-8', { fatal: true }).decode(await context.artifacts.read(file.artifact)).split(/\r?\n/u)
        for (const [index, text] of lines.entries()) {
          if (request.operation === 'search' && typeof query === 'string' && !text.includes(query)) continue
          if (!append({ path: file.path, sha256: file.artifact.sha256, line: index + 1, text })) break outer
        }
      }
    }
    context.signal.throwIfAborted()
    const bytes = Buffer.from(JSON.stringify(payload()))
    if (bytes.length > context.maxOutputBytes) throw new Error('Source result exceeds the output budget')
    return { bytes, mediaType: 'application/json', summary: request.operation + ': ' + String(items.length) + ' source entries; use security_evidence for file hashes, line numbers and content', incomplete: hasMore,
      toolVersion: 'dsh-source/1', method: 'static', observationKind: request.operation === 'read' ? 'implementation' : 'inventory' }
  }
}

/** Artifact reachability for irreversible task deletion. @module */
import type { SecurityRecord, Artifact } from './model.ts'
import type { ArtifactStore } from './artifacts.ts'
import { sourceManifestSchema } from './source.ts'

/** Collect all content referenced by task records, including source members.
 * @param store - verified immutable content storage.
 * @param records - retained or deleted journal records.
 * @returns unique content digests. */
export async function referencedArtifacts(store: ArtifactStore, records: SecurityRecord[]): Promise<Set<string>> {
  const artifacts = new Map<string, Artifact>()
  for (const item of records) {
    if ('artifact' in item.value) artifacts.set(item.value.artifact.sha256, item.value.artifact)
    if (item.kind === 'report') for (const artifact of [item.value.markdown, item.value.json, item.value.findingsMarkdown])
      if (artifact) artifacts.set(artifact.sha256, artifact)
    if (item.kind === 'plan' && item.value.operation.script) artifacts.set(item.value.operation.script.sha256, item.value.operation.script)
    if (item.kind === 'asset' && 'kind' in item.value && item.value.kind === 'source') {
      const manifest = sourceManifestSchema.parse(JSON.parse((await store.read(item.value.artifact)).toString('utf8')))
      for (const file of manifest.files) artifacts.set(file.artifact.sha256, file.artifact)
    }
  }
  return new Set(artifacts.keys())
}

/** Collect deleted task content that no retained journal record references.
 * @param store - verified immutable content storage.
 * @param removed - all historical records owned by the deleted task.
 * @param retained - historical records belonging to other tasks.
 * @returns unshared content digests, including source-manifest members. */
export async function unsharedArtifacts(store: ArtifactStore, removed: SecurityRecord[], retained: SecurityRecord[]): Promise<string[]> {
  const removedArtifacts = await referencedArtifacts(store, removed)
  const kept = await referencedArtifacts(store, retained)
  return [...removedArtifacts].filter(hash => !kept.has(hash))
}

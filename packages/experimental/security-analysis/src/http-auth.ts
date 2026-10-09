/** Target-owned credentials with public descriptions and execution-time version checks. @module */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type Credentials from '@deepseek-ai/dsh-credentials'
import { credentialKey, credentialKeyId, credentialKeyScope } from '@deepseek-ai/dsh-credentials'
import { brandString } from '@deepseek-ai/dsh-brand'
import { httpIdentityInputSchema, type HttpIdentityDescription, type HttpIdentityId, type HttpIdentityRevision } from './http-model.ts'

const OWNER = 'experimental-security-external-web'
const keyPrefix = (targetId: string) => 'target-' + Buffer.from(targetId).toString('hex') + '-identity-'
const recordKey = (targetId: string, id: string) => credentialKey(OWNER, keyPrefix(targetId) + Buffer.from(id).toString('hex'))
const storedSchema = httpIdentityInputSchema.required({ id: true }).extend({ targetId: z.string(),
  projectId: z.string(), revision: z.string().transform(brandString<HttpIdentityRevision>) }).strict()
/** Captured secret snapshot; never returned through a Remote or model result. */
export type HttpIdentitySnapshot = z.infer<typeof storedSchema>
/** Only this owner interprets the credential record payload. */
export class HttpIdentities {
  constructor(private readonly credentials: Credentials) {}
  /** Read the exact target/profile record.
   * @param targetId - owning asset.
   * @param id - profile identity.
   * @returns validated private snapshot. */
  async read(targetId: string, id: HttpIdentityId): Promise<HttpIdentitySnapshot> {
    const record = await this.credentials.readRecord(recordKey(targetId, id))
    if (record?.kind !== 'grant') throw new Error('HTTP identity is unavailable; configure it before preparing a plan')
    const parsed = storedSchema.safeParse(record.payload)
    if (!parsed.success || parsed.data.targetId !== targetId || parsed.data.id !== id) throw new Error('HTTP identity configuration is invalid')
    return parsed.data
  }
  /** List descriptions without returning stored secrets.
   * @param targetId - owning asset.
   * @returns safe authentication choices. */
  async list(targetId: string): Promise<HttpIdentityDescription[]> {
    const result: HttpIdentityDescription[] = []
    for (const entry of await this.credentials.listRecords()) {
      if (credentialKeyScope(entry.key) !== OWNER || !credentialKeyId(entry.key).startsWith(keyPrefix(targetId))) continue
      const id = brandString<HttpIdentityId>(Buffer.from(credentialKeyId(entry.key).slice(keyPrefix(targetId).length), 'hex').toString())
      result.push(this.describe(await this.read(targetId, id)))
    }
    return result
  }
  /** Replace a profile with a new opaque version.
   * @param targetId - owning asset.
   * @param input - secret-bearing operator input, never journaled.
   * @param projectId - project whose permanent deletion removes these credentials.
   * @returns description of the saved version. */
  async write(targetId: string, input: unknown, projectId: string): Promise<HttpIdentityDescription> {
    const parsed = httpIdentityInputSchema.safeParse(input)
    if (!parsed.success) throw new Error('HTTP identity requires a mode, label and named secret fields')
    const value = parsed.data
    const required = value.mode === 'basic' || value.mode === 'login' ? ['username', 'password'] : [value.mode === 'bearer' ? 'token' : 'cookie']
    if (required.some(key => !value.secrets[key])) throw new Error('HTTP identity is missing required secret fields')
    if (value.mode === 'login' && (!value.loginSteps.length || !value.loginSteps.at(-1)?.assertions.length))
      throw new Error('Automatic login requires steps and a final success assertion')
    if (value.loginSteps.some(step => step.identityId !== undefined)) throw new Error('Login steps inherit their owning identity')
    const template = JSON.stringify(value.loginSteps)
    if (Object.values(value.secrets).some(secret => template.includes(secret))) throw new Error('Login steps must reference credential fields instead of embedding their values')
    const snapshot = { ...value, id: value.id ?? brandString<HttpIdentityId>(randomUUID()),
      targetId, projectId, revision: brandString<HttpIdentityRevision>(randomUUID()) }
    await this.credentials.modifyRecord(recordKey(targetId, snapshot.id), () => Promise.resolve({ kind: 'grant', payload: snapshot }))
    return this.describe(snapshot)
  }
  /** Delete a target-owned profile.
   * @param targetId - owning asset.
   * @param id - profile identity. */
  async remove(targetId: string, id: HttpIdentityId): Promise<void> {
    await this.credentials.deleteRecord(recordKey(targetId, id))
  }
  /** Remove credentials owned by a permanently deleted project.
   * @param projectId - deleted project; safe to retry after restart. */
  async removeProject(projectId: string): Promise<void> {
    for (const entry of await this.credentials.listRecords()) {
      if (credentialKeyScope(entry.key) !== OWNER) continue
      const record = await this.credentials.readRecord(entry.key)
      if (record?.kind !== 'grant') continue
      const parsed = storedSchema.safeParse(record.payload)
      if (parsed.success && parsed.data.projectId === projectId) await this.credentials.deleteRecord(entry.key)
    }
  }
  private describe(value: HttpIdentitySnapshot): HttpIdentityDescription {
    return { id: value.id, label: value.label, revision: value.revision, mode: value.mode,
      secretNames: Object.keys(value.secrets), loginSteps: value.loginSteps,
      ...(value.tokenVariable ? { tokenVariable: value.tokenVariable } : {}) }
  }
}

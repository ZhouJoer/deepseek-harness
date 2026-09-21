/** Durable security-check records and provider requests. @module */
import { z } from 'zod'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Identifies an assessment project. */
export type EngagementId = Branded<'SecurityEngagement'>
/** Identifies an immutable imported sample. */
export type AssetId = Branded<'SecurityAsset'>
/** Identifies an operator-configured execution environment. */
export type EnvironmentId = Branded<'SecurityEnvironment'>
/** Identifies a dependency-tracked check. */
export type CheckId = Branded<'SecurityCheck'>
/** Identifies an immutable evidence record. */
export type EvidenceId = Branded<'SecurityEvidence'>
/** Identifies one immutable validation plan. */
export type ValidationPlanId = Branded<'SecurityValidationPlan'>

const text = z.string().trim().min(1)
const id = text.max(128)
const json: z.ZodType<JsonValue> = z.json()
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
/** Four assessment stages, independent for each check. */
export const phaseSchema = z.enum(['recon', 'surface', 'assessment', 'validation'])
/** Session roles are granted by the coordinator, never inferred from ancestry. */
export const roleSchema = z.enum(['coordinator', 'reconnaissance', 'reverse-analyst', 'researcher', 'reviewer'])
/** Content-addressed immutable file metadata. */
export const artifactSchema = z
  .object({
    sha256: digest,
    size: z.number().int().nonnegative(),
    mediaType: text,
  })
  .strict()
/** An operator's project scope and limits. */
export const engagementSchema = z
  .object({
    id: id.transform(brandString<EngagementId>),
    title: text,
    objective: text,
    environmentIds: z.array(id),
    stopped: z.boolean(),
    maxAttempts: z.number().int().positive(),
  })
  .strict()
/** A measured sample or an explicitly unverified legacy declaration. */
export const assetSchema = z
  .object({
    id: id.transform(brandString<AssetId>),
    engagementId: id,
    label: text,
    artifact: artifactSchema,
    format: z.enum(['pe', 'elf', 'apk', 'dex', 'other']),
    identity: z.enum(['measured', 'operator-declared']),
    parentId: id.optional(),
  })
  .strict()
/** One check with its acceptance criterion, inputs and durable execution status. */
export const checkSchema = z
  .object({
    id: id.transform(brandString<CheckId>),
    engagementId: id,
    assetId: id,
    title: text,
    phase: phaseSchema,
    criterion: text,
    dependencies: z.array(id),
    evidenceIds: z.array(id),
    status: z.enum(['planned', 'running', 'completed', 'blocked', 'interrupted', 'skipped']),
    attempts: z.number().int().nonnegative(),
    rationale: z.string(),
    ownerSessionId: id.optional(),
  })
  .strict()
/** Provider observations stay separate from analyst assessments. */
export const evidenceSchema = z
  .object({
    id: id.transform(brandString<EvidenceId>),
    engagementId: id,
    assetId: id,
    checkId: id.optional(),
    planId: id.optional(),
    title: text,
    summary: z.string(),
    artifact: artifactSchema,
    provider: text,
    operation: text,
    toolVersion: text,
    request: z.record(z.string(), json),
    source: z.object({ sessionId: id, callId: id, channel: z.enum(['tool', 'operator']).optional() }).strict(),
    incomplete: z.boolean(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict()
/** An analyst conclusion references observations and records unresolved conditions. */
export const findingSchema = z
  .object({
    id,
    engagementId: id,
    assetId: id,
    title: text,
    explanation: text,
    status: z.enum(['suspected', 'confirmed', 'refuted', 'inconclusive']),
    evidenceIds: z.array(id).min(1),
    conditions: text,
    review: z.string(),
  })
  .strict()
/** A resolved, immutable request submitted to one analysis provider. */
export const operationSchema = z
  .object({
    provider: text,
    operation: text,
    environmentId: id,
    assetId: id,
    parameters: z.record(z.string(), json),
    script: artifactSchema.optional(),
    impact: z.enum(['observe', 'analysis-write', 'target-write']),
  })
  .strict()
/** Approval binds the complete plan, including script content and target parameters. */
export const validationPlanSchema = z
  .object({
    id: id.transform(brandString<ValidationPlanId>),
    engagementId: id,
    checkId: id,
    hypothesis: text,
    expectedObservation: text,
    impact: text,
    cleanup: text,
    operation: operationSchema,
    durationMs: z.number().int().positive(),
    hash: digest,
    environmentHash: digest,
    approvedUntil: z.number().int().nonnegative().optional(),
    status: z.enum(['draft', 'approved', 'revoked']),
  })
  .strict()
/** A durable authority binding for one session. */
export const bindingSchema = z
  .object({
    sessionId: id,
    engagementId: id,
    role: roleSchema,
    assetIds: z.array(id),
  })
  .strict()
/** Reviewed reusable material; its content does not grant execution authority. */
export const knowledgeSchema = z
  .object({
    id,
    engagementId: id,
    title: text,
    content: text,
    conditions: text,
    tags: z.array(text),
    evidenceIds: z.array(id),
    published: z.boolean(),
  })
  .strict()
/** Tagged records form one append-only commit stream. */
export const recordSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('legacy'),
      value: z
        .object({
          id,
          engagementId: id,
          title: text,
          artifact: artifactSchema,
          identity: z.literal('operator-declared'),
          importedAt: z.number().int().nonnegative(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('execution'),
      value: z
        .object({
          id,
          engagementId: id,
          assetId: id,
          planId: id,
          status: z.enum(['running', 'completed', 'failed', 'interrupted']),
          detail: z.string(),
        })
        .strict(),
    })
    .strict(),
  z.object({ kind: z.literal('engagement'), value: engagementSchema }).strict(),
  z.object({ kind: z.literal('asset'), value: assetSchema }).strict(),
  z.object({ kind: z.literal('check'), value: checkSchema }).strict(),
  z.object({ kind: z.literal('evidence'), value: evidenceSchema }).strict(),
  z.object({ kind: z.literal('finding'), value: findingSchema }).strict(),
  z.object({ kind: z.literal('plan'), value: validationPlanSchema }).strict(),
  z.object({ kind: z.literal('binding'), value: bindingSchema }).strict(),
  z.object({ kind: z.literal('knowledge'), value: knowledgeSchema }).strict(),
])
/** Persisted domain record. */
export type SecurityRecord = z.infer<typeof recordSchema>
/** Project declaration. */
export type Engagement = z.infer<typeof engagementSchema>
/** Imported sample. */
export type Asset = z.infer<typeof assetSchema>
/** Dependency-tracked check. */
export type CheckStep = z.infer<typeof checkSchema>
/** Immutable provider evidence. */
export type Evidence = z.infer<typeof evidenceSchema>
/** Immutable executable request. */
export type AnalysisOperation = z.infer<typeof operationSchema>
/** Content-addressed file reference. */
export type Artifact = z.infer<typeof artifactSchema>
/** Version-bound validation plan. */
export type ValidationPlan = z.infer<typeof validationPlanSchema>
/** Authority binding, controlled by the host. */
export type SessionBinding = z.infer<typeof bindingSchema>
/** Snapshot returned after committed mutations. */
export interface WorkbenchView {
  revision: number
  records: SecurityRecord[]
}

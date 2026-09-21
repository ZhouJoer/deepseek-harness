/**
 * Engagement-local evidence, assessments, and workflow history over storage-domain.
 * Provider observations and analyst conclusions are stored separately; tool results
 * expose records to the model without making stored text executable instructions.
 * @module @deepseek-ai/dsh-experimental-security-analysis/store
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

/** Identifies one immutable engagement record. */
export type SecurityRecordId = Branded<'SecurityRecordId'>

const nonempty = z.string().trim().min(1)
const phaseSchema = z.enum(['recon', 'surface', 'assessment', 'validation'])
const kindSchema = z.enum(['asset', 'surface', 'hypothesis', 'validation', 'evidence', 'note'])
const statusSchema = z.enum(['observed', 'suspected', 'confirmed', 'refuted', 'inconclusive'])
const sourceSchema = z.object({ sessionId: nonempty, callId: nonempty, tool: nonempty }).strict()
const inputFields = {
  assetId: nonempty,
  title: nonempty,
  text: nonempty,
  evidenceIds: z.array(nonempty),
  tags: z.array(nonempty),
  details: z.json().optional(),
}
const recordInputSchema = z
  .object({
    ...inputFields,
    kind: kindSchema.exclude(['evidence']),
    status: statusSchema,
  })
  .strict()
const evidenceInputSchema = z.object({ ...inputFields, text: z.string() }).strict()
const assetBindingSchema = z
  .array(
    z
      .object({
        id: nonempty,
        sha256: z
          .string()
          .regex(/^[a-fA-F0-9]{64}$/)
          .transform(value => value.toLowerCase()),
      })
      .strict(),
  )
  .min(1)
const recordSchema = z
  .object({
    ...inputFields,
    text: z.string(),
    id: nonempty.transform(value => brandString<SecurityRecordId>(value)),
    engagementId: nonempty,
    kind: kindSchema,
    status: statusSchema,
    source: sourceSchema,
    createdAt: z.number().int().nonnegative(),
    evidenceType: z.enum(['static', 'dynamic']).optional(),
    assessment: z.literal(true).optional(),
  })
  .strict()
  .superRefine((record, ctx) => {
    if (record.kind !== 'evidence' && record.text.trim().length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Analyst records require nonempty text.' })
    }
    if ((record.kind === 'evidence') !== (record.evidenceType !== undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Only provider evidence carries evidenceType.' })
    }
    if (record.kind === 'evidence' && record.status !== 'observed') {
      ctx.addIssue({ code: 'custom', message: 'Provider evidence is an observation.' })
    }
    if ((record.kind === 'validation') !== (record.assessment === true)) {
      ctx.addIssue({ code: 'custom', message: 'Validation records must be marked as assessments.' })
    }
    if (record.status === 'confirmed' && record.kind !== 'validation') {
      ctx.addIssue({ code: 'custom', message: 'Only validation assessments may confirm a finding.' })
    }
  })
const transitionSchema = z
  .object({
    sequence: z.number().int().positive(),
    phase: phaseSchema,
    rationale: nonempty,
    source: sourceSchema,
    createdAt: z.number().int().nonnegative(),
  })
  .strict()

/** The ordered analysis stages; earlier stages may be revisited with a rationale. */
export type SecurityPhase = z.infer<typeof phaseSchema>
/** Record categories returned by knowledge search. */
export type SecurityRecordKind = z.infer<typeof kindSchema>
/** An observation or explicit assessment outcome. */
export type SecurityRecordStatus = z.infer<typeof statusSchema>
/** The logged tool call that produced or requested one stored record. */
export type SecuritySource = z.infer<typeof sourceSchema>
/** Immutable stored record; evidenceType is assigned only by provider ingestion. */
export type SecurityRecord = z.infer<typeof recordSchema>
/** Model-authored record fields; provider evidence cannot be submitted here. */
export type SecurityRecordInput = z.infer<typeof recordInputSchema>
/** Provider observation fields, before trusted ingestion assigns their category. */
export type SecurityEvidenceInput = z.infer<typeof evidenceInputSchema>
/** One durable phase change with its reason and originating tool call. */
export type SecurityTransition = z.infer<typeof transitionSchema>

/** Search filters and a caller-selected page, bounded by the deployment's maximum. */
export interface SecuritySearch {
  query?: string
  assetId?: string
  kind?: SecurityRecordKind
  status?: SecurityRecordStatus
  offset: number
  limit: number
}

/** A deterministic search page; null nextOffset means there is no further page. */
export interface SecuritySearchResult {
  records: SecurityRecord[]
  total: number
  nextOffset: number | null
}

/** Engagement state derived from the append-only transition history. */
export interface SecurityWorkflow {
  phase: SecurityPhase
  history: SecurityTransition[]
}

/** Durable engagement records. Returned records are borrowed immutable values. */
export interface SecurityStore {
  /**
   * Bind this engagement to immutable asset identities before analysis starts.
   * @param assets - Configured asset ids and SHA-256 digests; order is ignored.
   * @returns resolution after the first durable binding, or rejects a changed roster.
   */
  bindAssets(assets: readonly { id: string; sha256: string }[]): Promise<void>
  /**
   * Read a record in this engagement.
   * @param id - Record identity.
   * @returns the stored record, or undefined when absent.
   */
  get(id: string): SecurityRecord | undefined
  /**
   * Search title, text, and tags with case-insensitive AND keywords.
   * @param request - Filters and explicit offset and limit.
   * @param maxLimit - Deployment's maximum page size.
   * @returns records ordered by creation time and identity, plus pagination metadata.
   */
  search(request: SecuritySearch, maxLimit: number): SecuritySearchResult
  /**
   * Read the current phase and its durable history.
   * @returns recon for a new engagement, otherwise the latest recorded phase.
   */
  workflow(): SecurityWorkflow
  /**
   * Append an analyst record after validating its references and assessment rules.
   * @param input - Record fields; evidence must use provider ingestion.
   * @param source - Logged tool call that requested the record.
   * @returns the record after durable commit.
   */
  appendRecord(input: SecurityRecordInput, source: SecuritySource): Promise<SecurityRecord>
  /**
   * Append an observation from a trusted static or dynamic analysis provider.
   * @param input - Provider output and referenced records.
   * @param source - Logged tool call that collected the observation.
   * @param evidenceType - Provider-assigned analysis method, never model input.
   * @returns the observed evidence after durable commit.
   */
  appendEvidence(
    input: SecurityEvidenceInput,
    source: SecuritySource,
    evidenceType: 'static' | 'dynamic',
  ): Promise<SecurityRecord>
  /**
   * Advance one stage after its required records exist, or revisit an earlier stage.
   * @param phase - Requested analysis stage.
   * @param rationale - Explanation of the phase change.
   * @param source - Logged tool call that requested the change.
   * @returns the committed transition, or undefined when already in that phase.
   */
  advance(phase: SecurityPhase, rationale: string, source: SecuritySource): Promise<SecurityTransition | undefined>
  /**
   * Refuse new writes, finish accepted writes, and release the domain.
   * @returns resolution after all owned persistence work settles.
   */
  close(): Promise<void>
}

const phases: readonly SecurityPhase[] = phaseSchema.options
const requiredKind: Record<SecurityPhase, SecurityRecordKind> = {
  recon: 'asset',
  surface: 'surface',
  assessment: 'hypothesis',
  validation: 'validation',
}

/**
 * Open one engagement's records; the caller owns close and only one handle may be open.
 * Domain identifiers encode hyphens as underscores because storage uses SQL-safe names.
 * @param ctx - Context with the storageDomain service installed.
 * @param engagementId - Lowercase letters, digits, and hyphens, at most 48 characters.
 * @returns the opened engagement store.
 */
export async function openSecurityStore(ctx: Context, engagementId: string): Promise<SecurityStore> {
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(engagementId)) {
    throw new Error('engagementId must match /^[a-z0-9][a-z0-9-]{0,47}$/')
  }
  const domain = await ctx.storageDomain.open(
    defineDomain({
      name: `security_${engagementId.replaceAll('-', '_')}`,
      version: 1,
      global: {
        schema: z.object({ assets: assetBindingSchema.nullable() }).strict(),
        initial: { assets: null },
      },
      tables: {
        records: domainTable<SecurityRecordId, SecurityRecord>(recordSchema),
        workflow: domainTable<string, SecurityTransition>(transitionSchema),
      },
    }),
  )
  const records = domain.table('records')
  const transitions = domain.table('workflow')
  let chain: Promise<void> = Promise.resolve()
  let closing: Promise<void> | undefined

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (closing !== undefined) return Promise.reject(new Error('security store is closed'))
    const result = chain.then(operation)
    chain = result.then(
      () => {},
      () => {},
    )
    return result
  }

  function workflow(): SecurityWorkflow {
    const history = [...transitions.entries()]
      .map(([, entry]) => entry)
      .sort((left, right) => left.sequence - right.sequence)
    return { phase: history.at(-1)?.phase ?? 'recon', history }
  }

  function validateReferences(record: SecurityRecord): void {
    const refs = record.evidenceIds.map((id) => {
      const referenced = records.get(brandString<SecurityRecordId>(id))
      if (
        referenced === undefined ||
        referenced.engagementId !== engagementId ||
        referenced.assetId !== record.assetId
      ) {
        throw new Error(`record reference '${id}' must exist in this engagement for asset '${record.assetId}'`)
      }
      return referenced
    })
    if (record.kind === 'validation') {
      if (!['confirmed', 'refuted', 'inconclusive'].includes(record.status)) {
        throw new Error('validation requires confirmed, refuted, or inconclusive assessment status')
      }
      if (
        record.status !== 'inconclusive' &&
        refs.some(
          ref =>
            ref.evidenceType === 'dynamic' &&
            typeof ref.details === 'object' &&
            ref.details !== null &&
            !Array.isArray(ref.details) &&
            ref.details['truncated'] === true,
        )
      ) {
        throw new Error('confirmed or refuted validation cannot cite truncated dynamic evidence')
      }
      if (
        !refs.some(ref => ref.kind === 'hypothesis') ||
        !refs.some(ref => ref.kind === 'evidence' && ref.evidenceType === 'dynamic')
      ) {
        throw new Error(
          'validation requires a same-asset hypothesis and dynamic evidence; text must explain the assessment',
        )
      }
    }
  }

  async function append(input: SecurityRecord): Promise<SecurityRecord> {
    const record = recordSchema.parse(input)
    validateReferences(record)
    await records.put(record.id, record)
    return record
  }

  try {
    for (const [key, record] of records.entries()) {
      if (record.id !== key || record.engagementId !== engagementId) {
        throw new Error('stored security record identity does not match its engagement or storage key')
      }
      validateReferences(record)
    }
    for (const [index, transition] of workflow().history.entries()) {
      if (transition.sequence !== index + 1 || transitions.get(String(transition.sequence)) !== transition) {
        throw new Error('stored security workflow sequence is not contiguous')
      }
    }
  } catch (error) {
    await domain.close()
    throw error
  }

  return {
    async bindAssets(assets) {
      const parsed = assetBindingSchema
        .parse(assets)
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      if (new Set(parsed.map(asset => asset.id)).size !== parsed.length) throw new Error('asset ids must be unique')
      return enqueue(async () => {
        const current = domain.global.get().assets
        if (current !== null && JSON.stringify(current) !== JSON.stringify(parsed)) {
          throw new Error('engagement asset ids or SHA-256 digests changed; use a new engagement')
        }
        if ([...records.entries()].some(([, record]) => !parsed.some(asset => asset.id === record.assetId))) {
          throw new Error('engagement records refer to an asset outside the configured roster')
        }
        if (current === null) await domain.global.set({ assets: parsed })
      })
    },
    get: id => records.get(brandString<SecurityRecordId>(id)),
    workflow,
    search(request, maxLimit) {
      if (
        !Number.isSafeInteger(maxLimit) ||
        maxLimit < 1 ||
        !Number.isSafeInteger(request.limit) ||
        request.limit < 1 ||
        request.limit > maxLimit ||
        !Number.isSafeInteger(request.offset) ||
        request.offset < 0
      ) {
        throw new Error('search requires a nonnegative integer offset and a positive integer limit within maxLimit')
      }
      const words = (request.query ?? '').toLowerCase().split(/\s+/u).filter(Boolean)
      const matches = [...records.entries()]
        .map(([, record]) => record)
        .filter((record) => {
          if (request.assetId !== undefined && record.assetId !== request.assetId) return false
          if (request.kind !== undefined && record.kind !== request.kind) return false
          if (request.status !== undefined && record.status !== request.status) return false
          const searchable = `${record.title}\n${record.text}\n${record.tags.join(' ')}`.toLowerCase()
          return words.every(word => searchable.includes(word))
        })
        .sort(
          (left, right) => left.createdAt - right.createdAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
        )
      const end = request.offset + request.limit
      return {
        records: matches.slice(request.offset, end),
        total: matches.length,
        nextOffset: end < matches.length ? end : null,
      }
    },
    async appendRecord(input, source) {
      const parsed = recordInputSchema.parse(input)
      const origin = sourceSchema.parse(source)
      return enqueue(() =>
        append({
          ...parsed,
          id: brandString<SecurityRecordId>(randomUUID()),
          engagementId,
          source: origin,
          createdAt: Date.now(),
          ...(parsed.kind === 'validation' ? { assessment: true as const } : {}),
        }),
      )
    },
    async appendEvidence(input, source, evidenceType) {
      const parsed = evidenceInputSchema.parse(input)
      const origin = sourceSchema.parse(source)
      return enqueue(() =>
        append({
          ...parsed,
          id: brandString<SecurityRecordId>(randomUUID()),
          engagementId,
          source: origin,
          createdAt: Date.now(),
          kind: 'evidence',
          status: 'observed',
          evidenceType,
        }),
      )
    },
    async advance(phase, rationale, source) {
      const parsed = transitionSchema.omit({ sequence: true, createdAt: true }).parse({ phase, rationale, source })
      return enqueue(async () => {
        const current = workflow()
        const distance = phases.indexOf(phase) - phases.indexOf(current.phase)
        if (distance === 0) return undefined
        if (distance > 1) throw new Error(`cannot skip analysis stages from '${current.phase}' to '${phase}'`)
        if (distance > 0 && ![...records.entries()].some(([, record]) => record.kind === requiredKind[current.phase])) {
          throw new Error(
            `phase '${current.phase}' requires at least one '${requiredKind[current.phase]}' record before advancing`,
          )
        }
        const transition = { ...parsed, sequence: current.history.length + 1, createdAt: Date.now() }
        await transitions.put(String(transition.sequence), transition)
        return transition
      })
    },
    close() {
      closing ??= chain.then(() => domain.close())
      return closing
    },
  }
}

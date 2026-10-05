/** Durable engineering suggestions and bounded, task-owned observations. @module */
import { z } from 'zod'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one engineering suggestion across security tasks. */
export type EvolutionProposalId = Branded<'SecurityEvolutionProposal'>
/** Identifies one isolated improvement analysis. */
export type EvolutionRunId = Branded<'SecurityEvolutionRun'>
const text = z.string().trim().min(1)
const proposalId = text.transform(brandString<EvolutionProposalId>)
const runId = text.transform(brandString<EvolutionRunId>)

/** Operator-owned progress; model output cannot set this field. */
export const evolutionStatusSchema = z.enum(['open', 'modified', 'verified', 'ignored'])
/** A clipped observation with an exact original event or domain-record reference. */
export const evolutionSourceSchema = z.object({
  id: text, projectId: text, sessionId: z.string(), seq: z.number().int().nonnegative().optional(),
  kind: text, excerpt: z.string(), truncated: z.boolean(), recordedAt: z.number(),
}).strict()
/** Task-owned evidence passed to the improvement model. */
export type EvolutionSource = z.infer<typeof evolutionSourceSchema>
/** Resolved route retained when the coordinating Agent leaves memory. */
export const evolutionRouteSchema = z.object({ provider: text, model: text }).strict()
/** Claims supplied by an external coding AI, not independently verified execution. */
export const evolutionReceiptSchema = z.object({
  version: z.literal(1), proposalId, proposalRevision: z.number().int().positive(),
  summary: text.max(8000), references: z.array(text.max(2000)).max(30),
  tests: z.array(z.object({ command: text.max(2000), result: text.max(4000) }).strict()).max(50),
  remaining: z.array(text.max(2000)).max(30),
}).strict()
/** Portable implementation receipt accepted through operator import. */
export type EvolutionReceipt = z.infer<typeof evolutionReceiptSchema>
/** Model-authored behavior change; source IDs must resolve in the saved input. */
export const evolutionSuggestionSchema = z.object({
  existingId: proposalId.optional(), title: text.max(160), component: text.max(160),
  conditions: text.max(1000), problem: text.max(2000), change: text.max(3000),
  acceptance: z.array(text.max(1000)).min(1).max(8),
  uncertainty: z.string().max(1000), sourceIds: z.array(text).min(1).max(20),
}).strict()
/** Structured completion; an empty suggestions array is a useful result. */
export const evolutionOutputSchema = z.object({ suggestions: z.array(evolutionSuggestionSchema) }).strict()
const occurrenceSchema = z.object({ projectId: text, runId, source: evolutionSourceSchema, version: text }).strict()
/** One global suggestion, with independent operator progress and task-owned evidence. */
export const evolutionProposalSchema = evolutionSuggestionSchema.omit({ existingId: true, sourceIds: true }).extend({
  id: proposalId, revision: z.number().int().positive(), status: evolutionStatusSchema,
  occurrences: z.array(occurrenceSchema), receipts: z.array(evolutionReceiptSchema),
  needsReview: z.boolean(), createdAt: z.number(), updatedAt: z.number(),
}).strict()
/** A suggestion shown in the shared improvement pool. */
export type EvolutionProposal = z.infer<typeof evolutionProposalSchema>
/** Immutable bounded model input, including the allowed merge candidates. */
export const evolutionInputSchema = z.object({
  projectId: text, objective: z.string(), version: text, sources: z.array(evolutionSourceSchema),
  gaps: z.array(z.string()), candidates: z.array(evolutionProposalSchema.pick({
    id: true, title: true, component: true, conditions: true, problem: true, change: true,
  })),
}).strict()
/** Exact evidence snapshot for a model request. */
export type EvolutionInput = z.infer<typeof evolutionInputSchema>
/** Durable run settlement, independent of security approval revisions. */
export const evolutionRunSchema = z.object({
  id: runId, projectId: text, status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted']),
  manual: z.boolean(), createdAt: z.number(), updatedAt: z.number(),
  sessionId: z.string().optional(), inputHash: z.string().optional(), input: evolutionInputSchema.optional(),
  detail: z.string(), proposalIds: z.array(proposalId),
  gaps: z.array(z.string()).optional(),
}).strict()
/** Visible analysis lifecycle and the retained input cutoff. */
export type EvolutionRun = z.infer<typeof evolutionRunSchema>
/** Project-local pending evidence, owned by the evolution scheduler. */
export const evolutionTaskSchema = z.object({
  projectId: text, changedAt: z.number(), route: evolutionRouteSchema.optional(),
  sources: z.array(evolutionSourceSchema), dropped: z.number().int().nonnegative(),
  requested: z.boolean(), manual: z.boolean(), lastInputHash: z.string(),
}).strict()
/** Single-record atomic state; Session purposes survive task evidence deletion. */
export const evolutionStateSchema = z.object({
  revision: z.number().int().nonnegative(), tasks: z.array(evolutionTaskSchema),
  bindings: z.array(z.object({ sessionId: text, projectId: text,
    fromSeq: z.number().int().nonnegative(), toSeq: z.number().int().nonnegative() }).strict()).default([]),
  runs: z.array(evolutionRunSchema), proposals: z.array(evolutionProposalSchema),
  sessionPurposes: z.array(z.string()), deletedProjects: z.array(z.string()),
  operations: z.record(z.string(), z.string()),
}).strict()
/** Storage-domain projection, committed in one durable write. */
export type EvolutionState = z.infer<typeof evolutionStateSchema>
/** Operator list response excludes raw inputs and internal scheduling metadata. */
export interface EvolutionView {
  revision: number
  proposals: EvolutionProposal[]
  runs: EvolutionRun[]
}
/** Downloadable files generated from the selected proposal revision. */
export interface EvolutionBundle {
  markdown: string
  proposal: string
  receipt: string
}

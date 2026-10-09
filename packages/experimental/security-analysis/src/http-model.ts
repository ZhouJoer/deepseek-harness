/** Versioned HTTP plans and redacted evidence for operator-registered sites. @module */
import { z } from 'zod'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { EvidenceId, AssetId } from './workbench/model.ts'

/** Identifies a target-owned authentication profile. */
export type HttpIdentityId = Branded<'SecurityHttpIdentity'>
/** Identifies a step within one immutable HTTP plan. */
export type HttpStepId = Branded<'SecurityHttpStep'>
/** Identifies an immutable authentication configuration version. */
export type HttpIdentityRevision = Branded<'SecurityHttpIdentityRevision'>
const id = z.string().min(1).max(128)
/** Values are literal text or Host-resolved references; references never change routing. */
export const httpValueSchema = z.union([z.string(), z.object({ secret: id }).strict(), z.object({ variable: id }).strict()])
const fields = z.array(z.object({ name: z.string().min(1), value: httpValueSchema }).strict())
/** Declarative extraction reads one scalar without executing response content. */
export const httpExtractionSchema = z.object({ name: id, from: z.enum(['input', 'json', 'header']), key: z.string().min(1) }).strict()
/** Bounded response assertions; failure stops the sequence. */
export const httpAssertionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status'), value: z.number().int().min(100).max(599) }).strict(),
  z.object({ kind: z.literal('contains'), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('json'), pointer: z.string(), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) }).strict(),
])
/** One request and its approved response handling. */
export const httpStepSchema = z.object({
  id: id.transform(brandString<HttpStepId>), label: z.string().min(1),
  method: z.enum(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']), path: z.string().min(1),
  identityId: id.transform(brandString<HttpIdentityId>).optional(), login: z.boolean().optional(),
  query: fields.default([]), headers: fields.default([]),
  body: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('text'), value: httpValueSchema }).strict(),
    z.object({ kind: z.literal('json'), fields }).strict(),
    z.object({ kind: z.literal('form'), fields }).strict(),
  ]).optional(),
  extract: z.array(httpExtractionSchema).default([]), assertions: z.array(httpAssertionSchema).default([]),
}).strict()
/** A fixed finite sequence; preparation binds authentication versions. */
export const httpSequenceSchema = z.object({
  steps: z.array(httpStepSchema).min(1),
  identities: z.array(z.object({ id: id.transform(brandString<HttpIdentityId>),
    revision: id.transform(brandString<HttpIdentityRevision>) }).strict()).default([]),
  replayOf: z.object({ evidenceId: id.transform(brandString<EvidenceId>),
    stepId: id.transform(brandString<HttpStepId>).optional() }).strict().optional(),
  prepared: z.literal(true).optional(),
}).strict()
/** Secret input accepted only by the authenticated configuration Remote. */
export const httpIdentityInputSchema = z.object({
  id: id.transform(brandString<HttpIdentityId>).optional(), label: z.string().trim().min(1),
  mode: z.enum(['cookie', 'bearer', 'basic', 'login']),
  secrets: z.record(id, z.string().min(1)),
  loginSteps: z.array(httpStepSchema).default([]),
  tokenVariable: id.optional(),
}).strict()
/** Browser-safe identity description; values are never returned. */
export interface HttpIdentityDescription {
  id: HttpIdentityId
  revision: HttpIdentityRevision
  label: string
  mode: 'cookie' | 'bearer' | 'basic' | 'login'
  secretNames: string[]
  loginSteps: HttpStep[]
  tokenVariable?: string
}
/** One approved request. */
export type HttpStep = z.infer<typeof httpStepSchema>
/** Complete resolved plan parameters. */
export type HttpSequence = z.infer<typeof httpSequenceSchema>
/** Header/body values resolved in Host memory. */
export type HttpValue = z.infer<typeof httpValueSchema>
/** A response summary safe to index without reading its body. */
export const httpExchangeSummarySchema = z.object({
  stepId: id.transform(brandString<HttpStepId>), label: z.string(), method: z.string(), path: z.string(),
  status: z.number().int().optional(), durationMs: z.number().nonnegative(), bytes: z.number().int().nonnegative(),
  incomplete: z.boolean(), outcome: z.enum(['observed', 'failed', 'skipped']), detail: z.string(), login: z.boolean(),
}).strict()
/** Index metadata attached to the existing evidence record. */
export const httpSummarySchema = z.object({ version: z.literal(1), exchanges: z.array(httpExchangeSummarySchema) }).strict()
/** Sanitized per-step observation; no final credential-bearing request is retained. */
export const httpExchangeSchema = httpExchangeSummarySchema.extend({
  request: httpStepSchema, headers: z.array(z.tuple([z.string(), z.string()])), body: z.string(), bodyOmitted: z.boolean(),
}).strict()
/** Complete bounded artifact saved by one plan execution. */
export const httpEvidenceSchema = z.object({ version: z.literal(1), exchanges: z.array(httpExchangeSchema) }).strict()
/** Index projection for one saved HTTP sequence. */
export type HttpSummary = z.infer<typeof httpSummarySchema>
/** A sanitized request/response pair. */
export type HttpExchange = z.infer<typeof httpExchangeSchema>
/** Paged history row tied to an existing evidence record. */
export interface HttpHistoryItem extends z.infer<typeof httpExchangeSummarySchema> { evidenceId: EvidenceId
  assetId: AssetId
  createdAt: number }
/** Bounded project history page. */
export interface HttpHistoryPage { items: HttpHistoryItem[]; next: number | null; through: number }
/** One step with a byte window of its sanitized body. */
export interface HttpExchangePage {
  stepId: HttpStepId
  part: 'request' | 'headers' | 'body'
  text: string
  offset: number
  next: number | null
  totalBytes: number
  incomplete: boolean
  bodyOmitted: boolean
}

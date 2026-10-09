/** Graph references preserve the meaning and uncertainty of saved investigation records. @module */
import { expect, it } from 'vitest'
import { investigation, visibleInvestigation } from '../src/client/investigation.ts'
import { investigationFixture } from './investigation-fixture.ts'

it('uses recorded dependencies, support and opposition without deriving links from time or shared assets', () => {
  const graph = investigation(investigationFixture())
  expect(graph.edges).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: 'check:read', target: 'check:verify', relation: 'graphDepends' }),
    expect.objectContaining({ source: 'evidence:partial', target: 'review:review', relation: 'graphOpposes' }),
    expect.objectContaining({ source: 'asset:input', target: 'evidence:partial', relation: 'graphSubject' }),
  ]))
  expect(graph.edges.some(edge => edge.source === 'checkpoint:first' && edge.target === 'checkpoint:second')).toBe(false)
  expect(graph.edges.some(edge => edge.source === 'check:verify' && edge.target === 'evidence:partial')).toBe(false)
  expect(graph.nodes.find(node => node.id === 'finding:finding')).toMatchObject({ title: 'Missing ownership check', state: 'suspected' })
  expect(graph.nodes.find(node => node.id === 'review:review')?.state).toBeUndefined()
  expect(graph.missing.get('finding:finding')).toBe(1)
  expect(graph.nodes.some(node => node.title === 'missing')).toBe(false)
})

it('folds linked observations while retaining orphan observations and explicitly labeling the projected references', () => {
  const graph = investigation(investigationFixture())
  const folded = visibleInvestigation(graph, false)
  expect(folded.nodes.some(node => node.id === 'evidence:source')).toBe(false)
  expect(folded.nodes.find(node => node.id === 'evidence:partial')).toMatchObject({ attention: true, state: 'failed' })
  expect(folded.edges).toContainEqual(expect.objectContaining({ source: 'check:read', target: 'finding:finding', relation: 'graphLinkedObservation' }))
  expect(visibleInvestigation(graph, true)).toBe(graph)
  expect(new Set(folded.edges.map(edge => edge.id)).size).toBe(folded.edges.length)
})

it('retains separate identities for equal titles and does not mutate committed records', () => {
  const view = investigationFixture()
  const before = structuredClone(view)
  const graph = investigation(view)
  expect(graph.nodes.find(node => node.id === 'check:verify')).toMatchObject({ attention: true, state: 'blocked' })
  expect(graph.nodes.filter(node => node.title === 'Missing ownership check')).toHaveLength(2)
  visibleInvestigation(graph, false)
  expect(view).toEqual(before)
})

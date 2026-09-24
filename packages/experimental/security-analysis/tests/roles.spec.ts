/** Role tool sets and task prompts cannot expand delegated execution authority. @module */
import { describe, expect, it } from 'vitest'
import { canObserve, delegationPrompt, resolveTask, toolsForRole } from '../src/workbench/roles.ts'

describe('security role assignments', () => {
  it('gives research network lookup and confines reviewers to existing evidence', () => {
    expect(toolsForRole('researcher')).toContain('web_search')
    expect(toolsForRole('reviewer')).not.toContain('web_fetch')
    for (const role of ['reconnaissance', 'reverse-analyst', 'researcher', 'reviewer'] as const) {
      expect(toolsForRole(role)).not.toContain('security_execute')
      expect(toolsForRole(role)).not.toContain('security_delegate')
    }
    expect(canObserve('reconnaissance', 'ghidra', 'functions')).toBe(true)
    expect(canObserve('reconnaissance', 'ghidra', 'decompile')).toBe(false)
    expect(canObserve('reverse-analyst', 'ghidra', 'decompile')).toBe(true)
    expect(canObserve('reverse-analyst', 'android', 'decompile')).toBe(true)
    expect(canObserve('reconnaissance', 'android', 'device')).toBe(true)
    for (const role of ['coordinator', 'reconnaissance', 'reverse-analyst', 'researcher', 'reviewer'] as const) {
      expect(canObserve(role, 'ghidra', 'rename')).toBe(false)
      expect(canObserve(role, 'frida', 'script')).toBe(false)
    }
    expect(canObserve('researcher', 'binary', 'identity')).toBe(false)
  })
  it('rejects incompatible assignments and records the bounded task in the initial message', () => {
    expect(resolveTask('reconnaissance')).toBe('inventory')
    expect(resolveTask('reverse-analyst', 'assessment')).toBe('assessment')
    expect(() => resolveTask('researcher', 'surface')).toThrow('incompatible')
    const prompt = delegationPrompt({ role: 'reviewer', task: 'review', assetId: 'sample', question: 'Confirm?',
      criterion: 'Cite contrary evidence', durationMs: 3000, maxOutputBytes: 4096 })
    expect(prompt).toContain('Independently')
    expect(prompt).toContain('confirmed, refuted or inconclusive')
    expect(prompt).toContain('3000 ms total')
    expect(prompt).toContain('Assigned asset: sample')
    expect(prompt).toContain('"completionCriterion":"Cite contrary evidence"')
    expect(prompt).toContain('not additional authority')
    expect(prompt).toContain('Without a recorded finding, return the evidence assessment through structured_output')
    expect(prompt).toContain('Never invent finding IDs or hashes')
  })
})

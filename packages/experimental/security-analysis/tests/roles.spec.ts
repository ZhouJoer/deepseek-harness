/** Role tool sets and task prompts cannot expand delegated execution authority. @module */
import { describe, expect, it } from 'vitest'
import { canObserve, delegationPrompt, resolveTask, toolsForRole } from '../src/workbench/roles.ts'

describe('security role assignments', () => {
  it('directs binary collectors to installed reverse tools before custom parsing', () => {
    for (const role of ['reconnaissance', 'reverse-analyst'] as const) {
      const prompt = delegationPrompt({ role, task: resolveTask(role), assetId: 'sample', question: 'Inspect ELF functions',
        criterion: 'Identify one function', durationMs: 3000, maxOutputBytes: 4096 })
      expect(prompt).toContain('query security_capabilities')
      expect(prompt).not.toContain('radare2')
      expect(prompt).toContain('check them with security_environment')
      expect(prompt).toContain('demonstrated gap')
    }
    const reviewer = delegationPrompt({ role: 'reviewer', task: 'review', assetId: 'sample', question: 'Review evidence',
      criterion: 'Assess evidence', durationMs: 3000, maxOutputBytes: 4096 })
    expect(reviewer).not.toContain('Prefer available radare2/r2')
  })
  it('exposes native coding and job collection only to collecting roles', () => {
    for (const role of ['coordinator', 'reconnaissance', 'reverse-analyst', 'web-analyst'] as const)
      for (const tool of ['bash', 'pwsh', 'write', 'edit', 'read', 'glob', 'grep', 'job_output', 'job_kill', 'security_capture_analysis'])
        expect(toolsForRole(role)).toContain(tool)
    for (const role of ['researcher', 'reviewer'] as const)
      for (const tool of ['bash', 'pwsh', 'write', 'security_capture_analysis']) expect(toolsForRole(role)).not.toContain(tool)
    expect(toolsForRole('reviewer')).toContain('security_review')
  })
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

/** Device prerequisites remain independent of radio capture validation. @module */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { captureInterfaces, inspectDevices, uncheckedDevices } from '../src/device-inventory.ts'
import { runProcess } from '../src/workbench/process.ts'
import type { SecurityEnvironment } from '../src/workbench/providers.ts'
import type { ToolboxInventory } from '../src/toolbox-types.ts'

vi.mock('../src/workbench/process.ts', async original => ({ ...await original<typeof import('../src/workbench/process.ts')>(), runProcess: vi.fn() }))
const run = vi.mocked(runProcess)
const env: SecurityEnvironment = { id: 'local', kind: 'local', label: 'Host', cwd: process.cwd(), tools: [] }
const inventory: ToolboxInventory = { environmentId: 'local', kind: 'local', runtime: 'ready', detail: '', checkedAt: 1, workdir: env.cwd,
  tools: ['python', 'tshark'].map(id => ({ id, category: 'utility', status: 'available', command: id, version: '1', location: id, source: 'PATH', detail: '', installUrl: '', invocation: 'shell' })) }
const limits = { durationMs: 1000, maxOutputBytes: 10000, graceMs: 100 }
const ok = (stdout: string) => ({ stdout, stderr: '', exitCode: 0, signal: null, cancelled: false, timedOut: false, truncated: false })
const ctx = new Context()
afterEach(() => { vi.resetAllMocks() })

it('reads unchecked directories without executing anything', () => {
  expect(uncheckedDevices(env).checks.every(check => check.status === 'not-checked')).toBe(true)
  expect(run).not.toHaveBeenCalled()
})
it('parses interface identifiers without mistaking an ordinary adapter for an nRF sniffer', () => {
  expect(captureInterfaces('1. \\Device\\NPF_{A} (Ethernet)\n2. nrf_sniffer_ble_COM8 (nRF Sniffer for Bluetooth LE)\n').map(item => item.kind))
    .toEqual(['capture', 'nrf-extcap'])
  expect(() => captureInterfaces('Access denied')).toThrow('Unrecognized')
  expect(captureInterfaces('')).toEqual([])
})
it('reports serial identity and stopped drivers without claiming capture support', async () => {
  run.mockImplementation(async (_ctx, _env, tool) => ok(tool === 'powershell' ? JSON.stringify({
    serial: [{ name: 'USB Serial', path: 'COM7', pnpId: 'USB\\VID_2E8A&PID_0005\\1234' },
      { name: 'Another serial', path: 'COM8', pnpId: 'USB\\VID_1234&PID_5678\\A&B' }], serialError: '', npcap: false, npcapError: '',
  }) : '1. nrf_sniffer_ble_COM4 (nRF Sniffer for Bluetooth LE)'))
  const result = await inspectDevices(ctx, env, inventory, limits, new AbortController().signal)
  expect(result.devices[0]).toMatchObject({ path: 'COM7', vendorId: '2E8A', productId: '0005', serialNumber: '1234' })
  expect(result.devices[1]?.serialNumber).toBeUndefined()
  expect(result.checks.find(check => check.id === 'npcap')?.status).toBe('missing')
  expect(result.checks.find(check => check.id === 'capture-validation')?.status).toBe('not-checked')
  expect(run.mock.calls.find(call => call[2] === 'tshark')?.[3]).toEqual(['-D'])
})
it('keeps permission errors distinct from missing devices and missing tools', async () => {
  run.mockResolvedValue(ok(JSON.stringify({ serial: [], serialError: 'Access denied', npcap: null, npcapError: '' })))
  const result = await inspectDevices(ctx, env, { ...inventory, tools: [] }, limits, new AbortController().signal)
  expect(result.checks.find(check => check.id === 'serial')).toMatchObject({ status: 'error', detail: 'Access denied' })
  expect(result.checks.find(check => check.id === 'npcap')?.status).toBe('missing')
  expect(result.checks.find(check => check.id === 'capture-interfaces')?.status).toBe('not-checked')
  expect(run).toHaveBeenCalledOnce()
})
it('rejects malformed or truncated diagnostics and propagates cancellation', async () => {
  run.mockResolvedValue({ ...ok('{}'), truncated: true })
  const result = await inspectDevices(ctx, env, inventory, limits, new AbortController().signal)
  expect(result.checks.filter(check => check.status === 'error').map(check => check.id)).toEqual(['npcap', 'serial', 'capture-interfaces', 'nrf-extcap'])
  const abort = new AbortController(); abort.abort(new Error('cancelled'))
  await expect(inspectDevices(ctx, env, inventory, limits, abort.signal)).rejects.toThrow('cancelled')
})

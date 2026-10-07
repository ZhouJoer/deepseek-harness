/** Read-only Windows service and interface diagnostics through managed subprocesses. @module */
import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import type { DeviceInventory, RadioDevice, RadioDeviceId } from './device-types.ts'
import type { SecurityEnvironment } from './workbench/providers.ts'
import { runProcess, requireProcessSuccess } from './workbench/process.ts'
import type { ToolboxInventory } from './toolbox-types.ts'

const checkIds = ['python', 'tshark', 'npcap', 'serial', 'capture-interfaces', 'nrf-extcap', 'capture-validation'] as const
const windowsQuery = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$result = @{serial=@();serialError='';npcap=$null;npcapError=''}
try {
  $result.serial = @(Get-CimInstance Win32_SerialPort -ErrorAction Stop | ForEach-Object {
    @{name=[string]$_.Name;path=[string]$_.DeviceID;pnpId=[string]$_.PNPDeviceID}
  })
} catch { $result.serialError = $_.Exception.Message }
try {
  $driver = @(Get-CimInstance Win32_SystemDriver -Filter "Name='npcap'" -ErrorAction Stop)
  if ($driver.Count -gt 0) { $result.npcap = [bool]$driver[0].Started }
} catch { $result.npcapError = $_.Exception.Message }
ConvertTo-Json -InputObject $result -Depth 4 -Compress
`
const windowsResult = z.object({
  serial: z.array(z.object({ name: z.string(), path: z.string().regex(/^COM\d+$/i), pnpId: z.string() })),
  serialError: z.string(), npcap: z.boolean().nullable(), npcapError: z.string(),
})
function identity(kind: string, value: string): RadioDeviceId {
  return brandString<RadioDeviceId>(createHash('sha256').update(kind + ':' + value.toUpperCase()).digest('hex'))
}
/** Create a directory without inspecting software or hardware.
 * @param environment - selected deployment.
 * @returns unchecked prerequisites and no inferred devices.
 */
export function uncheckedDevices(environment: SecurityEnvironment): DeviceInventory {
  return { environmentId: environment.id, checkedAt: 0, devices: [],
    checks: checkIds.map(id => ({ id, status: 'not-checked', detail: '' })) }
}
/** Decode the numeric interface-list format, never localized command diagnostics.
 * @param text - successful TShark -D output.
 * @returns interface identities; unexpected output is rejected.
 */
export function captureInterfaces(text: string): RadioDevice[] {
  return text.split(/\r?\n/u).filter(line => line.trim()).map((line) => {
    const match = /^\d+\. (\S+)(?: \((.*)\))?$/u.exec(line)
    if (!match?.[1]) throw new Error('Unrecognized TShark interface list')
    const path = match[1], name = match[2] ?? path
    const kind = /nrf.*sniff|nordic.*ble/i.test(path + ' ' + name) ? 'nrf-extcap' : 'capture'
    return { id: identity('capture', path), kind, path, name, observedAt: Date.now() }
  })
}
/** Inspect prerequisites without opening a serial port, starting capture, or changing driver state.
 * @param ctx - host subprocess service.
 * @param environment - explicit local deployment.
 * @param inventory - measured optional software.
 * @param limits - operation bounds.
 * @param signal - inspection cancellation.
 * @returns independent measurements; capture validation always remains unchecked.
 */
export async function inspectDevices(ctx: Context, environment: SecurityEnvironment, inventory: ToolboxInventory,
  limits: { durationMs: number; maxOutputBytes: number; graceMs: number }, signal: AbortSignal): Promise<DeviceInventory> {
  const result = uncheckedDevices(environment)
  const set = (id: typeof checkIds[number], status: DeviceInventory['checks'][number]['status'], detail = '') => {
    result.checks = result.checks.map(check => check.id === id ? { id, status, detail } : check)
  }
  if (environment.kind !== 'local') {
    for (const check of result.checks) check.status = 'unsupported'
    return result
  }
  signal.throwIfAborted()
  result.checkedAt = Date.now()
  for (const id of ['python', 'tshark'] as const) {
    const tool = inventory.tools.find(item => item.id === id)
    set(id, tool?.status ?? 'not-checked', tool?.detail || tool?.version || '')
  }
  const measuredEnvironment = { ...environment, tools: [...environment.tools] }
  for (const tool of inventory.tools.filter(item => item.status === 'available')) {
    if (!measuredEnvironment.tools.some(item => item.id === tool.id)) measuredEnvironment.tools.push({
      id: tool.id, command: tool.command, prefixArgs: tool.prefixArgs ?? [], source: tool.source, versionArgs: ['--version'],
    })
  }
  const powershell = environment.tools.find(tool => tool.id === 'powershell') ?? {
    id: 'powershell', command: 'powershell.exe', versionArgs: [], source: 'Windows system tool',
  }
  try {
    const process = await runProcess(ctx, { ...environment, tools: [...environment.tools.filter(tool => tool.id !== 'powershell'), powershell] },
      'powershell', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', windowsQuery], { ...limits, signal })
    requireProcessSuccess(process)
    if (process.truncated) throw new Error('Windows device diagnostics exceeded the output limit')
    const data = windowsResult.parse(JSON.parse(process.stdout.replace(/^\uFEFF/u, '')))
    set('npcap', data.npcapError ? 'error' : data.npcap === null ? 'missing' : data.npcap ? 'available' : 'missing',
      data.npcapError || (data.npcap === false ? 'Npcap driver is stopped' : ''))
    set('serial', data.serialError ? 'error' : data.serial.length ? 'available' : 'missing', data.serialError)
    result.devices.push(...data.serial.map((item) => {
      const vendorId = /VID_([0-9A-F]{4})/i.exec(item.pnpId)?.[1], productId = /PID_([0-9A-F]{4})/i.exec(item.pnpId)?.[1]
      const tail = item.pnpId.split('\\').at(-1)
      return { ...item, kind: 'serial' as const, id: identity('serial', item.pnpId || item.path), observedAt: result.checkedAt,
        ...(vendorId ? { vendorId } : {}), ...(productId ? { productId } : {}),
        ...(vendorId && tail && !tail.includes('&') ? { serialNumber: tail } : {}) }
    }))
  } catch (error) {
    signal.throwIfAborted()
    const detail = error instanceof Error ? error.message : String(error)
    set('serial', 'error', detail); set('npcap', 'error', detail)
  }
  if (inventory.tools.find(tool => tool.id === 'tshark')?.status === 'available') {
    try {
      const process = await runProcess(ctx, measuredEnvironment, 'tshark', ['-D'], { ...limits, signal })
      requireProcessSuccess(process)
      if (process.truncated) throw new Error('Capture interface list exceeded the output limit')
      const interfaces = captureInterfaces(process.stdout)
      result.devices.push(...interfaces)
      set('capture-interfaces', interfaces.length ? 'available' : 'missing')
      set('nrf-extcap', interfaces.some(item => item.kind === 'nrf-extcap') ? 'available' : 'missing')
    } catch (error) {
      signal.throwIfAborted()
      const detail = error instanceof Error ? error.message : String(error)
      set('capture-interfaces', 'error', detail); set('nrf-extcap', 'error', detail)
    }
  }
  return result
}

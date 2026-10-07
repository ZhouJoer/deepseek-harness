/** Browser-safe observations of Windows interfaces; discovery never establishes capture readiness. @module */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies a host interface independently of its display name. */
export type RadioDeviceId = Branded<'SecurityRadioDevice'>
/** One independently checked prerequisite. */
export interface DeviceCheck {
  id: 'python' | 'tshark' | 'npcap' | 'serial' | 'capture-interfaces' | 'nrf-extcap' | 'capture-validation'
  status: 'not-checked' | 'available' | 'missing' | 'unsupported' | 'error'
  detail: string
}
/** A discovered interface, not an authenticated device or a verified radio capability. */
export interface RadioDevice {
  id: RadioDeviceId
  kind: 'serial' | 'capture' | 'nrf-extcap'
  name: string
  path: string
  pnpId?: string
  vendorId?: string
  productId?: string
  serialNumber?: string
  /** Time this interface was observed; retained entries can precede the latest failed check. */
  observedAt: number
}
/** Last bounded inspection; an empty unchecked list does not mean no devices exist. */
export interface DeviceInventory {
  environmentId: string
  checkedAt: number
  checks: DeviceCheck[]
  devices: RadioDevice[]
}
/** Device diagnostics available independently of a project or Session. */
export interface DeviceDirectory {
  environments: { id: string; label: string; kind: 'local' | 'docker' | 'android' }[]
  inventory: DeviceInventory
}

/** Browser-safe tool inventory observations. @module */

/** A measured installation, independent of project execution authority. */
export interface ToolboxTool {
  id: string
  category: 'runtime' | 'reverse' | 'device' | 'web' | 'utility' | 'custom'
  status: 'available' | 'missing' | 'error' | 'not-checked'
  command: string
  version: string
  location: string
  source: string
  dependency?: string
  detail: string
  installUrl: string
  invocation: 'shell' | 'plugin' | 'python' | 'provider'
  /** Dedicated provider integration; readiness and plan authority are checked separately. */
  provider?: string
}

/** Current runtime health and separately measured optional installations. */
export interface ToolboxInventory {
  environmentId: string
  kind: 'local' | 'docker' | 'android'
  runtime: 'ready' | 'stopped' | 'unavailable'
  detail: string
  checkedAt: number
  containerId?: string
  workdir: string
  tools: ToolboxTool[]
}

/** Operator directory available without a conversation or project selection. */
export interface ToolboxDirectory {
  environments: { id: string; label: string; kind: ToolboxInventory['kind'] }[]
  inventory: ToolboxInventory
}

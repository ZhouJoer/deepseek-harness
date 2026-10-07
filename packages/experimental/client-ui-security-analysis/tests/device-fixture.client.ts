/** Unchecked device endpoints for views that do not inspect host interfaces. @module */
import type { DeviceActions } from '../src/client/DevicePanel.tsx'
/** No hardware or subprocesses are used by these endpoints. */
export const deviceActions: DeviceActions = {
  deviceDirectory: async () => ({ environments: [], inventory: { environmentId: 'local', checkedAt: 0, checks: [], devices: [] } }),
  deviceInventory: async () => { throw new Error('Device inspection is outside this fixture') },
}

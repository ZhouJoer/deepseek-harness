/** Delegated test Sessions admitted through the production assignment flow. @module */
import { randomUUID } from 'node:crypto'
import type { SecurityController } from '../src/workbench/controller.ts'
import { resolveTask, type DelegatedRole } from '../src/workbench/roles.ts'
import type { SecurityDelegation } from '../src/workbench/model.ts'

/** Admit an assignment and bind its fresh child Session.
 * @param controller - initialized workbench.
 * @param parentId - coordinator Session.
 * @param childId - child Session to bind.
 * @param assetId - assigned project asset.
 * @param role - delegated role.
 * @returns persisted assignment identity and scope.
 */
export async function bindDelegatedChild(controller: SecurityController, parentId: string, childId: string,
  assetId: string, role: DelegatedRole): Promise<SecurityDelegation> {
  const assignment = await controller.admitDelegation(parentId, randomUUID(), {
    assetId, role, task: resolveTask(role), question: 'Inspect the assigned fixture', criterion: 'Return bounded observations',
  })
  await controller.bindDelegationChild(assignment.id, childId)
  return assignment
}

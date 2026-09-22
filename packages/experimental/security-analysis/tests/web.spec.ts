/** Scope admission and live Docker inspection validation. @module */
import { it, expect } from 'vitest'
import { scopedWebPath, verifyWebLaboratory, WebProvider } from '../src/web-provider.ts'
import { webAssetSchema } from '../src/workbench/model.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { Context } from '@deepseek-ai/cordis'
import type { AnalysisContext } from '../src/workbench/providers.ts'

const environment: AnalysisContext['environment'] = { id: 'lab', kind: 'docker', cwd: process.cwd(), label: 'Owned lab', tools: [], containerId: 'worker', resolvedImageId: 'image',
  webTarget: { origin: 'http://target:3000', instanceId: 'generation', networkId: 'network', address: '172.30.0.2', laboratoryId: 'owner', target: 'target', targetImageId: 'target-image' } }
function inspection() {
  const container = (Id: string, Image: string, IPAddress: string) => ({ Id, Image, State: { Running: true }, Config: { Labels: { 'dsh.security.laboratory': 'owner' } }, NetworkSettings: { Networks: { network: { IPAddress } } } })
  return [container('worker-id', 'image', '172.30.0.3'), container('target-id', 'target-image', '172.30.0.2'),
    { Internal: true, Labels: { 'dsh.security.laboratory': 'owner' }, Options: { 'com.docker.network.bridge.gateway_mode_ipv4': 'isolated' }, Containers: { 'worker-id': {}, 'target-id': {} } }] satisfies [unknown, unknown, unknown]
}
it.each(['https://example.com/', '//example.com/', '/api/../admin', '/api/%2e%2e/admin', '/api/%252e%252e/admin', '/api/%2525252e/admin', '/other', '/apix', '/api/a#fragment'])('rejects a path outside approved prefix: %s', (path) => {
  expect(() => scopedWebPath('http://target:3000', '/api', path)).toThrow()
})
it('preserves a scoped request query and refuses changed runtime identities', () => {
  expect(scopedWebPath('http://target:3000', '/api', '/api/items?q=test')).toBe('/api/items?q=test')
  const provider = new WebProvider(new Context(), 100)
  const asset = webAssetSchema.parse({
    kind: 'web', id: 'asset', engagementId: 'project', label: 'Local fixture', environmentId: 'lab', origin: 'http://target:3000', pathPrefix: '/', instanceId: 'generation' })
  const context: AnalysisContext = { environment, asset, artifacts: new ArtifactStore(process.cwd(), 65536),
    signal: new AbortController().signal, durationMs: 100, maxOutputBytes: 4096 }
  const request = { provider: 'web', operation: 'request', assetId: 'asset', environmentId: 'lab', parameters: { path: '/' }, impact: 'observe' as const }
  expect(provider.resolve(request, context).parameters).toMatchObject({ method: 'GET', imageId: 'image', instanceId: 'generation' })
  expect(() => provider.resolve(request, { ...context, asset: { ...asset, instanceId: 'old' } })).toThrow(/identity changed/)
})
it('requires exactly the two owned containers, pinned images and isolated network', () => {
  expect(() =>{  verifyWebLaboratory(inspection(), environment) }).not.toThrow()
  const changedImage = inspection(); changedImage[0].Image = 'replacement'
  expect(() =>{  verifyWebLaboratory(changedImage, environment) }).toThrow(/identity/)
  const exited = inspection(); exited[1].State.Running = false
  expect(() =>{  verifyWebLaboratory(exited, environment) }).toThrow(/identity/)
  const connected = inspection(); connected[2].Internal = false
  expect(() =>{  verifyWebLaboratory(connected, environment) }).toThrow(/isolation/)
  const foreign = inspection(); foreign[1].Config.Labels['dsh.security.laboratory'] = 'foreign'
  expect(() =>{  verifyWebLaboratory(foreign, environment) }).toThrow(/identity/)
})

/** Authenticated Connection Fetch endpoint for operator report downloads. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { SecurityController } from './workbench/controller.ts'

interface ExportConnection {
  fetch: { register(route: {
    path: string
    methods: readonly ('GET' | 'HEAD')[]
    requestBody: 'buffered'
    fetch(request: Request): Promise<Response>
  }): () => Promise<void> }
}

/** Install the download only in compositions providing authenticated Connection Fetch.
 * @param ctx - service-owned context.
 * @param ready - initialized project controller.
 * @param maxBytes - uncompressed archive policy.
 */
export function installReportExport(ctx: Context, ready: Promise<SecurityController>, maxBytes: number): void {
  ctx.inject(['connection'], (connected) => {
    const connection = Reflect.get(connected, 'connection') as ExportConnection
    connected.effect(() => connection.fetch.register({ path: '/api/security.report.export', methods: ['GET', 'HEAD'], requestBody: 'buffered',
      fetch: async (request) => {
        const query = new URL(request.url).searchParams
        const projectId = query.get('projectId')
        const reportId = query.get('reportId')
        if (!projectId || !reportId) return new Response(request.method === 'HEAD' ? null : 'Select a project and report.', { status: 400 })
        try { return await (await ready).exportReport(projectId, reportId, maxBytes, request) }
        catch (error) {
          request.signal.throwIfAborted()
          const oversized = error instanceof Error && error.message.includes('exportMaxBytes')
          return new Response(request.method === 'HEAD' ? null : oversized ? 'Evidence archive exceeds exportMaxBytes.' : 'Report evidence is unavailable or cannot be verified.',
            { status: oversized ? 413 : 422, headers: { 'cache-control': 'private, no-store' } })
        }
      },
    }))
  })
}

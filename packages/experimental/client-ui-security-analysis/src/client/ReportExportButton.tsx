/** Operator-triggered evidence download using the browser's authenticated Host connection. @module */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'

/** Preflight one report and hand its ZIP to the browser download manager.
 * @param props - fixed report selection and shell-owned notifications.
 * @returns a download action whose preparation is cancelled on selection changes.
 */
export function ReportExportButton({ projectId, reportId, notify, t }: PropsLocale<typeof NS> & {
  projectId: string
  reportId: string
  notify: (text: string) => void
}) {
  const [pending, setPending] = useState(false)
  const current = useRef<AbortController>()
  useEffect(() => {
    setPending(false)
    return () => { current.current?.abort() }
  }, [projectId, reportId])
  const download = async () => {
    const abort = new AbortController()
    current.current?.abort(); current.current = abort; setPending(true)
    try {
      const route = `api/security.report.export?${new URLSearchParams({ projectId, reportId })}`
      const response = await fetch(route, { method: 'HEAD', signal: abort.signal })
      if (!response.ok) throw new Error('Evidence download preflight failed')
      abort.signal.throwIfAborted()
      const anchor = document.createElement('a')
      anchor.href = route; anchor.download = `dsh-security-${reportId.replace(/[^a-zA-Z0-9_-]/gu, '-')}.zip`; anchor.click()
      notify(t('exportStarted'))
    } catch (_error) { if (!abort.signal.aborted) notify(t('exportFailed')) }
    finally { if (!abort.signal.aborted) setPending(false) }
  }
  return <button disabled={pending} onClick={() => void download()}>{t(pending ? 'exportPreparing' : 'exportEvidence')}</button>
}

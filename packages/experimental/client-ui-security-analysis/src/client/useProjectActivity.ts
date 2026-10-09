/** One project subscription shared by graph and execution views. @module */
import { useEffect, useRef, useState } from 'react'
import type { ProjectCoverage, SecurityActivityBrief, SecurityToolUsage, WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { ActivityActions } from './ActivityPanel.tsx'

/** Committed activity projections and connection recovery. */
export interface ProjectActivity {
  usage: SecurityToolUsage[]
  briefs: SecurityActivityBrief[]
  connected: boolean
  error: string
  coverage?: ProjectCoverage | undefined
  retry: () => void
}

/** Follow one project without coupling its lifetime to the visible presentation.
 * @param props - project selection, subscription and committed view consumer.
 * @returns activity retained across disconnects and cleared on project changes.
 */
export function useProjectActivity(props: Pick<ActivityActions, 'followActivity' | 'subscribeReset'> & {
  project: string
  changed(view: WorkbenchView): void
}): ProjectActivity {
  const [state, setState] = useState<Omit<ProjectActivity, 'retry'>>({ usage: [], briefs: [], connected: false, error: '' })
  const [epoch, setEpoch] = useState(0)
  const current = useRef(props)
  const previous = useRef('')
  current.current = props
  useEffect(() => props.subscribeReset(() => { setEpoch(value => value + 1) }), [props.subscribeReset])
  useEffect(() => {
    const abort = new AbortController()
    if (previous.current !== props.project) setState({ usage: [], briefs: [], connected: false, error: '' })
    previous.current = props.project
    let cursor = -1
    if (props.project) void (async () => {
      try {
        for await (const frame of current.current.followActivity(props.project, abort.signal)) {
          if (abort.signal.aborted) break
          if (frame.type === 'snapshot' || frame.type === 'project') {
            current.current.changed(frame.view)
            setState(value => ({ ...value, coverage: frame.coverage }))
          }
          if (frame.type !== 'project' && frame.cursor >= cursor) {
            cursor = frame.cursor
            setState(value => ({ ...value, usage: frame.usage, briefs: frame.briefs, connected: true, error: '' }))
          } else setState(value => ({ ...value, connected: true, error: '' }))
        }
        if (!abort.signal.aborted) setState(value => ({ ...value, connected: false }))
      } catch (error) {
        if (!abort.signal.aborted) setState(value => ({ ...value, connected: false, error: String(error) }))
      }
    })()
    return () => { abort.abort() }
  }, [props.project, epoch])
  return { ...state, retry: () => { setEpoch(value => value + 1) } }
}

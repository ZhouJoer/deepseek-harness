/** Browser-safe metadata for bundled analysis scripts. @module */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies a bundled script independently of its installation path. */
export type AnalysisScriptId = Branded<'SecurityAnalysisScript'>
/** Built-in scenarios with locale-owned descriptions. */
export type AnalysisScriptKind = 'captureSummary' | 'extractPackets' | 'mqttSessions' | 'mqttTopics' | 'moduleWatch' | 'functionTrace' | 'wirelessCapture'
/** A CLI argument accepted by a bundled entry point. */
export interface AnalysisScriptParameter {
  flag: '--input' | '--output' | '--tshark' | '--timeout' | '--max-packets' | '--max-output-bytes' | '--max-decode-bytes'
    | '--filter' | '--stream' | '--field' | '--mqtt-port' | '--max-events' | '--module' | '--symbol' | '--stack-depth' | '--protocol' | '--mode'
  required: boolean
  value: string
}
/** Read-only script location, dependencies and invocation; grants no execution authority. */
export interface AnalysisScript {
  id: AnalysisScriptId
  kind: AnalysisScriptKind
  category: 'tshark' | 'mqtt' | 'dynamic'
  skill: string
  relativePath: string
  path: string
  toolIds: string[]
  parameters: AnalysisScriptParameter[]
  example: string
}

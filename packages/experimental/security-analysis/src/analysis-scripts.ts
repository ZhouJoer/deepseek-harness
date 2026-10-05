/** Shared resource catalog for security skills and operator browsing. @module */
import { fileURLToPath } from 'node:url'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AnalysisScript, AnalysisScriptId, AnalysisScriptParameter } from './analysis-script-types.ts'

/** Absolute installation directory; task outputs belong in the Session analysis directory. */
export const ANALYSIS_SCRIPTS_DIRECTORY = fileURLToPath(new URL('../resources/analysis-scripts/', import.meta.url))

const offline: AnalysisScriptParameter[] = [
  { flag: '--input', required: true, value: '<absolute capture path>' },
  { flag: '--output', required: true, value: '<new absolute result path>' },
  { flag: '--tshark', required: true, value: '<selected absolute executable path>' },
  { flag: '--timeout', required: true, value: '<seconds per invocation>' },
  { flag: '--max-packets', required: true, value: '<input frame limit>' },
  { flag: '--max-output-bytes', required: true, value: '<result byte limit>' },
  { flag: '--max-decode-bytes', required: true, value: '<decoded XML byte limit>' },
  { flag: '--filter', required: false, value: '<display filter>' },
  { flag: '--stream', required: false, value: '<TCP stream number>' },
]
const dynamic: AnalysisScriptParameter[] = [
  { flag: '--output', required: true, value: '<new absolute script path>' },
  { flag: '--max-events', required: true, value: '<event limit>' },
]
const offlineExample = ' --input "<capture>" --output "<analysisDirectory>/outputs/<run>.json" --tshark "<tshark>" --timeout 30 --max-packets 10000 --max-output-bytes 65536 --max-decode-bytes 16777216'

/**
 * Read bundled script descriptors without probing tools or accessing project state.
 * @returns independently owned metadata with absolute package resource paths.
 */
export function analysisScripts(): AnalysisScript[] {
  const entries: Array<Omit<AnalysisScript, 'id' | 'path' | 'parameters' | 'example'> & {
    id: string
    extra?: AnalysisScriptParameter[]
    template?: string
  }> = [
    { id: 'tshark.capture-summary', kind: 'captureSummary', category: 'tshark', skill: 'security-packet-analysis', relativePath: 'tshark/capture_summary.py', toolIds: ['python', 'tshark'] },
    { id: 'tshark.extract-packets', kind: 'extractPackets', category: 'tshark', skill: 'security-packet-analysis', relativePath: 'tshark/extract_packets.py', toolIds: ['python', 'tshark'], extra: [{ flag: '--field', required: false, value: '<TShark field; repeatable>' }] },
    { id: 'mqtt.sessions', kind: 'mqttSessions', category: 'mqtt', skill: 'security-mqtt', relativePath: 'mqtt/sessions.py', toolIds: ['python', 'tshark'] },
    { id: 'mqtt.topics', kind: 'mqttTopics', category: 'mqtt', skill: 'security-mqtt', relativePath: 'mqtt/topics.py', toolIds: ['python', 'tshark'] },
    { id: 'dynamic.module-watch', kind: 'moduleWatch', category: 'dynamic', skill: 'security-dynamic', relativePath: 'dynamic/module_watch.js', toolIds: ['python', 'frida'], template: 'module-watch' },
    { id: 'dynamic.function-trace', kind: 'functionTrace', category: 'dynamic', skill: 'security-dynamic', relativePath: 'dynamic/function_trace.js', toolIds: ['python', 'frida'], template: 'function-trace', extra: [
      { flag: '--module', required: true, value: '<loaded module name>' },
      { flag: '--symbol', required: true, value: '<exported function; repeatable>' },
      { flag: '--stack-depth', required: true, value: '<1..16>' },
    ] },
  ]
  return entries.map(({ extra = [], template, ...entry }) => ({
    ...entry, id: brandString<AnalysisScriptId>(entry.id),
    path: fileURLToPath(new URL('../resources/analysis-scripts/' + entry.relativePath, import.meta.url)),
    parameters: [...(template ? dynamic : offline), ...extra,
      ...(entry.category === 'mqtt' ? [{ flag: '--mqtt-port' as const, required: false, value: '<TCP port; repeatable>' }] : [])].map(item => ({ ...item })),
    example: template
      ? 'python "<resourceBase>/dynamic/prepare.py" ' + template + ' --output "<analysisDirectory>/scripts/<run>.js" --max-events 100'
        + (template === 'function-trace' ? ' --module "<module>" --symbol "<export>" --stack-depth 8' : '')
      : 'python "<resourceBase>/' + entry.relativePath + '"' + offlineExample,
  }))
}

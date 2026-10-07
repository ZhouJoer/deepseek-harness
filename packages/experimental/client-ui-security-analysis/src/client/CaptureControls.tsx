/** Fixed offline capture operations for imported assets. @module */
import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { DeviceDirectory } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

/** Select recorded protocol and local analysis environment.
 * @param props - available environments, action state and explicit analysis gesture.
 * @returns offline summary and frame actions.
 */
export function CaptureControls({ environments, disabled, analyze, t }: PropsLocale<typeof NS> & {
  environments: DeviceDirectory['environments']
  disabled: boolean
  analyze(this: void, operation: 'summary' | 'packets', protocol: 'wifi' | 'ble', environment: string): Promise<void>
}) {
  const [protocol, setProtocol] = useState<'wifi' | 'ble'>('wifi')
  const [environment, setEnvironment] = useState('')
  const local = environments.filter(item => item.kind === 'local')
  const selected = local.find(item => item.id === environment)?.id ?? local[0]?.id ?? ''
  return <div className={css.form}>
    <label className={css.field}>{t('captureProtocol')}
      <select value={protocol} onChange={(event) =>{  setProtocol(event.target.value === 'ble' ? 'ble' : 'wifi') }}>
        <option value="wifi">{t('captureWifi')}</option><option value="ble">{t('captureBle')}</option>
      </select>
    </label>
    <label className={css.field}>{t('captureEnvironment')}
      <select value={selected} onChange={(event) =>{  setEnvironment(event.target.value) }}>
        {!selected && <option value="">{t('captureChooseEnvironment')}</option>}
        {local.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </label>
    {(['summary', 'packets'] as const).map(operation => <button key={operation} disabled={disabled || !selected}
      onClick={() => void analyze(operation, protocol, selected)}>{t(operation === 'summary' ? 'captureAnalyze' : 'capturePackets')}</button>)}
  </div>
}

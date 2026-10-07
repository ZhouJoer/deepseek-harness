/** Explicit host-interface inspection, independent of project creation. @module */
import { useEffect, useRef, useState } from 'react'
import type { DeviceDirectory } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

/** Authenticated read-only device endpoints. */
export interface DeviceActions {
  deviceDirectory(this: void, environmentId?: string): Promise<DeviceDirectory>
  deviceInventory(this: void, environmentId?: string): Promise<DeviceDirectory>
}
/** Inspect interfaces on request and keep prior observations visible on failure.
 * @param props - localized copy and host operations.
 * @returns environment selection, independent capability checks and discovered interfaces.
 */
export function DevicePanel({ deviceDirectory, deviceInventory, t }: DeviceActions & PropsLocale<typeof NS>) {
  const [environment, setEnvironment] = useState<string>()
  const [directory, setDirectory] = useState<DeviceDirectory>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const generation = useRef(0)
  useEffect(() => {
    const current = ++generation.current
    setBusy(true); setError(''); setDirectory(undefined)
    void deviceDirectory(environment).then((value) => { if (current === generation.current) setDirectory(value) })
      .catch((error: unknown) => { if (current === generation.current) setError(String(error)) })
      .finally(() => { if (current === generation.current) setBusy(false) })
    return () => { generation.current++ }
  }, [environment, deviceDirectory, attempt])
  const inspect = async () => {
    const current = ++generation.current
    setBusy(true); setError('')
    try {
      const next = await deviceInventory(directory?.inventory.environmentId)
      if (current === generation.current) setDirectory(next)
    } catch (error) { if (current === generation.current) setError(String(error)) }
    finally { if (current === generation.current) setBusy(false) }
  }
  const states = { 'not-checked': 'toolUnchecked', available: 'toolAvailable', missing: 'toolMissing',
    unsupported: 'deviceUnsupported', error: 'toolProbeError' } as const
  const labels = { python: 'devicePython', tshark: 'deviceTshark', npcap: 'deviceNpcap', serial: 'deviceSerial',
    'capture-interfaces': 'deviceCaptureInterfaces', 'nrf-extcap': 'deviceNrf', 'capture-validation': 'deviceCaptureValidation' } as const
  return <section aria-label={t('deviceTab')}>
    <p>{t('deviceHelp')}</p>
    <label className={css.field}>{t('toolEnvironment')}
      <select value={environment ?? directory?.inventory.environmentId ?? ''} onChange={(event) => { setEnvironment(event.target.value) }}>
        {!directory && <option value="">{t('toolUnchecked')}</option>}
        {directory?.environments.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
      </select>
    </label>
    <button disabled={busy} onClick={() => { if (directory) void inspect(); else setAttempt(value => value + 1) }}>{t('deviceInspect')}</button>
    {busy && <progress aria-label={t('deviceTab')} />}
    {error && <p role="alert">{t('deviceInspectionFailed')} {error}</p>}
    {directory && <>
      {directory.inventory.checkedAt > 0 && <p>{t('toolCheckedAt')} {new Date(directory.inventory.checkedAt).toLocaleString()}</p>}
      {directory.inventory.checks.map(check => <article className={css.card} key={check.id}>
        <strong>{t(labels[check.id])} · {t(states[check.status])}</strong>
        {check.detail && <p>{check.detail.split(/\r?\n/u)[0]}</p>}
        {check.detail.includes('\n') && <details><summary>{t('advancedDetails')}</summary><pre>{check.detail}</pre></details>}
      </article>)}
      {directory.inventory.checkedAt > 0 && directory.inventory.devices.length === 0 && <p>{t('deviceNone')}</p>}
      {directory.inventory.devices.map(device => <article className={css.card} key={device.id}>
        <strong>{device.name}</strong><code>{device.path}</code>
        <p>{t('toolCheckedAt')} {new Date(device.observedAt).toLocaleString()}</p>
        {device.pnpId && <p>{device.pnpId}</p>}
        {(device.vendorId || device.productId) && <p>{t('deviceUsbIds')} {device.vendorId ?? '—'} / {device.productId ?? '—'}</p>}
        {device.serialNumber && <p>{t('deviceSerialNumber')} {device.serialNumber}</p>}
        {device.kind === 'serial' && <p>{t('deviceTuftyUnverified')}</p>}
      </article>)}
    </>}
  </section>
}

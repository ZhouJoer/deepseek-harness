// @vitest-environment jsdom
/** Device discovery is explicit and stale requests cannot replace a selected environment. @module */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { DeviceDirectory, RadioDeviceId } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { DevicePanel } from '../src/client/DevicePanel.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)
const directory: DeviceDirectory = { environments: [{ id: 'local', kind: 'local', label: 'Windows' }, { id: 'other', kind: 'local', label: 'Other' }],
  inventory: { environmentId: 'local', checkedAt: 0, devices: [], checks: [{ id: 'capture-validation', status: 'not-checked', detail: '' }] } }
const observed: DeviceDirectory = { ...directory, inventory: { ...directory.inventory, checkedAt: 1,
  devices: [{ id: brandString<RadioDeviceId>('serial-one'), kind: 'serial', path: 'COM7', name: 'USB Serial', pnpId: 'USB\\fixture', observedAt: 1 }] } }

it('does not inspect on open, retains results on query failure and removes vanished devices on success', async () => {
  const deviceInventory = vi.fn().mockResolvedValueOnce(observed).mockRejectedValueOnce(new Error('Access denied')).mockResolvedValueOnce(directory)
  render(<DevicePanel deviceDirectory={async () => directory} deviceInventory={deviceInventory} t={makeTranslate(zh)} />)
  await waitFor(() =>{  expect(screen.getByRole('button', { name: '检查设备' }).hasAttribute('disabled')).toBe(false) })
  expect(deviceInventory).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '检查设备' }))
  await screen.findByText('COM7')
  expect(screen.getByText('真机采集验证 · 未检查')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '检查设备' }))
  await screen.findByRole('alert')
  expect(screen.getByText('COM7')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '检查设备' }))
  await waitFor(() =>{  expect(screen.queryByText('COM7')).toBeNull() })
})
it('ignores an older inspection after switching environments', async () => {
  const pending = Promise.withResolvers<DeviceDirectory>()
  render(<DevicePanel deviceDirectory={async id => ({ ...directory, inventory: { ...directory.inventory, environmentId: id ?? 'local' } })}
    deviceInventory={() => pending.promise} t={makeTranslate(en)} />)
  await waitFor(() =>{  expect(screen.getByRole('button', { name: 'Inspect devices' }).hasAttribute('disabled')).toBe(false) })
  fireEvent.click(screen.getByRole('button', { name: 'Inspect devices' }))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'other' } })
  await waitFor(() =>{  expect(screen.getByRole('button', { name: 'Inspect devices' }).hasAttribute('disabled')).toBe(false) })
  await act(async () => { pending.resolve(observed); await pending.promise })
  expect(screen.queryByText('COM7')).toBeNull()
})

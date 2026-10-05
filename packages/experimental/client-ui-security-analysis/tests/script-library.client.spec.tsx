// @vitest-environment jsdom
/** Script browsing does not require project state or installation probes. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { AnalysisScript } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { Toolbox } from '../src/client/Toolbox.tsx'
import { ScriptLibrary } from '../src/client/ScriptLibrary.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const t = makeTranslate(zh, commonZh)
function analysisScripts(): AnalysisScript[] {
  return (['captureSummary', 'mqttSessions', 'mqttTopics'] as const).map(kind => ({
    id: kind as AnalysisScript['id'], kind, category: kind === 'captureSummary' ? 'tshark' : 'mqtt',
    skill: 'security-mqtt', relativePath: kind + '.py', path: '/installed scripts/' + kind + '.py',
    toolIds: ['python', 'tshark'], parameters: [{ flag: '--mqtt-port', required: false, value: '<port>' }], example: 'python script.py',
  }))
}

it('searches localized methods, filters categories and shows parameters and paths', async () => {
  render(<ScriptLibrary scriptCatalog={async () => analysisScripts()} t={t} />)
  expect(await screen.findByText('抓包概览')).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox', { name: '分类' }), { target: { value: 'mqtt' } })
  expect(screen.queryByText('抓包概览')).toBeNull()
  expect(screen.getByText('MQTT 连接时间线')).toBeTruthy()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '主题' } })
  expect(screen.queryByText('MQTT 连接时间线')).toBeNull()
  expect(screen.getByText('MQTT 主题与消息')).toBeTruthy()
  expect(screen.getByText('--mqtt-port')).toBeTruthy()
  expect(screen.getByText(analysisScripts().find(entry => entry.kind === 'mqttTopics')!.path)).toBeTruthy()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'absent' } })
  expect(screen.getByText('没有匹配的脚本')).toBeTruthy()
})

it('retries a failed catalog read', async () => {
  const scriptCatalog = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(analysisScripts())
  render(<ScriptLibrary scriptCatalog={scriptCatalog} t={t} />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(await screen.findByText('抓包概览')).toBeTruthy()
})

it('opens scripts when no environment exists and never probes or executes', async () => {
  const unavailable = vi.fn(async () => { throw new Error('No environment') })
  const probe = vi.fn(async () => { throw new Error('Unexpected probe') })
  render(<Toolbox t={t} scriptCatalog={async () => analysisScripts()} toolboxDirectory={unavailable}
    toolboxInventory={probe} toolboxConfiguration={probe} configureTool={probe} toolboxFiles={probe}
    toolCatalog={probe} previewToolPack={probe} importToolPack={probe} exportToolPack={probe} />)
  expect(await screen.findByRole('alert')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: '分析脚本' }))
  expect(await screen.findByText('抓包概览')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(probe).not.toHaveBeenCalled()
})

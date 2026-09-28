// Keyless assembled-browser coverage for the opt-in security Web profiles
// over the real Host Typert Remote flow.
import type {} from '@deepseek-ai/dsh-experimental-security-analysis'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import * as yaml from 'js-yaml'
import { interpolate } from '@deepseek-ai/cordis-plugin-loader'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import {
  launchWebScaffold, watchConsole, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const OVERLAY = fileURLToPath(new URL('./security-workbench.overlay.yml', import.meta.url))
const HOST_PATCH = fileURLToPath(new URL('../../../packages/experimental/security-profile/cordis.patch.yml', import.meta.url))
const WEB_PATCH = fileURLToPath(new URL('../../../packages/experimental/security-web-profile/cordis.patch.yml', import.meta.url))
const INSTALL_ANCHORS = [
  fileURLToPath(new URL('../../../packages/experimental/security-profile/package.json', import.meta.url)),
  fileURLToPath(new URL('../../../packages/experimental/security-web-profile/package.json', import.meta.url)),
]

function profileEntries(path: string): unknown[] {
  const parsed = yaml.load(readFileSync(path, 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new Error(`profile layer at ${path} must be a list`)
  return parsed
}

describe('Security workbench overlay', () => {
  it('uses an independent default port and preserves explicit CLI port selection', () => {
    const row = (profileEntries(WEB_PATCH) as { id?: string; config?: unknown }[]).find(entry => entry.id === 'webserver')
    expect(row).toBeDefined()
    expect(interpolate({ ctx: { webStartup: {} } }, row?.config) as unknown)
      .toMatchObject({ host: '127.0.0.1', port: 3081, compression: 'gzip' })
    for (const port of [0, 4567])
      expect(interpolate({ ctx: { webStartup: { port } } }, row?.config) as unknown).toMatchObject({ port })
  })
  it('matches the shipped Host and Web profile layers', () => {
    expect(profileEntries(OVERLAY)).toEqual([
      ...profileEntries(HOST_PATCH),
      ...profileEntries(WEB_PATCH),
    ])
  })
})

describe('web e2e: Security workbench', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, extraInstallAnchors: INSTALL_ANCHORS })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]')
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await page.getByRole('button', { name: 'Security workspace', exact: false }).waitFor()
  })
  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })
  it('browses evidence without rebinding and retains an embedded assistant through collapse and reconnect', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-security-dashboard'))
    const agent = scaffold.ctx.agents.list()[0]!
    const controller = await scaffold.ctx.securityWorkbench.ready
    const created = await controller.importMaterials(agent.id, {
      operationId: 'dashboard-material', expectedRevision: controller.view(agent.id).revision,
      task: { title: 'Demo task with a deliberately long name to check wrapping on narrow screens',
        objective: 'Review owned fixture input handling', environmentIds: ['local'], maxAttempts: 3 },
      material: { kind: 'text', name: 'example.js', text: 'function name(input) { return input.name.trim() }' },
    })
    const task = created.records.find(item => item.kind === 'engagement')!.value
    const asset = created.records.find(item => item.kind === 'asset')!.value
    const observed = await controller.captureAnalysis(agent.id, asset.id, ['fixture-call'],
      Buffer.from('Demo observation: input handling requires review'), new AbortController().signal)
    if (observed.kind !== 'evidence') throw new Error('Expected evidence')
    await controller.command(agent.id, { operationId: 'dashboard-finding', expectedRevision: controller.view(agent.id).revision,
      action: { kind: 'finding', finding: { assetId: asset.id, title: 'Input requires validation', explanation: 'Fixture observation only',
        status: 'suspected', evidenceIds: [observed.value.id], conditions: 'Owned example', review: '' } } }, true)
    const before = controller.projectView(task.id)
    const sessionsBefore = scaffold.ctx.agents.list().length
    await page.getByRole('button', { name: 'Security workspace', exact: false }).click()
    const dashboard = page.getByRole('region', { name: 'Security analysis', exact: true })
    await dashboard.getByLabel('Search tasks or objectives').fill('deliberately')
    await dashboard.getByRole('button', { name: /Demo task/ }).click()
    await dashboard.getByRole('heading', { name: task.title, exact: true }).waitFor()
    expect(controller.projectView(task.id)).toEqual(before)
    expect(scaffold.ctx.agents.list()).toHaveLength(sessionsBefore)
    await dashboard.getByRole('button', { name: 'Findings', exact: true }).click()
    await dashboard.getByRole('heading', { name: 'Input requires validation' }).waitFor()
    await dashboard.getByRole('button', { name: 'Evidence', exact: true }).click()
    await dashboard.getByLabel('Search evidence titles or summaries').fill(observed.value.title)
    await dashboard.getByRole('button', { name: new RegExp(observed.value.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
    await dashboard.getByText('Demo observation: input handling requires review', { exact: true }).waitFor()
    await dashboard.getByRole('button', { name: '← Back to evidence' }).click()
    expect(await dashboard.getByLabel('Search evidence titles or summaries').inputValue()).toBe(observed.value.title)
    await dashboard.getByRole('button', { name: 'Reports', exact: true }).click()
    await dashboard.getByText('No reports yet.', { exact: false }).waitFor()
    await dashboard.getByRole('button', { name: 'Analysis assistant', exact: true }).click()
    const assistant = dashboard.getByRole('complementary', { name: 'Analysis assistant' })
    const editor = assistant.locator('textarea,[contenteditable="true"]').first()
    await editor.fill('Keep this unsent draft')
    await dashboard.getByRole('button', { name: 'Hide assistant' }).click()
    await dashboard.getByRole('button', { name: 'Analysis assistant', exact: true }).click()
    expect(await editor.textContent()).toBe('Keep this unsent draft')
    await page.context().setOffline(true)
    await page.context().setOffline(false)
    await dashboard.getByRole('button', { name: 'Refresh', exact: true }).click()
    await dashboard.getByRole('heading', { name: task.title, exact: true }).waitFor()
    await dashboard.getByRole('button', { name: 'Stop task', exact: true }).click()
    await dashboard.getByText('This task is stopped.', { exact: false }).waitFor()
    await dashboard.getByRole('button', { name: 'Resume task', exact: true }).click()
    await expect.poll(() => controller.projects().find(item => item.id === task.id)?.stopped).toBe(false)
    await dashboard.getByRole('button', { name: 'Hide assistant', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await assistant.waitFor({ state: 'hidden' })
    await page.setViewportSize({ width: 390, height: 844 })
    await dashboard.getByRole('button', { name: '← Back to tasks' }).click()
    await dashboard.getByRole('button', { name: /Demo task/ }).waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  })
})

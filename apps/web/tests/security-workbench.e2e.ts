// Keyless assembled-browser coverage for the opt-in security Web profiles
// over the real Host Typert Remote flow.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
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
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    expect(scaffold.ctx.agents.list()[0]?.session.snapshotEvents().some(event => event.type === 'assistant/message')).toBe(false)
    await page.getByRole('button', { name: 'Security analysis', exact: true }).and(page.locator('[aria-haspopup=dialog]')).waitFor()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens from a blank Session, creates a scoped project, and stops and resumes through generated Remote', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-security-workbench'))
    const screenshotDir = process.env.DSH_SECURITY_SCREENSHOT_DIR
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'security-entry.png') })
    const sample = join(scaffold.workspaceCwd, 'sample.bin')
    writeFileSync(sample, Buffer.from('security analysis fixture'))
    await page.getByRole('button', { name: 'Security analysis', exact: true }).and(page.locator('[aria-haspopup=dialog]')).click()
    const panel = page.getByRole('dialog', { name: 'Security analysis' })
    await panel.getByLabel('Name', { exact: true }).fill('Browser security project')
    await panel.getByLabel('Objective', { exact: true }).fill('Inspect an authorized fixture')
    await panel.getByLabel('Environment', { exact: true }).selectOption('local')
    await panel.getByRole('button', { name: 'Create project', exact: true }).click()
    await panel.getByText('Inspect an authorized fixture', { exact: true }).waitFor()
    await panel.getByRole('button', { name: 'Assets', exact: true }).click()
    await panel.getByLabel('Name', { exact: true }).fill('Browser sample')
    await panel.getByLabel('Absolute sample path', { exact: true }).fill(sample)
    await panel.getByRole('button', { name: 'Import sample', exact: true }).click()
    await panel.getByText('Browser sample', { exact: true }).waitFor()
    await panel.getByRole('button', { name: 'Create four-stage check plan', exact: true }).click()
    await panel.getByRole('status').waitFor({ state: 'hidden' })
    await panel.getByRole('button', { name: 'Checks', exact: true }).click()
    await expect.poll(() => panel.getByRole('button', { name: 'Review and complete', exact: true }).count()).toBe(4)
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'security-checks.png') })
    await panel.getByRole('button', { name: 'Stop project', exact: true }).click()
    await panel.getByRole('button', { name: 'Resume project', exact: true }).click()
    await panel.getByRole('button', { name: 'Stop project', exact: true }).waitFor()
    await panel.getByRole('button', { name: 'Refresh', exact: true }).click()
    await panel.getByRole('status').waitFor({ state: 'hidden' })
    await panel.getByRole('button', { name: 'Findings and validation', exact: true }).click()
    await panel.locator('summary').filter({ hasText: 'Prepare validation plan' }).click()
    const preparation = panel.locator('details[open]')
    await preparation.getByLabel('Check', { exact: true }).selectOption({ label: 'Validate and review' })
    await preparation.getByLabel('Environment', { exact: true }).selectOption('local')
    await preparation.getByLabel('Analysis tool', { exact: true }).selectOption('frida')
    await preparation.getByLabel('Operation', { exact: true }).selectOption('script')
    await preparation.getByLabel('Tool parameters (JSON)', { exact: true }).fill(JSON.stringify({ target: { mode: 'attach', pid: 1, name: 'fixture-only', started: 'not-a-real-process' } }))
    await preparation.getByLabel('Script (bundled JavaScript)', { exact: true }).fill('send({fixture: true});')
    await preparation.getByLabel('Hypothesis', { exact: true }).fill('Review an immutable fixture script')
    await preparation.getByLabel('Expected observation', { exact: true }).fill('Fixture observation')
    await preparation.getByLabel('Impact', { exact: true }).fill('Plan preparation only; no execution')
    await preparation.getByLabel('Cleanup', { exact: true }).fill('Unload and detach')
    await preparation.getByLabel('Duration (milliseconds)', { exact: true }).fill('1000')
    await preparation.getByRole('button', { name: 'Prepare validation plan', exact: true }).click()
    const plan = panel.locator('article').filter({ hasText: 'Review an immutable fixture script' })
    await plan.getByRole('button', { name: 'Preview', exact: true }).click()
    await panel.getByText('send({fixture: true});', { exact: true }).waitFor()
    await plan.getByRole('button', { name: 'Approve this version', exact: true }).click()
    await expect.poll(() => plan.getByRole('button', { name: 'Execute plan', exact: true }).isEnabled()).toBe(true)
    await plan.getByRole('button', { name: 'Revoke approval', exact: true }).click()
    await expect.poll(() => plan.getByRole('button', { name: 'Execute plan', exact: true }).isEnabled()).toBe(false)
    await panel.getByRole('button', { name: 'Knowledge', exact: true }).click()
    await panel.locator('summary').filter({ hasText: 'Save knowledge for review' }).click()
    await panel.getByLabel('Name', { exact: true }).fill('Browser knowledge')
    await panel.getByLabel('Knowledge content', { exact: true }).fill('Check identities before analysis')
    await panel.getByLabel('Applicable conditions', { exact: true }).fill('Owned samples only')
    await panel.getByRole('button', { name: 'Save knowledge for review', exact: true }).click()
    await panel.getByRole('button', { name: 'Review and share', exact: true }).click()
    await panel.getByRole('button', { name: 'Review and share', exact: true }).waitFor({ state: 'hidden' })
    await panel.getByLabel('Search terms', { exact: true }).fill('identities')
    await panel.getByRole('button', { name: 'Search', exact: true }).click()
    await panel.getByRole('status').waitFor({ state: 'hidden' })
    await panel.getByText('Browser knowledge', { exact: true }).waitFor()
    await panel.getByRole('button', { name: 'Reports', exact: true }).click()
    await panel.getByRole('button', { name: 'Generate revision report', exact: true }).click()
    await panel.getByRole('button', { name: 'Markdown report', exact: true }).waitFor()
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Security analysis', exact: true }).and(page.locator(':not([aria-haspopup])')).click()
    const projects = page.locator('section[aria-label="Security analysis"]')
    await projects.getByRole('combobox').selectOption({ label: 'Browser security project' })
    await projects.getByRole('button', { name: 'Reports', exact: true }).click()
    await projects.getByRole('button', { name: 'Markdown report', exact: true }).click()
    await projects.getByText(/Evidence index/u).waitFor()
    await page.reload()
    await page.getByRole('button', { name: 'Security analysis', exact: true }).and(page.locator(':not([aria-haspopup])')).click()
    await projects.getByRole('combobox').selectOption({ label: 'Browser security project' })
    await projects.getByRole('button', { name: 'Reports', exact: true }).click()
    await projects.getByRole('button', { name: 'JSON report', exact: true }).click()
    await projects.getByText(/Browser security project/u).last().waitFor()
    await projects.getByRole('button', { name: 'Toolbox and labs', exact: true }).click()
    await projects.getByRole('button', { name: 'Reuse local Kali image', exact: true }).waitFor()
    await projects.getByText(/vxcontrol\/kali-linux:latest/u).waitFor()
    expect(await projects.getByRole('alert').count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})

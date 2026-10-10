// Keyless assembled-browser coverage for the opt-in security Web profiles
// over the real Host Typert Remote flow.
import type {} from '@deepseek-ai/dsh-experimental-security-analysis'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterEach, beforeEach, describe, expect, it, onTestFailed, onTestFinished } from 'vitest'
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
    expect(interpolate({ ctx: { webStartup: {} } }, row?.config))
      .toMatchObject({ host: '127.0.0.1', port: 3081, compression: 'gzip' })
    for (const port of [0, 4567])
      expect(interpolate({ ctx: { webStartup: { port } } }, row?.config)).toMatchObject({ port })
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

  beforeEach(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, extraInstallAnchors: INSTALL_ANCHORS,
      agentPresets: { default: 'security' } })
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]')
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await page.getByRole('button', { name: 'Security workspace', exact: false }).waitFor()
  })
  afterEach(async () => {
    await browser?.close()
    await scaffold?.close()
  })
  it('browses analysis domains and applies optional preferences before starting', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-analysis-toolbox'))
    await page.getByRole('button', { name: 'Security analysis', exact: true }).click()
    const dashboard = page.getByRole('region', { name: 'Security analysis', exact: true })
    await dashboard.getByRole('button', { name: 'Analysis toolbox', exact: true }).click()
    await dashboard.getByText('tshark · Not checked', { exact: true }).waitFor()
    await dashboard.getByRole('button', { name: 'IoT', exact: true }).click()
    await dashboard.getByText('tshark · Not checked', { exact: true }).waitFor()
    expect(await dashboard.getByText('nuclei · Not checked', { exact: true }).count()).toBe(0)
    await dashboard.screenshot({ path: '.dsh/analysis-toolbox-en-light.png' })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 480, height: 900 })
    await dashboard.screenshot({ path: '.dsh/analysis-toolbox-en-dark-narrow.png' })
    await dashboard.getByRole('button', { name: 'Web tools', exact: true }).click()
    await dashboard.getByText('curl · Not checked', { exact: true }).waitFor()
    expect(await dashboard.getByText('radare2 · Not checked', { exact: true }).count()).toBe(0)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await dashboard.getByRole('button', { name: 'New analysis', exact: true }).click()
    await dashboard.getByRole('button', { name: 'Use this workspace', exact: true }).click()
    await dashboard.getByLabel('What would you like to analyze?', { exact: true }).fill('Compare the supplied firmware and traffic')
    await dashboard.getByText('More options', { exact: true }).click()
    await dashboard.getByText('Active session tool preferences', { exact: true }).click()
    await dashboard.getByRole('checkbox', { name: 'IoT / 物联网', exact: true }).check()
    const start = dashboard.getByRole('button', { name: 'Start analysis', exact: true })
    expect(await start.isDisabled()).toBe(true)
    await dashboard.getByRole('button', { name: 'Apply to this session', exact: true }).click()
    await expect.poll(() => start.isEnabled()).toBe(true)
    await dashboard.getByRole('button', { name: 'Restore automatic selection', exact: true }).click()
    await expect.poll(() => dashboard.getByRole('checkbox', { name: 'IoT / 物联网', exact: true }).isChecked()).toBe(false)
    const chinese = await browser.newPage({ viewport: { width: 480, height: 900 }, locale: 'zh-CN', colorScheme: 'dark' })
    try {
      await chinese.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await chinese.getByRole('button', { name: '安全分析', exact: true }).click()
      const panel = chinese.getByRole('region', { name: '安全分析', exact: true })
      await panel.getByRole('button', { name: '分析工具箱', exact: true }).click()
      await panel.getByText('tshark · 未检查', { exact: true }).waitFor()
      await panel.getByRole('button', { name: 'IoT', exact: true }).click()
      await panel.screenshot({ path: '.dsh/analysis-toolbox-zh-dark-narrow.png' })
      await chinese.emulateMedia({ colorScheme: 'light' })
      await panel.screenshot({ path: '.dsh/analysis-toolbox-zh-light-narrow.png' })
    } finally { await chinese.close() }
    expect(tripwire.pageErrors).toEqual([])
  })
  it('registers an HTTP target, configures login, approves a plan and reads redacted responses through Remote', async () => {
    const requests: string[] = []
    const target = createServer((request, response) => {
      requests.push(request.url!); response.setHeader('Content-Type', 'text/plain')
      if (request.url === '/login') { response.setHeader('Set-Cookie', 'session=private-browser-cookie; Path=/; HttpOnly'); response.end('signed in') }
      else { response.statusCode = request.headers.cookie ? 200 : 401; response.end(request.headers.cookie ?? 'anonymous') }
    })
    onTestFinished(async () => { target.closeAllConnections()
      if (target.listening) await new Promise<void>((resolve, reject) =>
        target.close((error) =>{  if (error) reject(error)
        else resolve() })) })
    onTestFailed(() => saveFailureShot(page, 'web-e2e-http'))
    target.listen(0, '127.0.0.1'); await once(target, 'listening')
    const address = target.address(); if (!address || typeof address === 'string') throw new Error('Missing target listener')
    const agent = scaffold.ctx.agents.list()[0]!
    const controller = await scaffold.ctx.securityWorkbench.ready
    await scaffold.ctx.securityWorkbench.importMaterials(agent, JSON.stringify({ operationId: 'browser-http-task', expectedRevision: controller.view(agent.id).revision,
      title: 'Owned HTTP application', objective: 'Check an authorized response', resources: { environmentIds: ['local'], maxAttempts: 3 } }))
    await page.getByRole('button', { name: 'Security workspace', exact: false }).click()
    const dashboard = page.getByRole('region', { name: 'Security analysis', exact: true })
    await dashboard.getByRole('button', { name: /Owned HTTP application/ }).click()
    await dashboard.getByRole('button', { name: 'HTTP validation', exact: true }).click()
    const http = dashboard.getByRole('region', { name: 'HTTP validation', exact: true })
    await http.getByRole('button', { name: 'Connect analysis conversation' }).click()
    const registration = http.locator('details').filter({ has: page.locator('summary').getByText('Web targets', { exact: true }) })
    await registration.getByLabel('Name', { exact: true }).fill('Authorized local site')
    await registration.getByLabel('Site origin', { exact: true }).fill(`http://127.0.0.1:${address.port}`)
    await registration.getByLabel('Allowed IPs or CIDRs (one per line)', { exact: true }).fill('127.0.0.1/32')
    await registration.getByRole('button', { name: 'Register target' }).click()
    await http.getByText('Test identities', { exact: true }).click()
    const authentication = http.locator('details').filter({ has: page.locator('summary').getByText('Test identities', { exact: true }) })
    await authentication.getByLabel('Name', { exact: true }).fill('Test reader')
    await authentication.getByLabel('Username', { exact: true }).fill('browser-user')
    await authentication.getByLabel('Password', { exact: true }).fill('browser-password')
    await authentication.getByRole('button', { name: 'Save identity', exact: true }).click()
    await expect.poll(async () => ({ options: await http.getByLabel('Identity', { exact: true }).last().innerText(),
      errors: await http.getByRole('alert').allTextContents() })).toMatchObject({ options: expect.stringContaining('Test reader') as string, errors: [] })
    await expect.poll(() => controller.view(agent.id).records.filter(item => item.kind === 'asset').length).toBe(1)
    await http.getByLabel('Identity', { exact: true }).last().selectOption({ label: 'Test reader' })
    await http.getByRole('button', { name: 'Add request', exact: true }).last().click()
    await http.getByRole('spinbutton', { name: 'Expected observation', exact: true }).last().fill('401')
    await http.getByLabel('What will be verified', { exact: true }).fill('Can the test identity read its authorized response?')
    await http.getByRole('textbox', { name: 'Expected observation', exact: true }).fill('HTTP 200 after successful login')
    await http.getByLabel('Impact', { exact: true }).fill('Create one test login session')
    await http.getByLabel('Cleanup', { exact: true }).fill('Clear temporary cookies')
    await http.getByRole('button', { name: 'Prepare validation plan' }).click()
    await http.getByText('Plan prepared. Review it before execution.', { exact: true }).waitFor()
    expect(requests).toEqual([])
    await http.getByRole('button', { name: 'Approve this version', exact: true }).click()
    await http.getByRole('button', { name: 'Execute plan', exact: true }).click()
    await http.getByText('This approval has been used. Prepare a new plan to repeat the check.', { exact: true }).waitFor()
    await expect.poll(() => requests).toEqual(['/login', '/', '/'])
    expect(await http.getByRole('button', { name: 'Execute plan', exact: true }).isDisabled()).toBe(true)
    await http.getByRole('button', { name: /^GET \/ · 200/ }).click()
    await http.getByText('session=[redacted]', { exact: true }).waitFor()
    expect(await http.innerText()).not.toContain('private-browser-cookie')
    await http.getByRole('checkbox', { name: 'Select for comparison' }).last().check()
    await http.getByRole('button', { name: 'Compare selected requests', exact: true }).click()
    await http.getByText(/The displayed content differs/).waitFor()
    await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'dark' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await http.getByText(/The displayed content differs/).scrollIntoViewIfNeeded()
    await page.screenshot({ path: '.dsh/http-evidence-en-dark-narrow.png' })
    const chinese = await browser.newPage({ viewport: { width: 1000, height: 900 }, locale: 'zh-CN', colorScheme: 'light' })
    try {
      await chinese.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await chinese.getByRole('button', { name: '安全分析', exact: true }).click()
      const panel = chinese.getByRole('region', { name: '安全分析', exact: true })
      await panel.getByRole('button', { name: /Owned HTTP application/ }).click()
      await panel.getByRole('button', { name: 'HTTP 验证', exact: true }).click()
      await panel.getByRole('button', { name: /^GET \/ · 401/ }).click()
      await panel.getByText('anonymous', { exact: true }).waitFor()
      await panel.screenshot({ path: '.dsh/http-evidence-zh-light.png' })
    } finally { await chinese.close() }
    expect(tripwire.pageErrors).toEqual([])
  })
  it.skipIf(process.platform !== 'win32' || !process.env.DSH_SECURITY_TSHARK)('inspects Windows interfaces and analyzes imported captures through the browser Remote', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-wireless'))
    const agent = scaffold.ctx.agents.list()[0]!
    const controller = await scaffold.ctx.securityWorkbench.ready
    controller.options.environments.find(item => item.id === 'local')!.tools.push({ id: 'tshark',
      command: process.env.DSH_SECURITY_TSHARK!, prefixArgs: [], versionArgs: ['--version'], source: 'Offline test installation' })
    const capture = Buffer.from('d4c3b2a1020004000000000000000000ffff000069000000', 'hex')
    const imported = await scaffold.ctx.securityWorkbench.importMaterials(agent, JSON.stringify({
      operationId: 'wireless-upload', expectedRevision: controller.view(agent.id).revision,
      title: 'Wireless recording', objective: 'Review an owned offline capture', resources: { environmentIds: ['local'], maxAttempts: 1 },
      material: { kind: 'files', directory: false, files: [{ name: 'radio.pcap', base64: capture.toString('base64') }] },
    }))
    const asset = imported.records.find(item => item.kind === 'asset')!
    await page.getByRole('button', { name: 'Security workspace', exact: false }).click()
    const dashboard = page.getByRole('region', { name: 'Security analysis', exact: true })
    await dashboard.getByRole('button', { name: 'Analysis toolbox', exact: true }).click()
    await dashboard.getByRole('tab', { name: 'Devices', exact: true }).click()
    await dashboard.getByText('Physical capture validation · Not checked', { exact: true }).waitFor()
    expect(scaffold.ctx.securityWorkbench.deviceDirectory('local').inventory.checkedAt).toBe(0)
    await dashboard.getByRole('button', { name: 'Inspect devices', exact: true }).click()
    await expect.poll(() => scaffold.ctx.securityWorkbench.deviceDirectory('local').inventory.checkedAt, { timeout: 30000 }).toBeGreaterThan(0)
    await dashboard.getByText('Physical capture validation · Not checked', { exact: true }).waitFor()
    await dashboard.screenshot({ path: '.dsh/wireless-devices-en-light.png' })
    await page.emulateMedia({ colorScheme: 'dark' })
    await dashboard.screenshot({ path: '.dsh/wireless-devices-en-dark.png' })
    await page.emulateMedia({ colorScheme: 'light' })
    await dashboard.getByRole('button', { name: 'Tasks', exact: true }).click()
    await dashboard.getByRole('button', { name: /Wireless recording/ }).click()
    await dashboard.getByRole('button', { name: 'Materials', exact: true }).click()
    await dashboard.getByRole('button', { name: 'Analyze capture', exact: true }).click()
    await dashboard.getByRole('button', { name: /packet-capture/ }).waitFor()
    const observation = controller.view(agent.id).records.find(item => item.kind === 'evidence')!
    expect(observation.value).toMatchObject({ provider: 'packet-capture', incomplete: false })
    await dashboard.getByRole('button', { name: /packet-capture/ }).click()
    await dashboard.getByText(/"matchedFrames":0/).waitFor()
    if (!('artifact' in asset.value)) throw new Error('Expected imported file')
    expect(await controller.artifacts.read(asset.value.artifact)).toEqual(capture)
    await dashboard.screenshot({ path: '.dsh/wireless-evidence-en.png' })
    const chinese = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', colorScheme: 'dark' })
    try {
      await chinese.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await chinese.getByRole('button', { name: '安全分析', exact: true }).click()
      const panel = chinese.getByRole('region', { name: '安全分析', exact: true })
      await panel.getByRole('button', { name: '分析工具箱', exact: true }).click()
      await panel.getByRole('tab', { name: '设备', exact: true }).click()
      await panel.getByText('真机采集验证 · 未检查', { exact: true }).waitFor()
      await panel.screenshot({ path: '.dsh/wireless-devices-zh-dark.png' })
    } finally { await chinese.close() }
    expect(tripwire.pageErrors).toEqual([])
  })
  it('browses evidence without rebinding and retains an embedded assistant through collapse and reconnect', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-security-dashboard'))
    const agent = scaffold.ctx.agents.list()[0]!
    const controller = await scaffold.ctx.securityWorkbench.ready
    await page.getByTitle('Tools & progress', { exact: true }).click()
    const created = await controller.importMaterials(agent.id, {
      operationId: 'dashboard-material', expectedRevision: controller.view(agent.id).revision,
      task: { title: 'Demo task with a deliberately long name to check wrapping on narrow screens',
        objective: 'Review owned fixture input handling', environmentIds: ['local'], maxAttempts: 3 },
      material: { kind: 'text', name: 'example.js', text: 'function name(input) { return input.name.trim() }' },
    })
    const task = created.records.find(item => item.kind === 'engagement')!.value
    const asset = created.records.find(item => item.kind === 'asset')!.value
    const chatProgress = page.getByRole('region', { name: 'Tools & progress', exact: true })
    await chatProgress.getByText(task.title, { exact: true }).waitFor()
    await controller.command(agent.id, { operationId: 'main-page-checkpoint', expectedRevision: controller.view(agent.id).revision,
      action: { kind: 'checkpoint', phase: 'recon', title: 'Entry inventory', reason: '',
        summary: 'Read the owned fixture', next: 'Check input handling', evidenceIds: [], findingIds: [] } }, true)
    await chatProgress.getByRole('heading', { name: /Entry inventory/ }).waitFor()
    await controller.observe(agent.id, { provider: 'source', operation: 'read', assetId: asset.id,
      environmentId: 'local', impact: 'observe', parameters: { path: 'example.js' } }, 'main-page-source', new AbortController().signal)
    const sourceEvidence = controller.view(agent.id).records.find(item => item.kind === 'evidence' && item.value.provider === 'source')
    if (sourceEvidence?.kind !== 'evidence') throw new Error('Expected source evidence')
    await chatProgress.getByRole('group', { name: 'source ×1' }).waitFor()
    await expect.poll(async () => page.getByTitle('Tools & progress', { exact: true }).textContent()).toContain('1')
    const chatInput = page.locator('[contenteditable="true"],textarea').first()
    await chatInput.fill('Keep this correction draft')
    expect(await chatInput.evaluate(node => node instanceof HTMLTextAreaElement ? node.value : node.textContent)).toBe('Keep this correction draft')
    const observed = await controller.captureAnalysis(agent.id, asset.id, ['fixture-call'],
      Buffer.from('Demo observation: input handling requires review'), new AbortController().signal)
    if (observed.kind !== 'evidence') throw new Error('Expected evidence')
    await controller.command(agent.id, { operationId: 'dashboard-finding', expectedRevision: controller.view(agent.id).revision,
      action: { kind: 'finding', finding: { assetId: asset.id, title: 'Input requires validation', explanation: 'Fixture observation only',
        status: 'suspected', evidenceIds: [observed.value.id, sourceEvidence.value.id], conditions: 'Owned example', review: '' } } }, true)
    const before = controller.projectView(task.id)
    const sessionsBefore = scaffold.ctx.agents.list().length
    await page.getByRole('button', { name: 'Security workspace', exact: false }).click()
    const dashboard = page.getByRole('region', { name: 'Security analysis', exact: true })
    await dashboard.getByLabel('Search tasks or objectives').fill('deliberately')
    await dashboard.getByRole('button', { name: /Demo task/ }).click()
    await dashboard.getByRole('heading', { name: task.title, exact: true }).waitFor()
    expect(controller.projectView(task.id)).toEqual(before)
    expect(scaffold.ctx.agents.list()).toHaveLength(sessionsBefore)
    const graph = dashboard.getByRole('region', { name: 'Investigation', exact: true })
    await graph.getByText('Live updates', { exact: true }).waitFor()
    await expect.poll(() => graph.locator('[role="img"][aria-label]').count()).toBeGreaterThan(0)
    expect(await graph.locator('[role="img"][aria-label]').evaluateAll(nodes => nodes.some(node => /[0-9a-f]{8}-[0-9a-f-]{27}/i.test(node.getAttribute('aria-label') ?? '')))).toBe(false)
    await graph.getByRole('button', { name: 'Finding: Input requires validation', exact: true }).click()
    const graphDetails = graph.getByRole('complementary', { name: 'Investigation details' })
    await graphDetails.getByRole('button', { name: new RegExp(observed.value.title) }).click()
    await graphDetails.getByText('Demo observation: input handling requires review', { exact: true }).waitFor()
    expect(await graphDetails.locator('details').getAttribute('open')).toBeNull()
    await graphDetails.getByRole('button', { name: 'Close', exact: true }).click()
    await graph.getByRole('button', { name: 'Expand observations', exact: true }).click()
    await graph.getByRole('button', { name: 'Observation: source read', exact: true }).click()
    await graphDetails.getByRole('heading', { name: 'example.js', level: 4 }).waitFor()
    const sourcePreview = await graphDetails.locator('section pre').innerText()
    expect(sourcePreview).toBe('1: function name(input) { return input.name.trim() }')
    expect(await graphDetails.locator('details').filter({ hasText: 'Original output' }).getAttribute('open')).toBeNull()
    await graphDetails.getByRole('button', { name: 'Close', exact: true }).click()
    const viewport = graph.locator('.react-flow__viewport')
    await graph.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect.poll(() => viewport.getAttribute('style')).toContain('transform')
    const position = await viewport.getAttribute('style')
    await dashboard.getByRole('navigation', { name: 'Task detail navigation' }).getByRole('button', { name: 'Tools & progress', exact: true }).click()
    const activity = dashboard.getByRole('region', { name: 'Analysis progress', exact: true })
    await activity.getByText('Live updates', { exact: true }).waitFor()
    const checkpoint = async (operationId: string, phase: string, title: string, id?: string) => {
      return controller.command(agent.id, { operationId, expectedRevision: controller.view(agent.id).revision,
        action: { kind: 'checkpoint', phase, title, ...(id ? { id } : {}), reason: 'Inspect the owned fixture',
          summary: 'Input handling is unverified', next: 'Read the caller', evidenceIds: [observed.value.id], findingIds: [] } }, true)
    }
    const initial = await checkpoint('web-recon', 'recon', 'Entry inventory')
    const direction = initial.records.find(item => item.kind === 'checkpoint')!
    await checkpoint('web-recon-update', 'recon', 'Entry inventory', direction.value.id)
    await activity.getByRole('heading', { name: /Entry inventory/ }).waitFor()
    expect(await activity.getByRole('heading', { level: 4 }).count()).toBe(1)
    await checkpoint('web-assess', 'assessment', 'Access checks')
    await checkpoint('web-more-recon', 'recon', 'Supplemental reconnaissance')
    await controller.observe(agent.id, { provider: 'source', operation: 'read', assetId: asset.id,
      environmentId: 'local', impact: 'observe', parameters: { path: 'example.js' } }, 'web-live-observation', new AbortController().signal)
    await activity.getByRole('group', { name: 'source ×1' }).last().waitFor()
    expect(await activity.getByRole('heading', { level: 4 }).count()).toBe(3)
    await activity.getByText('Inspect calls and evidence', { exact: true }).last().click()
    await activity.getByText('Technical details', { exact: true }).last().click()
    await activity.getByText(/web-live-observation/).waitFor()
    const assignment = await controller.admitDelegation(agent.id, 'web-delegation', {
      assetId: asset.id, role: 'reviewer', task: 'review', question: 'Check the ownership evidence',
      criterion: 'Identify what the saved observation establishes', reason: 'Independent evidence assessment',
    })
    const childWork = activity.getByRole('article', { name: 'Check the ownership evidence' })
    await childWork.getByText('Awaiting start', { exact: true }).waitFor()
    await controller.bindDelegationChild(assignment.id, 'web-review-child')
    await childWork.getByText('Running', { exact: true }).waitFor()
    await controller.settleDelegation(assignment.id, { status: 'completed', report: {
      summary: 'The observation does not establish an authorization failure.', evidenceIds: [observed.value.id],
      uncertainty: 'The caller has not been inspected.', nextSteps: ['Inspect the calling implementation.'],
    } })
    await childWork.getByText('The observation does not establish an authorization failure.', { exact: true }).waitFor()
    await controller.command(agent.id, { operationId: 'web-delegation-decision', expectedRevision: controller.view(agent.id).revision,
      action: { kind: 'delegation-disposition', delegationId: assignment.id, decision: 'needs-more', reason: 'Need caller evidence before concluding.' } })
    await childWork.getByText('Need caller evidence before concluding.', { exact: true }).waitFor()
    expect(controller.projectView(task.id).records.filter(item => item.kind === 'finding').map(item => item.value.status)).toEqual(['suspected'])
    await dashboard.getByRole('navigation', { name: 'Task detail navigation' }).getByRole('button', { name: 'Investigation', exact: true }).click()
    expect(await viewport.getAttribute('style')).toBe(position)
    for (let index = 0; index < 50; index++) await checkpoint(`long-direction-${index}`, 'assessment', `Additional question ${index}`)
    expect(await viewport.getAttribute('style')).toBe(position)
    await graph.getByRole('searchbox', { name: 'Search questions or results' }).fill('Additional question 49')
    await graph.getByRole('button', { name: 'Research direction: Additional question 49', exact: true }).waitFor()
    await graph.getByRole('searchbox', { name: 'Search questions or results' }).fill('')
    await dashboard.getByRole('button', { name: 'Findings', exact: true }).click()
    await dashboard.getByRole('heading', { name: 'Input requires validation' }).waitFor()
    await dashboard.locator('article details summary').click()
    await dashboard.getByRole('button', { name: 'source read', exact: true }).click()
    await dashboard.getByRole('heading', { name: 'example.js', level: 4 }).waitFor()
    expect(await dashboard.locator('pre').filter({ hasText: /^1: function name/ }).innerText()).toBe(sourcePreview)
    await dashboard.getByRole('button', { name: 'Evidence', exact: true }).click()
    await dashboard.getByLabel('Search evidence titles or summaries').fill(observed.value.title)
    await dashboard.getByRole('button', { name: new RegExp(observed.value.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
    await dashboard.getByText('Demo observation: input handling requires review', { exact: true }).waitFor()
    await dashboard.getByRole('button', { name: '← Back to evidence' }).click()
    expect(await dashboard.getByLabel('Search evidence titles or summaries').inputValue()).toBe(observed.value.title)
    await dashboard.getByLabel('Search evidence titles or summaries').fill('source read')
    await dashboard.getByRole('button', { name: /^source read/ }).first().click()
    await dashboard.getByRole('heading', { name: 'example.js', level: 4 }).waitFor()
    expect(await dashboard.locator('pre').filter({ hasText: /^1: function name/ }).innerText()).toBe(sourcePreview)
    expect(await dashboard.locator('details').filter({ hasText: 'Original output' }).getAttribute('open')).toBeNull()
    await dashboard.getByRole('button', { name: 'Reports', exact: true }).click()
    await dashboard.getByText('No reports yet.', { exact: false }).waitFor()
    await dashboard.getByRole('button', { name: 'Analysis assistant', exact: true }).click()
    const assistant = dashboard.getByRole('complementary', { name: 'Analysis assistant' })
    const editor = assistant.locator('textarea,[contenteditable="true"]').first()
    await editor.fill('Keep this unsent draft')
    await dashboard.getByRole('button', { name: 'Hide assistant' }).click()
    await dashboard.getByRole('button', { name: 'Analysis assistant', exact: true }).click()
    expect(await editor.textContent()).toBe('Keep this unsent draft')
    const separator = assistant.getByRole('separator')
    const widthBefore = (await assistant.boundingBox())!.width
    const handle = (await separator.boundingBox())!
    expect(await separator.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.className
    })).toBe(await separator.getAttribute('class'))
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x - 100, handle.y + handle.height / 2, { steps: 5 })
    await page.mouse.up()
    await expect.poll(async () => (await assistant.boundingBox())!.width).toBeGreaterThan(widthBefore)
    await assistant.getByRole('button', { name: 'Expand to full page' }).click()
    expect(Math.abs((await assistant.boundingBox())!.width - (await dashboard.boundingBox())!.width)).toBeLessThan(2)
    await assistant.getByRole('button', { name: 'Restore split view' }).click()
    expect(await editor.textContent()).toBe('Keep this unsent draft')
    await controller.command(agent.id, { operationId: 'approval-check', expectedRevision: controller.view(agent.id).revision,
      action: { kind: 'check', check: { assetId: asset.id, title: 'Read selected source', phase: 'validation',
        criterion: 'Record source contents', dependencies: [], evidenceIds: [] } } }, true)
    const check = controller.view(agent.id).records.find(item => item.kind === 'check')!
    controller.options.environments.find(item => item.id === 'local')!.tools.push({ id: 'python',
      command: process.env.DSH_SECURITY_SCRIPT_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'),
      versionArgs: ['--version'], source: 'Browser test interpreter' })
    await controller.command(agent.id, { operationId: 'approval-plan', expectedRevision: controller.view(agent.id).revision,
      action: { kind: 'plan', checkId: check.value.id,
        operation: { provider: 'native', operation: 'python', assetId: asset.id, environmentId: 'local', parameters: {}, impact: 'observe' },
        script: 'print("Native validation complete")\n',
        hypothesis: 'Run owned native fixture', expectedObservation: 'Native validation complete', impact: 'Print output', cleanup: 'No files created', durationMs: 30000 } }, true)
    await dashboard.getByText('Plans await approval.', { exact: false }).waitFor()
    await dashboard.getByRole('button', { name: 'Plan approvals', exact: true }).click()
    const approval = assistant.getByRole('region', { name: 'Advanced details', exact: true })
    await approval.getByText('Run owned native fixture', { exact: true }).waitFor()
    await approval.getByText('Native Python on the computer running the Host', { exact: true }).waitFor()
    await approval.getByText('Python executable and version', { exact: true }).waitFor()
    await approval.getByText('Working directory', { exact: true }).waitFor()
    await approval.getByRole('heading', { name: 'What will be verified' }).waitFor()
    expect(await approval.getByText('Prepare validation plan', { exact: true }).count()).toBe(0)
    const technical = approval.locator('details').filter({ has: page.getByText('Technical details (parameters and version)', { exact: true }) })
    expect(await technical.getAttribute('open')).toBeNull()
    await dashboard.screenshot({ path: '.dsh/security-plan-approvals.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await assistant.getByRole('button', { name: 'Expand to full page' }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await assistant.screenshot({ path: '.dsh/security-plan-approvals-narrow-dark.png' })
    await assistant.getByRole('button', { name: 'Restore split view' }).click()
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize({ width: 1400, height: 1000 })
    expect(await approval.getByRole('button', { name: 'Execute plan' }).isDisabled()).toBe(true)
    await approval.getByRole('button', { name: 'Approve this version' }).click()
    await expect.poll(() => controller.view(agent.id).records.find(item => item.kind === 'plan')?.value.status).toBe('approved')
    await approval.getByRole('button', { name: 'Execute plan' }).click()
    await expect.poll(() => controller.view(agent.id).records.find(item => item.kind === 'execution')?.value.status).toBe('completed')
    await approval.getByText('Execution result: Completed', { exact: true }).waitFor()
    await controller.command(agent.id, { operationId: 'blocked-plan', expectedRevision: controller.view(agent.id).revision,
      action: { kind: 'plan', checkId: check.value.id,
        operation: { provider: 'native', operation: 'python', assetId: asset.id, environmentId: 'local', parameters: {}, impact: 'observe' },
        script: 'raise RuntimeError("Owned fixture blocker")\n', hypothesis: 'Retain a failed local observation',
        expectedObservation: 'Failure is recorded', impact: 'Print error', cleanup: 'No files created', durationMs: 30000 } }, true)
    const blockedPlan = controller.view(agent.id).records.filter(item => item.kind === 'plan').at(-1)!
    await controller.command(agent.id, { operationId: 'approve-blocked-plan', expectedRevision: controller.view(agent.id).revision,
      action: { kind: 'approve', planId: blockedPlan.value.id } }, true)
    await expect(controller.execute(agent.id, blockedPlan.value.id, 'browser-blocked-execution', controller.view(agent.id).revision,
      'browser-blocked', new AbortController().signal)).rejects.toThrow()
    expect(controller.view(agent.id).records.find(item => item.kind === 'check')?.value.status).toBe('blocked')
    await assistant.getByRole('button', { name: 'Close', exact: true }).click()
    await dashboard.getByRole('button', { name: 'Analysis assistant', exact: true }).click()
    expect(await editor.textContent()).toBe('Keep this unsent draft')
    await page.context().setOffline(true)
    await page.context().setOffline(false)
    await dashboard.getByRole('button', { name: 'Refresh', exact: true }).click()
    await dashboard.getByRole('heading', { name: task.title, exact: true }).waitFor()
    await dashboard.getByRole('button', { name: 'Stop task', exact: true }).click()
    await dashboard.getByText('This task is stopped.', { exact: false }).waitFor()
    await editor.waitFor({ state: 'visible' })
    await editor.fill('Keep stopped; inspect the caller before resuming')
    expect(controller.projects().find(item => item.id === task.id)?.stopped).toBe(true)
    await dashboard.getByRole('button', { name: 'Hide assistant', exact: true }).click()
    await dashboard.getByRole('button', { name: 'Overview', exact: true }).click()
    await dashboard.getByRole('checkbox', { name: 'Blocked checks only' }).check()
    await dashboard.getByRole('button', { name: 'Resolve blocker', exact: true }).click()
    const focusedCheck = assistant.locator('article').filter({ has: page.getByText('Read selected source', { exact: true }) })
    await focusedCheck.getByRole('button', { name: 'Reconcile and retry', exact: true }).waitFor()
    await expect.poll(() => focusedCheck.evaluate(element => element === document.activeElement)).toBe(true)
    await focusedCheck.getByLabel('Review or recovery rationale').fill('The owned error output was reviewed; keep this task stopped.')
    await focusedCheck.getByRole('button', { name: 'Reconcile and retry', exact: true }).click()
    await expect.poll(() => controller.view(agent.id).records.find(item => item.kind === 'check')?.value.status).toBe('planned')
    expect(controller.projects().find(item => item.id === task.id)?.stopped).toBe(true)
    expect(controller.view(agent.id).records.filter(item => item.kind === 'execution')).toHaveLength(2)
    await dashboard.screenshot({ path: '.dsh/security-blocker-reconciled.png' })
    await assistant.getByRole('button', { name: 'Close', exact: true }).click()
    await dashboard.getByRole('button', { name: 'Resume task', exact: true }).click()
    await expect.poll(() => controller.projects().find(item => item.id === task.id)?.stopped).toBe(false)
    await assistant.waitFor({ state: 'hidden' })
    expect(controller.view(agent.id).records.filter(item => item.kind === 'execution')).toHaveLength(2)
    await page.setViewportSize({ width: 390, height: 844 })
    await dashboard.getByRole('button', { name: '← Back to tasks' }).click()
    await dashboard.getByRole('button', { name: /Demo task/ }).waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const taskRow = dashboard.locator('article').filter({ has: page.getByRole('button', { name: /Demo task/ }) })
    await taskRow.getByRole('button', { name: 'Delete task', exact: true }).click()
    await taskRow.getByRole('group', { name: 'Confirm deletion', exact: true }).waitFor()
    expect(controller.projects().some(item => item.id === task.id)).toBe(true)
    await taskRow.getByRole('button', { name: 'Cancel', exact: true }).click()
    await taskRow.getByRole('button', { name: 'Delete task', exact: true }).click()
    await taskRow.getByRole('button', { name: 'Confirm deletion', exact: true }).click()
    await dashboard.getByText('Task deleted', { exact: false }).waitFor()
    expect(await dashboard.getByRole('button', { name: /Demo task/ }).count()).toBe(0)
    await dashboard.getByRole('button', { name: 'Undo deletion', exact: true }).click()
    await dashboard.getByRole('button', { name: /Demo task/ }).waitFor()
    expect(controller.projects().find(item => item.id === task.id)?.stopped).toBe(true)
    await taskRow.getByRole('button', { name: 'Delete task', exact: true }).click()
    await taskRow.getByRole('button', { name: 'Confirm deletion', exact: true }).click()
    await dashboard.getByText('Task deleted', { exact: false }).waitFor()
    await dashboard.getByRole('button', { name: 'Deleted tasks', exact: true }).click()
    await taskRow.getByRole('button', { name: 'Delete permanently', exact: true }).click()
    const confirmPurge = taskRow.getByRole('button', { name: 'Confirm permanent deletion', exact: true })
    expect(await confirmPurge.isDisabled()).toBe(false)
    expect(await taskRow.getByRole('textbox').count()).toBe(0)
    expect(controller.projects(true).some(item => item.id === task.id)).toBe(true)
    await taskRow.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(controller.projects(true).some(item => item.id === task.id)).toBe(true)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await taskRow.getByRole('button', { name: 'Delete permanently', exact: true }).click()
    await taskRow.getByRole('group', { name: 'Confirm permanent deletion', exact: true })
      .screenshot({ path: '.dsh/task-delete-confirmation.png' })
    await confirmPurge.click()
    await dashboard.getByText('Task permanently deleted', { exact: false }).waitFor()
    expect(controller.projects(true).some(item => item.id === task.id)).toBe(false)
    expect(() => controller.projectView(task.id)).toThrow(/Unknown/)
    expect(await dashboard.getByRole('button', { name: 'Undo deletion', exact: true }).count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  })
})

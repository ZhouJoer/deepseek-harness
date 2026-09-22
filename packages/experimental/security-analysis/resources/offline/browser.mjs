/** Loads original snapshot pages without external requests. */
import { chromium } from 'playwright'
import { readFile, realpath } from 'node:fs/promises'
import { relative, resolve, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
const sourceRoot = '/input/source'
const browser = await chromium.launch({ executablePath: process.env.DSH_CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
try {
  const context = await browser.newContext({ serviceWorkers: 'block' })
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://localhost') return route.abort('blockedbyclient')
    try {
      const path = await realpath(resolve(sourceRoot, '.' + decodeURIComponent(url.pathname)))
      const tail = relative(sourceRoot, path)
      if (tail.startsWith('..') || isAbsolute(tail)) return route.abort('blockedbyclient')
      const contentType = path.endsWith('.html') ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'application/octet-stream'
      await route.fulfill({ body: await readFile(path), contentType })
    } catch (error) {
      await route.fulfill({ status: 404, body: 'Snapshot member unavailable' })
    }
  })
  const page = await context.newPage()
  const check = await import(pathToFileURL(process.argv[2]).href)
  if (typeof check.default !== 'function') throw new Error('Browser script must export a default async check function')
  await check.default({ page, context, sourceRoot, open: path => page.goto(new URL(path, 'http://localhost/').href) })
} finally { await browser.close() }

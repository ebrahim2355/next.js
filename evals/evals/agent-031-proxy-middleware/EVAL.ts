/**
 * Proxy (formerly Middleware)
 *
 * Tests whether the agent creates proxy.ts with a proxy() function (Next.js
 * 16+ convention) instead of the deprecated middleware.ts/middleware().
 *
 * Tricky because agents trained on pre-16 data create middleware.ts with a
 * middleware() function — the file and function were both renamed in Next.js 16.
 *
 * The rename is checked structurally, because that is the point of the eval and
 * it can be verified without guessing at style. Everything else is judged.
 *
 * The old behaviour checks were also wrapped in `if (existsSync(proxyPath))`,
 * so every one of them passed vacuously when the agent never created proxy.ts
 * at all — only the first test caught that case.
 *
 * Previously the behaviour checks were regexes over the source text, and they
 * rejected correct work on two counts. They required the export to be a
 * `function` declaration, so `export const proxy: NextProxy = (request) => ...`
 * failed even though it is the same export. And they required the literal
 * `NextResponse.next()`, so `NextResponse.next({ request: { headers } })` failed
 * even though it is the richer, more correct form: it forwards the id on the
 * request as well as setting it on the response. Two independent frontier models
 * were failed by both. Style is not the thing under test here.
 */

import { expect, test } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { environment } from '@vercel/agent-eval/eval'

const proxyPath = join(process.cwd(), 'proxy.ts')

/** Any export form binding `name`: declaration, const/let/var, default, or list. */
function exportsBinding(source: string, name: string): boolean {
  return (
    new RegExp(
      `export\\s+(default\\s+)?(async\\s+)?function\\s+${name}\\b`
    ).test(source) ||
    new RegExp(`export\\s+(const|let|var)\\s+${name}\\b`).test(source) ||
    new RegExp(`export\\s+default\\s+${name}\\b`).test(source) ||
    new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(source)
  )
}

test('proxy.ts file exists in root (Next.js 16+ convention)', () => {
  // In Next.js 16+ the file is proxy.ts, not middleware.ts; middleware.ts is
  // deprecated.
  expect(existsSync(proxyPath), 'expected proxy.ts in the project root').toBe(
    true
  )
  expect(
    existsSync(join(process.cwd(), 'middleware.ts')),
    'middleware.ts is deprecated in Next.js 16+; expected proxy.ts instead'
  ).toBe(false)
})

test('Proxy exports a handler named proxy, not middleware', () => {
  // Guarded so a missing file fails with this message rather than an ENOENT
  // stack. The old version guarded with `if (existsSync(...))`, which made this
  // and the behaviour checks pass vacuously whenever proxy.ts was absent.
  expect(existsSync(proxyPath), 'no proxy.ts to inspect').toBe(true)
  const content = readFileSync(proxyPath, 'utf-8')

  // Accept any export form. A typed arrow const is as valid as a declaration.
  expect(
    exportsBinding(content, 'proxy'),
    'expected proxy.ts to export a handler named `proxy` (function, const, or default)'
  ).toBe(true)
  expect(
    exportsBinding(content, 'middleware'),
    'the Next.js 16+ handler is named `proxy`, not `middleware`'
  ).toBe(false)
})

test('Proxy tags every response with a unique X-Request-Id and logs the pathname', async () => {
  await expect(environment).toSatisfyCriterion(
    `The project root contains proxy.ts exporting a Next.js proxy handler that does two things for the requests it matches.

First, it attaches an \`X-Request-Id\` header carrying a value that is newly generated per request (for example crypto.randomUUID()), rather than a constant. Setting it on the outgoing response is required; also forwarding it onto the request headers so route handlers and server components can read it is correct and welcome, not a defect.

Second, it logs the request pathname to the console.

Judge the behaviour, not the spelling. Any export form is fine: \`export function proxy\`, \`export async function proxy\`, \`export default function proxy\`, or \`export const proxy: NextProxy = (request) => ...\`. Any way of building the response is fine, including \`NextResponse.next()\`, \`NextResponse.next({ request: { headers } })\`, or constructing a response another way, so long as the header actually ends up on it. An optional \`config.matcher\` narrowing which paths run is fine.

Incorrect: no X-Request-Id header set, an id that is the same value on every request (a hard-coded string or a module-level constant computed once), or no logging of the pathname.`
  )
})

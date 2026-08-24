/**
 * Use Cache Directive
 *
 * Generic behavior checks for this scenario:
 * - product reads use `use cache` and are tagged with the products key
 * - the catalog is sourced from getAllProducts() in lib/db
 * - an inline Server Action flow exists and is form-triggered
 * - the action revalidates that tag with a profile argument
 * - updateTag is not used
 *
 * The last point is deliberate and stays a hard check. The prompt asks for the
 * admin to keep working while the list is briefly stale and refreshes in the
 * background, which is revalidateTag's stale-while-revalidate semantics.
 * updateTag is the read-your-own-writes API and answers a different question;
 * agent-037-updatetag-cache covers that one.
 *
 * The tag and data-source checks are judged rather than matched literally.
 * They used to require the exact strings cacheTag('products') and
 * revalidateTag('products', ...), so hoisting the key into a named constant
 * failed, and they looked for the substring "lib/db" in an import, so a caching
 * wrapper placed inside lib/ importing './db.js' relatively failed. Both are
 * correct, and arguably better, implementations of the same requirement.
 */

import { expect, test } from 'vitest'
import { environment } from '@vercel/agent-eval/eval'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

type SourceFile = { path: string; content: string }

const IGNORE_DIRS = new Set([
  '.git',
  '.next',
  'node_modules',
  'dist',
  'build',
  'coverage',
])

const IGNORE_FILES = new Set(['EVAL.ts', 'PROMPT.md'])

function readSourceFiles(dir: string): SourceFile[] {
  if (!existsSync(dir)) return []

  const files: SourceFile[] = []
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIRS.has(entry)) continue

    const fullPath = join(dir, entry)
    const stats = statSync(fullPath)

    if (stats.isDirectory()) {
      files.push(...readSourceFiles(fullPath))
      continue
    }

    if (IGNORE_FILES.has(entry)) continue

    if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      files.push({
        path: fullPath,
        content: readFileSync(fullPath, 'utf-8'),
      })
    }
  }

  return files
}

const sourceFiles = readSourceFiles(process.cwd())
const source = sourceFiles.map((file) => file.content).join('\n')

function fileWith(pattern: RegExp): SourceFile | undefined {
  return sourceFiles.find((file) => pattern.test(file.content))
}

test('Catalog reads are cached and sourced from lib/db', async () => {
  // Cheap, style-independent: the directive itself must be present somewhere.
  expect(source).toMatch(/['"]use cache['"];?/)

  await expect(environment).toSatisfyCriterion(
    `Product catalog reads must be cached with the \`use cache\` directive and tagged with a "products" cache tag via cacheTag, so that a single tagged revalidation refreshes every view built on that data.

The catalog data itself must come from the getAllProducts() helper the project already ships in lib/db, rather than a reimplemented query or hard-coded array. Reaching it through a thin cached wrapper module is correct: what matters is that getAllProducts() is what ultimately reads the catalog.

Judge the wiring, not the spelling. The tag may be written inline as cacheTag('products') or hoisted into a named constant such as PRODUCTS_CACHE_TAG = 'products' and passed by reference; both are correct, and the constant is if anything better practice. The cached wrapper may live in lib/, in app/, or alongside the page, and may import lib/db by any path form including a relative './db.js'. A cacheLife profile may or may not be present; it is not required here.

Incorrect: no \`use cache\` on the catalog read, a cache tag whose value is not the products key, or product data that does not originate from getAllProducts() in lib/db.`
  )
})

test('Inline form-triggered Server Action flow exists', () => {
  const inlineActionFile = sourceFiles.find((file) => {
    return (
      /<form[\s\S]*action\s*=\s*\{/.test(file.content) &&
      /['"]use server['"];?/.test(file.content) &&
      (/async\s+function\s+\w+/.test(file.content) ||
        /const\s+\w+\s*=\s*async\s*\(/.test(file.content))
    )
  })

  expect(
    inlineActionFile,
    'Expected one file to contain form action={...} and inline Server Action markers'
  ).toBeDefined()
})

test('Server Action revalidates the products tag with a profile', async () => {
  // Hard check: this scenario is stale-while-revalidate, not read-your-own-writes.
  expect(
    source,
    'this scenario wants revalidateTag (background refresh), not updateTag (read-your-own-writes) — see agent-037 for that API'
  ).not.toMatch(/\bupdateTag\s*\(/)

  await expect(environment).toSatisfyCriterion(
    `The "Sync latest catalog" Server Action must invalidate the cached catalog by calling revalidateTag, imported from 'next/cache', targeting the same products tag the cached read was tagged with, and passing a revalidation profile as the second argument.

Judge the wiring, not the spelling. The tag may be an inline string literal or a named constant shared with the cached read; a shared constant is correct and preferable. Any valid profile value for the second argument is acceptable.

Incorrect: no revalidateTag call, revalidating a tag that does not match the one the catalog read is tagged with, or omitting the profile argument.`
  )
})

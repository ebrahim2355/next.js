import { nextTestSetup } from 'e2e-utils'
import stripAnsi from 'strip-ansi'
import {
  getRedboxDescription,
  getRedboxSource,
  getRedboxTitle,
  waitForRedbox,
} from 'next-test-utils'

describe('incompatible-parallel-route-slots', () => {
  const { next, isNextDev, skipped } = nextTestSetup({
    files: __dirname,
    skipStart: true,
    skipDeployment: true,
  })

  if (skipped) return

  it('reports the layout whose slots cannot render the same URLs', async () => {
    let output: string
    if (isNextDev) {
      await next.start()
      const browser = await next.browser('/foo')
      await waitForRedbox(browser)
      const redbox = {
        title: await getRedboxTitle(browser),
        description: await getRedboxDescription(browser),
        source: await getRedboxSource(browser),
      }
      if (process.env.IS_TURBOPACK_TEST) {
        expect(redbox).toMatchInlineSnapshot(`
         {
           "description": "Parallel route slots cannot render the same URLs",
           "source": "./app/layout.tsx
         Error: Parallel route slots cannot render the same URLs
         The following layouts have parallel route slots that cannot render the same URLs:
         app/layout.tsx
         - /foo is missing a matching page or default.tsx in @right
         - /bar is missing a matching page or default.tsx in @left

         Every URL matched by one slot must have a matching page or default.tsx in every sibling slot.",
           "title": "Build Error",
         }
        `)
      } else {
        // Webpack and Rspack surface the filesystem-watcher error through the
        // same HMR server-error path.
        expect(redbox).toMatchInlineSnapshot(`
         {
           "description": "app/layout.tsx",
           "source": "The following layouts have parallel route slots that cannot render the same URLs:
         app/layout.tsx
         - /bar is missing a matching page or default.tsx in @left
         - /foo is missing a matching page or default.tsx in @right

         Every URL matched by one slot must have a matching page or default.tsx in every sibling slot.",
           "title": "Build Error",
         }
        `)
      }
      const response = await (await next.fetch('/foo')).text()
      output = `${next.cliOutput}\n${response}`
    } else {
      const { exitCode } = await next.build()
      expect(exitCode).toBe(1)
      output = next.cliOutput
    }

    output = stripAnsi(output)
    expect(output).toContain(
      'parallel route slots that cannot render the same URLs'
    )
    expect(output).toContain('app/layout.tsx')
    expect(output).toContain(
      '\n- /foo is missing a matching page or default.tsx in @right\n'
    )
    expect(output).toContain(
      '\n- /bar is missing a matching page or default.tsx in @left\n'
    )

    // The structural diagnostic should be emitted before the loader-tree
    // invariant that guards the pruning implementation.
    expect(output).not.toContain(
      'strict route matching retained the incomplete route matcher'
    )
  })
})

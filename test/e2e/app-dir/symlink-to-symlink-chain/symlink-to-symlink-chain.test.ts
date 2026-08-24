import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { nextTestSetup } from 'e2e-utils'

describe('symlink-to-symlink chain', () => {
  const { next } = nextTestSetup({
    files: __dirname,
    skipStart: true,
  })

  beforeAll(async () => {
    await mkdir(join(next.testDir, 'packages'), { recursive: true })
    await mkdir(join(next.testDir, 'node_modules/@scope'), {
      recursive: true,
    })
    await next.symlink('vendor/packages/ui', 'packages/ui')
    await next.symlink('packages/ui', 'node_modules/@scope/ui')
    await next.start()
  })

  it('resolves a package through both links', async () => {
    const res = await next.fetch('/')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('hello from symlink chain')
  })
})

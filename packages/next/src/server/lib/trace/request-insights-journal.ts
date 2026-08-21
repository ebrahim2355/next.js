import { createReadStream } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { createInterface } from 'readline'
import type { RequestInsight } from '../../../next-devtools/shared/request-insights'
import { RotatingWriteStream } from './rotating-write-stream'

const JOURNAL_SIZE_LIMIT = 50 * 1024 * 1024
const JOURNAL_FILENAME = 'request-insights.ndjson'
const REQUEST_INSIGHTS_JOURNAL_KEY = Symbol.for(
  `@next/request-insights-journal@${process.env.__NEXT_VERSION}`
)

type JournalRecord = {
  version: 1
  request: RequestInsight
}

type JournalFilter = {
  requestId?: string
  htmlRequestId?: string
  limit?: number
}

class RequestInsightsJournal {
  private stream: RotatingWriteStream | undefined
  private writes = Promise.resolve()

  constructor(readonly file: string) {}

  append(request: RequestInsight): void {
    let line: string
    try {
      line = `${JSON.stringify({ version: 1, request } satisfies JournalRecord)}\n`
    } catch {
      return
    }

    this.writes = this.writes
      .then(async () => {
        if (!this.stream) {
          await mkdir(path.dirname(this.file), { recursive: true })
          this.stream = new RotatingWriteStream(
            this.file,
            JOURNAL_SIZE_LIMIT,
            'a'
          )
        }
        await this.stream.write(line)
      })
      .catch((error) => {
        console.warn('Failed to write Request Insights journal', error)
      })
  }

  async flush(): Promise<void> {
    await this.writes
    await this.stream?.flush()
  }

  async close(): Promise<void> {
    await this.flush()
    await this.stream?.end()
  }
}

export function appendRequestInsightToJournal(request: RequestInsight): void {
  getConfiguredRequestInsightsJournal()?.append(request)
}

export async function readRequestInsightsJournal(
  distDir: string,
  filter: JournalFilter = {}
): Promise<RequestInsight[]> {
  const journal = getOrCreateRequestInsightsJournal(distDir)

  await journal.flush()

  const matches: RequestInsight[] = []
  try {
    const lines = createInterface({
      input: createReadStream(journal.file, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    })

    for await (const line of lines) {
      const request = parseJournalLine(line)
      if (
        !request ||
        (filter.requestId !== undefined &&
          request.requestId !== filter.requestId) ||
        (filter.htmlRequestId !== undefined &&
          request.htmlRequestId !== filter.htmlRequestId)
      ) {
        continue
      }

      matches.push(request)
      if (filter.limit !== undefined && matches.length > filter.limit) {
        matches.shift()
      }
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      console.warn('Failed to read Request Insights journal', error)
    }
  }

  return matches
}

export async function resetRequestInsightsJournalForTest(): Promise<void> {
  await closeRequestInsightsJournal()
}

export async function closeRequestInsightsJournal(): Promise<void> {
  const globalStore = globalThis as typeof globalThis & {
    [REQUEST_INSIGHTS_JOURNAL_KEY]?: RequestInsightsJournal
  }
  const journal = globalStore[REQUEST_INSIGHTS_JOURNAL_KEY]
  delete globalStore[REQUEST_INSIGHTS_JOURNAL_KEY]
  await journal?.close()
}

export async function initializeRequestInsightsJournal(
  distDir: string
): Promise<void> {
  const journal = getOrCreateRequestInsightsJournal(distDir)
  await mkdir(path.dirname(journal.file), { recursive: true })
  await writeFile(journal.file, '')
}

export function configureRequestInsightsJournal(distDir: string): void {
  getOrCreateRequestInsightsJournal(distDir)
}

function getConfiguredRequestInsightsJournal():
  | RequestInsightsJournal
  | undefined {
  const globalStore = globalThis as typeof globalThis & {
    [REQUEST_INSIGHTS_JOURNAL_KEY]?: RequestInsightsJournal
  }
  return globalStore[REQUEST_INSIGHTS_JOURNAL_KEY]
}

function getOrCreateRequestInsightsJournal(
  distDir: string
): RequestInsightsJournal {
  const globalStore = globalThis as typeof globalThis & {
    [REQUEST_INSIGHTS_JOURNAL_KEY]?: RequestInsightsJournal
  }
  return (globalStore[REQUEST_INSIGHTS_JOURNAL_KEY] ??=
    new RequestInsightsJournal(path.join(distDir, 'dev', JOURNAL_FILENAME)))
}

function parseJournalLine(line: string): RequestInsight | undefined {
  try {
    const record = JSON.parse(line) as Partial<JournalRecord>
    const request = record.request
    if (
      record.version !== 1 ||
      !request ||
      typeof request.requestId !== 'string' ||
      typeof request.htmlRequestId !== 'string' ||
      !Array.isArray(request.spans) ||
      !Array.isArray(request.fetches)
    ) {
      return undefined
    }
    return request
  } catch {
    return undefined
  }
}

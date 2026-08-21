import { traceGlobals, traceId } from '../shared'
import fs from 'fs'
import path from 'path'
import { PHASE_DEVELOPMENT_SERVER } from '../../shared/lib/constants'
import type { TraceEvent } from '../types'
import type { Reporter } from './types'
import { RotatingWriteStream } from '../../server/lib/trace/rotating-write-stream'

// Batch events as zipkin allows for multiple events to be sent in one go
export function batcher(reportEvents: (evts: TraceEvent[]) => Promise<void>) {
  const events: TraceEvent[] = []
  // Promise queue to ensure events are always sent on flushAll
  const queue = new Set()
  return {
    flushAll: async () => {
      await Promise.all(queue)
      if (events.length > 0) {
        await reportEvents(events)
        events.length = 0
      }
    },
    report: (event: TraceEvent) => {
      events.push(event)

      if (events.length > 100) {
        const evts = events.slice()
        events.length = 0
        const report = reportEvents(evts)
        queue.add(report)
        report.then(() => queue.delete(report))
      }
    },
  }
}

export function createJsonReporter(options: {
  filename: string
  sizeLimit: number | ((phase: string) => number)
  filter?: (event: TraceEvent) => boolean
}): Reporter {
  let writeStream: RotatingWriteStream
  let batch: ReturnType<typeof batcher> | undefined

  function report(event: TraceEvent) {
    if (options.filter && !options.filter(event)) {
      return
    }

    const distDir = traceGlobals.get('distDir')
    const phase = traceGlobals.get('phase')
    if (!distDir || !phase) {
      return
    }

    if (!batch) {
      batch = batcher(async (events: TraceEvent[]) => {
        if (!writeStream) {
          await fs.promises.mkdir(distDir, { recursive: true })
          const file = path.join(distDir, options.filename)
          const limit =
            typeof options.sizeLimit === 'function'
              ? options.sizeLimit(phase)
              : options.sizeLimit
          writeStream = new RotatingWriteStream(
            file,
            limit,
            // In dev, append so traces accumulate across sessions. In
            // production, truncate so each build starts with a fresh file.
            phase === PHASE_DEVELOPMENT_SERVER ? 'a' : 'w'
          )
        }
        const eventsJson = JSON.stringify(events)
        try {
          await writeStream.write(eventsJson + '\n')
        } catch (err) {
          console.log(err)
        }
      })
    }

    batch.report({
      ...event,
      traceId,
    })
  }

  return {
    flushAll: (opts?: { end: boolean }) =>
      batch
        ? batch.flushAll().then(() => {
            const phase = traceGlobals.get('phase')
            // Only end writeStream when manually flushing in production
            if (opts?.end || phase !== PHASE_DEVELOPMENT_SERVER) {
              return writeStream.end()
            }
          })
        : undefined,
    report,
  }
}

export default createJsonReporter({
  filename: 'trace',
  sizeLimit: (phase) =>
    // Development is limited to 50MB, production is unlimited
    phase === PHASE_DEVELOPMENT_SERVER ? 52428800 : Infinity,
})

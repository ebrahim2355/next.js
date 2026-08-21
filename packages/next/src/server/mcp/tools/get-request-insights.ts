import type { McpServer } from 'next/dist/compiled/@modelcontextprotocol/sdk/server/mcp'
import z from 'next/dist/compiled/zod'
import type { RequestInsight } from '../../../next-devtools/shared/request-insights'
import {
  getRequestInsightsSnapshot,
  isRequestInsightsEnabled,
} from '../../lib/trace/request-insights'
import { readRequestInsightsJournal } from '../../lib/trace/request-insights-journal'
import { mcpTelemetryTracker } from '../mcp-telemetry-tracker'

const DEFAULT_REQUEST_LIMIT = 20

export function registerGetRequestInsightsTool(
  server: McpServer,
  distDir: string
) {
  server.registerTool(
    'get_request_insights',
    {
      description:
        'List recent Request Insights or inspect a request by ID, including completed requests that have left the in-memory window. Useful for debugging slow renders, server fetches, cache behavior, and request timelines without an external OTEL collector. Requires experimental.requestInsights.',
      inputSchema: {
        requestId: z.string().optional(),
        htmlRequestId: z.string().optional(),
      },
    },
    async (request) => {
      mcpTelemetryTracker.recordToolCall('mcp/get_request_insights')

      if (!isRequestInsightsEnabled()) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error:
                  'Request Insights is not enabled. Set experimental.requestInsights = true in next.config.js and restart next dev.',
              }),
            },
          ],
        }
      }

      const snapshot = getRequestInsightsSnapshot()
      const memoryRequests = snapshot.requests.filter((insight) => {
        return (
          (request.requestId === undefined ||
            insight.requestId === request.requestId) &&
          (request.htmlRequestId === undefined ||
            insight.htmlRequestId === request.htmlRequestId)
        )
      })

      if (
        request.requestId === undefined &&
        request.htmlRequestId === undefined
      ) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  requests: snapshot.requests
                    .slice(-DEFAULT_REQUEST_LIMIT)
                    .map(summarizeRequestInsight),
                  source: 'memory',
                  hint: 'Pass requestId for a full trace or htmlRequestId for related requests.',
                },
                null,
                2
              ),
            },
          ],
        }
      }

      const journalRequests = await readRequestInsightsJournal(distDir, {
        requestId: request.requestId,
        htmlRequestId: request.htmlRequestId,
      })
      const requestsByKey = new Map(
        journalRequests.map((insight) => [getRequestKey(insight), insight])
      )
      for (const insight of memoryRequests) {
        requestsByKey.set(getRequestKey(insight), insight)
      }
      const requests = Array.from(requestsByKey.values())

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                requests,
                source:
                  requests.length === 0
                    ? 'none'
                    : memoryRequests.length > 0 && journalRequests.length > 0
                      ? 'memory-and-journal'
                      : memoryRequests.length > 0
                        ? 'memory'
                        : 'journal',
              },
              null,
              2
            ),
          },
        ],
      }
    }
  )
}

function getRequestKey(request: Pick<RequestInsight, 'requestId' | 'kind'>) {
  return `${request.kind ?? 'request'}:${request.requestId}`
}

function summarizeRequestInsight(request: RequestInsight) {
  return {
    requestId: request.requestId,
    htmlRequestId: request.htmlRequestId,
    kind: request.kind ?? 'request',
    source: request.source,
    route: request.route,
    url: request.url,
    startTime: request.startTime,
    durationMs: request.durationMs,
    completedAt: request.completedAt,
    status: request.status,
    spanCount: request.spans.length,
    fetchCount: request.fetches.length,
  }
}

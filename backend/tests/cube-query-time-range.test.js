import test from 'node:test'
import assert from 'node:assert/strict'
import {
  anchorRelativeDateRangesToData,
  parseAnchorDate,
  parseRelativeLastDateRange,
} from '../src/cube-query-time-range.js'

test('parseRelativeLastDateRange parses supported relative ranges', () => {
  assert.deepEqual(parseRelativeLastDateRange('Last 7 days'), { amount: 7, unit: 'day' })
  assert.deepEqual(parseRelativeLastDateRange('last 24 hours'), { amount: 24, unit: 'hour' })
  assert.deepEqual(parseRelativeLastDateRange('Last 2 weeks'), { amount: 2, unit: 'week' })
  assert.equal(parseRelativeLastDateRange('Today'), null)
  assert.equal(parseRelativeLastDateRange('Last day'), null)
})

test('parseAnchorDate supports iso and unix-seconds text', () => {
  assert.equal(parseAnchorDate('2025-11-06T22:29:54.501Z')?.toISOString(), '2025-11-06T22:29:54.501Z')
  assert.equal(parseAnchorDate('1774264200.714841926')?.toISOString(), '2026-03-23T11:10:00.714Z')
})

test('anchorRelativeDateRangesToData rewrites relative dateRange using table anchor', async () => {
  const query = {
    measures: ['clmm_pool_snapshots.max_tvl_usd'],
    dimensions: [
      'clmm_pool_snapshots.pool_address',
      'clmm_pool_snapshots.dex_name',
    ],
    timeDimensions: [
      {
        dimension: 'clmm_pool_snapshots.snapshot_at',
        dateRange: 'Last 7 days',
      },
    ],
    order: {
      'clmm_pool_snapshots.max_tvl_usd': 'desc',
    },
    limit: 25,
  }

  const result = await anchorRelativeDateRangesToData(query, {
    resolveAnchorDate: async (dimension) => {
      if (dimension === 'clmm_pool_snapshots.snapshot_at') {
        return '2025-11-06T22:29:54.501Z'
      }
      return null
    },
  })

  assert.equal(result.anchors.length, 1)
  assert.equal(result.query.timeDimensions[0].dimension, 'clmm_pool_snapshots.snapshot_at')
  assert.deepEqual(result.query.timeDimensions[0].dateRange, [
    '2025-10-30T22:29:54.501Z',
    '2025-11-06T22:29:54.501Z',
  ])
  assert.equal(query.timeDimensions[0].dateRange, 'Last 7 days')
})

test('anchorRelativeDateRangesToData leaves non-relative ranges untouched', async () => {
  const query = {
    timeDimensions: [
      {
        dimension: 'clmm_pool_snapshots.snapshot_at',
        dateRange: ['2025-11-01', '2025-11-06'],
      },
    ],
  }

  const result = await anchorRelativeDateRangesToData(query, {
    resolveAnchorDate: async () => '2025-11-06T22:29:54.501Z',
  })

  assert.equal(result.anchors.length, 0)
  assert.equal(result.query, query)
})

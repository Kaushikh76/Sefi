const RELATIVE_LAST_RANGE_REGEX =
  /^last\s+(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)$/i

function normalizeUnit(rawUnit) {
  const normalized = String(rawUnit || '').trim().toLowerCase()
  if (!normalized) return ''
  return normalized.endsWith('s') ? normalized.slice(0, -1) : normalized
}

export function parseRelativeLastDateRange(dateRange) {
  if (typeof dateRange !== 'string') return null
  const match = dateRange.trim().match(RELATIVE_LAST_RANGE_REGEX)
  if (!match) return null

  const amount = Number.parseInt(match[1], 10)
  const unit = normalizeUnit(match[2])
  if (!Number.isFinite(amount) || amount <= 0 || !unit) return null

  return { amount, unit }
}

export function parseAnchorDate(value) {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000
    const date = new Date(ms)
    return Number.isFinite(date.getTime()) ? date : null
  }

  const text = String(value).trim()
  if (!text) return null

  if (/^\d+(\.\d+)?$/.test(text)) {
    const numeric = Number.parseFloat(text)
    if (Number.isFinite(numeric)) {
      const ms = numeric > 1e12 ? numeric : numeric * 1000
      const date = new Date(ms)
      if (Number.isFinite(date.getTime())) return date
    }
  }

  const parsedMs = Date.parse(text)
  if (!Number.isFinite(parsedMs)) return null
  const date = new Date(parsedMs)
  return Number.isFinite(date.getTime()) ? date : null
}

function subtractFromAnchor(anchorDate, amount, unit) {
  const start = new Date(anchorDate.getTime())
  switch (unit) {
    case 'minute':
      start.setUTCMinutes(start.getUTCMinutes() - amount)
      break
    case 'hour':
      start.setUTCHours(start.getUTCHours() - amount)
      break
    case 'day':
      start.setUTCDate(start.getUTCDate() - amount)
      break
    case 'week':
      start.setUTCDate(start.getUTCDate() - amount * 7)
      break
    case 'month':
      start.setUTCMonth(start.getUTCMonth() - amount)
      break
    case 'year':
      start.setUTCFullYear(start.getUTCFullYear() - amount)
      break
    default:
      return null
  }
  return start
}

function cloneQuery(query) {
  if (typeof structuredClone === 'function') {
    return structuredClone(query)
  }
  return JSON.parse(JSON.stringify(query))
}

export async function anchorRelativeDateRangesToData(query, options = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    return { query, anchors: [] }
  }

  const resolver = typeof options.resolveAnchorDate === 'function' ? options.resolveAnchorDate : null
  if (!resolver) {
    return { query, anchors: [] }
  }

  const originalTimeDimensions = Array.isArray(query.timeDimensions) ? query.timeDimensions : []
  if (originalTimeDimensions.length === 0) {
    return { query, anchors: [] }
  }

  const rewritten = cloneQuery(query)
  const rewrittenTimeDimensions = Array.isArray(rewritten.timeDimensions) ? rewritten.timeDimensions : []
  const anchorCache = new Map()
  const anchors = []

  for (let index = 0; index < rewrittenTimeDimensions.length; index += 1) {
    const timeDimension = rewrittenTimeDimensions[index]
    if (!timeDimension || typeof timeDimension !== 'object') continue

    const parsedRange = parseRelativeLastDateRange(timeDimension.dateRange)
    if (!parsedRange) continue

    const dimension = typeof timeDimension.dimension === 'string' ? timeDimension.dimension : ''
    if (!dimension) continue

    let anchorDate = anchorCache.get(dimension) || null
    if (!anchorCache.has(dimension)) {
      const rawAnchor = await resolver(dimension)
      anchorDate = parseAnchorDate(rawAnchor)
      anchorCache.set(dimension, anchorDate)
    }
    if (!anchorDate) continue

    const startDate = subtractFromAnchor(anchorDate, parsedRange.amount, parsedRange.unit)
    if (!startDate) continue

    const originalDateRange = timeDimension.dateRange
    timeDimension.dateRange = [startDate.toISOString(), anchorDate.toISOString()]
    anchors.push({
      dimension,
      original_date_range: originalDateRange,
      anchored_date_range: timeDimension.dateRange,
      anchor_at: anchorDate.toISOString(),
    })
  }

  if (anchors.length === 0) {
    return { query, anchors: [] }
  }

  return { query: rewritten, anchors }
}

/**
 * URL-smart target parser for Looker resources.
 *
 * Accepts Looker URLs, bare IDs, or prefixed references (tile:NNN)
 * and returns structured target objects.
 */

export interface ParsedTarget {
  type: 'dashboard' | 'lookml_dashboard' | 'tile' | 'explore' | 'look'
  id?: string
  model?: string
  explore?: string
  fields?: string[]
  filters?: Record<string, string>
  sorts?: string[]
}

export function parseTarget(input: string): ParsedTarget {
  const trimmed = input.trim()

  // tile:NNN or element:NNN
  const tileMatch = trimmed.match(/^(?:tile|element):(\d+)$/i)
  if (tileMatch) {
    return { type: 'tile', id: tileMatch[1] }
  }

  // Bare number → dashboard
  if (/^\d+$/.test(trimmed)) {
    return { type: 'dashboard', id: trimmed }
  }

  // model::dashboard_name → LookML dashboard (non-URL string with ::)
  if (/^[^/]+::[^/]+$/.test(trimmed)) {
    return { type: 'lookml_dashboard', id: trimmed }
  }

  // URL patterns
  try {
    const url = new URL(trimmed)

    // /dashboards/model::name (LookML dashboard URL — must check before numeric)
    const lookmlDashMatch = url.pathname.match(/\/dashboards\/([^/]+::[^/]+)/)
    if (lookmlDashMatch) {
      return { type: 'lookml_dashboard', id: decodeURIComponent(lookmlDashMatch[1]) }
    }

    // /dashboards/NNN
    const dashMatch = url.pathname.match(/\/dashboards\/(\d+)/)
    if (dashMatch) {
      return { type: 'dashboard', id: dashMatch[1] }
    }

    // /looks/NNN
    const lookMatch = url.pathname.match(/\/looks\/(\d+)/)
    if (lookMatch) {
      return { type: 'look', id: lookMatch[1] }
    }

    // /explore/model/explore_name?fields=...
    const exploreMatch = url.pathname.match(/\/explore\/([^/]+)\/([^/?]+)/)
    if (exploreMatch) {
      const result: ParsedTarget = {
        type: 'explore',
        model: exploreMatch[1],
        explore: exploreMatch[2],
      }

      const fieldsParam = url.searchParams.get('fields')
      if (fieldsParam) {
        result.fields = fieldsParam.split(',')
      }

      const sortsParam = url.searchParams.get('sorts')
      if (sortsParam) {
        result.sorts = sortsParam.split(',')
      }

      // Collect filter params (f[field]=value)
      const filters: Record<string, string> = {}
      for (const [key, value] of url.searchParams) {
        const filterMatch = key.match(/^f\[(.+)\]$/)
        if (filterMatch) {
          filters[filterMatch[1]] = value
        }
      }
      if (Object.keys(filters).length > 0) {
        result.filters = filters
      }

      return result
    }
  } catch {
    // Not a valid URL, fall through
  }

  throw new Error(`Cannot parse target: "${input}". Expected a URL, dashboard ID, tile:NNN, or model::dashboard_name`)
}

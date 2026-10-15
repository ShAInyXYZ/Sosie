import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../config.ts'

export type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>
export type Values = Record<string, string | number | boolean>

/** Load an API-format workflow from comfy/workflows/, without its _meta block. */
export function loadTemplate(name: string, dir = join(ROOT, 'comfy', 'workflows')): Graph {
  const raw = JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as Record<string, unknown>
  delete raw._meta
  return raw as Graph
}

/**
 * Replace every input whose value is exactly "$NAME" with values[NAME], keeping its type
 * (numbers stay numbers). Throws on a placeholder without a value, so a graph never reaches
 * ComfyUI half-filled.
 */
export function fill(graph: Graph, values: Values): Graph {
  const missing = new Set<string>()
  const out: Graph = {}
  for (const [id, node] of Object.entries(graph)) {
    const inputs: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node.inputs)) {
      if (typeof value === 'string' && value.startsWith('$')) {
        const name = value.slice(1)
        if (name in values) inputs[key] = values[name]
        else missing.add(name)
      } else {
        inputs[key] = value
      }
    }
    out[id] = { class_type: node.class_type, inputs }
  }
  if (missing.size) throw new Error(`Workflow values missing: ${[...missing].join(', ')}`)
  return out
}

/** Remove a node and every input that points at it (used for optional parts of a template). */
export function dropNode(graph: Graph, id: string): Graph {
  const out: Graph = {}
  for (const [key, node] of Object.entries(graph)) {
    if (key === id) continue
    const inputs = Object.fromEntries(
      Object.entries(node.inputs).filter(([, value]) => !(Array.isArray(value) && value[0] === id)),
    )
    out[key] = { class_type: node.class_type, inputs }
  }
  return out
}

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import { runRScript } from './run.js'
import type { RandomizedPlot } from '@shared/types.js'

// These tests exercise the real R sidecar, so they need Rscript + agricolae. Probe once and
// skip (rather than fail) when the engine isn't installed, keeping CI green without R.
const hasEngine = (() => {
  const r = spawnSync('Rscript', ['--vanilla', '-e', 'library(agricolae)'], { encoding: 'utf8' })
  return r.status === 0
})()

const alpha = (treatments: number, replicates: number, blockSize: number) =>
  runRScript<Record<string, unknown>, RandomizedPlot[]>('randomize.R', {
    design: 'ALPHA',
    treatments,
    replicates,
    blockSize,
    seed: 42
  })

describe.skipIf(!hasEngine)('randomize.R ALPHA (incomplete block) design', () => {
  it('returns a clean, resolvable layout with every treatment present', async () => {
    // Regression: design.alpha prints a summary to stdout that used to corrupt the JSON, and the
    // treatment column was read from the wrong (replication) column — every plot came out as trt 1.
    const res = await alpha(9, 3, 3)
    expect(res.ok).toBe(true)
    const plots = res.result!
    expect(plots).toHaveLength(27) // t * r

    // All 9 treatments appear (not all 1s), and each replicate is complete (resolvable design).
    const distinct = [...new Set(plots.map((p) => p.treatment))].sort((a, b) => a - b)
    expect(distinct).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    for (let rep = 1; rep <= 3; rep++) {
      const inRep = plots.filter((p) => p.rep === rep).map((p) => p.treatment).sort((a, b) => a - b)
      expect(inRep).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    }

    // Each incomplete block holds k=3 distinct treatments and blocks are globally unique.
    const blocks = new Map<number, number[]>()
    for (const p of plots) blocks.set(p.block, [...(blocks.get(p.block) ?? []), p.treatment])
    expect(blocks.size).toBe(9) // s * r = 3 * 3
    for (const trts of blocks.values()) expect(new Set(trts).size).toBe(3)
  })

  it('reports a clear error (not a raw R crash) for an unsupported block size', async () => {
    // Regression: k > sqrt(t) made design.alpha return a closure -> "object of type 'closure' is
    // not subsettable". It must now surface an actionable message instead.
    const res = await alpha(6, 4, 3) // s = 2 < k = 3
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/block size|alpha design/i)
    expect(res.error).not.toMatch(/closure|subsettable/i)
  })
})

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { runRScript } from './run.js'
import type { AovRequest, AovResult, RandomizedPlot } from '@shared/types.js'

// Exercises the real ANOVA sidecar; needs Rscript + agricolae. Skip (don't fail) when absent,
// mirroring randomize.test.ts.
const hasEngine =
  spawnSync('Rscript', ['--vanilla', '-e', 'library(agricolae)'], { encoding: 'utf8' }).status === 0

type Obs = AovRequest['data']
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

/** Balanced RCB data: 4 treatments × 4 reps. `sep` scales the treatment separation. */
function rcb(sep: number): Obs {
  const out: Obs = []
  for (let t = 1; t <= 4; t++)
    for (let rep = 1; rep <= 4; rep++) {
      const noise = (((t + rep) % 3) - 1) * 0.4 // small, non-zero residual
      out.push({ treatment: t, rep, block: rep, value: 100 + t * sep + (rep - 2.5) + noise })
    }
  return out
}

describe.skipIf(!hasEngine)('aov.R', () => {
  it('analyzes a balanced RCB: grand mean, groups, and a significant treatment effect', async () => {
    const data = rcb(10) // treatments clearly separated (10-unit steps)
    const res = await runRScript<AovRequest, AovResult>('aov.R', {
      design: 'RCB',
      test: 'LSD',
      alpha: 0.05,
      data
    })
    expect(res.ok).toBe(true)
    const r = res.result!
    expect(r.grandMean).toBeCloseTo(mean(data.map((d) => d.value)), 4)
    expect(r.means).toHaveLength(4)
    expect(r.means.map((m) => m.treatment)).toEqual([1, 2, 3, 4])
    expect(r.means.every((m) => typeof m.group === 'string' && m.group.length > 0)).toBe(true)
    expect(r.significant).toBe(true)
    const trt = r.anova.find((a) => a.source === 'treatment')
    expect(trt?.pValue).not.toBeNull()
    expect(trt!.pValue!).toBeLessThan(0.05)
    expect(Number.isFinite(r.cv)).toBe(true)
  })

  it('reports no significant effect when treatments barely differ', async () => {
    const res = await runRScript<AovRequest, AovResult>('aov.R', {
      design: 'RCB',
      test: 'LSD',
      alpha: 0.05,
      data: rcb(0) // all treatments share the same base
    })
    expect(res.ok).toBe(true)
    expect(res.result!.significant).toBe(false)
  })

  it('returns a friendly note instead of erroring on too-few observations', async () => {
    const res = await runRScript<AovRequest, AovResult>('aov.R', {
      design: 'RCB',
      test: 'LSD',
      alpha: 0.05,
      data: [{ treatment: 1, rep: 1, block: 1, value: 5 }]
    })
    expect(res.ok).toBe(true)
    expect(res.result!.note).toBeTruthy()
    expect(res.result!.means).toHaveLength(0)
  })

  it('returns a clear "no variation" note when every observation is identical', async () => {
    // Mirrors a calculated % control column when the source data are uniform: all values equal.
    const data: Obs = []
    for (let t = 1; t <= 4; t++)
      for (let rep = 1; rep <= 4; rep++) data.push({ treatment: t, rep, block: rep, value: 0 })
    const res = await runRScript<AovRequest, AovResult>('aov.R', {
      design: 'RCB',
      test: 'LSD',
      alpha: 0.05,
      data
    })
    expect(res.ok).toBe(true)
    expect(res.result!.means).toHaveLength(0)
    expect(res.result!.note).toMatch(/identical|no variation/i)
  })

  it('produces block-adjusted means (PBIB) for a valid alpha design', async () => {
    // Build a real resolvable alpha layout (t=9, k=3, r=3) via the randomizer, then attach a
    // clear treatment effect and confirm the block-adjusted analysis recovers it.
    const layout = await runRScript<Record<string, unknown>, RandomizedPlot[]>('randomize.R', {
      design: 'ALPHA',
      treatments: 9,
      replicates: 3,
      blockSize: 3,
      seed: 7
    })
    expect(layout.ok).toBe(true)
    const data: Obs = layout.result!.map((p) => ({
      treatment: p.treatment,
      rep: p.rep,
      block: p.block,
      value: 50 + p.treatment * 2 + ((p.order % 3) - 1) * 0.3
    }))

    const res = await runRScript<AovRequest, AovResult>('aov.R', {
      design: 'ALPHA',
      test: 'LSD',
      alpha: 0.05,
      blockSize: 3,
      data
    })
    expect(res.ok).toBe(true)
    const r = res.result!
    expect(r.means.length).toBe(9)
    expect(Number.isFinite(r.grandMean)).toBe(true)
    expect(r.significant).toBe(true)
  })
})

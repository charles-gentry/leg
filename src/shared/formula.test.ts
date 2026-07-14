import { describe, it, expect } from 'vitest'
import { parseFormula, evaluate, type EvalContext } from './formula.js'

/** Build an eval context from a per-column plot map and a per-column control map. */
function ctx(plot: Record<number, number | null>, control: Record<number, number | null> = {}): EvalContext {
  return {
    plot: (n) => (n in plot ? plot[n] : null),
    control: (n) => (n in control ? control[n] : null)
  }
}

function ev(src: string, c: EvalContext): number | null {
  const r = parseFormula(src)
  if (!r.ok) throw new Error(`parse failed: ${r.error}`)
  return evaluate(r.ast, c)
}

describe('formula parsing', () => {
  it('reports referenced columns', () => {
    const r = parseFormula('([1] + [3]) / control([2])')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.columns).toEqual([1, 2, 3])
  })

  it('rejects empty and malformed input', () => {
    expect(parseFormula('').ok).toBe(false)
    expect(parseFormula('[1] +').ok).toBe(false)
    expect(parseFormula('(1 + 2').ok).toBe(false)
    expect(parseFormula('foo([1])').ok).toBe(false)
    expect(parseFormula('[0]').ok).toBe(false)
    expect(parseFormula('abs([1], [2])').ok).toBe(false)
  })
})

describe('formula evaluation', () => {
  it('honours operator precedence and parentheses', () => {
    expect(ev('1 + 2 * 3', ctx({}))).toBe(7)
    expect(ev('(1 + 2) * 3', ctx({}))).toBe(9)
    expect(ev('2 ^ 3 ^ 2', ctx({}))).toBe(512) // right-associative
    expect(ev('-2 ^ 2', ctx({}))).toBe(-4) // unary binds looser than ^
  })

  it('resolves column references from the plot map', () => {
    expect(ev('([1] + [2]) / 2', ctx({ 1: 10, 2: 20 }))).toBe(15)
  })

  it('propagates null when any input is missing', () => {
    expect(ev('[1] + [2]', ctx({ 1: 10 }))).toBeNull()
    expect(ev('min([1], [2])', ctx({ 1: 5 }))).toBeNull()
  })

  it('returns null on divide-by-zero and sqrt of a negative', () => {
    expect(ev('[1] / [2]', ctx({ 1: 5, 2: 0 }))).toBeNull()
    expect(ev('sqrt([1])', ctx({ 1: -4 }))).toBeNull()
  })

  it('supports functions', () => {
    expect(ev('max([1], [2], [3])', ctx({ 1: 3, 2: 9, 3: 4 }))).toBe(9)
    expect(ev('round([1], 1)', ctx({ 1: 3.14159 }))).toBe(3.1)
    expect(ev('abs(0 - [1])', ctx({ 1: 7 }))).toBe(7)
  })

  it('computes % control via control() and abbott() identically', () => {
    const c = ctx({ 1: 20 }, { 1: 50 }) // plot value 20, untreated-check mean 50
    const manual = ev('100 * (control([1]) - [1]) / control([1])', c)
    const sugar = ev('abbott([1])', c)
    expect(manual).toBe(60)
    expect(sugar).toBe(60)
  })

  it('yields null when there is no untreated check', () => {
    expect(ev('abbott([1])', ctx({ 1: 20 }))).toBeNull()
  })
})

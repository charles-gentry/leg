import { describe, it, expect } from 'vitest'
import { timingLabel, addDays, assessmentDate } from './timing.js'

describe('timingLabel', () => {
  it('derives "N DA-<code>" for a positive offset', () => {
    expect(timingLabel({ applicationRef: 'A', daysAfter: 14, timing: '' })).toBe('14 DA-A')
  })
  it('uses DB for a negative offset and AT for zero', () => {
    expect(timingLabel({ applicationRef: 'B', daysAfter: -3, timing: '' })).toBe('3 DB-B')
    expect(timingLabel({ applicationRef: 'A', daysAfter: 0, timing: '' })).toBe('AT-A')
  })
  it('the free-text override wins when set', () => {
    expect(timingLabel({ applicationRef: 'A', daysAfter: 14, timing: 'pre-harvest' })).toBe('pre-harvest')
  })
  it('is empty when unanchored and no override', () => {
    expect(timingLabel({ applicationRef: '', daysAfter: null, timing: '' })).toBe('')
  })
})

describe('addDays', () => {
  it('adds days across month boundaries', () => {
    expect(addDays('2026-03-30', 5)).toBe('2026-04-04')
    expect(addDays('2026-03-05', -10)).toBe('2026-02-23')
  })
  it('returns "" for a missing/invalid base date', () => {
    expect(addDays('', 5)).toBe('')
    expect(addDays('not-a-date', 5)).toBe('')
  })
})

describe('assessmentDate', () => {
  const actuals = [
    { timingCode: 'A', actualDate: '2026-05-01' },
    { timingCode: 'B', actualDate: '2026-05-20' }
  ]
  it('derives the date from the anchored application actual + offset', () => {
    expect(assessmentDate({ applicationRef: 'A', daysAfter: 14 }, actuals)).toBe('2026-05-15')
    expect(assessmentDate({ applicationRef: 'B', daysAfter: 0 }, actuals)).toBe('2026-05-20')
  })
  it('is empty when unanchored or the application has no recorded date', () => {
    expect(assessmentDate({ applicationRef: '', daysAfter: null }, actuals)).toBe('')
    expect(assessmentDate({ applicationRef: 'C', daysAfter: 7 }, actuals)).toBe('')
  })
})

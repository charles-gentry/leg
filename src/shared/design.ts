import type { DesignType } from './types.js'

/**
 * Experimental-design conformance checks. The Incomplete Block (Alpha) design is only
 * available for specific treatment/block-size/replicate combinations (agricolae's
 * Patterson–Williams generator series). Validating here — the single source of truth
 * shared by the renderer (live authoring feedback) and the main process (the gate that
 * blocks a non-conformant protocol from becoming a trial) — prevents an author from
 * distributing a protocol that would fail when an operator generates the layout.
 *
 * The alpha rule below was verified against `agricolae::design.alpha` across 1,045
 * combinations (k=2..12, s=2..20, r=2..6) with zero mismatches; `alpha-conformance.test.ts`
 * re-checks it against agricolae to guard against upstream changes.
 */

export interface DesignValidation {
  ok: boolean
  /** Human-readable reason when `ok` is false. */
  error?: string
  /** For ALPHA: the replicate counts that *are* valid for this block size / treatment count. */
  validReplicates?: number[]
}

function gcd(a: number, b: number): number {
  while (b) {
    ;[a, b] = [b, a % b]
  }
  return a
}

/** Valid replicate counts (from {2,3,4}) for an alpha design with block size k and s blocks/rep. */
function alphaValidReplicates(k: number, s: number): number[] {
  const out: number[] = [2] // r=2 is always available once the structural checks pass
  if (s > k || (s === k && s % 2 === 1)) out.push(3)
  if (gcd(s, 6) === 1) out.push(4)
  return out
}

/**
 * Validate a protocol's experimental design against the given treatment count. Returns
 * `{ ok: true }` when the design can be randomized, otherwise an actionable message.
 */
export function validateDesign(
  design: DesignType,
  replicates: number,
  blockSize: number,
  treatmentCount: number
): DesignValidation {
  if (treatmentCount < 2) {
    return { ok: false, error: 'Add at least 2 treatments.' }
  }
  if (!Number.isInteger(replicates) || replicates < 2) {
    return { ok: false, error: 'Replicates must be a whole number of at least 2.' }
  }

  if (design !== 'ALPHA') return { ok: true }

  const k = blockSize
  const t = treatmentCount
  if (!Number.isInteger(k) || k < 3) {
    return {
      ok: false,
      error: 'Alpha designs need a block size (k) of at least 3 — agricolae has no generators for block size 2.'
    }
  }
  if (t % k !== 0) {
    return {
      ok: false,
      error: `Block size (${k}) must evenly divide the treatment count (${t}) for an alpha design.`
    }
  }
  const s = t / k // blocks per replicate
  if (s < k) {
    return {
      ok: false,
      error: `Block size (${k}) is too large: an alpha design needs at least ${k} blocks per replicate, so the block size can be at most √${t} ≈ ${Math.floor(Math.sqrt(t))}.`
    }
  }

  const validReplicates = alphaValidReplicates(k, s)
  if (!validReplicates.includes(replicates)) {
    const list =
      validReplicates.length === 1
        ? `${validReplicates[0]} replicates`
        : `${validReplicates.slice(0, -1).join(', ')} or ${validReplicates[validReplicates.length - 1]} replicates`
    return {
      ok: false,
      validReplicates,
      error: `No alpha design exists for ${t} treatments in blocks of ${k} with ${replicates} replicates. Supported: ${list}.`
    }
  }

  return { ok: true, validReplicates }
}

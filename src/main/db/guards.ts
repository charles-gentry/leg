import { getRole } from './connection.js'
import { getAssessmentHeader, getTrial } from './dao.js'
import type { Role } from '@shared/types.js'

/**
 * Role guards. A trial file embeds a locked copy of its protocol; the operator may
 * enter data and add their own assessment columns, but may not alter anything the
 * author defined. These throw so the error surfaces in the renderer via the IPC
 * wrapper. Applied in handlers (not the DAO) so tests can exercise the DAO directly.
 */

export function assertRole(expected: Role): void {
  if (getRole() !== expected) {
    throw new Error(
      expected === 'protocol'
        ? 'This document is a trial; the protocol is locked and cannot be edited.'
        : 'This action is only available on a trial file.'
    )
  }
}

/** Reject edits to protocol-owned entities (protocol/treatments/applications/defs). */
export function assertProtocolEditable(): void {
  assertRole('protocol')
}

/** Reject edits to a protocol-defined (core) assessment column in a trial file. */
export function assertHeaderEditable(headerId: number): void {
  if (getRole() !== 'trial') return
  const h = getAssessmentHeader(headerId)
  if (h?.origin === 'core' || h?.locked) {
    throw new Error('This assessment is defined by the protocol and cannot be changed.')
  }
}

/** Reject layout changes (regenerate/swap) once the layout is locked. */
export function assertLayoutUnlocked(): void {
  if (getTrial()?.layoutLockedAt) {
    throw new Error('The layout is locked and can no longer be changed.')
  }
}

/** Reject data entry / analysis / exclusion until the layout is locked. */
export function assertLayoutLocked(): void {
  if (!getTrial()?.layoutLockedAt) {
    throw new Error('Confirm and lock the layout before entering data.')
  }
}

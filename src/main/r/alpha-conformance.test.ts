import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { validateDesign } from '@shared/design.js'

// Guards the pure-TS alpha rule against agricolae's actual generator series. Needs Rscript +
// agricolae; skips (rather than fails) when the engine is absent, mirroring randomize.test.ts.
const hasEngine =
  spawnSync('Rscript', ['--vanilla', '-e', 'library(agricolae)'], { encoding: 'utf8' }).status === 0

// For each (k, s, r) print "k,s,r,ok". design.alpha prints a summary to stdout, so capture.output
// swallows it (see the r-sidecar-stdout gotcha) and we emit only our CSV lines.
const R_SCRIPT = `
suppressWarnings(suppressMessages(library(agricolae)))
out <- c()
for (k in 3:8) for (s in k:12) for (r in 2:5) {
  t <- s * k
  d <- tryCatch({ invisible(capture.output(x <- design.alpha(1:t, k = k, r = r, seed = 1, serie = 0))); x },
                error = function(e) NULL)
  ok <- is.list(d) && !is.null(d$book)
  out <- c(out, sprintf('%d,%d,%d,%d', k, s, r, as.integer(ok)))
}
cat(paste(out, collapse = '\\n'))
`

describe.skipIf(!hasEngine)('alpha rule matches agricolae', () => {
  it('agrees with design.alpha on every (k, s, r) in the matrix', () => {
    const res = spawnSync('Rscript', ['--vanilla', '-e', R_SCRIPT], {
      encoding: 'utf8',
      maxBuffer: 1 << 24
    })
    const lines = res.stdout.trim().split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThan(50)

    const mismatches: string[] = []
    for (const line of lines) {
      const [k, s, r, ok] = line.split(',').map(Number)
      const actual = ok === 1
      const predicted = validateDesign('ALPHA', r, k, k * s).ok
      if (actual !== predicted) mismatches.push(`k=${k} s=${s} r=${r} agricolae=${actual} rule=${predicted}`)
    }
    expect(mismatches).toEqual([])
  })
})

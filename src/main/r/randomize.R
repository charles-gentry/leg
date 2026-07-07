#!/usr/bin/env Rscript
# Randomization sidecar for ART.
# Reads JSON { design, treatments, replicates, blockSize, seed } on stdin.
# Writes JSON { ok, result: [ { order, rep, block, treatment } ] } on stdout.
# `treatment` is the 1-based treatment number; `rep` is the 1-based replicate;
# `block` is the incomplete block within the rep (ALPHA) and equals `rep` otherwise.
# `blockSize` (k) is required only by the ALPHA design.

suppressWarnings(suppressMessages({
  library(jsonlite)
  library(agricolae)
}))

emit <- function(x) cat(toJSON(x, auto_unbox = TRUE, na = "null"))

tryCatch({
  req <- fromJSON(readLines(file("stdin"), warn = FALSE))
  design      <- req$design
  treatments  <- as.integer(req$treatments)
  replicates  <- as.integer(req$replicates)
  blockSize   <- if (is.null(req$blockSize)) NA_integer_ else as.integer(req$blockSize)
  seed        <- as.integer(req$seed)

  trt <- seq_len(treatments)

  if (identical(design, "RCB")) {
    d      <- design.rcbd(trt, r = replicates, seed = seed, serie = 0)
    book   <- d$book
    reps   <- as.integer(as.character(book$block))
    blocks <- reps # complete blocks: the block is the replicate
    # Treatment column is the last column of the book for RCB/CRD.
    trtCol <- as.integer(as.character(book[[ncol(book)]]))
  } else if (identical(design, "CRD")) {
    d      <- design.crd(trt, r = replicates, seed = seed, serie = 0)
    book   <- d$book
    reps   <- as.integer(as.character(book$r))
    blocks <- reps # no blocking; keep block = rep for a uniform shape
    trtCol <- as.integer(as.character(book[[ncol(book)]]))
  } else if (identical(design, "ALPHA")) {
    if (is.na(blockSize)) stop("Alpha design requires a block size (k).")
    # Resolvable incomplete block (alpha) design: r replicates, each split into
    # s = treatments / k incomplete blocks of size k.
    s <- treatments %/% blockSize
    if (treatments %% blockSize != 0 || blockSize >= treatments || s < blockSize) {
      stop(sprintf(
        "An alpha design needs the block size (k=%d) to evenly divide the treatment count (%d) with at least k blocks per replicate (so k must be <= sqrt(%d)). Try a smaller block size.",
        blockSize, treatments, treatments))
    }
    # design.alpha prints its design summary to stdout (which would corrupt our JSON) and,
    # for block/replicate combinations outside the Patterson-Williams generator series,
    # returns the function itself instead of a design list. Swallow the print and validate.
    invisible(capture.output(
      d <- tryCatch(design.alpha(trt, k = blockSize, r = replicates, seed = seed, serie = 0),
                    error = function(e) NULL)
    ))
    if (!is.list(d) || is.null(d$book)) {
      stop(sprintf(
        "agricolae has no alpha design for %d treatments in blocks of %d with %d replicates. Alpha designs exist only for certain block/replicate combinations (2 replicates work for most; 3+ are limited). Try 2 replicates or a different block size.",
        treatments, blockSize, replicates))
    }
    book   <- d$book
    reps   <- as.integer(as.character(book$replication))
    blocks <- as.integer(as.character(book$block))
    # Alpha books order columns as plots | cols | block | <treatment> | replication, so the
    # treatment column is the non-structural one (not the last, which is replication).
    trtName <- setdiff(names(book), c("plots", "cols", "block", "replication"))[1]
    trtCol  <- as.integer(as.character(book[[trtName]]))
  } else {
    stop(paste("Unknown design:", design))
  }

  result <- data.frame(
    order     = seq_len(nrow(book)),
    rep       = reps,
    block     = blocks,
    treatment = trtCol
  )

  emit(list(ok = TRUE, result = result))
}, error = function(e) {
  emit(list(ok = FALSE, error = conditionMessage(e)))
})

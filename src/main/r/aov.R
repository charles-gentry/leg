#!/usr/bin/env Rscript
# ANOVA + mean-comparison sidecar for ART.
# Reads JSON { design, test, alpha, data:[{treatment,rep,value}] } on stdin.
# Writes JSON { ok, result } where result matches the AovResult shape in
# src/shared/types.ts. Degenerate designs (too few treatments, no residual
# degrees of freedom, unbalanced data) return ok=TRUE with a `note` instead of
# erroring, so the app can show a friendly message rather than a crash.

suppressWarnings(suppressMessages({
  library(jsonlite)
  library(agricolae)
}))

emit <- function(x) cat(toJSON(x, auto_unbox = TRUE, na = "null", digits = 10))

tryCatch({
  req   <- fromJSON(readLines(file("stdin"), warn = FALSE))
  design <- req$design
  test   <- req$test
  alpha  <- as.numeric(req$alpha)
  df     <- as.data.frame(req$data)

  df$treatment <- droplevels(factor(df$treatment))
  df$rep       <- droplevels(factor(df$rep))
  df$value     <- as.numeric(df$value)

  # Emit a non-fatal "insufficient data" result (means omitted, numeric summaries blank).
  emitInsufficient <- function(msg, rows = list()) {
    emit(list(ok = TRUE, result = list(
      anova              = rows,
      means              = list(),
      grandMean          = mean(df$value, na.rm = TRUE),
      cv                 = NA,
      lsd                = NA,
      criticalValueLabel = paste0(test, " (", alpha, ")"),
      stdError           = NA,
      test               = test,
      alpha              = alpha,
      significant        = FALSE,
      note               = msg
    )))
  }

  nTrt <- nlevels(df$treatment)
  nRep <- nlevels(df$rep)

  if (identical(design, "ALPHA")) {
    # --- Resolvable incomplete block (alpha) design: block-adjusted analysis. ---
    blockSize <- if (is.null(req$blockSize)) NA_integer_ else as.integer(req$blockSize)
    df$block  <- droplevels(factor(df$block))
    testCode  <- if (identical(test, "TUKEY")) "tukey" else "lsd" # Duncan/SNK -> LSD (UI notes it)

    if (nrow(df) < 3 || nTrt < 2 || nlevels(df$block) < 2 || is.na(blockSize)) {
      emitInsufficient("Not enough data to analyze — an incomplete-block design needs at least two treatments across replicated incomplete blocks.")
    } else {
      # REML needs nlme; fall back to the variance-components fit if it isn't available.
      # PBIB.test prints a "<<< to see the objects... >>>" trailer to stdout even with
      # console = FALSE, which would corrupt our JSON — capture.output swallows it.
      runPbib <- function(m) tryCatch({
        res <- NULL
        invisible(capture.output(
          res <- PBIB.test(df$block, df$treatment, df$rep, df$value, k = blockSize,
                           method = m, test = testCode, alpha = alpha, group = TRUE, console = FALSE)
        ))
        res
      }, error = function(e) NULL)
      pbib <- runPbib("REML"); if (is.null(pbib)) pbib <- runPbib("VC")

      if (is.null(pbib)) {
        emitInsufficient("The incomplete-block analysis could not be computed for this dataset (likely unbalanced or under-replicated).")
      } else {
        # First present column among candidates (PBIB output shape varies by method).
        pick <- function(dfr, names) {
          hit <- intersect(names, colnames(dfr))
          if (length(hit) >= 1) dfr[[hit[1]]] else rep(NA, nrow(dfr))
        }

        # ANOVA rows: a REML fit has no SS/MS, so those stay NA (renderer blanks them).
        atab <- tryCatch(as.data.frame(pbib$ANOVA), error = function(e) NULL)
        anovaRows <- if (is.null(atab)) list() else lapply(seq_len(nrow(atab)), function(i) {
          list(
            source = rownames(atab)[i],
            df     = pick(atab, c("Df", "numDF"))[i],
            ss     = pick(atab, c("Sum Sq"))[i],
            ms     = pick(atab, c("Mean Sq"))[i],
            f      = pick(atab, c("F value", "F-value", "F.value"))[i],
            pValue = pick(atab, c("Pr(>F)", "p-value", "p.value"))[i]
          )
        })

        stats <- tryCatch(as.data.frame(pbib$statistics), error = function(e) NULL)
        grandMean <- if (!is.null(stats) && "Mean" %in% colnames(stats)) stats$Mean[1] else mean(df$value)
        cv        <- if (!is.null(stats) && "CV"   %in% colnames(stats)) stats$CV[1]   else NA

        # Adjusted treatment means + separation letters from $groups (fallback $means).
        groups <- tryCatch(as.data.frame(pbib$groups), error = function(e) NULL)
        means  <- tryCatch(as.data.frame(pbib$means),  error = function(e) NULL)
        grpLetters <- if (!is.null(groups) && "groups" %in% colnames(groups))
          setNames(as.character(groups$groups), rownames(groups)) else character(0)
        meanCol <- if (!is.null(groups)) {
          nonGrp <- colnames(groups)[colnames(groups) != "groups"]; if (length(nonGrp)) nonGrp[1] else NA
        } else NA
        labels <- if (!is.null(groups)) rownames(groups)
                  else if (!is.null(means)) rownames(means) else character(0)

        meanRows <- lapply(labels, function(t) {
          adj <- if (!is.null(groups) && !is.na(meanCol)) groups[t, meanCol]
                 else if (!is.null(means)) means[t, 1] else NA
          list(
            treatment = as.integer(as.character(t)),
            mean      = as.numeric(adj),
            n         = if (!is.null(means) && "r"   %in% colnames(means)) means[t, "r"]   else NA,
            std       = if (!is.null(means) && "std" %in% colnames(means)) means[t, "std"] else NA,
            group     = if (length(grpLetters) && !is.na(grpLetters[t])) grpLetters[[t]] else ""
          )
        })
        meanRows <- if (length(meanRows))
          meanRows[order(sapply(meanRows, function(m) m$treatment))] else list()

        # Treatment-effect significance from $Fstat, else the ANOVA treatment row.
        trtP <- NA
        fs <- tryCatch(as.data.frame(pbib$Fstat), error = function(e) NULL)
        if (!is.null(fs)) {
          pcol <- intersect(c("p.value", "p-value", "Pr(>F)"), colnames(fs))
          if (length(pcol)) trtP <- fs[[pcol[1]]][1]
        }
        if (is.na(trtP)) {
          idx <- which(sapply(anovaRows, function(r) grepl("trt|treat", r$source, ignore.case = TRUE)))
          if (length(idx) >= 1) trtP <- anovaRows[[idx[1]]]$pValue
        }
        significant <- !is.na(trtP) && trtP < alpha

        emit(list(ok = TRUE, result = list(
          anova              = anovaRows,
          means              = meanRows,
          grandMean          = grandMean,
          cv                 = cv,
          lsd                = NA,
          criticalValueLabel = paste0("LSD (", alpha, ")"),
          stdError           = NA,
          test               = test,
          alpha              = alpha,
          significant        = significant
        )))
      }
    }
  } else {

  # Guard the degenerate designs that make aov()/agricolae error, before building the model.
  model <- if (nrow(df) < 3 || nTrt < 2) {
    NULL
  } else {
    tryCatch(
      if (identical(design, "RCB")) aov(value ~ treatment + rep, data = df)
      else aov(value ~ treatment, data = df),
      error = function(e) NULL
    )
  }

  if (is.null(model)) {
    emitInsufficient("Not enough data to analyze — need at least two treatments with replicated observations.")
  } else {

  # ANOVA table (guarded: a degenerate design can yield NA rows but shouldn't error).
  atab <- tryCatch(as.data.frame(anova(model)), error = function(e) NULL)
  anovaRows <- if (is.null(atab)) list() else lapply(seq_len(nrow(atab)), function(i) {
    list(
      source  = rownames(atab)[i],
      df      = atab[i, "Df"],
      ss      = atab[i, "Sum Sq"],
      ms      = atab[i, "Mean Sq"],
      f       = if ("F value" %in% colnames(atab)) atab[i, "F value"] else NA,
      pValue  = if ("Pr(>F)" %in% colnames(atab)) atab[i, "Pr(>F)"] else NA
    )
  })

  dfError <- tryCatch(df.residual(model), error = function(e) NA)
  respSd <- tryCatch(sd(df$value), error = function(e) NA)

  if (!is.finite(dfError) || dfError < 1) {
    emitInsufficient("No residual degrees of freedom — the data isn't replicated enough for ANOVA (check for missing or excluded plots making the design unbalanced).", anovaRows)
  } else if (!is.finite(respSd) || respSd < 1e-9) {
    # Every observation is identical — no variability to partition, and the mean comparison would
    # divide by a zero spread (a % control column reads 0 for every plot when the source data are
    # uniform). This is a data issue, not a design one.
    emitInsufficient("All observations are identical — there's no variation between plots to compare. (A calculated % control column reads 0 everywhere when its source measurements are uniform.) Enter data that varies to run the mean comparison.", anovaRows)
  } else {
    # Mean comparison via agricolae. Model form auto-extracts DFerror/MSerror.
    cmp <- tryCatch(switch(test,
      LSD    = LSD.test(model, "treatment", alpha = alpha, group = TRUE, console = FALSE),
      TUKEY  = HSD.test(model, "treatment", alpha = alpha, group = TRUE, console = FALSE),
      DUNCAN = duncan.test(model, "treatment", alpha = alpha, group = TRUE, console = FALSE),
      SNK    = SNK.test(model, "treatment", alpha = alpha, group = TRUE, console = FALSE),
      stop(paste("Unknown test:", test))
    ), error = function(e) NULL)

    if (is.null(cmp)) {
      emitInsufficient("Mean comparison could not be computed for this dataset (likely an unbalanced or under-replicated design).")
    } else {
      stats <- cmp$statistics
      cv        <- if ("CV" %in% colnames(stats)) stats$CV[1] else NA
      grandMean <- if ("Mean" %in% colnames(stats)) stats$Mean[1] else mean(df$value)
      mserror   <- if ("MSerror" %in% colnames(stats)) stats$MSerror[1] else NA

      # Critical value + label differ by test.
      crit <- NA; critLabel <- paste0(test, " (", alpha, ")")
      if (test == "LSD" && "LSD" %in% colnames(stats)) { crit <- stats$LSD[1]; critLabel <- paste0("LSD (", alpha, ")") }
      if (test == "TUKEY" && "MSD" %in% colnames(stats)) { crit <- stats$MSD[1]; critLabel <- paste0("HSD (", alpha, ")") }

      # Per-treatment means, std, n from cmp$means; letters from cmp$groups.
      means  <- cmp$means
      groups <- cmp$groups
      # groups rownames are treatment labels; first column is the mean, "groups" is letters.
      grpLetters <- setNames(as.character(groups$groups), rownames(groups))

      meanRows <- lapply(rownames(means), function(t) {
        list(
          treatment = as.integer(as.character(t)),
          mean      = means[t, 1],
          n         = if ("r" %in% colnames(means)) means[t, "r"] else NA,
          std       = if ("std" %in% colnames(means)) means[t, "std"] else NA,
          group     = if (!is.na(grpLetters[t])) grpLetters[[t]] else ""
        )
      })
      # Order by treatment number ascending for stable display.
      meanRows <- meanRows[order(sapply(meanRows, function(m) m$treatment))]

      rMean   <- if ("r" %in% colnames(means)) mean(means[["r"]]) else NA
      stdError <- if (!is.na(mserror) && !is.na(rMean)) sqrt(mserror / rMean) else NA

      # Treatment effect significance from the ANOVA treatment row.
      trtIdx <- which(sapply(anovaRows, function(r) r$source == "treatment"))
      trtP   <- if (length(trtIdx) == 1) anovaRows[[trtIdx]]$pValue else NA
      significant <- !is.na(trtP) && trtP < alpha

      result <- list(
        anova              = anovaRows,
        means              = meanRows,
        grandMean          = grandMean,
        cv                 = cv,
        lsd                = crit,
        criticalValueLabel = critLabel,
        stdError           = stdError,
        test               = test,
        alpha              = alpha,
        significant        = significant
      )

      emit(list(ok = TRUE, result = result))
    }
  }
  }
  }
}, error = function(e) {
  emit(list(ok = FALSE, error = conditionMessage(e)))
})

/**
 * A small, safe formula language for calculated measurements. Formulas reference other measurements
 * by 1-based **column number** (ARM-style) written `[n]`, and support arithmetic plus a few
 * functions, including `control([n])` / `abbott([n])` for "% of untreated control".
 *
 * No `eval`: the source is tokenized, parsed to an AST, and evaluated against host-supplied resolvers
 * (`plot(n)` = this plot's value of column n; `control(n)` = the untreated-check mean of column n).
 * Any missing input evaluates to `null`, which propagates through the whole expression.
 */

export type Ast =
  | { kind: 'num'; value: number }
  | { kind: 'col'; col: number }
  | { kind: 'unary'; op: '-'; arg: Ast }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: Ast; right: Ast }
  | { kind: 'call'; name: FnName; args: Ast[] }
  | { kind: 'control'; col: number }

export type FnName = 'min' | 'max' | 'abs' | 'round' | 'sqrt'
const FN_ARITY: Record<FnName, [number, number]> = {
  min: [2, Infinity],
  max: [2, Infinity],
  abs: [1, 1],
  round: [1, 2],
  sqrt: [1, 1]
}

export interface ParseOk {
  ok: true
  ast: Ast
  /** Distinct column numbers the formula references (via `[n]` or `control([n])`). */
  columns: number[]
}
export interface ParseErr {
  ok: false
  error: string
}
export type ParseResult = ParseOk | ParseErr

/** Resolvers the host supplies at evaluation time. Return `null` for a missing/unknown value. */
export interface EvalContext {
  /** This plot's value for 1-based column `n`. */
  plot: (n: number) => number | null
  /** Untreated-check mean for 1-based column `n`. */
  control: (n: number) => number | null
}

// --- Tokenizer -------------------------------------------------------------

type Tok =
  | { t: 'num'; v: number }
  | { t: 'col'; v: number }
  | { t: 'op'; v: string }
  | { t: 'lparen' }
  | { t: 'rparen' }
  | { t: 'comma' }
  | { t: 'ident'; v: string }

function tokenize(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  const isDigit = (c: string): boolean => c >= '0' && c <= '9'
  const isAlpha = (c: string): boolean => /[a-zA-Z_]/.test(c)
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
      continue
    }
    if (c === '[') {
      let j = i + 1
      let digits = ''
      while (j < src.length && isDigit(src[j])) digits += src[j++]
      if (src[j] !== ']' || digits === '') throw new Error(`Bad column reference near "${src.slice(i, i + 4)}"`)
      toks.push({ t: 'col', v: Number(digits) })
      i = j + 1
      continue
    }
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      let num = ''
      while (i < src.length && (isDigit(src[i]) || src[i] === '.')) num += src[i++]
      if ((num.match(/\./g) ?? []).length > 1) throw new Error(`Bad number "${num}"`)
      toks.push({ t: 'num', v: Number(num) })
      continue
    }
    if (isAlpha(c)) {
      let id = ''
      while (i < src.length && (isAlpha(src[i]) || isDigit(src[i]))) id += src[i++]
      toks.push({ t: 'ident', v: id })
      continue
    }
    if ('+-*/^'.includes(c)) {
      toks.push({ t: 'op', v: c })
      i++
      continue
    }
    if (c === '(') {
      toks.push({ t: 'lparen' })
      i++
      continue
    }
    if (c === ')') {
      toks.push({ t: 'rparen' })
      i++
      continue
    }
    if (c === ',') {
      toks.push({ t: 'comma' })
      i++
      continue
    }
    throw new Error(`Unexpected character "${c}"`)
  }
  return toks
}

// --- Parser (recursive descent, standard precedence) -----------------------

class Parser {
  private pos = 0
  constructor(private toks: Tok[]) {}

  private peek(): Tok | undefined {
    return this.toks[this.pos]
  }
  private next(): Tok | undefined {
    return this.toks[this.pos++]
  }

  parse(): Ast {
    const node = this.expr()
    if (this.pos !== this.toks.length) throw new Error('Unexpected trailing input')
    return node
  }

  // expr := term (('+'|'-') term)*
  private expr(): Ast {
    let left = this.term()
    let tk = this.peek()
    while (tk && tk.t === 'op' && (tk.v === '+' || tk.v === '-')) {
      this.next()
      const right = this.term()
      left = { kind: 'binary', op: tk.v, left, right }
      tk = this.peek()
    }
    return left
  }

  // term := unary (('*'|'/') unary)*
  private term(): Ast {
    let left = this.unary()
    let tk = this.peek()
    while (tk && tk.t === 'op' && (tk.v === '*' || tk.v === '/')) {
      this.next()
      const right = this.unary()
      left = { kind: 'binary', op: tk.v, left, right }
      tk = this.peek()
    }
    return left
  }

  // unary := ('-'|'+') unary | power   (looser than ^, so -2^2 = -(2^2))
  private unary(): Ast {
    const tk = this.peek()
    if (tk && tk.t === 'op' && tk.v === '-') {
      this.next()
      return { kind: 'unary', op: '-', arg: this.unary() }
    }
    if (tk && tk.t === 'op' && tk.v === '+') {
      this.next()
      return this.unary()
    }
    return this.power()
  }

  // power := primary ('^' unary)?   (right-associative; allows 2^-1)
  private power(): Ast {
    const base = this.primary()
    const tk = this.peek()
    if (tk && tk.t === 'op' && tk.v === '^') {
      this.next()
      return { kind: 'binary', op: '^', left: base, right: this.unary() }
    }
    return base
  }

  private primary(): Ast {
    const tk = this.next()
    if (!tk) throw new Error('Unexpected end of formula')
    if (tk.t === 'num') return { kind: 'num', value: tk.v }
    if (tk.t === 'col') return { kind: 'col', col: tk.v }
    if (tk.t === 'lparen') {
      const inner = this.expr()
      if (this.next()?.t !== 'rparen') throw new Error('Missing ")"')
      return inner
    }
    if (tk.t === 'ident') {
      if (this.peek()?.t !== 'lparen') throw new Error(`"${tk.v}" must be called with (…)`)
      this.next() // consume '('
      const args = this.argList()
      const name = tk.v.toLowerCase()
      if (name === 'control' || name === 'ctrl') {
        if (args.length !== 1 || args[0].kind !== 'col')
          throw new Error('control(...) takes a single column reference, e.g. control([1])')
        return { kind: 'control', col: args[0].col }
      }
      if (name === 'abbott') {
        if (args.length !== 1 || args[0].kind !== 'col')
          throw new Error('abbott(...) takes a single column reference, e.g. abbott([1])')
        // 100 * (control([n]) - [n]) / control([n])
        const c: Ast = { kind: 'control', col: args[0].col }
        const p: Ast = { kind: 'col', col: args[0].col }
        return {
          kind: 'binary',
          op: '/',
          left: {
            kind: 'binary',
            op: '*',
            left: { kind: 'num', value: 100 },
            right: { kind: 'binary', op: '-', left: c, right: p }
          },
          right: c
        }
      }
      if (!(name in FN_ARITY)) throw new Error(`Unknown function "${tk.v}"`)
      const fn = name as FnName
      const [lo, hi] = FN_ARITY[fn]
      if (args.length < lo || args.length > hi)
        throw new Error(`${fn}() expects ${lo === hi ? lo : `${lo}–${hi}`} argument(s)`)
      return { kind: 'call', name: fn, args }
    }
    throw new Error('Unexpected token')
  }

  private argList(): Ast[] {
    const args: Ast[] = []
    if (this.peek()?.t === 'rparen') {
      this.next()
      return args
    }
    for (;;) {
      args.push(this.expr())
      const tk = this.next()
      if (tk?.t === 'rparen') break
      if (tk?.t !== 'comma') throw new Error('Expected "," or ")"')
    }
    return args
  }
}

function collectColumns(ast: Ast, into: Set<number>): void {
  switch (ast.kind) {
    case 'col':
    case 'control':
      into.add(ast.col)
      break
    case 'unary':
      collectColumns(ast.arg, into)
      break
    case 'binary':
      collectColumns(ast.left, into)
      collectColumns(ast.right, into)
      break
    case 'call':
      ast.args.forEach((a) => collectColumns(a, into))
      break
  }
}

/** Parse a formula. On success returns the AST + the set of referenced column numbers. */
export function parseFormula(src: string): ParseResult {
  const trimmed = src.trim()
  if (!trimmed) return { ok: false, error: 'Formula is empty' }
  try {
    const ast = new Parser(tokenize(trimmed)).parse()
    const cols = new Set<number>()
    collectColumns(ast, cols)
    for (const c of cols) if (c < 1) return { ok: false, error: `Column [${c}] is out of range` }
    return { ok: true, ast, columns: [...cols].sort((a, b) => a - b) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Evaluate a parsed AST. Returns `null` if any referenced input is missing (propagates). */
export function evaluate(ast: Ast, ctx: EvalContext): number | null {
  const ev = (n: Ast): number | null => {
    switch (n.kind) {
      case 'num':
        return n.value
      case 'col':
        return ctx.plot(n.col)
      case 'control':
        return ctx.control(n.col)
      case 'unary': {
        const v = ev(n.arg)
        return v === null ? null : -v
      }
      case 'binary': {
        const l = ev(n.left)
        const r = ev(n.right)
        if (l === null || r === null) return null
        switch (n.op) {
          case '+':
            return l + r
          case '-':
            return l - r
          case '*':
            return l * r
          case '/':
            return r === 0 ? null : l / r
          case '^':
            return l ** r
        }
        return null
      }
      case 'call': {
        const vals = n.args.map(ev)
        if (vals.some((v) => v === null)) return null
        const nums = vals as number[]
        switch (n.name) {
          case 'min':
            return Math.min(...nums)
          case 'max':
            return Math.max(...nums)
          case 'abs':
            return Math.abs(nums[0])
          case 'sqrt':
            return nums[0] < 0 ? null : Math.sqrt(nums[0])
          case 'round': {
            const dp = nums[1] ?? 0
            const f = 10 ** dp
            return Math.round(nums[0] * f) / f
          }
        }
        return null
      }
    }
  }
  const result = ev(ast)
  return result === null || Number.isFinite(result) ? result : null
}

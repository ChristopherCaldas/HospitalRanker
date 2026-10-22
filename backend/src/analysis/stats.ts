// Small, dependency-free statistics for the expected-performance model.
// Matrices are tiny (a handful of predictors), so plain normal equations with
// partial pivoting are accurate enough and easy to verify in tests.

// Solves A x = b (A square) by Gaussian elimination with partial pivoting.
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let pivot = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r
    if (Math.abs(M[pivot][c]) < 1e-12) throw new Error('singular matrix')
    ;[M[c], M[pivot]] = [M[pivot], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

// Weighted least squares: minimizes sum w_i (y_i - x_i . beta)^2. A tiny ridge
// on the non-intercept terms keeps rarely-populated dummies (e.g. a hospital
// type with no members in one measure) from making the system singular.
export function wls(X: number[][], y: number[], w: number[], ridge = 1e-8): number[] {
  const p = X[0].length
  const A = Array.from({ length: p }, () => new Array<number>(p).fill(0))
  const b = new Array<number>(p).fill(0)
  for (let i = 0; i < X.length; i++) {
    const x = X[i]
    for (let j = 0; j < p; j++) {
      b[j] += w[i] * x[j] * y[i]
      for (let k = 0; k < p; k++) A[j][k] += w[i] * x[j] * x[k]
    }
  }
  for (let j = 1; j < p; j++) A[j][j] += ridge
  return solve(A, b)
}

export const predict = (x: number[], beta: number[]) => x.reduce((acc, v, j) => acc + v * beta[j], 0)

// WLS with coefficient standard errors: Cov(beta) = s^2 (X'WX)^-1, where s^2
// is the weighted residual variance (so weights only need to be relative).
export function wlsWithSe(X: number[][], y: number[], w: number[]): { beta: number[]; se: number[] } {
  const p = X[0].length
  const beta = wls(X, y, w)
  const A = Array.from({ length: p }, () => new Array<number>(p).fill(0))
  let sse = 0
  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < p; j++) for (let k = 0; k < p; k++) A[j][k] += w[i] * X[i][j] * X[i][k]
    sse += w[i] * (y[i] - predict(X[i], beta)) ** 2
  }
  for (let j = 1; j < p; j++) A[j][j] += 1e-8
  const s2 = sse / Math.max(1, X.length - p)
  const se = Array.from({ length: p }, (_, j) => {
    const unit = new Array<number>(p).fill(0)
    unit[j] = 1
    return Math.sqrt(s2 * solve(A, unit)[j])
  })
  return { beta, se }
}

// Spearman rank correlation (average ranks for ties).
export function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]) => {
    const order = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0])
    const r = new Array<number>(xs.length)
    for (let i = 0; i < order.length; ) {
      let j = i
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++
      for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2 + 1
      i = j + 1
    }
    return r
  }
  return pearson(rank(a), rank(b))
}

export function pearson(a: number[], b: number[]): number {
  const ma = a.reduce((s, v) => s + v, 0) / a.length
  const mb = b.reduce((s, v) => s + v, 0) / b.length
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < a.length; i++) {
    sab += (a[i] - ma) * (b[i] - mb)
    saa += (a[i] - ma) ** 2
    sbb += (b[i] - mb) ** 2
  }
  return saa === 0 || sbb === 0 ? 0 : sab / Math.sqrt(saa * sbb)
}

// Weighted R^2 of predictions against y.
export function weightedR2(y: number[], yhat: number[], w: number[]): number {
  const sw = w.reduce((a, b) => a + b, 0)
  const mean = y.reduce((a, v, i) => a + w[i] * v, 0) / sw
  let sse = 0
  let sst = 0
  for (let i = 0; i < y.length; i++) {
    sse += w[i] * (y[i] - yhat[i]) ** 2
    sst += w[i] * (y[i] - mean) ** 2
  }
  return sst === 0 ? 0 : 1 - sse / sst
}

// k-fold cross-validated R^2: each row is predicted by a model that never saw
// it. Folds are assigned round-robin, so the result is deterministic.
export function crossValidatedR2(X: number[][], y: number[], w: number[], folds = 5): number {
  const yhat = new Array<number>(y.length)
  for (let f = 0; f < folds; f++) {
    const train = X.map((_, i) => i).filter(i => i % folds !== f)
    const beta = wls(train.map(i => X[i]), train.map(i => y[i]), train.map(i => w[i]))
    for (let i = f; i < y.length; i += folds) yhat[i] = predict(X[i], beta)
  }
  return weightedR2(y, yhat, w)
}

// Method-of-moments noise split for raw (unsmoothed) measures. Models each
// residual's variance as tau^2 + k / n_i: tau^2 is real between-hospital
// variation, k / n_i is sampling noise that shrinks with volume. Fitted by
// least squares of squared residuals on 1/n; both terms are floored at 0.
export function noiseModel(residuals: number[], n: number[]): { tau2: number; k: number } {
  const X = n.map(v => [1, 1 / v])
  const y = residuals.map(r => r * r)
  const [tau2, k] = wls(X, y, n.map(() => 1), 0)
  if (k <= 0) return { tau2: Math.max(0, y.reduce((a, b) => a + b, 0) / y.length), k: 0 }
  if (tau2 <= 0) return { tau2: 0, k }
  return { tau2, k }
}

// Empirical-Bayes shrinkage of a gap with sampling variance se^2 toward 0
// (i.e. toward the expected score), given true-signal variance tau^2.
// Returns the posterior mean and standard deviation.
export function shrink(gap: number, se2: number, tau2: number): { mean: number; sd: number } {
  if (tau2 <= 0) return { mean: 0, sd: 0 }
  if (se2 <= 0) return { mean: gap, sd: 0 }
  const factor = tau2 / (tau2 + se2)
  return { mean: gap * factor, sd: Math.sqrt(factor * se2) }
}

// Weighted lasso (L1-penalized least squares) by coordinate descent:
// minimizes sum w_i (y_i - b0 - x_i . b)^2 / (2 sum w) + lambda * sum |b_j|.
// X has no intercept column; columns should be on comparable scales
// (standardized) for the penalty to treat them alike. The intercept is
// unpenalized. `start` warm-starts from a previous solution on the path.
export function lasso(
  X: number[][], y: number[], w: number[], lambda: number, start?: number[], { tol = 1e-7, maxIter = 1000 } = {}
): { intercept: number; beta: number[] } {
  const n = X.length
  const p = X[0]?.length ?? 0
  const sw = w.reduce((a, b) => a + b, 0)
  const xm = Array.from({ length: p }, (_, j) => X.reduce((a, x, i) => a + w[i] * x[j], 0) / sw)
  const ym = y.reduce((a, v, i) => a + w[i] * v, 0) / sw
  const cols = Array.from({ length: p }, (_, j) => X.map(x => x[j] - xm[j]))
  const ss = cols.map(c => c.reduce((a, v, i) => a + w[i] * v * v, 0) / sw)
  const beta = start ? [...start] : new Array<number>(p).fill(0)
  const r = y.map((v, i) => v - ym - cols.reduce((a, c, j) => a + c[i] * beta[j], 0))
  for (let iter = 0; iter < maxIter; iter++) {
    let change = 0
    for (let j = 0; j < p; j++) {
      if (ss[j] === 0) continue
      const c = cols[j]
      let rho = 0
      for (let i = 0; i < n; i++) rho += w[i] * c[i] * r[i]
      rho = rho / sw + ss[j] * beta[j]
      const next = Math.sign(rho) * Math.max(0, Math.abs(rho) - lambda) / ss[j]
      const d = next - beta[j]
      if (d !== 0) {
        for (let i = 0; i < n; i++) r[i] -= d * c[i]
        beta[j] = next
        change = Math.max(change, Math.abs(d) * Math.sqrt(ss[j]))
      }
    }
    if (change < tol) break
  }
  return { intercept: ym - xm.reduce((a, m, j) => a + m * beta[j], 0), beta }
}

// Smallest lambda at which every coefficient is 0.
export function lassoLambdaMax(X: number[][], y: number[], w: number[]): number {
  const sw = w.reduce((a, b) => a + b, 0)
  const ym = y.reduce((a, v, i) => a + w[i] * v, 0) / sw
  let max = 0
  for (let j = 0; j < (X[0]?.length ?? 0); j++) {
    const xm = X.reduce((a, x, i) => a + w[i] * x[j], 0) / sw
    const g = Math.abs(X.reduce((a, x, i) => a + w[i] * (x[j] - xm) * (y[i] - ym), 0) / sw)
    max = Math.max(max, g)
  }
  return max
}

export interface LassoCv {
  lambdas: number[]
  cvR2: number[] // cross-validated weighted R^2 per lambda
  cvSe: number[] // standard error of the cross-validated loss (in R^2 units) across folds
  best: number // index of the lambda with the highest cross-validated R^2
  oneSe: number // largest lambda within one SE of the best (the usual sparser choice)
  path: number[][] // coefficients per lambda, fitted on all rows
}

// Lasso path with k-fold cross-validation (round-robin folds, as in
// crossValidatedR2). Lambdas run log-spaced from lambdaMax down to
// lambdaMax * minRatio.
export function lassoCv(X: number[][], y: number[], w: number[], { folds = 5, steps = 40, minRatio = 1e-3 } = {}): LassoCv {
  const max = lassoLambdaMax(X, y, w)
  const lambdas = Array.from({ length: steps }, (_, k) => max * minRatio ** (k / (steps - 1)))
  const sw = w.reduce((a, b) => a + b, 0)
  const ym = y.reduce((a, v, i) => a + w[i] * v, 0) / sw
  const sst = y.reduce((a, v, i) => a + w[i] * (v - ym) ** 2, 0)
  // Squared error per fold per lambda.
  const sse = lambdas.map(() => new Array<number>(folds).fill(0))
  const foldSst = new Array<number>(folds).fill(0)
  for (let f = 0; f < folds; f++) {
    const train = X.map((_, i) => i).filter(i => i % folds !== f)
    const test = X.map((_, i) => i).filter(i => i % folds === f)
    let beta: number[] | undefined
    for (let k = 0; k < lambdas.length; k++) {
      const fit = lasso(train.map(i => X[i]), train.map(i => y[i]), train.map(i => w[i]), lambdas[k], beta)
      beta = fit.beta
      for (const i of test) sse[k][f] += w[i] * (y[i] - fit.intercept - predict(X[i], fit.beta)) ** 2
    }
    for (const i of test) foldSst[f] += w[i] * (y[i] - ym) ** 2
  }
  const cvR2 = sse.map(s => 1 - s.reduce((a, b) => a + b, 0) / sst)
  const cvSe = sse.map(s => {
    const r = s.map((v, f) => 1 - v / (foldSst[f] || 1))
    const m = r.reduce((a, b) => a + b, 0) / folds
    return Math.sqrt(r.reduce((a, v) => a + (v - m) ** 2, 0) / (folds - 1) / folds)
  })
  const best = cvR2.indexOf(Math.max(...cvR2))
  const oneSe = cvR2.findIndex(v => v >= cvR2[best] - cvSe[best])
  const path: number[][] = []
  let beta: number[] | undefined
  for (const l of lambdas) {
    beta = lasso(X, y, w, l, beta).beta
    path.push(beta)
  }
  return { lambdas, cvR2, cvSe, best, oneSe, path }
}

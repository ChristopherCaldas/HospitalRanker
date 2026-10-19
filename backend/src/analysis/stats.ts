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

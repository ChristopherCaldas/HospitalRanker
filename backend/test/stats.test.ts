import { describe, expect, it } from 'vitest'
import { crossValidatedR2, lasso, lassoCv, lassoLambdaMax, noiseModel, predict, shrink, solve, weightedR2, wls } from '../src/analysis/stats'

// Deterministic pseudo-random numbers so the tests are reproducible.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32
    return seed / 2 ** 32
  }
}
const normal = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())

describe('solve', () => {
  it('solves a linear system, pivoting when needed', () => {
    expect(solve([[0, 2], [3, 1]], [4, 5]).map(v => +v.toFixed(10))).toEqual([1, 2])
  })
  it('rejects a singular system', () => {
    expect(() => solve([[1, 2], [2, 4]], [1, 2])).toThrow('singular')
  })
})

describe('wls', () => {
  it('recovers exact coefficients from noiseless data', () => {
    const X = [[1, 0, 1], [1, 1, 0], [1, 2, 1], [1, 3, 0], [1, 4, 1]]
    const y = X.map(x => 2 + 0.5 * x[1] - 3 * x[2])
    const beta = wls(X, y, X.map(() => 1))
    expect(beta[0]).toBeCloseTo(2, 6)
    expect(beta[1]).toBeCloseTo(0.5, 6)
    expect(beta[2]).toBeCloseTo(-3, 6)
  })

  it('lets heavier-weighted rows pull the fit', () => {
    const X = [[1], [1]]
    // Weighted mean of 0 (weight 1) and 10 (weight 9) is 9.
    expect(wls(X, [0, 10], [1, 9])[0]).toBeCloseTo(9, 9)
  })
})

describe('R^2', () => {
  it('is 1 for a perfect fit and 0 for predicting the mean', () => {
    expect(weightedR2([1, 2, 3], [1, 2, 3], [1, 1, 1])).toBe(1)
    expect(weightedR2([1, 2, 3], [2, 2, 2], [1, 1, 1])).toBeCloseTo(0, 12)
  })

  it('cross-validation stays near in-sample R^2 for a real signal and near 0 for noise', () => {
    const r = rng(1)
    const X: number[][] = []
    const signal: number[] = []
    const noise: number[] = []
    for (let i = 0; i < 400; i++) {
      const x = normal(r)
      X.push([1, x])
      signal.push(3 * x + normal(r))
      noise.push(normal(r))
    }
    const w = X.map(() => 1)
    const inSample = weightedR2(signal, X.map(x => predict(x, wls(X, signal, w))), w)
    expect(crossValidatedR2(X, signal, w)).toBeGreaterThan(inSample - 0.05)
    expect(crossValidatedR2(X, noise, w)).toBeLessThan(0.02)
  })
})

describe('noiseModel', () => {
  it('separates true variation from volume-dependent sampling noise', () => {
    const r = rng(7)
    const tau2 = 4
    const k = 900
    const n: number[] = []
    const residuals: number[] = []
    for (let i = 0; i < 20000; i++) {
      const ni = 10 + Math.floor(r() * 990)
      n.push(ni)
      residuals.push(Math.sqrt(tau2) * normal(r) + Math.sqrt(k / ni) * normal(r))
    }
    const fit = noiseModel(residuals, n)
    expect(fit.tau2).toBeGreaterThan(3)
    expect(fit.tau2).toBeLessThan(5)
    expect(fit.k).toBeGreaterThan(700)
    expect(fit.k).toBeLessThan(1100)
  })

  it('finds negligible sampling noise when spread does not shrink with volume', () => {
    const r = rng(3)
    const n = Array.from({ length: 5000 }, () => 10 + Math.floor(r() * 990))
    const residuals = n.map(() => 2 * normal(r))
    const fit = noiseModel(residuals, n)
    // At a typical volume, the noise term is tiny next to the true variance (4).
    expect(fit.k / 500).toBeLessThan(0.1 * fit.tau2)
    expect(fit.tau2).toBeGreaterThan(3.5)
  })
})

describe('shrink', () => {
  it('pulls noisy gaps toward zero and leaves precise ones nearly alone', () => {
    expect(shrink(10, 4, 4).mean).toBeCloseTo(5, 12) // equal signal and noise: halfway
    expect(shrink(10, 0.01, 4).mean).toBeCloseTo(10, 1)
    expect(shrink(10, 400, 4).mean).toBeLessThan(0.2)
  })

  it('returns the posterior standard deviation', () => {
    expect(shrink(10, 4, 4).sd).toBeCloseTo(Math.sqrt(2), 12)
  })

  it('handles the degenerate cases', () => {
    expect(shrink(10, 4, 0)).toEqual({ mean: 0, sd: 0 })
    expect(shrink(10, 0, 4)).toEqual({ mean: 10, sd: 0 })
  })
})

describe('lasso', () => {
  // y = 2 x0 - 1 x1 + 0 x2, no noise
  const X = Array.from({ length: 200 }, (_, i) => [Math.sin(i), Math.cos(i * 1.7), Math.sin(i * 0.3 + 1)])
  const y = X.map(x => 1 + 2 * x[0] - x[1])
  const w = X.map(() => 1)

  it('matches least squares with no penalty and zeroes everything above lambdaMax', () => {
    const fit = lasso(X, y, w, 0)
    expect(fit.intercept).toBeCloseTo(1, 5)
    expect(fit.beta[0]).toBeCloseTo(2, 5)
    expect(fit.beta[1]).toBeCloseTo(-1, 5)
    expect(fit.beta[2]).toBeCloseTo(0, 5)
    const max = lassoLambdaMax(X, y, w)
    expect(lasso(X, y, w, max * 1.0001).beta.every(b => b === 0)).toBe(true)
    expect(lasso(X, y, w, max * 0.9).beta.some(b => b !== 0)).toBe(true)
  })

  it('soft-thresholds an orthonormal design', () => {
    // Centered, unit-variance, uncorrelated columns: b_j = sign(z) max(|z| - lambda, 0)
    const Xo = [[1, 1], [1, -1], [-1, 1], [-1, -1]]
    const yo = [3, 1, -1, -3] // = 2 x0 + 1 x1
    const fit = lasso(Xo, yo, [1, 1, 1, 1], 0.5)
    expect(fit.beta[0]).toBeCloseTo(1.5, 8)
    expect(fit.beta[1]).toBeCloseTo(0.5, 8)
  })

  it('cross-validates a path that keeps the real predictors', () => {
    const noisy = y.map((v, i) => v + 0.3 * Math.sin(i * 7.1))
    const cv = lassoCv(X, noisy, w)
    expect(cv.oneSe).toBeLessThanOrEqual(cv.best)
    expect(cv.cvR2[cv.best]).toBeGreaterThan(0.9)
    const chosen = cv.path[cv.oneSe]
    expect(Math.abs(chosen[0])).toBeGreaterThan(1)
    expect(Math.abs(chosen[1])).toBeGreaterThan(0.5)
  })
})

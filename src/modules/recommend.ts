import { calculateInstallment, type RateMethod } from '../contracts/index.js'
import type { products } from '../db/schema.js'

type Product = typeof products.$inferSelect

export interface RecommendInput {
  need?: 'pinjaman' | 'simpanan'
  purposes?: string[]
  amount?: number
  tenorMonths?: number
}

export interface Scored {
  product: Product
  score: number
  reasons: string[]
  estimate: { monthly: number; total: number; totalInterest: number } | null
}

/**
 * Recommendation engine for the profiling wizard.
 *
 * Weights live here but every input they read — purposes, amount bounds, tenor
 * options, rates — comes from the CMS `products` table, so staff retune the
 * outcome by editing products rather than by asking for a deploy.
 */
const WEIGHTS = { category: 40, purpose: 30, amount: 20, tenor: 10 } as const

export function recommendProduct(candidates: Product[], input: RecommendInput): { best: Scored | null; alternatives: Scored[] } {
  const scored = candidates
    .map((product): Scored => {
      let score = 0
      const reasons: string[] = []

      if (input.need && product.category === input.need) {
        score += WEIGHTS.category
        reasons.push(input.need === 'pinjaman' ? 'Sesuai kebutuhan pinjaman Anda' : 'Sesuai kebutuhan simpanan Anda')
      }

      const wanted = input.purposes ?? []
      if (wanted.length && product.purposes.length) {
        const overlap = wanted.filter((p) => product.purposes.includes(p))
        if (overlap.length) {
          score += Math.round((overlap.length / wanted.length) * WEIGHTS.purpose)
          reasons.push(`Cocok untuk ${overlap.length} dari ${wanted.length} keperluan yang Anda pilih`)
        }
      } else if (!wanted.length) {
        // No preference stated — do not penalise a product for it.
        score += WEIGHTS.purpose / 2
      }

      if (input.amount != null) {
        const min = product.minAmount ?? 0
        const max = product.maxAmount ?? Number.MAX_SAFE_INTEGER
        if (input.amount >= min && input.amount <= max) {
          score += WEIGHTS.amount
          reasons.push('Nominal yang Anda butuhkan masuk dalam batas produk ini')
        } else {
          // Near-misses still rank above products that cannot serve the amount at all.
          const distance = input.amount < min ? min - input.amount : input.amount - max
          const tolerance = Math.max(min, 1) * 0.5
          if (distance <= tolerance) score += WEIGHTS.amount / 3
        }
      }

      if (input.tenorMonths != null && product.tenorOptions.length) {
        if (product.tenorOptions.includes(input.tenorMonths)) {
          score += WEIGHTS.tenor
          reasons.push(`Tersedia jangka waktu ${input.tenorMonths} bulan`)
        }
      }

      let estimate: Scored['estimate'] = null
      // An unverified rate must never be turned into a rupiah figure.
      if (product.isVerified && product.category === 'pinjaman' && input.amount && input.tenorMonths && product.ratePercent != null) {
        const r = calculateInstallment({
          principal: input.amount,
          annualRatePercent: product.ratePercent,
          months: input.tenorMonths,
          method: product.rateMethod as RateMethod,
        })
        estimate = { monthly: r.monthly, total: r.total, totalInterest: r.totalInterest }
      }

      return { product, score, reasons, estimate }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.product.sortOrder - b.product.sortOrder)

  const maxScore = WEIGHTS.category + WEIGHTS.purpose + WEIGHTS.amount + WEIGHTS.tenor
  const normalise = (s: Scored) => ({ ...s, score: Math.min(100, Math.round((s.score / maxScore) * 100)) })

  return {
    best: scored[0] ? normalise(scored[0]) : null,
    alternatives: scored.slice(1, 3).map(normalise),
  }
}

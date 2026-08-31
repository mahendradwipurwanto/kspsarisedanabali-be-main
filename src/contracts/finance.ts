/**
 * Installment maths for the simulator and the profiling wizard.
 *
 * These figures are shown to the public, so every result carries a disclaimer and
 * every method is unit-tested. Rates come from the CMS `products` table — never
 * hardcode a rate here.
 */

export type RateMethod = 'flat' | 'annuity' | 'effective' | 'none'

export interface InstallmentInput {
  /** Principal in rupiah. */
  principal: number
  /** Annual nominal rate as a percentage, e.g. 15.6 for 1.3%/month. */
  annualRatePercent: number
  /** Tenor in months. */
  months: number
  method: RateMethod
}

export interface InstallmentResult {
  monthly: number
  total: number
  totalInterest: number
  method: RateMethod
  /** Per-period schedule; empty for `none`. */
  schedule: { period: number; principal: number; interest: number; balance: number }[]
}

const round = (n: number) => Math.round(n)

/**
 * Flat / "bunga menurun" style used by most Indonesian cooperatives:
 * interest is charged on the original principal for every period.
 */
function flat({ principal, annualRatePercent, months }: InstallmentInput): InstallmentResult {
  const monthlyRate = annualRatePercent / 100 / 12
  const interestPerMonth = principal * monthlyRate
  const principalPerMonth = principal / months
  const monthly = round(principalPerMonth + interestPerMonth)
  const schedule = []
  let balance = principal
  for (let p = 1; p <= months; p++) {
    balance -= principalPerMonth
    schedule.push({ period: p, principal: round(principalPerMonth), interest: round(interestPerMonth), balance: round(Math.max(balance, 0)) })
  }
  return { monthly, total: monthly * months, totalInterest: round(interestPerMonth * months), method: 'flat', schedule }
}

/** Annuity: equal payments, interest recomputed on the declining balance. */
function annuity({ principal, annualRatePercent, months }: InstallmentInput): InstallmentResult {
  const r = annualRatePercent / 100 / 12
  if (r === 0) return flat({ principal, annualRatePercent: 0, months, method: 'flat' })
  const factor = Math.pow(1 + r, months)
  const monthly = round((principal * r * factor) / (factor - 1))
  const schedule = []
  let balance = principal
  let totalInterest = 0
  for (let p = 1; p <= months; p++) {
    const interest = balance * r
    const principalPart = monthly - interest
    balance -= principalPart
    totalInterest += interest
    schedule.push({ period: p, principal: round(principalPart), interest: round(interest), balance: round(Math.max(balance, 0)) })
  }
  return { monthly, total: monthly * months, totalInterest: round(totalInterest), method: 'annuity', schedule }
}

/** Effective declining: principal fixed, interest on the remaining balance. */
function effective({ principal, annualRatePercent, months }: InstallmentInput): InstallmentResult {
  const r = annualRatePercent / 100 / 12
  const principalPerMonth = principal / months
  const schedule = []
  let balance = principal
  let total = 0
  let totalInterest = 0
  for (let p = 1; p <= months; p++) {
    const interest = balance * r
    balance -= principalPerMonth
    total += principalPerMonth + interest
    totalInterest += interest
    schedule.push({ period: p, principal: round(principalPerMonth), interest: round(interest), balance: round(Math.max(balance, 0)) })
  }
  return { monthly: round(schedule[0].principal + schedule[0].interest), total: round(total), totalInterest: round(totalInterest), method: 'effective', schedule }
}

export function calculateInstallment(input: InstallmentInput): InstallmentResult {
  if (input.principal <= 0 || input.months <= 0) {
    return { monthly: 0, total: 0, totalInterest: 0, method: input.method, schedule: [] }
  }
  switch (input.method) {
    case 'flat': return flat(input)
    case 'annuity': return annuity(input)
    case 'effective': return effective(input)
    default: return { monthly: 0, total: input.principal, totalInterest: 0, method: 'none', schedule: [] }
  }
}

/** Simple compounding projection for savings products. */
export function calculateSavings(monthlyDeposit: number, annualRatePercent: number, months: number) {
  const r = annualRatePercent / 100 / 12
  let balance = 0
  for (let i = 0; i < months; i++) balance = (balance + monthlyDeposit) * (1 + r)
  const deposited = monthlyDeposit * months
  return { finalBalance: round(balance), deposited, interest: round(balance - deposited) }
}

export const formatRupiah = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)

export const formatRupiahShort = (n: number) => {
  if (n >= 1_000_000_000) return `Rp${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000_000) return `Rp${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}jt`
  if (n >= 1_000) return `Rp${(n / 1_000).toFixed(0)}rb`
  return `Rp${n}`
}

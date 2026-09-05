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

/* ───────────────────────── savings, from the printed tables ─────────────── */

/**
 * The three savings products the koperasi publishes a table for. The figures
 * below reproduce those tables exactly rather than approximating them, so a
 * member comparing the website against the printed sheet sees the same number.
 *
 * Sources: "Tabel SIGEMAS — Simpanan Generasi Emas" (brochure) and the
 * koperasi's spreadsheet of SIMAPAN and SIPURA tables, signed by the Ketua and
 * Sekretaris under Badan Hukum AHU-0002642.AH.01.27.TAHUN 2021.
 */

/**
 * SIGEMAS — Simpanan Generasi Emas.
 *
 * A lump sum held for 12, 24 or 36 months. It earns 1% a year in interest plus
 * a gold reward worth 4% a year, so 5% a year in total. The printed table runs
 * from Rp50 juta to Rp500 juta in Rp50 juta steps.
 */
export const SIGEMAS = {
  interestPercentPerYear: 1,
  rewardPercentPerYear: 4,
  minAmount: 50_000_000,
  maxAmount: 500_000_000,
  step: 50_000_000,
  tenors: [12, 24, 36] as const,
  amounts: Array.from({ length: 10 }, (_, i) => (i + 1) * 50_000_000),
} as const

export interface SigemasResult {
  years: number
  /** Cash interest over the whole term. */
  interest: number
  /** Value of the gold reward over the whole term. */
  reward: number
  /** Interest plus reward. */
  total: number
  /** Deposit returned plus everything it earned. */
  payout: number
}

export function calculateSigemas(amount: number, months: number): SigemasResult {
  const years = months / 12
  const interest = round((amount * SIGEMAS.interestPercentPerYear / 100) * years)
  const reward = round((amount * SIGEMAS.rewardPercentPerYear / 100) * years)
  return { years, interest, reward, total: interest + reward, payout: amount + interest + reward }
}

/**
 * SIMAPAN — Simpanan Masa Depan.
 *
 * A fixed amount paid in every month, compounding at 0.35% a month (4.2% a year
 * nominal, 4.28% effective). This is an ordinary annuity: the deposit for a
 * month earns from the end of that month. It reproduces all ninety cells of the
 * koperasi's table, every deposit from Rp50 ribu to Rp2 juta over one to ten
 * years, to the rupiah.
 */
export const SIMAPAN = {
  monthlyRatePercent: 0.35,
  deposits: [50_000, 100_000, 200_000, 300_000, 400_000, 500_000, 1_000_000, 1_500_000, 2_000_000],
  years: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  minDeposit: 50_000,
  maxDeposit: 5_000_000,
} as const

export interface SimapanResult {
  months: number
  /** What the member pays in over the term. */
  deposited: number
  /** Balance at the end of the term. */
  value: number
  /** Value less deposits. */
  profit: number
}

export function calculateSimapan(monthlyDeposit: number, months: number): SimapanResult {
  const i = SIMAPAN.monthlyRatePercent / 100
  const value = monthlyDeposit * (((1 + i) ** months - 1) / i)
  const deposited = monthlyDeposit * months
  return { months, deposited, value: round(value), profit: round(value) - deposited }
}

/**
 * SIPURA — Simpanan Hari Raya.
 *
 * A small amount paid in daily for 210 days, one Balinese pawukon year, so the
 * savings mature in time for the next round of ceremonies. The bonus is 1.9
 * times one deposit, rounded down to the nearest thousand rupiah, which is how
 * every row of the printed table is calculated.
 */
export const SIPURA = {
  days: 210,
  bonusMultiplier: 1.9,
  deposits: [5_000, 10_000, 20_000, 25_000, 30_000, 50_000, 75_000, 100_000, 200_000],
  minDeposit: 5_000,
  maxDeposit: 500_000,
} as const

export interface SipuraResult {
  days: number
  /** What the member pays in over the 210 days. */
  deposited: number
  bonus: number
  /** Deposits plus bonus, paid out at maturity. */
  received: number
}

export function calculateSipura(dailyDeposit: number): SipuraResult {
  const deposited = dailyDeposit * SIPURA.days
  const bonus = Math.floor((dailyDeposit * SIPURA.bonusMultiplier) / 1000) * 1000
  return { days: SIPURA.days, deposited, bonus, received: deposited + bonus }
}

/** Slugs the savings tables belong to, so a product page can link to its table. */
export const SAVINGS_TABLE_SLUGS = ['sigemas', 'simapan', 'sipura'] as const
export type SavingsTableSlug = (typeof SAVINGS_TABLE_SLUGS)[number]

export const formatRupiah = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)

export const formatRupiahShort = (n: number) => {
  if (n >= 1_000_000_000) return `Rp${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000_000) return `Rp${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}jt`
  if (n >= 1_000) return `Rp${(n / 1_000).toFixed(0)}rb`
  return `Rp${n}`
}

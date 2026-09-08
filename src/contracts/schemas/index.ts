import { z } from 'zod'

/* ---------------------------------- shared --------------------------------- */

export const idSchema = z.string().uuid()
export const slugSchema = z
  .string()
  .min(1)
  .max(60, 'Maksimal 60 karakter')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Gunakan huruf kecil dan tanda hubung saja')

export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('62')) return digits
  if (digits.startsWith('0')) return `62${digits.slice(1)}`
  if (digits.startsWith('8')) return `62${digits}`
  return digits
}

/*
 * One rule for every phone number the koperasi collects or publishes, shared
 * by the website's forms, the console's record forms and the API, so a number
 * a visitor could type is a number staff can call back.
 */
export const PHONE_HINT = 'Angka saja, tanpa spasi. Contoh: 081234567890'
export const PHONE_ERROR = 'Nomor harus berupa angka, 9–15 digit, diawali 0 atau 62. Contoh: 081234567890'
export const EMAIL_ERROR = 'Format email tidak valid. Contoh: nama@email.com'
export const URL_ERROR = 'Tautan harus diawali https://'

/** An Indonesian number once normalised: country code plus 8 to 13 digits. */
export const isValidPhone = (raw: string): boolean => /^62\d{8,13}$/.test(normalisePhone(raw))
export const isValidEmail = (raw: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim())
export const isValidUrl = (raw: string): boolean => /^https:\/\/[^\s]+\.[^\s]+$/i.test(raw.trim())

/** What a phone input keeps as someone types: digits, and a plus only at the start. */
export const cleanPhoneInput = (raw: string): string => raw.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '').slice(0, 16)

/** Indonesian numbers, normalised to 62xxxxxxxxxx. */
export const phoneSchema = z
  .string()
  .trim()
  .min(8, 'Nomor terlalu pendek')
  .max(20, 'Nomor terlalu panjang')
  .regex(/^[0-9+\-\s()]+$/, 'Hanya angka dan tanda + - ( )')
  .refine(isValidPhone, PHONE_ERROR)

/** A phone field that may be left empty, for records rather than leads. */
export const optionalPhoneSchema = phoneSchema.optional().or(z.literal(''))

/* ------------------------------------ SEO ---------------------------------- */

export const seoSchema = z.object({
  /**
   * The phrase this page is trying to rank for. Nothing is generated from it —
   * it exists so the scorer can tell the editor whether the phrase they care
   * about actually appears where Google looks for it.
   */
  focusKeyword: z.string().max(80).optional().or(z.literal('')),
  metaTitle: z.string().max(70, 'Judul terlalu panjang untuk hasil Google').optional().or(z.literal('')),
  metaDescription: z.string().max(180, 'Deskripsi terlalu panjang').optional().or(z.literal('')),
  ogImage: z.string().optional().or(z.literal('')),
  noindex: z.boolean().optional(),
  canonicalUrl: z.string().url().optional().or(z.literal('')),
})
export type Seo = z.infer<typeof seoSchema>

/** Scoring thresholds, shared so the CMS panel and any CI check agree. */
export const SEO_RULES = {
  title: { min: 30, ideal: [50, 60] as const, max: 70 },
  description: { min: 70, ideal: [120, 158] as const, max: 180 },
  minWords: 300,
  minInternalLinks: 3,
  /** Above this the phrase reads as stuffed rather than used. */
  maxKeywordDensityPct: 3,
} as const

/**
 * Accent- and case-insensitive phrase match. Indonesian rarely uses accents, but
 * copy pasted from Word arrives with typographic quotes and non-breaking spaces,
 * and an editor should not have a check fail over an invisible character.
 */
export function containsPhrase(haystack: string, phrase: string): boolean {
  const clean = (v: string) =>
    v.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019\u201c\u201d]/g, "'").replace(/\s+/g, ' ').trim()
  const h = clean(haystack)
  const n = clean(phrase)
  return n.length > 0 && h.includes(n)
}

export function countPhrase(haystack: string, phrase: string): number {
  const clean = (v: string) => v.toLowerCase().replace(/\s+/g, ' ').trim()
  const h = clean(haystack)
  const n = clean(phrase)
  if (!n) return 0
  let count = 0
  let from = 0
  for (;;) {
    const at = h.indexOf(n, from)
    if (at === -1) break
    count++
    from = at + n.length
  }
  return count
}

export interface SeoCheck {
  id: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  hint: string
}

/** Live SEO scoring used by the CMS sidebar. Plain Indonesian, actionable hints. */
export function scoreSeo(input: {
  title?: string
  description?: string
  slug?: string
  h1Count: number
  headingJumps: number
  wordCount: number
  imagesTotal: number
  imagesWithAlt: number
  internalLinks: number
  /** Optional: only scored when the editor has set a focus keyword. */
  focusKeyword?: string
  h1Text?: string
  bodyText?: string
}): { checks: SeoCheck[]; score: number } {
  const c: SeoCheck[] = []
  const t = (input.title ?? '').trim().length
  const d = (input.description ?? '').trim().length

  c.push(
    t === 0
      ? { id: 'title', label: 'Judul halaman', status: 'fail', hint: 'Belum diisi. Judul adalah sinyal terpenting untuk Google.' }
      : t < SEO_RULES.title.ideal[0]
        ? { id: 'title', label: 'Judul halaman', status: 'warn', hint: `Terlalu pendek (${t} karakter). Tambah ${SEO_RULES.title.ideal[0] - t} karakter lagi.` }
        : t > SEO_RULES.title.max
          ? { id: 'title', label: 'Judul halaman', status: 'warn', hint: `Terlalu panjang (${t}). Google akan memotongnya.` }
          : { id: 'title', label: 'Judul halaman', status: 'pass', hint: `Panjang pas (${t} karakter).` },
  )

  c.push(
    d === 0
      ? { id: 'desc', label: 'Deskripsi halaman', status: 'fail', hint: 'Belum diisi. Ini kalimat yang muncul di bawah judul pada hasil Google.' }
      : d < SEO_RULES.description.ideal[0]
        ? { id: 'desc', label: 'Deskripsi halaman', status: 'warn', hint: `Terlalu pendek (${d} karakter). Idealnya ${SEO_RULES.description.ideal[0]}–${SEO_RULES.description.ideal[1]}.` }
        : d > SEO_RULES.description.max
          ? { id: 'desc', label: 'Deskripsi halaman', status: 'warn', hint: `Terlalu panjang (${d}). Akan terpotong di hasil pencarian.` }
          : { id: 'desc', label: 'Deskripsi halaman', status: 'pass', hint: `Panjang pas (${d} karakter).` },
  )

  c.push(
    input.h1Count === 1
      ? { id: 'h1', label: 'Judul utama (H1)', status: 'pass', hint: 'Tepat satu judul utama.' }
      : input.h1Count === 0
        ? { id: 'h1', label: 'Judul utama (H1)', status: 'fail', hint: 'Belum ada. Tambahkan blok "Judul Halaman" atau "Banner Utama".' }
        : { id: 'h1', label: 'Judul utama (H1)', status: 'fail', hint: `Ada ${input.h1Count} judul utama. Google jadi bingung isi halaman ini apa.` },
  )

  c.push(
    input.headingJumps === 0
      ? { id: 'headings', label: 'Urutan sub-judul', status: 'pass', hint: 'Urutan sub-judul rapi.' }
      : { id: 'headings', label: 'Urutan sub-judul', status: 'warn', hint: `${input.headingJumps} sub-judul melompat tingkat.` },
  )

  const altPct = input.imagesTotal === 0 ? 100 : Math.round((input.imagesWithAlt / input.imagesTotal) * 100)
  c.push(
    altPct === 100
      ? { id: 'alt', label: 'Keterangan gambar', status: 'pass', hint: 'Semua gambar sudah punya keterangan.' }
      : altPct >= 70
        ? { id: 'alt', label: 'Keterangan gambar', status: 'warn', hint: `${input.imagesTotal - input.imagesWithAlt} gambar belum punya keterangan.` }
        : { id: 'alt', label: 'Keterangan gambar', status: 'fail', hint: `Baru ${altPct}% gambar punya keterangan.` },
  )

  c.push(
    input.wordCount >= SEO_RULES.minWords
      ? { id: 'words', label: 'Panjang isi', status: 'pass', hint: `${input.wordCount} kata.` }
      : { id: 'words', label: 'Panjang isi', status: 'warn', hint: `Baru ${input.wordCount} kata. Halaman pendek sulit bersaing di Google.` },
  )

  c.push(
    input.internalLinks >= SEO_RULES.minInternalLinks
      ? { id: 'links', label: 'Tautan ke halaman lain', status: 'pass', hint: `${input.internalLinks} tautan internal.` }
      : { id: 'links', label: 'Tautan ke halaman lain', status: 'warn', hint: `Baru ${input.internalLinks}. Tambahkan tautan ke produk atau kontak.` },
  )

  c.push(
    input.slug && (input.slug === '/' || slugSchema.safeParse(input.slug).success)
      ? { id: 'slug', label: 'Alamat halaman', status: 'pass', hint: input.slug === '/' ? '/' : `/${input.slug}` }
      : { id: 'slug', label: 'Alamat halaman', status: 'fail', hint: 'Gunakan huruf kecil dan tanda hubung, tanpa spasi.' },
  )

  /**
   * Focus-keyword checks only run when the editor has named a phrase. Scoring a
   * page against a keyword nobody chose would just add noise, and the score is
   * a publish gate — it has to stay honest about what it actually knows.
   */
  const kw = (input.focusKeyword ?? '').trim()
  if (kw) {
    const inTitle = containsPhrase(input.title ?? '', kw)
    const inDesc = containsPhrase(input.description ?? '', kw)
    const inSlug = containsPhrase((input.slug ?? '').replace(/-/g, ' '), kw)
    const inH1 = containsPhrase(input.h1Text ?? '', kw)

    c.push(
      inTitle
        ? { id: 'kw_title', label: 'Kata kunci di judul', status: 'pass', hint: `"${kw}" sudah ada di judul.` }
        : { id: 'kw_title', label: 'Kata kunci di judul', status: 'fail', hint: `"${kw}" belum ada di judul Google. Ini penempatan yang paling berpengaruh.` },
    )
    c.push(
      inDesc
        ? { id: 'kw_desc', label: 'Kata kunci di deskripsi', status: 'pass', hint: 'Sudah ada di deskripsi.' }
        : { id: 'kw_desc', label: 'Kata kunci di deskripsi', status: 'warn', hint: `Tambahkan "${kw}" ke deskripsi — Google menebalkannya di hasil pencarian.` },
    )
    c.push(
      inSlug
        ? { id: 'kw_slug', label: 'Kata kunci di alamat', status: 'pass', hint: 'Sudah ada di alamat halaman.' }
        : { id: 'kw_slug', label: 'Kata kunci di alamat', status: 'warn', hint: `Alamat halaman belum memuat "${kw}".` },
    )
    c.push(
      inH1
        ? { id: 'kw_h1', label: 'Kata kunci di judul utama', status: 'pass', hint: 'Sudah ada di judul utama halaman.' }
        : { id: 'kw_h1', label: 'Kata kunci di judul utama', status: 'warn', hint: `Judul utama (H1) belum memuat "${kw}".` },
    )

    const body = input.bodyText ?? ''
    const hits = countPhrase(body, kw)
    const density = input.wordCount > 0 ? (hits * kw.split(/\s+/).length * 100) / input.wordCount : 0
    c.push(
      hits === 0
        ? { id: 'kw_body', label: 'Kata kunci di isi', status: 'fail', hint: `"${kw}" tidak muncul sama sekali di isi halaman.` }
        : density > SEO_RULES.maxKeywordDensityPct
          ? { id: 'kw_body', label: 'Kata kunci di isi', status: 'warn', hint: `Muncul ${hits}× (${density.toFixed(1)}%). Terlalu sering — tulis senatural mungkin.` }
          : { id: 'kw_body', label: 'Kata kunci di isi', status: 'pass', hint: `Muncul ${hits}× (${density.toFixed(1)}%) — wajar.` },
    )
  }

  const weight = { pass: 1, warn: 0.5, fail: 0 }
  const score = Math.round((c.reduce((s, x) => s + weight[x.status], 0) / c.length) * 100)
  return { checks: c, score }
}

/** Publishing is blocked on these. Mirrors the API's server-side gate. */
export function canPublish(checks: SeoCheck[]): { ok: boolean; blocking: SeoCheck[] } {
  const blocking = checks.filter((x) => x.status === 'fail' && ['title', 'desc', 'h1', 'slug'].includes(x.id))
  return { ok: blocking.length === 0, blocking }
}

/* ----------------------------------- auth ---------------------------------- */

export const loginSchema = z.object({
  email: z.string().email('Format email tidak valid'),
  password: z.string().min(1, 'Kata sandi wajib diisi'),
  totp: z.string().length(6).optional(),
})

export const createUserSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(10, 'Minimal 10 karakter').max(200),
  roleIds: z.array(idSchema).min(1, 'Pilih minimal satu peran'),
  branchIds: z.array(idSchema).optional(),
  isActive: z.boolean().optional(),
})

export const updateUserSchema = createUserSchema.partial().omit({ password: true }).extend({
  password: z.string().min(10).max(200).optional().or(z.literal('')),
})

export const roleSchema = z.object({
  name: z.string().min(2).max(60),
  description: z.string().max(240).optional().or(z.literal('')),
  permissions: z.array(z.string()).min(1, 'Pilih minimal satu hak akses'),
})

/* ----------------------------------- leads --------------------------------- */

export const LEAD_SOURCES = ['profiling', 'contact_form', 'suggestion', 'career', 'whatsapp', 'manual'] as const
export const LEAD_STATUSES = ['baru', 'diproses', 'selesai', 'ditolak'] as const
export const LEAD_INTERESTS = ['pinjaman', 'simpanan', 'lainnya'] as const

export const LEAD_STATUS_LABELS: Record<(typeof LEAD_STATUSES)[number], string> = {
  baru: 'Baru',
  diproses: 'Diproses',
  selesai: 'Selesai',
  ditolak: 'Ditolak',
}

/**
 * The statuses that close a case. Both record a decision somebody made, so the
 * API refuses further changes to a lead sitting on one and the console stops
 * offering the follow-up form. Anything still open stays editable.
 */
export const CLOSED_LEAD_STATUSES: readonly string[] = ['selesai', 'ditolak']

export const isLeadClosed = (status: string): boolean => CLOSED_LEAD_STATUSES.includes(status)

export const LEAD_PURPOSES = [
  { value: 'modal_usaha', label: 'Modal Usaha' },
  { value: 'renovasi_rumah', label: 'Renovasi Rumah' },
  { value: 'biaya_pendidikan', label: 'Biaya Pendidikan' },
  { value: 'upacara_adat', label: 'Upacara Adat' },
  { value: 'beli_kendaraan', label: 'Beli Kendaraan' },
  { value: 'kebutuhan_lain', label: 'Kebutuhan Lain' },
] as const

export const publicLeadSchema = z.object({
  name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(120),
  phone: phoneSchema,
  email: z.string().email('Format email tidak valid').optional().or(z.literal('')),
  interest: z.enum(LEAD_INTERESTS).optional(),
  productId: idSchema.optional(),
  branchId: idSchema.optional(),
  message: z.string().max(2000).optional().or(z.literal('')),
  amount: z.number().int().min(0).max(10_000_000_000).optional(),
  tenorMonths: z.number().int().min(1).max(120).optional(),
  purposes: z.array(z.string()).max(10).optional(),
  source: z.enum(LEAD_SOURCES).default('contact_form'),
  sessionId: z.string().max(64).optional(),
  consent: z.literal(true, { errorMap: () => ({ message: 'Persetujuan dihubungi wajib dicentang' }) }),
  // Anti-spam honeypot. Deliberately NOT constrained to empty here: validating
  // it would return a 422 naming the field, which tells a bot exactly what to
  // change. The handler accepts the request and silently drops it instead.
  website: z.string().max(200).optional(),
  turnstileToken: z.string().optional(),
})
export type PublicLead = z.infer<typeof publicLeadSchema>

export const updateLeadSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  assignedToId: idSchema.nullable().optional(),
  branchId: idSchema.nullable().optional(),
  note: z.string().max(2000).optional(),
})

/* ------------------------------ kritik & saran ----------------------------- */

/**
 * Feedback is not a lead. A lead wants to be called back and must leave a phone
 * number; someone filing a complaint or an idea may want to stay anonymous, so
 * every contact field here is optional and only the message is required.
 */
export const FEEDBACK_CATEGORIES = ['kritik', 'saran', 'pertanyaan', 'apresiasi'] as const
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  kritik: 'Kritik',
  saran: 'Saran',
  pertanyaan: 'Pertanyaan',
  apresiasi: 'Apresiasi',
}

export const FEEDBACK_STATUSES = ['baru', 'dibaca', 'ditindaklanjuti', 'selesai'] as const
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  baru: 'Baru',
  dibaca: 'Dibaca',
  ditindaklanjuti: 'Ditindaklanjuti',
  selesai: 'Selesai',
}

/**
 * The status that closes a piece of feedback. Same rule as a lead: once someone
 * has recorded that it is done, reopening it would quietly rewrite that.
 */
export const CLOSED_FEEDBACK_STATUSES: readonly string[] = ['selesai']

export const isFeedbackClosed = (status: string): boolean => CLOSED_FEEDBACK_STATUSES.includes(status)

export const publicFeedbackSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES).default('saran'),
  rating: z.number().int().min(1).max(5).optional(),
  name: z.string().trim().max(120).optional().or(z.literal('')),
  email: z.string().trim().email(EMAIL_ERROR).optional().or(z.literal('')),
  phone: optionalPhoneSchema,
  subject: z.string().trim().max(150).optional().or(z.literal('')),
  message: z.string().trim().min(10, 'Tuliskan masukan Anda, minimal 10 karakter').max(4000),
  branchId: idSchema.optional(),
  sessionId: z.string().max(64).optional(),
  // Same honeypot rule as the lead form: left unconstrained on purpose so a bot
  // is never told which field gave it away. The handler drops it silently.
  website: z.string().max(200).optional(),
  turnstileToken: z.string().optional(),
})
export type PublicFeedback = z.infer<typeof publicFeedbackSchema>

export const updateFeedbackSchema = z.object({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  note: z.string().max(2000).optional(),
})

/* --------------------------------- profiling ------------------------------- */

export const profilingAnswersSchema = z.object({
  need: z.enum(['pinjaman', 'simpanan']).optional(),
  purposes: z.array(z.string()).optional(),
  amount: z.number().int().min(0).optional(),
  tenorMonths: z.number().int().min(1).max(120).optional(),
})

export const profilingSessionSchema = z.object({
  sessionId: z.string().max(64),
  step: z.number().int().min(1).max(4),
  answers: profilingAnswersSchema,
})

/* ---------------------------------- pages ---------------------------------- */

export const PAGE_STATUSES = ['draft', 'review', 'published'] as const

export const blockInputSchema = z.object({
  id: z.string().optional(),
  type: z.string().min(1),
  props: z.record(z.unknown()),
  isVisible: z.boolean().default(true),
})

/**
 * A moment, written either way.
 *
 * The console's date fields are `<input type="date">`, which yields
 * "2026-09-07" — a value `z.string().datetime()` rejects outright, so saving a
 * news item with a publish date failed with "publishedAt: invalid datetime".
 * A plain date is a legitimate answer to "when does this go out", so it is
 * accepted and widened to midnight UTC, which reads as the same calendar day
 * across Indonesia.
 *
 * It yields a Date rather than a string on purpose: the value goes straight
 * into a timestamp column, and a string there fails at the driver rather than
 * at the door — which is what turned a mistyped date into a 500.
 */
export const dateTimeSchema = z
  .union([z.string(), z.date()])
  .refine(
    (v) => v instanceof Date || /^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isNaN(Date.parse(v)),
    'Tanggal tidak dikenali',
  )
  .transform((v) => (v instanceof Date ? v : new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00.000Z` : v)))

/** Page slugs follow the slug rule, except the home page, which is "/". */
export const pageSlugSchema = slugSchema.or(z.literal('/'))

export const pageSchema = z.object({
  title: z.string().min(1, 'Judul wajib diisi').max(160),
  slug: pageSlugSchema,
  status: z.enum(PAGE_STATUSES).default('draft'),
  seo: seoSchema.default({}),
  blocks: z.array(blockInputSchema).default([]),
  publishedAt: dateTimeSchema.nullable().optional(),
  /** Listed in the footer's bottom row. Asked for, not assumed. */
  showInFooter: z.boolean().default(false),
})

/* --------------------------------- products -------------------------------- */

export const PRODUCT_CATEGORIES = ['simpanan', 'pinjaman'] as const
export const RATE_METHODS = ['flat', 'annuity', 'effective', 'none'] as const

export const productSchema = z.object({
  name: z.string().min(2).max(120),
  slug: slugSchema,
  category: z.enum(PRODUCT_CATEGORIES),
  tagline: z.string().max(180).optional().or(z.literal('')),
  summary: z.string().max(500).optional().or(z.literal('')),
  description: z.string().optional().or(z.literal('')),
  benefits: z.array(z.string()).optional(),
  requirements: z.array(z.string()).optional(),
  image: z.string().optional().or(z.literal('')),
  rateMethod: z.enum(RATE_METHODS).default('none'),
  ratePercent: z.number().min(0).max(100).optional(),
  rateNote: z.string().max(180).optional().or(z.literal('')),
  minAmount: z.number().int().min(0).optional(),
  maxAmount: z.number().int().min(0).optional(),
  tenorOptions: z.array(z.number().int().min(1).max(120)).optional(),
  purposes: z.array(z.string()).optional(),
  /**
   * Rates reach the public and drive the simulator, so they are published only
   * after the koperasi confirms them. Unverified products show no rate and are
   * excluded from the calculator.
   */
  isVerified: z.boolean().default(false),
  rateSource: z.string().max(300).optional().or(z.literal('')),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  seo: seoSchema.default({}),
})

/* --------------------------------- branches -------------------------------- */

export const branchHoursSchema = z.array(
  z.object({
    day: z.number().int().min(0).max(6), // 0 = Sunday
    opensAt: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
    closesAt: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  }),
)

export const branchSchema = z.object({
  name: z.string().min(2).max(120),
  slug: slugSchema,
  type: z.enum(['pusat', 'cabang']).default('cabang'),
  address: z.string().min(5).max(400),
  village: z.string().max(120).optional().or(z.literal('')),
  district: z.string().max(120).optional().or(z.literal('')),
  regency: z.string().max(120).default('Karangasem'),
  province: z.string().max(120).default('Bali'),
  postalCode: z.string().max(10).optional().or(z.literal('')),
  phone: optionalPhoneSchema,
  whatsapp: optionalPhoneSchema,
  email: z.string().email(EMAIL_ERROR).optional().or(z.literal('')),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  mapsUrl: z.string().url().optional().or(z.literal('')),
  hours: branchHoursSchema.optional(),
  image: z.string().optional().or(z.literal('')),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  seo: seoSchema.default({}),
})

/* ----------------------------------- posts --------------------------------- */

export const postSchema = z.object({
  title: z.string().min(3).max(200),
  slug: slugSchema,
  excerpt: z.string().max(400).optional().or(z.literal('')),
  content: z.string().optional().or(z.literal('')),
  coverImage: z.string().optional().or(z.literal('')),
  categoryId: idSchema.optional().nullable(),
  status: z.enum(PAGE_STATUSES).default('draft'),
  publishedAt: dateTimeSchema.nullable().optional(),
  seo: seoSchema.default({}),
})

/* ------------------------------------ jobs --------------------------------- */

export const jobSchema = z.object({
  title: z.string().min(2).max(160),
  slug: slugSchema,
  department: z.string().max(80).optional().or(z.literal('')),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'internship']).default('full_time'),
  branchId: idSchema.optional().nullable(),
  location: z.string().max(160).optional().or(z.literal('')),
  description: z.string().optional().or(z.literal('')),
  requirements: z.array(z.string()).optional(),
  closesAt: dateTimeSchema.nullable().optional(),
  isActive: z.boolean().default(true),
  seo: seoSchema.default({}),
})

export const jobApplicationSchema = z.object({
  jobId: idSchema,
  name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: phoneSchema,
  bio: z.string().max(4000).optional().or(z.literal('')),
  cvKey: z.string().min(1, 'CV wajib diunggah'),
  consent: z.literal(true, { errorMap: () => ({ message: 'Persetujuan penyimpanan data wajib dicentang' }) }),
  website: z.string().max(200).optional(),
})

/**
 * How far an application has got.
 *
 * Deliberately short. A koperasi hiring two or three people a year needs to
 * know who has been looked at and who has been called; a full applicant
 * tracking pipeline would be a form nobody fills in honestly.
 */
export const JOB_APPLICATION_STATUSES = ['baru', 'ditinjau', 'dipanggil', 'diterima', 'ditolak'] as const
export type JobApplicationStatus = (typeof JOB_APPLICATION_STATUSES)[number]

export const JOB_APPLICATION_STATUS_LABELS: Record<JobApplicationStatus, string> = {
  baru: 'Baru',
  ditinjau: 'Sudah ditinjau',
  dipanggil: 'Dipanggil wawancara',
  diterima: 'Diterima',
  ditolak: 'Tidak lolos',
}

/** The two that end it. Kept open for editing — an applicant may be reconsidered. */
export const isJobApplicationClosed = (status: string) => status === 'diterima' || status === 'ditolak'

export const updateJobApplicationSchema = z.object({
  status: z.enum(JOB_APPLICATION_STATUSES),
})

/* ---------------------------------- media ---------------------------------- */

export const presignSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(160),
  size: z.number().int().min(1).max(50 * 1024 * 1024, 'Ukuran maksimal 50 MB'),
  folder: z.enum(['media', 'documents', 'cv']).default('media'),
})

export const confirmMediaSchema = z.object({
  key: z.string().min(1),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(160),
  size: z.number().int().min(1),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  alt: z.string().max(300).optional().or(z.literal('')),
  caption: z.string().max(300).optional().or(z.literal('')),
  folderId: idSchema.nullable().optional(),
})

/* --------------------------------- analytics ------------------------------- */

export const trackEventSchema = z.object({
  name: z.string().min(1).max(60),
  path: z.string().max(300),
  sessionId: z.string().max(64),
  referrer: z.string().max(500).optional().or(z.literal('')),
  meta: z.record(z.unknown()).optional(),
})

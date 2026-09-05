/** Facts about the cooperative, taken from the legal documents and the current site. */

export const SITE = {
  legalName: 'Koperasi Simpan Pinjam Sari Sedana Bali',
  shortName: 'KSP Sari Sedana Bali',
  tagline: 'Untuk Kita',
  description:
    'Koperasi simpan pinjam di Karangasem, Bali. Melayani simpanan berjangka, simpanan harian, dan pinjaman modal usaha sejak 2002.',
  foundedAt: '2002-04-10',
  legal: [
    { label: 'Badan Hukum', value: 'No. 20/BH/KKPUKM/IX/2002', date: '16 September 2002' },
    { label: 'Badan Hukum', value: 'Nomor AHU-003334.AH.01.39.TAHUN 2024', date: '06 Agustus 2024' },
  ],
  locale: 'id-ID',
  timezone: 'Asia/Makassar',
  currency: 'IDR',
  areaServed: ['Karangasem', 'Selat', 'Rendang', 'Bali'],
} as const

export const NAV_MAIN = [
  { label: 'Beranda', href: '/' },
  { label: 'Tentang Kami', href: '/tentang-kami' },
  {
    label: 'Produk',
    href: '/produk',
    children: [
      { label: 'Simpanan', href: '/produk/simpanan' },
      { label: 'Pinjaman', href: '/produk/pinjaman' },
    ],
  },
  { label: 'Berita', href: '/berita' },
  { label: 'Simulasi', href: '/simulasi' },
  { label: 'Karir', href: '/karir' },
  { label: 'Laporan Keuangan', href: '/laporan-keuangan' },
] as const

/**
 * Site-wide chrome that the CMS can edit under Pengaturan → Website. These are
 * the fallbacks the landing page renders when a settings group has never been
 * saved, and the values the seed writes on first run. Keeping them here — not
 * in the landing page — means the CMS form, the seed and the site all agree.
 */
/**
 * A navigation entry.
 *
 * `href` may be empty when the item has children: some groups exist only to
 * open a dropdown ("Tentang", "Layanan") and have no page of their own. The
 * header renders those as a heading that opens on hover rather than a link.
 */
export interface MenuItem { label: string; href: string; children?: MenuItem[] }

/** True when this entry only opens its dropdown and leads nowhere itself. */
export const isMenuGroup = (item: MenuItem): boolean =>
  !item.href.trim() && Boolean(item.children?.length)

export interface HeaderSettings {
  ctaLabel: string
  ctaHref: string
  /** Show the "cari produk" shortcut on wide screens. */
  showProfilingShortcut: boolean
  profilingLabel: string
  /** Sticky announcement above the header. Empty hides it. */
  announcement: string
  announcementHref: string
}

export interface FooterSettings {
  ctaHeading: string
  ctaBody: string
  primaryLabel: string
  primaryHref: string
  secondaryLabel: string
  secondaryHref: string
  showBranches: boolean
  bottomNote: string
}

export interface BrandSettings {
  name: string
  tagline: string
  /** Media URL. Empty renders the built-in leaf mark. */
  logo: string
  logoLight: string
}

export const DEFAULT_HEADER: HeaderSettings = {
  ctaLabel: 'Hubungi Kami',
  ctaHref: 'whatsapp',
  showProfilingShortcut: true,
  profilingLabel: 'Cari produk',
  announcement: '',
  announcementHref: '',
}

export const DEFAULT_FOOTER: FooterSettings = {
  ctaHeading: 'Ada yang bisa kami bantu?',
  ctaBody: 'Petugas kami siap membantu, tanpa biaya konsultasi.',
  primaryLabel: 'Cari produk yang cocok',
  primaryHref: '/profiling',
  secondaryLabel: 'Kunjungi kantor',
  secondaryHref: '/lokasi',
  showBranches: true,
  bottomNote: '',
}

export const DEFAULT_BRAND: BrandSettings = {
  name: SITE.shortName,
  tagline: SITE.tagline,
  logo: '',
  logoLight: '',
}

export const DEFAULT_QUICK_ACCESS = [
  { icon: 'spark', title: 'Cari Produk yang Cocok', body: '4 pertanyaan singkat, ±30 detik', href: '/profiling' },
  { icon: 'calculator', title: 'Simulasi Angsuran', body: 'Hitung perkiraan cicilan bulanan', href: '/simulasi' },
  { icon: 'map-pin', title: 'Kantor Terdekat', body: 'Jam buka, telepon, petunjuk arah', href: '/lokasi' },
]

export const DEFAULT_FOOTER_MENU: MenuItem[] = [
  { label: 'Produk', href: '/produk', children: [
    { label: 'Simpanan', href: '/produk/simpanan' },
    { label: 'Pinjaman', href: '/produk/pinjaman' },
    { label: 'Simulasi Angsuran', href: '/simulasi' },
    { label: 'Cari Produk yang Cocok', href: '/profiling' },
  ] },
  { label: 'Koperasi', href: '/tentang-kami', children: [
    { label: 'Tentang Kami', href: '/tentang-kami' },
    { label: 'Laporan Keuangan', href: '/laporan-keuangan' },
    { label: 'Berita & Artikel', href: '/berita' },
    { label: 'Karir', href: '/karir' },
  ] },
  { label: 'Bantuan', href: '/kontak', children: [
    { label: 'Lokasi Kantor', href: '/lokasi' },
    { label: 'Tanya Jawab', href: '/faq' },
    { label: 'Kontak Kami', href: '/kontak' },
  ] },
]

export const DAY_NAMES_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'] as const

/** Live open/closed state in WITA, independent of the viewer's own clock setting. */
export function getOpenState(
  hours: { day: number; opensAt: string | null; closesAt: string | null }[],
  now: Date = new Date(),
): { isOpen: boolean; label: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SITE.timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const weekdayShort = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon'
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  const dayIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayShort)
  const nowMinutes = hour * 60 + minute

  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const today = hours.find((h) => h.day === dayIdx)

  if (today?.opensAt && today?.closesAt) {
    const open = toMinutes(today.opensAt)
    const close = toMinutes(today.closesAt)
    if (nowMinutes >= open && nowMinutes < close) return { isOpen: true, label: `Buka — tutup ${today.closesAt}` }
    if (nowMinutes < open) return { isOpen: false, label: `Tutup — buka ${today.opensAt}` }
  }

  for (let i = 1; i <= 7; i++) {
    const next = hours.find((h) => h.day === (dayIdx + i) % 7 && h.opensAt)
    if (next?.opensAt) {
      const dayLabel = i === 1 ? 'besok' : DAY_NAMES_ID[next.day]
      return { isOpen: false, label: `Tutup — buka ${dayLabel} ${next.opensAt}` }
    }
  }
  return { isOpen: false, label: 'Tutup' }
}

/** Haversine distance in kilometres. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function waLink(phone: string, message?: string) {
  const digits = phone.replace(/\D/g, '')
  const n = digits.startsWith('62') ? digits : digits.startsWith('0') ? `62${digits.slice(1)}` : digits
  return `https://wa.me/${n}${message ? `?text=${encodeURIComponent(message)}` : ''}`
}

export const telLink = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`

export const directionsLink = (lat: number, lng: number, label?: string) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}${label ? `&destination_place_id=&query=${encodeURIComponent(label)}` : ''}`

/**
 * Icon names the website can draw. The CMS icon picker offers exactly this list,
 * so an editor can never type a name the site does not know.
 */
export const ICON_NAMES = [
  'spark', 'calculator', 'map-pin', 'phone', 'users', 'trending-up', 'wallet', 'handshake', 'piggy-bank', 'award',
  'star', 'shield-check', 'building', 'percent', 'briefcase', 'file-text', 'mail', 'clock', 'compass', 'leaf', 'check',
] as const
export type IconName = (typeof ICON_NAMES)[number]

/** Fixed routes of the website, offered as suggestions wherever a link is picked. */
export const INTERNAL_ROUTES: { href: string; label: string }[] = [
  { href: '/', label: 'Beranda' },
  { href: '/tentang-kami', label: 'Tentang Kami' },
  { href: '/produk', label: 'Semua produk' },
  { href: '/produk/simpanan', label: 'Produk simpanan' },
  { href: '/produk/pinjaman', label: 'Produk pinjaman' },
  { href: '/simulasi', label: 'Simulasi angsuran' },
  { href: '/profiling', label: 'Cari produk yang cocok' },
  { href: '/lokasi', label: 'Lokasi kantor' },
  { href: '/berita', label: 'Berita' },
  { href: '/faq', label: 'Tanya jawab' },
  { href: '/karir', label: 'Karir' },
  { href: '/laporan-keuangan', label: 'Laporan keuangan' },
  { href: '/kontak', label: 'Kontak' },
  { href: 'whatsapp', label: 'WhatsApp koperasi (nomor dari pengaturan)' },
]

/**
 * Resolve a stored media value to something an <img> can load.
 *
 * Image fields store the object key (`media/2026/09/…jpg`), so the same row
 * works whether the bucket is public or still proxied. Absolute URLs and
 * already-proxied paths pass through, so older rows keep rendering.
 *
 * - `publicBase`: the bucket's public URL, once it has a read policy.
 * - `proxyBase`: origin of the website that hosts `/api/media/*` (the console
 *   passes its own website URL; the website passes nothing and stays relative).
 */
export function mediaSrc(value: string | null | undefined, opts: { publicBase?: string; proxyBase?: string } = {}): string {
  if (!value) return ''
  if (/^https?:\/\//.test(value)) return value
  if (value.startsWith('/api/media/')) return `${opts.proxyBase ?? ''}${value}`
  if (value.startsWith('/')) return value
  if (opts.publicBase) return `${opts.publicBase.replace(/\/$/, '')}/${value}`
  return `${opts.proxyBase ?? ''}/api/media/${encodeURIComponent(value)}`
}

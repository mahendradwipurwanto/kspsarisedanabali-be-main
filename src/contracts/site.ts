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

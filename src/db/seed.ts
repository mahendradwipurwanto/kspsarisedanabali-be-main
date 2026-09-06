import 'dotenv/config'

import { randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { SYSTEM_ROLES, DEFAULT_HEADER, DEFAULT_FOOTER, DEFAULT_BRAND, DEFAULT_APPS, DEFAULT_FOOTER_MENU, DEFAULT_QUICK_ACCESS, type SystemRoleKey } from '../contracts/index.js'
import { db, sqlClient } from './index.js'
import * as t from './schema.js'
import { SYSTEM_ROUTE_PAGES } from './system-pages.js'
import { hashPassword } from '../lib/auth.js'

/**
 * Seed with the cooperative's real content, taken from the current site captures
 * in /docs and the legal documents in the revamp proposal.
 *
 * Idempotent: re-running updates rather than duplicating.
 */

const WEEKDAY_HOURS = [
  { day: 1, opensAt: '08:00', closesAt: '15:00' },
  { day: 2, opensAt: '08:00', closesAt: '15:00' },
  { day: 3, opensAt: '08:00', closesAt: '15:00' },
  { day: 4, opensAt: '08:00', closesAt: '15:00' },
  { day: 5, opensAt: '08:00', closesAt: '15:00' },
  { day: 6, opensAt: '08:00', closesAt: '13:00' },
  { day: 0, opensAt: null, closesAt: null },
]

async function seedRoles() {
  console.log('→ roles')
  const out: Record<string, string> = {}
  for (const [key, role] of Object.entries(SYSTEM_ROLES)) {
    const [row] = await db
      .insert(t.roles)
      .values({
        key,
        name: role.name,
        description: role.description,
        permissions: [...role.permissions],
        isLocked: role.locked,
      })
      .onConflictDoUpdate({
        target: t.roles.key,
        set: { name: role.name, description: role.description, permissions: [...role.permissions], updatedAt: new Date() },
      })
      .returning({ id: t.roles.id })
    out[key] = row!.id
  }
  return out as Record<SystemRoleKey, string>
}

async function seedAdmin(roleIds: Record<SystemRoleKey, string>) {
  console.log('→ admin user')
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@sarisedanabali.co.id'

  /**
   * No default password. A literal here would be a known credential for every
   * checkout of this repository, and the one that used to sit in this line was
   * committed. When SEED_ADMIN_PASSWORD is unset we mint a strong random one and
   * print it once — the seed stays runnable, but the credential is never
   * guessable from the source.
   */
  const generated = !process.env.SEED_ADMIN_PASSWORD
  const password = process.env.SEED_ADMIN_PASSWORD ?? `Ksp-${randomBytes(15).toString('base64url')}`

  if (generated) {
    console.log('\n  ┌─ Generated admin password (shown once — save it now) ──────────────')
    console.log(`  │  ${email}`)
    console.log(`  │  ${password}`)
    console.log('  └─ Set SEED_ADMIN_PASSWORD to choose your own instead.\n')
  }

  const hash = await hashPassword(password)

  /**
   * Re-seeding must leave the documented credentials actually working. With
   * `onConflictDoNothing` the printed password silently drifted from the stored
   * hash, so outside production the password is reset to match what we print.
   */
  // The unique index is on lower(email), an expression index, so ON CONFLICT
  // cannot target it by column — look the row up explicitly instead.
  const [existing] = await db
    .select({ id: t.users.id })
    .from(t.users)
    .where(sql`lower(${t.users.email}) = ${email.toLowerCase()}`)
    .limit(1)

  let userId: string
  if (existing) {
    userId = existing.id
    if (process.env.NODE_ENV !== 'production') {
      await db.update(t.users).set({ passwordHash: hash, isActive: true, updatedAt: new Date() }).where(eq(t.users.id, userId))
    }
  } else {
    const [created] = await db
      .insert(t.users)
      .values({ name: 'Administrator', email, passwordHash: hash })
      .returning({ id: t.users.id })
    userId = created!.id
  }
  await db.insert(t.userRoles).values({ userId, roleId: roleIds.super_admin }).onConflictDoNothing()

  // A stale lockout would make a fresh seed look broken.
  await db.delete(t.loginAttempts).where(eq(t.loginAttempts.email, email.toLowerCase()))

  console.log(
    process.env.NODE_ENV === 'production'
      ? `  ${email} (password left untouched in production)`
      : `  ${email} / ${password}  ← CHANGE THIS IMMEDIATELY`,
  )
  return userId
}

async function seedBranches() {
  console.log('→ branches')
  const rows = [
    {
      name: 'Kantor Pusat Selat', slug: 'kantor-pusat-selat', type: 'pusat',
      address: 'Jl. Pering Sari, Br. Siladumi, Desa Peringsari, Kec. Selat, Karangasem, Bali',
      village: 'Peringsari', district: 'Selat',
      phone: '0366 5438200', whatsapp: '081337168194',
      // Approximate — replace with GPS-verified coordinates before launch.
      latitude: -8.4231, longitude: 115.4712,
      sortOrder: 1,
      seo: {
        metaTitle: 'Kantor Pusat KSP Sari Sedana Bali di Selat, Karangasem',
        metaDescription: 'Alamat, jam buka, dan nomor telepon Kantor Pusat KSP Sari Sedana Bali di Desa Peringsari, Kecamatan Selat, Karangasem. Layanan simpanan dan pinjaman.',
      },
    },
    {
      name: 'Kantor Cabang Rendang', slug: 'cabang-rendang', type: 'cabang',
      address: 'Br. Singarata, Kec. Rendang, Karangasem, Bali',
      village: 'Singarata', district: 'Rendang',
      phone: '0366 5510028', whatsapp: '085338435739',
      latitude: -8.3897, longitude: 115.4108,
      sortOrder: 2,
      seo: {
        metaTitle: 'KSP Sari Sedana Bali Cabang Rendang — Koperasi Simpan Pinjam',
        metaDescription: 'Kantor cabang KSP Sari Sedana Bali di Br. Singarata, Kecamatan Rendang, Karangasem. Lihat jam buka, telepon, dan petunjuk arah.',
      },
    },
    {
      name: 'Kantor Cabang Karangasem', slug: 'cabang-karangasem', type: 'cabang',
      address: 'Jl. Raya Veteran, Jalur Sebelas, Padangkerta, Kec. Karangasem, Karangasem, Bali',
      village: 'Padangkerta', district: 'Karangasem',
      phone: '0363 4330027', whatsapp: '082340354660',
      latitude: -8.4489, longitude: 115.6136,
      sortOrder: 3,
      seo: {
        metaTitle: 'KSP Sari Sedana Bali Cabang Karangasem (Amlapura)',
        metaDescription: 'Kantor cabang KSP Sari Sedana Bali di Jl. Raya Veteran, Padangkerta, Amlapura. Jam buka, nomor telepon, dan petunjuk arah.',
      },
    },
  ]

  const ids: Record<string, string> = {}
  for (const r of rows) {
    const [row] = await db
      .insert(t.branches)
      .values({ ...r, hours: WEEKDAY_HOURS, regency: 'Karangasem', province: 'Bali' })
      .onConflictDoUpdate({ target: t.branches.slug, set: { ...r, hours: WEEKDAY_HOURS, updatedAt: new Date() } })
      .returning({ id: t.branches.id })
    ids[r.slug] = row!.id
  }
  return ids
}

/**
 * Brochure artwork carried over from the koperasi's current website (uploaded
 * to the media library, served through the website's media proxy). Keyed by
 * product slug; a product without an entry renders as a terms card.
 */
const PRODUCT_ART: Record<string, string> = {
  'pinjaman-bunga-murah': '/api/media/media%2F2026%2F09%2F01M1MVKB41DD5AK1HZ6FV70KVB-produk-pinjaman-bunga-murah.jpg',
  'pinjaman-mikro': '/api/media/media%2F2026%2F09%2F01M1MVKBHZ5DEHGDMZC8N1SVGP-produk-pinjaman-mikro.jpg',
  'pinjaman-pensiunan': '/api/media/media%2F2026%2F09%2F01M1MVKC1G7T2CQATCNSQB0C69-produk-pinjaman-pensiunan.webp',
  'pinjaman-1-pohon': '/api/media/media%2F2026%2F09%2F01M1MVKCFA4JHK68ZMXQMPD2CT-produk-pinjaman-1-pohon.webp',
  'sijakop': '/api/media/media%2F2026%2F09%2F01M1MVKCS3TZ9SCFXT385CCBY0-produk-simpanan-sijakop.jpg',
  'simapan': '/api/media/media%2F2026%2F09%2F01M1MVKDB4511Z6Y51WYP9359K-produk-simpanan-simapan.jpg',
  'sipura': '/api/media/media%2F2026%2F09%2F01M1MVKDM7WQW80RJ4GNV68E22-produk-simpanan-sipura.jpg',
  'sigemas': '/api/media/media%2F2026%2F09%2F01M1MVKDXF8GDQJ4DNWA7J6A75-produk-simpanan-sigemas.jpg',
  'simpanan-sukarela': '/api/media/media%2F2026%2F09%2F01M1MVKECKKVTTYAZ3EC1Z980P-produk-simpanan-sukarela.jpg',
}

/** Glass-tower photo from the current website's Tentang Kami page; sits under the navy wash behind the hero rate card. */
const HERO_ART = 'media/2026/09/01M1MW4XD38D6017P2PKDS5KP3-gedung-kaca-latar-banner.webp'

/** The leaf mark cropped from the current website's logo. */
const BRAND_MARK = '/api/media/media%2F2026%2F09%2F01M1MVK93R9JS11GGEH098DCCY-mark.png'

async function seedProducts() {
  console.log('→ products')
  const rows = [
    {
      name: 'Simpanan SIJAKOP', slug: 'sijakop', rateSource: 'Bunga 4%–6% per tahun dari halaman produk lama. Plafon dan tenor BELUM diverifikasi.', category: 'simpanan',
      tagline: 'Simpanan Berjangka Koperasi — bunga 4% s/d 6% per tahun',
      summary: 'Simpanan berjangka dengan bunga kompetitif 4%–6% per tahun dan pilihan jangka waktu yang fleksibel.',
      description:
        'Produk Simpanan SIJAKOP (Simpanan Berjangka Koperasi) merupakan solusi investasi yang aman dan menguntungkan bagi Anda yang ingin mengembangkan dana secara optimal. Dengan tingkat bunga kompetitif mulai dari 4% hingga 6% per tahun, produk ini memberikan imbal hasil yang menarik dan stabil.\n\nSIJAKOP menawarkan pilihan jangka waktu yang variatif sehingga Anda dapat menyesuaikan dengan kebutuhan dan rencana keuangan Anda. Simpanan ini juga dapat dijadikan sebagai jaminan kredit prioritas, memberikan fleksibilitas tambahan ketika Anda membutuhkan akses dana tanpa harus mencairkan simpanan.',
      benefits: ['Bunga 4% s/d 6% per tahun', 'Dijamin aman oleh koperasi', 'Bisa dijadikan jaminan kredit prioritas', 'Jangka waktu fleksibel'],
      requirements: ['Fotokopi KTP yang masih berlaku', 'Mengisi formulir pembukaan simpanan', 'Setoran awal sesuai ketentuan', 'Menjadi anggota koperasi'],
      rateMethod: 'none', ratePercent: 6, rateNote: 'Bunga 4%–6% per tahun tergantung jangka waktu',
      minAmount: 1_000_000, maxAmount: 1_000_000_000, tenorOptions: [3, 6, 12, 24],
      purposes: [], sortOrder: 1,
      seo: {
        metaTitle: 'Simpanan Berjangka SIJAKOP — Bunga 4-6% | KSP Sari Sedana Bali',
        metaDescription: 'Simpanan berjangka SIJAKOP dari KSP Sari Sedana Bali Karangasem. Bunga 4%–6% per tahun, bisa jadi jaminan kredit prioritas. Lihat syarat lengkapnya.',
      },
    },
    {
      name: 'Simpanan SIMAPAN', slug: 'simapan', rateSource: 'Belum ada sumber resmi. Suku bunga, plafon, dan tenor WAJIB diisi koperasi sebelum ditayangkan.', category: 'simpanan',
      tagline: 'Simpanan masa depan untuk rencana jangka panjang',
      summary: 'Simpanan terencana untuk mempersiapkan kebutuhan masa depan keluarga Anda.',
      description: 'SIMAPAN adalah simpanan berencana yang membantu Anda menyiapkan dana untuk kebutuhan masa depan — pendidikan anak, upacara adat, atau modal usaha. Setoran rutin setiap bulan dengan imbal hasil yang menarik.',
      benefits: ['Setoran ringan dan terjadwal', 'Membangun kebiasaan menabung', 'Imbal hasil kompetitif', 'Bisa diambil sesuai jangka waktu'],
      requirements: ['Fotokopi KTP', 'Mengisi formulir', 'Setoran rutin bulanan', 'Menjadi anggota koperasi'],
      rateMethod: 'none', ratePercent: 5, minAmount: 100_000, maxAmount: 500_000_000, tenorOptions: [12, 24, 36],
      purposes: ['biaya_pendidikan', 'upacara_adat'], sortOrder: 2,
      seo: {
        metaTitle: 'Simpanan SIMAPAN — Tabungan Berencana | KSP Sari Sedana Bali',
        metaDescription: 'SIMAPAN, simpanan berencana KSP Sari Sedana Bali untuk pendidikan anak, upacara adat, dan modal usaha. Setoran ringan, imbal hasil kompetitif.',
      },
    },
    {
      name: 'Simpanan SIPURA', slug: 'sipura', rateSource: 'Belum ada sumber resmi. Suku bunga, plafon, dan tenor WAJIB diisi koperasi sebelum ditayangkan.', category: 'simpanan',
      tagline: 'Simpanan hari raya',
      summary: 'Simpanan khusus untuk mempersiapkan kebutuhan hari raya dan upacara adat.',
      description: 'SIPURA membantu anggota menyiapkan dana hari raya dan upacara adat Bali secara terencana, sehingga kebutuhan yang datang setiap tahun tidak lagi memberatkan.',
      benefits: ['Dana hari raya tersedia tepat waktu', 'Setoran fleksibel', 'Bebas biaya administrasi bulanan'],
      requirements: ['Fotokopi KTP', 'Mengisi formulir pembukaan simpanan', 'Menjadi anggota koperasi'],
      rateMethod: 'none', ratePercent: 4, minAmount: 50_000, maxAmount: 100_000_000, tenorOptions: [6, 12],
      purposes: ['upacara_adat'], sortOrder: 3,
      seo: {
        metaTitle: 'Simpanan Hari Raya SIPURA | KSP Sari Sedana Bali Karangasem',
        metaDescription: 'SIPURA, simpanan hari raya dari KSP Sari Sedana Bali. Siapkan dana upacara adat dan hari raya secara terencana dengan setoran fleksibel.',
      },
    },
    {
      name: 'Simpanan SIGEMAS', slug: 'sigemas', rateSource: 'Belum ada sumber resmi. Suku bunga, plafon, dan tenor WAJIB diisi koperasi sebelum ditayangkan.', category: 'simpanan',
      tagline: 'Simpanan Generasi Emas — hadiah hingga 75 juta',
      summary: 'Simpanan berhadiah dengan total hadiah mencapai Rp75 juta untuk anggota.',
      description: 'SIGEMAS (Simpanan Generasi Emas) adalah program simpanan berhadiah dari KSP Sari Sedana Bali dengan total hadiah mencapai Rp75 juta. Menabung sambil berkesempatan mendapatkan hadiah menarik.',
      benefits: ['Total hadiah hingga Rp75 juta', 'Simpanan tetap utuh', 'Setoran terjangkau', 'Undian berkala'],
      requirements: ['Fotokopi KTP', 'Mengisi formulir', 'Setoran rutin sesuai program', 'Menjadi anggota koperasi'],
      rateMethod: 'none', ratePercent: 4, minAmount: 100_000, maxAmount: 200_000_000, tenorOptions: [12, 24],
      purposes: [], sortOrder: 4,
      seo: {
        metaTitle: 'SIGEMAS — Simpanan Berhadiah hingga Rp75 Juta | Sari Sedana Bali',
        metaDescription: 'Simpanan Generasi Emas (SIGEMAS) dari KSP Sari Sedana Bali Karangasem. Menabung sambil berkesempatan meraih hadiah total Rp75 juta.',
      },
    },
    {
      name: 'Simpanan Sukarela', slug: 'simpanan-sukarela', rateSource: 'Belum ada sumber resmi. Suku bunga, plafon, dan tenor WAJIB diisi koperasi sebelum ditayangkan.', category: 'simpanan',
      tagline: 'Simpanan harian yang bisa diambil kapan saja',
      summary: 'Simpanan harian dengan penyetoran dan penarikan yang fleksibel.',
      description: 'Simpanan Sukarela adalah simpanan harian anggota yang dapat disetor dan ditarik kapan saja pada jam operasional, cocok untuk kebutuhan sehari-hari maupun dana darurat.',
      benefits: ['Bisa disetor dan ditarik kapan saja', 'Tanpa biaya administrasi', 'Aman dan tercatat rapi'],
      requirements: ['Fotokopi KTP', 'Mengisi formulir', 'Setoran awal minimal Rp50.000'],
      rateMethod: 'none', ratePercent: 3, minAmount: 50_000, maxAmount: 500_000_000, tenorOptions: [],
      purposes: [], sortOrder: 5,
      seo: {
        metaTitle: 'Simpanan Sukarela — Tabungan Harian | KSP Sari Sedana Bali',
        metaDescription: 'Simpanan Sukarela KSP Sari Sedana Bali, tabungan harian yang bisa disetor dan ditarik kapan saja tanpa biaya administrasi bulanan.',
      },
    },
    {
      name: 'Pinjaman Bunga Murah', slug: 'pinjaman-bunga-murah', rateSource: 'Angka 1,3% dari kartu produk homepage lama. Metode, plafon, dan tenor BELUM diverifikasi.', category: 'pinjaman',
      tagline: 'Bunga mulai 1,3% per bulan',
      summary: 'Pinjaman dengan bunga ringan untuk kebutuhan modal usaha dan konsumtif.',
      description: 'Pinjaman Bunga Murah dirancang agar anggota mendapat akses pembiayaan dengan beban bunga yang ringan. Proses pengajuan cepat, syarat mudah, dan didampingi petugas dari pengajuan hingga pencairan.',
      benefits: ['Bunga mulai 1,3% per bulan', 'Proses cepat dan tidak berbelit', 'Didampingi petugas koperasi', 'Angsuran tetap setiap bulan'],
      requirements: ['Fotokopi KTP suami/istri', 'Fotokopi Kartu Keluarga', 'Agunan BPKB/SHM atau simpanan anggota', 'Menjadi anggota koperasi'],
      rateMethod: 'flat', ratePercent: 15.6, rateNote: '1,3% per bulan (15,6% per tahun), metode flat',
      minAmount: 5_000_000, maxAmount: 500_000_000, tenorOptions: [12, 24, 36, 48],
      purposes: ['modal_usaha', 'renovasi_rumah', 'biaya_pendidikan', 'beli_kendaraan', 'kebutuhan_lain'],
      sortOrder: 1,
      seo: {
        metaTitle: 'Pinjaman Bunga Murah 1,3% per Bulan | KSP Sari Sedana Bali',
        metaDescription: 'Pinjaman bunga murah mulai 1,3% per bulan dari KSP Sari Sedana Bali Karangasem. Syarat mudah, proses cepat. Hitung simulasi angsuran Anda di sini.',
      },
    },
    {
      name: 'Pinjaman Mikro', slug: 'pinjaman-mikro', rateSource: 'Belum ada sumber resmi. Suku bunga, plafon, dan tenor WAJIB diisi koperasi sebelum ditayangkan.', category: 'pinjaman',
      tagline: 'Modal usaha untuk pelaku UMKM',
      summary: 'Pembiayaan modal usaha untuk pedagang dan pelaku usaha mikro di Karangasem.',
      description: 'Pinjaman Mikro KSP Sari Sedana Bali ditujukan bagi pelaku usaha mikro yang membutuhkan tambahan modal kerja. Didukung penyaluran dana pemerintah melalui LPDB-KUMKM dan PIP Kementerian Keuangan.',
      benefits: ['Khusus untuk modal usaha produktif', 'Plafon menyesuaikan kapasitas usaha', 'Pendampingan usaha dari petugas', 'Angsuran disesuaikan siklus usaha'],
      requirements: ['Fotokopi KTP suami/istri', 'Fotokopi Kartu Keluarga', 'Bukti usaha berjalan minimal 1 tahun', 'Agunan sesuai ketentuan'],
      rateMethod: 'flat', ratePercent: 18, rateNote: '1,5% per bulan, metode flat',
      minAmount: 2_000_000, maxAmount: 200_000_000, tenorOptions: [12, 24, 36],
      purposes: ['modal_usaha'], sortOrder: 2,
      seo: {
        metaTitle: 'Pinjaman Mikro untuk Modal Usaha UMKM | KSP Sari Sedana Bali',
        metaDescription: 'Pinjaman modal usaha mikro dari KSP Sari Sedana Bali Karangasem, didukung LPDB-KUMKM dan PIP Kemenkeu. Simulasi angsuran dan syarat lengkap.',
      },
    },
    {
      name: 'Pinjaman Pensiunan', slug: 'pinjaman-pensiunan', rateSource: 'Belum ada sumber resmi. Suku bunga, plafon, dan tenor WAJIB diisi koperasi sebelum ditayangkan.', category: 'pinjaman',
      tagline: 'Pembiayaan khusus penerima pensiun',
      summary: 'Pinjaman dengan angsuran dipotong langsung dari manfaat pensiun bulanan.',
      description: 'Pinjaman Pensiunan memberikan akses pembiayaan bagi para pensiunan dengan proses yang sederhana dan angsuran yang dipotong langsung dari manfaat pensiun bulanan.',
      benefits: ['Proses mudah bagi pensiunan', 'Angsuran otomatis dari dana pensiun', 'Jangka waktu panjang', 'Tanpa agunan tambahan'],
      requirements: ['Fotokopi KTP dan Kartu Keluarga', 'SK Pensiun asli', 'Buku rekening penerima pensiun', 'Menjadi anggota koperasi'],
      rateMethod: 'annuity', ratePercent: 14.4, rateNote: '1,2% per bulan, metode anuitas',
      minAmount: 5_000_000, maxAmount: 300_000_000, tenorOptions: [12, 24, 36, 48],
      purposes: ['renovasi_rumah', 'biaya_pendidikan', 'upacara_adat', 'kebutuhan_lain'],
      sortOrder: 3,
      seo: {
        metaTitle: 'Pinjaman Pensiunan — Angsuran Ringan | KSP Sari Sedana Bali',
        metaDescription: 'Pinjaman khusus pensiunan dari KSP Sari Sedana Bali. Angsuran dipotong langsung dari manfaat pensiun, jangka waktu hingga 48 bulan.',
      },
    },
    {
      name: 'Pinjaman 1 Pohon', slug: 'pinjaman-1-pohon', rateSource: 'Angka 0,9% menurun dari banner Pinjaman 1 Pohon. Metode, plafon, dan tenor BELUM diverifikasi.', category: 'pinjaman',
      tagline: 'Suku bunga sampai dengan 0,9% menurun per bulan',
      summary: 'Program pembiayaan bekerja sama dengan BPDLH bagi pemilik pohon kayu, dengan bunga sangat ringan.',
      description: 'Pinjaman 1 Pohon adalah program pembiayaan hasil kerja sama dengan Badan Pengelola Dana Lingkungan Hidup (BPDLH). Ditujukan bagi anggota yang memiliki pohon kayu, dengan suku bunga sampai dengan 0,9% menurun per bulan.',
      benefits: ['Suku bunga sampai 0,9% menurun per bulan', 'Mendukung pelestarian lingkungan', 'Kerja sama resmi dengan BPDLH', 'Syarat agunan fleksibel'],
      requirements: ['Syarat KTP suami/istri', 'Agunan BPKB/SHM atau simpanan anggota', 'Memiliki pohon kayu', 'Menjadi anggota koperasi'],
      rateMethod: 'effective', ratePercent: 10.8, rateNote: '0,9% menurun per bulan',
      minAmount: 5_000_000, maxAmount: 250_000_000, tenorOptions: [12, 24, 36, 48],
      purposes: ['modal_usaha', 'renovasi_rumah', 'kebutuhan_lain'],
      sortOrder: 4,
      seo: {
        metaTitle: 'Pinjaman 1 Pohon — Bunga 0,9% Menurun | KSP Sari Sedana Bali',
        metaDescription: 'Program Pinjaman 1 Pohon bersama BPDLH. Suku bunga sampai dengan 0,9% menurun per bulan untuk pemilik pohon kayu di Karangasem.',
      },
    },
  ]

  const ids: Record<string, string> = {}
  for (const r of rows) {
    const [row] = await db
      .insert(t.products)
      .values({ ...r, image: PRODUCT_ART[r.slug] ?? '' } as typeof t.products.$inferInsert)
      .onConflictDoUpdate({ target: t.products.slug, set: { ...(r as object), image: PRODUCT_ART[r.slug] ?? '', updatedAt: new Date() } })
      .returning({ id: t.products.id })
    ids[r.slug] = row!.id
  }
  return ids
}

async function seedStats() {
  console.log('→ stats')
  const rows = [
    { label: 'Modal', value: 'Rp500M+', icon: 'landmark', sortOrder: 1 },
    { label: 'Anggota', value: '5.000+', icon: 'users', sortOrder: 2 },
    { label: 'SHU', value: 'Rp380M+', icon: 'trending-up', sortOrder: 3 },
    { label: 'Total Aset', value: 'Rp550M+', icon: 'wallet', sortOrder: 4 },
    { label: 'Pinjaman', value: '2.000+', icon: 'handshake', sortOrder: 5 },
    { label: 'Dana Kelolaan', value: 'Rp200M+', icon: 'piggy-bank', sortOrder: 6 },
  ]
  await db.delete(t.stats)
  await db.insert(t.stats).values(rows)
}

async function seedTestimonials() {
  console.log('→ testimonials')
  const rows = [
    { name: 'Bapak Ketut Suryawan', role: 'Pengusaha', location: 'Karangasem', rating: 5, sortOrder: 1,
      quote: 'Pelayanan sangat memuaskan. Proses pengajuan pembiayaan cepat dan tanpa ribet. Tim KSP Sari Sedana sangat profesional dan membantu saya mengembangkan usaha.' },
    { name: 'Ibu Made Dewi', role: 'Guru', location: 'Gianyar', rating: 5, sortOrder: 2,
      quote: 'Sudah 5 tahun menjadi anggota dan sangat puas dengan layanan simpanan. Bunga kompetitif dan bisa diambil kapan saja. Recommended!' },
    { name: 'Bapak Wayan Artha', role: 'Anggota', location: 'Karangasem', rating: 5, sortOrder: 3,
      quote: 'Berkat KSP Sari Sedana, saya bisa mewujudkan impian memiliki rumah sendiri. Cicilan ringan dan prosesnya mudah. Terima kasih!' },
    { name: 'I Made Suardika', role: 'Anggota', location: 'Selat', rating: 5, sortOrder: 4,
      quote: 'Sejak bergabung menjadi anggota KSP Sari Sedana Bali, perkembangan usaha saya semakin terasa. Proses pengajuan pinjaman mudah, pencairan cepat, dan yang paling saya sukai adalah pelayanan yang ramah serta pendampingan yang diberikan.' },
    { name: 'Komang Dharmayasa', role: 'Pelaku UMKM', location: 'Rendang', rating: 5, sortOrder: 5,
      quote: 'KSP Sari Sedana Bali bukan hanya memberikan solusi pembiayaan, tetapi juga memberikan semangat bagi para pelaku usaha untuk terus maju. Pelayanan cepat, bunga yang kompetitif, dan komunikasi yang baik membuat saya semakin yakin menjadi anggota koperasi ini.' },
  ]
  await db.delete(t.testimonials)
  await db.insert(t.testimonials).values(rows)
}

async function seedPostCategories() {
  console.log('→ post categories')
  const rows = [
    { name: 'Pengumuman', slug: 'pengumuman' },
    { name: 'Prestasi', slug: 'prestasi' },
    { name: 'Produk Baru', slug: 'produk-baru' },
    { name: 'Laporan Keuangan', slug: 'laporan-keuangan' },
    { name: 'Kegiatan', slug: 'kegiatan' },
  ]
  const ids: Record<string, string> = {}
  for (const r of rows) {
    const [row] = await db
      .insert(t.postCategories).values(r)
      .onConflictDoUpdate({ target: t.postCategories.slug, set: { name: r.name } })
      .returning({ id: t.postCategories.id })
    ids[r.slug] = row!.id
  }
  return ids
}

async function seedPosts(categoryIds: Record<string, string>, authorId: string) {
  console.log('→ posts')
  const rows = [
    {
      title: 'KSP Sari Sedana Bali Resmikan Gedung Kantor Baru dan Gelar RAT ke-23',
      slug: 'peresmian-gedung-kantor-baru-dan-rat-ke-23',
      excerpt: 'KSP Sari Sedana Bali meresmikan gedung kantor baru sekaligus menggelar Rapat Anggota Tahunan ke-23 sebagai wujud pertumbuhan koperasi.',
      content: '<p>KSP Sari Sedana Bali meresmikan gedung kantor baru sekaligus menggelar Rapat Anggota Tahunan (RAT) ke-23. Kegiatan ini menjadi penanda pertumbuhan koperasi yang konsisten sejak berdiri pada tahun 2002.</p><h2>Komitmen pada anggota</h2><p>Dalam sambutannya, pengurus menegaskan komitmen koperasi untuk terus meningkatkan kualitas layanan kepada anggota melalui prinsip PRIMA: Prioritas, Ramah, Inovatif, Mudah, dan Aman.</p><h2>Rencana ke depan</h2><p>Koperasi juga memaparkan rencana pengembangan layanan digital agar anggota semakin mudah bertransaksi dari mana saja.</p>',
      categoryId: categoryIds.kegiatan, publishedAt: new Date('2026-01-09'), readMinutes: 3,
      seo: { metaTitle: 'Peresmian Gedung Kantor Baru & RAT ke-23 | KSP Sari Sedana Bali', metaDescription: 'KSP Sari Sedana Bali meresmikan gedung kantor baru dan menggelar RAT ke-23 di Karangasem. Simak komitmen dan rencana pengembangan koperasi.' },
    },
    {
      title: 'KSP Sari Sedana Bali: Pertama di Karangasem Miliki ATM Tanpa Kartu',
      slug: 'pertama-di-karangasem-miliki-atm-tanpa-kartu',
      excerpt: 'KSP Sari Sedana Bali menjadi koperasi pertama di Kabupaten Karangasem yang menghadirkan layanan ATM tanpa kartu bagi anggotanya.',
      content: '<p>KSP Sari Sedana Bali menjadi koperasi pertama di Kabupaten Karangasem yang menghadirkan layanan ATM tanpa kartu. Anggota kini dapat menarik dana cukup dengan ponsel, tanpa perlu membawa kartu fisik.</p><h2>Kemudahan bagi anggota</h2><p>Layanan ini melengkapi layanan mobile banking koperasi yang sudah mendukung transfer, pembayaran tagihan, pembelian pulsa, hingga cek saldo.</p>',
      categoryId: categoryIds['produk-baru'], publishedAt: new Date('2026-01-06'), readMinutes: 2,
      seo: { metaTitle: 'Koperasi Pertama di Karangasem dengan ATM Tanpa Kartu', metaDescription: 'KSP Sari Sedana Bali menghadirkan ATM tanpa kartu, pertama di Karangasem. Anggota bisa tarik tunai cukup lewat ponsel.' },
    },
    {
      title: 'Salurkan Rp2 Miliar ke KSP Sari Sedana Bali, PIP Perkuat Komitmen Dukung UMKM',
      slug: 'pip-salurkan-rp2-miliar-dukung-umkm',
      excerpt: 'Pusat Investasi Pemerintah menyalurkan pembiayaan Rp2 miliar kepada KSP Sari Sedana Bali untuk memperkuat pembiayaan UMKM di Karangasem.',
      content: '<p>Pusat Investasi Pemerintah (PIP) Kementerian Keuangan menyalurkan pembiayaan sebesar Rp2 miliar kepada KSP Sari Sedana Bali. Dana ini diteruskan kepada pelaku usaha mikro di Kabupaten Karangasem.</p><h2>Dipercaya menyalurkan dana pemerintah</h2><p>KSP Sari Sedana Bali sebelumnya juga dipercaya menyalurkan dana LPDB-KUMKM. Kepercayaan ini menjadi bukti tata kelola koperasi yang sehat.</p>',
      categoryId: categoryIds.prestasi, publishedAt: new Date('2025-11-20'), readMinutes: 3,
      seo: { metaTitle: 'PIP Salurkan Rp2 Miliar ke KSP Sari Sedana Bali untuk UMKM', metaDescription: 'Pusat Investasi Pemerintah menyalurkan Rp2 miliar ke KSP Sari Sedana Bali guna memperkuat pembiayaan UMKM di Karangasem, Bali.' },
    },
    {
      title: 'KSP Sari Sedana Bali Tumbuh Positif di Semester I',
      slug: 'pertumbuhan-positif-semester-i',
      excerpt: 'Kinerja KSP Sari Sedana Bali mencatatkan pertumbuhan aset dan jumlah anggota yang positif sepanjang semester pertama.',
      content: '<p>KSP Sari Sedana Bali mencatatkan pertumbuhan positif sepanjang semester pertama, baik dari sisi aset, jumlah anggota, maupun penyaluran pembiayaan.</p><h2>Angka pertumbuhan</h2><p>Pertumbuhan ini ditopang oleh kepercayaan anggota dan kualitas layanan yang terus dijaga di seluruh kantor cabang.</p>',
      categoryId: categoryIds['laporan-keuangan'], publishedAt: new Date('2025-08-15'), readMinutes: 2,
      seo: { metaTitle: 'Pertumbuhan Positif KSP Sari Sedana Bali di Semester I', metaDescription: 'Aset dan jumlah anggota KSP Sari Sedana Bali tumbuh positif sepanjang semester pertama. Simak ringkasan kinerja koperasi.' },
    },
  ]

  for (const r of rows) {
    await db
      .insert(t.posts)
      .values({ ...r, status: 'published', authorId } as typeof t.posts.$inferInsert)
      .onConflictDoUpdate({ target: t.posts.slug, set: { ...(r as object), status: 'published', updatedAt: new Date() } })
  }
}

async function seedFaqs() {
  console.log('→ faqs')
  const rows = [
    { question: 'Bagaimana cara menjadi anggota KSP Sari Sedana Bali?', answer: 'Datang ke kantor terdekat dengan membawa fotokopi KTP dan Kartu Keluarga, mengisi formulir pendaftaran, lalu membayar simpanan pokok dan simpanan wajib sesuai ketentuan yang berlaku.', category: 'keanggotaan', sortOrder: 1 },
    { question: 'Apa saja syarat mengajukan pinjaman?', answer: 'Syarat umumnya adalah fotokopi KTP suami/istri, fotokopi Kartu Keluarga, agunan berupa BPKB/SHM atau simpanan anggota, serta terdaftar sebagai anggota koperasi. Syarat detail berbeda untuk setiap produk pinjaman.', category: 'pinjaman', sortOrder: 2 },
    { question: 'Berapa lama proses pencairan pinjaman?', answer: 'Setelah seluruh berkas lengkap dan hasil survei disetujui, proses pencairan umumnya memakan waktu 1–3 hari kerja.', category: 'pinjaman', sortOrder: 3 },
    { question: 'Apakah simulasi angsuran di website ini mengikat?', answer: 'Tidak. Angka yang ditampilkan adalah simulasi awal untuk gambaran, bukan penawaran final. Nominal angsuran resmi ditentukan setelah proses pengajuan dan survei.', category: 'pinjaman', sortOrder: 4 },
    { question: 'Apakah dana simpanan saya aman?', answer: 'Ya. KSP Sari Sedana Bali berbadan hukum resmi No. 20/BH/KKPUKM/IX/2002 dan Nomor AHU-003334.AH.01.39.TAHUN 2024, serta dipercaya menyalurkan dana pemerintah dari LPDB-KUMKM dan PIP Kementerian Keuangan.', category: 'simpanan', sortOrder: 5 },
    { question: 'Di mana saja kantor KSP Sari Sedana Bali?', answer: 'Kami memiliki tiga kantor di Kabupaten Karangasem: Kantor Pusat di Desa Peringsari Kecamatan Selat, Kantor Cabang Rendang, dan Kantor Cabang Karangasem (Amlapura).', category: 'umum', sortOrder: 6 },
    { question: 'Jam berapa kantor buka?', answer: 'Senin sampai Jumat pukul 08.00–15.00 WITA, dan Sabtu pukul 08.00–13.00 WITA. Minggu dan hari libur nasional tutup.', category: 'umum', sortOrder: 7 },
  ]
  await db.delete(t.faqs)
  await db.insert(t.faqs).values(rows)
}

async function seedJobs(branchIds: Record<string, string>) {
  console.log('→ jobs')
  const rows = [
    {
      title: 'Admin / Teller', slug: 'admin-teller', department: 'Operasional',
      employmentType: 'full_time', branchId: branchIds['kantor-pusat-selat'],
      location: 'Selat, Karangasem',
      description: '<p>Bertanggung jawab atas pelayanan transaksi harian anggota di kantor, pencatatan administrasi, dan menjaga kualitas pelayanan sesuai standar koperasi.</p>',
      requirements: ['Wanita', 'Belum menikah', 'Berpenampilan menarik', 'Pendidikan minimal S1', 'Umur maksimal 25 tahun', 'Bisa bekerja dalam tim', 'Siap ditempatkan di semua kantor'],
      seo: { metaTitle: 'Lowongan Admin / Teller di Karangasem | KSP Sari Sedana Bali', metaDescription: 'Lowongan kerja Admin/Teller full time di KSP Sari Sedana Bali, Kecamatan Selat, Karangasem. Lihat kualifikasi dan kirim lamaran online.' },
    },
    {
      title: 'Account Officer', slug: 'account-officer', department: 'Pinjaman',
      employmentType: 'full_time', branchId: branchIds['cabang-karangasem'],
      location: 'Amlapura, Karangasem',
      description: '<p>Melakukan survei calon peminjam, analisa kelayakan pembiayaan, serta pendampingan anggota selama masa pinjaman berjalan.</p>',
      requirements: ['Pria/Wanita maksimal 30 tahun', 'Pendidikan minimal D3', 'Memiliki SIM C dan kendaraan sendiri', 'Menguasai wilayah Karangasem', 'Berpengalaman di bidang pembiayaan menjadi nilai tambah'],
      seo: { metaTitle: 'Lowongan Account Officer Amlapura | KSP Sari Sedana Bali', metaDescription: 'Dibutuhkan Account Officer untuk KSP Sari Sedana Bali Cabang Karangasem (Amlapura). Simak kualifikasi lengkap dan lamar secara online.' },
    },
  ]
  for (const r of rows) {
    await db
      .insert(t.jobs).values(r as typeof t.jobs.$inferInsert)
      .onConflictDoUpdate({ target: t.jobs.slug, set: { ...(r as object), updatedAt: new Date() } })
  }
}

async function seedSettings() {
  console.log('→ settings')
  const values: Record<string, unknown> = {
    site: {
      name: 'KSP Sari Sedana Bali',
      legalName: 'Koperasi Simpan Pinjam Sari Sedana Bali',
      tagline: 'Untuk Kita',
      description: 'Koperasi simpan pinjam di Karangasem, Bali. Melayani simpanan berjangka, simpanan harian, dan pinjaman modal usaha sejak 2002.',
      email: 'info@sarisedanabali.co.id',
      phone: '0366 5438200',
      whatsapp: '081337168194',
    },
    legal: [
      { label: 'Badan Hukum', value: 'No. 20/BH/KKPUKM/IX/2002', date: '16 September 2002' },
      { label: 'Badan Hukum', value: 'Nomor AHU-003334.AH.01.39.TAHUN 2024', date: '06 Agustus 2024' },
    ],
    social: { facebook: '', instagram: '', youtube: '' },
    header: DEFAULT_HEADER,
    footer: DEFAULT_FOOTER,
    apps: DEFAULT_APPS,
    brand: { ...DEFAULT_BRAND, logo: BRAND_MARK, logoLight: BRAND_MARK },
    seoDefaults: {
      titleTemplate: '%s | KSP Sari Sedana Bali',
      defaultTitle: 'KSP Sari Sedana Bali — Koperasi Simpan Pinjam di Karangasem',
      defaultDescription: 'Koperasi Simpan Pinjam Sari Sedana Bali melayani simpanan berjangka, simpanan harian, dan pinjaman modal usaha di Karangasem sejak 2002. Bunga ringan, proses cepat.',
    },
    profile: {
      about: 'Didirikan pada 10 April 2002, Koperasi Sari Sedana Bali telah berkembang menjadi koperasi yang memberikan manfaat nyata bagi anggota dan masyarakat. Kami dipercaya oleh Kementerian Koperasi untuk menyalurkan dana pemerintah, seperti dari LPDB dan PIP Kementerian Keuangan.',
      vision: 'Menjadi Koperasi yang tangguh, unggul dan berprestasi yang memberikan manfaat bagi anggota dan masyarakat.',
      mission: 'Melalui pelayanan PRIMA untuk peningkatan kesejahteraan anggota dan masyarakat.',
      missionPoints: [
        { letter: 'P', text: 'Prioritas layanan kepada anggota' },
        { letter: 'R', text: 'Ramah dalam pelayanan' },
        { letter: 'I', text: 'Inovatif dalam produk' },
        { letter: 'M', text: 'Mudah dalam transaksi' },
        { letter: 'A', text: 'Aman dan menguntungkan' },
      ],
      goals: [
        'Membantu dalam permodalan usaha produktif anggota',
        'Membantu dalam pembinaan usaha anggota dengan melakukan pelatihan dan penyuluhan kepada usaha anggota',
        'Membantu dalam pemasaran produk-produk anggota',
      ],
    },
    organization: [
      { title: 'Penasehat', members: [{ name: 'I Wayan Wijana' }, { name: 'Ni Gusti Agung Putu Widyastuti' }, { name: 'I Ketut Widana' }, { name: 'I Nyoman Mustika' }] },
      { title: 'Pengurus', members: [{ name: 'I Kadek Oka Astika, SE', role: 'Ketua' }, { name: 'Ni Luh Eka Wiantari', role: 'Sekretaris' }, { name: 'I Gede Artama', role: 'Bendahara' }] },
      { title: 'Pengawas', members: [{ name: 'I Wayan Putra', role: 'Ketua' }, { name: 'I Nyoman Gede Widana', role: 'Anggota 1' }, { name: 'Mangku Putu Darma', role: 'Anggota 2' }] },
    ],
  }

  for (const [key, value] of Object.entries(values)) {
    await db.insert(t.settings).values({ key, value }).onConflictDoUpdate({ target: t.settings.key, set: { value, updatedAt: new Date() } })
  }
}

async function seedMenus() {
  console.log('→ menus')
  const main = [
    { label: 'Beranda', href: '/' },
    { label: 'Tentang Kami', href: '/tentang-kami' },
    { label: 'Produk', href: '/produk', children: [{ label: 'Simpanan', href: '/produk/simpanan' }, { label: 'Pinjaman', href: '/produk/pinjaman' }] },
    { label: 'Berita', href: '/berita' },
    { label: 'Simulasi', href: '/simulasi' },
    { label: 'Karir', href: '/karir' },
    { label: 'Laporan Keuangan', href: '/laporan-keuangan' },
  ]
  const footer = DEFAULT_FOOTER_MENU
  for (const [key, items] of [['main', main], ['footer', footer]] as const) {
    await db
      .insert(t.menus).values({ key, name: key === 'main' ? 'Menu Utama' : 'Menu Footer', items })
      .onConflictDoUpdate({ target: t.menus.key, set: { items, updatedAt: new Date() } })
  }
}

async function seedPages(userId: string) {
  // The hero's rate card references a product by id; resolve slugs once here.
  const productRows = await db.select({ id: t.products.id, slug: t.products.slug }).from(t.products)
  const productIds = Object.fromEntries(productRows.map((r) => [r.slug, r.id])) as Record<string, string>
  console.log('→ pages')

  const home = {
    title: 'Beranda',
    slug: '/',
    isSystem: true,
    seo: {
      metaTitle: 'KSP Sari Sedana Bali — Koperasi Simpan Pinjam di Karangasem',
      metaDescription: 'Koperasi Simpan Pinjam Sari Sedana Bali melayani simpanan berjangka, simpanan harian, dan pinjaman modal usaha di Karangasem sejak 2002. Bunga ringan, proses cepat.',
    },
    blocks: [
      { type: 'hero_banner', props: {
        badge: 'Program unggulan',
        autoplay: true,
        interval: 8,
        slides: [
          { image: HERO_ART, heading: 'Pinjaman 1 Pohon', subheading: 'Program pembiayaan bersama BPDLH untuk anggota pemilik pohon kayu. Bunga menurun, syarat sederhana, didampingi petugas dari pengajuan sampai pencairan.',
            bullets: [{ text: 'Suku bunga sampai dengan 0,9% menurun per bulan' }, { text: 'Syarat KTP suami/istri' }, { text: 'Agunan BPKB/SHM atau simpanan anggota' }, { text: 'Memiliki pohon kayu' }],
            ctaLabel: 'Lihat Detail Program', ctaHref: '/produk/pinjaman/pinjaman-1-pohon',
            secondaryLabel: 'Cari produk yang cocok', secondaryHref: '/profiling',
            featuredProduct: productIds['pinjaman-1-pohon'] ?? '' },
          { image: HERO_ART, heading: 'Pinjaman Bunga Murah', subheading: 'Modal usaha, renovasi rumah, atau kebutuhan mendesak dengan angsuran ringan dan proses yang tidak berbelit.',
            bullets: [{ text: 'Proses cepat, syarat mudah' }, { text: 'Didampingi petugas koperasi' }, { text: 'Angsuran tetap setiap bulan' }],
            ctaLabel: 'Hitung Simulasi Angsuran', ctaHref: '/simulasi',
            secondaryLabel: 'Lihat semua pinjaman', secondaryHref: '/produk/pinjaman',
            featuredProduct: productIds['pinjaman-bunga-murah'] ?? '' },
        ],
      } },
      { type: 'quick_access', props: { items: DEFAULT_QUICK_ACCESS } },
      { type: 'stats_counter', props: {
        eyebrow: 'Pencapaian kami', heading: 'Pencapaian Koperasi',
        subtext: 'Wujud nyata pertumbuhan dan komitmen kami melayani anggota dari tahun 2002 sampai saat ini.',
        layout: 'ledger',
        items: [],
      } },
      { type: 'profiling_cta', props: {
        eyebrow: 'Panduan cepat', heading: 'Bingung pilih produk yang mana?',
        body: 'Jawab 4 pertanyaan singkat, kami tunjukkan produk yang paling sesuai beserta simulasi angsurannya.',
        ctaLabel: 'Mulai, ±30 detik', note: 'Tanpa perlu daftar akun.',
      } },
      { type: 'product_grid', props: {
        eyebrow: 'Layanan kami', heading: 'Produk Kami',
        subtext: 'Produk-produk unggulan dari KSP Sari Sedana Bali.',
        category: 'all', limit: 6, ctaLabel: 'Lihat Semua Produk', ctaHref: '/produk',
      } },
      { type: 'cta_banner', props: {
        eyebrow: 'Bersama koperasi', heading: 'Mari Bangkitkan Ekonomi Kerakyatan',
        body: 'Bergabunglah bersama lebih dari 5.000 anggota yang telah merasakan manfaat nyata dari koperasi.',
        ctaLabel: 'Hubungi Kami', ctaHref: '/kontak', secondaryLabel: 'Cari produk', secondaryHref: '/profiling', variant: 'image', image: '',
      } },
      { type: 'branch_finder', props: {
        eyebrow: 'Kantor kami', heading: 'Kantor Terdekat dari Anda',
        body: 'Tiga kantor kami siap melayani. Lihat mana yang paling dekat, sedang buka, dan bagaimana cara ke sana.',
        showMap: true,
      } },
      { type: 'news_list', props: {
        eyebrow: 'Informasi terbaru', heading: 'Berita Terkini',
        subtext: 'Ikuti perkembangan terbaru dan informasi penting dari KSP Sari Sedana Bali.',
        limit: 3, ctaLabel: 'Lihat Semua Berita',
      } },
      { type: 'lead_form', props: {
        eyebrow: 'Masukan Anda', heading: 'Tertarik? Petugas Kami', headingAccent: 'Siap Membantu',
        body: 'Tinggalkan nama dan nomor WhatsApp Anda. Petugas cabang terdekat akan menghubungi dalam 1×24 jam kerja — tanpa biaya konsultasi.',
        formTitle: 'Kirim Permintaan',
        statValue: '500+', statLabel: 'Calon Nasabah Terlayani',
        statNote: 'Setiap permintaan ditindaklanjuti petugas cabang terdekat.',
        askProduct: true, askBranch: true,
        successMessage: 'Terima kasih. Petugas kami akan menghubungi Anda dalam 1×24 jam kerja.',
        benefits: [
          { title: 'Dihubungi dalam 1×24 jam', body: 'Petugas cabang terdekat yang akan menghubungi Anda.' },
          { title: 'Tanpa biaya konsultasi', body: 'Tanya dulu sepuasnya sebelum memutuskan.' },
          { title: 'Data Anda aman', body: 'Hanya dipakai untuk menghubungi Anda, tidak dibagikan ke pihak lain.' },
        ],
      } },
      { type: 'testimonial_slider', props: {
        eyebrow: 'Testimoni', heading: 'Apa Kata Mereka?',
        subtext: 'Kepercayaan anggota adalah aset terbesar kami. Dengar langsung pengalaman mereka bersama KSP Sari Sedana Bali.',
        limit: 3,
      } },
    ],
  }

  const about = {
    title: 'Tentang Kami',
    slug: 'tentang-kami',
    isSystem: true,
    seo: {
      metaTitle: 'Tentang KSP Sari Sedana Bali — Profil & Sejarah Koperasi',
      metaDescription: 'Profil KSP Sari Sedana Bali, koperasi simpan pinjam di Karangasem yang berdiri sejak 10 April 2002. Kenali visi, misi PRIMA, dan struktur pengurus kami.',
    },
    blocks: [
      { type: 'page_header', props: {
        eyebrow: 'Tentang kami', heading: 'Koperasi yang Tumbuh Bersama Anggotanya Sejak 2002',
        subheading: 'Didirikan pada 10 April 2002 di Karangasem, KSP Sari Sedana Bali berkembang menjadi koperasi yang memberikan manfaat nyata bagi anggota dan masyarakat.',
        align: 'left',
      } },
      { type: 'rich_text', props: { width: 'narrow', body: '<p>Didirikan pada 10 April 2002, Koperasi Sari Sedana Bali telah berkembang menjadi koperasi yang memberikan manfaat nyata bagi anggota dan masyarakat. Visi kami adalah menjadi koperasi yang tangguh, mandiri, dan memberikan manfaat bagi anggota serta masyarakat dengan semangat pelayanan PRIMA.</p><p>Kami dipercaya oleh Kementerian Koperasi untuk menyalurkan dana pemerintah, seperti dari <strong>LPDB</strong> dan <strong>PIP Kementerian Keuangan</strong>. Koperasi kami menawarkan berbagai <a href="/produk/simpanan">produk simpanan</a> dan <a href="/produk/pinjaman">produk pinjaman</a> yang mendukung pertumbuhan usaha anggota.</p><p>Demi keamanan, kenyamanan, dan kecepatan dalam bertransaksi, KSP Sari Sedana Bali juga menyediakan layanan mobile untuk semua transaksi perbankan seperti transfer uang, pembayaran tagihan, pembelian pulsa, hingga cek saldo — dapat dilakukan langsung dari ponsel Anda kapan saja dan di mana saja.</p><p>KSP Sari Sedana berkomitmen sosial melalui program CSR, seperti bantuan untuk siswa kurang mampu, pembagian sembako, dan program orang tua asuh untuk anak yatim/piatu.</p>' } },
      { type: 'feature_grid', props: {
        eyebrow: 'Pelayanan prima', heading: 'Lima Prinsip yang Kami Pegang', columns: '3',
        items: [
          { icon: 'star', title: 'Prioritas', body: 'Prioritas layanan kepada anggota.' },
          { icon: 'heart', title: 'Ramah', body: 'Ramah dalam pelayanan.' },
          { icon: 'lightbulb', title: 'Inovatif', body: 'Inovatif dalam produk.' },
          { icon: 'zap', title: 'Mudah', body: 'Mudah dalam transaksi.' },
          { icon: 'shield-check', title: 'Aman', body: 'Aman dan menguntungkan.' },
        ],
      } },
      { type: 'org_chart', props: { heading: 'Struktur Organisasi', groups: [] } },
      { type: 'accordion', props: {
        heading: 'Legalitas & Perizinan', isFaq: false,
        items: [
          { title: 'Badan Hukum Koperasi', body: '<p>No. 20/BH/KKPUKM/IX/2002, tanggal 16 September 2002.</p>' },
          { title: 'Pengesahan Kemenkumham', body: '<p>Nomor AHU-003334.AH.01.39.TAHUN 2024, tanggal 06 Agustus 2024.</p>' },
        ],
      } },
    ],
  }

  const contact = {
    title: 'Kontak Kami',
    slug: 'kontak',
    isSystem: true,
    seo: {
      metaTitle: 'Kontak & Lokasi Kantor KSP Sari Sedana Bali di Karangasem',
      metaDescription: 'Hubungi KSP Sari Sedana Bali. Alamat, nomor telepon, dan jam buka tiga kantor kami di Selat, Rendang, dan Amlapura, Karangasem.',
    },
    blocks: [
      { type: 'page_header', props: {
        eyebrow: 'Kontak', heading: 'Hubungi Kantor Terdekat dari Anda',
        subheading: 'Tiga kantor kami di Karangasem siap melayani. Pilih yang paling dekat, telepon langsung, atau tinggalkan pesan di bawah.',
        align: 'left',
      } },
      { type: 'branch_finder', props: { heading: 'Pilih Kantor', body: '', showMap: true } },
      { type: 'lead_form', props: {
        eyebrow: 'Tinggalkan pesan', heading: 'Ada yang Ingin Ditanyakan?',
        body: 'Isi formulir di bawah ini. Petugas kami akan menghubungi Anda lewat WhatsApp dalam 1×24 jam kerja.',
        askProduct: true, askBranch: true,
        successMessage: 'Terima kasih. Pesan Anda sudah kami terima dan petugas akan menghubungi dalam 1×24 jam kerja.',
        benefits: [],
      } },
    ],
  }


  for (const p of [home, about, contact, ...SYSTEM_ROUTE_PAGES]) {
    const [row] = await db
      .insert(t.pages)
      .values({ title: p.title, slug: p.slug, status: 'published', isSystem: p.isSystem, seo: p.seo, publishedAt: new Date(), createdById: userId, updatedById: userId })
      .onConflictDoUpdate({ target: t.pages.slug, set: { title: p.title, seo: p.seo, status: 'published', updatedAt: new Date() } })
      .returning({ id: t.pages.id })

    await db.delete(t.pageBlocks).where(eq(t.pageBlocks.pageId, row!.id))
    await db.insert(t.pageBlocks).values(
      p.blocks.map((b, i) => ({ pageId: row!.id, type: b.type, props: b.props as Record<string, unknown>, position: i, isVisible: true })),
    )
  }
}

async function seedRedirects() {
  console.log('→ redirects (WordPress paths)')
  const rows = [
    { fromPath: '/tentang', toPath: '/tentang-kami', statusCode: 301, note: 'WP: menu Tentang' },
    { fromPath: '/produk-simpanan', toPath: '/produk/simpanan', statusCode: 301, note: 'WP: arsip produk simpanan' },
    { fromPath: '/produk-pinjaman', toPath: '/produk/pinjaman', statusCode: 301, note: 'WP: arsip produk pinjaman' },
    // The security finding from the audit: the old admin doors return 410 Gone.
    { fromPath: '/wp-admin', toPath: '/', statusCode: 410, note: 'Temuan keamanan: tutup pintu masuk WP' },
    { fromPath: '/wp-login.php', toPath: '/', statusCode: 410, note: 'Temuan keamanan: tutup pintu masuk WP' },
    { fromPath: '/xmlrpc.php', toPath: '/', statusCode: 410, note: 'Temuan keamanan' },
    { fromPath: '/feed', toPath: '/rss.xml', statusCode: 301, note: 'WP feed' },
  ]
  for (const r of rows) {
    await db.insert(t.redirects).values(r).onConflictDoUpdate({ target: t.redirects.fromPath, set: { toPath: r.toPath, statusCode: r.statusCode } })
  }
}

async function main() {
  console.log('\n═══ Seeding KSP Sari Sedana Bali ═══\n')
  const roleIds = await seedRoles()
  const branchIds = await seedBranches()
  const userId = await seedAdmin(roleIds)
  await seedProducts()
  await seedStats()
  await seedTestimonials()
  const categoryIds = await seedPostCategories()
  await seedPosts(categoryIds, userId)
  await seedFaqs()
  await seedJobs(branchIds)
  await seedSettings()
  await seedMenus()
  await seedPages(userId)
  await seedRedirects()
  console.log('\n✓ Seed complete\n')
  await sqlClient.end()
}

main().catch(async (err) => {
  console.error('\n✗ Seed failed:', err)
  await sqlClient.end().catch(() => {})
  process.exit(1)
})

void sql

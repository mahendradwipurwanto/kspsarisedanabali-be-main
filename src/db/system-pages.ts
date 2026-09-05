/**
 * The site's fixed routes, as ordinary CMS pages.
 *
 * /produk, /berita, /lokasi and the rest render whatever blocks these carry, so
 * their sections, order and copy are edited in Halaman like any other page.
 * They are marked `isSystem`, which the API refuses to delete: an editor can
 * change them freely but cannot leave a route pointing at nothing.
 *
 * `seed` writes them on a fresh database; `sync-system-pages` adds any that are
 * missing from an existing one, without touching pages already there.
 */
export interface SystemPage {
  title: string
  slug: string
  isSystem: true
  seo: Record<string, string>
  blocks: { type: string; props: Record<string, unknown> }[]
}

export const SYSTEM_ROUTE_PAGES: SystemPage[] = [
  {
    title: 'Produk',
    slug: 'produk',
    isSystem: true,
    seo: {
      metaTitle: 'Produk Simpanan & Pinjaman KSP Sari Sedana Bali',
      metaDescription:
        'Lihat seluruh produk KSP Sari Sedana Bali: simpanan berjangka SIJAKOP, SIMAPAN, SIPURA, SIGEMAS, serta pinjaman bunga murah, mikro, pensiunan, dan Pinjaman 1 Pohon.',
    },
    blocks: [
      { type: 'page_header', props: {
        eyebrow: 'Layanan kami',
        heading: 'Produk Simpanan dan Pinjaman untuk Warga Karangasem',
        subheading: 'Sembilan produk untuk kebutuhan menabung maupun pembiayaan usaha. Belum yakin yang mana? Jawab 4 pertanyaan singkat dan kami tunjukkan yang paling sesuai.',
        align: 'left',
      } },
      { type: 'product_grid', props: {
        eyebrow: 'Pembiayaan',
        heading: 'Produk Pinjaman',
        subtext: 'Pembiayaan untuk modal usaha, renovasi rumah, pendidikan, upacara adat, dan kebutuhan lainnya.',
        category: 'pinjaman', layout: 'rows', limit: 12,
        ctaLabel: 'Hitung simulasi angsuran', ctaHref: '/simulasi',
      } },
      { type: 'product_grid', props: {
        eyebrow: 'Menabung',
        heading: 'Produk Simpanan',
        subtext: 'Simpanan berjangka maupun harian, dengan imbal hasil yang kompetitif dan dana yang aman.',
        category: 'simpanan', layout: 'rows', limit: 12,
        ctaLabel: 'Lihat tabel simpanan', ctaHref: '/simulasi?jenis=simpanan',
      } },
      { type: 'profiling_cta', props: {
        eyebrow: 'Panduan cepat',
        heading: 'Bingung pilih produk yang mana?',
        body: 'Jawab 4 pertanyaan singkat, kami tunjukkan produk yang paling sesuai beserta simulasi angsurannya.',
        ctaLabel: 'Mulai, ±30 detik', ctaHref: '/profiling', note: 'Tanpa perlu daftar akun.',
      } },
    ],
  },
  {
    title: 'Produk Simpanan',
    slug: 'produk-simpanan',
    isSystem: true,
    seo: {
      metaTitle: 'Produk Simpanan Koperasi di Karangasem',
      metaDescription:
        'Pilihan produk simpanan KSP Sari Sedana Bali: SIJAKOP berjangka, SIMAPAN berencana, SIPURA hari raya, SIGEMAS berhadiah, dan Simpanan Sukarela harian.',
    },
    blocks: [
      { type: 'page_header', props: {
        eyebrow: 'Produk simpanan',
        heading: 'Produk Simpanan KSP Sari Sedana Bali di Karangasem',
        subheading:
          'Simpanan berjangka dan simpanan harian dengan imbal hasil kompetitif. Dana Anda aman di koperasi berbadan hukum resmi yang dipercaya menyalurkan dana pemerintah.',
        align: 'left',
      } },
      { type: 'product_grid', props: {
        eyebrow: '', heading: 'Semua produk simpanan', subtext: '',
        category: 'simpanan', layout: 'rows', limit: 24,
        ctaLabel: 'Lihat tabel simpanan', ctaHref: '/simulasi?jenis=simpanan',
      } },
      { type: 'profiling_cta', props: {
        eyebrow: 'Panduan cepat',
        heading: 'Belum yakin simpanan mana yang cocok?',
        body: 'Jawab 4 pertanyaan singkat, kami tunjukkan produk yang paling sesuai beserta perkiraan hasilnya.',
        ctaLabel: 'Mulai, ±30 detik', ctaHref: '/profiling', note: 'Tanpa perlu daftar akun.',
      } },
    ],
  },
  {
    title: 'Produk Pinjaman',
    slug: 'produk-pinjaman',
    isSystem: true,
    seo: {
      metaTitle: 'Produk Pinjaman Koperasi di Karangasem',
      metaDescription:
        'Pilihan produk pinjaman KSP Sari Sedana Bali Karangasem: pinjaman bunga murah, pinjaman mikro untuk UMKM, pinjaman pensiunan, dan Pinjaman 1 Pohon bersama BPDLH.',
    },
    blocks: [
      { type: 'page_header', props: {
        eyebrow: 'Produk pinjaman',
        heading: 'Produk Pinjaman KSP Sari Sedana Bali di Karangasem',
        subheading:
          'Pembiayaan untuk modal usaha, renovasi rumah, pendidikan, upacara adat, dan kebutuhan lainnya, dengan angsuran yang bisa dihitung sendiri sebelum mengajukan.',
        align: 'left',
      } },
      { type: 'product_grid', props: {
        eyebrow: '', heading: 'Semua produk pinjaman', subtext: '',
        category: 'pinjaman', layout: 'rows', limit: 24,
        ctaLabel: 'Hitung simulasi angsuran', ctaHref: '/simulasi',
      } },
      { type: 'profiling_cta', props: {
        eyebrow: 'Panduan cepat',
        heading: 'Belum yakin pinjaman mana yang cocok?',
        body: 'Jawab 4 pertanyaan singkat, kami tunjukkan produk yang paling sesuai beserta simulasi angsurannya.',
        ctaLabel: 'Mulai, ±30 detik', ctaHref: '/profiling', note: 'Tanpa perlu daftar akun.',
      } },
    ],
  },
  {
    title: 'Berita',
    slug: 'berita',
    isSystem: true,
    seo: {
      metaTitle: 'Berita & Informasi Terbaru KSP Sari Sedana Bali',
      metaDescription:
        'Kabar terbaru dari KSP Sari Sedana Bali: pengumuman koperasi, produk baru, prestasi, laporan kinerja, dan kegiatan di Karangasem.',
    },
    blocks: [
      { type: 'page_header', props: {
        eyebrow: 'Informasi terbaru',
        heading: 'Berita dan Informasi KSP Sari Sedana Bali',
        subheading: 'Pengumuman koperasi, peluncuran produk, prestasi, dan kegiatan terbaru dari tiga kantor kami di Karangasem.',
        align: 'left',
      } },
      { type: 'post_index', props: { eyebrow: '', heading: '', subtext: '', perPage: 9 } },
    ],
  },
  {
    title: 'Lokasi Kantor',
    slug: 'lokasi',
    isSystem: true,
    seo: {
      metaTitle: 'Lokasi Kantor KSP Sari Sedana Bali di Karangasem',
      metaDescription:
        'Tiga kantor KSP Sari Sedana Bali di Karangasem: Kantor Pusat Selat, Cabang Rendang, dan Cabang Karangasem. Lihat alamat, jam buka, nomor telepon, dan petunjuk arah.',
    },
    blocks: [
      { type: 'page_header', props: {
        eyebrow: 'Lokasi kantor',
        heading: 'Temukan Kantor KSP Sari Sedana Bali Terdekat',
        subheading: 'Tiga kantor kami tersebar di Kabupaten Karangasem. Izinkan lokasi Anda dan kami urutkan dari yang paling dekat, lengkap dengan status buka-tutup dan petunjuk arah.',
        align: 'left',
      } },
      { type: 'branch_finder', props: {
        eyebrow: 'Kantor kami',
        heading: 'Pilih Kantor Terdekat',
        body: 'Ketik nama kecamatan, atau izinkan lokasi Anda untuk mengurutkan dari yang paling dekat.',
        showMap: true,
      } },
    ],
  },
  {
    title: 'Karir',
    slug: 'karir',
    isSystem: true,
    seo: {
      metaTitle: 'Lowongan Kerja KSP Sari Sedana Bali di Karangasem',
      metaDescription:
        'Peluang karir di KSP Sari Sedana Bali, koperasi simpan pinjam di Karangasem. Lihat lowongan yang tersedia dan kirim lamaran Anda secara online.',
    },
    blocks: [
      { type: 'page_header', props: {
        eyebrow: 'Karir',
        heading: 'Bergabung dan Bertumbuh Bersama Kami',
        subheading: 'KSP Sari Sedana Bali telah melayani anggota di Karangasem sejak 2002. Kami mencari orang-orang yang ingin ikut membangun ekonomi kerakyatan di daerahnya sendiri.',
        align: 'left',
      } },
      { type: 'job_list', props: { eyebrow: '', heading: '', subtext: '' } },
    ],
  },
  {
    title: 'Tanya Jawab',
    slug: 'faq',
    isSystem: true,
    seo: {
      metaTitle: 'Tanya Jawab Seputar KSP Sari Sedana Bali',
      metaDescription:
        'Jawaban atas pertanyaan yang paling sering diajukan: cara menjadi anggota, syarat pinjaman, lama proses pencairan, keamanan simpanan, jam buka, dan lokasi kantor.',
    },
    blocks: [
      { type: 'page_header', props: {
        eyebrow: 'Tanya jawab',
        heading: 'Pertanyaan yang Sering Diajukan',
        subheading: 'Jawaban singkat untuk hal-hal yang paling sering ditanyakan calon anggota. Belum terjawab? Hubungi kantor terdekat.',
        align: 'left',
      } },
      { type: 'faq_index', props: {
        eyebrow: '', heading: '', category: 'all', grouped: true,
        ctaHeading: 'Masih ada yang ingin ditanyakan?',
        ctaBody: 'Petugas kami siap membantu lewat telepon, WhatsApp, atau di kantor cabang terdekat.',
        primaryLabel: 'Hubungi kami', primaryHref: '/kontak',
        secondaryLabel: 'Lihat kantor terdekat', secondaryHref: '/lokasi',
      } },
    ],
  },
  {
    title: 'Laporan Keuangan',
    slug: 'laporan-keuangan',
    isSystem: true,
    seo: {
      metaTitle: 'Laporan Keuangan & Kinerja KSP Sari Sedana Bali',
      metaDescription:
        'Transparansi kinerja KSP Sari Sedana Bali: laporan keuangan tahunan, hasil Rapat Anggota Tahunan, dan ringkasan pencapaian koperasi di Karangasem.',
    },
    blocks: [
      { type: 'page_header', props: {
        eyebrow: 'Transparansi',
        heading: 'Laporan Keuangan KSP Sari Sedana Bali',
        subheading: 'Sebagai koperasi yang dipercaya menyalurkan dana pemerintah dari LPDB-KUMKM dan PIP Kementerian Keuangan, kami membuka kinerja keuangan kepada anggota dan masyarakat.',
        align: 'left',
      } },
      { type: 'stats_counter', props: {
        eyebrow: 'Ringkasan kinerja',
        heading: 'Angka Pokok Koperasi',
        subtext: 'Angka-angka pokok yang menggambarkan posisi koperasi saat ini.',
        layout: 'ledger', items: [],
      } },
      { type: 'document_list', props: { eyebrow: 'Unduhan', heading: 'Dokumen Laporan', category: 'all' } },
    ],
  },
  {
    title: 'Simulasi',
    slug: 'simulasi',
    isSystem: true,
    seo: {
      metaTitle: 'Simulasi Angsuran & Hasil Simpanan Koperasi',
      metaDescription:
        'Hitung angsuran pinjaman dan hasil simpanan KSP Sari Sedana Bali. Tabel resmi SIGEMAS, SIMAPAN, dan SIPURA, lengkap dengan bunga dan reward yang berlaku.',
    },
    blocks: [
      { type: 'page_header', props: {
        eyebrow: 'Kalkulator',
        heading: 'Simulasi Angsuran dan Hasil Simpanan',
        subheading: 'Hitung angsuran pinjaman, atau lihat hasil simpanan SIGEMAS, SIMAPAN, dan SIPURA menurut tabel resmi koperasi.',
        align: 'left',
      } },
      { type: 'simulation_tabs', props: {
        defaultTab: 'pinjaman',
        disclaimer: 'Simulasi awal, bukan penawaran final. Angka resmi ditentukan setelah pengajuan dan survei oleh petugas.',
      } },
      { type: 'faq_index', props: {
        eyebrow: 'Tanya jawab',
        heading: 'Pertanyaan seputar pinjaman dan simpanan',
        category: 'pinjaman', grouped: false, ctaHeading: '',
      } },
    ],
  },
  {
    title: 'Cari Produk yang Cocok',
    slug: 'profiling',
    isSystem: true,
    seo: {
      metaTitle: 'Cari Produk Koperasi yang Cocok',
      metaDescription:
        'Jawab 4 pertanyaan singkat dan KSP Sari Sedana Bali menunjukkan produk simpanan atau pinjaman yang paling sesuai, lengkap dengan simulasi angsuran. Tanpa daftar akun.',
    },
    blocks: [
      { type: 'page_header', props: {
        eyebrow: 'Panduan cepat',
        heading: 'Temukan Produk yang Paling Sesuai untuk Anda',
        subheading: 'Empat pertanyaan singkat, sekitar 30 detik. Kami tunjukkan produk yang cocok beserta perkiraan angsurannya.',
        align: 'center',
      } },
      { type: 'profiling_wizard', props: {} },
    ],
  },
]

import { field, fieldsToZod, defaultsFor, type FieldMap } from '../fields.js'

/**
 * Block registry.
 *
 * `headingLevel` is owned here, not by the editor. That is what permanently fixes
 * the audit finding "judul besar dan sub-judul dipakai bergantian tanpa urutan yang
 * jelas" — a page can only ever emit one H1, and it comes from the page title block.
 */

export type BlockCategory = 'Utama' | 'Konten' | 'Produk' | 'Konversi' | 'Media'

export interface BlockDef {
  type: string
  label: string
  description: string
  category: BlockCategory
  icon: string
  /** Heading tag this block renders for its main title. `null` = renders no heading. */
  headingLevel: 'h1' | 'h2' | 'h3' | null
  /** Only one instance allowed per page (e.g. the H1 block). */
  singleton?: boolean
  fields: FieldMap
}

const def = <T extends BlockDef>(b: T) => b

export const BLOCKS = {
  page_header: def({
    type: 'page_header',
    label: 'Judul Halaman',
    description: 'Judul utama halaman. Setiap halaman hanya boleh punya satu.',
    category: 'Utama',
    icon: 'heading',
    headingLevel: 'h1',
    singleton: true,
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas judul', max: 40, placeholder: 'TENTANG KAMI' }),
      heading: field.text({ label: 'Judul utama (H1)', required: true, max: 70, help: 'Ini judul terpenting untuk Google. Sertakan kata yang dicari calon nasabah.' }),
      subheading: field.textarea({ label: 'Penjelasan singkat', max: 220, rows: 3 }),
      align: field.select({ label: 'Perataan', options: [{ value: 'left', label: 'Kiri' }, { value: 'center', label: 'Tengah' }], default: 'left' }),
    },
  }),

  hero_banner: def({
    type: 'hero_banner',
    label: 'Banner Utama',
    description: 'Banner besar di paling atas beranda, bisa lebih dari satu slide.',
    category: 'Utama',
    icon: 'image',
    headingLevel: 'h1',
    singleton: true,
    fields: {
      badge: field.text({ label: 'Label kecil di atas judul', max: 40, default: 'Program unggulan', help: 'Muncul sebagai lencana kecil. Kosongkan untuk menyembunyikan.' }),
      slides: field.repeater({
        label: 'Slide banner', itemLabel: 'Slide', min: 1, max: 6,
        of: {
          image: field.image({ label: 'Gambar banner', help: 'Ukuran ideal 1600×900 piksel. Kosongkan untuk latar polos bermotif.' }),
          heading: field.text({ label: 'Judul di banner', required: true, max: 70 }),
          subheading: field.textarea({ label: 'Kalimat pendukung', max: 180 }),
          bullets: field.repeater({ label: 'Poin keunggulan', itemLabel: 'Poin', max: 5, of: { text: field.text({ label: 'Teks', required: true, max: 90 }) } }),
          ctaLabel: field.text({ label: 'Tulisan tombol utama', max: 30, placeholder: 'Ajukan Sekarang' }),
          ctaHref: field.link({ label: 'Tombol utama menuju ke', placeholder: '/produk/pinjaman' }),
          secondaryLabel: field.text({ label: 'Tulisan tombol kedua', max: 30, placeholder: 'Cari produk yang cocok' }),
          secondaryHref: field.link({ label: 'Tombol kedua menuju ke', placeholder: '/profiling' }),
          featuredProduct: field.reference({ label: 'Produk yang ditampilkan di kartu angka', to: 'product', help: 'Kartu di sisi kanan menampilkan suku bunga, plafon, dan tenor produk ini. Kosongkan untuk memakai poin keunggulan saja.' }),
        },
      }),
      autoplay: field.boolean({ label: 'Ganti slide otomatis', default: true }),
      interval: field.number({ label: 'Jeda antar slide (detik)', min: 3, max: 30, default: 8 }),
    },
  }),


  quick_access: def({
    type: 'quick_access',
    label: 'Akses Cepat',
    description: 'Tiga pintasan di bawah banner: profiling, simulasi, kantor terdekat.',
    category: 'Konversi',
    icon: 'zap',
    headingLevel: null,
    fields: {
      items: field.repeater({
        label: 'Pintasan', itemLabel: 'Pintasan', min: 1, max: 4,
        of: {
          icon: field.icon({ label: 'Ikon', default: 'spark' }),
          title: field.text({ label: 'Judul', required: true, max: 40 }),
          body: field.text({ label: 'Keterangan singkat', max: 60 }),
          href: field.link({ label: 'Menuju ke', required: true }),
        },
      }),
    },
  }),

  legality_bar: def({
    type: 'legality_bar',
    label: 'Bar Legalitas',
    description: 'Nomor badan hukum dan logo mitra resmi.',
    category: 'Utama',
    icon: 'shield-check',
    headingLevel: null,
    fields: {
      items: field.repeater({
        label: 'Baris legalitas', itemLabel: 'Baris', max: 4,
        of: { label: field.text({ label: 'Keterangan', required: true, max: 40 }), value: field.text({ label: 'Nomor / tanggal', required: true, max: 80 }) },
      }),
      partnerLogos: field.repeater({ label: 'Logo mitra', itemLabel: 'Logo', max: 6, of: { image: field.image({ label: 'Logo', required: true }), alt: field.text({ label: 'Nama mitra', required: true, max: 60 }) } }),
    },
  }),

  branch_contact_strip: def({
    type: 'branch_contact_strip',
    label: 'Strip Kontak Kantor',
    description: 'Tiga kantor dengan alamat dan nomor telepon yang bisa langsung ditekan.',
    category: 'Konversi',
    icon: 'map-pin',
    headingLevel: null,
    fields: { branches: field.reference({ label: 'Kantor yang ditampilkan', to: 'branch', multiple: true, help: 'Kosongkan untuk menampilkan semua kantor.' }) },
  }),

  stats_counter: def({
    type: 'stats_counter',
    label: 'Pencapaian Koperasi',
    description: 'Deretan angka pencapaian seperti jumlah anggota dan total aset.',
    category: 'Konten',
    icon: 'trending-up',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40, default: 'PENCAPAIAN KAMI' }),
      heading: field.text({ label: 'Judul bagian', required: true, max: 60, default: 'Pencapaian Koperasi' }),
      subtext: field.textarea({ label: 'Penjelasan singkat', max: 200, rows: 2 }),
      layout: field.select({ label: 'Tampilan', options: [{ value: 'ledger', label: 'Baris angka (rapi, seperti laporan)' }, { value: 'cards', label: 'Kartu dengan ikon' }], default: 'ledger' }),
      items: field.repeater({
        label: 'Angka pencapaian', itemLabel: 'Angka', max: 8,
        of: {
          icon: field.icon({ label: 'Ikon' }),
          value: field.text({ label: 'Angka', required: true, max: 20, placeholder: 'Rp500M+' }),
          label: field.text({ label: 'Keterangan', required: true, max: 30, placeholder: 'MODAL' }),
        },
      }),
    },
  }),

  product_grid: def({
    type: 'product_grid',
    label: 'Daftar Produk',
    description: 'Menampilkan kartu produk simpanan atau pinjaman.',
    category: 'Produk',
    icon: 'grid',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40, default: 'LAYANAN KAMI' }),
      heading: field.text({ label: 'Judul bagian', required: true, max: 60, default: 'Produk Kami' }),
      subtext: field.textarea({ label: 'Penjelasan singkat', max: 200, rows: 2 }),
      category: field.select({
        label: 'Tampilkan kategori',
        options: [{ value: 'all', label: 'Semua produk' }, { value: 'simpanan', label: 'Simpanan saja' }, { value: 'pinjaman', label: 'Pinjaman saja' }],
        default: 'all',
      }),
      limit: field.number({ label: 'Jumlah maksimal ditampilkan', min: 1, max: 24, default: 6 }),
      ctaLabel: field.text({ label: 'Tulisan tombol', max: 30, default: 'Lihat Semua Produk' }),
      ctaHref: field.link({ label: 'Tombol menuju ke', default: '/produk' }),
    },
  }),

  cta_banner: def({
    type: 'cta_banner',
    label: 'Banner Ajakan',
    description: 'Banner lebar dengan gambar dan ajakan bertindak.',
    category: 'Konversi',
    icon: 'megaphone',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil', max: 40 }),
      heading: field.text({ label: 'Judul ajakan', required: true, max: 80 }),
      body: field.textarea({ label: 'Kalimat pendukung', max: 240, rows: 3 }),
      image: field.image({ label: 'Gambar latar' }),
      ctaLabel: field.text({ label: 'Tulisan tombol', max: 30 }),
      ctaHref: field.link({ label: 'Tombol menuju ke' }),
      secondaryLabel: field.text({ label: 'Tulisan tombol kedua', max: 30, placeholder: 'Cari produk' }),
      secondaryHref: field.link({ label: 'Tombol kedua menuju ke', placeholder: '/profiling' }),
      variant: field.select({ label: 'Gaya tampilan', options: [{ value: 'image', label: 'Dengan gambar' }, { value: 'solid', label: 'Warna polos' }], default: 'image' }),
    },
  }),

  news_list: def({
    type: 'news_list',
    label: 'Berita Terkini',
    description: 'Menampilkan berita terbaru dari halaman Berita.',
    category: 'Konten',
    icon: 'newspaper',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40, default: 'INFORMASI TERBARU' }),
      heading: field.text({ label: 'Judul bagian', required: true, max: 60, default: 'Berita Terkini' }),
      subtext: field.textarea({ label: 'Penjelasan singkat', max: 200, rows: 2 }),
      limit: field.number({ label: 'Jumlah berita', min: 1, max: 12, default: 3 }),
      ctaLabel: field.text({ label: 'Tulisan tombol', max: 30, default: 'Lihat Semua Berita' }),
      ctaHref: field.link({ label: 'Tombol menuju ke', default: '/berita' }),
    },
  }),

  testimonial_slider: def({
    type: 'testimonial_slider',
    label: 'Testimoni Anggota',
    description: 'Kutipan pengalaman anggota koperasi.',
    category: 'Konten',
    icon: 'quote',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40, default: 'TESTIMONI' }),
      heading: field.text({ label: 'Judul bagian', required: true, max: 60, default: 'Apa Kata Mereka?' }),
      subtext: field.textarea({ label: 'Penjelasan singkat', max: 200, rows: 2 }),
      limit: field.number({ label: 'Jumlah testimoni', min: 1, max: 12, default: 3 }),
    },
  }),

  lead_form: def({
    type: 'lead_form',
    label: 'Formulir Calon Nasabah',
    description: 'Formulir kontak yang datanya masuk ke dashboard admin.',
    category: 'Konversi',
    icon: 'inbox',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40 }),
      heading: field.text({ label: 'Judul formulir', required: true, max: 70 }),
      headingAccent: field.text({ label: 'Bagian judul yang diberi warna hijau', max: 40, help: 'Contoh: "Saran Anda". Ditampilkan hijau di akhir judul.' }),
      body: field.textarea({ label: 'Penjelasan singkat', max: 300, rows: 3 }),
      formTitle: field.text({ label: 'Judul di atas formulir', max: 40, default: 'Kirim Masukan' }),
      statValue: field.text({ label: 'Angka pada kartu hijau', max: 20, placeholder: '500+' }),
      statLabel: field.text({ label: 'Keterangan angka', max: 60, placeholder: 'Masukan Telah Diterima' }),
      statNote: field.text({ label: 'Catatan kecil di kartu hijau', max: 120 }),
      askProduct: field.boolean({ label: 'Tanyakan produk yang diminati', default: true }),
      askBranch: field.boolean({ label: 'Tanyakan cabang terdekat', default: true }),
      successMessage: field.textarea({ label: 'Pesan setelah terkirim', max: 240, rows: 2, default: 'Terima kasih. Petugas kami akan menghubungi Anda dalam 1×24 jam kerja.' }),
      benefits: field.repeater({
        label: 'Poin meyakinkan di samping formulir', itemLabel: 'Poin', max: 4,
        of: { title: field.text({ label: 'Judul poin', required: true, max: 50 }), body: field.text({ label: 'Penjelasan', max: 120 }) },
      }),
    },
  }),

  profiling_cta: def({
    type: 'profiling_cta',
    label: 'Ajakan Profiling Nasabah',
    description: 'Tombol besar mengajak pengunjung menjawab 4 pertanyaan singkat.',
    category: 'Konversi',
    icon: 'wand',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40, default: 'Panduan cepat' }),
      heading: field.text({ label: 'Judul ajakan', required: true, max: 80, default: 'Bingung pilih produk yang mana?' }),
      body: field.textarea({ label: 'Kalimat pendukung', max: 240, rows: 2, default: 'Jawab 4 pertanyaan singkat, kami tunjukkan produk yang paling sesuai beserta simulasi angsurannya.' }),
      ctaLabel: field.text({ label: 'Tulisan tombol', max: 40, default: 'Mulai, ±30 detik' }),
      ctaHref: field.link({ label: 'Tombol menuju ke', default: '/profiling' }),
      note: field.text({ label: 'Catatan kecil di bawah tombol', max: 60, default: 'Tanpa perlu daftar akun.' }),
    },
  }),

  branch_finder: def({
    type: 'branch_finder',
    label: 'Pencari Kantor Terdekat',
    description: 'Daftar kantor dengan peta, urut dari yang terdekat.',
    category: 'Konversi',
    icon: 'navigation',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40, default: 'Kantor kami' }),
      heading: field.text({ label: 'Judul bagian', required: true, max: 70, default: 'Kantor Terdekat dari Anda' }),
      body: field.textarea({ label: 'Penjelasan singkat', max: 240, rows: 2 }),
      showMap: field.boolean({ label: 'Tampilkan peta', default: true }),
    },
  }),

  simulation_calculator: def({
    type: 'simulation_calculator',
    label: 'Kalkulator Simulasi',
    description: 'Simulasi angsuran pinjaman atau imbal hasil simpanan.',
    category: 'Produk',
    icon: 'calculator',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40, default: 'Kalkulator' }),
      heading: field.text({ label: 'Judul bagian', required: true, max: 70, default: 'Simulasi Angsuran' }),
      body: field.textarea({ label: 'Penjelasan singkat', max: 240, rows: 2 }),
      product: field.reference({ label: 'Produk yang disimulasikan', to: 'product', help: 'Kosongkan agar pengunjung bisa memilih sendiri.' }),
      disclaimer: field.text({ label: 'Catatan wajib', max: 120, default: 'Simulasi awal, bukan penawaran final.' }),
    },
  }),

  rich_text: def({
    type: 'rich_text',
    label: 'Teks Bebas',
    description: 'Paragraf, daftar, dan sub-judul. Judul besar (H1) tidak tersedia di sini.',
    category: 'Konten',
    icon: 'text',
    headingLevel: null,
    fields: {
      body: field.richtext({ label: 'Isi tulisan', required: true }),
      width: field.select({ label: 'Lebar teks', options: [{ value: 'narrow', label: 'Sempit (paling mudah dibaca)' }, { value: 'full', label: 'Selebar halaman' }], default: 'narrow' }),
    },
  }),

  accordion: def({
    type: 'accordion',
    label: 'Daftar Lipat (Accordion)',
    description: 'Deskripsi, manfaat, syarat, atau tanya jawab yang bisa dibuka-tutup.',
    category: 'Konten',
    icon: 'list',
    headingLevel: 'h2',
    fields: {
      heading: field.text({ label: 'Judul bagian', max: 70 }),
      isFaq: field.boolean({ label: 'Tandai sebagai Tanya Jawab', help: 'Membantu Google menampilkan jawaban langsung di hasil pencarian.', default: false }),
      items: field.repeater({
        label: 'Isi', itemLabel: 'Bagian', min: 1, max: 20,
        of: { title: field.text({ label: 'Judul bagian', required: true, max: 120 }), body: field.richtext({ label: 'Isi', required: true }) },
      }),
    },
  }),

  feature_grid: def({
    type: 'feature_grid',
    label: 'Kotak Keunggulan',
    description: 'Beberapa kotak berisi ikon, judul, dan penjelasan singkat.',
    category: 'Konten',
    icon: 'layout-grid',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40 }),
      heading: field.text({ label: 'Judul bagian', max: 70 }),
      columns: field.select({ label: 'Jumlah kolom', options: [{ value: '2', label: '2 kolom' }, { value: '3', label: '3 kolom' }, { value: '4', label: '4 kolom' }], default: '3' }),
      items: field.repeater({
        label: 'Kotak', itemLabel: 'Kotak', min: 1, max: 12,
        of: { icon: field.icon({ label: 'Ikon' }), title: field.text({ label: 'Judul', required: true, max: 60 }), body: field.textarea({ label: 'Penjelasan', max: 200, rows: 3 }) },
      }),
    },
  }),

  image_gallery: def({
    type: 'image_gallery',
    label: 'Galeri Gambar',
    description: 'Kumpulan foto kegiatan atau kantor.',
    category: 'Media',
    icon: 'images',
    headingLevel: 'h2',
    fields: {
      heading: field.text({ label: 'Judul bagian', max: 70 }),
      images: field.repeater({
        label: 'Foto', itemLabel: 'Foto', min: 1, max: 24,
        of: { image: field.image({ label: 'Foto', required: true }), caption: field.text({ label: 'Keterangan foto', max: 120 }) },
      }),
    },
  }),

  document_list: def({
    type: 'document_list',
    label: 'Daftar Dokumen',
    description: 'Laporan tahunan, legalitas, atau berkas PDF lain untuk diunduh.',
    category: 'Konten',
    icon: 'file-text',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40, default: 'Unduhan' }),
      heading: field.text({ label: 'Judul bagian', max: 70 }),
      category: field.select({
        label: 'Jenis dokumen',
        options: [{ value: 'laporan', label: 'Laporan tahunan' }, { value: 'legalitas', label: 'Legalitas & perizinan' }, { value: 'keuangan', label: 'Laporan keuangan' }, { value: 'lainnya', label: 'Lainnya' }],
        default: 'laporan',
      }),
    },
  }),

  org_chart: def({
    type: 'org_chart',
    label: 'Struktur Organisasi',
    description: 'Susunan pengurus dan pengawas, dibaca Google sebagai teks (bukan gambar).',
    category: 'Konten',
    icon: 'users',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40, default: 'Tata kelola' }),
      heading: field.text({ label: 'Judul bagian', max: 70, default: 'Struktur Organisasi' }),
      groups: field.repeater({
        label: 'Kelompok jabatan', itemLabel: 'Kelompok', min: 1, max: 10,
        of: {
          title: field.text({ label: 'Nama kelompok', required: true, max: 40, placeholder: 'Pengurus' }),
          members: field.repeater({
            label: 'Anggota', itemLabel: 'Orang', min: 1, max: 20,
            of: { name: field.text({ label: 'Nama', required: true, max: 80 }), role: field.text({ label: 'Jabatan', max: 60 }), photo: field.image({ label: 'Foto' }) },
          }),
        },
      }),
    },
  }),

  contact_cards: def({
    type: 'contact_cards',
    label: 'Kartu Kontak Kantor',
    description: 'Alamat, telepon, dan jam buka setiap kantor.',
    category: 'Konversi',
    icon: 'phone',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40, default: 'Kontak' }),
      heading: field.text({ label: 'Judul bagian', max: 70, default: 'Hubungi Kantor Kami' }),
      showHours: field.boolean({ label: 'Tampilkan jam buka', default: true }),
      showMap: field.boolean({ label: 'Tampilkan peta', default: true }),
    },
  }),
} satisfies Record<string, BlockDef>

export type BlockType = keyof typeof BLOCKS
export const BLOCK_LIST = Object.values(BLOCKS) as BlockDef[]
export const BLOCK_TYPES = Object.keys(BLOCKS) as BlockType[]

export function getBlock(type: string): BlockDef | undefined {
  return (BLOCKS as Record<string, BlockDef>)[type]
}

/** Validate a block's props against its registered schema. */
export function validateBlockProps(type: string, props: unknown) {
  const block = getBlock(type)
  if (!block) return { success: false as const, error: `Blok tidak dikenal: ${type}` }
  const parsed = fieldsToZod(block.fields).safeParse(props)
  return parsed.success
    ? { success: true as const, data: parsed.data }
    : { success: false as const, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
}

export function defaultPropsFor(type: string): Record<string, unknown> {
  const block = getBlock(type)
  return block ? defaultsFor(block.fields) : {}
}

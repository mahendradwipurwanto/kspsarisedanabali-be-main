import { field, fieldsToZod, defaultsFor, type FieldMap } from '../fields.js'

/**
 * Block registry.
 *
 * `headingLevel` is owned here, not by the editor. That is what permanently fixes
 * the audit finding "judul besar dan sub-judul dipakai bergantian tanpa urutan yang
 * jelas" — a page can only ever emit one H1, and it comes from the page title block.
 */

export type BlockCategory = 'Utama' | 'Konten' | 'Produk' | 'Konversi' | 'Media'

/**
 * The palette every box in the organisation chart can be painted with.
 *
 * Named after what an editor sees rather than a token, and shared by the
 * contract, the console editor and the website so the three cannot drift.
 */
export const ORG_TONES = [
  { value: 'netral', label: 'Netral (putih)' },
  { value: 'gelap', label: 'Gelap (navy)' },
  { value: 'hijau', label: 'Hijau' },
  { value: 'emas', label: 'Emas' },
] as const

export type OrgTone = (typeof ORG_TONES)[number]['value']

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

/**
 * Fields every block carries, whatever it draws.
 *
 * Tag Manager identifies a section by a CSS selector, and a selector is only
 * stable if someone gave the section a name. Generated class names change with
 * every build, so a marketer measuring "clicks in the testimonial band" had
 * nothing to point a trigger at. These two put that name in the editor's hands.
 *
 * They are added to every block by `def()` rather than repeated in thirty
 * definitions, so a block added later gets them without anyone remembering to.
 */
export const TRACKING_FIELDS: FieldMap = {
  gtmClass: field.text({
    label: 'Kelas CSS untuk GTM',
    max: 120,
    placeholder: 'promo-simpanan',
    help: 'Nama untuk bagian ini di Google Tag Manager. Ditulis sebagai kelas pada pembungkus bagian, dengan awalan dari Pengaturan → SEO (bawaan: ksp-). Pisahkan dengan spasi untuk lebih dari satu.',
  }),
  gtmId: field.text({
    label: 'ID elemen untuk GTM',
    max: 60,
    placeholder: 'blok-testimoni',
    help: 'Opsional. Menjadi id HTML bagian ini, sekaligus sasaran tautan #anchor. Harus unik dalam satu halaman.',
  }),
}

/** Keys of {@link TRACKING_FIELDS}, for a form that groups them apart. */
export const TRACKING_KEYS = Object.keys(TRACKING_FIELDS)

const def = <T extends BlockDef>(b: T): T => ({ ...b, fields: { ...b.fields, ...TRACKING_FIELDS } })

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
    description: 'Banner besar di paling atas beranda: tampilan komponen dengan kartu angka, atau gambar banner penuh.',
    category: 'Utama',
    icon: 'image',
    headingLevel: 'h1',
    singleton: true,
    fields: {
      style: field.select({
        label: 'Gaya banner',
        options: [
          { value: 'component', label: 'Komponen: judul, tombol, dan kartu angka produk' },
          { value: 'banner', label: 'Gambar banner penuh (seperti spanduk)' },
        ],
        default: 'component',
        help: 'Gaya "komponen" memakai kolom Slide banner di bawah. Gaya "gambar banner" memakai kolom Gambar banner penuh.',
      }),
      badge: field.text({ label: 'Label kecil di atas judul', max: 40, default: 'Program unggulan', help: 'Hanya untuk gaya komponen. Muncul sebagai lencana kecil; kosongkan untuk menyembunyikan.' }),
      slides: field.repeater({
        label: 'Slide banner', itemLabel: 'Slide', max: 6, help: 'Hanya untuk gaya komponen.',
        of: {
          image: field.image({ label: 'Gambar banner', help: 'Ukuran ideal 1600×900 piksel. Kosongkan untuk latar polos bermotif.' }),
          heading: field.text({ label: 'Judul di banner', required: true, max: 70 }),
          subheading: field.textarea({ label: 'Kalimat pendukung', max: 180 }),
          bullets: field.repeater({ label: 'Poin keunggulan', itemLabel: 'Poin', max: 5, of: { text: field.text({ label: 'Teks', required: true, max: 90 }) } }),
          ctaLabel: field.text({ label: 'Tulisan tombol utama', max: 30, placeholder: 'Ajukan Sekarang' }),
          ctaHref: field.link({ label: 'Tombol utama menuju ke', placeholder: '/produk/pinjaman' }),
          secondaryLabel: field.text({ label: 'Tulisan tombol kedua', max: 30, placeholder: 'Cari produk yang cocok' }),
          secondaryHref: field.link({ label: 'Tombol kedua menuju ke', placeholder: '/profiling', default: '/profiling' }),
          featuredProduct: field.reference({ label: 'Produk yang ditampilkan di kartu angka', to: 'product', help: 'Kartu di sisi kanan menampilkan suku bunga, plafon, dan tenor produk ini. Kosongkan untuk memakai poin keunggulan saja.' }),
        },
      }),
      // The banner style: whole-width artwork, the way the koperasi's printed
      // spanduk look. Text is optional and sits over the picture; the first
      // banner's heading is still the page's H1 so Google has a title to read.
      banners: field.repeater({
        label: 'Gambar banner penuh', itemLabel: 'Banner', max: 6,
        help: 'Hanya untuk gaya gambar banner. Ukuran ideal 1920×820 piksel; di ponsel gambar dipotong ke 4:3, jadi letakkan pesan utama di tengah.',
        of: {
          image: field.image({ label: 'Gambar', required: true }),
          alt: field.text({ label: 'Teks alternatif', required: true, max: 120, help: 'Dibaca mesin pencari dan pembaca layar. Tulis pesan yang ada di gambar.' }),
          heading: field.text({ label: 'Judul di atas gambar', max: 70, help: 'Kosongkan bila gambar sudah memuat judulnya sendiri.' }),
          subheading: field.textarea({ label: 'Kalimat pendukung', max: 160 }),
          ctaLabel: field.text({ label: 'Tulisan tombol', max: 30 }),
          ctaHref: field.link({ label: 'Tombol menuju ke' }),
          link: field.link({ label: 'Seluruh banner menuju ke', help: 'Dipakai bila tidak ada tombol: seluruh gambar bisa diklik.' }),
        },
      }),
      bannerText: field.select({
        label: 'Judul (H1) di gambar banner',
        options: [
          { value: 'overlay', label: 'Tampilkan: judul, kalimat pendukung, dan tombol di atas gambar' },
          { value: 'none', label: 'Sembunyikan: gambar saja, judul tetap ada untuk Google dan pembaca layar' },
        ],
        default: 'overlay',
        help: 'Judul banner pertama adalah H1 halaman ini. Disembunyikan pun ia tetap ditulis di kode halaman, hanya tidak terlihat.',
      }),
      bannerHeight: field.select({
        label: 'Tinggi gambar banner',
        options: [{ value: 'wide', label: 'Pendek dan lebar (21:9)' }, { value: 'standard', label: 'Standar (16:9)' }, { value: 'tall', label: 'Tinggi (3:2)' }],
        default: 'wide',
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
      layout: field.select({
        label: 'Tampilan',
        options: [{ value: 'cards', label: 'Kartu (3 kolom)' }, { value: 'rows', label: 'Baris memanjang' }],
        default: 'cards',
        help: 'Kartu untuk sorotan di beranda; baris untuk daftar lengkap di halaman produk.',
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
      ctaHref: field.link({ label: 'Tombol menuju ke', default: '/kontak' }),
      secondaryLabel: field.text({ label: 'Tulisan tombol kedua', max: 30, placeholder: 'Cari produk' }),
      secondaryHref: field.link({ label: 'Tombol kedua menuju ke', placeholder: '/profiling', default: '/profiling' }),
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

  feedback_form: def({
    type: 'feedback_form',
    label: 'Formulir Kritik & Saran',
    description: 'Kotak saran online. Masukan yang dikirim masuk ke menu Kritik & Saran di konsol.',
    category: 'Konversi',
    icon: 'message',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40, default: 'Suara anggota' }),
      heading: field.text({ label: 'Judul bagian', required: true, max: 70, default: 'Kritik & Saran' }),
      headingAccent: field.text({ label: 'Bagian judul yang diberi warna hijau', max: 40, help: 'Ditampilkan hijau di akhir judul.' }),
      body: field.textarea({ label: 'Penjelasan singkat', max: 300, rows: 3, default: 'Sampaikan keluhan, usulan, atau apresiasi Anda. Semua masukan dibaca pengurus dan menjadi bahan perbaikan layanan.' }),
      formTitle: field.text({ label: 'Judul di atas formulir', max: 40, default: 'Sampaikan Masukan' }),
      // Anonymous by default: someone with a complaint about a member of staff
      // will not file it if the form demands their name first.
      askIdentity: field.boolean({ label: 'Tampilkan kolom nama dan kontak', default: true, help: 'Tetap opsional bagi pengirim, sehingga masukan boleh anonim.' }),
      askBranch: field.boolean({ label: 'Tanyakan kantor yang dimaksud', default: true }),
      askRating: field.boolean({ label: 'Tanyakan penilaian bintang 1–5', default: true }),
      successMessage: field.textarea({ label: 'Pesan setelah terkirim', max: 240, rows: 2, default: 'Terima kasih. Masukan Anda sudah kami terima dan akan dibaca pengurus.' }),
      note: field.text({ label: 'Catatan kecil di bawah tombol', max: 160, default: 'Masukan Anda boleh dikirim tanpa nama.' }),
      points: field.repeater({
        label: 'Poin penjelas di samping formulir', itemLabel: 'Poin', max: 4,
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
      // The kinds are rows the koperasi manages under Kategori Dokumen, so the
      // block picks from them rather than from a list frozen here. The value
      // is the category's slug; empty (or the older "all") shows every kind.
      category: field.reference({
        label: 'Jenis dokumen',
        to: 'document-category',
        help: 'Kosongkan untuk menampilkan semua jenis — rak sampul lalu memberi tab per jenis. Jenisnya dikelola di menu Kategori Dokumen.',
      }),
      layout: field.select({
        label: 'Tampilan',
        options: [
          { value: 'shelf', label: 'Rak sampul — kartu dengan gambar sampul, tahun, dan judul' },
          { value: 'list', label: 'Daftar ringkas — satu baris per berkas' },
        ],
        default: 'shelf',
        help: 'Rak sampul menampilkan tab per jenis dokumen bila "Semua dokumen" dipilih. Dokumen tanpa sampul tetap tampil dengan penanda.',
      }),
    },
  }),

  /**
 * The chart's colours are options, not decisions baked into the component: a
 * koperasi that wants its board in green and its units in navy can say so
 * without a deploy.
 */
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
      // No minimum: left empty the block falls back to Pengaturan → Legalitas &
      // Organisasi, which is where the board is actually maintained. Requiring
      // one here meant the page carrying this block could not be saved at all.
      groups: field.repeater({
        label: 'Kelompok jabatan', itemLabel: 'Kelompok', max: 10,
        of: {
          title: field.text({ label: 'Nama kelompok', required: true, max: 40, placeholder: 'Pengurus' }),
          tone: field.select({ label: 'Warna kartu', options: [...ORG_TONES], default: 'netral' }),
          members: field.repeater({
            label: 'Anggota', itemLabel: 'Orang', min: 1, max: 20,
            of: { name: field.text({ label: 'Nama', required: true, max: 80 }), role: field.text({ label: 'Jabatan', max: 60 }), photo: field.image({ label: 'Foto' }) },
          }),
        },
      }),
      /**
       * The chart itself: levels top to bottom, edited in the console's own
       * chart-shaped editor rather than through these nested repeaters.
       *
       * The five props below it are what charts looked like before levels
       * existed. They are still read — a page saved earlier renders exactly as
       * it did — and the editor converts them the first time it is touched.
       */
      levels: field.repeater({
        label: 'Tingkatan bagan', itemLabel: 'Tingkat', max: 12,
        of: {
          kind: field.select({ label: 'Bentuk', options: [{ value: 'kotak', label: 'Satu kotak' }, { value: 'kolom', label: 'Beberapa kolom' }], default: 'kotak' }),
          title: field.text({ label: 'Teks kotak', max: 60 }),
          tone: field.select({ label: 'Warna kotak', options: [...ORG_TONES], default: 'gelap' }),
          style: field.select({ label: 'Gaya kolom', options: [{ value: 'kartu', label: 'Kartu berisi nama' }, { value: 'daftar', label: 'Judul + daftar jabatan' }], default: 'kartu' }),
          aside: field.text({ label: 'Kotak di samping garis', max: 40 }),
          asideTone: field.select({ label: 'Warna kotak samping', options: [...ORG_TONES], default: 'emas' }),
          columns: field.repeater({
            label: 'Kolom', itemLabel: 'Kolom', max: 8,
            of: {
              title: field.text({ label: 'Judul kolom', max: 40 }),
              tone: field.select({ label: 'Warna judul', options: [...ORG_TONES], default: 'netral' }),
              members: field.repeater({
                label: 'Isi kolom', itemLabel: 'Baris', max: 20,
                of: { name: field.text({ label: 'Nama atau jabatan', max: 80 }), role: field.text({ label: 'Keterangan', max: 60 }) },
              }),
            },
          }),
        },
      }),

      // Legacy shape, kept so charts saved before "Tingkatan bagan" existed
      // keep rendering. The editor migrates them on first change.
      apex: field.text({ label: 'Kotak teratas', max: 40, default: 'Rapat Anggota', help: 'Pemegang kekuasaan tertinggi koperasi. Kosongkan bila tidak ingin ditampilkan.' }),
      apexTone: field.select({ label: 'Warna kotak teratas', options: [...ORG_TONES], default: 'gelap' }),
      audit: field.text({ label: 'Pengawas internal', max: 40, default: 'SPI', help: 'Muncul sebagai kotak di samping garis, seperti pada bagan resmi. Kosongkan bila tidak ada.' }),
      auditTone: field.select({ label: 'Warna kotak pengawas internal', options: [...ORG_TONES], default: 'emas' }),
      operationsLead: field.text({ label: 'Pimpinan operasional', max: 40, default: 'Kepala Cabang' }),
      leadTone: field.select({ label: 'Warna kotak pimpinan operasional', options: [...ORG_TONES], default: 'gelap' }),
      units: field.repeater({
        label: 'Unit kerja', itemLabel: 'Unit', max: 6,
        of: {
          title: field.text({ label: 'Nama unit', required: true, max: 40, placeholder: 'Kabag Dana' }),
          tone: field.select({ label: 'Warna judul unit', options: [...ORG_TONES], default: 'hijau' }),
          roles: field.repeater({
            label: 'Jabatan di bawahnya', itemLabel: 'Jabatan', max: 10,
            of: { name: field.text({ label: 'Nama jabatan', required: true, max: 40, placeholder: 'Kasir' }) },
          }),
        },
      }),
    },
  }),

  post_index: def({
    type: 'post_index',
    label: 'Daftar Berita Lengkap',
    description: 'Semua berita dengan navigasi halaman. Untuk halaman /berita, bukan sorotan di beranda.',
    category: 'Konten',
    icon: 'newspaper',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40, default: 'Informasi terbaru' }),
      heading: field.text({ label: 'Judul bagian', max: 70 }),
      subtext: field.textarea({ label: 'Penjelasan singkat', max: 200, rows: 2 }),
      perPage: field.number({ label: 'Berita per halaman', min: 3, max: 24, default: 9 }),
      emptyTitle: field.text({ label: 'Judul saat belum ada berita', max: 60, default: 'Belum ada berita' }),
      emptyBody: field.textarea({ label: 'Penjelasan saat belum ada berita', max: 200, rows: 2, default: 'Berita dan informasi terbaru akan tampil di sini.' }),
    },
  }),

  job_list: def({
    type: 'job_list',
    label: 'Daftar Lowongan',
    description: 'Lowongan kerja yang sedang dibuka, lengkap dengan tombol lamar.',
    category: 'Konten',
    icon: 'briefcase',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40, default: 'Karir' }),
      heading: field.text({ label: 'Judul bagian', max: 70 }),
      subtext: field.textarea({ label: 'Penjelasan singkat', max: 200, rows: 2 }),
      emptyTitle: field.text({ label: 'Judul saat belum ada lowongan', max: 60, default: 'Belum ada lowongan saat ini' }),
      emptyBody: field.textarea({ label: 'Penjelasan saat belum ada lowongan', max: 240, rows: 2, default: 'Belum ada posisi yang dibuka. Silakan cek kembali secara berkala atau kirim lamaran spontan ke kantor kami.' }),
    },
  }),

  faq_index: def({
    type: 'faq_index',
    label: 'Tanya Jawab Lengkap',
    description: 'Semua pertanyaan, dikelompokkan per kategori, dengan ajakan menghubungi di bawahnya.',
    category: 'Konten',
    icon: 'help',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40, default: 'Tanya jawab' }),
      heading: field.text({ label: 'Judul bagian', max: 70 }),
      category: field.select({
        label: 'Kategori yang ditampilkan',
        help: 'Selain "Semua kategori", pertanyaan di kategori lain tidak ikut tampil di blok ini.',
        options: [
          { value: 'all', label: 'Semua kategori' },
          { value: 'umum', label: 'Umum' },
          { value: 'keanggotaan', label: 'Keanggotaan' },
          { value: 'simpanan', label: 'Simpanan' },
          { value: 'pinjaman', label: 'Pinjaman' },
        ],
        default: 'all',
      }),
      grouped: field.boolean({ label: 'Kelompokkan per kategori', default: true }),
      ctaHeading: field.text({ label: 'Judul ajakan di bawah', max: 70, default: 'Masih ada yang ingin ditanyakan?' }),
      ctaBody: field.textarea({ label: 'Kalimat ajakan', max: 200, rows: 2, default: 'Petugas kami siap membantu lewat telepon, WhatsApp, atau di kantor cabang terdekat.' }),
      primaryLabel: field.text({ label: 'Tombol utama', max: 30, default: 'Hubungi kami' }),
      primaryHref: field.link({ label: 'Tombol utama menuju', default: '/kontak' }),
      secondaryLabel: field.text({ label: 'Tombol kedua', max: 30, default: 'Lihat kantor terdekat' }),
      secondaryHref: field.link({ label: 'Tombol kedua menuju', default: '/lokasi' }),
    },
  }),

  simulation_tabs: def({
    type: 'simulation_tabs',
    label: 'Simulasi Pinjaman & Simpanan',
    description: 'Kalkulator dua sisi: angsuran pinjaman dan hasil simpanan menurut tabel resmi koperasi.',
    category: 'Produk',
    icon: 'calculator',
    headingLevel: null,
    fields: {
      defaultTab: field.select({
        label: 'Sisi yang terbuka lebih dulu',
        options: [{ value: 'pinjaman', label: 'Angsuran pinjaman' }, { value: 'simpanan', label: 'Hasil simpanan' }],
        default: 'pinjaman',
      }),
      disclaimer: field.textarea({
        label: 'Catatan di bawah hasil',
        max: 240,
        rows: 2,
        default: 'Simulasi awal, bukan penawaran final. Angka resmi ditentukan setelah pengajuan dan survei oleh petugas.',
      }),
    },
  }),

  profiling_wizard: def({
    type: 'profiling_wizard',
    label: 'Pencari Produk (4 Pertanyaan)',
    description: 'Empat pertanyaan singkat yang berujung pada rekomendasi produk dan data calon nasabah.',
    category: 'Konversi',
    icon: 'spark',
    headingLevel: null,
    fields: {},
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

  /* ──────────────────────── free-form sections ─────────────────────────── */

  media_text: def({
    type: 'media_text',
    label: 'Gambar & Teks',
    description: 'Satu gambar di samping judul, teks, poin, dan tombol. Untuk memperkenalkan layanan, program, atau kantor.',
    category: 'Konten',
    icon: 'image',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40 }),
      heading: field.text({ label: 'Judul bagian', required: true, max: 70 }),
      body: field.richtext({ label: 'Isi teks' }),
      bullets: field.repeater({ label: 'Poin-poin', itemLabel: 'Poin', max: 6, of: { text: field.text({ label: 'Teks', required: true, max: 100 }) } }),
      image: field.image({ label: 'Gambar', required: true, help: 'Ukuran ideal 1200×900 piksel.' }),
      alt: field.text({ label: 'Teks alternatif gambar', max: 120, help: 'Dibaca mesin pencari dan pembaca layar, dan dihitung sebagai keterangan gambar oleh penilai SEO.' }),
      imagePosition: field.select({ label: 'Posisi gambar', options: [{ value: 'right', label: 'Kanan' }, { value: 'left', label: 'Kiri' }], default: 'right' }),
      imageRatio: field.select({ label: 'Rasio gambar', options: [{ value: '4/3', label: '4:3' }, { value: '1/1', label: 'Persegi' }, { value: '16/9', label: '16:9' }, { value: '3/4', label: 'Tegak (3:4)' }], default: '4/3' }),
      ctaLabel: field.text({ label: 'Tulisan tombol', max: 30 }),
      ctaHref: field.link({ label: 'Tombol menuju ke' }),
      secondaryLabel: field.text({ label: 'Tulisan tombol kedua', max: 30 }),
      secondaryHref: field.link({ label: 'Tombol kedua menuju ke' }),
    },
  }),

  steps: def({
    type: 'steps',
    label: 'Langkah-langkah',
    description: 'Proses bernomor: cara menjadi anggota, mengajukan pinjaman, atau membuka simpanan.',
    category: 'Konten',
    icon: 'list',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40, default: 'Caranya mudah' }),
      heading: field.text({ label: 'Judul bagian', required: true, max: 70 }),
      intro: field.textarea({ label: 'Pengantar singkat', max: 220, rows: 2 }),
      items: field.repeater({
        label: 'Langkah', itemLabel: 'Langkah', min: 2, max: 8,
        of: {
          title: field.text({ label: 'Judul langkah', required: true, max: 60 }),
          body: field.textarea({ label: 'Penjelasan', max: 200, rows: 2 }),
          icon: field.icon({ label: 'Ikon', help: 'Kosongkan untuk memakai nomor urut.' }),
        },
      }),
      layout: field.select({ label: 'Tata letak', options: [{ value: 'grid', label: 'Berjajar (kotak)' }, { value: 'list', label: 'Berurutan ke bawah' }], default: 'grid' }),
      ctaLabel: field.text({ label: 'Tulisan tombol', max: 30 }),
      ctaHref: field.link({ label: 'Tombol menuju ke' }),
    },
  }),

  timeline: def({
    type: 'timeline',
    label: 'Lini Masa',
    description: 'Perjalanan koperasi tahun demi tahun: berdiri, badan hukum, kantor baru, penghargaan.',
    category: 'Konten',
    icon: 'clock',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40, default: 'Perjalanan kami' }),
      heading: field.text({ label: 'Judul bagian', required: true, max: 70, default: 'Sejarah Koperasi' }),
      items: field.repeater({
        label: 'Peristiwa', itemLabel: 'Peristiwa', min: 1, max: 20,
        of: {
          period: field.text({ label: 'Tahun / periode', required: true, max: 20, placeholder: '2002' }),
          title: field.text({ label: 'Judul peristiwa', required: true, max: 80 }),
          body: field.textarea({ label: 'Penjelasan', max: 240, rows: 2 }),
          image: field.image({ label: 'Foto (opsional)' }),
          alt: field.text({ label: 'Teks alternatif foto', max: 120, help: 'Kosongkan untuk memakai judul peristiwa.' }),
        },
      }),
    },
  }),

  video_embed: def({
    type: 'video_embed',
    label: 'Video',
    description: 'Video YouTube di dalam halaman: profil koperasi, panduan layanan, atau liputan kegiatan.',
    category: 'Media',
    icon: 'video',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40 }),
      heading: field.text({ label: 'Judul bagian', max: 70 }),
      url: field.text({ label: 'Tautan video YouTube', required: true, max: 200, placeholder: 'https://www.youtube.com/watch?v=…', help: 'Tautan watch, youtu.be, atau shorts. Video diputar dari youtube-nocookie.com.' }),
      caption: field.textarea({ label: 'Keterangan di bawah video', max: 200, rows: 2 }),
      width: field.select({ label: 'Lebar', options: [{ value: 'narrow', label: 'Sedang, di tengah' }, { value: 'wide', label: 'Selebar halaman' }], default: 'narrow' }),
    },
  }),

  logo_cloud: def({
    type: 'logo_cloud',
    label: 'Logo Mitra',
    description: 'Deretan logo mitra, lembaga pengawas, atau pendukung koperasi.',
    category: 'Media',
    icon: 'award',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40 }),
      heading: field.text({ label: 'Judul bagian', max: 70, default: 'Mitra & Pendukung' }),
      logos: field.repeater({
        label: 'Logo', itemLabel: 'Logo', min: 1, max: 12,
        of: {
          image: field.image({ label: 'Gambar logo', required: true, help: 'PNG atau SVG dengan latar transparan.' }),
          alt: field.text({ label: 'Nama lembaga', required: true, max: 60, help: 'Dipakai sebagai teks alternatif logo.' }),
          href: field.link({ label: 'Tautan (opsional)' }),
        },
      }),
      muted: field.boolean({ label: 'Tampilkan abu-abu, berwarna saat disorot', default: true }),
    },
  }),

  app_download: def({
    type: 'app_download',
    label: 'Unduh Aplikasi',
    description: 'Ajakan memasang aplikasi koperasi dengan tombol App Store dan Google Play. Tautan tokonya diatur di Pengaturan → Aplikasi.',
    category: 'Konversi',
    icon: 'smartphone',
    headingLevel: 'h2',
    fields: {
      eyebrow: field.text({ label: 'Label kecil di atas', max: 40, default: 'Aplikasi' }),
      heading: field.text({ label: 'Judul bagian', required: true, max: 70, default: 'Layanan koperasi di genggaman Anda' }),
      body: field.textarea({ label: 'Penjelasan', max: 240, rows: 3, default: 'Cek saldo, ajukan pinjaman, dan pantau angsuran dari ponsel, kapan saja.' }),
      bullets: field.repeater({ label: 'Poin keunggulan', itemLabel: 'Poin', max: 5, of: { text: field.text({ label: 'Teks', required: true, max: 80 }) } }),
      image: field.image({ label: 'Gambar aplikasi', help: 'Tangkapan layar atau mockup ponsel, ideal 800×1000 piksel dengan latar transparan.' }),
      alt: field.text({ label: 'Teks alternatif gambar', max: 120, help: 'Kosongkan untuk memakai nama aplikasi.' }),
      frame: field.select({
        label: 'Tampilan gambar',
        options: [{ value: 'phone', label: 'Di dalam bingkai ponsel' }, { value: 'plain', label: 'Gambar apa adanya' }],
        default: 'phone',
        help: 'Bingkai ponsel cocok untuk tangkapan layar aplikasi. Pilih "apa adanya" bila gambarnya sudah berupa mockup.',
      }),
      buttons: field.select({
        label: 'Tombol yang ditampilkan',
        options: [
          { value: 'stores', label: 'Dua tombol: App Store dan Google Play' },
          { value: 'smart', label: 'Satu tombol yang mengarah ke toko sesuai perangkat' },
          { value: 'both', label: 'Dua tombol toko ditambah tautan pintar' },
        ],
        default: 'stores',
        help: 'Tautan pintar membuka /aplikasi: iPhone diarahkan ke App Store, Android ke Google Play.',
      }),
      smartLabel: field.text({ label: 'Tulisan tombol tautan pintar', max: 30, default: 'Unduh aplikasi' }),
      tone: field.select({ label: 'Warna latar', options: [{ value: 'dark', label: 'Gelap' }, { value: 'light', label: 'Terang' }], default: 'dark' }),
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

/**
 * The wrapper attributes a block's tracking fields ask for.
 *
 * Returns null when the editor named nothing, so the page emits no extra
 * element at all: an empty div around every band would be a permanent cost paid
 * for a feature almost no block uses.
 *
 * The prefix is applied here rather than typed by the editor, so one container
 * rule can match every named section and a rename of the prefix reaches them
 * all. A name that already carries it is left alone rather than doubled.
 */
export function trackingAttrs(
  props: Record<string, unknown>,
  prefix = 'ksp-',
): { className: string; id?: string } | null {
  const safe = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9_ -]/g, '')

  const classes = safe(props.gtmClass)
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => (prefix && name.startsWith(prefix) ? name : `${prefix}${name}`))

  const id = safe(props.gtmId).replace(/\s+/g, '-') || undefined
  if (!classes.length && !id) return null

  return { className: classes.join(' '), id }
}

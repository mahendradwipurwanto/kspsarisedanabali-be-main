/**
 * Permission registry. Format: `resource:action` with an optional `:scope`.
 *
 * These strings are the single source of truth shared by the API (enforcement)
 * and the CMS (navigation + role builder UI). The API is the security boundary;
 * the CMS hiding a button is convenience only.
 */

export const PERMISSIONS = {
  // Content
  'pages:read': 'Melihat daftar dan isi halaman',
  'pages:create': 'Membuat halaman baru',
  'pages:update': 'Mengubah isi halaman',
  'pages:delete': 'Menghapus halaman',
  'pages:publish': 'Menerbitkan halaman — membuat perubahan tampil di website',

  'media:read': 'Melihat pustaka media',
  'media:upload': 'Mengunggah gambar dan dokumen',
  'media:delete': 'Menghapus berkas media',

  'posts:read': 'Melihat berita & artikel',
  'posts:write': 'Menulis dan mengubah berita',
  'posts:publish': 'Menerbitkan berita',
  'posts:delete': 'Menghapus berita',

  'products:read': 'Melihat produk simpanan & pinjaman',
  'products:write': 'Mengubah produk, syarat, dan suku bunga',
  'products:delete': 'Menghapus produk',

  'branches:read': 'Melihat data kantor',
  'branches:write': 'Mengubah alamat, jam buka, dan kontak kantor',

  'jobs:read': 'Melihat lowongan karir',
  'jobs:write': 'Mengubah lowongan karir',
  'jobs:applications': 'Membaca lamaran yang masuk',

  'faqs:write': 'Mengubah tanya jawab',
  'testimonials:write': 'Mengubah testimoni',
  'documents:write': 'Mengelola laporan & dokumen resmi',

  // Leads
  'leads:read:all': 'Melihat calon nasabah dari SEMUA cabang',
  'leads:read:branch': 'Melihat calon nasabah dari cabang sendiri saja',
  'leads:update': 'Mengubah status dan catatan calon nasabah',
  'leads:assign': 'Menugaskan calon nasabah ke petugas',
  'leads:export': 'Mengunduh data calon nasabah ke Excel',
  'leads:delete': 'Menghapus data calon nasabah',

  // Administration
  'users:read': 'Melihat daftar pengguna',
  'users:write': 'Menambah dan mengubah pengguna',
  'users:delete': 'Menghapus pengguna',
  'roles:read': 'Melihat daftar peran',
  'roles:manage': 'Membuat dan mengubah peran beserta hak aksesnya',

  'analytics:read': 'Melihat statistik pengunjung dan laporan',
  'settings:manage': 'Mengubah pengaturan website',
  'redirects:manage': 'Mengelola pengalihan alamat halaman lama',
  'menus:manage': 'Mengubah menu navigasi',
  'audit:read': 'Membaca catatan aktivitas sistem',
} as const

export type Permission = keyof typeof PERMISSIONS

export const PERMISSION_LIST = Object.keys(PERMISSIONS) as Permission[]

/** Grouped for the role-builder UI. */
export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  { label: 'Halaman', permissions: ['pages:read', 'pages:create', 'pages:update', 'pages:delete', 'pages:publish'] },
  { label: 'Media', permissions: ['media:read', 'media:upload', 'media:delete'] },
  { label: 'Berita & Artikel', permissions: ['posts:read', 'posts:write', 'posts:publish', 'posts:delete'] },
  { label: 'Produk', permissions: ['products:read', 'products:write', 'products:delete'] },
  { label: 'Kantor Cabang', permissions: ['branches:read', 'branches:write'] },
  { label: 'Karir', permissions: ['jobs:read', 'jobs:write', 'jobs:applications'] },
  { label: 'Konten Lain', permissions: ['faqs:write', 'testimonials:write', 'documents:write'] },
  {
    label: 'Calon Nasabah (Leads)',
    permissions: ['leads:read:all', 'leads:read:branch', 'leads:update', 'leads:assign', 'leads:export', 'leads:delete'],
  },
  { label: 'Pengguna & Peran', permissions: ['users:read', 'users:write', 'users:delete', 'roles:read', 'roles:manage'] },
  { label: 'Sistem', permissions: ['analytics:read', 'settings:manage', 'redirects:manage', 'menus:manage', 'audit:read'] },
]

/** Seeded roles. All are editable in the CMS; none are hardcoded into checks. */
export const SYSTEM_ROLES = {
  super_admin: {
    name: 'Super Admin',
    description: 'Akses penuh ke seluruh sistem, termasuk pengaturan peran dan pengguna.',
    permissions: PERMISSION_LIST,
    locked: true,
  },
  admin: {
    name: 'Admin Koperasi',
    description: 'Mengelola seluruh konten dan data calon nasabah, tanpa mengubah peran pengguna.',
    permissions: PERMISSION_LIST.filter((p) => !['roles:manage', 'users:delete'].includes(p)),
    locked: false,
  },
  editor: {
    name: 'Editor Konten',
    description: 'Menulis dan menerbitkan halaman, berita, dan produk.',
    permissions: [
      'pages:read', 'pages:create', 'pages:update', 'pages:publish',
      'media:read', 'media:upload',
      'posts:read', 'posts:write', 'posts:publish',
      'products:read', 'products:write',
      'branches:read', 'faqs:write', 'testimonials:write', 'documents:write',
      'jobs:read', 'jobs:write', 'analytics:read',
    ] as Permission[],
    locked: false,
  },
  contributor: {
    name: 'Kontributor',
    description: 'Menulis draf halaman dan berita, tetapi tidak bisa menerbitkan sendiri.',
    permissions: [
      'pages:read', 'pages:create', 'pages:update',
      'media:read', 'media:upload',
      'posts:read', 'posts:write', 'products:read', 'branches:read',
    ] as Permission[],
    locked: false,
  },
  marketing: {
    name: 'Marketing / Leads',
    description: 'Menindaklanjuti calon nasabah dari seluruh cabang dan membaca laporan.',
    permissions: [
      'leads:read:all', 'leads:update', 'leads:assign', 'leads:export',
      'analytics:read', 'branches:read', 'products:read', 'jobs:applications',
    ] as Permission[],
    locked: false,
  },
  branch_staff: {
    name: 'Staf Cabang',
    description: 'Menindaklanjuti calon nasabah dari cabangnya sendiri saja.',
    permissions: ['leads:read:branch', 'leads:update', 'branches:read', 'products:read'] as Permission[],
    locked: false,
  },
  viewer: {
    name: 'Pengurus (Hanya Lihat)',
    description: 'Melihat laporan dan data tanpa bisa mengubah apa pun.',
    permissions: ['analytics:read', 'leads:read:all', 'pages:read', 'posts:read', 'products:read', 'branches:read'] as Permission[],
    locked: false,
  },
} as const

export type SystemRoleKey = keyof typeof SYSTEM_ROLES

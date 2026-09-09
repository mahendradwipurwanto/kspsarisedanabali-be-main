import {
  pgTable, uuid, text, varchar, boolean, integer, timestamp, jsonb, doublePrecision,
  index, uniqueIndex, primaryKey, bigint,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

const id = () => uuid('id').primaryKey().defaultRandom()
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

/* ============================== IDENTITY & ACCESS ============================= */

export const users = pgTable(
  'users',
  {
    id: id(),
    name: varchar('name', { length: 160 }).notNull(),
    email: varchar('email', { length: 200 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    avatarKey: text('avatar_key'),
    isActive: boolean('is_active').notNull().default(true),
    /** Sealed with the data key (AES-256-GCM); never stored in the clear. */
    totpSecret: text('totp_secret'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    totpVerifiedAt: timestamp('totp_verified_at', { withTimezone: true }),
  /** Last accepted TOTP step, so a code seen in transit cannot be replayed inside its window. */
  totpLastStep: integer('totp_last_step'),
    /** SHA-256 of each unused recovery code. A used code is removed. */
    recoveryCodes: jsonb('recovery_codes').$type<string[]>().notNull().default([]),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`)],
)

export const roles = pgTable(
  'roles',
  {
    id: id(),
    key: varchar('key', { length: 60 }).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    description: text('description'),
    /** Permission strings from src/contracts/permissions.ts. */
    permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
    /** Locked roles cannot be deleted or have their permissions emptied. */
    isLocked: boolean('is_locked').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('roles_key_uq').on(t.key)],
)

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
)

/** Branch scoping for `leads:read:branch`. */
export const userBranches = pgTable(
  'user_branches',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.branchId] })],
)

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** Why it ended: logout, rotated, reuse, idle, limit, password, mfa, admin. */
    revokedReason: varchar('revoked_reason', { length: 40 }),
    /** The row that took over on rotation; a replay of this row is then theft. */
    replacedById: uuid('replaced_by_id'),
    userAgent: text('user_agent'),
    /** A short device summary derived from the user agent, for the sessions list. */
    label: varchar('label', { length: 120 }),
    ip: varchar('ip', { length: 60 }),
    /** Per-session HMAC key for request signatures, sealed with the data key. */
    signingKey: text('signing_key'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /** When the second factor was passed for this session. */
    mfaAt: timestamp('mfa_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('refresh_tokens_user_idx').on(t.userId), uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash)],
)

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: id(),
    email: varchar('email', { length: 200 }).notNull(),
    ip: varchar('ip', { length: 60 }),
    success: boolean('success').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('login_attempts_email_idx').on(t.email, t.createdAt)],
)

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 80 }).notNull(),
    entity: varchar('entity', { length: 60 }).notNull(),
    entityId: varchar('entity_id', { length: 80 }),
    summary: text('summary'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    ip: varchar('ip', { length: 60 }),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_entity_idx').on(t.entity, t.entityId), index('audit_logs_created_idx').on(t.createdAt)],
)

/* ================================== CONTENT ================================== */

export const pages = pgTable(
  'pages',
  {
    id: id(),
    title: varchar('title', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 200 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    seo: jsonb('seo').$type<Record<string, unknown>>().notNull().default({}),
    /** Locked pages back a fixed route (e.g. `/`) and cannot be deleted. */
    isSystem: boolean('is_system').notNull().default(false),
    /**
     * Listed in the footer's bottom row, beside the copyright.
     *
     * That row used to be every published page that was not a fixed route, so
     * anything an editor made — a campaign page, a test — appeared there by
     * itself. It is asked for now.
     */
    showInFooter: boolean('show_in_footer').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('pages_slug_uq').on(t.slug), index('pages_status_idx').on(t.status)],
)

export const pageBlocks = pgTable(
  'page_blocks',
  {
    id: id(),
    pageId: uuid('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 60 }).notNull(),
    props: jsonb('props').$type<Record<string, unknown>>().notNull().default({}),
    position: integer('position').notNull().default(0),
    isVisible: boolean('is_visible').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('page_blocks_page_idx').on(t.pageId, t.position)],
)

export const pageRevisions = pgTable(
  'page_revisions',
  {
    id: id(),
    pageId: uuid('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    note: varchar('note', { length: 200 }),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('page_revisions_page_idx').on(t.pageId, t.createdAt)],
)

/**
 * A page as it looks right now in the editor, including unsaved changes, stored
 * so the landing page can render it exactly as a visitor would see it.
 *
 * In the database rather than in memory because the API runs as serverless
 * functions: the invocation that creates a preview is almost never the one that
 * serves it, so anything held in process memory would be a coin toss.
 *
 * The token is the only credential — the row is fetched by an unauthenticated
 * public route so an iframe can load it — so it is random, single-page, and
 * short-lived. Rows are swept on write rather than by a scheduled job, since
 * Hobby plans get one cron a day.
 */
export const pagePreviews = pgTable(
  'page_previews',
  {
    id: id(),
    token: varchar('token', { length: 64 }).notNull().unique(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('page_previews_expiry_idx').on(t.expiresAt)],
)

export const mediaFolders = pgTable('media_folders', {
  id: id(),
  name: varchar('name', { length: 120 }).notNull(),
  parentId: uuid('parent_id'),
  createdAt: createdAt(),
})

export const media = pgTable(
  'media',
  {
    id: id(),
    key: text('key').notNull(),
    filename: varchar('filename', { length: 300 }).notNull(),
    contentType: varchar('content_type', { length: 160 }).notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    width: integer('width'),
    height: integer('height'),
    alt: varchar('alt', { length: 300 }),
    caption: varchar('caption', { length: 300 }),
    folderId: uuid('folder_id').references(() => mediaFolders.id, { onDelete: 'set null' }),
    isPrivate: boolean('is_private').notNull().default(false),
    uploadedById: uuid('uploaded_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('media_key_uq').on(t.key), index('media_created_idx').on(t.createdAt)],
)

export const redirects = pgTable(
  'redirects',
  {
    id: id(),
    fromPath: varchar('from_path', { length: 500 }).notNull(),
    toPath: varchar('to_path', { length: 500 }).notNull(),
    statusCode: integer('status_code').notNull().default(301),
    hits: integer('hits').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    note: varchar('note', { length: 200 }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('redirects_from_uq').on(t.fromPath)],
)

export const settings = pgTable('settings', {
  key: varchar('key', { length: 80 }).primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: updatedAt(),
})

export const menus = pgTable('menus', {
  id: id(),
  key: varchar('key', { length: 40 }).notNull().unique(),
  name: varchar('name', { length: 80 }).notNull(),
  items: jsonb('items').$type<unknown[]>().notNull().default([]),
  updatedAt: updatedAt(),
})

/* =================================== DOMAIN ================================== */

export const products = pgTable(
  'products',
  {
    id: id(),
    name: varchar('name', { length: 160 }).notNull(),
    slug: varchar('slug', { length: 160 }).notNull(),
    category: varchar('category', { length: 20 }).notNull(), // simpanan | pinjaman
    tagline: varchar('tagline', { length: 200 }),
    summary: text('summary'),
    description: text('description'),
    benefits: jsonb('benefits').$type<string[]>().notNull().default([]),
    requirements: jsonb('requirements').$type<string[]>().notNull().default([]),
    image: text('image'),
    rateMethod: varchar('rate_method', { length: 20 }).notNull().default('none'),
    ratePercent: doublePrecision('rate_percent'),
    rateNote: varchar('rate_note', { length: 200 }),
    minAmount: bigint('min_amount', { mode: 'number' }),
    maxAmount: bigint('max_amount', { mode: 'number' }),
    tenorOptions: jsonb('tenor_options').$type<number[]>().notNull().default([]),
    /** Which profiling purposes this product suits — drives the recommendation engine. */
    purposes: jsonb('purposes').$type<string[]>().notNull().default([]),
    seo: jsonb('seo').$type<Record<string, unknown>>().notNull().default({}),

    /**
     * Rates and plafon are published to the public and drive the installment
     * simulator, so they stay behind an explicit sign-off. Until the koperasi
     * confirms a product's figures, the site shows no rate and the calculator
     * excludes it — an unverified number must never look like a quote.
     */
    isVerified: boolean('is_verified').notNull().default(false),
    /** Where the figure came from, for the koperasi's own audit trail. */
    rateSource: text('rate_source'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedById: uuid('verified_by_id'),

    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('products_slug_uq').on(t.slug), index('products_category_idx').on(t.category, t.sortOrder)],
)

export const branches = pgTable(
  'branches',
  {
    id: id(),
    name: varchar('name', { length: 160 }).notNull(),
    slug: varchar('slug', { length: 160 }).notNull(),
    type: varchar('type', { length: 20 }).notNull().default('cabang'),
    address: text('address').notNull(),
    village: varchar('village', { length: 120 }),
    district: varchar('district', { length: 120 }),
    regency: varchar('regency', { length: 120 }).notNull().default('Karangasem'),
    province: varchar('province', { length: 120 }).notNull().default('Bali'),
    postalCode: varchar('postal_code', { length: 10 }),
    phone: varchar('phone', { length: 40 }),
    whatsapp: varchar('whatsapp', { length: 40 }),
    email: varchar('email', { length: 200 }),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    mapsUrl: text('maps_url'),
    hours: jsonb('hours').$type<{ day: number; opensAt: string | null; closesAt: string | null }[]>().notNull().default([]),
    image: text('image'),
    seo: jsonb('seo').$type<Record<string, unknown>>().notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('branches_slug_uq').on(t.slug)],
)

export const postCategories = pgTable(
  'post_categories',
  {
    id: id(),
    name: varchar('name', { length: 120 }).notNull(),
    slug: varchar('slug', { length: 120 }).notNull(),
    description: text('description'),
  },
  (t) => [uniqueIndex('post_categories_slug_uq').on(t.slug)],
)

export const posts = pgTable(
  'posts',
  {
    id: id(),
    title: varchar('title', { length: 250 }).notNull(),
    slug: varchar('slug', { length: 250 }).notNull(),
    excerpt: text('excerpt'),
    content: text('content'),
    coverImage: text('cover_image'),
    categoryId: uuid('category_id').references(() => postCategories.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    readMinutes: integer('read_minutes').notNull().default(3),
    viewCount: integer('view_count').notNull().default(0),
    seo: jsonb('seo').$type<Record<string, unknown>>().notNull().default({}),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('posts_slug_uq').on(t.slug), index('posts_published_idx').on(t.status, t.publishedAt)],
)

export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    title: varchar('title', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 200 }).notNull(),
    department: varchar('department', { length: 80 }),
    employmentType: varchar('employment_type', { length: 30 }).notNull().default('full_time'),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    location: varchar('location', { length: 200 }),
    description: text('description'),
    requirements: jsonb('requirements').$type<string[]>().notNull().default([]),
    closesAt: timestamp('closes_at', { withTimezone: true }),
    seo: jsonb('seo').$type<Record<string, unknown>>().notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('jobs_slug_uq').on(t.slug)],
)

export const jobApplications = pgTable(
  'job_applications',
  {
    id: id(),
    jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    email: varchar('email', { length: 200 }).notNull(),
    phone: varchar('phone', { length: 40 }).notNull(),
    bio: text('bio'),
    cvKey: text('cv_key').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('baru'),
    /** Applicant CVs are personal data — purge date drives the retention cron. */
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('job_applications_job_idx').on(t.jobId, t.createdAt)],
)

export const faqs = pgTable('faqs', {
  id: id(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  category: varchar('category', { length: 60 }),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
})

export const testimonials = pgTable('testimonials', {
  id: id(),
  name: varchar('name', { length: 120 }).notNull(),
  role: varchar('role', { length: 120 }),
  location: varchar('location', { length: 120 }),
  quote: text('quote').notNull(),
  rating: integer('rating').notNull().default(5),
  avatar: text('avatar'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
})

/**
 * The kinds a document can be — Laporan Tahunan, Laporan Keuangan, and
 * whatever the koperasi adds. Documents point at a kind by its slug, which is
 * also what the website filters by, so renaming a kind never orphans a file.
 */
export const documentCategories = pgTable(
  'document_categories',
  {
    id: id(),
    name: varchar('name', { length: 120 }).notNull(),
    slug: varchar('slug', { length: 60 }).notNull(),
    /** Icon name shared with the console picker and the website's tab strip. */
    icon: varchar('icon', { length: 40 }),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('document_categories_slug_uq').on(t.slug)],
)

export const documents = pgTable('documents', {
  id: id(),
  title: varchar('title', { length: 250 }).notNull(),
  category: varchar('category', { length: 40 }).notNull().default('laporan'),
  year: integer('year'),
  fileKey: text('file_key').notNull(),
  fileSize: bigint('file_size', { mode: 'number' }),
  /** Optional cover artwork (media key) — a report is shelved like a book, by its cover. */
  coverImage: text('cover_image'),
  isPublic: boolean('is_public').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
})

export const stats = pgTable('stats', {
  id: id(),
  label: varchar('label', { length: 60 }).notNull(),
  value: varchar('value', { length: 40 }).notNull(),
  icon: varchar('icon', { length: 40 }),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
})

/* ================================ LEADS & FUNNEL ============================== */

/**
 * Kritik & saran from the website's suggestion box.
 *
 * Kept apart from `leads` on purpose: a lead is someone asking to be called
 * back and must leave a phone number, while feedback may be filed anonymously —
 * every contact column here is nullable and only the message is required.
 */
export const feedback = pgTable(
  'feedback',
  {
    id: id(),
    category: varchar('category', { length: 20 }).notNull().default('saran'),
    rating: integer('rating'),
    name: varchar('name', { length: 160 }),
    email: varchar('email', { length: 200 }),
    phone: varchar('phone', { length: 40 }),
    subject: varchar('subject', { length: 200 }),
    message: text('message').notNull(),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 20 }).notNull().default('baru'),
    note: text('note'),
    handledById: uuid('handled_by_id').references(() => users.id, { onDelete: 'set null' }),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    source: varchar('source', { length: 30 }).notNull().default('feedback_form'),
    sessionId: varchar('session_id', { length: 64 }),
    referrer: text('referrer'),
    ipHash: varchar('ip_hash', { length: 64 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('feedback_status_idx').on(t.status, t.createdAt),
    index('feedback_created_idx').on(t.createdAt),
  ],
)

/**
 * What has been done about one piece of feedback, in order.
 *
 * The same shape as `lead_events`, and for the same reason: a single `note`
 * column holds only the last thing anyone wrote, so the reasoning behind a
 * status was lost the moment somebody else touched it. `feedback.note` stays as
 * the current note; this is the record of how it got there.
 */
export const feedbackEvents = pgTable(
  'feedback_events',
  {
    id: id(),
    feedbackId: uuid('feedback_id').notNull().references(() => feedback.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 30 }).notNull(), // status_change | note
    fromValue: varchar('from_value', { length: 60 }),
    toValue: varchar('to_value', { length: 60 }),
    note: text('note'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('feedback_events_feedback_idx').on(t.feedbackId, t.createdAt)],
)

export const leads = pgTable(
  'leads',
  {
    id: id(),
    name: varchar('name', { length: 160 }).notNull(),
    phone: varchar('phone', { length: 40 }).notNull(),
    email: varchar('email', { length: 200 }),
    interest: varchar('interest', { length: 20 }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    message: text('message'),
    amount: bigint('amount', { mode: 'number' }),
    tenorMonths: integer('tenor_months'),
    purposes: jsonb('purposes').$type<string[]>().notNull().default([]),
    estimatedInstallment: bigint('estimated_installment', { mode: 'number' }),
    source: varchar('source', { length: 30 }).notNull().default('contact_form'),
    status: varchar('status', { length: 20 }).notNull().default('baru'),
    assignedToId: uuid('assigned_to_id').references(() => users.id, { onDelete: 'set null' }),
    sessionId: varchar('session_id', { length: 64 }),
    utmSource: varchar('utm_source', { length: 120 }),
    utmMedium: varchar('utm_medium', { length: 120 }),
    utmCampaign: varchar('utm_campaign', { length: 120 }),
    referrer: text('referrer'),
    ipHash: varchar('ip_hash', { length: 64 }),
    contactedAt: timestamp('contacted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('leads_branch_status_idx').on(t.branchId, t.status, t.createdAt),
    index('leads_created_idx').on(t.createdAt),
    index('leads_phone_idx').on(t.phone),
  ],
)

export const leadEvents = pgTable(
  'lead_events',
  {
    id: id(),
    leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 30 }).notNull(), // status_change | note | assign
    fromValue: varchar('from_value', { length: 60 }),
    toValue: varchar('to_value', { length: 60 }),
    note: text('note'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('lead_events_lead_idx').on(t.leadId, t.createdAt)],
)

export const profilingSessions = pgTable(
  'profiling_sessions',
  {
    id: id(),
    sessionId: varchar('session_id', { length: 64 }).notNull(),
    step: integer('step').notNull().default(1),
    answers: jsonb('answers').$type<Record<string, unknown>>().notNull().default({}),
    recommendedProductId: uuid('recommended_product_id').references(() => products.id, { onDelete: 'set null' }),
    matchScore: integer('match_score'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('profiling_sessions_sid_uq').on(t.sessionId), index('profiling_step_idx').on(t.step)],
)

export const suggestions = pgTable('suggestions', {
  id: id(),
  name: varchar('name', { length: 160 }),
  phone: varchar('phone', { length: 40 }),
  email: varchar('email', { length: 200 }),
  message: text('message').notNull(),
  isAnonymous: boolean('is_anonymous').notNull().default(false),
  isRead: boolean('is_read').notNull().default(false),
  createdAt: createdAt(),
})

/* ================================== ANALYTICS ================================= */

export const pageViews = pgTable(
  'page_views',
  {
    id: id(),
    path: varchar('path', { length: 400 }).notNull(),
    sessionId: varchar('session_id', { length: 64 }).notNull(),
    referrer: text('referrer'),
    utmSource: varchar('utm_source', { length: 120 }),
    utmMedium: varchar('utm_medium', { length: 120 }),
    utmCampaign: varchar('utm_campaign', { length: 120 }),
    device: varchar('device', { length: 20 }),
    country: varchar('country', { length: 4 }),
    createdAt: createdAt(),
  },
  (t) => [index('page_views_path_idx').on(t.path, t.createdAt), index('page_views_created_idx').on(t.createdAt)],
)

export const events = pgTable(
  'events',
  {
    id: id(),
    name: varchar('name', { length: 60 }).notNull(),
    path: varchar('path', { length: 400 }),
    sessionId: varchar('session_id', { length: 64 }).notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('events_name_idx').on(t.name, t.createdAt)],
)

export const dailyRollups = pgTable(
  'daily_rollups',
  {
    date: varchar('date', { length: 10 }).primaryKey(),
    views: integer('views').notNull().default(0),
    visitors: integer('visitors').notNull().default(0),
    leads: integer('leads').notNull().default(0),
    profilingStarted: integer('profiling_started').notNull().default(0),
    profilingCompleted: integer('profiling_completed').notNull().default(0),
    topPaths: jsonb('top_paths').$type<{ path: string; views: number }[]>().notNull().default([]),
    topSources: jsonb('top_sources').$type<{ source: string; views: number }[]>().notNull().default([]),
  },
)

/* ================================== RELATIONS ================================= */

export const usersRelations = relations(users, ({ many }) => ({
  userRoles: many(userRoles),
  userBranches: many(userBranches),
}))

export const rolesRelations = relations(roles, ({ many }) => ({ userRoles: many(userRoles) }))

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}))

export const userBranchesRelations = relations(userBranches, ({ one }) => ({
  user: one(users, { fields: [userBranches.userId], references: [users.id] }),
  branch: one(branches, { fields: [userBranches.branchId], references: [branches.id] }),
}))

export const pagesRelations = relations(pages, ({ many }) => ({ blocks: many(pageBlocks) }))
export const pageBlocksRelations = relations(pageBlocks, ({ one }) => ({
  page: one(pages, { fields: [pageBlocks.pageId], references: [pages.id] }),
}))

export const postsRelations = relations(posts, ({ one }) => ({
  category: one(postCategories, { fields: [posts.categoryId], references: [postCategories.id] }),
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}))

export const leadsRelations = relations(leads, ({ one, many }) => ({
  product: one(products, { fields: [leads.productId], references: [products.id] }),
  branch: one(branches, { fields: [leads.branchId], references: [branches.id] }),
  assignedTo: one(users, { fields: [leads.assignedToId], references: [users.id] }),
  eventLog: many(leadEvents),
}))

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  branch: one(branches, { fields: [jobs.branchId], references: [branches.id] }),
  applications: many(jobApplications),
}))

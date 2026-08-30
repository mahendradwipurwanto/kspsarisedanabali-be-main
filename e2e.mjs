import 'dotenv/config'

const API = process.env.API_URL ?? 'http://localhost:4001'
// Read the credential from the environment so the suite cannot drift from the seed.
const ADMIN_PW = process.env.SEED_ADMIN_PASSWORD
if (!ADMIN_PW) {
  console.error('SEED_ADMIN_PASSWORD must be set — this suite signs in as the admin.')
  process.exit(1)
}
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@sarisedanabali.co.id'
let pass = 0, fail = 0
const ok = (m) => { console.log(`  \x1b[32m✓\x1b[0m ${m}`); pass++ }
const bad = (m) => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); fail++ }
const head = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`)

const call = async (path, opts = {}) => {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
    body: opts.json ? JSON.stringify(opts.json) : undefined,
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

// Negative-path tests deliberately produce failed logins; clear the window so a
// repeated run is not throttled by its own previous run.
await (async () => {
  const { default: postgres } = await import('postgres')
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'prefer', max: 1, connect_timeout: 10, idle_timeout: 5, onnotice: () => {} })
  await sql`delete from login_attempts where created_at > now() - interval '20 minutes'`
  await sql.end({ timeout: 3 })
})()

head('1. Auth')
const login = await call('/v1/auth/login', { method: 'POST', json: { email: ADMIN_EMAIL, password: ADMIN_PW } })
login.status === 200 && login.body.accessToken ? ok('admin login succeeds') : bad(`admin login failed: ${login.status}`)
const token = login.body.accessToken

const wrong = await call('/v1/auth/login', { method: 'POST', json: { email: ADMIN_EMAIL, password: 'salah-sekali' } })
wrong.status === 401 ? ok('wrong password rejected (401)') : bad(`expected 401, got ${wrong.status}`)

const noUser = await call('/v1/auth/login', { method: 'POST', json: { email: 'tidak-ada@example.com', password: 'apapun123' } })
noUser.body?.error?.message === wrong.body?.error?.message
  ? ok('unknown email and wrong password give an identical message (no enumeration)')
  : bad('login responses leak whether an account exists')

head('2. RBAC — a branch-scoped role must not read other branches')
const roles = await call('/v1/roles', { token })
const branchRole = roles.body.data.find((r) => r.key === 'branch_staff')
const branches = await call('/v1/branches', { token })
const [rendang, karangasem] = [branches.body.data.find((b) => b.slug === 'cabang-rendang'), branches.body.data.find((b) => b.slug === 'cabang-karangasem')]

const staffEmail = `e2e-staf-${Date.now()}@sarisedanabali.co.id`
const created = await call('/v1/users', {
  method: 'POST', token,
  json: { name: 'E2E Staf Rendang', email: staffEmail, password: 'RahasiaKuat123', roleIds: [branchRole.id], branchIds: [rendang.id] },
})
created.status === 201 ? ok('created a Staf Cabang scoped to Rendang') : bad(`user create failed: ${JSON.stringify(created.body)}`)

const staffLogin = await call('/v1/auth/login', { method: 'POST', json: { email: staffEmail, password: 'RahasiaKuat123' } })
const staffToken = staffLogin.body.accessToken
staffToken ? ok('staf cabang can log in') : bad('staf cabang login failed')

// Seed one lead per branch so the scope has something to discriminate.
for (const [branch, name] of [[rendang, 'E2E Lead Rendang'], [karangasem, 'E2E Lead Karangasem']]) {
  await call('/v1/public/leads', {
    method: 'POST',
    json: { name, phone: '081234567890', branchId: branch.id, source: 'contact_form', consent: true },
  })
}

const staffLeads = await call('/v1/leads?limit=100', { token: staffToken })
const names = staffLeads.body.data.map((l) => l.name)
names.includes('E2E Lead Rendang') ? ok('staf cabang sees their own branch lead') : bad('staf cabang cannot see their own branch lead')
!names.includes('E2E Lead Karangasem')
  ? ok('staf cabang CANNOT see another branch lead (query-level scope holds)')
  : bad('SCOPE LEAK: staf cabang can read another branch lead')

const forbidden = await call('/v1/users', { token: staffToken })
forbidden.status === 403 ? ok('staf cabang blocked from /users (403)') : bad(`expected 403 on /users, got ${forbidden.status}`)

const forbiddenRoles = await call('/v1/roles', { method: 'POST', token: staffToken, json: { name: 'Hack', permissions: ['users:delete'] } })
forbiddenRoles.status === 403 ? ok('staf cabang blocked from creating roles (403)') : bad(`expected 403, got ${forbiddenRoles.status}`)

const noToken = await call('/v1/leads')
noToken.status === 401 ? ok('unauthenticated /leads rejected (401)') : bad(`expected 401, got ${noToken.status}`)

head('3. Publish gate — the SEO checks are enforced server-side')
const pages = await call('/v1/pages?limit=50', { token })
const home = pages.body.data.find((p) => p.slug === '/')
const homeFull = await call(`/v1/pages/${home.id}`, { token })
homeFull.body.seo.score >= 60 ? ok(`beranda SEO score ${homeFull.body.seo.score}%`) : bad(`beranda SEO score too low: ${homeFull.body.seo.score}%`)

const draft = await call('/v1/pages', {
  method: 'POST', token,
  json: { title: 'E2E Halaman Uji', slug: `e2e-uji-${Date.now()}`, seo: {}, blocks: [] },
})
const draftId = draft.body.data.id
draft.status === 201 ? ok('created a draft page with empty SEO') : bad('draft create failed')

const blockedPublish = await call(`/v1/pages/${draftId}/publish`, { method: 'POST', token })
blockedPublish.status === 422
  ? ok(`publish blocked without title/description: "${blockedPublish.body.error.message}"`)
  : bad(`expected 422 publish gate, got ${blockedPublish.status}`)

head('4. Block validation — unknown types and duplicate H1 blocks are refused')
const badBlock = await call(`/v1/pages/${draftId}`, {
  method: 'PATCH', token,
  json: { blocks: [{ type: 'blok_palsu', props: {}, isVisible: true }] },
})
badBlock.status === 422 ? ok('unknown block type rejected (422)') : bad(`expected 422, got ${badBlock.status}`)

const twoH1 = await call(`/v1/pages/${draftId}`, {
  method: 'PATCH', token,
  json: {
    blocks: [
      { type: 'page_header', props: { heading: 'Judul Satu' }, isVisible: true },
      { type: 'page_header', props: { heading: 'Judul Dua' }, isVisible: true },
    ],
  },
})
twoH1.status === 422 ? ok('two H1 blocks on one page rejected (422)') : bad(`expected 422 for duplicate singleton, got ${twoH1.status}`)

head('5. Profiling wizard end-to-end')
const sid = `e2e${Date.now()}`
await call('/v1/public/profiling/session', { method: 'POST', json: { sessionId: sid, step: 3, answers: { need: 'pinjaman', amount: 75000000, tenorMonths: 36 } } })
const rec = await call('/v1/public/profiling/recommend', {
  method: 'POST',
  json: { need: 'pinjaman', purposes: ['modal_usaha'], amount: 75000000, tenorMonths: 36, sessionId: sid },
})
const best = rec.body.data?.best
best ? ok(`recommends "${best.product.name}" at ${best.score}% match`) : bad('no recommendation returned')
// The rate gate: an unverified product must never yield a rupiah figure, and a
// verified one must. Prove both directions rather than either alone.
best?.estimate == null
  ? ok('unverified product yields NO installment figure (rate gate holds)')
  : bad('LEAK: an unverified product produced an installment figure')

{
  const target = best?.product.id
  await call(`/v1/products/${target}`, { method: 'PATCH', token, json: { isVerified: true } })
  const verified = await call('/v1/public/profiling/recommend', {
    method: 'POST',
    json: { need: 'pinjaman', purposes: ['modal_usaha'], amount: 75000000, tenorMonths: 36 },
  })
  const vb = verified.body.data?.best
  vb?.estimate?.monthly > 0
    ? ok(`once verified, installment computes: Rp${vb.estimate.monthly.toLocaleString('id-ID')}/bln`)
    : bad('a verified product still produced no installment figure')
  await call(`/v1/products/${target}`, { method: 'PATCH', token, json: { isVerified: false } })

  const relocked = await call('/v1/public/products')
  const leaks = relocked.body.data.filter((p) => !p.isVerified && p.ratePercent !== null)
  leaks.length === 0 ? ok('public product list exposes no unverified rate') : bad(`${leaks.length} unverified rates leaked`)
}

const wizardLead = await call('/v1/public/leads', {
  method: 'POST',
  json: { name: 'E2E Profiling', phone: '081234567891', source: 'profiling', sessionId: sid, amount: 75000000, tenorMonths: 36, productId: best?.product.id, interest: 'pinjaman', consent: true },
})
wizardLead.status === 201 ? ok('wizard lead saved and linked to the session') : bad('wizard lead failed')

head('6. Anti-spam and validation')
const honeypot = await call('/v1/public/leads', {
  method: 'POST',
  json: { name: 'Bot Spammer', phone: '081234567899', source: 'contact_form', consent: true, website: 'http://spam.example' },
})
const afterHoneypot = await call('/v1/leads?q=Bot%20Spammer&limit=5', { token })
honeypot.status === 201 && afterHoneypot.body.data.length === 0
  ? ok('honeypot submission accepted with 201 but never stored (bot learns nothing)')
  : bad(`honeypot: status ${honeypot.status}, stored rows ${afterHoneypot.body.data?.length}`)

const noConsent = await call('/v1/public/leads', { method: 'POST', json: { name: 'Tanpa Izin', phone: '081234567892', source: 'contact_form' } })
noConsent.status === 422 ? ok('lead without consent rejected (422)') : bad(`expected 422 without consent, got ${noConsent.status}`)

head('7. Public read surface used by the landing page')
for (const [path, label] of [
  ['/v1/public/pages/home', 'beranda blocks'],
  ['/v1/public/products', 'products'],
  ['/v1/public/branches', 'branches'],
  ['/v1/public/posts', 'posts'],
  ['/v1/public/sitemap-data', 'sitemap feed'],
  ['/v1/public/redirects', 'redirect map'],
]) {
  const r = await call(path)
  r.status === 200 ? ok(`${label} OK`) : bad(`${label} returned ${r.status}`)
}

const redirects = await call('/v1/public/redirects')
const selfRefs = redirects.body.data.filter((r) => r.fromPath.replace(/\/$/, '') === r.toPath.replace(/\/$/, ''))
selfRefs.length === 0 ? ok('no self-referencing redirects (no infinite loops)') : bad(`${selfRefs.length} self-redirects would loop`)

const gone = redirects.body.data.filter((r) => r.statusCode === 410).map((r) => r.fromPath)
gone.includes('/wp-admin') && gone.includes('/wp-login.php')
  ? ok('old WordPress admin paths return 410 Gone')
  : bad('WordPress admin paths not closed')

head('8. Cleanup')
await call(`/v1/pages/${draftId}`, { method: 'DELETE', token })
await call(`/v1/users/${created.body.data.id}`, { method: 'DELETE', token })
ok('removed E2E fixtures')

console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`)
process.exit(fail ? 1 : 0)

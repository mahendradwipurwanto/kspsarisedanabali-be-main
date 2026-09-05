import 'dotenv/config'
import { inArray } from 'drizzle-orm'
import { db, sqlClient } from './index.js'
import * as t from './schema.js'
import { SYSTEM_ROUTE_PAGES } from './system-pages.js'

/**
 * Add any missing system page to an existing database.
 *
 * Unlike the seed this never rewrites a page that is already there, so it is
 * safe to run against production after a deploy that introduces a new route.
 *
 *   npx tsx src/db/sync-system-pages.ts
 */
async function main() {
  const slugs = SYSTEM_ROUTE_PAGES.map((p) => p.slug)
  const existing = await db.select({ slug: t.pages.slug }).from(t.pages).where(inArray(t.pages.slug, slugs))
  const have = new Set(existing.map((r) => r.slug))

  const [admin] = await db.select({ id: t.users.id }).from(t.users).limit(1)
  if (!admin) throw new Error('No user to attribute the pages to. Run the seed first.')

  let added = 0
  for (const page of SYSTEM_ROUTE_PAGES) {
    if (have.has(page.slug)) {
      console.log(`· ${page.slug} sudah ada, dilewati`)
      continue
    }
    const [row] = await db
      .insert(t.pages)
      .values({
        title: page.title,
        slug: page.slug,
        status: 'published',
        isSystem: true,
        seo: page.seo,
        publishedAt: new Date(),
        createdById: admin.id,
        updatedById: admin.id,
      })
      .returning({ id: t.pages.id })

    await db.insert(t.pageBlocks).values(
      page.blocks.map((b, i) => ({ pageId: row!.id, type: b.type, props: b.props, position: i, isVisible: true })),
    )
    added++
    console.log(`✓ ${page.slug} dibuat dengan ${page.blocks.length} blok`)
  }

  console.log(`\n${added} halaman ditambahkan, ${slugs.length - added} sudah ada.`)
  await sqlClient.end({ timeout: 5 })
}

void main()

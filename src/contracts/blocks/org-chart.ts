/**
 * The organisation chart's shape, shared by the website renderer and the
 * console editor so the two cannot disagree about what a chart is.
 *
 * A chart is an ordered list of **levels**, top to bottom. Nothing about the
 * koperasi's own hierarchy is baked in: a level is either one wide box or a
 * row of columns, any level may carry a box hanging off the connector beneath
 * it (the internal auditor on the official chart), and there may be as many
 * levels as the structure needs.
 *
 * Earlier charts were stored as five fixed props — apex, groups, audit,
 * operationsLead, units — which could only ever describe one shape. Those are
 * still read: `orgLevelsFrom` converts them, so a page saved before this
 * renders exactly as it did, and the editor writes levels from then on.
 */

export interface OrgMember {
  name?: string
  role?: string
  [k: string]: unknown
}

export interface OrgColumn {
  title?: string
  tone?: string
  members?: OrgMember[]
  [k: string]: unknown
}

export interface OrgLevel {
  /** One wide box, or a row of columns. */
  kind?: 'kotak' | 'kolom'
  /** Text of the box, when `kind` is `kotak`. */
  title?: string
  tone?: string
  /**
   * How a column is drawn: `kartu` is one card with a heading strip and its
   * people listed inside (the board), `daftar` is a heading box with each
   * entry as its own chip beneath it (an operational unit).
   */
  style?: 'kartu' | 'daftar'
  columns?: OrgColumn[]
  /** A box beside the connector below this level, e.g. an internal auditor. */
  aside?: string
  asideTone?: string
  [k: string]: unknown
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

/** Does this level draw anything at all? Empty levels are skipped, not spaced. */
export function orgLevelIsEmpty(level: OrgLevel): boolean {
  if (str(level.aside)) return false
  if (level.kind === 'kolom') return !list<OrgColumn>(level.columns).some((c) => str(c.title) || list<OrgMember>(c.members).some((m) => str(m.name)))
  return !str(level.title)
}

/**
 * The levels a block should render.
 *
 * `props.levels` wins when it has anything in it. Otherwise the legacy five
 * props are converted, with `fallbackGroups` standing in for the board when
 * the block carries none — that is the settings-driven board the website has
 * always fallen back to.
 */
export function orgLevelsFrom(props: Record<string, unknown>, fallbackGroups: OrgColumn[] = []): OrgLevel[] {
  const declared = list<OrgLevel>(props.levels).filter((l) => !orgLevelIsEmpty(l))
  if (declared.length) return declared

  const levels: OrgLevel[] = []

  const apex = str(props.apex)
  if (apex) levels.push({ kind: 'kotak', title: apex, tone: str(props.apexTone) || 'gelap' })

  const groupsProp = list<OrgColumn>(props.groups)
  const groups = groupsProp.length ? groupsProp : fallbackGroups
  if (groups.length) {
    levels.push({
      kind: 'kolom',
      style: 'kartu',
      columns: groups.map((g) => ({ ...g, tone: str(g.tone) || 'netral' })),
      // The auditor hung off the line below the board on the old chart.
      aside: str(props.audit),
      asideTone: str(props.auditTone) || 'emas',
    })
  }

  const lead = str(props.operationsLead)
  if (lead) {
    levels.push({
      kind: 'kotak',
      title: lead,
      tone: str(props.leadTone) || 'gelap',
      // With no board above it, the auditor still needs somewhere to hang.
      ...(groups.length ? {} : { aside: str(props.audit), asideTone: str(props.auditTone) || 'emas' }),
    })
  }

  const units = list<OrgColumn>(props.units)
  if (units.length) {
    levels.push({
      kind: 'kolom',
      style: 'daftar',
      columns: units.map((u) => ({
        title: u.title,
        tone: str(u.tone) || 'hijau',
        // Units stored their entries under `roles`, each with a `name`.
        members: list<{ name?: string }>((u as { roles?: unknown }).roles).map((r) => ({ name: r.name })),
      })),
    })
  }

  return levels.filter((l) => !orgLevelIsEmpty(l))
}

/** A blank level of the requested kind, used by the console's "add" buttons. */
export function emptyOrgLevel(kind: 'kotak' | 'kolom'): OrgLevel {
  return kind === 'kotak'
    ? { kind: 'kotak', title: '', tone: 'gelap' }
    : { kind: 'kolom', style: 'kartu', columns: [{ title: '', tone: 'netral', members: [{ name: '', role: '' }] }] }
}

import { z, type ZodTypeAny } from 'zod'

/**
 * A tiny field DSL. One definition drives three things:
 *   1. the LP component's props type
 *   2. the auto-generated edit form in the CMS
 *   3. server-side validation in the API
 *
 * Add a field here and it appears in the CMS with no extra form code.
 */

export type FieldDef =
  | { kind: 'text'; label: string; help?: string; placeholder?: string; required?: boolean; max?: number; default?: string }
  | { kind: 'textarea'; label: string; help?: string; placeholder?: string; required?: boolean; max?: number; rows?: number; default?: string }
  | { kind: 'richtext'; label: string; help?: string; required?: boolean }
  | { kind: 'number'; label: string; help?: string; required?: boolean; min?: number; max?: number; step?: number; default?: number }
  | { kind: 'boolean'; label: string; help?: string; default?: boolean }
  | { kind: 'select'; label: string; help?: string; required?: boolean; options: { value: string; label: string }[]; default?: string }
  | { kind: 'image'; label: string; help?: string; required?: boolean }
  | { kind: 'link'; label: string; help?: string; required?: boolean; placeholder?: string; max?: number; default?: string }
  | { kind: 'icon'; label: string; help?: string; required?: boolean; max?: number; default?: string }
  | { kind: 'color'; label: string; help?: string; required?: boolean; max?: number; default?: string }
  | { kind: 'reference'; label: string; help?: string; to: 'product' | 'post' | 'branch' | 'page'; multiple?: boolean }
  | { kind: 'repeater'; label: string; help?: string; itemLabel?: string; min?: number; max?: number; of: FieldMap }

export type FieldMap = Record<string, FieldDef>

/** Convenience constructors — `field.text({ label: '…' })` reads better than a literal. */
export const field = {
  text: (o: Omit<Extract<FieldDef, { kind: 'text' }>, 'kind'>) => ({ kind: 'text', ...o }) as FieldDef,
  textarea: (o: Omit<Extract<FieldDef, { kind: 'textarea' }>, 'kind'>) => ({ kind: 'textarea', ...o }) as FieldDef,
  richtext: (o: Omit<Extract<FieldDef, { kind: 'richtext' }>, 'kind'>) => ({ kind: 'richtext', ...o }) as FieldDef,
  number: (o: Omit<Extract<FieldDef, { kind: 'number' }>, 'kind'>) => ({ kind: 'number', ...o }) as FieldDef,
  boolean: (o: Omit<Extract<FieldDef, { kind: 'boolean' }>, 'kind'>) => ({ kind: 'boolean', ...o }) as FieldDef,
  select: (o: Omit<Extract<FieldDef, { kind: 'select' }>, 'kind'>) => ({ kind: 'select', ...o }) as FieldDef,
  image: (o: Omit<Extract<FieldDef, { kind: 'image' }>, 'kind'>) => ({ kind: 'image', ...o }) as FieldDef,
  link: (o: Omit<Extract<FieldDef, { kind: 'link' }>, 'kind'>) => ({ kind: 'link', ...o }) as FieldDef,
  icon: (o: Omit<Extract<FieldDef, { kind: 'icon' }>, 'kind'>) => ({ kind: 'icon', ...o }) as FieldDef,
  color: (o: Omit<Extract<FieldDef, { kind: 'color' }>, 'kind'>) => ({ kind: 'color', ...o }) as FieldDef,
  reference: (o: Omit<Extract<FieldDef, { kind: 'reference' }>, 'kind'>) => ({ kind: 'reference', ...o }) as FieldDef,
  repeater: (o: Omit<Extract<FieldDef, { kind: 'repeater' }>, 'kind'>) => ({ kind: 'repeater', ...o }) as FieldDef,
}

function leafToZod(f: FieldDef): ZodTypeAny {
  switch (f.kind) {
    case 'text':
    case 'link':
    case 'icon':
    case 'color': {
      let s = z.string()
      if ('max' in f && f.max) s = s.max(f.max)
      return f.required ? s.min(1, 'Wajib diisi') : s.optional().or(z.literal(''))
    }
    case 'textarea':
    case 'richtext': {
      let s = z.string()
      if ('max' in f && f.max) s = s.max(f.max)
      return f.required ? s.min(1, 'Wajib diisi') : s.optional().or(z.literal(''))
    }
    case 'number': {
      let n = z.number()
      if (f.min !== undefined) n = n.min(f.min)
      if (f.max !== undefined) n = n.max(f.max)
      return f.required ? n : n.optional()
    }
    case 'boolean':
      return z.boolean().optional()
    case 'select': {
      const vals = f.options.map((o) => o.value)
      const s = z.string().refine((v) => vals.includes(v), { message: 'Pilihan tidak valid' })
      return f.required ? s : s.optional()
    }
    case 'image':
      // media id (uuid) or a direct URL
      return f.required ? z.string().min(1, 'Gambar wajib dipilih') : z.string().optional().or(z.literal(''))
    case 'reference':
      return f.multiple ? z.array(z.string()).optional() : z.string().optional()
    case 'repeater': {
      let a = z.array(fieldsToZod(f.of))
      if (f.min !== undefined) a = a.min(f.min, `Minimal ${f.min} item`)
      if (f.max !== undefined) a = a.max(f.max, `Maksimal ${f.max} item`)
      return a.optional().default([])
    }
  }
}

export function fieldsToZod(fields: FieldMap) {
  const shape: Record<string, ZodTypeAny> = {}
  for (const [key, def] of Object.entries(fields)) shape[key] = leafToZod(def)
  return z.object(shape)
}

/** Default props for a freshly inserted block, derived from the field defaults. */
export function defaultsFor(fields: FieldMap): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, def] of Object.entries(fields)) {
    if (def.kind === 'repeater') out[key] = []
    else if ('default' in def && def.default !== undefined) out[key] = def.default
    else if (def.kind === 'boolean') out[key] = false
    else if (def.kind === 'number') out[key] = undefined
    else out[key] = ''
  }
  return out
}

import type { Sql } from "postgres";
import type {
  RegulationMatch,
  RegulationRepository,
  RegulationSearch,
  RegulationSection,
  RegulationSummary,
} from "@/application/regulations/ports";

export class PostgresRegulations
  implements RegulationRepository, RegulationSearch
{
  constructor(private readonly database: () => Sql) {}

  async list(): Promise<RegulationSummary[]> {
    return this.database()<
      RegulationSummary[]
    >`select doc_slug as slug, title, body as introduction from regulation_chunks where section = '0' order by title, doc_slug`;
  }

  async findBySlug(slug: string): Promise<RegulationSection[]> {
    return this.database()<
      RegulationSection[]
    >`select section, title, body from regulation_chunks where doc_slug = ${slug}`;
  }

  async search(query: string): Promise<RegulationMatch[]> {
    const sql = this.database();
    const withoutHtml = sql`regexp_replace(c.body, '<[^>]*>', '', 'g')`;
    const withoutLinks = sql`regexp_replace(${withoutHtml}, ${String.raw`!?\[([^]]+)\]\([^)]*\)`}, ${String.raw`\1`}, 'g')`;
    const withoutBlockMarkers = sql`regexp_replace(${withoutLinks}, ${String.raw`(^|\n)[[:blank:]]*(#{1,6}[[:blank:]]+|[-+*][[:blank:]]+|[0-9]+[.)][[:blank:]]+)`}, ${String.raw`\1`}, 'g')`;
    const withoutEmphasis = sql`regexp_replace(${withoutBlockMarkers}, ${"[*`]+"}, '', 'g')`;
    const plainBody = sql`trim(regexp_replace(${withoutEmphasis}, '[[:space:]]+', ' ', 'g'))`;
    const strict = await sql<RegulationMatch[]>`
      select c.doc_slug as slug, d.title as "documentTitle", c.section, c.title,
        ts_headline('russian', ${plainBody}, q.term,
          'StartSel=[[[, StopSel=]]], MaxWords=35, MinWords=12, MaxFragments=1, ShortWord=0, FragmentDelimiter= … ') as excerpt
      from regulation_chunks c
      join regulation_chunks d on d.doc_slug = c.doc_slug and d.section = '0'
      cross join websearch_to_tsquery('russian', ${query}) q(term)
      where c.section <> '0' and c.tsv @@ q.term
      order by ts_rank(c.tsv, q.term) desc, c.doc_slug, c.section
      limit 5`;
    if (strict.length === 5) return strict;
    // Expand parsed lexemes, never raw query text; reject weak generic overlaps.
    const fallback = await sql<RegulationMatch[]>`
      select c.doc_slug as slug, d.title as "documentTitle", c.section, c.title,
        ts_headline('russian', ${plainBody}, q.term,
          'StartSel=[[[, StopSel=]]], MaxWords=35, MinWords=12, MaxFragments=1, ShortWord=0, FragmentDelimiter= … ') as excerpt
      from regulation_chunks c
      join regulation_chunks d on d.doc_slug = c.doc_slug and d.section = '0'
      cross join (select replace(plainto_tsquery('russian', ${query})::text, ' & ', ' | ')::tsquery) q(term)
      where c.section <> '0' and c.tsv @@ q.term and ts_rank(c.tsv, q.term) >= 0.03
      order by ts_rank(c.tsv, q.term) desc, c.doc_slug, c.section
      limit 5`;
    const seen = new Set(strict.map((row) => `${row.slug}:${row.section}`));
    return [
      ...strict,
      ...fallback.filter((row) => !seen.has(`${row.slug}:${row.section}`)),
    ].slice(0, 5);
  }
}

import { compareSections, sectionAnchor } from "@/domain/regulations/markdown";
import type { Actor } from "../ports/actor";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import type {
  RegulationMatch,
  RegulationRepository,
  RegulationSearch,
  RegulationSection,
} from "./ports";
import {
  parseDocumentInput,
  parseListInput,
  parseSearchInput,
} from "./schemas";

export type { RegulationSummary } from "./ports";
export type RegulationResultDto = RegulationMatch & { href: string };
export interface RegulationDocumentDto {
  slug: string;
  title: string;
  introduction: string;
  sections: (RegulationSection & { anchor: string; href: string })[];
}

export class ListRegulations {
  constructor(private readonly repository: RegulationRepository) {}

  async execute(actor: Actor, input: unknown = {}) {
    if (actor.kind !== "student") throw new ForbiddenError();
    parseListInput(input);
    return this.repository.list();
  }
}

export class GetRegulation {
  constructor(private readonly repository: RegulationRepository) {}

  async execute(actor: Actor, input: unknown): Promise<RegulationDocumentDto> {
    if (actor.kind !== "student") throw new ForbiddenError();
    const { slug } = parseDocumentInput(input);
    const chunks = await this.repository.findBySlug(slug);
    const preamble = chunks.find((chunk) => chunk.section === "0");
    if (!preamble) throw new NotFoundError();
    return {
      slug,
      title: preamble.title,
      introduction: preamble.body,
      sections: chunks
        .filter((chunk) => chunk.section !== "0")
        .sort((a, b) => compareSections(a.section, b.section))
        .map((chunk) => ({
          ...chunk,
          anchor: sectionAnchor(chunk.section),
          href: regulationHref(slug, chunk.section),
        })),
    };
  }
}

export class SearchRegulations {
  constructor(private readonly search: RegulationSearch) {}

  async execute(actor: Actor, input: unknown): Promise<RegulationResultDto[]> {
    if (actor.kind !== "student") throw new ForbiddenError();
    const { query } = parseSearchInput(input);
    const results = await this.search.search(query);
    return results.slice(0, 5).map((result) => ({
      ...result,
      href: regulationHref(result.slug, result.section),
    }));
  }
}

function regulationHref(slug: string, section: string): string {
  return `/regulations/${encodeURIComponent(slug)}#${sectionAnchor(section)}`;
}

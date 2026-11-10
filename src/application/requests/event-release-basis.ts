import type { Actor } from "../ports/actor";
import type { RegulationRepository } from "../regulations/ports";
import { ForbiddenError, NotFoundError } from "../shared/errors";

export const EVENT_RELEASE_REGULATION = {
  slug: "attendance",
  section: "4",
  href: "/regulations/attendance#p-4",
} as const;

export interface EventReleaseBasis {
  section: string;
  title: string;
}

export class GetEventReleaseBasis {
  constructor(
    private readonly regulations: Pick<RegulationRepository, "findBySlug">,
  ) {}

  async execute(actor: Actor): Promise<EventReleaseBasis> {
    if (actor.kind !== "staff") throw new ForbiddenError();
    const sections = await this.regulations.findBySlug(
      EVENT_RELEASE_REGULATION.slug,
    );
    const basis = sections.find(
      ({ section }) => section === EVENT_RELEASE_REGULATION.section,
    );
    if (!basis) throw new NotFoundError();
    return { section: basis.section, title: basis.title };
  }
}

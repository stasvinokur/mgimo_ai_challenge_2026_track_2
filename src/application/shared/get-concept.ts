import { concept } from "@/domain/shared/concept";

export type ConceptDto = { name: string; notice: string };

export class GetConcept {
  execute(): ConceptDto {
    return { name: concept.name, notice: concept.notice };
  }
}

export interface ConceptMessageDto {
  name: "brandName";
  notice: "competitionConcept";
}

export function getConceptMessage(): ConceptMessageDto {
  return { name: "brandName", notice: "competitionConcept" };
}

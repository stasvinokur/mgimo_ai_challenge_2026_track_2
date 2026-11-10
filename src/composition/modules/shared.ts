import "server-only";
import { GetConcept } from "@/application/shared/get-concept";

export function createSharedModule() {
  return { getConcept: new GetConcept() };
}

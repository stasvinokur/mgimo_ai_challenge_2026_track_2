import type {
  RegulationMatch,
  RegulationRepository,
  RegulationSearch,
  RegulationSection,
  RegulationSummary,
} from "@/application/regulations/ports";

export class FakeRegulations implements RegulationRepository, RegulationSearch {
  calls: string[] = [];
  documents: RegulationSummary[] = [
    {
      slug: "scholarship",
      title: "Стипендии",
      introduction: "Вымышленное положение конкурсного концепта.",
    },
  ];
  sections: RegulationSection[] = [
    { section: "2.10", title: "Десятый", body: "Текст" },
    { section: "0", title: "Стипендии", body: "Преамбула" },
    { section: "2", title: "Стипендия", body: "Все итоги ≥ 86" },
    { section: "2.2", title: "Второй", body: "Текст" },
  ];
  matches: RegulationMatch[] = [
    {
      slug: "scholarship",
      documentTitle: "Стипендии",
      section: "2",
      title: "Стипендия",
      excerpt: "[[[Повышенная]]] стипендия",
    },
  ];

  async list() {
    this.calls.push("list");
    return structuredClone(this.documents);
  }
  async findBySlug(slug: string) {
    this.calls.push(slug);
    return slug === "scholarship" ? structuredClone(this.sections) : [];
  }
  async search(query: string) {
    this.calls.push(query);
    return structuredClone(this.matches);
  }
}

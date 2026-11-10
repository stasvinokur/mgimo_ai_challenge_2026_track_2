export interface RegulationSummary {
  slug: string;
  title: string;
  introduction: string;
}

export interface RegulationSection {
  section: string;
  title: string;
  body: string;
}

export interface RegulationMatch {
  slug: string;
  documentTitle: string;
  section: string;
  title: string;
  excerpt: string;
}

export interface RegulationRepository {
  list(): Promise<RegulationSummary[]>;
  findBySlug(slug: string): Promise<RegulationSection[]>;
}

// Excerpts contain text with [[[ / ]]] markers, never trusted HTML.
export interface RegulationSearch {
  search(query: string): Promise<RegulationMatch[]>;
}

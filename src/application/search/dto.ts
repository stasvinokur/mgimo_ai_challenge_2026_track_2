import type { RequestStatus } from "@/domain/requests/request-flow";
import type { Lesson } from "@/domain/schedule/schedule";

export { splitMarkedText, splitSearchText } from "@/domain/search/text";

export type SearchTitleDto =
  | string
  | { code: "request"; publicNo: string | null; typeTitle: string | null };

export type SearchContextDto =
  | {
      code: "schedule";
      startsAt: string;
      teacher: string;
      room: string;
      status: Lesson["status"];
    }
  | { code: "course" }
  | {
      code: "work";
      course: string;
      score: number | null;
      maxScore: number;
      dueAt: string;
    }
  | { code: "request"; status: RequestStatus }
  | { code: "requestType"; description: string }
  | {
      code: "regulation";
      documentTitle: string;
      section: string;
      excerpt: string;
    };

export interface SearchResultDto {
  id: string;
  title: SearchTitleDto;
  context: SearchContextDto;
  href: string;
  markedContext?: boolean;
}

export interface SearchGroupDto {
  id: "schedule" | "grades" | "requests" | "regulations";
  status: "ok" | "partial" | "error";
  items: SearchResultDto[];
  more: number;
}

export interface SearchDto {
  query: string;
  groups: SearchGroupDto[];
}

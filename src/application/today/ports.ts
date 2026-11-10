import type { GradesDto } from "@/application/grades/get-my-grades";
import type { NotificationsFeedDto } from "@/application/notifications/use-cases";
import type { Actor } from "@/application/ports/actor";
import type { SpeechAudio } from "@/application/ports/speech-synthesizer";
import type { RequestDto } from "@/application/requests/dto";
import type { TodayScheduleDto } from "@/application/schedule/get-schedule";

export interface TodaySources {
  schedule(actor: Actor): Promise<TodayScheduleDto>;
  grades(actor: Actor): Promise<GradesDto>;
  requests(actor: Actor): Promise<RequestDto[]>;
  notifications(actor: Actor): Promise<NotificationsFeedDto>;
}

export interface BriefingSpeechCache {
  readonly enabled: boolean;
  getOrSynthesize(
    text: string,
    beforeSynthesis: () => Promise<void>,
  ): Promise<SpeechAudio>;
}

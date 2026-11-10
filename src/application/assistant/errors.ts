import { ConflictError } from "../shared/errors";

export class AssistantBusyError extends ConflictError {
  override readonly message = "Подождите ответа на предыдущий вопрос.";
}

interface SavedDraft {
  id: string;
  payload: Record<string, unknown>;
  review: boolean;
}

export function createRequestFormState(draft?: {
  id?: string;
  payload: Record<string, unknown>;
}) {
  return {
    id: draft?.id,
    payload: draft?.payload ?? {},
    revision: 0,
    review: false,
    saved: false,
    dirty: false,
  };
}

type RequestFormState = ReturnType<typeof createRequestFormState>;
type RequestFormEvent =
  | { type: "changed"; name: string; value: string }
  | { type: "started" }
  | { type: "saved"; revision: number; draft: SavedDraft }
  | { type: "edit" };

export function requestFormReducer(
  state: RequestFormState,
  event: RequestFormEvent,
): RequestFormState {
  switch (event.type) {
    case "changed":
      return {
        ...state,
        payload: { ...state.payload, [event.name]: event.value },
        revision: state.revision + 1,
        saved: false,
        dirty: true,
      };
    case "started":
      return { ...state, saved: false };
    case "saved":
      if (state.revision !== event.revision)
        return { ...state, id: event.draft.id };
      return {
        ...state,
        id: event.draft.id,
        payload: event.draft.payload,
        review: event.draft.review,
        saved: !event.draft.review,
        dirty: false,
      };
    case "edit":
      return { ...state, review: false };
  }
}

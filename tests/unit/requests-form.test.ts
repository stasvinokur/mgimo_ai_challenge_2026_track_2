import { expect, it } from "vitest";
import {
  createRequestFormState,
  requestFormReducer,
} from "@/ui/requests/request-form-state";

it("начальный текст не имеет id и становится черновиком только после сохранения студентом", () => {
  const payload = {
    question: "Вопрос по дисциплине «Основы маркетинга»\nПроверьте факты.",
  };
  const state = createRequestFormState({ payload });
  expect(state).toMatchObject({
    payload,
    id: undefined,
    saved: false,
    review: false,
  });
  const edited = requestFormReducer(state, {
    type: "changed",
    name: "question",
    value: `${payload.question}\nМоё уточнение.`,
  });
  expect(edited.id).toBeUndefined();
  const saved = requestFormReducer(edited, {
    type: "saved",
    revision: edited.revision,
    draft: { id: "draft-1", payload: edited.payload, review: true },
  });
  expect(saved).toMatchObject({
    id: "draft-1",
    review: true,
    payload: edited.payload,
  });
});

it.each([false, true])(
  "медленное сохранение (проверка: %s) сохраняет новые правки и id черновика",
  async (review) => {
    let state = requestFormReducer(createRequestFormState(), {
      type: "changed",
      name: "destination",
      value: "Учебный центр «Горизонт»",
    });
    const revision = state.revision;
    const response = Promise.withResolvers<{
      id: string;
      payload: Record<string, unknown>;
      review: boolean;
    }>();
    const saving = response.promise.then((draft) => {
      state = requestFormReducer(state, { type: "saved", revision, draft });
    });

    state = requestFormReducer(state, { type: "started" });
    state = requestFormReducer(state, {
      type: "changed",
      name: "destination",
      value: "Учебный центр «Горизонт» · новые правки",
    });
    response.resolve({
      id: "draft-1",
      payload: { destination: "Учебный центр «Горизонт»" },
      review,
    });
    await saving;

    expect(state).toMatchObject({
      id: "draft-1",
      payload: { destination: "Учебный центр «Горизонт» · новые правки" },
      dirty: true,
      saved: false,
      review: false,
    });

    state = requestFormReducer(state, {
      type: "saved",
      revision: state.revision,
      draft: { id: state.id ?? "duplicate", payload: state.payload, review },
    });
    expect(state.id).toBe("draft-1");
    expect(state.payload.destination).toBe(
      "Учебный центр «Горизонт» · новые правки",
    );
    expect(state.dirty).toBe(false);
    expect(state.saved).toBe(!review);
    expect(state.review).toBe(review);
  },
);

it("актуальная проверка применяет нормализацию сервера и открывает подтверждение", () => {
  const state = requestFormReducer(
    createRequestFormState({
      id: "draft-1",
      payload: { destination: "  Учебный центр «Горизонт»  " },
    }),
    {
      type: "saved",
      revision: 0,
      draft: {
        id: "draft-1",
        payload: { destination: "Учебный центр «Горизонт»" },
        review: true,
      },
    },
  );
  expect(state.payload.destination).toBe("Учебный центр «Горизонт»");
  expect(state.review).toBe(true);
  expect(state.dirty).toBe(false);
  expect(requestFormReducer(state, { type: "edit" }).review).toBe(false);
});

it("новая правка сразу убирает сообщение об успешном сохранении", () => {
  const saved = requestFormReducer(createRequestFormState(), {
    type: "saved",
    revision: 0,
    draft: { id: "draft-1", payload: {}, review: false },
  });
  expect(saved.saved).toBe(true);
  const edited = requestFormReducer(saved, {
    type: "changed",
    name: "destination",
    value: "Учебный центр «Горизонт»",
  });
  expect(edited.saved).toBe(false);
  expect(edited.dirty).toBe(true);
  expect(edited.id).toBe("draft-1");
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PAGE_CACHE_PREFIX,
  PwaPageCache,
  SESSION_EXPIRES_HEADER,
  SESSION_HEADER,
  SESSION_STATE_CACHE,
} from "@/ui/shell/pwa-cache";
import { memoryStorage } from "./pwa-storage";

const origin = "https://pulse.example";
const a = "a".repeat(64);
const b = "b".repeat(64);
const stateURL = `${origin}/__pwa_session_state`;
function request(path = "/today") {
  return new Request(`${origin}${path}`, { headers: { Accept: "text/html" } });
}
function response(session: string, expiresAt = Date.now() + 60_000) {
  return new Response(`<html><body>${session}</body></html>`, {
    headers: {
      "Content-Type": "text/html",
      "X-Pulse-Cacheable": "1",
      [SESSION_HEADER]: session,
      [SESSION_EXPIRES_HEADER]: new Date(expiresAt).toISOString(),
    },
  });
}
function permutations(values: number[]): number[][] {
  if (!values.length) return [[]];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, other) => other !== index)).map((rest) => [
      value,
      ...rest,
    ]),
  );
}
const pairs = permutations([0, 1]);
const triples = permutations([0, 1, 2]);
afterEach(() => vi.useRealTimers());

describe("порядок начала GET и изоляция сессий PWA", () => {
  for (const sessions of [
    [a, b],
    [a, a, b],
    [a, b, b],
  ]) {
    it.each(
      permutations(sessions.map((_, index) => index)).map((order) => [order]),
    )(
      `${sessions.map((session) => session[0]).join("→")}: ответы %j оставляют только B`,
      async (order) => {
        // Equal clock ticks must still have a strict order within one worker.
        vi.spyOn(performance, "now").mockReturnValue(100);
        const { storage } = memoryStorage();
        const pages = new PwaPageCache(storage, origin);
        await pages.invalidate();
        const started = sessions.map(() => pages.startRequest());
        let sawB = false;
        for (const index of order) {
          const session = sessions[index];
          const token = started[index];
          if (!session || !token) throw new Error("Недопустимая перестановка");
          await pages.save(request(), response(session), token);
          sawB ||= session === b;
          if (sawB)
            expect(
              (await pages.read("/today"))?.headers.get(SESSION_HEADER),
            ).toBe(b);
        }
        expect(await storage.keys()).toEqual([
          SESSION_STATE_CACHE,
          `${PAGE_CACHE_PREFIX}${b}`,
        ]);
      },
    );
  }

  for (const sessions of [
    [a, "none"],
    [a, a, "none"],
  ]) {
    it.each(
      permutations(sessions.map((_, index) => index)).map((order) => [order]),
    )(
      `${sessions.map((session) => session[0]).join("→")}: ответы %j не воскрешают неизвестную A после none`,
      async (order) => {
        const { storage } = memoryStorage();
        const pages = new PwaPageCache(storage, origin);
        const started = sessions.map(() => pages.startRequest());
        let revoked = false;
        for (const index of order) {
          const session = sessions[index];
          const token = started[index];
          if (!session || !token) throw new Error("Недопустимая перестановка");
          if (session === "none") await pages.observe(response(session), token);
          else await pages.save(request(), response(session), token);
          revoked ||= session === "none";
          if (revoked) expect(await pages.read("/today")).toBeUndefined();
        }
        expect(await storage.keys()).toEqual([SESSION_STATE_CACHE]);
      },
    );
  }

  it.each(triples.map((order) => [order]))(
    "три разные сессии, ответы %j: активный владелец не возвращается назад",
    async (order) => {
      const sessions = [a, b, "c".repeat(64)];
      const { storage } = memoryStorage();
      const pages = new PwaPageCache(storage, origin);
      const started = sessions.map(() => pages.startRequest());
      let newest = -1;
      for (const index of order) {
        const session = sessions[index];
        const token = started[index];
        if (!session || !token) throw new Error("Недопустимая перестановка");
        await pages.save(request(), response(session), token);
        const savedSession = (await pages.read("/today"))?.headers.get(
          SESSION_HEADER,
        );
        const current = sessions.indexOf(savedSession ?? "");
        expect(current).toBeGreaterThanOrEqual(newest);
        newest = current;
      }
      // A -> B changes generation; the already pending C stays fenced as before.
      expect(newest).toBe(order.join() === "0,1,2" ? 1 : 2);
    },
  );

  it.each(triples.map((order) => [order]))(
    "первая сессия: HTML today, HTML schedule и API в порядке %j сохраняют оба экрана",
    async (order) => {
      const { storage } = memoryStorage();
      const pages = new PwaPageCache(storage, origin);
      const started = [
        pages.startRequest(),
        pages.startRequest(),
        pages.startRequest(),
      ];
      for (const index of order) {
        const token = started[index];
        if (!token) throw new Error("Недопустимая перестановка");
        if (index === 2) await pages.observe(response(a), token);
        else
          await pages.save(
            request(index === 0 ? "/today" : "/schedule"),
            response(a),
            token,
          );
      }
      expect(pages.generation).toBe(0);
      for (const path of ["/today", "/schedule"])
        expect((await pages.read(path))?.headers.get(SESSION_HEADER)).toBe(a);
    },
  );

  for (const barrier of ["POST", "выход"] as const) {
    it.each(triples.map((order) => [order]))(
      `${barrier}: два GET до барьера и B после него, ответы %j`,
      async (order) => {
        const { storage } = memoryStorage();
        const pages = new PwaPageCache(storage, origin);
        const started = [pages.startRequest(), pages.startRequest()];
        const generation = pages.generation;
        const clearing =
          barrier === "POST" ? pages.invalidate() : pages.clear();
        expect(pages.generation).toBe(generation + 1);
        started.push(pages.startRequest());
        await clearing;
        for (const index of order) {
          const token = started[index];
          if (!token) throw new Error("Недопустимая перестановка");
          await pages.save(request(), response(index === 2 ? b : a), token);
          expect(
            (await pages.read("/today"))?.headers.get(SESSION_HEADER),
          ).not.toBe(a);
        }
        expect((await pages.read("/today"))?.headers.get(SESSION_HEADER)).toBe(
          b,
        );
      },
    );
  }

  for (const reason of ["выход", "истечение", "отзыв", "смена"] as const) {
    it.each(triples.map((order) => [order]))(
      `${reason}: retired A не возвращается при новом поколении после рестарта, ответы %j`,
      async (order) => {
        vi.useFakeTimers({ toFake: ["Date"] });
        const { storage } = memoryStorage();
        const first = new PwaPageCache(storage, origin);
        await first.save(
          request(),
          response(a, Date.now() + 1000),
          first.startRequest(),
        );
        if (reason === "выход") await first.clear();
        if (reason === "истечение") {
          vi.setSystemTime(Date.now() + 1000);
          expect(await first.read("/today")).toBeUndefined();
        }
        if (reason === "отзыв")
          await first.observe(response("none"), first.startRequest());
        if (reason === "смена")
          await first.save(request(), response(b), first.startRequest());
        const pages = new PwaPageCache(storage, origin);
        const started = [
          pages.startRequest(),
          pages.startRequest(),
          pages.startRequest(),
        ];
        for (const index of order) {
          const token = started[index];
          if (!token) throw new Error("Недопустимая перестановка");
          await pages.save(request(), response(index === 1 ? b : a), token);
          expect(
            (await pages.read("/today"))?.headers.get(SESSION_HEADER),
          ).not.toBe(a);
          expect(await storage.keys()).not.toContain(
            `${PAGE_CACHE_PREFIX}${a}`,
          );
        }
        expect((await pages.read("/today"))?.headers.get(SESSION_HEADER)).toBe(
          b,
        );
      },
    );
  }

  it.each(pairs.map((order) => [order]))(
    "перекрывающиеся worker: порядок %j не позволяет неизвестной A сменить B",
    async (order) => {
      let tick = 100;
      vi.spyOn(performance, "now").mockImplementation(() => tick++);
      const { storage } = memoryStorage();
      const older = new PwaPageCache(storage, origin);
      const aRequest = older.startRequest();
      const newer = new PwaPageCache(storage, origin);
      const bRequest = newer.startRequest();
      const pendingB = newer.startRequest();
      const responses = [
        () => older.save(request(), response(a), aRequest),
        () => newer.save(request(), response(b), bRequest),
      ];
      let sawB = false;
      for (const index of order) {
        await responses[index]?.();
        sawB ||= index === 1;
        if (sawB)
          expect(
            (await newer.read("/today"))?.headers.get(SESSION_HEADER),
          ).not.toBe(a);
      }
      if (order[0] === 1) {
        expect(await newer.read("/today")).toBeUndefined();
        await newer.save(request(), response(b), pendingB);
        expect(await newer.read("/today")).toBeUndefined();
      }
      const restarted = new PwaPageCache(storage, origin);
      await restarted.save(request(), response(b), restarted.startRequest());
      expect(
        (await restarted.read("/today"))?.headers.get(SESSION_HEADER),
      ).toBe(b);
    },
  );

  it.each(["POST", "выход"])(
    "%s в другом экземпляре отсекает уже начатый GET той же сессии",
    async (barrier) => {
      const { storage } = memoryStorage();
      const pages = new PwaPageCache(storage, origin);
      await pages.save(request(), response(a), pages.startRequest());
      const late = pages.startRequest();
      const other = new PwaPageCache(storage, origin);
      if (barrier === "POST") await other.invalidate();
      else await other.clear();
      await pages.save(request(), response(a), late);
      expect(await pages.read("/today")).toBeUndefined();
      if (barrier === "POST") {
        await pages.save(request(), response(a), pages.startRequest());
        expect(await pages.read("/today")).toBeDefined();
      }
    },
  );

  it("совпавшие часы разных worker дают устойчивый запрет старых HTML, затем свежий GET восстанавливает B", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(100);
    const { storage } = memoryStorage();
    const first = new PwaPageCache(storage, origin);
    const second = new PwaPageCache(storage, origin);
    const lateA = first.startRequest();
    const freshB = second.startRequest();
    const lateB = second.startRequest();
    await second.save(request(), response(b), freshB);
    await first.save(request(), response(a), lateA);
    await second.save(request(), response(b), lateB);
    expect(
      await new PwaPageCache(storage, origin).read("/today"),
    ).toBeUndefined();
    clock.mockReturnValue(101);
    await second.save(request(), response(b), second.startRequest());
    expect((await second.read("/today"))?.headers.get(SESSION_HEADER)).toBe(b);
  });

  it("истечение не понижает сохранённый порядок при сбросе часов другого worker", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
    const { storage } = memoryStorage();
    const first = new PwaPageCache(storage, origin);
    await first.save(
      request(),
      response(b, Date.now() + 1000),
      first.startRequest(),
    );
    clock.mockReturnValue(100);
    vi.setSystemTime(Date.now() + 1000);
    const restarted = new PwaPageCache(storage, origin);
    expect(await restarted.read("/today")).toBeUndefined();
    clock.mockReturnValue(500);
    await restarted.save(request(), response(a), restarted.startRequest());
    expect(await restarted.read("/today")).toBeUndefined();
  });

  it("сброс часов после POST не оставляет HTML A при живом ответе B нового worker", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
    const { storage } = memoryStorage();
    const first = new PwaPageCache(storage, origin);
    await first.save(request(), response(a), first.startRequest());
    clock.mockReturnValue(1001);
    await first.invalidate();
    clock.mockReturnValue(1002);
    await first.save(request(), response(a), first.startRequest());
    expect(await first.read("/today")).toBeDefined();
    clock.mockReturnValue(100);
    const restarted = new PwaPageCache(storage, origin);
    await restarted.save(request(), response(b), restarted.startRequest());
    expect(await restarted.read("/today")).toBeUndefined();
  });

  it("state старой сборки без порядка читается и обновляется без потери retired", async () => {
    const { storage } = memoryStorage();
    const cache = await storage.open(SESSION_STATE_CACHE);
    await cache.put(
      stateURL,
      Response.json({
        session: b,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        retired: [a],
      }),
    );
    const pages = new PwaPageCache(storage, origin);
    await pages.save(request(), response(a), pages.startRequest());
    expect(await pages.read("/today")).toBeUndefined();
    const started = pages.startRequest();
    await pages.save(request(), response(b), started);
    expect(await (await cache.match(stateURL))?.json()).toMatchObject({
      session: b,
      retired: [a],
      order: started.order,
    });
  });

  it("прерванное удаление после POST не открывает старый экран при следующем обновлении другого экрана", async () => {
    const { storage } = memoryStorage();
    const pages = new PwaPageCache(storage, origin);
    await pages.save(request(), response(a), pages.startRequest());
    await pages.save(request("/schedule"), response(a), pages.startRequest());
    const pending = pages.startRequest();
    const failure = vi
      .spyOn(storage, "delete")
      .mockRejectedValue(new Error("storage unavailable"));
    await expect(
      new PwaPageCache(storage, origin).invalidate(),
    ).rejects.toThrow("storage unavailable");
    expect(await pages.read("/schedule")).toBeUndefined();
    await pages.save(request("/schedule"), response(a), pending);
    expect(await pages.read("/schedule")).toBeUndefined();
    failure.mockRestore();
    await pages.save(request(), response(a), pages.startRequest());
    expect(await pages.read("/today")).toBeDefined();
    expect(await pages.read("/schedule")).toBeUndefined();
  });
});

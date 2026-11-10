import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it.each(["src/ui/shell/providers.tsx", "src/ui/assistant/use-assistant.ts"])(
  "клиентский вход %s разбирает AI SDK поток без попыток eval",
  (entry) => {
    // A fresh process keeps Zod's lazy allowsEval probe uncached.
    const script = `
      import assert from "node:assert/strict";
      let attempts = 0;
      globalThis.Function = new Proxy(Function, {
        construct() { attempts++; throw new EvalError("CSP_EVAL_BLOCKED"); },
        apply() { attempts++; throw new EvalError("CSP_EVAL_BLOCKED"); },
      });
      await import(${JSON.stringify(`../../${entry}`)});
      const { z } = await import("zod");
      const v4 = await import("zod/v4");
      assert.equal(z.config(), v4.config());
      assert.equal(z.config().jitless, true);
      assert.equal(z.strictObject({ value: z.string() }).safeParse({ value: 1 }).success, false);
      const { createUIMessageStream, createUIMessageStreamResponse, DefaultChatTransport } = await import("ai");
      const transport = new DefaultChatTransport({ fetch: async () => createUIMessageStreamResponse({
        stream: createUIMessageStream({ execute({ writer }) {
          writer.write({ type: "start", messageId: "answer" });
          writer.write({ type: "text-start", id: "text" });
          writer.write({ type: "text-delta", id: "text", delta: "Черновик готов" });
          writer.write({ type: "text-end", id: "text" });
          writer.write({ type: "data-assistant", data: { type: "draft", draft: { id: "draft-1" } } });
          writer.write({ type: "finish" });
        } }),
      }) });
      const chunks = await transport.sendMessages({ trigger: "submit-message", chatId: "test", messages: [{ id: "question", role: "user", parts: [{ type: "text", text: "Справка" }] }] });
      const received = [];
      for await (const chunk of chunks) received.push(chunk);
      assert.ok(received.some(chunk => chunk.type === "text-delta" && chunk.delta === "Черновик готов"));
      assert.ok(received.some(chunk => chunk.type === "data-assistant" && chunk.data.draft.id === "draft-1"));
      assert.equal(attempts, 0);
    `;
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        cwd: new URL(".", import.meta.url),
        encoding: "utf8",
        timeout: 20_000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
  },
);

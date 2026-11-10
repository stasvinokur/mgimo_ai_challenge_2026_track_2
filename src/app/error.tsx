"use client";

import { PageError } from "@/ui/shell/page-error";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="standalone-state">
      <PageError reset={reset} />
    </main>
  );
}

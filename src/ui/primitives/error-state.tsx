"use client";

import { RotateCcw, Unplug } from "lucide-react";
import { Button } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/primitives/empty-state";

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert">
      <EmptyState
        icon={Unplug}
        title="Не удалось загрузить страницу"
        description="Иногда соединению нужна ещё одна попытка. Попробуйте загрузить страницу снова."
        action={
          <Button onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
            Повторить
          </Button>
        }
      />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

export function useTodayNow(initialNow: string) {
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    const update = () => setNow(new Date().toISOString());
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

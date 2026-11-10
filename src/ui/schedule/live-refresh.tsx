"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [router]);
  return null;
}

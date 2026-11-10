"use client";

import { useEffect, useState } from "react";
import type { ToasterProps } from "sonner";
import { Toaster } from "@/ui/primitives/sonner";
import { type ResolvedTheme, watchTheme } from "@/ui/shell/theme";

export function ThemeToaster(props: ToasterProps) {
  const [theme, setTheme] = useState<ResolvedTheme>("light");
  useEffect(() => watchTheme(setTheme), []);
  return <Toaster {...props} theme={theme} />;
}

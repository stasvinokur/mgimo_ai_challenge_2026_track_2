"use client";

import { z } from "zod";

// Strict CSP reports even Zod's caught eval probe as a violation.
z.config({ jitless: true });

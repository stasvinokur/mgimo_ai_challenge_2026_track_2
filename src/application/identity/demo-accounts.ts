export interface DemoAccount {
  login: string;
  displayName: string;
  role: "student" | "staff" | "teacher";
  password: string;
}

// Public contest demo data, not secrets.
export const demoAccounts = [
  {
    login: "anna",
    displayName: "Анна",
    role: "student",
    password: "anna-demo-2026",
  },
  {
    login: "timur",
    displayName: "Тимур",
    role: "student",
    password: "timur-demo-2026",
  },
  {
    login: "marina",
    displayName: "Марина",
    role: "staff",
    password: "marina-demo-2026",
  },
  {
    login: "oleg",
    displayName: "Олег",
    role: "teacher",
    password: "oleg-demo-2026",
  },
] as const satisfies readonly DemoAccount[];

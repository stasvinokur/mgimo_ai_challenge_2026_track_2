import { expect, it } from "vitest";
import { shouldReloadPwaSnapshot } from "@/ui/shell/pwa-online";

it.each`
  hasSnapshot | online   | visible  | leaving  | expected
  ${false}    | ${false} | ${false} | ${false} | ${false}
  ${false}    | ${false} | ${false} | ${true}  | ${false}
  ${false}    | ${false} | ${true}  | ${false} | ${false}
  ${false}    | ${false} | ${true}  | ${true}  | ${false}
  ${false}    | ${true}  | ${false} | ${false} | ${false}
  ${false}    | ${true}  | ${false} | ${true}  | ${false}
  ${false}    | ${true}  | ${true}  | ${false} | ${false}
  ${false}    | ${true}  | ${true}  | ${true}  | ${false}
  ${true}     | ${false} | ${false} | ${false} | ${false}
  ${true}     | ${false} | ${false} | ${true}  | ${false}
  ${true}     | ${false} | ${true}  | ${false} | ${false}
  ${true}     | ${false} | ${true}  | ${true}  | ${false}
  ${true}     | ${true}  | ${false} | ${false} | ${false}
  ${true}     | ${true}  | ${false} | ${true}  | ${false}
  ${true}     | ${true}  | ${true}  | ${false} | ${true}
  ${true}     | ${true}  | ${true}  | ${true}  | ${false}
`(
  "перезагрузка: копия=$hasSnapshot, сеть=$online, видимость=$visible, уход=$leaving → $expected",
  ({ expected, ...state }) => {
    expect(shouldReloadPwaSnapshot(state)).toBe(expected);
  },
);

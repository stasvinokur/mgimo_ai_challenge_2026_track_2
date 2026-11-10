export function shouldReloadPwaSnapshot({
  hasSnapshot,
  online,
  visible,
  leaving,
}: {
  hasSnapshot: boolean;
  online: boolean;
  visible: boolean;
  leaving: boolean;
}): boolean {
  return hasSnapshot && online && visible && !leaving;
}

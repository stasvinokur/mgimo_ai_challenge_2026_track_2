"use client";

import { useEffect } from "react";

const cancelEvents = [
  "wheel",
  "touchstart",
  "pointerdown",
  "keydown",
  "hashchange",
  "popstate",
] as const;

export function settleProfileAnchor(target: HTMLElement): () => void {
  const hash = `#${target.id}`;
  if (window.location.hash !== hash) return () => {};

  const container = target.closest(".section-page") ?? target;
  const pending = '[data-profile-anchor-ready="false"]';
  const waiting = () =>
    container.matches(pending) || container.querySelector(pending) !== null;
  let active = true;
  let frame: number | undefined;
  const observer = new MutationObserver(schedule);

  function cancel() {
    active = false;
    observer.disconnect();
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    frame = undefined;
    for (const event of cancelEvents) window.removeEventListener(event, cancel);
  }

  function schedule() {
    if (!active) return;
    if (window.location.hash !== hash || !target.isConnected) {
      cancel();
      return;
    }
    if (waiting() || frame !== undefined) return;
    frame = window.requestAnimationFrame(() => {
      frame = undefined;
      if (!active) return;
      if (window.location.hash !== hash || !target.isConnected) {
        cancel();
        return;
      }
      if (waiting()) return;
      // Next can consume the hash while the route still renders its skeleton.
      target.scrollIntoView({
        block: "start",
        inline: "nearest",
        behavior: "instant",
      });
      cancel();
    });
  }

  observer.observe(container, {
    attributes: true,
    attributeFilter: ["data-profile-anchor-ready"],
    subtree: true,
  });
  for (const event of cancelEvents)
    window.addEventListener(event, cancel, { passive: true });
  schedule();
  return cancel;
}

export function useProfileAnchor(id: string) {
  useEffect(() => {
    const target = document.getElementById(id);
    if (target) return settleProfileAnchor(target);
  }, [id]);
}

import { describe, expect, it, vi } from "vitest";
import policy from "../desktop/src/shared/desktop-notification-policy.cjs";

const {
  normalizeDesktopNotificationOptions,
  shouldSuppressDesktopNotification,
} = policy;

describe("desktop notification focus policy", () => {
  it('preserves a scoped task destination but rejects incomplete or malformed targets',()=>{
    const target={connectionKey:'local-1',activityId:'run-1',agentId:'agent-1'};
    expect(normalizeDesktopNotificationOptions({target})).toEqual({desktopFocusPolicy:'always',target});
    for(const target of [{sessionPath:'/chat.jsonl'},{connectionKey:'local-1',activityId:'run-1'},{connectionKey:'local-1',sessionPath:'bad\u0000path'}]){
      expect(normalizeDesktopNotificationOptions({target})).toEqual({desktopFocusPolicy:'always'});
    }
  });
  it("keeps legacy notifications on the always policy", () => {
    expect(normalizeDesktopNotificationOptions(null)).toEqual({
      desktopFocusPolicy: "always",
    });
    expect(normalizeDesktopNotificationOptions({ desktopFocusPolicy: "bad" })).toEqual({
      desktopFocusPolicy: "always",
    });
  });

  it("suppresses when_unfocused notifications while a Hana window is focused", () => {
    const getFocusedWindow = vi.fn(() => ({ isDestroyed: () => false }));

    expect(shouldSuppressDesktopNotification(
      { desktopFocusPolicy: "when_unfocused" },
      { getFocusedWindow },
    )).toBe(true);
  });

  it("allows when_unfocused notifications when no Hana window is focused", () => {
    expect(shouldSuppressDesktopNotification(
      { desktopFocusPolicy: "when_unfocused" },
      { getFocusedWindow: () => null },
    )).toBe(false);
  });
});

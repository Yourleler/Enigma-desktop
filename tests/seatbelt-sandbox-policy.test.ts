import { describe, expect, it } from "vitest";
import { __testing } from "../lib/sandbox/seatbelt.ts";

describe("macOS seatbelt sandbox policy projection", () => {
  const policy = {
    mode: "standard",
    writablePaths: [],
    readablePaths: [],
    protectedPaths: [],
    denyReadPaths: [],
  };

  it("allows outbound network by default", () => {
    const profile = __testing.generateProfile(policy);

    expect(profile).toContain("(allow network-outbound)");
    expect(profile).not.toContain("(deny network*)");
    expect(profile).not.toContain('network-bind');expect(profile).not.toContain('network-inbound');
  });

  it("denies network only when sandbox network is explicitly disabled", () => {
    const profile = __testing.generateProfile(policy, { allowNetwork: false });

    expect(profile).toContain("(deny network*)");
    expect(profile).not.toContain("(allow network-outbound)");
  });
  it('requires explicit server opt-in and keeps explicit network denial',()=>{
    const enabled=__testing.generateProfile(policy,{allowLocalServers:true});expect(enabled).toContain('(allow network-bind (local ip))');
    const off=__testing.generateProfile(policy,{allowNetwork:false,allowLocalServers:true});expect(off).toContain('(deny network*)');expect(off).not.toContain('network-bind');
  });
});

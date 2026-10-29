/**
 * Tests for YuanSelector — the yuan picker in AgentTab.
 *
 * `t` is mocked, but it is fed the *real* zh locale so the copy assertions
 * cover the whole path from locale file to rendered text rather than echoing
 * a fixture back at themselves. Full mock (no importActual) because
 * settings/helpers.ts pulls in the store and window.platform at module-eval
 * time, which would throw during vi.mock hoisting even under jsdom.
 *
 * @vitest-environment jsdom
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

const zh = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "desktop/src/locales/zh.json"), "utf8"),
);

vi.mock("../../../helpers", () => ({
  t: (key: string) => (key.split('.').reduce((value, part) => value?.[part], zh) || key),
}));

import { YuanSelector } from "../YuanSelector";

function renderSelector(currentYuan = "hanako") {
  const onChange = vi.fn();
  const { container } = render(<YuanSelector currentYuan={currentYuan} onChange={onChange} />);
  return { container, onChange };
}

function chipFor(container: HTMLElement, yuan: string): HTMLElement {
  const chips = Array.from(container.querySelectorAll<HTMLElement>(".yuan-chip"));
  const chip = chips.find((el) => el.querySelector(".yuan-chip-name")?.textContent === yuan);
  if (!chip) throw new Error(`no chip rendered for yuan "${yuan}"`);
  return chip;
}

describe("YuanSelector", () => {
  it("keeps Enigma selectable and uses its canonical avatar with legacy locales",()=>{const {container}=renderSelector("enigma");const chip=chipFor(container,"enigma");expect(chip.classList.contains("selected")).toBe(true);expect(chip.querySelector("img")?.getAttribute("src")).toBe("assets/enigma/avatar.png");});
  it.each(['hanako', 'butter', 'ming'])('explains %s without internal thinking-block codes', yuan => {
    const { container } = renderSelector();
    const chip = chipFor(container, yuan);
    expect(chip.querySelector('.yuan-chip-desc')?.textContent).toBeTruthy();
    expect(chip.querySelector('.yuan-chip-tag')).toBeNull();
  });

  it("renders kong as 无 with the neutral description and no tag", () => {
    const { container } = renderSelector();
    const banner = container.querySelector(".yuan-kong-banner");

    expect(banner).not.toBeNull();
    expect(banner?.querySelector(".yuan-kong-name")?.textContent).toBe("简洁模式");
    expect(banner?.querySelector(".yuan-kong-desc")?.textContent).toBe(
      "直接处理任务，不额外生成情绪或思绪片段。",
    );
    // 描述行已经把这件事说全了，banner 上再挂一个 tag 只是重复
    expect(banner?.querySelector(".yuan-chip-tag")).toBeNull();
  });

  it("keeps kong out of the chip row", () => {
    const { container } = renderSelector();
    const names = Array.from(container.querySelectorAll(".yuan-chip-name")).map(
      (el) => el.textContent,
    );
    expect(names).not.toContain("kong");
    expect(names).toEqual(["enigma", "hanako", "butter", "ming"]);
  });
});

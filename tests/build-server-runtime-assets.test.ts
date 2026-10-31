import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  copyServerRuntimeAssets,
  SERVER_RUNTIME_ASSET_DIRS,
  SERVER_RUNTIME_ASSET_FILES,
} from "../scripts/build-server-runtime-assets.mjs";

describe("server runtime assets", () => {
  let tempDir;
  let rootDir;
  let outDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-server-assets-"));
    rootDir = path.join(tempDir, "root");
    outDir = path.join(tempDir, "dist-server", "mac-arm64");
    const assetsDir = path.join(rootDir, "desktop", "src", "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    for (const fileName of SERVER_RUNTIME_ASSET_FILES) {
      fs.mkdirSync(path.dirname(path.join(assetsDir,fileName)),{recursive:true});
      fs.writeFileSync(path.join(assetsDir, fileName), `${fileName}\n`);
    }
    for (const dirName of SERVER_RUNTIME_ASSET_DIRS) {
      const dir = path.join(assetsDir, dirName);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${dirName}-fixture.txt`), `${dirName}\n`);
    }
    fs.writeFileSync(path.join(assetsDir, "character-cards", "yuan-hanako-card-back.png"), "card-back\n");
    fs.writeFileSync(path.join(assetsDir, "character-cards", "yuan-hanako-emblem.png"), "emblem\n");

    const rendererDir = path.join(rootDir, "desktop", "dist-renderer");
    fs.mkdirSync(path.join(rendererDir, "assets"), { recursive: true });
    fs.mkdirSync(path.join(rendererDir, "lib"), { recursive: true });
    fs.mkdirSync(path.join(rendererDir, "themes"), { recursive: true });
    fs.mkdirSync(path.join(rendererDir, "locales"), { recursive: true });
    fs.writeFileSync(
      path.join(rendererDir, "mobile.html"),
      "<!doctype html><link rel=\"stylesheet\" href=\"./assets/mobile.css\"><script type=\"module\" src=\"./assets/mobile.js\"></script><title>Mobile</title>",
      "utf-8",
    );
    fs.writeFileSync(path.join(rendererDir, "manifest.webmanifest"), "{}", "utf-8");
    fs.writeFileSync(path.join(rendererDir, "sw.js"), "self.addEventListener('fetch', () => {});", "utf-8");
    fs.writeFileSync(path.join(rendererDir, "icon.png"), "png", "utf-8");
    fs.writeFileSync(path.join(rendererDir, "assets", "mobile.js"), "import './shared.js'; console.log('mobile')", "utf-8");
    fs.writeFileSync(path.join(rendererDir, "assets", "shared.js"), "console.log('shared')", "utf-8");
    fs.writeFileSync(path.join(rendererDir, "assets", "mobile.css"), ".mobile { background: url('./paper.png'); }", "utf-8");
    fs.writeFileSync(path.join(rendererDir, "assets", "paper.png"), "paper", "utf-8");
    fs.writeFileSync(path.join(rendererDir, "assets", "mobile.js.map"), '{"sourcesContent":["sourcemap fixture"]}', "utf-8");
    fs.writeFileSync(path.join(rendererDir, "assets", "main-desktop.js"), "console.log('desktop')", "utf-8");
    fs.writeFileSync(path.join(rendererDir, "assets", "main-desktop.css"), ".desktop {}", "utf-8");
    fs.writeFileSync(path.join(rendererDir, "lib", "theme.js"), "window.HanaTheme = {}", "utf-8");
    fs.writeFileSync(path.join(rendererDir, "lib", "theme.js.map"), '{"sourcesContent":["theme source"]}', "utf-8");
    fs.writeFileSync(path.join(rendererDir, "themes", "warm-paper.css"), ":root{}", "utf-8");
    fs.writeFileSync(path.join(rendererDir, "locales", "zh.json"), "{}", "utf-8");
    fs.writeFileSync(path.join(rendererDir, "index.html"), "<!doctype html><title>Desktop</title>", "utf-8");
    fs.mkdirSync(path.join(rendererDir, "modules"), { recursive: true });
    fs.writeFileSync(path.join(rendererDir, "modules", "legacy.js"), "console.log('legacy')", "utf-8");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("copies character-card fallback assets into the bundled server root", () => {
    const copied = copyServerRuntimeAssets({ rootDir, outDir });

    for (const fileName of SERVER_RUNTIME_ASSET_FILES) {
      expect(fs.readFileSync(path.join(outDir, "desktop", "src", "assets", fileName), "utf-8"))
        .toBe(`${fileName}\n`);
    }
    expect(fs.readFileSync(
      path.join(outDir, "desktop", "src", "assets", "character-cards", "yuan-hanako-card-back.png"),
      "utf-8",
    )).toBe("card-back\n");
    expect(fs.readFileSync(
      path.join(outDir, "desktop", "src", "assets", "character-cards", "yuan-hanako-emblem.png"),
      "utf-8",
    )).toBe("emblem\n");
    expect(fs.readFileSync(
      path.join(outDir, "desktop", "src", "assets", "cover-gallery", "cover-gallery-fixture.txt"),
      "utf-8",
    )).toBe("cover-gallery\n");
    expect(copied).toEqual(expect.arrayContaining([
      path.join("desktop", "src", "assets", "Hanako.png"),
      path.join("desktop", "src", "assets", "character-cards") + path.sep,
      path.join("desktop", "src", "assets", "cover-gallery") + path.sep,
    ]));
  });

  it("fails the build when a required fallback asset is missing", () => {
    fs.unlinkSync(path.join(rootDir, "desktop", "src", "assets", "Butter.png"));

    expect(() => copyServerRuntimeAssets({ rootDir, outDir }))
      .toThrow(/required runtime asset missing: .*Butter\.png/);
  });

  it("copies the mobile renderer bundle into the bundled server root", () => {
    const copied = copyServerRuntimeAssets({ rootDir, outDir });

    expect(fs.readFileSync(path.join(outDir, "desktop", "dist-renderer", "mobile.html"), "utf-8"))
      .toContain("<title>Mobile</title>");
    expect(fs.readFileSync(path.join(outDir, "desktop", "dist-renderer", "assets", "mobile.js"), "utf-8"))
      .toContain("console.log('mobile')");
    expect(fs.readFileSync(path.join(outDir, "desktop", "dist-renderer", "assets", "shared.js"), "utf-8"))
      .toContain("console.log('shared')");
    expect(fs.readFileSync(path.join(outDir, "desktop", "dist-renderer", "assets", "mobile.css"), "utf-8"))
      .toContain("background");
    expect(fs.readFileSync(path.join(outDir, "desktop", "dist-renderer", "assets", "paper.png"), "utf-8"))
      .toBe("paper");
    expect(copied).toContain(path.join("desktop", "dist-renderer") + path.sep);
  });

  it("excludes source maps and desktop-only renderer files from the server runtime", () => {
    copyServerRuntimeAssets({ rootDir, outDir });

    expect(fs.existsSync(path.join(outDir, "desktop", "dist-renderer", "assets", "mobile.js.map"))).toBe(false);
    expect(fs.existsSync(path.join(outDir, "desktop", "dist-renderer", "assets", "main-desktop.js"))).toBe(false);
    expect(fs.existsSync(path.join(outDir, "desktop", "dist-renderer", "assets", "main-desktop.css"))).toBe(false);
    expect(fs.existsSync(path.join(outDir, "desktop", "dist-renderer", "index.html"))).toBe(false);
    expect(fs.existsSync(path.join(outDir, "desktop", "dist-renderer", "modules", "legacy.js"))).toBe(false);
  });
  it("includes nested preview HTML dependencies and their module/style imports",()=>{
    const assets=path.join(rootDir,'desktop/dist-renderer/assets');
    const write=(name,content)=>{fs.mkdirSync(path.dirname(path.join(assets,name)),{recursive:true});fs.writeFileSync(path.join(assets,name),content);};
    write('sheet-viewer/index.html','<script type="module" src="../sheet-entry.js"></script><link rel="stylesheet" href="../sheet.css">');
    write('sheet-entry.js','import "./sheet-engine.js"; new Worker(new URL("import-worker-12345678.js", import.meta.url));');write('import-worker-12345678.js','import "./worker-parser.js";');write('worker-parser.js','export const parse=()=>true;');write('sheet-engine.js','export const ready=true;');
    write('sheet.css','@import "./palette.css"; .sheet{background:url("./paper.png")}');write('palette.css','.sheet{color:purple}');
    write('pdf-viewer/web/viewer.html','<script type="module" src="viewer.mjs"></script><link rel="stylesheet" href="viewer.css">');
    write('pdf-viewer/web/viewer.mjs','import "../build/pdf.mjs";');write('pdf-viewer/build/pdf.mjs','export const pdf=true;');write('pdf-viewer/web/viewer.css','body{color:black}');
    copyServerRuntimeAssets({rootDir,outDir});const target=path.join(outDir,'desktop/dist-renderer/assets');
    for(const name of ['sheet-viewer/index.html','sheet-entry.js','import-worker-12345678.js','worker-parser.js','sheet-engine.js','sheet.css','palette.css','pdf-viewer/web/viewer.html','pdf-viewer/web/viewer.mjs','pdf-viewer/build/pdf.mjs','pdf-viewer/web/viewer.css'])expect(fs.readFileSync(path.join(target,name),'utf8')).toBe(fs.readFileSync(path.join(assets,name),'utf8'));
    expect(fs.existsSync(path.join(target,'main-desktop.js'))).toBe(false);
  });

  it("fails packaging when an embedded preview explicitly references a missing module",()=>{
    const dir=path.join(rootDir,'desktop/dist-renderer/assets/viewer');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'index.html'),'<script type="module" src="./missing.js"></script>');
    expect(()=>copyServerRuntimeAssets({rootDir,outDir})).toThrow(/missing.*viewer.*missing\.js/);
  });

  it("rejects an incomplete renderer missing its separately built theme runtime",()=>{
    fs.unlinkSync(path.join(rootDir,'desktop/dist-renderer/lib/theme.js'));
    expect(()=>copyServerRuntimeAssets({rootDir,outDir})).toThrow(/theme\.js.*build:theme/);
  });

});

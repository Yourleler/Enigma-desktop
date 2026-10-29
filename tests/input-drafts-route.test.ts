import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInputDraftsRoute } from "../server/routes/input-drafts.ts";
import { InputDraftsStore } from "../core/input-drafts-store.ts";

describe("input drafts route", () => {
  let home: string;
  let store: InputDraftsStore;
  let engine: any;
  let app: Hono;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "hana-drafts-route-"));
    store = new InputDraftsStore({ hanakoHome: home });
    engine = {
      getInputDrafts: (surface: string) => store.getAll(surface),
      setHomeInputDraft: (surface: string, entry: any) => store.setHome(surface, entry),
      setSessionInputDraft: (surface: string, sessionId: string, entry: any) => store.setSession(surface, sessionId, entry),
      getSessionIdForPath: vi.fn((p: string) => (p === "/agents/a/sessions/known.jsonl" ? "sess-known" : null)),
    };
    app = new Hono();
    app.route("/api", createInputDraftsRoute(engine));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  const put = (body: any) => app.request("/api/input-drafts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  it("PUT home scope then GET returns it, isolated per surface", async () => {
    const res = await put({ surface: "electron", scope: "home", text: "hello", doc: { type: "doc" } });
    expect(res.status).toBe(200);

    const getRes = await app.request("/api/input-drafts?surface=electron");
    expect(getRes.status).toBe(200);
    const data = await getRes.json();
    expect(data.home.text).toBe("hello");
    expect(data.home.doc).toEqual({ type: "doc" });

    const pwaRes = await app.request("/api/input-drafts?surface=pwa");
    expect((await pwaRes.json()).home).toBeNull();
  });

  it("PUT with sessionId stores a session draft; empty text deletes it", async () => {
    await put({ surface: "electron", sessionId: "sess-1", text: "draft" });
    let data = await (await app.request("/api/input-drafts?surface=electron")).json();
    expect(data.sessions["sess-1"].text).toBe("draft");

    await put({ surface: "electron", sessionId: "sess-1", text: "" });
    data = await (await app.request("/api/input-drafts?surface=electron")).json();
    expect(data.sessions["sess-1"]).toBeUndefined();
  });

  it("resolves sessionPath to sessionId at the boundary and rejects unresolvable paths", async () => {
    const ok = await put({ surface: "electron", sessionPath: "/agents/a/sessions/known.jsonl", text: "via path" });
    expect(ok.status).toBe(200);
    const data = await (await app.request("/api/input-drafts?surface=electron")).json();
    expect(data.sessions["sess-known"].text).toBe("via path");

    const bad = await put({ surface: "electron", sessionPath: "/nope.jsonl", text: "x" });
    expect(bad.status).toBe(400);
  });

  it("rejects unknown surface and missing scope", async () => {
    expect((await put({ surface: "bridge", scope: "home", text: "x" })).status).toBe(400);
    expect((await app.request("/api/input-drafts?surface=bogus")).status).toBe(400);
    expect((await put({ surface: "electron", text: "x" })).status).toBe(400);
  });
});

it('uses conditional revisions to reject stale writes including a stale clear after reload',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'draft-cas-'));
 try{
  let store=new InputDraftsStore({hanakoHome:home});
  const engine={getInputDrafts:(s:string)=>store.getAll(s),setHomeInputDraft:(s:string,e:any)=>store.setHome(s,e)};
  const app=new Hono().route('/api',createInputDraftsRoute(engine));
  const put=(text:string,expectedRevision:number)=>app.request('/api/input-drafts',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({surface:'electron',scope:'home',text,expectedRevision})});
  const first=await (await put('first',0)).json();expect(first.revision).toBeGreaterThan(0);
  const changed=await (await put('new input',first.revision)).json();
  store=new InputDraftsStore({hanakoHome:home});
  const stale=await put('',first.revision);expect(stale.status).toBe(409);expect(await stale.json()).toMatchObject({entry:{text:'new input'},revision:changed.revision});
  const cleared=await (await put('',changed.revision)).json();expect(cleared.entry).toBeNull();
  expect((await put('stale resurrection',changed.revision)).status).toBe(409);
  expect((await app.request('/api/input-drafts?surface=electron')).status).toBe(200);
 }finally{fs.rmSync(home,{recursive:true,force:true})}
});

it('rejects invalid and oversized writes without clearing the original',async()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'draft-validation-'));try{
  const store=new InputDraftsStore({hanakoHome:home});store.setHome('pwa',{text:'keep'});
  const app=new Hono().route('/api',createInputDraftsRoute({getInputDrafts:(s:string)=>store.getAll(s),setHomeInputDraft:(s:string,e:any)=>store.setHome(s,e)}));
  for(const body of [{surface:'pwa',scope:'home'}, {surface:'pwa',scope:'home',text:'new',expectedRevision:-1},{surface:'pwa',scope:'home',text:'x'.repeat(600000)}]){
   const res=await app.request('/api/input-drafts',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});expect([400,413]).toContain(res.status);
  }
  expect(store.getAll('pwa').home.text).toBe('keep');
 }finally{fs.rmSync(home,{recursive:true,force:true})}
});

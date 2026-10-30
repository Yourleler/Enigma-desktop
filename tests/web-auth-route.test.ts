import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hana-web-auth-route-"));
}

function runtimeContext() {
  return {
    serverId: "server_local",
    serverNodeId: "node_local",
    userId: "user_local",
    studioId: "studio_local",
    connectionKind: "lan",
    credentialKind: "device_credential",
    platformAccountId: null,
    officialServiceKind: null,
    capabilities: ["chat", "resources", "files"],
  };
}

describe("web auth route", () => {
  let tmpDir = null;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  });

  it("exchanges a paired device credential for an HttpOnly browser session cookie", async () => {
    tmpDir = makeTmpDir();
    const { createDeviceCredential } = await import("../core/device-registry.ts");
    const { createServerAuthService } = await import("../core/server-auth.ts");
    const { createWebAuthRoute } = await import("../server/routes/web-auth.ts");
    const issued = createDeviceCredential(tmpDir, {
      serverNodeId: "node_local",
      userId: "user_local",
      studioIds: ["studio_local"],
      displayName: "Phone Browser",
      deviceKind: "mobile",
      trustState: "lan",
      scopes: ["chat", "resources.read", "files.read", "files.write"],
      now: "2026-05-16T00:00:00.000Z",
    });
    const authService = createServerAuthService({
      hanakoHome: tmpDir,
      loopbackToken: "local-secret",
      runtimeContext,
    });
    const app = new Hono();
    app.route("/api", createWebAuthRoute({
      hanakoHome: tmpDir,
      authService,
      getConnectionKind: () => "lan",
      secureCookies: false,
      now: () => "2026-05-16T00:00:01.000Z",
    }));

    const login = await app.request("/api/web-auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Mobile Safari" },
      body: JSON.stringify({ credential: issued.secret }),
    });

    expect(login.status).toBe(200);
    const setCookie = login.headers.get("set-cookie");
    expect(setCookie).toContain("hana_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).not.toContain(issued.secret);
    const body = await login.json();
    expect(body).toMatchObject({
      ok: true,
      principal: {
        kind: "device",
        credentialKind: "device_credential",
        scopes: ["chat", "resources.read", "files.read", "files.write"],
      },
    });

    const session = await app.request("/api/web-auth/session", {
      headers: { Cookie: setCookie.split(";")[0] },
    });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({
      authenticated: true,
      principal: { userId: "user_local", studioId: "studio_local" },
    });
  });

  it("does not accept the removed password login", async () => {
    tmpDir=makeTmpDir();
    const {createServerAuthService}=await import('../core/server-auth');
    const {createWebAuthRoute}=await import('../server/routes/web-auth');
    const app=new Hono();app.route('/api',createWebAuthRoute({hanakoHome:tmpDir,authService:createServerAuthService({hanakoHome:tmpDir,loopbackToken:'local-secret',runtimeContext}),getConnectionKind:()=> 'local'}));
    const response=await app.request('http://localhost/api/web-auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:'not-used'})});
    expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:'password_login_removed'});
  });

  it("opens the local browser without exposing a token and rejects remote, cross-origin and missing-proof requests",async()=>{
    tmpDir=makeTmpDir();
    const {createServerAuthService}=await import('../core/server-auth');
    const {createWebAuthRoute}=await import('../server/routes/web-auth');
    let connectionKind='local';
    const authService=createServerAuthService({hanakoHome:tmpDir,loopbackToken:'local-secret',runtimeContext});
    const app=new Hono();app.route('/api',createWebAuthRoute({hanakoHome:tmpDir,authService,getConnectionKind:()=>connectionKind}));
    const url='http://127.0.0.1:3000/api/web-auth/local-session';
    const headers={'Origin':'http://127.0.0.1:3000','Sec-Fetch-Site':'same-origin','X-Enigma-Local-Open':'1'};
    const env={incoming:{socket:{remoteAddress:'127.0.0.1'}}};
    const opened=await app.request(url,{method:'POST',headers},env);
    expect(opened.status).toBe(200);const cookie=opened.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');expect(cookie).toContain('SameSite=Strict');expect(await opened.text()).not.toContain('local-secret');
    const principal=authService.authenticateRequest({cookieHeader:cookie,connectionKind:'local'});expect(principal?.kind).toBe('local_user');
    expect(authService.authenticateRequest({cookieHeader:cookie,connectionKind:'lan'})).toBeNull();
    const hostile=[{...headers,Origin:'https://example.com'},{...headers,Origin:'null'},{...headers,'Sec-Fetch-Site':'cross-site'},{...headers,'X-Enigma-Local-Open':''},{...headers,Origin:'http://127.0.0.1:3001'}];
    for(const bad of hostile)expect((await app.request(url,{method:'POST',headers:bad},env)).status).toBe(403);
    expect((await app.request(url,{method:'POST',headers})).status).toBe(403);
    expect((await app.request(url,{method:'POST',headers},{incoming:{socket:{remoteAddress:'192.168.1.2'}}})).status).toBe(403);
    connectionKind='lan';expect((await app.request(url,{method:'POST',headers},env)).status).toBe(403);
  });
});

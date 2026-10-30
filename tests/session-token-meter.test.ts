import { describe, expect, it, beforeEach, vi } from 'vitest';
import { estimateStreamTokens, SessionTokenMeters } from '../server/session-token-meter';

describe('estimateStreamTokens', () => {
  it('weights CJK characters near one token and latin text near four chars per token', () => {
    expect(estimateStreamTokens('abcdefgh')).toBe(2);
    expect(estimateStreamTokens('你好世界')).toBe(4);
    expect(estimateStreamTokens('你好ab')).toBe(3);
    expect(estimateStreamTokens('')).toBe(0);
  });
});

describe('SessionTokenMeters', () => {
  let meters: SessionTokenMeters;
  beforeEach(() => { meters = new SessionTokenMeters(); });

  it('estimates streamed output and flips to the real usage once the provider reports it', () => {
    meters.startRun('sp');
    meters.beginRequest('sp', { inputEstimate: 1200, model: 'gateway/x' });
    meters.addDelta('sp', 'abcdefgh', 'writing', 1000);
    let snap = meters.sample('sp', true, 1000)!;
    expect(snap).toMatchObject({ state: 'running', phase: 'writing', requests: 1 });
    expect(snap.up).toMatchObject({ tokens: 1200, estimated: true });
    expect(snap.down.tokens).toBe(2);
    expect(snap.down.estimated).toBe(true);
    expect(snap.rate).toBeGreaterThan(0);

    meters.applyLiveUsage('sp', { input: 80, cacheRead: 1000, cacheWrite: 0, output: 0 }, 1200);
    snap = meters.sample('sp', true, 1200)!;
    expect(snap.up).toMatchObject({ tokens: 1080, estimated: false });
    expect(snap.cacheRead).toBe(1000);

    meters.applyLiveUsage('sp', { input: 80, cacheRead: 1000, output: 12 }, 1400);
    meters.endRequest('sp', { input: 80, cacheRead: 1000, output: 12 }, 1400);
    meters.finishRun('sp', 'done', 1400);
    snap = meters.sample('sp', true, 1400)!;
    expect(snap).toMatchObject({ state: 'done', down: { tokens: 12, estimated: false } });
  });

  it('keeps estimates for tool turns whose provider usage is absent', () => {
    meters.beginRequest('sp', { inputEstimate: 100, now: 0 });
    meters.addDelta('sp', '你好', 'writing', 10);
    meters.endRequest('sp', null, 20);
    const snap = meters.sample('sp', true, 20)!;
    expect(snap.up.estimated).toBe(true);
    expect(snap.down).toMatchObject({ tokens: 2, estimated: true });
  });

  it('accumulates requests inside one run and resets on the next run', () => {
    meters.beginRequest('sp', { inputEstimate: 100, now: 0 });
    meters.addDelta('sp', 'abcdefgh', 'writing', 0);
    meters.endRequest('sp', { input: 100, output: 2 }, 100);
    meters.beginRequest('sp', { inputEstimate: 130, now: 200 });
    meters.addDelta('sp', 'abcdefgh', 'writing', 200);
    let snap = meters.sample('sp', true, 200)!;
    expect(snap.requests).toBe(2);
    expect(snap.up.tokens).toBe(230);
    meters.finishRun('sp', 'done', 300);

    meters.startRun('sp', 500);
    snap = meters.snapshot('sp', 500)!;
    expect(snap).toMatchObject({ requests: 0, state: 'running' });
  });

  it('marks aborted runs and throttles sampling', () => {
    meters.beginRequest('sp', { inputEstimate: 10, now: 0 });
    expect(meters.sample('sp', false, 50)).toBeNull();
    expect(meters.sample('sp', false, 150)?.state).toBe('running');
    meters.finishRun('sp', 'aborted', 200);
    expect(meters.sample('sp', true, 200)?.state).toBe('aborted');
  });

  it('schedules an idle finish for host paths that do not emit session_status', () => {
    vi.useFakeTimers();
    try {
      meters.beginRequest('sp', { inputEstimate: 10 });
      meters.addDelta('sp', '你好', 'writing');
      meters.endRequest('sp', null);
      meters.scheduleIdleFinish('sp');
      vi.advanceTimersByTime(2600);
      expect(meters.sample('sp', true)?.state).toBe('done');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('meter runtime accuracy', () => {
  it('does not reset partial usage on duplicate or delayed running-state notifications',()=>{
    const meters=new SessionTokenMeters();meters.activateLifecycle('task',100);meters.beginRequest('task',{now:110,model:'test/old'});meters.addDelta('task','partial','writing',120);const before=meters.snapshot('task',130)!;
    meters.activateLifecycle('task',140);expect(meters.snapshot('task',150)).toMatchObject({runId:before.runId,startedAt:100,down:before.down,requests:before.requests});
  });
  it('reports the model that actually produced the message after a request-boundary switch',()=>{
    const meters=new SessionTokenMeters();meters.activateLifecycle('task',100);meters.beginRequest('task',{model:'test/planner',now:110});meters.addDelta('task','actual','writing',120,{model:'test/coder'});expect(meters.snapshot('task',130)?.model).toBe('test/coder');
    meters.endRequest('task',{input:10,output:2},140,'test/final-model');expect(meters.snapshot('task',150)?.model).toBe('test/final-model');
  });
  it('bounds completed-session cache without evicting active sessions',()=>{
    const meters=new SessionTokenMeters();meters.activateLifecycle('active',1);for(let i=0;i<205;i++){meters.startRun(`done-${i}`,i+10);meters.finishRun(`done-${i}`,'done',i+20);}
    expect(meters.snapshot('done-0')).toBeNull();expect(meters.snapshot('done-204')).not.toBeNull();expect(meters.snapshot('active')?.state).toBe('running');
  });
  it('does not overcount text when the provider emits one character per chunk', () => {
    const meters = new SessionTokenMeters();
    meters.beginRequest('chunks',{now:1});
    for (const char of 'abcdefgh') meters.addDelta('chunks',char,'writing',10);
    expect(meters.snapshot('chunks',20)?.down.tokens).toBe(2);
  });
  it('keeps the run active across a long tool after the assistant message has ended', () => {
    vi.useFakeTimers();
    try {
      const meters=new SessionTokenMeters();meters.startRun('tool',Date.now(),true);meters.beginRequest('tool');
      meters.endRequest('tool',{input:10,output:2});meters.markTool('tool');meters.scheduleIdleFinish('tool');
      vi.advanceTimersByTime(6000);
      expect(meters.snapshot('tool')).toMatchObject({state:'running',phase:'tool',rate:0});
      meters.finishRun('tool','done');expect(meters.snapshot('tool')?.state).toBe('done');
    } finally { vi.useRealTimers(); }
  });
  it('continues counting after partial usage, then settles to final provider numbers', () => {
    const meters=new SessionTokenMeters();meters.beginRequest('usage',{now:1});
    meters.addDelta('usage','abcd','writing',10);meters.applyLiveUsage('usage',{input:2,output:1},11);
    meters.addDelta('usage','efgh','writing',20);
    expect(meters.snapshot('usage',20)?.down).toEqual({tokens:2,estimated:true});
    meters.endRequest('usage',{input:2,output:3},30);
    expect(meters.snapshot('usage',30)?.down).toEqual({tokens:3,estimated:false});
  });
  it('stops reporting output speed while waiting, and avoids repeated context measurements', () => {
    const meters=new SessionTokenMeters();meters.beginRequest('speed',{inputEstimate:20,now:1});
    expect(meters.needsInputEstimate('speed')).toBe(true);meters.addDelta('speed','你好','thinking',10);
    expect(meters.needsInputEstimate('speed')).toBe(false);expect(meters.snapshot('speed',2000)?.rate).toBe(0);
  });
});

it('distinguishes post-response work from streaming without completing or losing a multi-request run',()=>{
 const meters=new SessionTokenMeters();meters.startRun('post',100,true);meters.beginRequest('post',{now:110,inputEstimate:30});meters.addDelta('post','response','writing',120);meters.endRequest('post',{input:30,output:5},130);
 expect(meters.snapshot('post',135)).toMatchObject({state:'running',phase:'processing',rate:0,requests:1,down:{tokens:5,estimated:false}});
 meters.markTool('post',140);expect(meters.snapshot('post',145)?.phase).toBe('tool');meters.beginRequest('post',{now:150,inputEstimate:40});expect(meters.snapshot('post',151)).toMatchObject({state:'running',phase:'upload',requests:2});meters.endRequest('post',{input:40,output:3},180);meters.finishRun('post','done',200);expect(meters.snapshot('post',210)).toMatchObject({state:'done',requests:2,up:{tokens:70},down:{tokens:8}});
});

it('excludes fragmented queue status notices from output estimates and first-output timing',()=>{
 const meter=new SessionTokenMeters();meter.startRun('queue',100);meter.beginRequest('queue',{now:101,model:'test/model'});
 const notice='Gateway 排队中：第 302 位（模型繁忙，轮到后自动开始） · 现在可以加速到不用排队（模型不变）：直接发送「加速」\n\n';
 for(const char of notice)meter.addDelta('queue',char,'thinking',120);
 const waiting=meter.snapshot('queue',130)!;expect(waiting.down.tokens).toBe(0);expect(waiting.firstOutputAt).toBeNull();expect(waiting.phase).toBe('upload');expect(waiting.excludedStatusNotices).toBe(1);
 meter.addDelta('queue','真实回答内容','writing',140);meter.endRequest('queue',{input:20,output:3},150);
 expect(meter.snapshot('queue',160)).toMatchObject({down:{tokens:3,estimated:false},byModel:[{model:'test/model',output:3}]});
});
it('counts normal reasoning and quoted queue examples, but accepts genuine final zero output',()=>{
 const meter=new SessionTokenMeters();meter.startRun('normal',100);meter.beginRequest('normal',{now:101});
 meter.addDelta('normal','用户询问排队问题，需要解释。','thinking',110);expect(meter.snapshot('normal',120)!.down.tokens).toBeGreaterThan(0);
 meter.endRequest('normal',{input:20,output:0},130);expect(meter.snapshot('normal',140)!.down).toEqual({tokens:0,estimated:false});
});
it('keeps model subtotals equal to the full round after switching models',()=>{
 const meters=new SessionTokenMeters();meters.startRun('models',1);meters.beginRequest('models',{model:'test/planner',now:2});meters.endRequest('models',{input:10,output:4,cacheRead:6},3);
 meters.beginRequest('models',{model:'test/coder',now:4});meters.addDelta('models','12345678','writing',5);meters.endRequest('models',{input:20,output:2},6);
 const result=meters.snapshot('models',7)!;expect(result.byModel).toHaveLength(2);expect(result.byModel!.reduce((n,row)=>n+row.input,0)).toBe(result.up.tokens);expect(result.byModel!.reduce((n,row)=>n+row.output,0)).toBe(result.down.tokens);
});

it('reports parameter generation before tool execution without treating samples as progress',()=>{
 const meters=new SessionTokenMeters();meters.startRun('activity',100);meters.beginRequest('activity',{now:110});
 meters.addDelta('activity','{"content":"code', 'writing',120);meters.markPreparingTool('activity','write',120);
 expect(meters.sample('activity',true,1000)?.activity).toEqual({kind:'preparing-tool',toolName:'write',at:120});
 meters.markTool('activity',1100,'write');expect(meters.sample('activity',true,2200)?.activity).toEqual({kind:'tool',toolName:'write',at:1100});
 meters.endRequest('activity',null,2400);expect(meters.sample('activity',true,3000)?.activity?.kind).toBe('processing');
});

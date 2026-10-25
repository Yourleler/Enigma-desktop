/** Independent visual treatment; product references do not supply implementation. */
export const polish = String.raw`
:root {
  --bg:#edf0f7; --text:#222638; --muted:#626a81; --accent:#6360ed;
  --line:rgba(91,104,142,.14); --paper:#f8f9fd; --surface:rgba(255,255,255,.55);
  --glass-fill:rgba(247,249,255,.51); --glass-edge:rgba(255,255,255,.86);
  --glass-shadow:0 12px 40px rgba(65,74,122,.08),inset 0 1px 0 rgba(255,255,255,.9),inset 0 -1px 0 rgba(120,133,184,.12);
  --shine:rgba(255,255,255,.5); --shine-x:32%; --shine-y:0%;
  --ease:cubic-bezier(.22,1,.36,1);
}
body { background:var(--bg); isolation:isolate; }
.ambient { z-index:0; opacity:.7; filter:blur(70px); width:700px; height:700px; will-change:transform; }
.ambient-one { left:-230px; top:-140px; background:radial-gradient(ellipse,#b4b0ff 0%,#c4cbff 35%,transparent 70%); animation:ambient-drift 26s ease-in-out infinite alternate; }
.ambient-two { right:-230px; bottom:-300px; background:radial-gradient(ellipse,#9bddd9 0%,#c6e7e5 35%,transparent 70%); animation:ambient-drift 32s ease-in-out -12s infinite alternate-reverse; }
.ambient-three { right:14%; top:-480px; background:radial-gradient(ellipse,#eec8e6 0%,transparent 68%); animation:ambient-drift 30s ease-in-out -8s infinite alternate; }
.shell,.shell.panel-open { position:relative; z-index:auto; grid-template-columns:236px minmax(0,1fr) 0px; padding:12px; gap:12px; height:100dvh; overflow:hidden; transition:grid-template-columns 420ms var(--ease); }
.shell.panel-open { grid-template-columns:236px minmax(0,1fr) 410px; }
:root[data-glass=on] .glass,:root[data-glass=on] .sidebar.glass,:root[data-glass=on] .composer.glass,:root[data-glass=on] .inspector.glass,:root[data-glass=on] .modal.glass {
  background:radial-gradient(ellipse at var(--shine-x) var(--shine-y),var(--shine),transparent 54%),linear-gradient(135deg,rgba(255,255,255,.2),transparent 42%,rgba(173,187,228,.1)),var(--glass-fill);
  border:1px solid var(--glass-edge); box-shadow:var(--glass-shadow);
  backdrop-filter:blur(34px) saturate(165%); -webkit-backdrop-filter:blur(34px) saturate(165%);
}
.sidebar { position:relative; z-index:1; border-radius:22px; padding:19px 13px 13px; min-height:0; }
.brand { padding:2px 5px 19px; }
.brand-mark { background:linear-gradient(135deg,#8485ff,#b1a4ed 48%,#77bdd1); border:1px solid #ffffff96; box-shadow:inset 0 1px 2px #ffffff8c,0 4px 15px #4e50b72e; }
.brand strong { font-size:15px; }
.brand>div>span { font-size:10px; margin-top:3px; opacity:.8; }
.project-switcher { display:flex; width:100%; gap:10px; align-items:center; padding:11px 9px; margin:0 0 16px; text-align:left; border:1px solid var(--line); border-radius:13px; background:rgba(255,255,255,.36); }
.project-avatar { width:31px; height:31px; flex-shrink:0; display:grid; place-items:center; border-radius:10px; background:linear-gradient(140deg,#938ef51e,#81c5d62b); font-size:16px; color:var(--accent); }
.project-switcher>span:nth-child(2) { min-width:0; flex:1; }
.project-switcher strong { display:block; overflow:hidden; text-overflow:ellipsis; font-size:12px; white-space:nowrap; font-weight:600; }
.project-switcher small { display:block; color:var(--muted); font-size:10px; margin-top:3px; }
.switcher-arrow { color:var(--muted); }
.new-chat { margin-bottom:10px; background:rgba(255,255,255,.52); border:1px solid var(--line); box-shadow:inset 0 1px 0 #ffffff8a; border-radius:12px; font-size:12px; }
.search-box { border-color:transparent; background:rgba(114,122,160,.065); border-radius:10px; }
.conversations-label { margin:22px 7px 8px; letter-spacing:.04em; }
.chat-list { flex:1; min-height:60px; }
.chat-button { border:1px solid transparent; padding:12px 10px; border-radius:12px; }
.chat-button.active { background:rgba(255,255,255,.55); border-color:#ffffff85; box-shadow:0 4px 15px #6873940a; }
.library-nav { border-top:1px solid var(--line); padding:10px 0 6px; }
.library-nav button { display:flex; width:100%; align-items:center; gap:10px; padding:10px; font-size:12px; text-align:left; border:0; background:transparent; border-radius:9px; }
.library-nav button:hover,.library-nav button.active { color:var(--accent); background:var(--surface); }
.sidebar-bottom { padding-top:7px; margin-top:0; }
.sidebar-bottom>button { font-size:11px; padding:9px 10px; }
.sidebar-bottom .path { white-space:nowrap; text-overflow:ellipsis; overflow:hidden; opacity:.7; font-size:9px; }
.conversation { z-index:1; container-type:inline-size; container-name:conversation; border-radius:22px; overflow:hidden; background:rgba(255,255,255,.28); border:1px solid rgba(255,255,255,.55); }
.chat-header { min-height:70px; padding:16px 25px 13px; border-bottom:0; background:transparent; }
.chat-header h1 { font-size:16px; font-weight:600; }
.header-meta { font-size:10px; gap:10px; }
.header-meta #model-label { display:none; }
.header-actions { gap:7px; }
.header-actions .icon-button { width:32px; height:32px; border-radius:10px; }
.chat-menu { position:relative; }
.chat-menu>summary { list-style:none; display:grid; place-items:center; width:32px; height:32px; border-radius:10px; cursor:pointer; font-size:20px; letter-spacing:1px; }
.chat-menu>summary::-webkit-details-marker { display:none; }
.chat-menu[open]>summary,.chat-menu>summary:hover { background:var(--surface); }
.chat-menu-items { position:absolute; top:39px; right:0; width:178px; padding:6px; z-index:8; border-radius:14px; animation:popover-in 220ms var(--ease) both; }
.chat-menu-items button { display:block!important; width:100%; padding:10px 12px; text-align:left; font-size:12px; border:0; border-radius:9px; background:transparent; }
.chat-menu-items button:hover { background:var(--surface); }
.work-toolbar { display:flex; gap:12px; flex-shrink:0; align-items:center; justify-content:space-between; margin:0 24px; padding:0 0 12px; border-bottom:1px solid var(--line); }
.task-nav,.workspace-nav { display:flex; align-items:center; gap:4px; min-width:0; }
.task-nav button,.workspace-nav button { padding:7px 9px; border:1px solid transparent; border-radius:9px; background:transparent; font-size:11px; white-space:nowrap; display:flex; align-items:center; gap:6px; }
.task-nav span { font-size:13px; color:var(--muted); }
.task-nav button:hover,.workspace-nav button:hover { background:var(--surface); }
.task-nav button.active,.workspace-nav button.active { color:var(--accent); border-color:rgba(114,113,225,.13); background:rgba(116,117,228,.085); }
.task-nav button.active span { color:var(--accent); }
.messages { flex:1; min-height:0; padding:30px max(30px,calc((100% - 780px)/2)); }
.message { font-size:14px; line-height:1.9; }
.message.user { background:rgba(255,255,255,.56); border:1px solid #ffffff85; border-radius:17px 17px 4px 17px; box-shadow:0 4px 15px #515c9506; }
.message .role { font-size:9px; letter-spacing:.1em; color:var(--muted); }
.message-arriving { animation:content-in 360ms var(--ease) both; }
.message.assistant { padding-top:14px; }
.empty-orbit { background:linear-gradient(135deg,#c4c9ff7a,#ebdbfb9c,#c4efe979); box-shadow:inset 0 2px 3px #ffffffbd,0 10px 35px #7278d926; border:1px solid #ffffffaf; animation:orbit-float 7s ease-in-out infinite; }
.run-shelf { margin:4px max(28px,calc((100% - 790px)/2)) 0; flex-shrink:0; min-width:0; border-top:1px solid var(--line); }
.run-shelf>summary { display:flex; align-items:center; justify-content:space-between; list-style:none; padding:10px 4px 7px; font-size:11px; color:var(--muted); cursor:pointer; }
.run-shelf>summary::-webkit-details-marker { display:none; }
.shelf-hint { font-size:9px; opacity:.8; }
.run-shelf.is-running #tool-summary::before { content:''; display:inline-block; width:6px; height:6px; margin-right:7px; border-radius:50%; background:var(--accent); animation:pulse 1.7s ease-in-out infinite; }
.tool-list { margin:0; max-height:160px; padding-bottom:4px; }
.tool-list details { border-radius:9px; background:rgba(255,255,255,.3); }
.composer-wrap { padding:12px max(25px,calc((100% - 800px)/2)) 14px; }
.composer.glass { border-radius:23px; padding:16px 15px 12px; position:relative; overflow:hidden; transition:box-shadow 280ms var(--ease),border-color 280ms; }
.composer:focus-within { border-color:rgba(136,128,247,.45); box-shadow:0 10px 40px #6a61b41a,0 0 0 3px #9495ff0c,inset 0 1px 0 #ffffffab; }
.composer textarea { min-height:70px; font-size:14px; }
.composer-toolbar { gap:6px; }
.composer-left { gap:5px; }
.selector-button,.composer select { border-radius:9px; padding:6px 9px; font-size:11px; }
.selector-button:hover,.composer select:hover { background:var(--surface); }
#approval-picker { min-width:0; width:82px; max-width:82px; color:var(--muted); }
.send-button { width:36px; height:36px; border-radius:12px; background:linear-gradient(135deg,#8b84f5,#6668e3); color:white; border:1px solid #a3a6ff8a; box-shadow:inset 0 1px 0 #ffffff59,0 5px 14px #6366d934; }
.send-button:hover { background:linear-gradient(135deg,#9990ff,#7476ec); box-shadow:0 7px 18px #6366d949,inset 0 1px 0 #ffffff69; transform:translateY(-2px); }
.composer-footer { font-size:10px; padding-top:9px; }
.inspector,.panel-open .inspector { display:flex; position:relative; z-index:1; width:auto; height:auto; min-width:0; border-radius:22px; overflow:hidden; opacity:0; visibility:hidden; transform:translateX(32px); transition:opacity 300ms ease,transform 420ms var(--ease),visibility 420ms; }
.panel-open .inspector { opacity:1; visibility:visible; transform:translateX(0); }
.inspector-header { padding:21px 21px 16px; background:transparent; }
.inspector-header h2 { font-size:17px; font-weight:600; }
.panel-nav { flex-shrink:0; display:flex; flex-wrap:nowrap; gap:5px; padding:11px 17px; overflow-x:auto; scrollbar-width:none; border-bottom:1px solid var(--line); }
.panel-nav button { flex-shrink:0; font-size:11px; padding:6px 8px; white-space:nowrap; }
.panel { padding:19px; }
.panel-search button { white-space:nowrap; flex-shrink:0; }
.inspector-tabs { display:flex;align-items:center;gap:5px;padding:9px 10px 0;min-height:48px;flex-shrink:0;border-bottom:1px solid var(--line); }
.content-tabs { display:flex;flex:1;min-width:0;gap:4px;overflow-x:auto;scrollbar-width:none;padding:3px 0; }
.content-tab { display:flex;align-items:center;flex-shrink:0;max-width:160px;border:1px solid transparent;border-radius:10px;background:transparent; }
.content-tab.active { background:var(--surface);border-color:var(--line); }
.content-tab>[role=tab] { border:0;background:transparent;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;font-size:11px;padding:7px 8px; }
.content-tab .tab-close { border:0;background:transparent;padding:4px 6px;font-size:12px;color:var(--muted);opacity:.65; }
.content-tab:hover .tab-close { opacity:1; }
.inspector-header { position:relative;align-items:center;padding:15px 19px 12px; }
.panel-actions { position:relative; }
.panel-actions>summary { padding:6px 9px;border-radius:9px;list-style:none;font-size:11px;cursor:pointer;background:var(--surface);white-space:nowrap;border:1px solid var(--line); }
.panel-actions>summary::-webkit-details-marker { display:none; }
.panel-actions-list { position:absolute;right:0;top:35px;width:300px;max-height:440px;overflow:auto;padding:13px;border:1px solid var(--line);border-radius:14px;background:var(--paper);box-shadow:0 12px 36px #101c4030;z-index:5;animation:popover-in 230ms var(--ease); }
.panel-actions-list .section-heading { margin:0 0 9px; }
.panel-actions-list .action-grid { margin:0; }
.content-document { min-width:0; }
.inspector[data-content-kind=source] .panel-nav,.inspector[data-content-kind=material] .panel-nav,.inspector[data-content-kind=artifact] .panel-nav { display:none; }
.content-toolbar { display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 16px;padding-bottom:12px;border-bottom:1px solid var(--line); }
.content-toolbar button,.content-toolbar a { padding:6px 9px;border-radius:8px;font-size:11px;border:1px solid var(--line);background:var(--surface);text-decoration:none;color:var(--text); }
.content-source { font-size:11px;line-height:1.7;color:var(--muted);overflow-wrap:anywhere; }
.document-body { font-size:14px;line-height:1.9;overflow-wrap:anywhere; }
.document-body h2 { font-size:21px;font-weight:600;line-height:1.5;margin:23px 0 14px; }
.document-body h3 { font-size:17px;margin:18px 0 10px; }
.document-body pre,.content-document .artifact-preview { max-height:none;padding:15px;margin:14px 0;border:1px solid var(--line);font-size:12px;line-height:1.9;background:var(--surface); }
.document-body table { width:100%;border-collapse:collapse;font-size:12px; }
.document-body td,.document-body th { border:1px solid var(--line);padding:8px 10px;text-align:left; }
.content-entry { text-align:left;max-width:100%;overflow-wrap:anywhere;border:1px solid var(--line);border-radius:10px;padding:9px 11px;margin:3px 0;font-size:11px;background:var(--surface); }
.file-search { display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px; }
.file-search select,.file-search input { padding:8px;min-width:0;font-size:11px; }
.file-search select { flex:0 1 95px; }.file-search input { flex:1 1 100px; }.file-search button { flex-shrink:0;white-space:nowrap;font-size:11px; }
.file-tree { font-size:12px; }
.file-tree details { padding-left:12px;border-left:1px solid var(--line);margin:7px 0; }
.file-tree summary { cursor:pointer;color:var(--muted);padding:5px 0; }
.file-entry { display:block;text-align:left;width:100%;padding:7px 9px;margin:2px 0;background:transparent;border:0;border-radius:8px;font:11px/1.6 ui-monospace,monospace;overflow-wrap:anywhere; }
.file-entry:hover { background:var(--surface);color:var(--accent); }
.source-preview { max-height:none;overflow:auto;font:11px/1.85 ui-monospace,SFMono-Regular,monospace;white-space:pre;margin:14px -5px;padding:12px 5px;background:var(--surface);border:1px solid var(--line); }
.source-line { display:flex;align-items:baseline; }.source-line code { white-space:pre;background:none;color:var(--text); }
.line-number { min-width:42px;text-align:right;padding-right:12px;color:var(--muted);user-select:none;flex-shrink:0; }
.shell.content-expanded.panel-open { grid-template-columns:236px minmax(260px,1fr) minmax(600px,54vw); }
@media(max-width:1280px) { .shell.content-expanded.panel-open { grid-template-columns:218px minmax(240px,1fr) minmax(570px,52vw); } }
@media(max-width:1180px) { .shell.content-expanded.panel-open { grid-template-columns:218px minmax(0,1fr); }.shell.content-expanded .inspector { width:min(850px,calc(100vw - 36px)); } }
@media(max-width:720px) { .shell.content-expanded.panel-open { grid-template-columns:minmax(0,1fr); }.shell.content-expanded .inspector { width:calc(100vw - 24px); }.panel-actions-list { width:min(300px,calc(100vw - 63px)); }.inspector-header { padding:12px 15px; }.content-tab { max-width:135px; }.document-body { font-size:13px; } }
@container conversation (max-width:760px) { .work-toolbar { flex-wrap:wrap;gap:5px; }.task-nav { flex-wrap:nowrap; }.workspace-nav { margin-left:auto; }.composer-left #resume,.context-usage { display:none; }.selector-button #selected-model { max-width:125px; } }
@container conversation (max-width:520px) { .work-toolbar { display:block; }.task-nav { justify-content:space-between; }.task-nav button { padding:6px;font-size:10px;gap:4px; }.workspace-nav { margin:5px 0 0; }.composer-wrap { padding-left:17px;padding-right:17px; }.selector-button #selected-model { max-width:100px; }.composer-right { gap:2px; }#approval-picker { width:67px;min-width:0;padding-right:12px;font-size:9px; }.composer select { font-size:9px;padding:5px 12px 5px 3px;max-width:82px;min-width:0; }.selector-button { padding:5px;font-size:10px; } }
.panel-enter { animation:content-in 340ms var(--ease); }
.card { border:1px solid var(--line); background:rgba(255,255,255,.4); border-radius:14px; margin-bottom:12px; padding:15px; }
.card h3 { font-size:13px; }
.card p { line-height:1.8; }
.action-grid button { border-radius:12px; background:rgba(255,255,255,.42); border-color:var(--line); }
.action-grid button:hover,.capability:hover { border-color:rgba(127,121,237,.4); transform:translateY(-2px); box-shadow:0 8px 18px #6868b410; }
.modal.glass { background:radial-gradient(ellipse at var(--shine-x) var(--shine-y),var(--shine),transparent 58%),var(--glass-fill); border-radius:25px; animation:popover-in 300ms var(--ease) both; }
.modal::backdrop { background:rgba(49,53,86,.19); backdrop-filter:blur(7px); animation:veil-in 240ms ease; }
.modal .muted { line-height:1.8; }
.tools-grid { gap:10px; }
.tool-category { grid-column:1/-1; font-size:10px; font-weight:600; color:var(--muted); letter-spacing:.07em; padding:10px 2px 1px; }
.capability { border-radius:14px; background:rgba(255,255,255,.3); border-color:var(--line); }
.capability strong { font-size:13px; }
.capability small { line-height:1.7; }
.model-row { border-radius:12px; }
.model-avatar { background:linear-gradient(135deg,#9b97ef23,#85c5d92e); }
.approval { animation:popover-in 300ms var(--ease); }
.notice { animation:content-in 250ms var(--ease); }
.loading { animation:pulse 1.8s ease-in-out infinite; }
button { transition:background-color 180ms,color 180ms,border-color 180ms,box-shadow 230ms var(--ease),transform 230ms var(--ease); }
button:active:not(:disabled) { transform:scale(.97); }
button:disabled { transform:none; }

:root[data-theme=dark] {
  --bg:#131622; --text:#e6e9f5; --muted:#a3abc4; --accent:#b0aaff; --paper:#242a3b;
  --surface:rgba(117,130,170,.13); --line:rgba(197,207,242,.13);
  --glass-fill:rgba(32,38,58,.5); --glass-edge:rgba(198,211,255,.16);
  --shine:rgba(143,161,227,.13);
  --glass-shadow:0 14px 40px #05091b2b,inset 0 1px 0 rgba(227,235,255,.17),inset 0 -1px 0 rgba(149,172,224,.07);
}
:root[data-theme=dark] .ambient { opacity:.42; }
:root[data-theme=dark] .ambient-one { background:radial-gradient(ellipse,#6656bc 0%,#474b8d 36%,transparent 70%); }
:root[data-theme=dark] .ambient-two { background:radial-gradient(ellipse,#316d75 0%,#284c65 38%,transparent 70%); }
:root[data-theme=dark] .ambient-three { background:radial-gradient(ellipse,#6e406f 0%,transparent 66%); }
:root[data-theme=dark] .conversation { background:rgba(21,26,42,.43); border-color:rgba(216,226,255,.07); }
:root[data-theme=dark] .chat-header { background:transparent; }
:root[data-theme=dark] .new-chat,:root[data-theme=dark] .project-switcher { background:rgba(153,166,218,.075); box-shadow:inset 0 1px 0 #c5d0ff0a; }
:root[data-theme=dark] .chat-button.active { background:rgba(137,150,198,.15); border-color:rgba(192,203,243,.12); }
:root[data-theme=dark] .message.user,:root[data-theme=dark] .card,:root[data-theme=dark] .action-grid button,:root[data-theme=dark] .capability,:root[data-theme=dark] .tool-list details { background:rgba(115,129,174,.09); border-color:var(--line); }
:root[data-theme=dark] .composer:focus-within { border-color:#a3a5ef59; box-shadow:0 8px 40px #16152830,0 0 0 3px #9798fc0c,inset 0 1px 0 #d7dfff26; }
:root[data-theme=dark] .send-button { background:linear-gradient(135deg,#c1b4ff,#949be9); color:#1e2336; }
:root[data-theme=dark] .send-button:hover { background:linear-gradient(135deg,#d0c4ff,#abb1ff); }
:root[data-theme=dark] .empty-orbit { background:linear-gradient(135deg,#5d5ab96b,#7161a244,#3670805c); }
:root[data-glass=off] .glass,:root[data-glass=off] .sidebar,:root[data-glass=off] .composer,:root[data-glass=off] .modal,:root[data-glass=off] .inspector { background:var(--paper); backdrop-filter:none; -webkit-backdrop-filter:none; box-shadow:0 5px 20px #1115250a; border-color:var(--line); }
:root[data-glass=off] .ambient { display:none; }
:root[data-glass=off] .conversation { background:var(--bg); }
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))) { .glass,.sidebar.glass,.composer.glass,.modal.glass,.inspector.glass { background:var(--paper); } }

@keyframes ambient-drift { to { transform:translate3d(80px,55px,0) scale(1.14) rotate(12deg); } }
@keyframes orbit-float { 50% { transform:translateY(-7px) rotate(-4deg); } }
@keyframes content-in { from { opacity:0; transform:translateY(9px); } to { opacity:1; transform:translateY(0); } }
@keyframes popover-in { from { opacity:0; transform:translateY(12px) scale(.97); } to { opacity:1; transform:translateY(0) scale(1); } }
@keyframes veil-in { from { opacity:0; } to { opacity:1; } }
@media(max-width:1280px) {
  .shell,.shell.panel-open { grid-template-columns:218px minmax(0,1fr) 0px; }
  .shell.panel-open { grid-template-columns:218px minmax(0,1fr) 360px; }
  .work-toolbar { flex-wrap:wrap; gap:4px; margin:0 19px; }
  .messages { padding:26px; }
  .composer-wrap { padding:13px 21px; }
  .run-shelf { margin-left:23px; margin-right:23px; }
}
@media(max-width:1180px) {
  .shell,.shell.panel-open { grid-template-columns:218px minmax(0,1fr); }
  .inspector,.panel-open .inspector { position:fixed; right:12px; top:12px; bottom:12px; height:auto; width:min(440px,calc(100vw - 36px)); z-index:20; }
  .panel-open .inspector { box-shadow:-12px 0 60px #141c4038,var(--glass-shadow); }
}
@media(max-width:720px) {
  .shell,.shell.panel-open { grid-template-columns:minmax(0,1fr); padding:0; gap:0; }
  .conversation { border:0; border-radius:0; }
  .sidebar { display:none; }
  .sidebar.sidebar-visible { display:flex; position:fixed; left:10px; top:10px; bottom:10px; width:258px; height:auto; border-radius:22px; z-index:21; box-shadow:20px 0 60px #1c263336,var(--glass-shadow); }
  .chat-header { min-height:68px; padding:14px 17px; }
  .chat-header h1 { font-size:14px; max-width:240px; }
  .chat-menu-items { right:0; }
  .work-toolbar { flex-wrap:nowrap; display:block; margin:0 15px; padding-bottom:8px; }
  .task-nav { gap:2px; justify-content:space-between; }
  .task-nav button { font-size:10px; padding:6px 7px; gap:5px; }
  .workspace-nav { margin-top:5px; gap:4px; }
  .workspace-nav button { font-size:10px; padding:5px 10px; }
  .messages { padding:22px 20px; }
  .composer-wrap { padding:10px 13px 12px; }
  .composer.glass { padding:13px 11px 10px; border-radius:20px; }
  .composer textarea { min-height:67px; font-size:13px; }
  .composer-right { gap:2px; }
  .selector-button #selected-model { max-width:99px; }
  #approval-picker { width:67px; max-width:67px; font-size:9px; padding-right:10px; }
  .selector-button { font-size:10px; padding:5px 3px; }
  .composer select { font-size:9px; padding:5px 12px 5px 4px; max-width:84px; min-width:0; }
  .send-button { width:32px; height:32px; }
  .composer-footer { font-size:9px; }
  .run-shelf { margin:0 20px; }
  .tool-list { margin:0; }
  .inspector,.panel-open .inspector { top:8px; right:8px; bottom:8px; width:calc(100vw - 24px); border-radius:22px; }
  .modal.glass { width:calc(100vw - 26px); border-radius:23px; padding:22px; }
  .tools-grid { grid-template-columns:1fr; }
}
:root[data-motion=off] *, :root[data-motion=off] *::before,:root[data-motion=off] *::after { animation:none!important; transition:none!important; scroll-behavior:auto!important; }
@media(prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none!important; transition:none!important; scroll-behavior:auto!important; } .ambient { will-change:auto; } }
`;

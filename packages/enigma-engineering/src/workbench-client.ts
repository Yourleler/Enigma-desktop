export const clientScript = String.raw`'use strict';
const $ = id => document.getElementById(id);
const token = location.hash.slice(1) || sessionStorage.getItem('enigma-token');
if (token) {
    sessionStorage.setItem('enigma-token', token);
    history.replaceState(null, '', location.pathname);
}
const groups = [
    { id: 'project', name: '项目总览', description: '仓库、依赖和原验收标准', icon: '◈' },
    { id: 'plan', name: '目标与计划', description: '任务步骤、进度和验收证据', icon: '◎' },
    { id: 'reading', name: '代码阅读', description: '源码追踪、Schema 和任务地图', icon: '⌘' },
    { id: 'materials', name: '项目资料', description: '文件、网页、飞书与版本来源', icon: '▤' },
    { id: 'skills', name: '技能与配方', description: '发现技能，复用成功流程', icon: '✦' },
    { id: 'collaboration', name: '多仓库协作', description: '隔离任务、方案比较与合并', icon: '◇' },
    { id: 'timeline', name: '时光机', description: '检查点、差异、代码与上下文恢复', icon: '↶' },
    { id: 'memory', name: '项目记忆', description: '有来源的经验、召回与忘记', icon: '◉' },
    { id: 'observer', name: '运行观察', description: '独立问答，区分等待和进展', icon: '◌' },
    { id: 'environment', name: '环境与验证', description: '服务、后台命令、等待和浏览器', icon: '▣' },
    { id: 'review', name: '代码审查', description: '只读冻结差异，按需独立检查', icon: '✓' },
    { id: 'handoff', name: '交接与复现', description: '新背景任务和跨 Agent 交接包', icon: '⇄' },
    { id: 'artifacts', name: '产物', description: '保存版本、预览、截图和下载', icon: '▧' }
];
const labels = { completed: '已完成', running: '运行中', failed: '失败', cancelled: '已取消', timeout: '超时', unknown: '状态未知', starting: '启动中', passed: '通过', verified: '已验证', unverified: '待验证', stale: '已过期', current: '当前有效', waiting: '等待中', pending: '待开始', ready: '可开始', blocked: '有前置条件', unavailable: '不可用', 'source-changed': '源码已变', 'not-started': '未启动', 'dependency-changed': '依赖已变' };
const thinkingLabels = { off: '不启用思考', minimal: '轻量思考', low: '标准思考', medium: '深入思考', high: '高强度思考', xhigh: '最高强度', max: 'Max 思考' };
const areas = [
    { name: '当前任务', ids: ['plan', 'collaboration', 'timeline', 'observer', 'handoff'] },
    { name: '项目内容', ids: ['project', 'reading', 'materials', 'artifacts', 'environment', 'review'] },
    { name: '知识与复用', ids: ['memory', 'skills'] }
];
let bootstrap = {}, chats = [], models = [], actions = [], current = null, state = null, panel = 'reading', panelOpen = false, selectedSkill = null, toolsContext = false;
const renderedMessages = new Set();
let contentTabs = [], contentKey = '', contentGeneration = 0;
const contentNames = { reading:'代码', materials:'资料', plan:'任务计划', review:'审查', artifacts:'产物', environment:'环境' };
function saveContentTabs() { if (current) sessionStorage.setItem('enigma-content:' + current, JSON.stringify({ tabs:contentTabs, selected:contentKey })); }
function restoreContentTabs() {
    try { const saved = JSON.parse(sessionStorage.getItem('enigma-content:' + current) || '{}');
        contentTabs = Array.isArray(saved.tabs) ? saved.tabs.filter(t => typeof t.key === 'string' && typeof t.title === 'string' && ['panel','source','material','artifact'].includes(t.kind) && groups.some(g=>g.id===t.group)).slice(-8) : [];
        contentKey = contentTabs.some(t=>t.key===saved.selected) ? saved.selected : contentTabs.at(-1)?.key || '';
    } catch { contentTabs=[]; contentKey=''; }
}
function rememberContent(item) {
    const previous=contentTabs.find(t=>t.key===contentKey);if(previous)previous.scroll=$('panel').scrollTop;
    const found = contentTabs.find(t=>t.key===item.key);
    if (found) Object.assign(found,item); else contentTabs.push(item);
    if (contentTabs.length>8)contentTabs.shift();
    contentKey=item.key; saveContentTabs(); renderContentTabs();
}
function renderContentTabs() {
    const root=$('content-tabs');root.replaceChildren();
    for (const [index,tab] of contentTabs.entries()) {
        const wrap=el('div',undefined,'content-tab'+(tab.key===contentKey?' active':''));
        const b=button(tab.title,()=>activateContent(tab));b.id='content-tab-'+index;b.setAttribute('role','tab');b.setAttribute('aria-selected',String(tab.key===contentKey));b.tabIndex=tab.key===contentKey?0:-1;b.title=tab.title;
        b.onkeydown=event=>{let next;if(event.key==='ArrowRight')next=(index+1)%contentTabs.length;else if(event.key==='ArrowLeft')next=(index+contentTabs.length-1)%contentTabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=contentTabs.length-1;if(next!==undefined){event.preventDefault();activateContent(contentTabs[next]);requestAnimationFrame(()=>$('content-tabs').querySelector('[aria-selected=true]')?.focus());}};
        const close=button('×',()=>{const active=tab.key===contentKey;contentTabs=contentTabs.filter(t=>t!==tab);if(active){const next=contentTabs.at(-1);if(next)activateContent(next);else{contentKey='';closePanel();}}saveContentTabs();renderContentTabs();},'tab-close');close.setAttribute('aria-label','关闭 '+tab.title);
        wrap.append(b,close);root.append(wrap);
        if(tab.key===contentKey){$('panel').setAttribute('role','tabpanel');$('panel').setAttribute('aria-labelledby',b.id);}
    }
}
function activateContent(tab) {
    if(tab.kind==='panel')openPanel(tab.group);
    else{openPanel(tab.group,tab);}
}
function openSource(repo,file,line=1) { const item={key:'source:'+repo+':'+file,kind:'source',group:'reading',title:file.split('/').at(-1),repo,file,start:Math.max(1,line-8)};openPanel('reading',item); }
let streamAbort, lastSeq = 0, draftText = '', refreshing = false, refreshRequested = false, panelGeneration = 0, runTimer, formAction, formReaders, formChoices = {}, formPreset = {};
const previews = new Map(), dialogValues = new Map(), blobUrls = [], panelQueries = {};
let previewArtifact = '', appearance;
try {
    appearance = JSON.parse(localStorage.getItem('enigma-appearance') || '{}');
}
catch {
    appearance = {};
}
function applyAppearance() { const theme = appearance.theme || 'light'; document.documentElement.dataset.theme = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme; document.documentElement.dataset.glass = appearance.glass === false ? 'off' : 'on'; document.documentElement.dataset.motion = appearance.motion === false ? 'off' : 'on'; }
applyAppearance();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance);
function el(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined)
    e.textContent = String(text); if (cls)
    e.className = cls; return e; }
function button(text, action, cls) { const b = el('button', text, cls); b.type = 'button'; b.onclick = () => Promise.resolve().then(action).catch(e => notice(e.message, 'error')); return b; }
function notice(text, type = 'info') { const e = el('div', text, 'notice ' + type); $('notices').append(e); while ($('notices').children.length > 6)
    $('notices').firstChild.remove(); }
async function api(path, body) { const response = await fetch('/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const data = await response.json(); if (!response.ok)
    throw Error(data.error || response.statusText); return data; }
const chatApi = (path, body, chat = current) => { if (!chat)
    throw Error('请先创建或选择一个对话。'); return api('/chats/' + chat + path, body); };
const status = value => labels[value] || value || '未记录';
const badge = value => el('span', status(value), 'badge ' + (value || ''));
function details(value, label = '查看完整记录') { const d = el('details'), s = el('summary', label), pre = el('pre', JSON.stringify(value, null, 2)); d.append(s, pre); return d; }
function card(title, subtitle, stateValue) { const c = el('article', undefined, 'card'), heading = el('div', undefined, 'card-title'); heading.append(el('h3', title)); if (stateValue)
    heading.append(badge(stateValue)); c.append(heading); if (subtitle)
    c.append(el('p', subtitle)); return c; }
function cardButtons(c, items) { const row = el('div', undefined, 'card-actions'); items.forEach(([title, action]) => row.append(button(title, action))); c.append(row); }
function empty(root, title, description) { const e = el('div', undefined, 'empty-panel'); e.append(el('strong', title), el('span', description || '使用下方操作开始。')); root.append(e); }
function formatDate(value) { return value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; }
function prettyModel(m) { return m?.name || m?.id || '选择模型'; }
function family(model) { const name = prettyModel(model); return /GPT/i.test(name) ? 'GPT' : /Opus|Sonnet|Claude/i.test(name) ? 'Claude' : /DeepSeek/i.test(name) ? 'DeepSeek' : /Gemini/i.test(name) ? 'Gemini' : /Seed|Doubao/i.test(name) ? 'Seed / Doubao' : /GLM/i.test(name) ? 'GLM' : '其他模型'; }
function inline(text) {
    const frag = document.createDocumentFragment();
    const pattern = /(\x60[^\x60]+\x60|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)]+\))/g;
    let index = 0;
    for (const match of text.matchAll(pattern)) {
        frag.append(document.createTextNode(text.slice(index, match.index)));
        const v = match[0];
        if (v[0] === String.fromCharCode(96))
            frag.append(el('code', v.slice(1, -1)));
        else if (v.startsWith('**'))
            frag.append(el('strong', v.slice(2, -2)));
        else {
            const p = /\[([^\]]+)\]\(([^)]+)\)/.exec(v), a = el('a', p[1]);
            a.href = p[2];
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            frag.append(a);
        }
        index = match.index + v.length;
    }
    frag.append(document.createTextNode(text.slice(index)));
    return frag;
}
function rich(text) {
    const root = el('div'), lines = String(text).split('\n'), fence = String.fromCharCode(96).repeat(3);
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (line.startsWith(fence)) {
            const code = [];
            i++;
            while (i < lines.length && !lines[i].startsWith(fence))
                code.push(lines[i++]);
            const p = el('pre'), c = el('code', code.join('\n'));
            p.append(c);
            root.append(p);
            i++;
            continue;
        }
        if (/^#{1,3} /.test(line)) {
            const level = line.match(/^#+/)[0].length, h = el('h' + Math.min(level + 1, 3));
            h.append(inline(line.replace(/^#+ /, '')));
            root.append(h);
            i++;
            continue;
        }
        if (/^\s*([-*]|\d+\.) /.test(line)) {
            const ordered = /^\s*\d+\./.test(line), list = el(ordered ? 'ol' : 'ul');
            while (i < lines.length && /^\s*([-*]|\d+\.) /.test(lines[i])) {
                const item = el('li');
                item.append(inline(lines[i++].replace(/^\s*([-*]|\d+\.) /, '')));
                list.append(item);
            }
            root.append(list);
            continue;
        }
        if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
            const table = el('table');
            const cells = v => v.trim().replace(/^\||\|$/g, '').split('|').map(v => v.trim());
            const row = (line, tag) => { const tr = el('tr'); cells(line).forEach(value => { const td = el(tag); td.append(inline(value)); tr.append(td); }); table.append(tr); };
            row(line, 'th');
            i += 2;
            while (i < lines.length && lines[i].includes('|'))
                row(lines[i++], 'td');
            root.append(table);
            continue;
        }
        if (line.trim()) {
            const p = el('p');
            p.append(inline(line));
            root.append(p);
        }
        i++;
    }
    return root;
}
function catalog() { const root = $('chat-list'), query = $('chat-search').value.trim().toLowerCase(); root.replaceChildren(); chats.slice().reverse().filter(c => c.title.toLowerCase().includes(query)).forEach(chat => { const b = button('', () => select(chat.id), 'chat-button' + (current === chat.id ? ' active' : '')); b.append(el('strong', chat.title), el('small', prettyModel(models.find(m => m.id === chat.model && m.provider === chat.provider)))); root.append(b); }); $('chat-count').textContent = chats.length; if (!chats.length)
    root.append(el('p', '创建一段新的工程对话。', 'muted')); }
async function select(id) { streamAbort?.abort(); current = id; draftText = ''; lastSeq = 0; state = null; selectedSkill = null; renderedMessages.clear(); restoreContentTabs(); renderContentTabs(); if(panelOpen&&contentKey)panel=contentTabs.find(t=>t.key===contentKey).group; $('run-shelf').open = false; catalog(); await refresh(); stream(id); $('sidebar').classList.remove('sidebar-visible'); updateScrim(); }
async function refresh() { if (!current)
    return; if (refreshing) {
    refreshRequested = true;
    return;
} refreshing = true; const id = current; try {
    state = await chatApi('', undefined, id);
    if (current !== id)
        return;
    const existing = chats.find(c => c.id === state.chat.id);
    if (existing)
        Object.assign(existing, state.chat);
    render();
    catalog();
    if (panelOpen)
        await loadPanel();
}
catch (e) {
    notice(e.message, 'error');
}
finally {
    refreshing = false;
    if (refreshRequested) {
        refreshRequested = false;
        setTimeout(refresh, 0);
    }
    clearTimeout(runTimer);
    if (state && !state.idle)
        runTimer = setTimeout(refresh, 850);
} }
function render() {
    if (!state)
        return;
    $('chat-title').textContent = state.chat.title;
    $('project-label').textContent = (bootstrap.repos?.length || 0) + ' 个仓库';
    const model = models.find(m => m.id === state.chat.model && m.provider === state.chat.provider);
    $('model-label').textContent = prettyModel(model) || state.chat.model;
    $('selected-model').textContent = prettyModel(model) || state.chat.model;
    $('model-picker').disabled = !state.idle;
    $('thinking-picker').replaceChildren();
    (state.thinkingLevels || ['off']).forEach(level => { const o = el('option', thinkingLabels[level] || level); o.value = level; $('thinking-picker').append(o); });
    $('thinking-picker').value = state.thinking;
    $('thinking-picker').disabled = !state.idle || state.thinkingLevels?.length < 2;
    $('approval-picker').value = state.approval;
    $('approval-picker').disabled = !state.idle;
    $('send').disabled = !state.idle;
    $('cancel').classList.toggle('hidden', state.idle);
    $('send').classList.toggle('hidden', !state.idle);
    $('resume').disabled = !state.idle;
    $('checkpoint').disabled = !state.idle;
    $('run-status').textContent = state.idle ? '已就绪 · ' + (state.memory ? '记忆开启' : '记忆关闭') + ' · ' + ({ ask: '操作需确认', auto: '自动操作', never: '只读权限' })[state.approval] : state.dialogs.length ? '等待你的确认' : state.operation?.state === 'running' ? state.operation.title : '正在执行任务';
    $('context-usage').textContent = state.context?.tokens ? (Math.round(state.context.tokens / 1000) + 'k 上下文') : '';
    const root = $('messages'), atBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 160, oldScroll = root.scrollTop;
    root.replaceChildren();
    if (!state.messages.length) {
        const e = el('div', undefined, 'empty-state');
        e.append(el('div', 'E', 'empty-orbit'), el('p', 'ENIGMA WORKBENCH', 'eyebrow'), el('h2', '把想法变成可靠的工程'), el('p', '模型、仓库与运行状态已准备好。\n从一个问题开始，或在工具箱探索已有能力。'));
        const suggestions = el('div', undefined, 'quick-prompts');
        [['读懂项目', '先阅读当前项目，说明入口、核心模块和依赖，给出源码依据。'], ['制定改造计划', '先整理这次任务的目标、步骤和原验收，等我补充具体要求。']].forEach(([label, text]) => suggestions.append(button(label + ' ↗', () => { $('prompt').value = text; $('prompt').focus(); })));
        suggestions.append(button('探索技能 ↗', () => openPanel('skills')));
        e.append(suggestions);
        root.append(e);
    }
    state.messages.forEach(message => { const article = el('article', undefined, 'message ' + message.role + (!renderedMessages.has(message.id) ? ' message-arriving' : '')), role = el('div', undefined, 'role'); renderedMessages.add(message.id); role.append(el('span', message.role === 'user' ? '你' : message.role === 'assistant' ? 'ENIGMA' : '运行事件')); const fork = button('从这里分支', async () => { const chat = await chatApi('/fork', { entry: message.id }); if (!chats.some(c => c.id === chat.id))
        chats.push(chat); await select(chat.id); }); fork.disabled = !state.idle; role.append(fork); article.append(role, rich(message.text)); root.append(article); });
    if (draftText && !state.messages.some(message => message.role === 'assistant' && message.text === draftText)) {
        const stream = el('article', draftText, 'message assistant');
        stream.id = 'stream-text';
        root.append(stream);
    }
    root.scrollTop = atBottom ? root.scrollHeight : oldScroll;
    const tools = $('tool-list'), openIds = new Set([...tools.querySelectorAll('details[open]')].map(d => d.dataset.id));
    tools.replaceChildren();
    state.tools.forEach(tool => { const d = el('details'); d.dataset.id = tool.id; d.open = openIds.has(tool.id); const summary = el('summary'); summary.append(el('span', tool.name), badge(tool.state)); d.append(summary, el('pre', JSON.stringify({ args: tool.args, result: tool.result }, null, 2))); tools.append(d); });
    $('run-shelf').classList.toggle('hidden', !state.tools.length);
    const activeTools = state.tools.filter(t => t.state === 'running').length;
    $('tool-summary').textContent = activeTools ? activeTools + ' 个工具执行中 · ' + state.tools.length + ' 条记录' : '工具记录 · ' + state.tools.length + ' 次调用';
    $('run-shelf').classList.toggle('is-running', activeTools > 0);
    renderOperation();
    renderDialogs();
}
function renderOperation() { const banner = $('operation-banner'); banner.replaceChildren(); if (!state?.operation) {
    banner.classList.add('hidden');
    return;
} const op = state.operation; banner.classList.remove('hidden'); banner.append(el('span', op.title), badge(op.outcome || op.state)); if (op.error)
    banner.append(el('span', op.error, 'error')); if (op.result !== undefined)
    banner.append(button('查看结果', () => { openPanel(formAction?.group || panel); }, 'quiet-button')); }
function renderDialogs() { const root = $('approval-root'); const d = state?.dialogs?.[0]; if (!d) {
    root.replaceChildren();
    return;
} if (root.dataset.dialog === d.id && root.children.length)
    return; root.dataset.dialog = d.id; root.replaceChildren(); const overlay = el('div', undefined, 'overlay'), box = el('div', undefined, 'approval'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', d.title); box.append(el('p', '需要你的决定', 'eyebrow'), el('h2', d.title), el('p', d.message || '')); let input; if (d.kind === 'select') {
    input = el('select');
    (d.options || []).forEach(v => { const o = el('option', v); o.value = v; input.append(o); });
}
else if (d.kind !== 'confirm') {
    input = el(d.kind === 'editor' ? 'textarea' : 'input');
    input.value = dialogValues.get(d.id) || d.value || '';
} if (input) {
    input.setAttribute('aria-label', '审批输入');
    input.oninput = () => dialogValues.set(d.id, input.value);
    box.append(input);
} const row = el('div', undefined, 'dialog-actions'); row.append(button('拒绝', async () => { await chatApi('/answer', { id: d.id, value: false }); await refresh(); }), button(d.kind === 'confirm' ? '批准' : '提交', async () => { await chatApi('/answer', { id: d.id, value: d.kind === 'confirm' ? true : input.value }); await refresh(); }, 'primary')); box.append(row); overlay.append(box); root.append(overlay); row.firstChild.focus(); }
async function stream(id) { const controller = new AbortController(); streamAbort = controller; try {
    const response = await fetch('/api/events?chat=' + id + '&since=' + lastSeq, { headers: { Authorization: 'Bearer ' + token }, signal: controller.signal });
    if (!response.ok)
        throw Error('事件连接失败');
    $('connection').textContent = '已连接';
    $('connection-dot').classList.add('connected');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let pending = '';
    while (true) {
        const chunk = await reader.read();
        if (chunk.done)
            break;
        pending += decoder.decode(chunk.value, { stream: true });
        let index;
        while ((index = pending.indexOf('\n\n')) >= 0) {
            const block = pending.slice(0, index);
            pending = pending.slice(index + 2);
            const line = block.split('\n').find(l => l.startsWith('data: '));
            if (!line)
                continue;
            const event = JSON.parse(line.slice(6));
            lastSeq = Math.max(lastSeq, event.seq || 0);
            if (event.type === 'catalog') {
                chats = event.data;
                catalog();
            }
            if (current !== id)
                continue;
            if (event.type === 'conversation_replaced') {
                await select(event.data.chat.id);
                return;
            }
            if (event.type === 'text_delta') {
                draftText += event.data.text;
                if (state?.messages.some(message=>message.role==='assistant'&&message.text===draftText)) {
                    $('stream-text')?.remove();
                    continue;
                }
                let message = $('stream-text');
                if (!message) {
                    message = el('article', undefined, 'message assistant');
                    message.id = 'stream-text';
                    $('messages').append(message);
                }
                message.textContent = draftText;
                $('messages').scrollTop = $('messages').scrollHeight;
            }
            else if (event.type === 'notice')
                notice(event.data.text, event.data.type);
            else if (event.type === 'editor')
                $('prompt').value = event.data.text;
            else {
                if (event.type === 'run_start' || event.type === 'refresh' && ['message_end', 'settled'].includes(event.data.event))
                    draftText = '';
                refresh();
            }
        }
    }
}
catch (e) {
    if (controller.signal.aborted)
        return;
    $('connection').textContent = '连接中断，正在重连';
    $('connection-dot').classList.remove('connected');
} if (!controller.signal.aborted && current === id)
    setTimeout(() => stream(id), 1500); }
function updateScrim() { const compact = innerWidth <= 1180, sidebar = $('sidebar').classList.contains('sidebar-visible'); $('drawer-scrim').classList.toggle('hidden', !(sidebar || panelOpen && compact)); }
function openPanel(group,item) { const changed = panel !== group || item?.key!==contentKey; panel = group; rememberContent(item||{key:'panel:'+group,kind:'panel',group,title:contentNames[group]||groups.find(g=>g.id===group)?.name||group}); panelOpen = true; $('inspector').inert = false; $('shell').classList.add('panel-open'); $('panel-title').textContent = item?.title || groups.find(g => g.id === group)?.name || group; document.querySelectorAll('[data-panel]').forEach(b => b.classList.toggle('active', b.dataset.panel === group)); const area = areas.find(a => a.ids.includes(group)); $('panel-category').textContent = area?.name || '项目内容'; const nav = $('panel-nav'); nav.replaceChildren(); groups.filter(g => area?.ids.includes(g.id)).forEach(g => nav.append(button(g.name, () => openPanel(g.id), g.id === panel ? 'active' : ''))); if (changed) {$('panel').classList.remove('panel-enter'); requestAnimationFrame(() => $('panel').classList.add('panel-enter'));} $('sidebar').classList.remove('sidebar-visible'); updateScrim(); loadPanel(); }
function closePanel() { panelOpen = false; $('inspector').inert = true; $('shell').classList.remove('panel-open'); updateScrim(); }
function addActions(_root, group) { if(group!==panel)return;const defs = actions.filter(a => a.group === group), root=$('panel-actions-list'); root.replaceChildren(); $('panel-actions').querySelector('summary').textContent='操作 · '+defs.length; const heading = el('div', undefined, 'section-heading'); heading.append(el('h3', '可用操作')); root.append(heading); const grid = el('div', undefined, 'action-grid'); defs.forEach(a => { const b = button('', () => { $('panel-actions').open=false;openAction(a.id); }); b.append(el('span', a.title), el('small', a.effect === 'execute' ? '真实执行' : a.effect === 'write' ? '创建或更新' : '按需读取')); b.disabled = !state?.idle && a.id !== 'observer-question'; grid.append(b); }); root.append(grid); }

async function loadContent(item) {
    const generation=++contentGeneration, chat=current, key=item.key, destination=$('panel'), root=el('div',undefined,'content-document');++panelGeneration;
    const publish=()=>{if(generation===contentGeneration&&chat===current&&contentKey===key){destination.replaceChildren(root);destination.scrollTop=item.scroll||0;saveContentTabs();}};
    destination.replaceChildren(el('div','正在读取内容与来源','loading'));
    $('panel-title').textContent=item.title;
    const toolbar=el('div',undefined,'content-toolbar');toolbar.append(button('返回 '+(contentNames[item.group]||'列表'),()=>openPanel(item.group)),button('重新读取',()=>loadContent(item)));
    root.append(toolbar);
    try {
        if(item.kind==='source'&&item.listing) {
            const repos=bootstrap.repos||[];
            if(!repos.length){empty(root,'尚未关联仓库','从项目设置加入 Git 仓库。');publish();return;}
            const form=el('form',undefined,'file-search'), select=el('select'), query=el('input');select.setAttribute('aria-label','文件所属仓库');query.setAttribute('aria-label','查找文件');query.placeholder='按路径搜索文件';
            for(const repo of repos){const option=el('option',repo.id);option.value=repo.id;select.append(option);}select.value=item.repo||repos[0].id;query.value=item.query||'';
            const search=el('button','查找');form.append(select,query,search);form.onsubmit=event=>{event.preventDefault();item.repo=select.value;item.query=query.value;item.offset=0;loadContent(item);};root.append(form);
            const data=await chatApi('/files?repo='+encodeURIComponent(select.value)+'&q='+encodeURIComponent(item.query||'')+'&offset='+(item.offset||0),undefined,chat);
            root.append(el('p',data.total+' 个可读候选 · 每页最多 200 个','muted'));
            const tree=el('div',undefined,'file-tree'), dirs=new Map();
            for(const file of data.files){const segments=file.split('/');let parent=tree,path='';for(const segment of segments.slice(0,-1)){path+=(path?'/':'')+segment;let d=dirs.get(path);if(!d){d=el('details');d.append(el('summary','▱ '+segment));parent.append(d);dirs.set(path,d);}parent=d;}parent.append(button(segments.at(-1),()=>openSource(select.value,file),'file-entry'));}
            root.append(tree);
            if(!data.files.length)empty(root,'没有匹配文件','换一个关键词或仓库。');
            const pages=el('div',undefined,'content-toolbar');if(data.offset>0)pages.append(button('上一页',()=>{item.offset=Math.max(0,data.offset-200);loadContent(item);}));if(data.next!==null)pages.append(button('下一页',()=>{item.offset=data.next;loadContent(item);}));root.append(pages);
        } else if(item.kind==='source') {
            const start=Number.isSafeInteger(item.start)&&item.start>0?item.start:1;
            const data=await chatApi('/source?repo='+encodeURIComponent(item.repo)+'&file='+encodeURIComponent(item.file)+'&start='+start+'&end='+(start+239),undefined,chat);
            root.append(el('p',data.repo+'/'+data.file+' · '+data.line+'–'+data.endLine+' 行','content-source'));
            root.append(badge(item.hash&&item.hash!==data.hash?'source-changed':'current'));item.hash=data.hash;
            const code=el('pre',undefined,'source-preview');for(const [i,line] of data.snippet.split('\n').entries()){const row=el('div',undefined,'source-line');row.append(el('span',data.line+i,'line-number'),el('code',line||' '));code.append(row);}root.append(code);
            root.append(el('small','当前文件 SHA-256 · '+data.hash,'path'));
            const pages=el('div',undefined,'content-toolbar');if(start>1)pages.append(button('前 240 行',()=>{item.start=Math.max(1,start-240);item.scroll=0;loadContent(item);}));if(data.endLine>=start+239)pages.append(button('后 240 行',()=>{item.start=start+240;item.scroll=0;loadContent(item);}));root.append(pages);
        } else if(item.kind==='material') {
            const data=await chatApi('/materials/'+encodeURIComponent(item.id),undefined,chat);
            root.append(badge(data.freshness),el('p','资料修订 '+data.resource.revision+' · 参考来源','content-source'));
            if(data.resource.source.kind==='imported') {const link=el('a','在原来源打开 ↗');link.href=data.resource.source.uri;link.target='_blank';link.rel='noopener noreferrer';toolbar.append(link);}
            const document=rich(data.content);document.className='document-body';root.append(document,details(data.resource.source,'来源与获取范围'));
        } else if(item.kind==='artifact') {
            const records=await chatApi('/artifacts',undefined,chat), record=records.find(x=>x.record.id===item.id);
            if(!record)throw Error('产物已不可用或不属于当前任务。');
            const response=await fetch('/api/chats/'+chat+'/artifacts/'+encodeURIComponent(item.id),{headers:{Authorization:'Bearer '+token}});if(!response.ok)throw Error('保存版本不可读。');
            const bytes=await response.blob();root.append(badge(record.sourceCurrent?'current':'stale'),el('p','保存版本 · '+formatDate(record.record.createdAt),'content-source'));
            toolbar.append(button('打开 / 下载',()=>{const url=URL.createObjectURL(bytes),a=el('a');a.href=url;a.download=item.title+(item.extension||'');a.click();setTimeout(()=>URL.revokeObjectURL(url),15000);}));
            const original=await bytes.text(), text=original.slice(0,65536)+(original.length>65536?'\n…预览已截取，下载保留完整字节。':'');
            const preview=el('pre',text,'artifact-preview');root.append(preview,details(record.record,'产物来源'));previews.set(item.id,text);while(previews.size>4)previews.delete(previews.keys().next().value);
        }
    } catch(error){root.append(card('内容不可读',error.message,'failed'));}
    publish();
}
function operationResult(root) { const op = state?.operation; if (!op || op.state === 'running')
    return; const c = card(op.title, '本次操作结果', op.outcome || op.state); if (op.error)
    c.append(el('p', op.error, 'error')); if (op.result !== undefined) {
    const value = op.result;
    if (typeof value === 'string')
        c.append(rich(value));
    else if (value && typeof value === 'object') {
        if (value.content)
            c.append(rich(value.content));
        if (value.answer)
            c.append(el('p', value.answer));
        if (value.note)
            c.append(el('p', value.note));
        if (value.goal)
            c.append(el('p', value.goal));
        if (value.id)
            c.append(el('div', 'ID · ' + value.id, 'path'));
        if (value.workspace)
            c.append(el('div', value.workspace, 'path'));
        if (value.conflicts?.length)
            c.append(el('p', '冲突：' + value.conflicts.join('\n'), 'error'));
        if (value.changes)
            for (const change of value.changes.slice(0, 30)) {
                c.append(el('p', (change.repo || '') + '/' + change.file + ' · ' + status(change.state || change.change)));
                if (change.patch)
                    c.append(el('pre', change.patch));
            }
        if (value.definitions)
            for (const d of value.definitions.slice(0, 12)) {
                c.append(el('p', d.name + ' · ' + d.source.repo + '/' + d.source.file + ':' + d.source.line));
                if (d.members)
                    c.append(el('pre', d.members.map(m => m.name + ' : ' + m.type).join('\n')));
            }
        if (value.files)
            for (const f of value.files.slice(0, 20))
                c.append(el('p', f.repo + '/' + f.file));
        if (value.applyAllowed !== undefined)
            c.append(badge(value.applyAllowed ? 'ready' : 'blocked'));
        if (value.symbols)
            for (const s of value.symbols.slice(0, 10)) {
                c.append(el('p', s.repo + ' / ' + s.file + ':' + s.line + ' · ' + s.symbol), el('pre', s.snippet));
            }
        if (value.results)
            for (const check of value.results)
                c.append(el('p', (check.check || check.id) + ' · ' + status(check.status)));
        c.append(details(value));
    }
    else
        c.append(el('p', String(value)));
} root.append(c); }
async function loadPanel() {
    if (!panelOpen)
        return;
    const selected=contentTabs.find(t=>t.key===contentKey);
    $('inspector').dataset.contentKind=selected?.kind||'panel';
    if(selected&&selected.kind!=='panel'){addActions(null,selected.group);return loadContent(selected);}
    ++contentGeneration;
    const generation = ++panelGeneration, chat = current, group = panel, destination = $('panel'), root = el('div');
    $('panel-title').textContent=groups.find(g=>g.id===group)?.name||group;
    destination.replaceChildren(el('div', '正在读取项目状态', 'loading'));
    blobUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
    if (!chat) {
        empty(root, '选择一段对话', '工具操作关联当前任务和来源。先创建或选择对话。');
        destination.replaceChildren(root);
        return;
    }
    try {
        if (group === 'project') {
            const data = await chatApi('/project', undefined, chat);
            bootstrap.repos = data.repositories;
            bootstrap.checks = data.checks;
            const stats = el('div', undefined, 'stat-grid');
            [[data.repositories.length, '仓库'], [data.checks.length, '原检查'], [data.plan?.completed || 0, '已验证步骤']].forEach(([value, label]) => { const stat = el('div', undefined, 'stat'); stat.append(el('strong', value), el('small', label)); stats.append(stat); });
            root.append(stats);
            for (const repo of data.repositories) {
                const branch = data.git?.find(g => g.id === repo.id)?.branch;
                const c = card(repo.id, repo.role || '项目仓库', repo.access === 'write' ? 'ready' : 'current');
                c.append(el('div', repo.root, 'path'), el('p', '分支 · ' + (branch || '未提交 / detached')), el('p', '依赖 · ' + (repo.dependsOn.join(', ') || '无声明')));
                cardButtons(c, [['调整依赖', () => openAction('repo-dependencies', { repo: repo.id, dependsOn: repo.dependsOn })]]);
                root.append(c);
            }
            if (!data.repositories.length)
                empty(root, '还没有关联仓库', '加入 Git 仓库即可开始协同工作。');
            if (data.checks.length) {
                const h = el('div', undefined, 'section-heading');
                h.append(el('h3', '原验收标准'));
                root.append(h);
                for (const check of data.checks) {
                    const c = card(check.id, check.repo + (check.joint ? ' · 联合验证' : ''));
                    c.append(el('div', check.argv.join(' '), 'path'));
                    root.append(c);
                }
            }
            if (data.blockers.length)
                root.append(card('仍需核对', data.blockers.join('\n'), 'blocked'));
        }
        else if (group === 'plan') {
            const data = await chatApi('/data/plan', undefined, chat);
            if (data) {
                const c = card(data.plan.goal, '修订 ' + data.plan.revision + ' · ' + data.completed + ' / ' + data.total + ' 已验证');
                const progress = el('div', undefined, 'plan-progress'), bar = el('span');
                bar.style.width = (data.total ? data.completed / data.total * 100 : 0) + '%';
                progress.append(bar);
                c.append(progress);
                for (const step of data.steps) {
                    const item = el('div', undefined, 'step ' + step.state), mark = el('span', step.state === 'verified' ? '✓' : '○', 'step-icon'), body = el('div', undefined, 'step-body');
                    body.append(el('strong', step.goal), el('small', step.repo + ' · ' + status(step.state) + ' · ' + step.checks.join(', ')));
                    const update = button('更新', () => openAction('plan-step', { plan: data.plan.id, revision: data.plan.revision, step: step.id, phase: step.phase }), 'quiet-button');
                    body.append(update);
                    item.append(mark, body);
                    c.append(item);
                }
                c.append(details(data));
                root.append(c);
            }
            else
                empty(root, '还没有任务计划', '为目标建立步骤和原验收标准。');
        }
        else if (group === 'reading') {
            root.append(button('浏览仓库文件',()=>openPanel('reading',{key:'files',kind:'source',group:'reading',title:'仓库文件',listing:true,repo:bootstrap.repos?.[0]?.id}),'content-entry'));
            const maps = await chatApi('/maps', undefined, chat);
            if (!maps.length)
                empty(root, '按问题开始阅读', '追踪一个符号，或从差异建立任务地图。');
            for (const map of maps) {
                const r = map.report, c = card(r.goal, '修订 ' + r.revision, map.current ? 'current' : 'stale');
                for (const node of r.nodes) {
                    c.append(button(node.role + ' · ' + node.source.repo + '/' + node.source.file + ':' + node.source.line, () => openSource(node.source.repo,node.source.file,node.source.line),'content-entry'));
                }
                if (r.gaps?.length)
                    c.append(el('p', r.gaps.join('\n')));
                cardButtons(c, [['检查覆盖', () => openAction('map-coverage', { id: r.id })]]);
                c.append(details({ edges: r.edges, requirements: r.requirements, chapters: r.chapters }));
                root.append(c);
            }
        }
        else if (group === 'materials') {
            const data = await chatApi('/materials', undefined, chat);
            if (!data.items.length)
                empty(root, '项目资料就在任务旁边', '关联设计文件、添加笔记，或读取网页与飞书。');
            for (const item of data.items) {
                const c = card(item.title, '修订 ' + item.revision + ' · ' + item.source.kind, item.freshness);
                cardButtons(c, [['阅读', () => openPanel('materials',{key:'material:'+item.id,kind:'material',group:'materials',title:item.title,id:item.id})], ['刷新', () => openAction('material-refresh', { id: item.id })], ['移除', () => openAction('material-remove', { id: item.id })]]);
                c.append(details(item.source, '来源信息'));
                root.append(c);
            }
        }
        else if (group === 'skills') {
            const data = await chatApi('/data/skills?q=' + encodeURIComponent(panelQueries.skills || ''), undefined, chat);
            const search = el('div', undefined, 'panel-search'), query = el('input');
            query.setAttribute('aria-label', '搜索技能');
            query.placeholder = '按任务搜索原生技能';
            query.value = panelQueries.skills || '';
            search.append(query, button('搜索', () => { panelQueries.skills = query.value; loadPanel(); }));
            root.append(search);
            for (const skill of data.catalog.skills) {
                const c = card(skill.name, skill.description);
                cardButtons(c, [['使用技能', () => { selectedSkill = skill; $('skill-chip').replaceChildren(el('span', '✦ ' + skill.name), button('×', () => { selectedSkill = null; $('skill-chip').classList.add('hidden'); }, 'icon-button')); $('skill-chip').classList.remove('hidden'); $('prompt').focus(); closePanel(); }], ['阅读', () => openAction('skills-read', { id: skill.id, version: skill.version })]]);
                c.append(el('div', (skill.modelInvocation ? '可按需调用' : '仅手动调用') + ' · ' + skill.file, 'path'));
                root.append(c);
            }
            if (!data.catalog.skills.length)
                empty(root, '当前没有发现技能', '添加已有 SKILL.md 路径，或使用 Pi 原生技能目录。');
            if (data.recipes.length) {
                root.append(el('h3', '已推广配方', 'section-heading'));
                for (const recipe of data.recipes) {
                    const c = card(recipe.label, '修订 ' + recipe.revision + ' · ' + recipe.steps.length + ' 个步骤');
                    cardButtons(c, [['运行配方', () => openAction('recipe-run', { id: recipe.id })], ['编辑', () => openAction('recipe-save', { ...recipe, parameters: Object.entries(recipe.parameters || {}).map(([name, v]) => ({ name, ...v })) })]]);
                    c.append(details(recipe));
                    root.append(c);
                }
            }
            for (const run of data.runs) {
                const c = card('配方运行 · ' + run.recipe, formatDate(run.createdAt), run.status);
                cardButtons(c, [['查看运行报告', () => openAction('recipe-report', { id: run.id })]]);
                c.append(details(run));
                root.append(c);
            }
            for (const proposal of data.proposals || []) {
                const c = card(proposal.input.label, '从成功任务提取，尚未推广');
                cardButtons(c, [['审阅并推广', () => openAction('recipe-save', { ...proposal.input, parameters: Object.entries(proposal.input.parameters || {}).map(([name, v]) => ({ name, ...v })) })]]);
                c.append(details(proposal));
                root.append(c);
            }
            if (data.catalog.diagnostics?.length)
                root.append(details(data.catalog.diagnostics, '技能发现提示'));
        }
        else if (group === 'memory') {
            const data = await chatApi('/data/memory', undefined, chat);
            if (!data.enabled) {
                const c = card('轻量记忆尚未启用', '你可以在设置中为此会话开启；项目记忆保留原始来源。');
                cardButtons(c, [['打开设置', openSettings]]);
                root.append(c);
            }
            const form = el('form', undefined, 'panel-search'), input = el('input');
            input.placeholder = '中文、符号或排障关键词';
            input.setAttribute('aria-label', '搜索记忆');
            form.append(input, button('搜索', async () => { const result = await chatApi('/data/memory?q=' + encodeURIComponent(input.value), undefined, chat); renderMemory(root, result.search); }));
            root.append(form);
            renderMemory(root, data.search);
        }
        else if (group === 'collaboration') {
            const data = await chatApi('/data/collaboration', undefined, chat);
            if (!data.delegations.length)
                empty(root, '为难题准备独立方案', '子任务在隔离工作区执行，结果先预览，再受控合并。');
            for (const child of data.delegations) {
                const c = card(child.spec.goal, child.spec.target.toUpperCase() + ' · ' + child.state.requests + ' 次已知调用', child.status);
                c.append(el('div', child.spec.id, 'path'));
                if (child.state.answer)
                    c.append(el('p', child.state.answer.slice(0, 1200)));
                cardButtons(c, child.terminal ? [['预览合并', () => openAction('delegate-preview', { id: child.spec.id })]] : [['取消', () => openAction('delegate-cancel', { id: child.spec.id })]]);
                c.append(details(child));
                root.append(c);
            }
            for (const exp of data.experiments) {
                const c = card(exp.experiment.goal, '同起点、同原检查比较');
                for (const candidate of exp.candidates)
                    c.append(el('p', candidate.id + ' · ' + status(candidate.status) + ' · ' + (candidate.validNow ? '证据有效' : '证据待核对')));
                cardButtons(c, [['运行共同检查', () => openAction('experiment-evaluate', { id: exp.experiment.id })], ['选择方案', () => openAction('experiment-select', { id: exp.experiment.id })]]);
                c.append(details(exp));
                root.append(c);
            }
        }
        else if (group === 'timeline') {
            const data = await chatApi('/data/timeline', undefined, chat);
            const cps = data.checkpoints;
            if (cps.length) {
                const c = card('代码恢复', '上下文切换与代码恢复分别处理，原要求和消耗保留。');
                const select = el('select');
                select.setAttribute('aria-label', '恢复检查点');
                cps.forEach(cp => { const o = el('option', cp.label + ' · ' + formatDate(cp.createdAt)); o.value = cp.id; select.append(o); });
                c.append(select);
                cardButtons(c, [['查看相对差异', async () => { const diff = await chatApi('/diff?baseline=' + select.value, undefined, chat); for (const p of diff.patches) {
                            const file = card(p.repo + '/' + p.file, status(p.change));
                            file.append(el('pre', p.patch || ''));
                            root.append(file);
                        } }], ['预览恢复', () => openAction('restore-preview', { target: select.value, expected: cps.at(-1).id })], ['恢复代码', () => openAction('restore', { target: select.value, expected: cps.at(-1).id })]]);
                root.append(c);
                for (const cp of cps.slice().reverse().slice(0, 20)) {
                    const c = card(cp.label, formatDate(cp.createdAt) + ' · ' + cp.repos.map(r => r.repo.id).join(', '));
                    c.append(el('div', cp.id, 'path'));
                    root.append(c);
                }
            }
            else
                empty(root, '保留可以回来的路径', '先记录代码检查点，再探索不同方案。');
            if (state.tree?.length) {
                root.append(el('h3', '会话分支', 'section-heading'));
                for (const entry of state.tree.slice(-40)) {
                    const c = el('div', undefined, 'tree-card');
                    c.append(el('span', entry.type + ' · ' + entry.id));
                    cardButtons(c, [['切换上下文', async () => { await chatApi('/branch', { entry: entry.id }); await refresh(); }], ['Fork 新对话', async () => { const next = await chatApi('/fork', { entry: entry.id }); chats.push(next); await select(next.id); }]]);
                    if (!state.idle)
                        c.querySelectorAll('button').forEach(b => b.disabled = true);
                    root.append(c);
                }
            }
            for (const op of data.operations.filter(o => ['pending', 'unknown'].includes(o.status))) {
                const c = card('未结算操作', op.id, op.status);
                cardButtons(c, [['记录核对', () => openAction('acknowledge', { id: op.id })]]);
                c.append(details(op));
                root.append(c);
            }
        }
        else if (group === 'observer') {
            const data = await chatApi('/data/observer', undefined, chat);
            const c = card('当前可见状态', data.answer, data.available ? 'current' : 'unavailable');
            if (data.status?.stages)
                for (const stage of data.status.stages)
                    c.append(el('p', JSON.stringify(stage)));
            c.append(details(data, '观察依据'));
            root.append(c);
            const f = el('form', undefined, 'panel-search'), input = el('input');
            input.placeholder = '现在卡住了，还是在推进？';
            input.setAttribute('aria-label', '运行状态问题');
            f.append(input, button('询问', async () => { const result = await chatApi('/actions', { action: 'observer-question', args: { question: input.value || '现在有什么有效进展？' } }, chat); root.append(card('旁路回答', result.answer)); }));
            root.append(f);
        }
        else if (group === 'environment') {
            const data = await chatApi('/data/environment', undefined, chat);
            if (!data.services.length && !data.background.length)
                empty(root, '让工程环境可运行、可观察', '配置服务或后台命令，并选择明确的就绪与终态条件。');
            for (const service of data.services) {
                const c = card(service.service.label || service.service.id, service.url || '服务尚未就绪', service.status);
                cardButtons(c, [['启动', () => openAction('service-start', { id: service.service.id })], ['停止', () => openAction('service-stop', { id: service.service.id })], ['重启', () => openAction('service-restart', { id: service.service.id })]]);
                c.append(details(service, '日志与运行详情'));
                root.append(c);
            }
            for (const run of data.background) {
                const c = card(run.spec.label, run.state.output?.slice(-1600) || '暂无输出', run.state.status);
                if (!run.terminal)
                    cardButtons(c, [['取消命令', () => openAction('background-cancel', { id: run.spec.id })]]);
                c.append(details(run));
                root.append(c);
            }
            for (const wait of data.waits) {
                const c = card(wait.spec.label, '等待 ' + wait.spec.condition.kind, wait.state.status);
                if (wait.state.status === 'waiting')
                    cardButtons(c, [['取消等待', () => openAction('wait-cancel', { id: wait.spec.id })]]);
                c.append(details(wait));
                root.append(c);
            }
            for (const scenario of data.scenarios) {
                const c = card(scenario.label, scenario.steps.length + ' 个浏览器动作');
                cardButtons(c, [['执行场景', () => openAction('browser-run', { id: scenario.id })], ['编辑场景', () => openAction('browser-add', scenario)]]);
                c.append(details(scenario));
                root.append(c);
            }
        }
        else if (group === 'review') {
            const data = await chatApi('/data/review', undefined, chat);
            if (!data.length)
                empty(root, '按需独立审查', '只读冻结差异，保留原检查和来源；审查意见不等于验收。');
            for (const report of data) {
                const c = card('独立审查', report.model, report.status);
                c.append(rich(report.text || report.answer || ''), details(report));
                root.append(c);
            }
        }
        else if (group === 'handoff') {
            const data = await chatApi('/data/handoff', undefined, chat);
            const c = card('带着背景开启另一项工作', '选定共同背景和新目标，原对话、代码与权限分别处理。');
            c.append(el('p', data.entries.length + ' 条可选择的原消息。'));
            root.append(c);
            for (const pkg of data.packages) {
                const c = card(pkg.id, '可复现任务包');
                c.append(el('div', pkg.directory, 'path'));
                cardButtons(c, [['检查', () => openAction('package-inspect', { directory: pkg.directory })], ['在新目录复现', () => openAction('package-restore', { directory: pkg.directory })]]);
                root.append(c);
            }
        }
        else if (group === 'artifacts') {
            const data = await chatApi('/artifacts', undefined, chat);
            if (!data.length)
                empty(root, '把成果保存成可核对版本', '登记文档、代码、报告、截图或任务包。');
            for (const artifact of data) {
                const r = artifact.record, c = card(r.title, r.kind + ' · ' + formatDate(r.createdAt), artifact.sourceCurrent ? 'current' : 'stale');
                const blob = async () => { const response = await fetch('/api/chats/' + chat + '/artifacts/' + r.id, { headers: { Authorization: 'Bearer ' + token } }); if (!response.ok)
                    throw Error('产物不可读。'); return response.blob(); };
                const controls = [['打开 / 下载', async () => { const url = URL.createObjectURL(await blob()), a = el('a'); a.href = url; a.download = r.title + r.extension; a.click(); setTimeout(() => URL.revokeObjectURL(url), 15000); }]];
                if (['document', 'code', 'report'].includes(r.kind)) {
                    const show = text => { c.querySelector('.artifact-preview')?.remove(); c.append(el('pre', text, 'artifact-preview')); };
                    controls.push(['预览内容', async () => { let text = previews.get(r.id); if (text === undefined) {
                            const original = await (await blob()).text();
                            text = original.slice(0, 65536) + (original.length > 65536 ? '\n…预览已截取，下载可获取完整保存版本。' : '');
                            previews.set(r.id, text);
                            while (previews.size > 4)
                                previews.delete(previews.keys().next().value);
                        } previewArtifact = r.id; openPanel('artifacts',{key:'artifact:'+r.id,kind:'artifact',group:'artifacts',title:r.title,id:r.id,extension:r.extension}); }]);
                    if (previewArtifact === r.id && previews.has(r.id))
                        show(previews.get(r.id));
                }
                cardButtons(c, controls);
                if (r.kind === 'screenshot') {
                    const img = el('img');
                    img.alt = r.title;
                    img.src = URL.createObjectURL(await blob());
                    blobUrls.push(img.src);
                    img.onclick = async () => { const overlay = el('div', undefined, 'overlay'), box = el('div', undefined, 'approval image-preview'), large = el('img'); large.src = URL.createObjectURL(await blob()); large.alt = img.alt; box.append(large, button('关闭', () => { URL.revokeObjectURL(large.src); overlay.remove(); })); overlay.append(box); document.body.append(overlay); };
                    c.append(img);
                }
                root.append(c);
            }
        }
        operationResult(root);
        addActions(root, group);
    }
    catch (e) {
        root.append(card('读取失败', e.message, 'failed'), button('重新读取', loadPanel));
    }
    if (generation === panelGeneration && chat === current && group === panel)
        destination.replaceChildren(root);
}
function renderMemory(root, search) { root.querySelectorAll('.memory-result').forEach(e => e.remove()); if (!search.items?.length) {
    const p = el('p', '没有匹配的当前记忆。', 'memory-result muted');
    root.append(p);
    return;
} for (const item of search.items) {
    const c = card(item.title, item.summary, item.freshness || 'current');
    c.classList.add('memory-result');
    c.append(el('div', item.id, 'path'));
    cardButtons(c, [['阅读正文', () => openAction('memory-read', { id: item.id })], ['更正', () => openAction('memory-save', { title: item.title, content: item.summary, replaces: item.id })], ['忘记', () => openAction('memory-forget', { id: item.id })]]);
    c.append(details(item));
    root.append(c);
} }
function toolsGrid() { const query = $('tools-search').value.trim().toLowerCase(), root = $('tools-grid'); root.replaceChildren(); let previousArea = ''; for (const area of areas) for (const group of groups.filter(g => area.ids.includes(g.id))) {
    if (toolsContext && !query && !['skills', 'materials'].includes(group.id)) continue;
    const defs = actions.filter(a => a.group === group.id);
    if (query && !((group.name + ' ' + group.description + ' ' + defs.map(a => a.title + ' ' + a.description).join(' ')).toLowerCase().includes(query)))
        continue;
    if (previousArea !== area.name) { root.append(el('div', area.name, 'tool-category')); previousArea = area.name; }
    const b = button('', () => { $('tools-dialog').close(); openPanel(group.id); }, 'capability');
    b.append(el('strong', group.icon + '  ' + group.name), el('small', group.description + ' · ' + defs.length + ' 项操作'));
    root.append(b);
} }
function openTools(context = false) { toolsContext = context === true; $('tools-title').textContent = toolsContext ? '添加到当前任务' : '全部项目工具'; $('tools-description').textContent = toolsContext ? '选择技能或关联资料，其他工程操作在任务导航中打开。' : '按当前任务、项目内容与知识复用组织。'; $('tools-all').classList.toggle('hidden', !toolsContext); $('tools-search').value = ''; toolsGrid(); $('tools-dialog').showModal(); $('tools-search').focus(); }
function modelList() { const root = $('model-list'), query = $('model-search').value.trim().toLowerCase(); root.replaceChildren(); const visible = models.filter(m => (m.name + ' ' + m.id + ' ' + m.provider).toLowerCase().includes(query)); $('model-count').textContent = models.length + ' 个已配置模型 · ' + visible.length + ' 个匹配'; const families = [...new Set(visible.map(family))]; for (const name of families) {
    root.append(el('div', name, 'model-group-label'));
    for (const m of visible.filter(m => family(m) === name)) {
        const selected = state?.chat.model === m.id && state?.chat.provider === m.provider, b = button('', async () => { await chatApi('/settings', { provider: m.provider, model: m.id }); $('model-dialog').close(); await refresh(); }, 'model-row' + (selected ? ' selected' : ''));
        b.append(el('span', name.slice(0, 2), 'model-avatar'));
        const info = el('div', undefined, 'model-info');
        info.append(el('strong', prettyModel(m)), el('small', m.id + ' · ' + m.provider));
        const meta = el('div', undefined, 'model-detail');
        meta.append(el('div', m.contextWindow >= 1000000 ? '1M 上下文' : Math.round(m.contextWindow / 1000) + 'k 上下文'), el('div', m.reasoning ? '支持思考' : '无思考模式'));
        b.append(info, meta);
        b.disabled = !state?.idle;
        root.append(b);
    }
} if (!visible.length)
    root.append(el('p', '没有匹配的已配置模型。', 'muted')); }
async function loadChoices(definition) { const required = new Set(); const walk = fields => fields.forEach(f => { if (f.source)
    required.add(f.source); if (f.fields)
    walk(f.fields); }); walk(definition.fields); const choices = { repos: (bootstrap.repos || []).map(r => ({ id: r.id, label: r.id })), checks: (bootstrap.checks || []).map(c => ({ id: c.id, label: c.id + ' · ' + c.repo })), entries: (state?.messages || []).map(m => ({ id: m.id, label: (m.role === 'user' ? '你' : 'Enigma') + ' · ' + m.text.slice(0, 100) })) }; const recordSources = ['recipes', 'recipeRuns', 'delegations', 'experiments', 'mergePreviews', 'background', 'waits', 'browserReports']; if ([...required].some(s => recordSources.includes(s))) {
    const data = await chatApi('/data/choices');
    for (const source of recordSources) {
        const values = source === 'delegations' ? data.delegates : source === 'recipeRuns' ? data.recipeRuns : data[source] || [];
        choices[source] = values.map(v => ({ id: v.id || v.spec?.id, label: v.label || v.goal || v.title || v.spec?.label || v.spec?.goal || v.id || v.spec?.id }));
    }
} await Promise.all([...required].map(async (source) => { if (source === 'checkpoints')
    choices[source] = (await chatApi('/checkpoints')).map(c => ({ id: c.id, label: c.label + ' · ' + formatDate(c.createdAt) }));
else if (source === 'materials')
    choices[source] = (await chatApi('/materials')).items.map(m => ({ id: m.id, label: m.title }));
else if (source === 'artifacts')
    choices[source] = (await chatApi('/artifacts')).map(a => ({ id: a.record.id, label: a.record.title }));
else if (source === 'services' || source === 'scenarios') {
    const data = await chatApi('/data/environment');
    choices.services = data.services.map(s => ({ id: s.service.id, label: s.service.label }));
    choices.scenarios = data.scenarios.map(s => ({ id: s.id, label: s.label }));
} })); return choices; }
function wireFieldConditions(container, definitions) {
    const update = () => {
        for (const f of definitions) if (f.when) {
            const children = [...container.children];
            const target = children.find(e => e.dataset.fieldWrap === f.when.field)?.querySelector('[data-field]');
            const own = children.find(e => e.dataset.fieldWrap === f.name);
            own?.classList.toggle('hidden', !f.when.values.includes(target?.value));
        }
    };
    container.addEventListener('change', update); update();
}
function createField(f, value) {
    const wrap = el('div'), kind = f.kind || 'text';wrap.dataset.fieldWrap=f.name;
    let read;
    if (kind === 'rows') {
        wrap.className = 'row-collection';
        const heading = el('div', undefined, 'row-heading'), rows = el('div');
        heading.append(el('strong', f.label));
        const readers = [];
        const add = v => { const row = el('div', undefined, 'nested-fields'), rh = el('div', undefined, 'row-heading'); rh.append(el('span', '第 ' + (readers.length + 1) + ' 项')); const fields = (f.fields || []).map(child => { const result = createField(child, v?.[child.name]); row.append(result.element); return [child.name, result.read]; }); const reader = { row, read: () => ({ ...v, ...Object.fromEntries(fields.map(([k, r]) => [k, r()])) }) }; readers.push(reader); rh.append(button('上移', () => { const i = readers.indexOf(reader); if (i > 0) {
            [readers[i - 1], readers[i]] = [readers[i], readers[i - 1]];
            readers.forEach(r => rows.append(r.row));
        } }), button('下移', () => { const i = readers.indexOf(reader); if (i < readers.length - 1) {
            [readers[i], readers[i + 1]] = [readers[i + 1], readers[i]];
            readers.forEach(r => rows.append(r.row));
        } }), button('移除', () => { readers.splice(readers.indexOf(reader), 1); row.remove(); })); row.prepend(rh); rows.append(row);wireFieldConditions(row,f.fields||[]); };
        heading.append(button('＋ 添加', () => add({})));
        wrap.append(heading, rows);
        if (f.help)
            wrap.append(el('small', f.help, 'field-help'));
        (Array.isArray(value) ? value : Array.isArray(f.value) ? f.value : f.required ? [{}] : []).forEach(add);
        read = () => { const rows = readers.map(r => r.read()); if (f.required && !rows.length)
            throw Error('请添加 ' + f.label); return rows; };
    }
    else if (kind === 'object') {
        wrap.className = 'nested-fields';
        wrap.append(el('strong', f.label));
        const readers = (f.fields || []).map(child => { const result = createField(child, value?.[child.name]); wrap.append(result.element); return [child.name, result.read]; });
        wireFieldConditions(wrap,f.fields||[]);read = () => Object.fromEntries(readers.map(([k, r]) => [k, r()]).filter(([, v]) => v !== undefined));
    }
    else {
        const label = el('label', f.label + (f.required ? ' *' : ''));
        let input;
        if (kind === 'multi') {
            input = el('div', undefined, 'choice-list');
            const choices = formChoices[f.source] || [];
            for (const choice of choices) {
                const l = el('label'), c = el('input');
                c.type = 'checkbox';
                c.value = choice.id;
                c.checked = (value || []).includes(choice.id);
                l.append(c, document.createTextNode(choice.label));
                input.append(l);
            }
            if (!choices.length)
                input.append(el('p', '暂无可选项', 'muted'));
            read = () => [...input.querySelectorAll('input:checked')].map(c => c.value);
        }
        else if (kind === 'boolean') {
            input = el('input');
            input.type = 'checkbox';
            input.checked = !!value;
            read = () => input.checked;
            label.classList.add('switch-row');
        }
        else if (kind === 'select') {
            input = el('select');
            const options = f.options ? f.options.map(o => ({ id: o, label: o })) : formChoices[f.source] || [];
            if (!f.required) {
                const o = el('option', '不限定 / 不选择');
                o.value = '';
                input.append(o);
            }
            for (const option of options) {
                const o = el('option', option.label);
                o.value = option.id;
                input.append(o);
            }
            input.value = value ?? f.value ?? (f.required ? options[0]?.id || '' : '');
            read = () => input.value || undefined;
        }
        else {
            input = el(kind === 'textarea' || kind === 'lines' || kind === 'pairs' ? 'textarea' : 'input');
            if (kind === 'number')
                input.type = 'number';
            if (kind === 'textarea')
                input.rows = 3;
            if (kind === 'lines')
                input.rows = 3;
            if (kind === 'pairs')
                input.rows = 3;
            input.value = kind === 'lines' ? (Array.isArray(value) ? value.join('\n') : '') : kind === 'pairs' ? (value ? Object.entries(value).map(([k, v]) => k + '=' + v).join('\n') : '') : value ?? f.value ?? '';
            read = () => { const v = input.value; if (!v.trim())
                return undefined; if (kind === 'number') {
                const n = Number(v);
                if (!Number.isFinite(n))
                    throw Error(f.label + ' 必须是数字');
                return n;
            } if (kind === 'lines')
                return v.split('\n').map(s => s.trim()).filter(Boolean); if (kind === 'pairs')
                return Object.fromEntries(v.split('\n').filter(Boolean).map(line => { const i = line.indexOf('='); if (i < 1)
                    throw Error('参数应为 名称=值'); return [line.slice(0, i), line.slice(i + 1)]; })); return v; };
        }
        input.setAttribute('aria-label', f.label);
        input.dataset.field = f.name;
        if ('required' in input && f.required)
            input.required = true;
        label.append(input);
        if (f.help)
            label.append(el('small', f.help, 'field-help'));
        wrap.append(label);
    }
    return { element: wrap, read: () => { if(wrap.classList.contains('hidden'))return undefined;const result = read(); if (f.required && (result === undefined || result === ''))
            throw Error('请填写 ' + f.label); return result; } };
}
async function openAction(id, preset = {}) { if (!current) {
    notice('请先创建一段对话。');
    return;
} const a = actions.find(a => a.id === id); if (!a)
    throw Error('此操作未注册。'); formAction = a; formPreset = { ...preset }; formChoices = await loadChoices(a); $('action-title').textContent = a.title; $('action-group').textContent = groups.find(g => g.id === a.group)?.name || ''; $('action-description').textContent = a.description; $('action-error').textContent = ''; $('action-json').value = ''; const root = $('action-fields'); root.replaceChildren(); formReaders = a.fields.map(f => { const r = createField(f, preset[f.name]); root.append(r.element); return [f.name, r.read]; });wireFieldConditions(root,a.fields); $('action-impact').textContent = a.effect === 'execute' ? '这会执行所填的本地操作或模型任务。取消将核对实际终态，未知副作用不会重放。' : a.effect === 'write' ? '这会保存所填的项目状态。来源、权限和版本继续由原领域规则核对。' : '按当前来源读取，不把历史记录当作新验收。'; $('action-submit').textContent = a.effect === 'execute' ? '确认运行' : a.effect === 'write' ? '确认保存' : '读取'; $('action-dialog').querySelector('.advanced').open = false; $('action-dialog').showModal(); }
$('action-form').noValidate = true;
$('action-form').onsubmit = async (event) => { event.preventDefault(); try {
    let args = $('action-json').value.trim() ? JSON.parse($('action-json').value) : { ...formPreset, ...Object.fromEntries(formReaders.map(([k, r]) => [k, r()])) };
    if (!args || Array.isArray(args) || typeof args !== 'object')
        throw Error('高级参数必须是对象。');
    const result = await chatApi('/actions', { action: formAction.id, args });
    $('action-dialog').close();
    if (result.accepted) {
        openPanel(formAction.group);
        await refresh();
    }
    else {
        notice(result.answer || '读取完成');
        openPanel(formAction.group);
    }
}
catch (e) {
    $('action-error').textContent = e.message;
} };
$('action-dialog').querySelector('.advanced').addEventListener('toggle', event => { if (event.target.open && !$('action-json').value.trim())
    try {
        $('action-json').value = JSON.stringify({ ...formPreset, ...Object.fromEntries(formReaders.map(([k, r]) => [k, r()])) }, null, 2);
    }
    catch { } });
function openSettings() { if (!state) {
    notice('请先创建或选择对话。');
    return;
} $('appearance-theme').value = appearance.theme || 'light'; $('appearance-glass').checked = appearance.glass !== false; $('appearance-motion').checked = appearance.motion !== false; $('settings-memory').checked = state.memory; $('settings-approval').value = state.approval; $('settings-dialog').showModal(); }
$('settings-form').onsubmit = async (e) => { e.preventDefault(); try {
    if (!state.idle)
        throw Error('请先等待当前任务结束。');
    await chatApi('/settings', { memory: $('settings-memory').checked, approval: $('settings-approval').value });
    appearance = { theme: $('appearance-theme').value, glass: $('appearance-glass').checked, motion: $('appearance-motion').checked };
    localStorage.setItem('enigma-appearance', JSON.stringify(appearance));
    applyAppearance();
    $('settings-dialog').close();
    await refresh();
}
catch (error) {
    notice(error.message, 'error');
} };
$('new-chat').onclick = () => { $('new-model').replaceChildren(); models.forEach(m => { const o = el('option', prettyModel(m) + ' · ' + m.provider); o.value = m.provider + '\n' + m.id; $('new-model').append(o); }); if (state)
    $('new-model').value = state.chat.provider + '\n' + state.chat.model; $('new-dialog').showModal(); };
$('new-form').onsubmit = async (event) => { event.preventDefault(); try {
    const [provider, model] = $('new-model').value.split('\n');
    if (!provider || !model)
        throw Error('请刷新模型目录或配置已有模型。');
    const chat = await api('/chats', { title: $('new-title').value, provider, model });
    chats.push(chat);
    $('new-dialog').close();
    await select(chat.id);
}
catch (e) {
    notice(e.message, 'error');
} };
$('composer').onsubmit = async (e) => { e.preventDefault(); const text = $('prompt').value; if (!text.trim() || !current)
    return; try {
    const request = selectedSkill ? selectedSkill.command + ' ' + text : text;
    await chatApi('/prompt', { text: request });
    $('prompt').value = '';
    selectedSkill = null;
    $('skill-chip').classList.add('hidden');
    await refresh();
}
catch (error) {
    notice(error.message, 'error');
} };
$('prompt').onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    $('composer').requestSubmit();
} };
$('thinking-picker').onchange = async () => { try {
    await chatApi('/settings', { thinking: $('thinking-picker').value });
    await refresh();
}
catch (e) {
    notice(e.message, 'error');
    await refresh();
} };
$('approval-picker').onchange = async () => { try {
    await chatApi('/settings', { approval: $('approval-picker').value });
    await refresh();
} catch (error) { notice(error.message, 'error'); await refresh(); } };
$('model-picker').onclick = () => { $('model-search').value = ''; modelList(); $('model-dialog').showModal(); $('model-search').focus(); };
$('model-search').oninput = modelList;
$('models-refresh').onclick = async () => { const b = $('models-refresh'); b.disabled = true; b.textContent = '正在发现…'; try {
    const result = await api('/models/refresh', {});
    bootstrap = await api('/bootstrap');
    models = bootstrap.models;
    modelList();
    notice('已发现 ' + result.count + ' 个 Gateway 模型。');
}
catch (e) {
    notice(e.message, 'error');
}
finally {
    b.disabled = false;
    b.textContent = '刷新 Gateway 目录';
} };
$('chat-search').oninput = catalog;
$('tools-search').oninput = toolsGrid;
$('tools-launcher').onclick = openTools;
$('composer-tools').onclick = () => openTools(true);
$('tools-all').onclick = () => { toolsContext = false; $('tools-title').textContent = '全部项目工具'; $('tools-description').textContent = '按当前任务、项目内容与知识复用组织。'; $('tools-all').classList.add('hidden'); toolsGrid(); };
$('settings-open').onclick = openSettings;
$('panel-toggle').onclick = () => { if(panelOpen)closePanel();else{const selected=contentTabs.find(t=>t.key===contentKey);selected?activateContent(selected):openPanel(panel);} };
$('panel-expand').onclick = () => {const expanded=$('shell').classList.toggle('content-expanded');$('panel-expand').setAttribute('aria-label',expanded?'收回内容工作区':'展开内容工作区');};
$('panel-close').onclick = closePanel;
$('restore-open').onclick = () => openPanel('timeline');
$('refresh').onclick = refresh;
$('cancel').onclick = () => chatApi('/cancel', {}).then(refresh).catch(e => notice(e.message, 'error'));
$('resume').onclick = () => chatApi('/prompt', { text: '按最新用户要求继续当前任务，先核对实际代码、原检查和未完成事项。' }).then(refresh).catch(e => notice(e.message, 'error'));
$('checkpoint').onclick = () => openAction('checkpoint', { label: '手动检查点' });
$('rename').onclick = () => { if (!state)
    return; const value = prompt('对话名称', state.chat.title); if (value)
    chatApi('/rename', { title: value }).then(refresh).catch(e => notice(e.message, 'error')); };
$('sidebar-toggle').onclick = () => { $('sidebar').classList.add('sidebar-visible'); updateScrim(); };
$('sidebar-close').onclick = () => { $('sidebar').classList.remove('sidebar-visible'); updateScrim(); };
$('drawer-scrim').onclick = () => { closePanel(); $('sidebar').classList.remove('sidebar-visible'); updateScrim(); };
window.addEventListener('resize', updateScrim);
for (const [buttonId, dialogId] of [['new-close', 'new-dialog'], ['new-cancel', 'new-dialog'], ['model-close', 'model-dialog'], ['tools-close', 'tools-dialog'], ['action-close', 'action-dialog'], ['action-cancel', 'action-dialog'], ['settings-close', 'settings-dialog'], ['settings-cancel', 'settings-dialog']])
    $(buttonId).onclick = () => $(dialogId).close();
document.querySelectorAll('[data-panel]').forEach(b => b.onclick = () => openPanel(b.dataset.panel));
document.querySelectorAll('[data-prompt]').forEach(b => b.onclick = () => { $('prompt').value = b.dataset.prompt; $('prompt').focus(); });
document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    $('new-chat').click();
} if (e.key === 'Escape') {
    closePanel();
    $('sidebar').classList.remove('sidebar-visible');
    updateScrim();
} });
document.querySelectorAll('.chat-menu button').forEach(b => b.addEventListener('click', () => b.closest('details').open = false));
$('panel').addEventListener('animationend', () => $('panel').classList.remove('panel-enter'));
$('panel').addEventListener('scroll',()=>{const selected=contentTabs.find(t=>t.key===contentKey);if(selected)selected.scroll=$('panel').scrollTop;},{passive:true});
let glassFrame = 0;
document.addEventListener('pointermove', event => {
    if (appearance.glass === false || appearance.motion === false || matchMedia('(prefers-reduced-motion: reduce)').matches || !matchMedia('(pointer: fine)').matches) return;
    const target = event.target.closest?.('.glass');
    if (!target || glassFrame) return;
    glassFrame = requestAnimationFrame(() => { const rect = target.getBoundingClientRect(); target.style.setProperty('--shine-x', ((event.clientX - rect.left) / rect.width * 100).toFixed(1) + '%'); target.style.setProperty('--shine-y', ((event.clientY - rect.top) / rect.height * 100).toFixed(1) + '%'); glassFrame = 0; });
}, {passive:true});
api('/bootstrap').then(async (data) => { bootstrap = data; chats = data.chats; models = data.models; actions = data.actions; $('workspace-root').textContent = data.root; $('workspace-name').textContent = data.root.split('/').filter(Boolean).at(-1) || '项目工作空间'; $('workspace-summary').textContent = data.repos.length + ' 个仓库 · 项目设置'; $('action-count').textContent = actions.length; $('project-label').textContent = data.repos.length + ' 个仓库'; $('connection').textContent = '已连接'; $('connection-dot').classList.add('connected'); catalog(); if (chats.length)
    await select(chats.at(-1).id); }).catch(e => { $('connection').textContent = '未连接'; notice(e.message, 'error'); });
`;

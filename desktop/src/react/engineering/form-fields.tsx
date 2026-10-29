import {useState,useEffect,useRef} from 'react';
import type {Field} from './state';

export function enumLabel(value:string):string {
  if(value==='outline')return '仅目录';if(value==='full')return '完整正文';
  if(['explanation','risk','supported','conflict','insufficient'].includes(value))return ({explanation:'解释',risk:'风险',supported:'源码支持',conflict:'发现不符',insufficient:'依据不足'} as Record<string,string>)[value];
  return ({working:'当前未提交修改',staged:'已暂存修改',commit:'某次提交','merge-request':'MR / PR 链接',source:'源码依据','user-decision':'用户决定',inference:'推断',unverified:'尚未验证',read:'只读',write:'可写',pending:'待开始',running:'进行中',failed:'失败',verified:'已验收',command:'运行命令',service:'项目服务',browser:'浏览器步骤',verify:'验收检查',background:'后台任务',delegation:'委派子任务',github:'GitHub Actions 运行',ready:'服务已就绪',stopped:'服务已停止',continue:'继续原任务',alternative:'尝试替代方案',convention:'约定',contract:'接口契约',decision:'决策',troubleshooting:'排障经验',preference:'偏好',research:'研究资料',project:'整个项目',task:'当前任务',repositories:'指定仓库',click:'点击',fill:'填入文本',expect:'检查文本',screenshot:'保存截图',goto:'打开页面',wait:'等待元素',check:'勾选',uncheck:'取消勾选',select:'选择选项',press:'按键',http:'HTTP 响应',log:'日志内容',tcp:'端口可连接',start:'启动',stop:'停止',keyword:'关键词范围',section:'指定区块',range:'区块范围',document:'整份文档'} as Record<string,string>)[value]||value;
}

/** The same values drive visible controls, conditional fields and submission.
 * Object controls are always rendered; rows are created only by the user. */
export function resolveFieldValues(fields:Field[],values:Record<string,unknown>={}):Record<string,unknown> {
  const resolved={...values};
  for(const field of fields){
    const value=values[field.name]??field.value;
    if(field.kind==='object')resolved[field.name]=resolveFieldValues(field.fields||[],value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{});
    else if(field.kind==='rows'&&Array.isArray(value))resolved[field.name]=value.map(row=>resolveFieldValues(field.fields||[],row));
    else if(value!==undefined)resolved[field.name]=value;
  }
  return resolved;
}
export function validateFields(fields:Field[],values:Record<string,unknown>,prefix=''):string|undefined {
  values=resolveFieldValues(fields,values);
  for(const field of fields){
    if(field.when&&!field.when.values.includes(String(values[field.when.field])))continue;
    const value=values[field.name]??field.value,name=prefix+field.label;
    if(field.required&&(value==null||typeof value==='string'&&!value.trim()||Array.isArray(value)&&!value.length))return `请填写或选择「${name}」`;
    if(field.kind==='number'&&value!=null&&!Number.isFinite(value))return `「${name}」需要有效数字`;
    if(field.kind==='identifier'&&value!=null&&value!==''&&(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(value)||['__proto__','constructor','prototype'].includes(value)))return `「${name}」请用 1–101 位英文字母、数字、点、短横线或下划线，并以字母或数字开头，例如 api-check`;
    if(field.kind==='pairs'&&value&&typeof value==='object'&&Object.entries(value).some(([key,item])=>!key.trim()||typeof item!=='string'||!item.trim()))return `「${name}」请按每行 名称=值 填写`;
    if(field.kind==='rows'&&Array.isArray(value))for(let index=0;index<value.length;index++){const error=validateFields(field.fields||[],value[index],`${name}第 ${index+1} 项 · `);if(error)return error;}
    if(field.kind==='object'&&value&&typeof value==='object'){const error=validateFields(field.fields||[],value as Record<string,unknown>,name+' · ');if(error)return error;}
  }
}

/** Changing a condition hides and omits the old value, instead of silently
 * submitting stale controls that the user can no longer review. */
export function activeFieldValues(fields:Field[],values:Record<string,unknown>):Record<string,unknown> {
  const result:Record<string,unknown>={};
  const resolved=resolveFieldValues(fields,values);
  for(const field of fields){
    if(field.when&&!field.when.values.includes(String(resolved[field.when.field])))continue;
    const value=resolved[field.name];if(value===undefined)continue;
    result[field.name]=field.kind==='rows'&&Array.isArray(value)?value.map(item=>activeFieldValues(field.fields||[],item)):field.kind==='object'&&value&&typeof value==='object'?activeFieldValues(field.fields||[],value as Record<string,unknown>):value;
  }
  return result;
}
export function MultiChoice({label,options,value,change}:{label:string;options:{value:string;label:string}[];value:string[];change:(value:string[])=>void}){
  const [query,setQuery]=useState('');
  const visible=options.filter(option=>option.label.toLowerCase().includes(query.toLowerCase()));
  return <fieldset className="enigma-multi-choice"><legend>{label} · 已选 {value.length}</legend>
    {options.length>6&&<input type="search" aria-label={`筛选${label}`} placeholder="筛选选项" value={query} onChange={e=>setQuery(e.target.value)}/>}
    <div>{visible.map(option=><label key={option.value}><input type="checkbox" checked={value.includes(option.value)} onChange={e=>change(e.target.checked?[...value,option.value]:value.filter(id=>id!==option.value))}/><span>{option.label}</span></label>)}{!visible.length&&<p>{options.length?'没有匹配项':'暂无可选记录，请先创建相关内容'}</p>}</div>
  </fieldset>;
}

/** Keep the user's editing buffer intact. Parsing into arrays/maps must not
 * remove Enter, move the caret, or insert '=' while a value is being typed. */
export function StructuredTextInput({label,kind,value,required,change}:{label:string;kind:'lines'|'pairs';value:unknown;required?:boolean;change:(value:unknown)=>void}){
  const format=(input:unknown)=>kind==='lines'?(Array.isArray(input)?input.join('\n'):''):Object.entries(input&&typeof input==='object'?input:{}).map(([key,value])=>`${key}=${value}`).join('\n');
  const [text,setText]=useState(()=>format(value)),last=useRef(value),input=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{if(value!==last.current){last.current=value;setText(format(value));}},[value,kind]);
  const entries=text.split('\n').filter(line=>line.length>0),keys=new Set<string>();let error='';
  if(kind==='pairs')for(const line of entries){const equals=line.indexOf('=');const key=equals<0?line:line.slice(0,equals);if(equals<1){error='请按每行 名称=值 填写';break;}if(keys.has(key)){error=`「${key}」重复，请只保留一个值`;break;}keys.add(key);}
  useEffect(()=>{input.current?.setCustomValidity(error);},[error]);
  const update=(raw:string)=>{
    setText(raw);const lines=raw.split('\n').filter(Boolean);
    const parsed=kind==='lines'?lines:Object.fromEntries(lines.map(line=>{const equals=line.indexOf('=');return equals<0?[line,'']:[line.slice(0,equals),line.slice(equals+1)];}));
    last.current=parsed;change(parsed);
  };
  return <><textarea ref={input} aria-label={label} aria-invalid={!!error||undefined} required={required} rows={3} value={text} onChange={event=>update(event.target.value)}/>{error&&<small className="enigma-source-note">{error}</small>}</>;
}

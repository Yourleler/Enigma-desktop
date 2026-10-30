import type { AppIconName } from '../ui/app-icons';

const tools: Record<string,{label:string;icon:AppIconName}> = {
  read:{label:'读取文件',icon:'read'},write:{label:'写入文件',icon:'file'},edit:{label:'修改文件',icon:'file'},
  bash:{label:'运行命令',icon:'command'},exec_command:{label:'运行命令',icon:'command'},terminal:{label:'终端操作',icon:'command'},write_stdin:{label:'读取命令进展',icon:'command'},
  grep:{label:'搜索代码',icon:'read'},find:{label:'查找文件',icon:'read'},ls:{label:'查看目录',icon:'project'},
  browser:{label:'操作浏览器',icon:'link'},computer:{label:'操作电脑',icon:'monitor'},
  web_search:{label:'搜索网页',icon:'read'},web_fetch:{label:'读取网页',icon:'link'},
};
export function toolPresentation(name:string,fallback:string){return tools[name]||{label:fallback.replace(/^[^\p{L}\p{N}]+/u,'').trim(),icon:'activity' as AppIconName};}

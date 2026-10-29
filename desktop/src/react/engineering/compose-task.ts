import {useStore} from '../stores';
import {sessionScopedValue} from '../stores/session-slice';
import { useEngineering, rememberEngineeringView } from './state';

/** Prepare an editable user request. Preserve existing rich composer atoms and
 * text; entering a suggestion never starts the agent or changes permissions. */
export function composeTaskRequest(text:string) {
  const state=useStore.getState(),path=state.currentSessionPath;
  if(!path){state.addToast('请先打开工作对话','info');return;}
  const oldText=sessionScopedValue(state,state.drafts,path)||'';
  const oldDoc=sessionScopedValue(state,state.draftDocs,path);
  const alreadyIncluded=oldText.includes(text);
  const next=oldText.trim()?`${oldText}\n\n${text}`:text;
  const additions=text.split('\n').map(line=>({type:'paragraph',...(line?{content:[{type:'text',text:line}]}:{})}));
  const doc=oldDoc?.content?{...oldDoc,content:[...oldDoc.content,{type:'paragraph'},...additions]}:undefined;
  if(!alreadyIncluded)state.setDraft(path,next,doc);
  if(window.innerWidth<861&&useEngineering.getState().paneOpen){
    useEngineering.setState({paneOpen:false});useStore.setState({jianOpen:false,jianAutoCollapsed:false});rememberEngineeringView();
  }
  state.addToast(alreadyIncluded?'这条请求已在输入框中，可继续编辑':'已加入输入框，确认后发送','info',2500);
  requestAnimationFrame(()=>{const current=useStore.getState();if(current.currentSessionPath===path&&current.activeServerConnectionId===state.activeServerConnectionId)document.getElementById('inputBox')?.focus();});
}
export const assistedOperations=[
  {id:'requirements',title:'逐项核对原要求',group:'acceptance',description:'让助手把原要求、处理说明与当前证据对账，不能只凭自述标记完成。',prompt:'请使用 task_acceptance 检查当前任务的原要求、假设、计划和实际证据。逐项指出已完成、未完成和需要重新验证的内容；没有当前证据不要标记完成。'},
  {id:'context-rewind',title:'调整走偏的思路',group:'timeline',description:'让助手判断是否需要时光机纠偏，保留最新要求、当前文件和失败经验。',prompt:'请检查当前路线是否走偏，或在重复无效尝试。必要时使用时光机回到仍有效的对话位置，记录失败经验与下一步后继续；保留所有最新用户要求和当前文件，重新核对尚未通过的检查。'},
  {id:'document-write',title:'编写并验证工程文档',group:'documents',description:'让助手基于源码写文档、登记依据，并实际验证文档中的例子。',prompt:'请基于当前任务与实际源码编写或更新必要的工程文档，区分源码事实、用户决定和推断。使用 document_work 登记需核对的声明与源码锚点，并运行可执行示例；不编造设计动机。'},
  {id:'conductor-plan',title:'安排多个工作对话',group:'conductor',description:'在任务编排管家中交代目标和限制，让它安排项目、依赖、模型与验证。',prompt:'请在现有授权范围内核对目标，将可独立完成的工作安排到有依赖关系的工作对话中；根据任务选择模型与职责，持续观察实际进度。先预览成果再选择整合，最终按原要求与联合检查验收。'},
];

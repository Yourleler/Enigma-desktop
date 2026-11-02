import {useStore} from '../../stores';
import {ActivityPanel} from '../ActivityPanel';
import {AutomationPanel} from '../AutomationPanel';
import {BridgePanel} from '../BridgePanel';
import {SkillsPanel} from '../SkillsPanel';
import {ConductorPage} from '../../engineering/ConductorPage';
import './PrimaryPages.css';
export const primaryTitles:Record<string,string>={activity:'运行记录',automation:'任务计划',bridge:'消息连接',skills:'技能',conductor:'任务管家'};
export function PrimaryPages(){
 const page=useStore(s=>s.activePanel);
 if(!page)return null;
 return <main data-native-browser-occluder="" className="enigma-primary-page" aria-label={primaryTitles[page]}><ActivityPanel embedded/><AutomationPanel embedded/><BridgePanel embedded/><SkillsPanel embedded/>{page==='conductor'&&<ConductorPage/>}</main>;
}

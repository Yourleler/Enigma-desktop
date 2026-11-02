import {RepositoryContextBar} from '../chat/RepositoryContext';
import './ConversationHeader.css';
import {ProjectContextBar} from '../chat/ProjectContextBar';
import { SessionClock } from '../chat/SessionClock';
import { EngineeringToolbar } from '../../engineering/Engineering';
import { useStore } from '../../stores';
import { InputArea, type InputAreaProps } from '../InputArea';
import { WelcomeScreen } from '../WelcomeScreen';
import { ChatArea } from '../chat/ChatArea';
import { RegionalErrorBoundary } from '../RegionalErrorBoundary';
import {HeaderSlot} from './HeaderSlot';

function WelcomeContainer() {
  const visible = useStore(s => s.welcomeVisible);
  return (
    <div className={`welcome${visible ? '' : ' hidden'}`} id="welcome">
      <WelcomeScreen />
    </div>
  );
}

export function ChatPage({
  inputSurface = 'desktop',
  regionPrefix = '',
}: {
  inputSurface?: NonNullable<InputAreaProps['surface']>;
  regionPrefix?: string;
} = {}) {
  const welcomeVisible = useStore(s => s.welcomeVisible);
  const currentSessionPath = useStore(s => s.currentSessionPath);
  const hasPanels = !welcomeVisible && !!currentSessionPath;

  return (
    <>
      <HeaderSlot id="enigma-titlebar-chat-tools"><div className="enigma-conversation-header">
        {!currentSessionPath&&<ProjectContextBar compact/>}
        <EngineeringToolbar compact/>
        <SessionClock compact inline/>
      </div></HeaderSlot>
      <div className={welcomeVisible?"enigma-new-conversation":undefined} style={welcomeVisible?undefined:{display:"contents"}}>
      <div className={`chat-area${hasPanels ? ' has-panels' : ''}`}>
        <WelcomeContainer />
        <RegionalErrorBoundary region={`${regionPrefix}chat`} resetKeys={[currentSessionPath]}>
          <ChatArea />
        </RegionalErrorBoundary>
      </div>
      <div className="input-area">
        <RegionalErrorBoundary
          region={`${regionPrefix}input`}
          resetKeys={[currentSessionPath]}
          autoRetry={inputSurface === 'mobile' ? { attempts: 2, delayMs: 120 } : undefined}
        >
          <InputArea key={currentSessionPath || '__new'} surface={inputSurface} />
          {welcomeVisible&&<div className="enigma-composer-repositories"><RepositoryContextBar/></div>}
        </RegionalErrorBoundary>
      </div>
      </div>
    </>
  );
}

import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { AppTitlebar } from '../components/app/AppTitlebar';
import { ChatPage } from '../components/app/ChatPage';
import { ChatSidebar,AppNavigationRail } from '../components/app/ChatSidebar';
import { MainContent } from '../MainContent';
import { StatusBar } from '../components/StatusBar';
import { ToastContainer } from '../components/ToastContainer';
import { SidebarLayout, toggleSidebar } from '../components/SidebarLayout';
import { useSidebarResize } from '../hooks/use-sidebar-resize';
import { InteractionHints } from '../ui/InteractionHints';
import { toggleJianSidebar } from '../stores/desk-actions';
import { togglePreviewPanel } from '../stores/preview-actions';
import { openSettingsModal } from '../stores/settings-modal-actions';
import { useStore } from '../stores';
import { createNewSession, reconcileCurrentSessionMessages } from '../stores/session-actions';
import {useEngineering} from '../engineering/state';
import { exchangeLocalWorkbenchCredential } from './local-workbench-login';
import enigmaAvatar from '../../assets/enigma/avatar.png';
import {
  initializeMobileRuntime,
  loadMobileSessions,
  readMobileAuthSession,
  type MobilePrincipal,
} from './mobile-init';

type AuthState = 'checking' | 'login' | 'ready';
const MOBILE_REQUIRED_SCOPES = Object.freeze(['chat', 'resources.read', 'files.read', 'files.write']);
const MOBILE_EDGE_GESTURE_WIDTH = 28;
const MOBILE_EDGE_GESTURE_MIN_DISTANCE = 56;
const MOBILE_EDGE_GESTURE_MAX_VERTICAL_DRIFT = 80;
const MOBILE_EDGE_GESTURE_DOMINANCE = 1.25;
const MOBILE_UPDATE_AVAILABLE_EVENT = 'hana-mobile-update-available';
const MOBILE_APPLY_UPDATE_EVENT = 'hana-mobile-apply-update';
const DEFAULT_MOBILE_AUTH_LOCALE = 'zh-CN';

const LazyMediaViewer = lazy(() => import('../components/shared/MediaViewer/MediaViewer').then(module => ({ default: module.MediaViewer })));
const LazyWorkspaceCompanionRail = lazy(() => import('../components/app/WorkspaceCompanionRail').then(module => ({ default: module.WorkspaceCompanionRail })));
const LazySettingsModalShell = lazy(() => import('../components/SettingsModalShell').then(module => ({ default: module.SettingsModalShell })));

let mobileAuthLocaleLoad: {
  i18n: typeof window.i18n;
  promise: Promise<void>;
} | null = null;

type MobileEdgeGesture = {
  edge: 'left' | 'right';
  startX: number;
  startY: number;
  cancelled: boolean;
};

export function MobileApp(): React.ReactElement {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [principal, setPrincipal] = useState<MobilePrincipal | null>(null);
  const [loginSecret, setLoginSecret] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [mobileUpdateAvailable, setMobileUpdateAvailable] = useState(() => window.__hanaMobileUpdateAvailable === true);

  const bootstrap = useCallback(async () => {
    try{await exchangeLocalWorkbenchCredential();}catch(error){if(!isLocalWorkbenchUrl())throw error;}
    await ensureMobileAuthLocale();
    let session = await readMobileAuthSession();
    if ((!session.authenticated || !session.principal) && isLocalWorkbenchUrl()) {
      await apiJson('/api/web-auth/local-session',{method:'POST',headers:{'X-Enigma-Local-Open':'1'}});
      session=await readMobileAuthSession();
    }
    if (!session.authenticated || !session.principal) {
      setAuthState('login');
      return;
    }
    if (!principalHasRequiredScopes(session.principal, MOBILE_REQUIRED_SCOPES)) {
      await apiJson('/api/web-auth/logout', { method: 'POST' }).catch(() => null);
      setPrincipal(null);
      setLoginError((window.t ?? ((p: string) => p))('mobile.auth.scopeError'));
      setAuthState('login');
      return;
    }
    await initializeMobileRuntime(session.principal);
    setPrincipal(session.principal);
    setAuthState('ready');
  }, []);

  useEffect(() => {
    let cancelled = false;
    bootstrap().catch((err) => {
      console.warn('[mobile] bootstrap failed', err);
      if (!cancelled) setAuthState('login');
    });
    return () => {
      cancelled = true;
    };
  }, [bootstrap]);

  useEffect(() => {
    const handleUpdateAvailable = () => {
      window.__hanaMobileUpdateAvailable = true;
      setMobileUpdateAvailable(true);
    };
    if (window.__hanaMobileUpdateAvailable === true) setMobileUpdateAvailable(true);
    window.addEventListener(MOBILE_UPDATE_AVAILABLE_EVENT, handleUpdateAvailable);
    return () => window.removeEventListener(MOBILE_UPDATE_AVAILABLE_EVENT, handleUpdateAvailable);
  }, []);

  const applyMobileUpdate = useCallback(() => {
    window.dispatchEvent(new Event(MOBILE_APPLY_UPDATE_EVENT));
  }, []);

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginError(null);
    try {
      const body = { credential: loginSecret.trim() };
      await apiJson('/api/web-auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setLoginSecret('');
      await bootstrap();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : (window.t ?? ((p: string) => p))('mobile.auth.loginFailed'));
    }
  };

  if (authState === 'checking') {
    return <MobileLoadingScreen />;
  }

  if (authState === 'login') {
    if(isLocalWorkbenchUrl())return <main className="onboarding"><section className="onboarding-step active"><img className="onboarding-avatar" src={enigmaAvatar} alt=""/><h1 className="onboarding-title">连接本机工作台</h1><p className="onboarding-subtitle">本机服务暂时未连接，请确认 Enigma 已启动后重试。</p><button className="ob-btn ob-btn-primary" onClick={()=>{setAuthState('checking');void bootstrap().catch(()=>setAuthState('login'));}}>重新连接</button></section></main>;
    return (
      <MobileLoginScreen
        secret={loginSecret}
        error={loginError}
        onSecretChange={setLoginSecret}
        onSubmit={login}
      />
    );
  }

  return (
    <ErrorBoundary region="mobile">
      <InteractionHints />
      <MobileDesktopShell
        principal={principal}
        mobileUpdateAvailable={mobileUpdateAvailable}
        onApplyMobileUpdate={applyMobileUpdate}
      />
    </ErrorBoundary>
  );
}

function MobileDesktopShell({
  principal,
  mobileUpdateAvailable,
  onApplyMobileUpdate,
}: {
  principal: MobilePrincipal | null;
  mobileUpdateAvailable: boolean;
  onApplyMobileUpdate: () => void;
}) {
  useSidebarResize();
  const previewExpanded = useStore(s => s.previewExpanded);
  const layoutDrawer = useStore(s => s.layoutDrawer);
  const settingsAvailable=!!principal&&principalHasRequiredScopes(principal,['settings.read']);
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const jianOpen = useStore(s => s.jianOpen);
  const previewOpen = useStore(s => s.previewOpen);
  const mediaViewer = useStore(s => s.mediaViewer);
  const currentTab = useStore(s => s.currentTab);
  const sessions = useStore(s => s.sessions);
  const currentSessionPath = useStore(s => s.currentSessionPath);
  const pendingNewSession = useStore(s => s.pendingNewSession);
  const wsState = useStore(s => s.wsState);
  const isNarrow = useNarrowMobileViewport();
  const engineeringPane=useEngineering(state=>!!state.snapshot?.connected&&state.paneOpen&&!!state.active);
  const edgeGestureRef = useRef<MobileEdgeGesture | null>(null);
  const previousWsStateRef = useRef(wsState);
  const t = window.t ?? ((p: string) => p);

  const titlebarTitle = useMemo(() => {
    if (pendingNewSession) return t('sidebar.newChat');
    const currentSession = sessions.find(session => session.path === currentSessionPath);
    return currentSession?.title || currentSession?.firstMessage || t('session.untitled');
  }, [currentSessionPath, pendingNewSession, sessions, t]);

  useEffect(() => {
    useStore.setState({ currentTab: 'chat' });
  }, []);


  useEffect(() => {
    const unsubscribe = window.platform?.onOpenSettingsModal?.((tab?: string) => {
      openSettingsModal(tab);
    });
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, []);

  useEffect(()=>{
    if(!settingsAvailable)return;
    const onKey=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key===','){event.preventDefault();openSettingsModal();}};
    document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey);
  },[settingsAvailable]);

  const refreshMobileSessions = useCallback(() => {
    void loadMobileSessions()
      .then(() => {
        // 列表已新鲜：校验当前打开会话的修订点，补拉后台窗口
        // （锁屏 / WS 断连期间 Bridge /rc 等）漏掉的消息（issue #1610）。
        void reconcileCurrentSessionMessages('mobile_foreground_refresh');
      })
      .catch((err) => {
        console.warn('[mobile] refresh sessions failed', err);
      });
  }, []);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'hidden') return;
      refreshMobileSessions();
    };
    window.addEventListener('focus', refreshWhenVisible);
    window.addEventListener('online', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      window.removeEventListener('online', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refreshMobileSessions]);

  useEffect(() => {
    const previous = previousWsStateRef.current;
    previousWsStateRef.current = wsState;
    if (wsState === 'connected' && previous && previous !== 'connected') {
      refreshMobileSessions();
    }
  }, [refreshMobileSessions, wsState]);

  const openMobileDrawerFromGesture = useCallback((edge: MobileEdgeGesture['edge']) => {
    if (edge === 'left') {
      toggleSidebar(true);
      return;
    }
    toggleJianSidebar(true);
  }, []);

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLElement>) => {
    edgeGestureRef.current = null;
    if (!isNarrow || sidebarOpen || jianOpen || event.touches.length !== 1) return;
    if (shouldIgnoreMobileEdgeGestureTarget(event.target)) return;

    const touch = event.touches[0];
    const width = window.innerWidth || document.documentElement.clientWidth;
    if (touch.clientX <= MOBILE_EDGE_GESTURE_WIDTH) {
      edgeGestureRef.current = {
        edge: 'left',
        startX: touch.clientX,
        startY: touch.clientY,
        cancelled: false,
      };
      return;
    }
    if (touch.clientX >= width - MOBILE_EDGE_GESTURE_WIDTH) {
      edgeGestureRef.current = {
        edge: 'right',
        startX: touch.clientX,
        startY: touch.clientY,
        cancelled: false,
      };
    }
  }, [isNarrow, jianOpen, sidebarOpen]);

  const handleTouchMove = useCallback((event: React.TouchEvent<HTMLElement>) => {
    const gesture = edgeGestureRef.current;
    if (!gesture || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const dx = touch.clientX - gesture.startX;
    const dy = touch.clientY - gesture.startY;
    const horizontalDistance = gesture.edge === 'left' ? dx : -dx;
    const verticalDistance = Math.abs(dy);

    if (verticalDistance > 18 && verticalDistance > Math.abs(dx)) {
      gesture.cancelled = true;
      return;
    }
    if (horizontalDistance > 12 && horizontalDistance > verticalDistance * MOBILE_EDGE_GESTURE_DOMINANCE) {
      event.preventDefault();
    }
  }, []);

  const handleTouchEnd = useCallback((event: React.TouchEvent<HTMLElement>) => {
    const gesture = edgeGestureRef.current;
    edgeGestureRef.current = null;
    if (!gesture || gesture.cancelled) return;
    const touch = event.changedTouches[0];
    if (!touch) return;

    const dx = touch.clientX - gesture.startX;
    const dy = touch.clientY - gesture.startY;
    const horizontalDistance = gesture.edge === 'left' ? dx : -dx;
    const verticalDistance = Math.abs(dy);
    const isDrawerSwipe = horizontalDistance >= MOBILE_EDGE_GESTURE_MIN_DISTANCE
      && verticalDistance <= MOBILE_EDGE_GESTURE_MAX_VERTICAL_DRIFT
      && horizontalDistance > verticalDistance * MOBILE_EDGE_GESTURE_DOMINANCE;
    if (!isDrawerSwipe) return;
    openMobileDrawerFromGesture(gesture.edge);
  }, [openMobileDrawerFromGesture]);

  return (
    <main
      className="mobile-desktop-root"
      data-mobile-principal={principal?.credentialKind || 'session'}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => { edgeGestureRef.current = null; }}
    >
      <SidebarLayout restorePreference={false}/>
      <AppTitlebar
        sidebarOpen={sidebarOpen}
        jianOpen={jianOpen}
        previewOpen={previewOpen}
        showPreviewToggle
        showNewSessionButton
        showChannelTabs={false}
        showWidgetButtons={false}
        centerTitle={titlebarTitle}
        onNewSession={() => void createNewSession()}
        onToggleSidebar={() => {
          toggleSidebar(!sidebarOpen);
        }}
        onToggleJian={() => {
          toggleJianSidebar(!jianOpen);
        }}
        onTogglePreview={() => {
          togglePreviewPanel();
        }}
      />
      {mobileUpdateAvailable && (
        <div className="mobile-update-banner" role="status">
          <span>{t('mobile.update.available')}</span>
          <button type="button" onClick={onApplyMobileUpdate}>{t('mobile.update.reload')}</button>
        </div>
      )}
      <div className="app mobile-desktop-app" data-preview-expanded={previewExpanded || undefined} data-layout-drawer={layoutDrawer || undefined}>
        <AppNavigationRail showActivityBars={false} showSettingsButton={settingsAvailable} onOpenSettings={()=>openSettingsModal()}/>
        <div className="enigma-workspace-frame">
        <ChatSidebar
          showNavigationRail={false}
          open={sidebarOpen && currentTab === 'chat'}
          includeChannels={false}
          showSettingsButton={settingsAvailable}
          onOpenSettings={()=>openSettingsModal()}
          showActivityBars={false}
          onNewSession={() => void createNewSession()}
          onCollapse={() => toggleSidebar(false)}
          region="mobile-sidebar"
        />
        <MainContent>
          <ChatPage inputSurface="mobile" regionPrefix="mobile-" />
        </MainContent>
        {(
          <Suspense fallback={<WorkspaceCompanionRailFallback open={jianOpen} />}>
            <LazyWorkspaceCompanionRail />
          </Suspense>
        )}
        </div>
      </div>
      <StatusBar />
      <Suspense fallback={null}>
        <LazySettingsModalShell />
      </Suspense>
      {mediaViewer && (
        <Suspense fallback={null}>
          <LazyMediaViewer />
        </Suspense>
      )}
      <ToastContainer />
    </main>
  );
}

function WorkspaceCompanionRailFallback({ open }: { open: boolean }) {
  return (
    <aside className={`jian-sidebar${open ? '' : ' collapsed'}`} id="jianSidebar" data-mobile-workspace-loading="">
      <div className="resize-handle resize-handle-left" id="jianResizeHandle"></div>
      <div className="jian-sidebar-inner"></div>
    </aside>
  );
}

function MobileLoadingScreen() {
  const t = window.t ?? ((p: string) => p);
  return (
    <main className="onboarding">
      <section className="onboarding-step active">
        <img className="onboarding-avatar" src={window.location.pathname.startsWith('/desktop') ? enigmaAvatar : './icon.png'} alt="" />
        <h1 className="onboarding-title">Enigma</h1>
        <p className="onboarding-subtitle">{t('mobile.loading')}</p>
      </section>
    </main>
  );
}

function isLocalWorkbenchUrl(){return ['127.0.0.1','localhost','[::1]'].includes(window.location.hostname);}

function MobileLoginScreen({secret,error,onSecretChange,onSubmit}:{secret:string;error:string|null;onSecretChange:(value:string)=>void;onSubmit:(event:React.FormEvent)=>void}){
  return <main className="onboarding"><form className="onboarding-step active" onSubmit={onSubmit}>
    <img className="onboarding-avatar" src={enigmaAvatar} alt=""/>
    <h1 className="onboarding-title">连接 Enigma</h1>
    <p className="onboarding-subtitle">这是另一台电脑上的工作台。请使用该电脑在“访问与设备”中生成的配对密钥。</p>
    <label className="custom-field"><span className="ob-field-label">配对密钥</span><input className="ob-input" value={secret} onChange={event=>onSecretChange(event.target.value)} autoComplete="one-time-code" spellCheck={false}/></label>
    {error&&<div className="ob-status error" role="alert">{error}</div>}
    <div className="onboarding-actions"><button className="ob-btn ob-btn-primary" type="submit" disabled={!secret.trim()}>连接工作台</button></div>
  </form></main>;
}

function closeMobileDrawers() {
  useStore.setState({ sidebarOpen: false, jianOpen: false });
}

function shouldIgnoreMobileEdgeGestureTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"], [data-mobile-gesture-ignore="true"]'));
}

function principalHasRequiredScopes(principal: MobilePrincipal, requiredScopes: readonly string[]): boolean {
  const scopes = Array.isArray(principal.scopes) ? principal.scopes : [];
  if (principal.kind === 'local_user' && principal.credentialKind === 'loopback_token' && principal.connectionKind === 'local' && principal.trustState === 'local') return true;
  return requiredScopes.every((scope) => scopeAllows(scopes, scope));
}

function scopeAllows(scopes: string[], required: string): boolean {
  if (scopes.includes(required)) return true;
  const [namespace] = required.split('.');
  return scopes.includes(namespace) || scopes.includes(`${namespace}.*`);
}

function ensureMobileAuthLocale(): Promise<void> {
  const i18n = window.i18n;
  if (!i18n?.load) return Promise.resolve();
  if (mobileAuthLocaleLoad?.i18n === i18n) return mobileAuthLocaleLoad.promise;

  const promise = i18n.load(resolveInitialMobileAuthLocale())
    .catch((err) => {
      if (mobileAuthLocaleLoad?.i18n === i18n) mobileAuthLocaleLoad = null;
      console.warn('[mobile] initial auth locale load failed', err);
    })
    .then(() => {
      if (window.i18n?.locale) {
        useStore.setState({ locale: window.i18n.locale });
      }
    });
  mobileAuthLocaleLoad = { i18n, promise };
  return promise;
}

function resolveInitialMobileAuthLocale(): string {
  const htmlLocale = document.documentElement.lang.trim();
  return htmlLocale || DEFAULT_MOBILE_AUTH_LOCALE;
}

function useNarrowMobileViewport(): boolean {
  const [isNarrow, setIsNarrow] = useState(() => {
    if (typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(max-width: 860px)').matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(max-width: 860px)');
    const apply = () => setIsNarrow(media.matches);
    apply();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
    media.addListener(apply);
    return () => media.removeListener(apply);
  }, []);

  return isNarrow;
}

async function apiJson<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      detail = data.detail || data.error || detail;
    } catch {}
    throw new Error(detail);
  }
  return await res.json() as T;
}

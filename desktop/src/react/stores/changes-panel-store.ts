import { create } from 'zustand';
export interface ChangeNavigation {session:string;connection:string;revision:number;from?:string;to?:string;repo?:string;file?:string;view:'diff'|'review'}
export const useChangesPanel = create<{ session: string; connection: string; open: boolean; navigation?:ChangeNavigation }>(() => ({ session: '', connection: '', open: false }));

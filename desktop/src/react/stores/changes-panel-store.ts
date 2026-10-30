import { create } from 'zustand';
export const useChangesPanel = create<{ session: string; connection: string; open: boolean }>(() => ({ session: '', connection: '', open: false }));

import type { Activity } from '../types';

export interface ActivitySlice {
  activities: Activity[];
  activityFocusTarget: { id: string; agentId: string; revision: number; connectionKey: string } | null;
  setActivities: (activities: Activity[]) => void;
}

export const createActivitySlice = (
  set: (partial: Partial<ActivitySlice>) => void
): ActivitySlice => ({
  activities: [],
  activityFocusTarget: null,
  setActivities: (activities) => set({ activities }),
});

// ── Selectors ──
export const selectActivities = (s: ActivitySlice) => s.activities;

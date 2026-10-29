import { describe, expect, it } from "vitest";
import {
  getWorkspaceUiStateEntry,
  normalizeWorkspaceUiEntry,
  normalizeWorkspaceUiState,
  upsertWorkspaceUiState,
} from "../shared/workspace-ui-state.ts";

describe("workspace UI state", () => {
  it('retains browser owners and remote media while stripping transient tokens and inline data', () => {
    const state = normalizeWorkspaceUiEntry({openTabs: ['browser', 'doc', 'image'], activeTabId: 'image', previewTabs: [
      {id: 'browser', type: 'browser', browserSessionPath: '/new/session.jsonl', content: 'do not store'},
      {id: 'doc', type: 'markdown', remoteContentRef: {kind: 'workbench-file', mountId: 'test', subdir: 'docs', name: 'readme.md', contentPath: 'https://unrelated.invalid/?token=secret'}},
      {id: 'image', type: 'media', mediaRef: {id: 'img', kind: 'image', name: 'new.png', inlineData: {base64: 'private'}, resource: {resourceId: 'r1', studioId: 's1', links: {content: '/api/resources/r1/content?token=secret&ticket=stale'}}}},
    ]});
    expect(state.openTabs).toEqual(['browser', 'doc', 'image']);
    expect(state.activeTabId).toBe('image');
    expect(JSON.stringify(state)).not.toMatch(/secret|private|unrelated.invalid/);
    expect(state.previewTabs[1].remoteContentRef?.contentPath).toBe('/api/workbench/content?mountId=test&subdir=docs&name=readme.md');
    expect(state.previewTabs[2].mediaRef?.resource.links.content).toBe('/api/resources/r1/content');
  });

  it('rejects invalid remote file references instead of fetching a saved arbitrary URL', () => {
    const state = normalizeWorkspaceUiEntry({previewTabs: [
      {id: 'escape', type: 'markdown', remoteContentRef: {kind: 'workbench-file', mountId: 'm', subdir: '../outside', name: 'private.md'}},
      {id: 'external', type: 'media', mediaRef: {id: 'x', kind: 'image', name: 'x', resource: {links: {content: 'https://invalid.example/file'}}}},
    ]});
    expect(state.previewTabs).toEqual([]);
  });
  it("keeps desktop and mobile workspace state in separate surface buckets", () => {
    let state = upsertWorkspaceUiState({}, "/repo", {
      deskExpandedPaths: ["desktop"],
      deskSelectedPath: "desktop/a.md",
    }, { surface: "electron", now: () => 10 });

    state = upsertWorkspaceUiState(state, "/repo", {
      deskExpandedPaths: ["mobile"],
      deskSelectedPath: "mobile/a.md",
    }, { surface: "pwa", now: () => 20 });

    expect(getWorkspaceUiStateEntry(state, "/repo", { surface: "electron" })).toMatchObject({
      deskExpandedPaths: ["desktop"],
      deskSelectedPath: "desktop/a.md",
    });
    expect(getWorkspaceUiStateEntry(state, "/repo", { surface: "pwa" })).toMatchObject({
      deskExpandedPaths: ["mobile"],
      deskSelectedPath: "mobile/a.md",
    });
  });

  it("reads legacy unbucketed workspace state as electron state for old users", () => {
    const state = normalizeWorkspaceUiState({
      workspaces: {
        "/repo": {
          updatedAt: 1,
          deskExpandedPaths: ["old-desktop"],
          deskSelectedPath: "old-desktop/a.md",
        },
      },
    });

    expect(getWorkspaceUiStateEntry(state, "/repo", { surface: "electron" })).toMatchObject({
      deskExpandedPaths: ["old-desktop"],
      deskSelectedPath: "old-desktop/a.md",
    });
    expect(getWorkspaceUiStateEntry(state, "/repo", { surface: "pwa" })).toBeNull();
  });

  it("persists workspace companion fields that control the right desk panel", () => {
    expect(normalizeWorkspaceUiEntry({
      rightWorkspaceTab: "workspace",
      jianView: "notes",
      jianDrawerOpen: true,
    })).toMatchObject({
      rightWorkspaceTab: "workspace",
      jianView: "notes",
      jianDrawerOpen: true,
    });
  });

  it("keeps canonical preview tab metadata including source root and reading position", () => {
    expect(normalizeWorkspaceUiEntry({
      openTabs: ["note"],
      activeTabId: "note",
      previewTabs: [{
        id: "note",
        filePath: "/repo/docs/note.md",
        relativePath: "docs/note.md",
        title: "note.md",
        type: "markdown",
        ext: "MD",
        sourceRootPath: "/repo",
        readingPosition: {
          preview: {
            scrollTop: 240,
            scrollHeight: 1200,
            clientHeight: 600,
            ratio: 0.4,
            anchorId: "intro",
            contentHash: "abc",
          },
          edit: {
            scrollTop: 80,
          },
          currentHeadingId: "intro",
          currentHeadingText: "Intro",
          contentHash: "abc",
        },
      }],
    })).toMatchObject({
      openTabs: ["note"],
      activeTabId: "note",
      previewTabs: [{
        id: "note",
        filePath: "/repo/docs/note.md",
        relativePath: "docs/note.md",
        type: "markdown",
        ext: "md",
        sourceRootPath: "/repo",
        readingPosition: {
          preview: {
            scrollTop: 240,
            scrollHeight: 1200,
            clientHeight: 600,
            ratio: 0.4,
            anchorId: "intro",
            contentHash: "abc",
          },
          edit: {
            scrollTop: 80,
          },
          currentHeadingId: "intro",
          currentHeadingText: "Intro",
          contentHash: "abc",
        },
      }],
    });
  });

  it("drops invalid optional preview tab fields instead of keeping legacy runtime branches alive", () => {
    const entry = normalizeWorkspaceUiEntry({
      openTabs: ["note"],
      previewTabs: [{
        id: "note",
        relativePath: "docs/note.md",
        sourceRootPath: "../not-a-root",
        readingPosition: {
          preview: {
            scrollTop: "invalid",
            anchorId: "kept-only-if-scroll-is-valid",
          },
        },
      }],
    });

    expect(entry.previewTabs[0]).not.toHaveProperty("sourceRootPath");
    expect(entry.previewTabs[0]).not.toHaveProperty("readingPosition");
  });
});

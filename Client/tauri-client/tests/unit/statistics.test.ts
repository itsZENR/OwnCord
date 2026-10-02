import { afterEach, expect, it } from "vitest";
import { createAchievements } from "../../src/components/Achievements";
import { activityStore, formatVoiceTime } from "../../src/stores/activity.store";
import { setChannels } from "../../src/stores/channels.store";
import { membersStore } from "../../src/stores/members.store";

let page: ReturnType<typeof createAchievements> | undefined;
afterEach(() => { page?.destroy(); page = undefined; });

it("keeps lifetime channel totals in expandable statistics, preserving open details on refresh", () => {
  setChannels([{ id: 10, name: "Lobby", type: "voice", position: 0, category: null }]);
  membersStore.setState(() => ({ members: new Map([[1, { id: 1, username: "friend", avatar: null, role: "member", status: "online" }]]), typingUsers: new Map() }));
  activityStore.setState(() => ({ loaded: true, error: null, members: new Map([[1, { user_id: 1, sessions: 9, total_seconds: 7200, channel_seconds: { "10": 3600 } }]]) }));
  page = createAchievements(() => {});
  const details = page.element.querySelector("details")!;
  expect(details.open).toBe(false);
  expect(details.querySelector("dt")?.textContent).toBe("Lobby");
  expect(details.querySelector("dd")?.textContent).toBe(formatVoiceTime(3600));
  details.open = true;
  activityStore.setState((s) => ({ ...s, members: new Map([[1, { user_id: 1, sessions: 9, total_seconds: 7260, channel_seconds: { "10": 3660 } }]]) }));
  activityStore.flush();
  expect(page.element.querySelector("details")?.open).toBe(true);
  expect(page.element.querySelector("dd")?.textContent).toBe(formatVoiceTime(3660));
  // Older servers provide totals only: do not label the global total as channel time.
  activityStore.setState((s) => ({ ...s, members: new Map([[1, { user_id: 1, sessions: 9, total_seconds: 7260 }]]) }));
  activityStore.flush();
  expect(page.element.querySelector("details")).toBeNull();
  expect(page.element.querySelector(".activity-board-time")?.textContent).toBe(formatVoiceTime(7260));
});

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createCensusHoverIntent,
  CENSUS_HOVER_DELAY_MS,
  CENSUS_DETAIL_MIN_ZOOM,
} from "@/lib/census-hover-intent";
afterEach(() => vi.useRealTimers());
const a = { id: "a", longitude: -3.7, latitude: 40.4 };
const b = { id: "b", longitude: -3.71, latitude: 40.41 };
function setup() {
  vi.useFakeTimers();
  const show = vi.fn(),
    hide = vi.fn();
  return { show, hide, intent: createCensusHoverIntent(show, hide) };
}
describe("Census hover intent", () => {
  it("does not display details before five seconds on the same section", () => {
    const { show, intent } = setup();
    intent.update(a, 14);
    vi.advanceTimersByTime(CENSUS_HOVER_DELAY_MS - 1);
    expect(show).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenCalledWith(a);
  });
  it("keeps the original dwell timer while moving within a section and uses the latest coordinates", () => {
    const { show, intent } = setup();
    intent.update(a, 14);
    vi.advanceTimersByTime(4000);
    const moved = { ...a, longitude: -3.702 };
    intent.update(moved, 14);
    vi.advanceTimersByTime(1000);
    expect(show).toHaveBeenCalledWith(moved);
  });
  it("requires a fresh five seconds after changing sections", () => {
    const { show, intent } = setup();
    intent.update(a, 14);
    vi.advanceTimersByTime(4000);
    intent.update(b, 14);
    vi.advanceTimersByTime(4999);
    expect(show).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenCalledWith(b);
  });
  it("never opens section details when zoomed out", () => {
    const { show, intent } = setup();
    intent.update(a, CENSUS_DETAIL_MIN_ZOOM - 0.01);
    vi.advanceTimersByTime(20000);
    expect(show).not.toHaveBeenCalled();
  });
  it("cancels pending display when leaving a section or entering a listing", () => {
    const { show, intent } = setup();
    intent.update(a, 14);
    vi.advanceTimersByTime(4900);
    intent.update(undefined, 14);
    vi.advanceTimersByTime(10000);
    expect(show).not.toHaveBeenCalled();
  });
  it("hides immediately on zoom out and requires a new dwell on zoom in", () => {
    const { show, hide, intent } = setup();
    intent.update(a, 15);
    vi.advanceTimersByTime(5000);
    expect(show).toHaveBeenCalledOnce();
    intent.update(a, 13);
    expect(hide).toHaveBeenCalledOnce();
    intent.update(a, 15);
    vi.advanceTimersByTime(4999);
    expect(show).toHaveBeenCalledOnce();
  });
  it("cleans up on pan, click, layer changes and unmount without a late popup", () => {
    const { show, intent } = setup();
    intent.update(a, 15);
    intent.cancel();
    vi.runAllTimers();
    expect(show).not.toHaveBeenCalled();
  });
  it("updates the popup position without another delay once visible and hides when changing section", () => {
    const { show, hide, intent } = setup();
    intent.update(a, 15);
    vi.advanceTimersByTime(5000);
    intent.update({ ...a, latitude: 40.405 }, 15);
    expect(show).toHaveBeenCalledTimes(2);
    intent.update(b, 15);
    expect(hide).toHaveBeenCalledOnce();
  });
});

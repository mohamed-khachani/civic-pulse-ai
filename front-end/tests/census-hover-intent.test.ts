import { describe, it, expect, vi } from "vitest";
import {
  createCensusHoverIntent,
  CENSUS_DETAIL_MIN_ZOOM,
} from "@/lib/census-hover-intent";
const a = { id: "a", longitude: -3.7, latitude: 40.4 };
const b = { id: "b", longitude: -3.71, latitude: 40.41 };
function setup() {
  const show = vi.fn(),
    hide = vi.fn();
  return { show, hide, intent: createCensusHoverIntent(show, hide) };
}
describe("Immediate census hover with detail zoom", () => {
  it("displays details immediately at the minimum detail zoom", () => {
    const { show, intent } = setup();
    intent.update(a, CENSUS_DETAIL_MIN_ZOOM);
    expect(show).toHaveBeenCalledWith(a);
  });
  it("updates the card position immediately within the same section", () => {
    const { show, intent } = setup();
    intent.update(a, 14);
    const moved = { ...a, longitude: -3.702 };
    intent.update(moved, 14);
    expect(show).toHaveBeenLastCalledWith(moved);
    expect(show).toHaveBeenCalledTimes(2);
  });
  it("updates to another section immediately", () => {
    const { show, intent } = setup();
    intent.update(a, 14);
    intent.update(b, 14);
    expect(show).toHaveBeenLastCalledWith(b);
  });
  it("does not show section details when zoomed out", () => {
    const { show, intent } = setup();
    intent.update(a, CENSUS_DETAIL_MIN_ZOOM - 0.01);
    expect(show).not.toHaveBeenCalled();
  });
  it("hides immediately on exit or when entering a listing", () => {
    const { hide, intent } = setup();
    intent.update(a, 14);
    intent.update(undefined, 14);
    expect(hide).toHaveBeenCalledOnce();
  });
  it("hides on zoom out and displays immediately again on zoom in", () => {
    const { show, hide, intent } = setup();
    intent.update(a, 15);
    intent.update(a, 13);
    expect(hide).toHaveBeenCalledOnce();
    intent.update(a, 15);
    expect(show).toHaveBeenCalledTimes(2);
  });
  it("cleans up on pan, layer changes or unmount and remains reusable", () => {
    const { show, hide, intent } = setup();
    intent.update(a, 15);
    intent.cancel();
    intent.cancel();
    expect(hide).toHaveBeenCalledOnce();
    intent.update(b, 15);
    expect(show).toHaveBeenLastCalledWith(b);
  });
});

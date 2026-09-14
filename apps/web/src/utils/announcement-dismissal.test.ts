import { describe, expect, it } from "vitest";
import {
  DISMISSED_STORAGE_KEY,
  readDismissedIds,
  readIds,
  rememberId,
} from "./announcement-dismissal";

/** A storage stand-in, since these tests run in node with no DOM. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

/** Privacy modes do not return null — they throw. */
function throwingStorage(): Storage {
  return {
    get length(): number {
      throw new Error("denied");
    },
    clear: () => {
      throw new Error("denied");
    },
    getItem: () => {
      throw new Error("denied");
    },
    key: () => {
      throw new Error("denied");
    },
    removeItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  } as unknown as Storage;
}

describe("announcement dismissal storage (card 2.7)", () => {
  it("reads back what it stored", () => {
    const storage = fakeStorage();
    rememberId(storage, DISMISSED_STORAGE_KEY, "a1");
    rememberId(storage, DISMISSED_STORAGE_KEY, "a2");
    expect(readDismissedIds(storage)).toEqual(["a1", "a2"]);
  });

  it("does not store the same id twice", () => {
    const storage = fakeStorage();
    rememberId(storage, DISMISSED_STORAGE_KEY, "a1");
    rememberId(storage, DISMISSED_STORAGE_KEY, "a1");
    expect(readDismissedIds(storage)).toEqual(["a1"]);
  });

  it("⚠️ survives storage that THROWS rather than returning null", () => {
    // localStorage throws outright in some privacy modes, and a banner that
    // crashes the shell is worse than no banner.
    const storage = throwingStorage();
    expect(() => rememberId(storage, DISMISSED_STORAGE_KEY, "a1")).not.toThrow();
    expect(readDismissedIds(storage)).toEqual([]);
  });

  it("⚠️ treats corrupt stored data as nothing dismissed", () => {
    // Failing towards SHOWING the notice is the safe direction.
    const storage = fakeStorage({ [DISMISSED_STORAGE_KEY]: "not json" });
    expect(readDismissedIds(storage)).toEqual([]);
    const wrongShape = fakeStorage({ [DISMISSED_STORAGE_KEY]: '{"a":1}' });
    expect(readDismissedIds(wrongShape)).toEqual([]);
  });

  it("ignores non-string entries in a stored list", () => {
    const storage = fakeStorage({ [DISMISSED_STORAGE_KEY]: '["a1",7,null]' });
    expect(readDismissedIds(storage)).toEqual(["a1"]);
  });

  it("reads an empty list when there is no storage at all", () => {
    expect(readIds(undefined, DISMISSED_STORAGE_KEY)).toEqual([]);
    expect(() =>
      rememberId(undefined, DISMISSED_STORAGE_KEY, "a1"),
    ).not.toThrow();
  });
});

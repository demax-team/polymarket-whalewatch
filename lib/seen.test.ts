import { describe, it, expect } from "vitest";
import { openDb } from "./db";
import { hasSeen, markSeen } from "./seen";
it("marks and detects seen keys", () => {
  const db = openDb(":memory:");
  expect(hasSeen(db, "k1")).toBe(false);
  markSeen(db, "k1", 1700000000);
  expect(hasSeen(db, "k1")).toBe(true);
});

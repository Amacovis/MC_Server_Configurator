import { describe, expect, it } from "vitest";
import { retentionCandidates, validateCron } from "../src/server/backups";

describe("backup policy", () => {
  it("validates simple cron schedules", () => {
    expect(validateCron("0 4 * * *")).toBe("0 4 * * *");
    expect(() => validateCron("@daily")).toThrow();
    expect(() => validateCron("0 4 * * * ; reboot")).toThrow();
  });

  it("selects oldest backups beyond retention", () => {
    const removable = retentionCandidates(
      [
        { id: "old", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "new", createdAt: "2026-01-03T00:00:00.000Z" },
        { id: "mid", createdAt: "2026-01-02T00:00:00.000Z" }
      ],
      2
    );
    expect(removable.map((item) => item.id)).toEqual(["old"]);
  });
});


import assert from "node:assert/strict";
import test from "node:test";
import { formatRankSummary, rankCoverageGaps } from "../src/rank.js";

function measuredClass(name, sourceFile, percentage) {
  return { name, sourceFile, heuristic: false, coverage: { line: { percentage } }, methods: [] };
}

test("scores known coverage and churn with the documented formula", () => {
  const result = rankCoverageGaps([measuredClass("demo.Greeting", "demo/Greeting.java", 0.25)], [{ sourceFile: "demo/Greeting.java", commitCount: 3 }]);
  assert.equal(result.ranked.length, 1);
  assert.equal(result.ranked[0].score, 0.75 * Math.log1p(3));
  assert.equal(result.ranked[0].status, "fully-known");
});

test("keeps measured coverage when the whole churn result is unavailable", () => {
  const churn = [{ sourceFile: "demo/Greeting.java", commitCount: null }];
  Object.defineProperty(churn, "status", { value: "unavailable" });
  const result = rankCoverageGaps([measuredClass("demo.Greeting", "demo/Greeting.java", 0.25)], churn);
  assert.equal(result.ranked[0].score, 0.75);
  assert.equal(result.ranked[0].commitCount, null);
  assert.equal(result.ranked[0].status, "partially-known");
});

test("marks a non-heuristic class with neither signal as unrankable", () => {
  const unknown = { name: "demo.Unknown", sourceFile: "demo/Unknown.java", heuristic: false, coverage: { line: { percentage: null } }, methods: [] };
  const result = rankCoverageGaps([unknown], [{ sourceFile: unknown.sourceFile, commitCount: null }]);
  assert.equal(result.ranked.length, 0);
  assert.match(result.unrankable[0].reason, /both unavailable/);
});

test("surfaces a class with no resolved source file as unrankable", () => {
  const result = rankCoverageGaps([measuredClass("demo.Missing", null, 0.25)], []);
  assert.equal(result.ranked.length, 0);
  assert.equal(result.unrankableCount, 1);
  assert.match(result.unrankable[0].reason, /could not be resolved/);
});

test("handles static heuristic classes with and without real churn", () => {
  const heuristic = { name: "demo.LikelyGap", sourceFile: "demo/LikelyGap.java", heuristic: true, coverage: { line: { percentage: null } }, methods: [{ heuristic: true, gapReason: "likely untested" }] };
  const knownChurn = rankCoverageGaps([heuristic], [{ sourceFile: heuristic.sourceFile, commitCount: 4 }]);
  assert.equal(knownChurn.ranked[0].score, Math.log1p(4));
  assert.equal(knownChurn.ranked[0].coveragePercentage, null);
  const noChurn = rankCoverageGaps([heuristic], [{ sourceFile: heuristic.sourceFile, commitCount: null }]);
  assert.equal(noChurn.ranked[0].score, 1);
  assert.equal(noChurn.ranked[0].status, "partially-known");
});

test("sorts all candidates before applying topN truncation", () => {
  const classes = [
    measuredClass("demo.Low", "demo/Low.java", 0.8),
    measuredClass("demo.Mid", "demo/Mid.java", 0.5),
    measuredClass("demo.High", "demo/High.java", 0.1),
  ];
  const churn = classes.map((entry) => ({ sourceFile: entry.sourceFile, commitCount: 2 }));
  const result = rankCoverageGaps(classes, churn, { topN: 2 });
  assert.deepEqual(result.ranked.map((entry) => entry.name), ["demo.High", "demo.Mid"]);
  assert.equal(result.totalCandidates, 3);
});

test("sorts a fully-known confirmed gap ahead of a higher raw partially-known score", () => {
  const fullyKnown = measuredClass("demo.Confirmed", "demo/Confirmed.java", 0.95);
  const partial = { name: "demo.Unmeasured", sourceFile: "demo/Unmeasured.java", heuristic: false, coverage: { line: { percentage: null } }, methods: [] };
  const churn = [
    { sourceFile: fullyKnown.sourceFile, commitCount: 5 },
    { sourceFile: partial.sourceFile, commitCount: 5 },
  ];
  const result = rankCoverageGaps([fullyKnown, partial], churn);
  assert.ok(result.ranked[0].score < result.ranked[1].score);
  assert.deepEqual(result.ranked.map((entry) => entry.name), ["demo.Confirmed", "demo.Unmeasured"]);
});

test("sorts scores within status tiers while keeping every fully-known candidate first", () => {
  const fullyKnownSmall = measuredClass("demo.FullySmall", "demo/FullySmall.java", 0.8);
  const fullyKnownLarge = measuredClass("demo.FullyLarge", "demo/FullyLarge.java", 0.1);
  const partialCoverage = measuredClass("demo.PartialCoverage", "demo/PartialCoverage.java", 0.5);
  const partialChurn = { name: "demo.PartialChurn", sourceFile: "demo/PartialChurn.java", heuristic: false, coverage: { line: { percentage: null } }, methods: [] };
  const result = rankCoverageGaps(
    [fullyKnownSmall, fullyKnownLarge, partialCoverage, partialChurn],
    [
      { sourceFile: fullyKnownSmall.sourceFile, commitCount: 4 },
      { sourceFile: fullyKnownLarge.sourceFile, commitCount: 2 },
      { sourceFile: partialCoverage.sourceFile, commitCount: null },
      { sourceFile: partialChurn.sourceFile, commitCount: 3 },
    ],
  );
  assert.deepEqual(result.ranked.map((entry) => entry.name), ["demo.FullyLarge", "demo.FullySmall", "demo.PartialChurn", "demo.PartialCoverage"]);
});

test("applies topN after status-tiered ordering", () => {
  const fullHigh = measuredClass("demo.FullHigh", "demo/FullHigh.java", 0.1);
  const fullLow = measuredClass("demo.FullLow", "demo/FullLow.java", 0.8);
  const partialBest = { name: "demo.PartialBest", sourceFile: "demo/PartialBest.java", heuristic: false, coverage: { line: { percentage: null } }, methods: [] };
  const partialOther = measuredClass("demo.PartialOther", "demo/PartialOther.java", 0.7);
  const result = rankCoverageGaps(
    [fullHigh, fullLow, partialBest, partialOther],
    [
      { sourceFile: fullHigh.sourceFile, commitCount: 2 },
      { sourceFile: fullLow.sourceFile, commitCount: 2 },
      { sourceFile: partialBest.sourceFile, commitCount: 8 },
      { sourceFile: partialOther.sourceFile, commitCount: null },
    ],
    { topN: 3 },
  );
  assert.deepEqual(result.ranked.map((entry) => entry.name), ["demo.FullHigh", "demo.FullLow", "demo.PartialBest"]);
  assert.equal(result.totalCandidates, 4);
});

test("preserves score order even when a fallback to ineligible candidates is required", () => {
  // Only 2 of these 4 are stub-eligible, so topN=4 must fall back to the
  // 2 ineligible ones — but the final list should still read in score order,
  // not "eligible first, then whatever got appended".
  const deadEndHigh = {
    name: "demo.DeadEndHigh", sourceFile: "demo/DeadEndHigh.java", heuristic: false,
    coverage: { line: { percentage: 0.5 } },
    methods: [{ name: "half", coverage: { line: { percentage: 0.5 } } }],
  };
  const usableMid = {
    name: "demo.UsableMid", sourceFile: "demo/UsableMid.java", heuristic: false,
    coverage: { line: { percentage: 0.7 } },
    methods: [{ name: "untested", coverage: { line: { percentage: 0 } } }],
  };
  const usableLow = {
    name: "demo.UsableLow", sourceFile: "demo/UsableLow.java", heuristic: false,
    coverage: { line: { percentage: 0.9 } },
    methods: [{ name: "untested", coverage: { line: { percentage: 0 } } }],
  };
  const deadEndLow = {
    name: "demo.DeadEndLow", sourceFile: "demo/DeadEndLow.java", heuristic: false,
    coverage: { line: { percentage: 0.95 } },
    methods: [{ name: "half", coverage: { line: { percentage: 0.5 } } }],
  };
  const classes = [deadEndHigh, usableMid, usableLow, deadEndLow];
  const churn = classes.map((entry) => ({ sourceFile: entry.sourceFile, commitCount: 2 }));
  const result = rankCoverageGaps(classes, churn, { topN: 4 });
  // Score order (highest gap first): DeadEndHigh > UsableMid > UsableLow > DeadEndLow.
  assert.deepEqual(result.ranked.map((entry) => entry.name), ["demo.DeadEndHigh", "demo.UsableMid", "demo.UsableLow", "demo.DeadEndLow"]);
  assert.equal(result.bumpedForNoStubs.length, 0);
});

test("bumps a higher-scoring class with no stubbable methods for the next eligible one", () => {
  // 50% coverage but every method individually has partial coverage —
  // scores high, but stub generation can never produce a stub for it.
  const deadEnd = {
    name: "demo.DeadEnd", sourceFile: "demo/DeadEnd.java", heuristic: false,
    coverage: { line: { percentage: 0.5 } },
    methods: [{ name: "half", coverage: { line: { percentage: 0.5 } } }],
  };
  const usable = {
    name: "demo.Usable", sourceFile: "demo/Usable.java", heuristic: false,
    coverage: { line: { percentage: 0.9 } },
    methods: [{ name: "untested", coverage: { line: { percentage: 0 } } }],
  };
  const churn = [
    { sourceFile: deadEnd.sourceFile, commitCount: 5 },
    { sourceFile: usable.sourceFile, commitCount: 5 },
  ];
  const result = rankCoverageGaps([deadEnd, usable], churn, { topN: 1 });
  assert.deepEqual(result.ranked.map((entry) => entry.name), ["demo.Usable"]);
  assert.equal(result.bumpedForNoStubs.length, 1);
  assert.equal(result.bumpedForNoStubs[0].name, "demo.DeadEnd");
});

test("falls back to a stub-ineligible candidate when there aren't enough eligible ones to fill topN", () => {
  const deadEnd = {
    name: "demo.OnlyOption", sourceFile: "demo/OnlyOption.java", heuristic: false,
    coverage: { line: { percentage: 0.5 } },
    methods: [{ name: "half", coverage: { line: { percentage: 0.5 } } }],
  };
  const result = rankCoverageGaps([deadEnd], [{ sourceFile: deadEnd.sourceFile, commitCount: 5 }], { topN: 3 });
  assert.deepEqual(result.ranked.map((entry) => entry.name), ["demo.OnlyOption"]);
  assert.equal(result.bumpedForNoStubs.length, 0);
});

test("does not penalize a class with no method data at all (methods: [])", () => {
  const result = rankCoverageGaps([measuredClass("demo.NoMethodData", "demo/NoMethodData.java", 0.5)], [{ sourceFile: "demo/NoMethodData.java", commitCount: 5 }]);
  assert.equal(result.ranked.length, 1);
  assert.equal(result.ranked[0].stubEligible, true);
  assert.equal(result.ranked[0].stubbableMethodCount, null);
});

test("formats formula inputs rather than only an opaque score", () => {
  const result = rankCoverageGaps([measuredClass("demo.Greeting", "demo/Greeting.java", 0.25)], [{ sourceFile: "demo/Greeting.java", commitCount: 3 }]);
  const summary = formatRankSummary(result).join("\n");
  assert.match(summary, /coverage: 25\.00%/);
  assert.match(summary, /churn: 3 commits/);
  assert.match(summary, /\(1 - line coverage\) \* ln\(1 \+ commits\)/);
});

test("prints a NOTE explaining a bumped no-stub candidate in the summary text", () => {
  const deadEnd = {
    name: "demo.DeadEnd", sourceFile: "demo/DeadEnd.java", heuristic: false,
    coverage: { line: { percentage: 0.5 } },
    methods: [{ name: "half", coverage: { line: { percentage: 0.5 } } }],
  };
  const usable = {
    name: "demo.Usable", sourceFile: "demo/Usable.java", heuristic: false,
    coverage: { line: { percentage: 0.9 } },
    methods: [{ name: "untested", coverage: { line: { percentage: 0 } } }],
  };
  const churn = [
    { sourceFile: deadEnd.sourceFile, commitCount: 5 },
    { sourceFile: usable.sourceFile, commitCount: 5 },
  ];
  const result = rankCoverageGaps([deadEnd, usable], churn, { topN: 1 });
  const summary = formatRankSummary(result).join("\n");
  assert.match(summary, /NOTE: demo\.DeadEnd \[demo\/DeadEnd\.java\] scored higher .* no stubbable methods/);
});

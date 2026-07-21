# AGENTS.md — covscout

## What this project is

`covscout` is a CLI tool that, given a GitHub repository URL, finds the
highest-value test coverage gaps and generates draft JUnit 5 test stubs
for them. "Highest-value" means low coverage AND high change frequency —
not just the lowest coverage number in isolation.

Target: Java projects built with Maven or Gradle, using JaCoCo for
coverage. Do not add support for other languages or ecosystems. The code
should be structured so a second language parser could be added later,
but do not build one now.

## Non-negotiable rules — apply these at every stage, not just when reminded

1. **Detect, don't assume.** Any decision about "what kind of project is
   this" or "what does this method do" must come from actually reading
   repo files and reasoning about them — never a hardcoded default
   applied without checking.
2. **Fail gracefully, loudly.** Every stage has a named fallback. Never
   let the tool silently produce plausible-looking output when a stage
   actually failed. Surface failures in the final report (e.g.
   "coverage data unavailable, using static heuristic instead").
3. **Bounded, not exhaustive.** Cap git history scans (last ~100 commits
   or ~6 months, not full history), cap files analyzed per run, cap
   generated test stubs at a configurable N (default 5). This is a
   time-boxed build — explicit scope beats slow generality.
4. **Inspectable scoring.** The formula combining coverage % and churn
   into a final rank must be printed in the output, not hidden.
5. **JUnit 5 only** — `@Test` from `org.junit.jupiter.api`, not JUnit 4.
   Match the target repo's existing conventions (e.g. `@author` Javadoc
   tags, test naming patterns) if the repo already has one; don't impose
   a foreign style.
6. **Honesty over polish in generated output.** Generated test stubs are
   starting points for human review, not finished tests. Where a
   method's expected behavior can't be confidently inferred, leave an
   explicit `// TODO(covscout): verify expected behavior` marker instead
   of guessing and presenting it as correct.

## Explicit non-goals

- No multi-language support.
- No auto-commit, auto-branch, or auto-opening PRs. Output goes to disk
  for human review only.
- No guarantee of generated test correctness.
- No web UI. CLI + markdown report + test files on disk is full scope.

## Known environment constraints (update this section as new ones are found)

- **JaCoCo agent version vs. JDK 25.** JaCoCo agent versions older than
  ~0.8.11 crash the forked test JVM on JDK 25 (class file version 69) —
  the build fails with a Surefire fork-startup crash and zero tests run,
  *not* a clear JaCoCo-specific error message. If a target repo pins an
  old JaCoCo version and the build fails this way, this is the likely
  cause; don't treat it as a generic build failure without checking the
  pinned JaCoCo version first.
- **`mvn` vs `mvn.cmd` on Windows.** Node's `spawn` cannot launch bare
  `mvn`/`gradlew` on Windows without either the `.cmd`/`.bat` extension
  or `shell: true`. Both are handled in `coverage.js` — do not regress
  this when touching build-command selection.
- **This project's dev machine defaults to JDK 25.** Many public Java
  repos are not yet validated against JDK 25. When a real repo's build
  fails, check whether it's a genuine upstream issue or a JDK-25-only
  incompatibility before concluding covscout has a bug — but do not
  assume every failure is environmental either; several early
  hypotheses in this project turned out to be wrong and cost real
  diagnostic time. Confirm with a full clone + direct manual build
  outside covscout before attributing a failure to environment vs. tool.

## Pipeline overview (for context only — build one stage at a time; do not
## implement stages beyond the one currently requested in a task prompt)

1. Repo intake and build-system detection
2. Build + coverage report generation (JaCoCo)
3. Parse the coverage report
4. Git churn analysis
5. Rank and score (coverage % + churn, combined and shown transparently)
6. Generate JUnit 5 test stubs for top N ranked gaps
7. Output: markdown report + test files in `covscout-output/`

## Definition of done for the full project

Running `covscout <github-url>` against a real mid-size Java repo (e.g.
Apache Commons Lang or TheAlgorithms/Java) end-to-end produces: a ranked
markdown report, at least 3 generated test stub files, and a visible
terminal trail showing build-system detection, at least one
failure/fallback path being handled, and churn-based reasoning — not one
opaque generation step.

## Process rules for how tasks are scoped and reported

1. **Respect explicit scope limits literally.** If a task prompt says
   "implement X only, do not implement Y or Z yet," stop at X even if Y
   and Z would fit in the same response. Partitioning a stage into
   smaller prompts is a deliberate cost- and review-control decision —
   silently completing later parts anyway defeats the purpose, even if
   the output is otherwise correct.
2. **Show real command output, not a description of expected output.**
   When asked to run something and report the result, paste the literal
   terminal output. Do not say a step "succeeded" or "came back clean"
   without the literal text proving it. If a run wasn't actually
   performed, say so explicitly rather than describing what it would
   probably show.
3. **When deleting or replacing a file that had unique behavior, name
   that behavior and ask before deleting**, not after. If reconciling
   duplicate implementations, state up front what capability (if any)
   is being dropped.
4. **A single class of failure repeating across multiple unrelated
   inputs is a signal to look at the tool or environment, not the
   inputs.** If the same error shape shows up across 3+ independent
   target repos, stop trying new repos and diagnose the common factor
   first (see prior incident: covscout appeared to break on every real
   repo tried; root cause was the local Maven/JDK toolchain, found only
   after checking a minimal disposable control project).
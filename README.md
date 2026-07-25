# covscout

`covscout` is a CLI tool that, given a GitHub repository URL, finds the
highest-value test coverage gaps in a Java (Maven/Gradle) project and
generates draft JUnit 5 test stubs for them. "Highest-value" combines
low coverage with high change frequency, not just raw coverage
percentage — see the scoring formula below.

```
covscout <github-url>
covscout --history <github-url>
```

Requires Node.js 20+. Not published to npm — clone and run directly
(`node bin/covscout.js <github-url>`) or `npm link` locally for a
`covscout` binary.

Started as my submission to OpenAI's Build Week hackathon, built with
OpenAI Codex against the `AGENTS.md` spec in this repo; I've continued
building on it since as a personal project.

## Status: full 7-stage pipeline, implemented and tested

Every stage from `AGENTS.md`'s pipeline design is implemented, wired
together end to end in `bin/covscout.js`, and covered by the test
suite (68 tests, `npm test`):

1. **Repository intake and build-system detection** — clones the repo,
   detects Maven vs. Gradle from the actual build file content, and
   verifies the repository is primarily Java before proceeding.
2. **Build + coverage report generation (JaCoCo)** — detects whether
   JaCoCo is already configured (reading the real `pom.xml` /
   `build.gradle` content, including correctly ignoring
   `pluginManagement`-only declarations that aren't active). If it's
   configured, runs the project's own build/report command. If not,
   adds a **temporary, disposable** JaCoCo setup on a copied workspace
   — the user's real build file is never modified. If the build fails
   or times out, falls back to a static heuristic (public methods with
   no similarly-named test method) instead of crashing.
3. **Coverage report parsing** — parses real JaCoCo XML into structured
   per-class, per-method line and branch coverage, following JaCoCo's
   actual report schema. Normalizes the static-heuristic fallback into
   the same output shape, with unknown coverage values kept explicitly
   unknown (never invented) so ranking can't accidentally treat a
   guess as a measurement.
4. **Git churn analysis** — runs `git log` bounded to the last ~100
   commits or six months (whichever is smaller), maps changed files to
   the classes coverage already knows about, and reports how many
   files actually got churn data versus how many didn't. Missing or
   unparseable git history degrades to an explicit `unavailable`
   status rather than a silent zero.
5. **Coverage-gap ranking** — combines coverage and churn into one
   inspectable score: `(1 - line coverage) * ln(1 + commit count)`
   when both are measured, falling back to whichever single signal is
   available (and marking the result `partially-known`) when only one
   is. The formula is printed alongside every ranked entry, not hidden
   behind a black-box number.
6. **JUnit 5 test stub generation** — for the top-ranked gaps, emits
   `@Test` methods (`org.junit.jupiter.api`) for methods with
   confirmed 0% line coverage or a static-heuristic gap, each with a
   `fail("Not implemented")` placeholder and a `// TODO` explaining
   what's unverified. Constructors are never stubbed, and methods with
   only partial or unknown coverage are skipped rather than guessed
   at, with the skip reason reported.
7. **Output: markdown report + stub files + run history** — writes
   `covscout-output/<repo>/REPORT.md` (every stage's summary, plus
   stub path resolution), the generated `*StubTest.java` files, and
   appends a run entry to `HISTORY.md` (capped at the 20 most recent
   runs). `covscout --history <github-url>` reads back that history
   without re-running the pipeline.

### Proven happy path (real JaCoCo XML)

Against [`AndriyKalashnykov/maven-simple`](https://github.com/AndriyKalashnykov/maven-simple):

```
Coverage confidence: high
Coverage path: JaCoCo XML report

Parsed coverage status: available
Parsed coverage source: jacoco-xml
Parsed coverage confidence: high
Classes: 46
Methods: 122
Line coverage: 89.26% (324/363)
Branch coverage: 91.67% (33/36)
```

### Proven fallback path (build failure → static heuristic)

Against [`cicirello/Chips-n-Salsa`](https://github.com/cicirello/Chips-n-Salsa),
which fails to build test sources under the current JDK:

```
Coverage confidence: low
Coverage path: static-heuristic fallback
Reason: Build command exited with code 1.
Likely coverage gaps: 532

Parsed coverage status: fallback
Parsed coverage source: static-heuristic
Parsed coverage confidence: low
Classes: 157
Methods: 532
```

Both paths run through the real CLI end to end — not mocked, and both
now continue through churn analysis, ranking, stub generation, and
report output rather than stopping at coverage parsing.

## Explicit non-goals (from `AGENTS.md`)

- Java/Maven/Gradle only — no other language ecosystems.
- No auto-commit, auto-branch, or auto-opened PRs. Everything lands on
  disk under `covscout-output/` for human review.
- No guarantee of generated test correctness — stubs are a starting
  point, not finished tests.
- No web UI. CLI + markdown report + test files on disk is the full
  scope.

## A note on the debugging process

A meaningful part of the build time went into isolating a real
environment issue rather than a bug in `covscout` itself: multiple
unrelated target repositories were failing test compilation with the
same symptom (tests unable to resolve their own project's main-source
classes). We ruled out, in order: covscout's shallow clone, multi-module
build layout, and a JDK 21 vs. 25 compatibility difference — the last
via a disposable minimal Maven control project built specifically to
isolate the variable. The actual causes turned out to be twofold:
some repos have real upstream build issues, and separately, older
JaCoCo agent versions (pre-0.8.11) crash the forked JVM under JDK 25's
newer class file version. Both findings are recorded in `AGENTS.md`
under "Known environment constraints" so future stages don't
re-diagnose them from scratch.

## Non-negotiable design rules (from `AGENTS.md`)

- Detect, don't assume — every decision comes from reading actual repo
  files, never a hardcoded default.
- Fail gracefully, loudly — every stage has a named fallback, and a
  failure is always surfaced in the output, never silently papered
  over.
- Bounded, not exhaustive — capped git history, capped files analyzed,
  capped generated stubs.
- Inspectable scoring — any combined score is printed, not hidden.
- JUnit 5 only, matching the target repo's existing conventions where
  one exists.
- Honesty over polish — generated output that can't be confidently
  inferred is marked for human review, never presented as certain.

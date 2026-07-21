# covscout

`covscout` is a CLI tool that, given a GitHub repository URL, finds the
highest-value test coverage gaps in a Java (Maven/Gradle) project.
"Highest-value" is meant to combine low coverage with high change
frequency, not just raw coverage percentage — see the full pipeline
design below.

```
covscout <github-url>
```

## What's implemented and proven right now

This submission implements **Stages 1–3** of the full pipeline end to
end, with both the happy path and the failure/fallback path proven
against real public repositories:

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
   unknown (never invented) so a later ranking stage can't
   accidentally treat a guess as a measurement.

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

Both paths run through the real CLI end to end — not mocked.

## Designed but not yet implemented

Stages 4–7 of the pipeline (git churn analysis, combined
coverage+churn ranking, JUnit 5 test stub generation, and the final
markdown report) are fully specified in `AGENTS.md` but were not built
in this submission window. We prioritized a smaller set of stages that
are genuinely complete and verified over a larger set that would have
been untested by the deadline.

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

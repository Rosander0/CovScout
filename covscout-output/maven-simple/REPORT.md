# covscout report
## Repository intake
```text
Repository intake complete
Repository: maven-simple
Build system: Maven
Cloned copy: C:\Users\User\AppData\Local\Temp\covscout-qRqlS2\maven-simple
```

## Coverage analysis
```text
Coverage analysis complete
Build command: mvn.cmd test
Coverage confidence: high
Coverage path: JaCoCo XML report
JaCoCo report: C:\Users\User\AppData\Local\Temp\covscout-qRqlS2\maven-simple\target\site\jacoco\jacoco.xml
```

## Coverage report parsing
```text
Coverage report parsing complete
Parsed coverage status: available
Parsed coverage source: jacoco-xml
Parsed coverage confidence: high
Classes: 46
Methods: 122
Line coverage: 89.26% (324/363)
Branch coverage: 91.67% (33/36)
```

## Git churn analysis
```text
Git churn analysis complete
Churn status: available
Churn window: six-months-or-100-commits
Commits analyzed: 100
WARNING: Analyzed the most recent 100 commits within the last six months.
```

## Coverage gap ranking
```text
Coverage gap ranking complete
Score formula: measured coverage + churn = (1 - line coverage) * ln(1 + commit count); one known dimension uses its standalone signal.
Ranked 5 out of 46 candidates (top 5).
jsonparse.SourceData [src/main/java/jsonparse/SourceData.java] — coverage: 50.00% (gap 50.00%); churn: 2 commits; score: 0.549306 = (1 - line coverage) * ln(1 + commits) (fully-known).
jsonparse.databinding.simple.GsonLocalDateAdapter [src/main/java/jsonparse/databinding/simple/GsonLocalDateAdapter.java] — coverage: 50.00% (gap 50.00%); churn: 1 commits; score: 0.346574 = (1 - line coverage) * ln(1 + commits) (fully-known).
http.client.model.User [src/main/java/http/client/model/User.java] — coverage: 68.97% (gap 31.03%); churn: 1 commits; score: 0.215115 = (1 - line coverage) * ln(1 + commits) (fully-known).
http.client.model.Page [src/main/java/http/client/model/Page.java] — coverage: 72.22% (gap 27.78%); churn: 1 commits; score: 0.192541 = (1 - line coverage) * ln(1 + commits) (fully-known).
jsonparse.pathqueries.JacksonJsonPointer [src/main/java/jsonparse/pathqueries/JacksonJsonPointer.java] — coverage: 83.33% (gap 16.67%); churn: 2 commits; score: 0.183102 = (1 - line coverage) * ln(1 + commits) (fully-known).
```

## JUnit 5 test stub generation
```text
JUnit 5 test stub generation complete
jsonparse.databinding.simple.GsonLocalDateAdapter [src/main/java/jsonparse/databinding/simple/GsonLocalDateAdapter.java]: 1 methods stubbed; 2 skipped.
  Skipped <init>: Constructors are not stubbed.
  Skipped read: Method has measured line coverage and is not a confirmed zero-coverage gap.
http.client.model.User [src/main/java/http/client/model/User.java]: 8 methods stubbed; 11 skipped.
  Skipped <init>: Constructors are not stubbed.
  Skipped setId: Method has measured line coverage and is not a confirmed zero-coverage gap.
  Skipped getUsername: Method has measured line coverage and is not a confirmed zero-coverage gap.
  Skipped setUsername: Method has measured line coverage and is not a confirmed zero-coverage gap.
  Skipped setAbout: Method has measured line coverage and is not a confirmed zero-coverage gap.
  Skipped setSubmitted: Method has measured line coverage and is not a confirmed zero-coverage gap.
  Skipped setUpdatedAt: Method has measured line coverage and is not a confirmed zero-coverage gap.
  Skipped setSubmissionCount: Method has measured line coverage and is not a confirmed zero-coverage gap.
  Skipped getCommentCount: Method has measured line coverage and is not a confirmed zero-coverage gap.
  Skipped setCommentCount: Method has measured line coverage and is not a confirmed zero-coverage gap.
  Skipped setCreatedAt: Method has measured line coverage and is not a confirmed zero-coverage gap.
http.client.model.Page [src/main/java/http/client/model/Page.java]: 6 methods stubbed; 9 skipped.
  Skipped <init>: Constructors are not stubbed.
  Skipped setPage: Method has measured line coverage and is not a confirmed zero-coverage gap.
  Skipped setPerPage: Method has measured line coverage and is not a confirmed zero-coverage gap.
  Skipped setTotal: Method has measured line coverage and is not a confirmed zero-coverage gap.
  Skipped setTotalPages: Method has measured line coverage and is not a confirmed zero-coverage gap.
  Skipped getData: Method has measured line coverage and is not a confirmed zero-coverage gap.
  Skipped setData: Method has measured line coverage and is not a confirmed zero-coverage gap.
  Skipped printUsers: Method has partial measured line coverage.
  Skipped <clinit>: Method has measured line coverage and is not a confirmed zero-coverage gap.
WARNING: No stubs generated for jsonparse.SourceData [src/main/java/jsonparse/SourceData.java]: All 2 method(s) were skipped; <init>: Constructors are not stubbed. asString: Method has partial measured line coverage.
  Skipped <init>: Constructors are not stubbed.
  Skipped asString: Method has partial measured line coverage.
WARNING: No stubs generated for jsonparse.pathqueries.JacksonJsonPointer [src/main/java/jsonparse/pathqueries/JacksonJsonPointer.java]: All 2 method(s) were skipped; <init>: Constructors are not stubbed. main: Method has measured line coverage and is not a confirmed zero-coverage gap.
  Skipped <init>: Constructors are not stubbed.
  Skipped main: Method has measured line coverage and is not a confirmed zero-coverage gap.
```

## Stub output path resolution
```text
Stub output path resolution complete
jsonparse.databinding.simple.GsonLocalDateAdapter (jsonparse.databinding.simple): jsonparse\databinding\simple\GsonLocalDateAdapterStubTest-3.java
WARNING: jsonparse.databinding.simple.GsonLocalDateAdapter (jsonparse.databinding.simple): intended path C:\Users\User\Covscout\covscout-output\maven-simple\jsonparse\databinding\simple\GsonLocalDateAdapterStubTest.java; fallback path C:\Users\User\Covscout\covscout-output\maven-simple\jsonparse\databinding\simple\GsonLocalDateAdapterStubTest-3.java. An existing filesystem entry occupies C:\Users\User\Covscout\covscout-output\maven-simple\jsonparse\databinding\simple\GsonLocalDateAdapterStubTest.java.
http.client.model.User (http.client.model): http\client\model\UserStubTest-3.java
WARNING: http.client.model.User (http.client.model): intended path C:\Users\User\Covscout\covscout-output\maven-simple\http\client\model\UserStubTest.java; fallback path C:\Users\User\Covscout\covscout-output\maven-simple\http\client\model\UserStubTest-3.java. An existing filesystem entry occupies C:\Users\User\Covscout\covscout-output\maven-simple\http\client\model\UserStubTest.java.
http.client.model.Page (http.client.model): http\client\model\PageStubTest-3.java
WARNING: http.client.model.Page (http.client.model): intended path C:\Users\User\Covscout\covscout-output\maven-simple\http\client\model\PageStubTest.java; fallback path C:\Users\User\Covscout\covscout-output\maven-simple\http\client\model\PageStubTest-3.java. An existing filesystem entry occupies C:\Users\User\Covscout\covscout-output\maven-simple\http\client\model\PageStubTest.java.
```

import assert from "node:assert/strict";
import test from "node:test";
import { parseGitHubUrl } from "../src/github-url.js";

test("parses an HTTPS GitHub repository URL", () => {
  assert.deepEqual(parseGitHubUrl("https://github.com/owner/repository.git"), {
    cloneUrl: "https://github.com/owner/repository.git",
    repositoryName: "repository",
  });
});

test("parses an SSH GitHub repository URL without rewriting it", () => {
  assert.deepEqual(parseGitHubUrl("git@github.com:owner/repository.git"), {
    cloneUrl: "git@github.com:owner/repository.git",
    repositoryName: "repository",
  });
});

test("identifies a genuinely malformed GitHub URL as invalid", () => {
  assert.throws(() => parseGitHubUrl("not a url"), {
    message: "Invalid GitHub URL: not a url",
  });
});

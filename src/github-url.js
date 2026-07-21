import { IntakeError } from "./errors.js";

export function parseGitHubUrl(value) {
  const sshMatch = /^git@github\.com:([^/\s:]+)\/([^/\s]+?)(?:\.git)?$/.exec(value);
  if (sshMatch) {
    return { cloneUrl: value, repositoryName: sshMatch[2] };
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new IntakeError(`Invalid GitHub URL: ${value}`);
  }

  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw new IntakeError("Expected an HTTPS GitHub repository URL, for example https://github.com/owner/repository.git");
  }

  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new IntakeError("Expected a GitHub repository URL with an owner and repository name");
  }

  const repository = parts[1].replace(/\.git$/, "");
  if (!repository) {
    throw new IntakeError("Expected a non-empty GitHub repository name");
  }

  return { cloneUrl: url.toString(), repositoryName: repository };
}

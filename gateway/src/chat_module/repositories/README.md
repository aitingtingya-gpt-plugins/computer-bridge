# Explicit repository reads

`chat.repository` reads the **one saved binding** of an authorized conversation. It does not contact a platform when a conversation is created, a task is admitted, or an assignment is claimed. No repository remains a supported configuration.

Operations:

- `info`: repository description and available metadata.
- `branches`: provider-side pagination with `page`, `limit`, and `next_page`.
- `list`: directory entries with local pagination over the provider response. GitHub's documented 1,000-entry contents limit is exposed as `source_limit_reached: true`, `complete: false`; this is not claimed to be a full tree.
- `read`: ordinary file content, default UTF-8 or optional Base64. Files are limited to 1 MiB; each response is at most 64 KiB of source bytes. Follow `next_offset` and send the returned `sha` as `expected_sha`, or pin `ref` to a commit. A changed file is an error rather than silently mixing revisions. UTF-8 ranges do not split characters.

The adapter builds only official API URLs, issues GET requests, omits ambient credentials, refuses redirects, bounds JSON to 2 MiB, and applies a 20-second timeout. It never follows returned download, LFS or submodule URLs. Reported symlink objects are rejected; GitHub itself may resolve an in-repository symlink through its Contents API before returning a file response. It does not clone, write, create PRs, install hooks, or execute repository content. All returned content is marked untrusted and is not user authorization.

## Authentication and isolation

The shipped configuration is anonymous and stores no repository tokens. A binding is not an access grant. GitHub public reads work without credentials. CNB's API returned HTTP 401 even for the official public sample during verification; do not present anonymous CNB access or private repository access as operational.

`ChatEnvironment.repositoryFetch(scope, url, init)` is an **internal deployment hook**, not a client option or a credential setup flow. It is not configured by this change. A deployment implementing the hook must use an already authorized transport restricted to the exact `scope.principal`, conversation, computer and repository, preserve GET/URL/redirect/abort restrictions, and keep credentials out of chat history and tool results. Never use a shared privileged token across users. The service checks conversation access before the request and again before returning data. Client-supplied repository, token and header fields are ignored.

When authentication is unavailable, `repository_auth_required`/`repository_forbidden` explain the limitation. A 404 is intentionally ambiguous between missing content and lack of access. When authentication is missing, the host may use an existing source **already authorized for the caller and repository** that independently grants access. An actual access denial is not permission to bypass the restriction through another route. The adapter does not discover credentials, grant access, or create an integration behind the user's back.

## Verified API sources

- GitHub repository metadata: https://docs.github.com/en/rest/repos/repos#get-a-repository
- GitHub branches: https://docs.github.com/en/rest/branches/branches#list-branches
- GitHub content formats, symlinks and limits: https://docs.github.com/en/rest/repos/contents#get-repository-content
- CNB service and authentication: https://docs.cnb.cool/en/develops/openapi.html
- CNB official schema: https://api.cnb.cool/swagger.json

CNB routes and fixtures were checked against the official Swagger definitions `dto.Repos4User`, `api.Branch`, `api.Content`, `api.TreeEntry`, and `constant.Visibility`:

- `GET /{repo}`
- `GET /{repo}/-/git/branches?page=...&page_size=...`
- `GET /{repo}/-/git/contents[/{file_path}]?ref=...`

CNB directory responses use `{type: "tree", entries: [...]}`, files use `{type: "blob", encoding: "base64", content: ...}`, and visibility values are `Private`, `Public` or `Secret`. The repository-info schema has no default branch field, so the adapter returns `null` rather than assuming one.

## Verification and limits

`npm run check --prefix gateway` and `npm run build --prefix gateway` validate TypeScript contracts and server bundling. Deterministic security-boundary tests remain in the internal repository and are not live platform authentication checks.

Live checks performed during implementation:

- GitHub `octocat/Hello-World`: metadata, three branches, root listing and README content succeeded using this adapter with its default fetch and no credentials.
- CNB `cnb/tutorial/hello-cnb`: an actual API request returned 401 and was surfaced as `repository_auth_required`. Authenticated CNB success, private GitHub access and deployment were **not** tested. CNB success-response parsing was tested using fixtures from the verified official schema.

No production deployment or repository writes were performed.

# Azure DevOps Backend Design

## Overview

Add an Azure DevOps (ADO) backend to tic, following the same CLI-wrapper pattern used by the GitHub (`gh`) and GitLab (`glab`) backends. The ADO backend wraps the `az boards` CLI and uses `az devops invoke` for batch operations.

## File Structure

```
src/backends/ado/
├── index.ts          # AzureDevOpsBackend class (extends BaseBackend)
├── az.ts             # az devops CLI wrapper (exec + JSON parsing)
├── mappers.ts        # Convert az CLI JSON → tic WorkItem/Comment types
├── remote.ts         # Git remote URL parsing for org/project detection
├── index.test.ts     # Backend tests
├── az.test.ts        # CLI wrapper tests
├── mappers.test.ts   # Mapper tests
├── remote.test.ts    # Remote URL parsing tests
```

## Capabilities

```typescript
{
  relationships: true,       // parent-child via work item links
  customTypes: false,        // types come from ADO process template
  customStatuses: false,     // states come from ADO work item type definition
  iterations: true,          // full iteration path support
  comments: true,            // work item comments/discussion
  fields: {
    priority: true,          // ADO priority field (1-4)
    assignee: true,          // Assigned To
    labels: true,            // Tags
    parent: true,            // Parent link type
    dependsOn: true,         // Predecessor link type
  }
}
```

## Field Mapping

| tic field | ADO field | Notes |
|-----------|-----------|-------|
| `id` | `System.Id` | Integer, stored as string |
| `title` | `System.Title` | Direct |
| `type` | `System.WorkItemType` | As-is from process template (Epic, User Story, Bug, etc.) |
| `status` | `System.State` | As-is (New, Active, Resolved, Closed, etc.) |
| `iteration` | `System.IterationPath` | Full path (e.g., `MyProject\Sprint 1`) |
| `priority` | `Microsoft.VSTS.Common.Priority` | 1=critical, 2=high, 3=medium, 4=low, missing=medium |
| `assignee` | `System.AssignedTo.displayName` | Display name or email |
| `labels` | `System.Tags` | Semicolon-separated in ADO, mapped to `string[]` |
| `description` | `System.Description` | HTML in ADO, converted to markdown via `turndown` |
| `created` | `System.CreatedDate` | ISO timestamp |
| `updated` | `System.ChangedDate` | ISO timestamp |
| `parent` | Relations (Hierarchy-Reverse) | Target ID as `string \| null` |
| `dependsOn` | Relations (Dependency-Reverse) | Target IDs as `string[]` |
| `comments` | Separate REST fetch | Via `az devops invoke` |

### Reverse mapping (tic to ADO) for create/update

- Priority: critical=1, high=2, medium=3, low=4
- Labels: `string[]` joined with `"; "`
- Other fields map directly to their `System.*` field names

### HTML to Markdown

ADO stores descriptions and comments as HTML. The `turndown` library (added as a runtime dependency) handles conversion to markdown, including tables, links, images, lists, and code blocks.

## CLI Wrapper (`az.ts`)

### Listing Work Items (2-step batch)

ADO's WIQL query returns only work item IDs, and `az boards work-item show` accepts only a single ID. To avoid N+1 calls, listing uses a two-step batch approach:

1. **WIQL query** to get IDs:
   ```bash
   az boards query --wiql "SELECT [System.Id] FROM WorkItems WHERE [System.IterationPath] = '{iteration}'" -o json
   ```

2. **Batch fetch** full data via REST:
   ```bash
   az devops invoke --area wit --resource workitemsbatch \
     --http-method POST --in-file {tmpfile} --api-version "7.1"
   ```
   The temp file contains `{ "ids": [...], "fields": [...] }`. Written and cleaned up by the wrapper.

This results in exactly 2 CLI calls regardless of item count.

### Single Item

```bash
az boards work-item show --id {id} --expand relations -o json
```

Includes relation links for parent/dependency extraction.

### Create

```bash
az boards work-item create --type {type} --title {title} \
  --fields "System.State={status}" "System.IterationPath={iteration}" ... -o json
```

### Update

```bash
az boards work-item update --id {id} \
  --fields "System.Title={title}" "System.State={status}" ... -o json
```

### Delete

```bash
az boards work-item delete --id {id} --yes -o json
```

### Relations

```bash
# Add relation
az boards work-item relation add --id {id} --relation-type {type} --target-id {target}

# Remove relation
az boards work-item relation remove --id {id} --relation-type {type} --target-id {target}
```

Relation types:
- Parent: `System.LinkTypes.Hierarchy-Reverse`
- Predecessor: `System.LinkTypes.Dependency-Reverse`

### Iterations

```bash
az boards iteration team list --team {team} -o json
```

Current iteration detected via `--timeframe current` flag. Default team name is `{project} Team`, overridable via config.

### Comments

```bash
# Fetch comments
az devops invoke --area wit --resource comments \
  --route-parameters workItemId={id} -o json

# Add comment
az devops invoke --area wit --resource comments \
  --route-parameters workItemId={id} \
  --http-method POST --in-file {tmpfile} --api-version "7.1"
```

### Dynamic Types and Statuses

Types and statuses are fetched from the ADO project, not configured locally:

```bash
# List all work item types for the project
az boards work-item type list -o json

# Get valid states for a specific type
az boards work-item type get --type {type} -o json
```

`getStatuses()` returns the union of all states across all types. The backend validates that a given status is valid for the specific work item type on create/update.

### Error Handling

All calls check for non-zero exit codes. On startup, the backend checks for:
1. `az` binary availability
2. `azure-devops` extension installed (`az extension list`)

If either is missing, throws a descriptive error with install instructions.

## Remote URL Parsing (`remote.ts`)

Parses git remote URLs to extract `org` and `project`. Three formats supported:

| Format | Pattern | Example |
|--------|---------|---------|
| HTTPS | `https://dev.azure.com/{org}/{project}/_git/{repo}` | `https://dev.azure.com/contoso/WebApp/_git/frontend` |
| SSH | `git@ssh.dev.azure.com:v3/{org}/{project}/{repo}` | `git@ssh.dev.azure.com:v3/contoso/WebApp/frontend` |
| Legacy | `https://{org}.visualstudio.com/{project}/_git/{repo}` | `https://contoso.visualstudio.com/WebApp/_git/frontend` |

Returns `{ org: string, project: string }` or `null` if the remote doesn't match.

### Spaces in Project Names

ADO project names commonly contain spaces. In URLs they appear as `%20`. The parser URL-decodes the extracted project name. The SSH format uses literal spaces between known delimiters (`v3/{org}/` and `/{repo}`).

## Factory Integration

Detection order in `src/backends/factory.ts`:

1. Check config file for explicit `backend` setting
2. Parse git remotes:
   - `github.com` → GitHubBackend
   - `gitlab.com` / GitLab self-hosted → GitLabBackend
   - **`dev.azure.com` / `ssh.dev.azure.com` / `*.visualstudio.com` → AzureDevOpsBackend**
3. Fall back to LocalBackend

Constructor receives `{ org: string, project: string }` from the remote parser. These are passed to every `az` command via `--org https://dev.azure.com/{org}` and `--project {project}`.

## Testing Strategy

Unit tests with mocked CLI calls, following the pattern of existing backends:

- **`az.test.ts`** — mock `child_process.execSync`, verify correct commands and flags, test JSON parsing and error handling
- **`mappers.test.ts`** — test all field transformations with fixture JSON (priority mapping, HTML-to-markdown, tag splitting, relation extraction)
- **`remote.test.ts`** — test all three URL formats, spaces in project names, URL decoding, non-matching URLs return null
- **`index.test.ts`** — test backend methods with mocked `az.ts` wrapper, verify capabilities, validate status-per-type checking

Test fixtures are sample JSON responses stored as constants in test files.

## Dependencies

### New runtime dependency

- `turndown` — HTML to markdown conversion for ADO descriptions and comments

## Key Decisions

- **No type/status mapping**: work item types and statuses come directly from ADO's process template
- **No area paths**: skipped for now, can be added later as a new field
- **Predecessor links only**: only `Dependency-Reverse` links map to `dependsOn`; `Related` links are ignored
- **Full iteration paths**: e.g., `MyProject\Sprint 1` (avoids ambiguity with nested iterations)
- **Batch fetching**: 2-step WIQL + batch approach avoids N+1 CLI calls
- **Fail-fast auth**: clear error message if `az devops` CLI is unavailable, no guided setup

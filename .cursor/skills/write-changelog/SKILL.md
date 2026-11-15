---
name: write-changelog
description: >-
  Drafts and updates user-facing release changelogs for this Discord activity
  (CHANGELOG.md, release-notes.json, GitHub Release body). Use when the user
  asks to write a changelog, release notes, what's new, or prepare notes for a
  release / version bump.
---

# Write changelog

## When

User asks to write/update a changelog, release notes, or “what’s new” for a version.

## Output targets

Match what CI and the app already use:

| Artifact | Role |
|----------|------|
| `CHANGELOG.md` | Human history in the repo (`## vX.Y.Z — YYYY-MM-DD`) |
| `release-notes.json` | Baked into the image; `/api/version` + version-badge dialog |
| GitHub Release body | Same markdown as the notes section (optional draft for the user) |

`release-notes.json` shape:

```json
{
  "version": "vX.Y.Z",
  "notes": "## What's changed\n\n- …",
  "url": "https://github.com/<owner>/<repo>/releases/tag/vX.Y.Z",
  "publishedAt": "<ISO or null if not released yet>",
  "updatedAt": "<ISO>"
}
```

## Workflow

1. **Find the range**
   - Previous tag: `git tag -l 'v*' --sort=-v:refname | head -1`
   - Commits: `git log --pretty=format:'%h %s' <prev>..HEAD` (or since last `CHANGELOG.md` heading if no tag)
   - If the user names a version (`v2.1.0`), use that; otherwise ask or infer the next semver from the latest tag + `#major` / `#minor` / `#patch` (default patch).

2. **Read the diffs, don’t paste raw commits**
   - Skim `git log` + key diffs; write **user-facing** bullets (what players/owners notice).
   - Skip noise: `chore(release)`, merge commits, `[skip ci]`, pure formatting unless it changes behavior.
   - Prefer short, concrete lines; group when helpful (`### Controls`, `### Fixes`, etc.).

3. **Write the notes body** (Release + in-app panel):

```markdown
## What's changed

- Bullet one
- Bullet two

**Full changelog**: https://github.com/<owner>/<repo>/compare/<prev>...vX.Y.Z
```

Owner/repo: `git remote get-url origin` (strip `.git`, map SSH to `https://github.com/owner/repo`).

4. **Update files** (unless the user only wants a draft in chat)
   - Prepend to `CHANGELOG.md`:

```markdown
# Changelog

## vX.Y.Z — YYYY-MM-DD

## What's changed

- …

```

     Keep older sections; drop a duplicate leading `# Changelog` if rewriting the file.
   - Write `release-notes.json` with `notes` = that body (including `## What's changed`). Use `git add -f release-notes.json` if gitignored.
   - Do **not** create the git tag or GitHub Release unless the user explicitly asks; CI (`.github/workflows/create-release.yml`) does that on push to `release`.

5. **Confirm**
   - Show the version, bump type if relevant, and the final bullet list.
   - Remind: push/merge to `release` (with `#minor` / `#major` in the commit message when needed) to cut the GitHub Release.

## Style

- Imperative or past tense is fine; stay consistent within one entry.
- No internal ticket IDs unless the user wants them.
- Mention Discord/mobile/safe-area or breaking API changes explicitly when present.
- Keep the in-app notes readable in a narrow dialog (avoid huge tables).

## Related

- Auto release + changelog on `release` pushes: `.github/workflows/create-release.yml`
- Version badge UI: `src/client/components/AppVersionBadge.tsx`
- Notes loader: `src/server/app-version.ts`, `scripts/write-release-notes.mjs`

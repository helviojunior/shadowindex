# GIT

[🏠 Home](Home) · [🇧🇷 Português](GIT-PT)

Search GitHub, queue selected repositories for cloning, and run the same
pipeline as SMB files — **GitLeaks → OCR/text extraction → content indexing
(OpenSearch)** — so cloned source code becomes searchable **offline**.

## Github Search

![Github Search](images/git-search.png)

- Type **search terms** (press Enter to add each one as a chip) and pick the
  search **type**: Repositories and/or Code, with an optional **Exact match
  (`--exact`)** that forces a literal/phrase match.
- Pick a **token credential** for the GitHub Search API (**required**) and the
  **clone mode** — *anonymous* or *authenticated* (with a token, for private
  repos). Token credentials are managed in [Credentials](Credentials-EN).
- Running a search first returns the **number of repositories per condition**;
  select the ones you want and **Download** queues each repository into the
  clone pipeline.

## Github (repositories)

![Github repositories](images/git-repos.png)

- Lists repositories **cloned and indexed** locally, with language, stars,
  forks, topics, file count, leaks and clone status.
- **Content search** finds text **inside the indexed files** (OpenSearch), with
  highlighted snippets; filter the list by name, tag, language or status.

## Repository browser

![Repository browser](images/git-browse.png)

- A **file tree** with expandable folders, just like the Servers browser.
  Selecting a **folder** lists its objects; selecting a **file** opens the
  **Info / View / OCR** tabs plus **Open** (on GitHub) and **Identify leaked
  credential**.
- **Info**: path, size, MIME type, extension, SHA1 and indexed status.
  **View**: file content. **OCR**: text extracted from documents/images/PDFs.

## Clone queue (Jobs)

![Git clone jobs](images/git-clone-jobs.png)

- Each queued repository becomes a **clone job** processed one by one:
  **clone → GitLeaks → text/OCR extraction → indexing**. States: *pending*,
  *running*, *completed*, *failed*, *cancelled* — with retry, cancel and
  prioritize actions.
- Clones land in the bind-mount (`./shadowindex_data/gitclones/<guid>`). Repos
  larger than a configurable threshold are cloned **shallow** (`--depth 1`);
  the download is **never skipped**.

## Advanced search — Git tab

![Advanced search — Git tab](images/git-advanced-search.png)

- The global **Advanced Search** also covers **git files** (by path and by
  indexed content), in a dedicated **Git** tab, alongside Servers, Files and
  Leaks.

## How to use

1. In **Github Search**, add your terms, pick the type and the **API token**,
   choose the clone mode, then **Search**.
2. Select the conditions/repositories and click **Download** to queue them.
3. Follow progress under **Jobs → Git clones** while the pipeline runs.
4. Browse a repository under **GIT → Github**, open files and inspect the
   **Info/View/OCR** tabs, or run a **content search**.

## Related

- Secrets found in repositories appear in [Leaks](Leaks-EN), linked to the repo
  (with an *open in browser* button that jumps straight to the file).
- Clone limits — shallow-clone threshold, simultaneous clones and the max file
  size for indexing — are configured in [Settings](Settings-EN).

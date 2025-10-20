Project Context and Guidelines

Purpose
- Build a robust pipeline to convert premium news articles (WSJ, NYT, etc.) into concise, high-quality summaries for personal research and broader audiences.

Operational Guidelines
- Be cautious with request rates; premium sites can detect bots quickly.
- Use randomized delays between navigation and scraping steps.
- Prefer reusing archived sources (HTML/PDF) over re-fetching when possible.
- Separate harvesting (capture HTML/PDF) from summarizing to minimize site hits.
- Support user session reuse where required, but avoid automated logins at scale.

Ethical/Compliance Notes
- Use the tool only with accounts you are authorized to use.
- Respect site Terms of Service; do not share paywalled content.
- Store only what is necessary (HTML/PDF) and keep it private.

Performance/Resilience
- Backoff and retry on failures; add jittered wait times.
- Detect paywalls/missing content and flag rather than hammering endpoints.
- Maintain a unified CSV (output/all_runs.csv) for comparisons across models/profiles.
- After every patch or commit, self-review README.md to ensure all changes, new features, and commands are accurately documented.

Security & Privacy
- Keep API keys in .env (not committed).
- Do not log cookies/session details.
- Include minimal metadata (timestamp, source host, user agent, public IP) for diagnostics.

Workflow Overview
1) Harvest (archive/pages/*.html|*.pdf + archive/archive_index.csv)
2) Summarize (use archived source when available)
3) Evaluate (optional: different assessors)
4) Compare (output/all_runs.csv, evaluation/*.csv)



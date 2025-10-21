# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `docs/AUTO_PLANNER_WORKFLOW.md` documentation

### Changed
- `config/profiles.json`: switched `editor_model` and `humanizer_model` to `gemini-1.5-flash`
- `scripts/pipeline/2_generate_content.js`: CSV parsing now uses `skip_empty_lines: true`
- `scripts/pipeline/3_edit_content.js`: supports test mode (mocked edits without GEMINI key)
- `scripts/sns-composer.js`: `composeForSns` signature reordered to `(platform, content)`
- Data fixtures refreshed under `data/` and `output/` references; `logs/api_usage.csv` updated
- `.cursor/environment.json` simplified

### Deprecated

### Deprecated

### Removed
- Stop tracking local Chrome profile dir by adding `temp_chrome_profile_main/` to `.gitignore`
- Untracked existing `temp_chrome_profile_main` files from VCS
- Deleted obsolete `data/6_humanized/humanized_runs.csv`

### Fixed

### Security

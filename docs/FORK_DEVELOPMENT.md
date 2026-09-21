# Fork development

English | [中文](FORK_DEVELOPMENT.zh.md)

## Summary

This fork is the long-lived development home for independent work based on DeepSeek Harness. `Joer/experimental-development` is its default integration branch, and fork-specific work is not expected to merge back into the upstream `master` branch. The upstream repository remains available as a reference and as a source for selective updates.

## Table of Contents

- [Development line](#development-line)
- [Branch policy](#branch-policy)
- [Upstream synchronization](#upstream-synchronization)
- [Validation](#validation)
- [Dev Note](#dev-note)

-----

<a id="development-line"></a>

## Development line

The `origin` remote points to `ZhouJoer/deepseek-harness`, where `Joer/experimental-development` is the default branch. The `upstream` remote points to the original `deepseek-ai/deepseek-harness` repository and does not receive fork-specific commits.

-----

<a id="branch-policy"></a>

## Branch policy

Fork-specific changes integrate into `Joer/experimental-development`. Experimental branches use the `Joer/` prefix so their ownership and purpose remain visible. Contributors preserve focused commits and do not plan changes around compatibility with an upstream merge.

-----

<a id="upstream-synchronization"></a>

## Upstream synchronization

The fork imports upstream changes selectively after reviewing their effect on fork-specific behavior. Conflict resolution preserves the fork's current direction instead of optimizing for a future merge back into upstream `master`.

-----

<a id="validation"></a>

## Validation

Changes continue to follow the repository's existing `AGENTS.md` instructions and validation workflows. Each push includes the checks required for the affected code or documentation.

-----

<a id="dev-note"></a>

## Dev Note

<details>
<summary>Working context</summary>

None.

</details>

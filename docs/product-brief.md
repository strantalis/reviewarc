# ReviewArc product brief

ReviewArc is a local-first desktop review client where an AI agent performs the broad pull request review and the engineer focuses on consequential judgments. It replaces the checkout-first, diff-first workflow with a unified inbox, CI-gated analysis, and isolated managed Git state only when deeper inspection is requested.

The MVP journey is: authenticate through the installed GitHub CLI, select organizations or repositories, open a real pull request, wait for required checks, fetch its exact base and head revisions into ReviewArc-owned storage, generate an evidence-backed recommendation with Codex or Claude Code, judge only the consequential risks and unresolved uncertainty, inspect cited code when needed, then explicitly preview and publish the final review.

Trust is part of the product surface. ReviewArc exposes what the agent verified, what it did not inspect, and what remains uncertain. Paths and line ranges are validated against pinned Git objects, but the recommendation remains a proposal for the reviewer to challenge. ReviewArc never runs project commands or modifies a user checkout.

Success for the MVP means a reviewer can understand the agent's approval posture without reading the entire diff, inspect the evidence behind any consequential judgment, resume after restart, recognize stale analysis, and publish a GitHub comment, approval, or request-changes review without leaving ReviewArc. Team sharing, Enterprise host configuration, and additional model providers are later milestones.

# ReviewArc product brief

ReviewArc is a local-first desktop review client for engineers who need to understand pull requests across many GitHub repositories. It replaces the checkout-first workflow with a unified inbox and creates isolated managed Git state only when deeper inspection is requested.

The MVP journey is: authenticate through the installed GitHub CLI, select organizations or repositories, open a real pull request, fetch its exact base and head revisions into ReviewArc-owned storage, generate a structured evidence-backed review with Codex, work chapter by chapter through real diffs, persist private notes and progress, then explicitly preview and publish selected review drafts.

Trust is part of the product surface. Facts, paths, and line ranges are validated against pinned Git objects. Unsupported analysis stays marked unverified. ReviewArc never runs project commands or modifies a user checkout.

Success for the MVP means a reviewer can resume a guided review after restart, recognize when analysis is stale, and publish a GitHub COMMENT review without leaving ReviewArc. Team sharing, approvals, requested-changes reviews, Enterprise host configuration, and alternate model providers are later milestones.

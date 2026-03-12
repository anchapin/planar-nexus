---
name: "🐛 Critical Bug"
description: "Report a critical bug blocking functionality"
title: "[CRITICAL] <title>"
labels: ["critical", "bug"]
body:
  - type: markdown
    attributes:
      value: |
        **Critical bugs block core functionality or cause data loss.**
        Please ensure this is truly critical and not a medium/low priority issue.
  - type: textarea
    id: description
    attributes:
      label: "Description"
      description: "What is the bug? What is the expected behavior?"
    validations:
      required: true
  - type: textarea
    id: affected-files
    attributes:
      label: "Affected Files"
      description: "List files and line numbers if known"
      placeholder: |
        - src/app/(app)/game/[id]/page.tsx (lines 507-600)
  - type: textarea
    id: reproduction
    attributes:
      label: "Reproduction Steps"
      description: "How can we reproduce this?"
      placeholder: |
        1. Go to '...'
        2. Click on '...'
        3. See error
    validations:
      required: true
  - type: textarea
    id: impact
    attributes:
      label: "Impact"
      description: "What is the impact of this bug?"
    validations:
      required: true
---

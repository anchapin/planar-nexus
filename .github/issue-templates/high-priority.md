---
name: "🚀 High Priority Feature"
description: "Request a high priority feature or improvement"
title: "[HIGH] <title>"
labels: ["high", "enhancement"]
body:
  - type: textarea
    id: problem
    attributes:
      label: "Problem Statement"
      description: "What problem does this solve?"
    validations:
      required: true
  - type: textarea
    id: proposed-solution
    attributes:
      label: "Proposed Solution"
      description: "What should be implemented?"
    validations:
      required: true
  - type: textarea
    id: affected-files
    attributes:
      label: "Affected Files"
      description: "Which files need to be changed?"
  - type: textarea
    id: acceptance-criteria
    attributes:
      label: "Acceptance Criteria"
      description: "How will we know this is complete?"
      placeholder: |
        - [ ] Criterion 1
        - [ ] Criterion 2
    validations:
      required: true
  - type: dropdown
    id: effort
    attributes:
      label: "Estimated Effort"
      options:
        - "Small (< 1 day)"
        - "Medium (1-3 days)"
        - "Large (3-7 days)"
        - "X-Large (> 1 week)"
---

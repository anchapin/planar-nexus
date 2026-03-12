---
name: "📝 Medium Priority Task"
description: "Track a medium priority task or improvement"
title: "[MEDIUM] <title>"
labels: ["medium"]
body:
  - type: textarea
    id: description
    attributes:
      label: "Description"
      description: "Describe the task"
    validations:
      required: true
  - type: textarea
    id: tasks
    attributes:
      label: "Required Tasks"
      description: "List tasks to complete"
      placeholder: |
        - [ ] Task 1
        - [ ] Task 2
  - type: textarea
    id: acceptance-criteria
    attributes:
      label: "Acceptance Criteria"
      description: "How will we know this is complete?"
---

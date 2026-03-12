---
name: "🔴 Critical Security Issue"
description: "Report a critical security vulnerability"
title: "[SECURITY] <title>"
labels: ["critical", "security"]
body:
  - type: markdown
    attributes:
      value: |
        **For security issues, please consider:**
        - If this is a critical vulnerability, please email maintainers directly
        - Do not disclose details publicly until fixed
  - type: textarea
    id: description
    attributes:
      label: "Description"
      description: "Describe the security issue"
    validations:
      required: true
  - type: textarea
    id: affected-files
    attributes:
      label: "Affected Files"
      description: "List files and line numbers"
      placeholder: |
        - src/ai/providers/openai.ts (line 124)
        - src/ai/providers/google.ts (line 158)
    validations:
      required: true
  - type: textarea
    id: reproduction
    attributes:
      label: "Reproduction Steps"
      description: "How can this be exploited?"
    validations:
      required: true
  - type: dropdown
    id: severity
    attributes:
      label: "Severity"
      options:
        - "Critical - Immediate action required"
        - "High - Fix within 24 hours"
        - "Medium - Fix within 1 week"
    validations:
      required: true
---

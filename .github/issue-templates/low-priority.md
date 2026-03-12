---
name: "✨ Low Priority Improvement"
description: "Suggest a minor improvement or nice-to-have feature"
title: "[LOW] <title>"
labels: ["low", "enhancement"]
body:
  - type: textarea
    id: description
    attributes:
      label: "Description"
      description: "Describe the improvement"
    validations:
      required: true
  - type: textarea
    id: benefit
    attributes:
      label: "Benefit"
      description: "Why would this be useful?"
  - type: textarea
    id: implementation
    attributes:
      label: "Implementation Ideas"
      description: "Any ideas on how to implement this?"
---

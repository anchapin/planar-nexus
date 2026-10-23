module.exports = {
  extends: ["@commitlint/config-conventional"],
  formatter: "@commitlint/format",
  rules: {
    "header-min-length": [2, "always", 10],
    "header-max-length": [2, "always", 110],
    // GitHub squash-merge bodies list each squashed commit subject as a
    // `* ` bullet. The inherited limit of 100 chars fails a bullet whose
    // subject is ~98+ chars (issue #2837). 120 tolerates commit subjects up
    // to ~118 chars (bullet prefix is 2 chars) while still erroring on
    // genuinely over-long body lines.
    "body-max-line-length": [2, "always", 120],
    "header-case": [2, "always", ["lower-case"]],
    "type-empty": [2, "never"],
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "docs", "style", "refactor", "test", "chore", "revert"],
    ],
  },
};

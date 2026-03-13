import type { ProjectSkill } from "./skills.js";

function createBuiltinSkill(name: string, description: string, content: string): ProjectSkill {
  return {
    name,
    description,
    location: `builtin://${name}`,
    content: content.trim(),
    origin: "builtin"
  };
}

const FIND_SKILLS_DESCRIPTION = "Discover and install mono skills whenever the user asks how to do something, asks for a skill, or wants to extend mono with reusable capabilities. Prefer this skill before inventing a new workflow from scratch.";

const FIND_SKILLS_CONTENT = `
# Find Skills

Use this skill when the user wants an existing skill instead of a bespoke answer.

## When to Use

- The user asks "find a skill for X"
- The user asks whether a reusable skill exists
- The user wants to extend mono with a domain workflow
- The user describes a repeatable task that should probably be installed once and reused

## Workflow

1. Translate the request into a short search query.
2. Run \`mono skills find <query>\`.
3. Present the most relevant results with:
   - the skill name
   - what it helps with
   - the install command: \`mono skills add <owner/repo@skill>\`
   - the \`https://skills.sh/\` page if available
4. If the user wants it installed, install it with \`mono skills add <owner/repo@skill>\`.
5. Remind the user that mono installs remote skills into \`~/.mono/skills\` by default.

## Search Tips

- Prefer specific two- or three-word queries over broad single terms.
- If the first query is weak, try an adjacent term instead of repeating the same search.
- If no good result exists, say so plainly and continue the task without forcing a skill install.

## Response Pattern

Use concise results like:

\`\`\`text
I found a relevant skill:
- react-performance-optimization: React performance tuning guidance and workflow

Install with:
mono skills add nickcrew/claude-ctx-plugin@react-performance-optimization

More info:
https://skills.sh/nickcrew/claude-ctx-plugin/react-performance-optimization
\`\`\`
`;

const SKILL_CREATOR_DESCRIPTION = "Create or refine mono skills whenever the user wants to turn a workflow into a reusable skill, improve an existing skill, or tighten skill trigger descriptions and packaging.";

const SKILL_CREATOR_CONTENT = `
# Skill Creator

Use this skill to create or improve reusable mono skills.

## Goal

Capture a repeatable workflow as a skill directory containing \`SKILL.md\` and any supporting resources.

## Skill Structure

\`\`\`text
<skill-name>/
  SKILL.md
  references/    # optional
  scripts/       # optional
  assets/        # optional
\`\`\`

Mono recognizes skills from:

- project scope: \`.mono/skills/<skill-name>/SKILL.md\`
- global scope: \`~/.mono/skills/<skill-name>/SKILL.md\`

## Workflow

1. Clarify what the skill should enable, when it should trigger, and what good output looks like.
2. Write a direct \`name\` and a pushy \`description\` in YAML frontmatter so the skill triggers reliably.
3. Keep the main instructions in \`SKILL.md\` focused on one reusable workflow.
4. Move bulky references, templates, or deterministic helpers into sibling folders instead of overloading the main file.
5. Create 2-3 realistic prompts to sanity-check the skill after writing it.

## Writing Rules

- Prefer imperative instructions.
- Explain the workflow clearly enough that another agent can execute it without guessing.
- Keep names searchable and descriptions explicit about when to use the skill.
- Avoid hidden side effects, secret handling shortcuts, or instructions that surprise the user.

## Suggested Frontmatter

\`\`\`yaml
---
name: my-skill
description: Explain what the skill does and when to use it. Mention the user intents that should trigger it.
---
\`\`\`

## Validation

After drafting or updating a skill:

1. Inspect the final \`SKILL.md\` for clear triggering language.
2. Verify the directory layout matches mono's loader expectations.
3. Try a couple of realistic prompts and confirm the skill would activate for them.
`;

export function getBuiltinSkills(): ProjectSkill[] {
  return [
    createBuiltinSkill("find-skills", FIND_SKILLS_DESCRIPTION, FIND_SKILLS_CONTENT),
    createBuiltinSkill("skill-creator", SKILL_CREATOR_DESCRIPTION, SKILL_CREATOR_CONTENT)
  ];
}

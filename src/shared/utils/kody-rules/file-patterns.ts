export const RULE_FILE_PATTERNS = [
    // Cursor
    '.cursorrules',
    '.cursor/rules/**/*.mdc',

    // GitHub Copilot
    '.github/copilot-instructions.md',
    '.github/instructions/**/*.instructions.md',

    // Agentic
    '.agents.md',
    '.agent.md',

    // Claude
    'CLAUDE.md',
    '.claude/settings.json',

    // Windsurf
    '.windsurfrules',

    // Sourcegraph Cody
    '.sourcegraph/**/*.rule.md',

    // OpenCode
    '.opencode.json',

    // Aider
    '.aider.conf.yml',
    '.aiderignore',

    // Generic / internal
    '.rules/**/*',
    '.kody/rules/*',
    'docs/coding-standards/**/*',
] as const;

export type RuleFilePattern = (typeof RULE_FILE_PATTERNS)[number];

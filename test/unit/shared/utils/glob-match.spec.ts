import { isFileMatchingGlob } from '../../../../src/shared/utils/glob-utils';

describe('globMatch', () => {
    it('matches .cursor/rules/**/*.mdc against rule files in tree', () => {
        const pattern = '.cursor/rules/**/*.mdc';
        expect(
            isFileMatchingGlob('.cursor/rules/accessibility.mdc', [pattern]),
        ).toBe(true);
        expect(
            isFileMatchingGlob('.cursor/rules/animation.mdc', [pattern]),
        ).toBe(true);
        expect(isFileMatchingGlob('.cursor/rules/assets.mdc', [pattern])).toBe(
            true,
        );
        expect(isFileMatchingGlob('.gitignore', [pattern])).toBe(false);
    });

    it('matches when provider returns a leading slash', () => {
        const pattern = '.cursor/rules/**/*.mdc';
        expect(
            isFileMatchingGlob('/.cursor/rules/accessibility.mdc', [pattern]),
        ).toBe(true);
        expect(
            isFileMatchingGlob('/.cursor/rules/sub/dir/file.mdc', [pattern]),
        ).toBe(true);
    });

    it('matches nested folders with **', () => {
        const pattern = '.cursor/rules/**/*.mdc';
        expect(
            isFileMatchingGlob('.cursor/rules/sub/dir/file.mdc', [pattern]),
        ).toBe(true);
        expect(
            isFileMatchingGlob('.cursor/rules/subdir/file.txt', [pattern]),
        ).toBe(false);
    });

    it('matches exact files and directories', () => {
        expect(isFileMatchingGlob('.cursorrules', ['.cursorrules'])).toBe(true);
        expect(isFileMatchingGlob('CLAUDE.md', ['CLAUDE.md'])).toBe(true);
        expect(
            isFileMatchingGlob('docs/coding-standards/guide.md', [
                'docs/coding-standards/**/*',
            ]),
        ).toBe(true);
    });

    it('does not let single * cross directory boundaries', () => {
        expect(isFileMatchingGlob('docs/a.md', ['docs/*'])).toBe(true);
        expect(isFileMatchingGlob('docs/a/b.md', ['docs/*'])).toBe(false);
    });

    it('supports character class and ? wildcard', () => {
        expect(isFileMatchingGlob('file-a.md', ['file-[ab].md'])).toBe(true);
        expect(isFileMatchingGlob('file-b.md', ['file-[ab].md'])).toBe(true);
        expect(isFileMatchingGlob('file-c.md', ['file-[ab].md'])).toBe(false);
        expect(isFileMatchingGlob('a.md', ['?.md'])).toBe(true);
        expect(isFileMatchingGlob('ab.md', ['?.md'])).toBe(false);
    });

    it('supports brace expansion for extensions', () => {
        expect(isFileMatchingGlob('src/app.ts', ['src/**/*.{ts,js}'])).toBe(
            true,
        );
        expect(isFileMatchingGlob('src/app.js', ['src/**/*.{ts,js}'])).toBe(
            true,
        );
        expect(isFileMatchingGlob('src/app.jsx', ['src/**/*.{ts,js}'])).toBe(
            false,
        );
    });

    it('matches dotfiles when pattern includes a dotfile', () => {
        expect(isFileMatchingGlob('.aiderignore', ['.aiderignore'])).toBe(true);
        expect(isFileMatchingGlob('.aider.conf.yml', ['.aider.conf.yml'])).toBe(
            true,
        );
        expect(
            isFileMatchingGlob('.github/copilot-instructions.md', [
                '.github/copilot-instructions.md',
            ]),
        ).toBe(true);
    });

    it('matches more repository rule patterns', () => {
        expect(
            isFileMatchingGlob('.sourcegraph/rules/one.rule.md', [
                '.sourcegraph/**/*.rule.md',
            ]),
        ).toBe(true);
        expect(
            isFileMatchingGlob('.rules/backend/security.md', ['.rules/**/*']),
        ).toBe(true);
        expect(isFileMatchingGlob('.kody/rules.json', ['.kody/**/*'])).toBe(
            true,
        );
        expect(isFileMatchingGlob('.windsurfrules', ['.windsurfrules'])).toBe(
            true,
        );
    });
});

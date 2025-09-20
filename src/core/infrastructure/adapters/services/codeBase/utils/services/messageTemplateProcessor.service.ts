// services/message-template-processor.service.ts
import { Injectable } from '@nestjs/common';
import { FileChange } from '@/config/types/general/codeReview.type';
import { OrganizationAndTeamData } from '@/config/types/general/organizationAndTeamData';
import { CodeReviewConfig } from '@/config/types/general/codeReview.type';
import { PlatformType } from '@/shared/domain/enums/platform-type.enum';
import { LanguageValue } from '@/shared/domain/enums/language-parameter.enum';
import {
    getTranslationsForLanguageByCategory,
    TranslationsCategory,
} from '@/shared/utils/translations/translations';

export interface PlaceholderContext {
    changedFiles?: FileChange[];
    codeReviewConfig?: CodeReviewConfig;
    language?: string;
    platformType?: PlatformType;
    organizationAndTeamData?: OrganizationAndTeamData;
    prNumber?: number;
}

export type PlaceholderHandler = (
    context: PlaceholderContext,
) => Promise<string> | string;

@Injectable()
export class MessageTemplateProcessor {
    private handlers = new Map<string, PlaceholderHandler>();

    constructor() {
        this.registerDefaultHandlers();
    }

    private registerDefaultHandlers(): void {
        this.handlers.set('changedFiles', this.generateChangedFilesTable);
        this.handlers.set('changeSummary', this.generateChangeSummary);
        this.handlers.set('reviewOptions', this.generateReviewOptionsAccordion);
    }

    /**
     * Process the template with the registered handlers
     *
     * Available placeholders:
     * @changedFiles - requires: context.changedFiles, context.language
     * @changeSummary - requires: context.changedFiles, context.language
     * @reviewOptions - requires: context.codeReviewConfig, context.language
     *
     * @param template Template with @placeholders
     * @param context Context for the handlers
     * @returns Processed template with the handlers applied
     */
    async processTemplate(
        template: string,
        context: PlaceholderContext,
    ): Promise<string> {
        let processedContent = template;

        const placeholderRegex = /@(\w+)/g;
        const matches = [...template.matchAll(placeholderRegex)];

        for (const match of matches) {
            const placeholder = match[1];
            const handler = this.handlers.get(placeholder);

            if (handler) {
                const replacement = await handler(context);
                processedContent = processedContent.replace(
                    match[0],
                    replacement,
                );
            }
        }

        return processedContent;
    }

    // Registra novos handlers dinamicamente
    registerHandler(placeholder: string, handler: PlaceholderHandler): void {
        this.handlers.set(placeholder, handler);
    }

    // Lista handlers disponíveis
    getAvailablePlaceholders(): string[] {
        return Array.from(this.handlers.keys()).map((key) => `@${key}`);
    }

    /**
     * Generate the accordion with the changed files table
     * @requires context.changedFiles - Array of changed files
     * @requires context.language - Language for translation
     * @param context PlaceholderContext
     * @returns Markdown of the accordion with the changed files table
     */
    private generateChangedFilesTable = (
        context: PlaceholderContext,
    ): string => {
        if (!context.changedFiles?.length) return '';

        const translation = this.getTranslation(context.language);

        const filesTable = context.changedFiles
            .map(
                (file) =>
                    `| [${file.filename}](${file.blob_url}) | ${file.status} | ${file.additions} | ${file.deletions} | ${file.changes} |`,
            )
            .join('\n');

        return `
<details>
<summary>${translation.changedFiles}</summary>

| ${translation.filesTable.join(' | ')} |
|------|--------|-------------|-------------|------------|
${filesTable}
</details>`.trim();
    };

    /**
     * Generate the accordion with the change summary
     * @requires context.changedFiles - Array of changed files
     * @requires context.language - Language for translation
     * @param context PlaceholderContext
     * @returns Markdown of the accordion with the change summary
     */
    private generateChangeSummary = (context: PlaceholderContext): string => {
        if (!context.changedFiles?.length) return '';

        const translation = this.getTranslation(context.language);

        const totalFilesModified = context.changedFiles.length;
        const totalAdditions = context.changedFiles.reduce(
            (acc, file) => acc + file.additions,
            0,
        );
        const totalDeletions = context.changedFiles.reduce(
            (acc, file) => acc + file.deletions,
            0,
        );
        const totalChanges = context.changedFiles.reduce(
            (acc, file) => acc + file.changes,
            0,
        );

        return `
<details>
<summary>${translation.summary}</summary>

- **${translation.totalFiles}**: ${totalFilesModified}
- **${translation.totalAdditions}**: ${totalAdditions}
- **${translation.totalDeletions}**: ${totalDeletions}
- **${translation.totalChanges}**: ${totalChanges}
</details>`.trim();
    };

    /**
     * Generate the accordion with the review options
     * @requires context.codeReviewConfig - Review configuration
     * @param context PlaceholderContext
     * @returns Markdown of the accordion with the review options
     */
    private generateReviewOptionsAccordion = (
        context: PlaceholderContext,
    ): string => {
        if (!context.codeReviewConfig?.reviewOptions) return '';

        const language =
            context.codeReviewConfig?.languageResultPrompt ??
            LanguageValue.ENGLISH;
        const translation = getTranslationsForLanguageByCategory(
            language as LanguageValue,
            TranslationsCategory.ConfigReviewMarkdown,
        );

        if (!translation) return '';

        const reviewOptionsMarkdown = Object.entries(
            context.codeReviewConfig.reviewOptions,
        )
            .map(
                ([key, value]) =>
                    `| **${key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())}** | ${
                        value ? translation.enabled : translation.disabled
                    } |`,
            )
            .join('\n');

        return `
<details>
<summary>${translation.reviewOptionsTitle}</summary>

${translation.reviewOptionsDesc}

| ${translation.tableOptions}                        | ${translation.tableEnabled} |
|-------------------------------|---------|
${reviewOptionsMarkdown}

</details>`.trim();
    };

    private getTranslation(language?: string) {
        return getTranslationsForLanguageByCategory(
            (language as LanguageValue) ?? LanguageValue.ENGLISH,
            TranslationsCategory.PullRequestSummaryMarkdown,
        );
    }
}

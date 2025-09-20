import { DynamicModule, LoggerService, Module, Provider } from '@nestjs/common';
import { LLMProviderService } from './llmModelProvider.service';
import { PromptRunnerService } from './promptRunner.service';

export type LLMModuleOptions = {
    logger: Provider<LoggerService>;
    global?: boolean;
};

@Module({})
export class LLMModule {
    static forRoot(options: LLMModuleOptions): DynamicModule {
        return {
            module: LLMModule,
            providers: [
                LLMProviderService,
                PromptRunnerService,
                {
                    provide: 'LLM_LOGGER',
                    useExisting: options.logger,
                },
            ],
            exports: [LLMProviderService, PromptRunnerService],
            global: options.global ?? true,
        };
    }
}

import { DynamicModule, Global, Module } from '@nestjs/common';
import { AST_ANALYSIS_SERVICE_TOKEN } from '@/core/domain/codeBase/contracts/ASTAnalysisService.contract';
import { CodeAstAnalysisService } from '@/ee/kodyAST/codeASTAnalysis.service';
import { LogModule } from '@/modules/log.module';
import { PlatformIntegrationModule } from '@/modules/platformIntegration.module';
import {
    ClientProviderOptions,
    ClientsModule,
    ClientsProviderAsyncOptions,
} from '@nestjs/microservices';
import { AST_MICROSERVICE_OPTIONS } from '../configs/microservices/ast-options';
import { environment } from '../configs/environment';
import { TASK_MICROSERVICE_OPTIONS } from '../configs/microservices/task-options';

const staticImports = [LogModule, PlatformIntegrationModule];
const dynamicImports =
    environment.API_CLOUD_MODE && process.env.API_ENABLE_CODE_REVIEW_AST
        ? [
              ClientsModule.register([
                  AST_MICROSERVICE_OPTIONS,
                  TASK_MICROSERVICE_OPTIONS,
              ]),
          ]
        : [];

const providers = [];
const moduleExports = [AST_ANALYSIS_SERVICE_TOKEN];

if (environment.API_CLOUD_MODE && process.env.API_ENABLE_CODE_REVIEW_AST) {
    providers.push({
        provide: AST_ANALYSIS_SERVICE_TOKEN,
        useClass: CodeAstAnalysisService,
    });
} else {
    // Self-hosted mode, provide null services
    providers.push({ provide: AST_ANALYSIS_SERVICE_TOKEN, useValue: null });
}

@Global()
@Module({
    imports: [...staticImports, ...dynamicImports],
    providers,
    exports: moduleExports,
})
export class KodyASTModule {}

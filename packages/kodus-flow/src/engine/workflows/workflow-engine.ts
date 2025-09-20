// import {
//     AnyEvent,
//     EVENT_TYPES,
//     Step,
//     StepContext,
//     TEvent,
//     WorkflowDefinition,
//     workflowEvent,
// } from '@/core/types/allTypes.js';
// import { createLogger } from '../../observability/index.js';
// import { MultiKernelHandler } from '../core/multi-kernel-handler.js';

// // Workflow engine
// export class WorkflowEngine {
//     private readonly logger = createLogger('WorkflowEngine');
//     private kernelHandler?: MultiKernelHandler;

//     // Mock createWorkflow function
//     private createWorkflow(config: { name: string }) {
//         return {
//             name: config.name,
//             on: (_event: unknown, _handler: unknown) => {},
//             createContext: () => ({
//                 sendEvent: async (_event: unknown) => {},
//             }),
//         };
//     }

//     constructor(
//         private readonly definition: WorkflowDefinition,
//         kernelHandler?: MultiKernelHandler,
//     ) {
//         this.kernelHandler = kernelHandler;
//         this.logger.info('WorkflowEngine created', {
//             hasKernelHandler: !!kernelHandler,
//         });
//     }

//     /**
//      * Creates a workflow that executes steps sequentially
//      */
//     createExecutableWorkflow() {
//         const workflow = this.createWorkflow({ name: this.definition.name });
//         const state = new Map<string, unknown>();

//         // Create events for each step
//         const stepEvents = new Map<string, ReturnType<typeof workflowEvent>>();
//         this.definition.steps?.forEach((step) => {
//             stepEvents.set(step.name, workflowEvent(`step.${step.name}`));
//         });

//         // Create workflow events
//         const startEvent = workflowEvent(EVENT_TYPES.WORKFLOW_START);
//         const completeEvent = workflowEvent(EVENT_TYPES.WORKFLOW_COMPLETE);
//         const errorEvent = workflowEvent(EVENT_TYPES.WORKFLOW_ERROR);

//         // Wire up step handlers
//         this.definition.steps.forEach((step, index) => {
//             const currentStepEvent = stepEvents.get(step.name);
//             const nextStep = this.definition.steps[index + 1];
//             const nextStepEvent = nextStep
//                 ? stepEvents.get(nextStep.name)
//                 : completeEvent;

//             if (!currentStepEvent) {
//                 this.logger.warn(`Step event not found for: ${step.name}`);
//                 return;
//             }

//             workflow.on(`step.${step.name}`, async (event: AnyEvent) => {
//                 // Criar contexto do step inline
//                 const stepContext = {
//                     stepName: step.name,
//                     workflowName: this.definition.name,
//                     stepIndex: index,
//                     totalSteps: this.definition.steps.length,
//                     dependencies: [],
//                     tenantId: 'default',
//                     executionId: Date.now().toString(),
//                     correlationId: Date.now().toString(),
//                 };

//                 const stepContextEnhanced: StepContext = {
//                     executionId: stepContext.executionId,
//                     correlationId:
//                         stepContext.correlationId || Date.now().toString(),
//                     state,
//                     logger: this.logger,
//                     getState<T = unknown>(key: string): T | undefined {
//                         return state.get(key) as T | undefined;
//                     },
//                     setState<T = unknown>(key: string, value: T): void {
//                         state.set(key, value);
//                     },
//                 };

//                 // Emit workflow step start event via KernelHandler
//                 if (this.kernelHandler) {
//                     await this.kernelHandler.emit('workflow.step.start', {
//                         workflowName: this.definition.name,
//                         stepName: step.name,
//                         executionId: stepContext.executionId,
//                         correlationId: stepContext.correlationId,
//                     });
//                 }

//                 try {
//                     this.logger.info(`Executing step: ${step.name}`, {
//                         step: step.name,
//                         input: event.data,
//                     });

//                     const result = await step.handler(
//                         event.data,
//                         stepContextEnhanced,
//                     );

//                     // Emit workflow step success event via KernelHandler
//                     if (this.kernelHandler) {
//                         await this.kernelHandler.emit('workflow.step.success', {
//                             workflowName: this.definition.name,
//                             stepName: step.name,
//                             executionId: stepContext.executionId,
//                             correlationId: stepContext.correlationId,
//                             hasResult: result !== undefined,
//                         });
//                     }

//                     this.logger.info(`Step completed: ${step.name}`, {
//                         step: step.name,
//                         hasResult: result !== undefined,
//                     });

//                     if (nextStepEvent === completeEvent) {
//                         return {
//                             type: 'workflow.complete',
//                             data: { result },
//                             ts: Date.now(),
//                         };
//                     } else {
//                         return {
//                             type: `step.${nextStep?.name || 'unknown'}`,
//                             data: result,
//                             ts: Date.now(),
//                         };
//                     }
//                 } catch (error) {
//                     // Emit workflow step error event via KernelHandler
//                     if (this.kernelHandler) {
//                         await this.kernelHandler.emit('workflow.step.error', {
//                             workflowName: this.definition.name,
//                             stepName: step.name,
//                             executionId: stepContext.executionId,
//                             correlationId: stepContext.correlationId,
//                             error: (error as Error).message,
//                         });
//                     }

//                     this.logger.error(
//                         `Step failed: ${step.name}`,
//                         error as Error,
//                         {
//                             step: step.name,
//                         },
//                     );

//                     return {
//                         type: 'workflow.error',
//                         data: {
//                             error: error as Error,
//                             step: step.name,
//                         },
//                         ts: Date.now(),
//                     };
//                 }
//             });
//         });

//         // Start handler
//         workflow.on('workflow.start', async (event: AnyEvent) => {
//             const firstStep = this.definition.steps[0];
//             if (!firstStep) {
//                 return {
//                     type: 'workflow.complete',
//                     data: {
//                         result: (event.data as { input?: unknown })?.input,
//                     },
//                     ts: Date.now(),
//                 };
//             }

//             const firstStepEvent = stepEvents.get(firstStep.name);
//             if (!firstStepEvent) {
//                 return {
//                     type: 'workflow.error',
//                     data: {
//                         error: new Error(
//                             `Step event not found: ${firstStep.name}`,
//                         ),
//                         step: firstStep.name,
//                     },
//                     ts: Date.now(),
//                 };
//             }
//             return {
//                 type: `step.${firstStep.name}`,
//                 data: (event.data as { input?: unknown })?.input,
//                 ts: Date.now(),
//             };
//         });

//         return {
//             workflow,
//             startEvent,
//             completeEvent,
//             errorEvent,
//             stepEvents,
//         };
//     }

//     /**
//      * Execute the workflow with input
//      */
//     async execute<TInput = unknown, TOutput = unknown>(
//         input: TInput,
//     ): Promise<TOutput> {
//         const { workflow } = this.createExecutableWorkflow();
//         const ctx = workflow.createContext();

//         const resultPromise = new Promise<TOutput>((resolve, reject) => {
//             workflow.on('workflow.complete', (event: AnyEvent) => {
//                 resolve(
//                     (event.data as { result?: TOutput })?.result as TOutput,
//                 );
//             });

//             workflow.on('workflow.error', (event: TEvent) => {
//                 reject((event.data as { error?: Error })?.error);
//             });
//         });

//         await ctx.sendEvent({
//             type: 'workflow.start',
//             data: { input },
//             ts: Date.now(),
//         });
//         return resultPromise;
//     }

//     /**
//      * Set KernelHandler (for dependency injection)
//      */
//     setKernelHandler(kernelHandler: MultiKernelHandler): void {
//         this.kernelHandler = kernelHandler;
//         this.logger.info('KernelHandler set for WorkflowEngine');
//     }

//     /**
//      * Get KernelHandler status
//      */
//     hasKernelHandler(): boolean {
//         return !!this.kernelHandler;
//     }
// }

// // Builder API
// export class WorkflowBuilder {
//     private steps: Step<unknown, unknown>[] = [];

//     constructor(private name: string) {}

//     step<TStepInput = unknown, TStepOutput = unknown>(
//         name: string,
//         handler: (input: TStepInput, ctx: StepContext) => Promise<TStepOutput>,
//     ): this {
//         const typedStep: Step<unknown, unknown> = {
//             name,
//             handler: async (
//                 input: unknown,
//                 ctx: StepContext,
//             ): Promise<unknown> => {
//                 return await handler(input as TStepInput, ctx);
//             },
//         };
//         this.steps.push(typedStep);
//         return this;
//     }

//     build(): WorkflowEngine {
//         return new WorkflowEngine({
//             name: this.name,
//             steps: this.steps,
//         });
//     }
// }

// // Factory function
// export function defineWorkflow(name: string): WorkflowBuilder {
//     return new WorkflowBuilder(name);
// }

// // Helper function
// export function createStep<TInput = unknown, TOutput = unknown>(
//     name: string,
//     handler: (input: TInput, ctx: StepContext) => Promise<TOutput>,
// ): Step<TInput, TOutput> {
//     return {
//         name,
//         handler,
//     };
// }

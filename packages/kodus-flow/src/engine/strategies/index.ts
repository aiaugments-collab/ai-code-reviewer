// 🎯 STRATEGY LAYER - Main exports
// Estratégias com arquitetura limpa e design patterns corretos

// Core Strategy Components
export { StrategyFactory } from './strategy-factory.js';
export { BaseExecutionStrategy } from './strategy-interface.js';

// Strategy Implementations (Clean Architecture)
export { ReActStrategy } from './react-strategy.js';
export { ReWooStrategy } from './rewoo-strategy.js';
export { PlanExecuteStrategy } from './plan-execute-strategy.js';

// Shared Components
export { SharedStrategyMethods } from './shared-methods.js';
export {
    createStopConditions,
    stopConditions,
    isStopConditionMet,
} from './stop-conditions.js';

// Advanced Prompt & Formatting Utils
export {
    StrategyFormatters,
    ToolParameterFormatter,
    ContextFormatter,
    SchemaFormatter,
} from './prompts/index.js';

// Types and Interfaces
export type {
    ExecutionStrategy,
    StrategyExecutionContext,
    ExecutionStep,
    ExecutionResult,
    StrategyConfig,
    StopCondition,
    ExecutionMetadata,
    AgentAction,
    AgentThought,
    ActionResult,
    ResultAnalysis,
    Tool,
    ToolCall,
    PlanStep,
    ExecutionPlan,
} from './types.js';

// Factory Types
export type { StrategyType, BaseStrategyConfig } from './strategy-factory.js';

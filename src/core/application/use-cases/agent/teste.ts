import { IUseCase } from '@/shared/domain/interfaces/use-case.interface';
import { Injectable } from '@nestjs/common';
// import { createOrchestration, defineAgent, defineTool } from '@kodus/flow';
import { z } from 'zod';

@Injectable()
export class NewAgentUseCase implements IUseCase {
    // private orchestration = createOrchestration({
    //     debug: true, // Para mais logs de debugging
    // });
    // private engine = this.orchestration.createEngine({
    //     tenant: { tenantId: 'agent-service' },
    // });

    // constructor() {
    //     // Definir e registrar ferramentas
    //     const calculatorTool = defineTool({
    //         name: 'calculator',
    //         description: 'Perform basic math calculations',
    //         schema: z.object({
    //             operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    //             a: z.number(),
    //             b: z.number(),
    //         }),
    //         execute: async ({ operation, a, b }) => {
    //             switch (operation) {
    //                 case 'add':
    //                     return a + b;
    //                 case 'subtract':
    //                     return a - b;
    //                 case 'multiply':
    //                     return a * b;
    //                 case 'divide':
    //                     return b !== 0 ? a / b : 'Error: Division by zero';
    //                 default:
    //                     return 'Unknown operation';
    //             }
    //         },
    //     });

    //     // Definir e registrar agente
    //     const assistantAgent = defineAgent({
    //         name: 'AssistantAgent',
    //         description: 'AI assistant that helps with various tasks',
    //         think: async (input: string, context) => {
    //             // Detectar se é uma operação matemática
    //             const mathPattern = /(\d+)\s*([\+\-\*\/])\s*(\d+)/;
    //             const match = input.match(mathPattern);

    //             if (match) {
    //                 const [_, aStr, opStr, bStr] = match;
    //                 const a = Number(aStr);
    //                 const b = Number(bStr);

    //                 let operation: 'add' | 'subtract' | 'multiply' | 'divide';
    //                 switch (opStr) {
    //                     case '+':
    //                         operation = 'add';
    //                         break;
    //                     case '-':
    //                         operation = 'subtract';
    //                         break;
    //                     case '*':
    //                         operation = 'multiply';
    //                         break;
    //                     case '/':
    //                         operation = 'divide';
    //                         break;
    //                     default:
    //                         operation = 'add';
    //                 }

    //                 return {
    //                     reasoning: `Detectei uma operação matemática: ${a} ${opStr} ${b}`,
    //                     action: {
    //                         type: 'tool_call',
    //                         toolName: 'calculator',
    //                         input: { operation, a, b },
    //                     },
    //                 };
    //             }

    //             // Resposta padrão para outras entradas
    //             return {
    //                 reasoning: 'Processando entrada geral do usuário',
    //                 action: {
    //                     type: 'final_answer',
    //                     content: `Você disse: "${input}". Como posso ajudar?`,
    //                 },
    //             };
    //         },
    //     });

    //     // // Registrar ferramentas e agentes no engine
    //     // this.engine.withTools([calculatorTool]);
    //     // this.engine.withAgent(assistantAgent);
    // }

    async execute(): Promise<any> {
        try {
            // console.log(require.resolve('@kodus/flow'));
            // const agentName = 'AssistantAgent'; // Valor padrão se não for especificado

            // Chamar o agente com o prompt fornecido
            // const result = await this.engine.call(
            //     agentName,
            //     'Qual é a raiz quadrada de 16?',
            // );

            // return {
            //     response: result.data as string,
            //     reasoning: result.status,
            // };
            return true;
        } catch (error) {
            console.error('Erro ao processar prompt com agente:', error);
            throw new Error(`Falha ao processar prompt: ${error.message}`);
        }
    }
}

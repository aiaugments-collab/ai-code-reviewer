import { Document } from '@langchain/core/documents';
import { OpenAIEmbeddings } from '@langchain/openai';
import 'dotenv/config';
import { TokenTextSplitter } from 'langchain/text_splitter';
import { shouldProcessNotBugItems } from '../helpers';
import { OpenAIAssistantRunnable } from 'langchain/experimental/openai_assistant';
import axios from 'axios';
import { traceable } from 'langsmith/traceable';

interface OpenAIEmbeddingResponse {
    data: Array<{
        embedding: number[];
        index: number;
        object: string;
    }>;
    model: string;
    object: string;
}

/**
 * Creates a new document object based on the provided formatted data.
 *
 * @param {any} formattedData - The formatted data used to create the document.
 * @return {Document} The newly created document Langchain object Type.
 */
const createDocument = (
    formattedData: any,
    metaData?: Record<string, any>,
): Document => {
    return new Document({
        pageContent: formattedData,
        metadata: { ...metaData },
    });
};

/**
 * Creates an array of Document objects based on the provided payload.
 *
 * @param {any} payload - The data used to generate the Document objects.
 * @return {Document[]} - An array of Document objects.
 */
const createDataPointDocument = (payload: any): Document[] => {
    return payload.map((data) => {
        const pageContent = `Narrative Entity Extration: ${data.narrativeEntityExtraction.text} |KODUS| Narrative: ${data.questionNarrative}`;

        return createDocument(
            pageContent,
            data.narrativeEntityExtraction.entities,
        );
    });
};

/**
 * Splits the payload into chunks and returns the result asynchronously.
 *
 * @param {any} payload - The payload to be split into chunks.
 * @param {Object} [options] - Optional parameters for chunk size and overlap.
 * @param {number} [options.chunkSize=1000] - The size of each chunk.
 * @param {number} [options.chunkOverlap=100] - The overlap between each chunk.
 * @return {Promise<any>} A promise that resolves to the result of splitting the payload into chunks.
 */
const splitPayloadIntoChunks = async (
    payload: any,
    options?: {
        chunkSize?: number;
        chunkOverlap?: number;
    } | null,
): Promise<any> => {
    const defaultOptions = {
        chunkSize: 1000,
        chunkOverlap: 100,
    };

    const finalOptions = options
        ? { ...defaultOptions, ...options }
        : defaultOptions;

    const splitter = new TokenTextSplitter({
        encodingName: 'cl100k_base',
        chunkSize: finalOptions.chunkSize,
        chunkOverlap: finalOptions.chunkOverlap,
    });

    return await splitter.splitDocuments(payload);
};

/**
 * Creates a new instance of the OpenAIEmbeddings class.
 *
 * @return {OpenAIEmbeddings} The newly created OpenAIEmbeddings instance.
 */
const getEmbedding = () => {
    return new OpenAIEmbeddings({
        openAIApiKey: process.env.API_OPEN_AI_API_KEY,
        modelName: 'text-embedding-ada-002',
    });
};

const estimateTokenCount = (text: string) => {
    // Convert the string to a Blob and get its size in bytes
    const byteCount = new Blob([text]).size;

    // Estimate token count based on average of 4 bytes per token
    return Math.floor(byteCount / 4);
};

const checkOpenAIResult = (input: any, output: any, bugTypes: any): any => {
    try {
        const inputIds = input
            .filter(
                (workItem: any) =>
                    !shouldProcessNotBugItems(
                        workItem.workItemType.name,
                        bugTypes,
                    ),
            )
            .map((workItem: any) => workItem.workItemId.toString());

        const outputIds: any[] = output.map((item: any) =>
            item.workItemId.toString(),
        ); // Converting to string for comparison

        const outputKeys = output.map((item: any) => item.workItemKey);

        const missingIds: any[] = inputIds.filter(
            (workItemId: number) => !outputIds.includes(workItemId),
        );

        // Helper function to find duplicates
        const findDuplicates = (arr: any[]) =>
            arr.filter((item, index) => arr.indexOf(item) !== index);

        const duplicateIds = findDuplicates(outputIds);
        const duplicateKeys = findDuplicates(outputKeys);

        // Collect objects with issues
        const issuesToReprocess = [];

        // Adding missing objects
        missingIds.forEach((id) => {
            const item = input.find((item) => item.workItemId === id);
            if (item) issuesToReprocess.push(item);
        });

        // Adding objects with duplicate IDs
        duplicateIds.forEach((id) => {
            const items = input.filter((item) => item.workItemId === id);
            issuesToReprocess.push(...items);
        });

        // Adding objects with duplicate keys
        duplicateKeys.forEach((key) => {
            const items = input.filter((item) => item.workItemKey === key);
            issuesToReprocess.push(...items);
        });

        const issuesToReprocessIds = issuesToReprocess.map(
            (item) => item.workItemId,
        );

        const hasIssues = issuesToReprocess.length > 0;

        if (hasIssues) {
            return {
                response: false,
                message: `Issues were identified in the processed items.`,
                issuesToReprocess,
                issuesToReprocessIds,
            };
        }

        return {
            response: true,
            message: `Correct result!`,
        };
    } catch (error) {
        return {
            response: false,
            message: `Error while verifying the result: ${error.message}`,
        };
    }
};

const getOpenAIAssistant = (assistantId: string) => {
    return new OpenAIAssistantRunnable({
        assistantId: assistantId,
        clientOptions: { apiKey: process.env.API_OPEN_AI_API_KEY },
    });
};

const getOpenAIAssistantFileContent = async (fileId: string) => {
    // Langchain does not correctly return the fileContent because it does not accept the arraybuffer parameter.
    const response = await axios({
        url: `https://api.openai.com/v1/files/${fileId}/content`,
        method: 'GET',
        responseType: 'arraybuffer',
        headers: {
            Authorization: `Bearer ${process.env.API_OPEN_AI_API_KEY}`,
        },
    });

    // Retrieve the binary data directly from the response
    return response.data;
};

const getWorkItemIdsFromData = (data: any) => {
    const ids: any[] = [];
    data.data.forEach((column: any) => {
        column.workItems.forEach((workItem: any) => {
            ids.push(workItem.id);
        });
    });
    return ids;
};

const traceCustomLLMCall = async (
    inputMessage: any,
    outputMessage: string,
    name?: string,
    model?: string,
) => {
    const messages = [{ role: 'user', content: inputMessage }];

    const chatModel = traceable(
        async ({
            messages,
        }: {
            messages: { role: string; content: string }[];
        }) => {
            return outputMessage;
        },
        {
            run_type: 'llm',
            name: name || 'CustomLLMTracer',
            metadata: {
                ls_provider: 'CustomProvider',
                ls_model_name: model || 'CustomModel',
            },
        },
    );

    return await chatModel({ messages });
};

let embedder: OpenAIEmbeddings | null = null;

const getEmbedder = (options?: {
    model?: string;
    apiKey?: string;
}): OpenAIEmbeddings => {
    if (!embedder) {
        const defaultOptions = {
            model: 'text-embedding-3-small',
            apiKey: process.env.API_OPEN_AI_API_KEY,
        };

        const config = { ...defaultOptions, ...options };

        embedder = new OpenAIEmbeddings({
            openAIApiKey: config.apiKey,
            modelName: config.model,
        });
    }

    return embedder;
};

const getOpenAIEmbedding = async (
    input: string,
    options?: {
        model?: string;
        apiKey?: string;
    },
): Promise<OpenAIEmbeddingResponse> => {
    const defaultOptions = {
        model: 'text-embedding-3-small',
        apiKey: process.env.API_OPEN_AI_API_KEY,
    };

    const config = { ...defaultOptions, ...options };

    const embedder = getEmbedder(config);

    const embeddingVector = await embedder.embedQuery(input);

    return {
        data: [
            {
                embedding: embeddingVector,
                index: 0,
                object: 'embedding',
            },
        ],
        model: config.model,
        object: 'list',
    };
};

export {
    createDocument,
    createDataPointDocument,
    getEmbedding,
    splitPayloadIntoChunks,
    estimateTokenCount,
    checkOpenAIResult,
    getWorkItemIdsFromData,
    getOpenAIAssistant,
    getOpenAIAssistantFileContent,
    traceCustomLLMCall,
    getOpenAIEmbedding,
};

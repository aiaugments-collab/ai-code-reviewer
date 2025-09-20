import { MessageContentComplex } from "@langchain/core/messages";
import { StringOutputParser } from "@langchain/core/output_parsers";

export class CustomStringOutputParser extends StringOutputParser {
    protected _messageContentComplexToString(content: MessageContentComplex): string {
        if (content?.type === 'reasoning') {
            return '';
        }
        return super._messageContentComplexToString(content);
    }
}

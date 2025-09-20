import { Module } from '@nestjs/common';
import { TokenChunkingService } from '@/shared/utils/tokenChunking/tokenChunking.service';
import { LoggerModule } from 'nestjs-pino';

@Module({
    imports: [LoggerModule],
    providers: [TokenChunkingService],
    exports: [TokenChunkingService],
})
export class TokenChunkingModule {}

import { ClientProviderOptions, Transport } from '@nestjs/microservices';
import { resolve } from 'path';
import { cwd } from 'process';
import { buildGrpcCredentials } from './credentials';

export const TASK_MICROSERVICE_OPTIONS: ClientProviderOptions = {
    name: 'TASK_MICROSERVICE',
    transport: Transport.GRPC,
    options: {
        package: 'kodus.task.v1',
        protoPath: resolve(
            cwd(),
            'node_modules/@kodus/kodus-proto/kodus/task/v1/manager.proto',
        ),
        url: process.env.API_SERVICE_AST_URL ?? null,
        loader: {
            includeDirs: [resolve(cwd(), 'node_modules/@kodus/kodus-proto')],
        },
        credentials: buildGrpcCredentials(),
    },
};

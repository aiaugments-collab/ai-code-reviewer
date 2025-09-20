import { ClientProviderOptions, Transport } from '@nestjs/microservices';
import { resolve } from 'path';
import { cwd } from 'process';
import { buildGrpcCredentials } from './credentials';

export const AST_MICROSERVICE_OPTIONS: ClientProviderOptions = {
    name: 'AST_MICROSERVICE',
    transport: Transport.GRPC,
    options: {
        package: 'kodus.ast.v3',
        protoPath: resolve(
            cwd(),
            'node_modules/@kodus/kodus-proto/kodus/ast/v3/analyzer.proto',
        ),
        url: process.env.API_SERVICE_AST_URL ?? null,
        loader: {
            includeDirs: [resolve(cwd(), 'node_modules/@kodus/kodus-proto')],
        },
        credentials: buildGrpcCredentials(),
    },
};

import { ChannelCredentials, credentials } from '@grpc/grpc-js';
import * as fs from 'fs';
import { resolve } from 'path';
import { cwd } from 'process';

export function buildGrpcCredentials(): ChannelCredentials {
    const caPath = resolve(cwd(), 'certs/ca_cert.pem');
    if (fs.existsSync(caPath)) {
        const rootCa = fs.readFileSync(caPath);
        return credentials.createSsl(rootCa);
    }
    return credentials.createInsecure();
}

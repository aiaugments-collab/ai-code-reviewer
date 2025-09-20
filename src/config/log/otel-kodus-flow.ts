import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
    ParentBasedSampler,
    TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';

let sdk: NodeSDK | null = null;

export async function startKodusOtel() {
    if (sdk) {
        return;
    }
    process.env.OTEL_SERVICE_NAME = 'kodus-flow';

    sdk = new NodeSDK({
        traceExporter: new OTLPTraceExporter({
            url:
                process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
                'http://localhost:4318/v1/traces',
        }),
        sampler: new ParentBasedSampler({
            root: new TraceIdRatioBasedSampler(1),
        }),
    });
    await sdk.start();
}

export async function stopKodusOtel() {
    await sdk?.shutdown();
    sdk = null;
}

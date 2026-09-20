/**
 * Error reporting and traces, both optional. Nothing is imported unless the
 * corresponding variable is set, so a default install pulls in neither SDK.
 */

export interface TelemetryOptions {
  serviceName: string;
  /** Sentry DSN; error reporting is off when absent. */
  sentryDsn?: string | undefined;
  /** OTLP endpoint; tracing is off when absent. */
  otlpEndpoint?: string | undefined;
  environment?: string | undefined;
}

export interface Telemetry {
  shutdown(): Promise<void>;
}

export async function startTelemetry(options: TelemetryOptions): Promise<Telemetry> {
  const shutdowns: (() => Promise<void>)[] = [];

  if (options.sentryDsn) {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn: options.sentryDsn,
      environment: options.environment ?? 'production',
      // Logs and log excerpts are redacted before storage, but breadcrumbs are not
      // worth the risk of shipping log text to a third party.
      defaultIntegrations: false,
      tracesSampleRate: 0,
    });
    Sentry.setTag('service', options.serviceName);
    shutdowns.push(async () => {
      await Sentry.close(2000);
    });
  }

  if (options.otlpEndpoint) {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const { resourceFromAttributes } = await import('@opentelemetry/resources');

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({ 'service.name': options.serviceName }),
      traceExporter: new OTLPTraceExporter({ url: `${options.otlpEndpoint}/v1/traces` }),
    });
    sdk.start();
    shutdowns.push(() => sdk.shutdown());
  }

  return {
    async shutdown() {
      for (const stop of shutdowns) {
        try {
          await stop();
        } catch {
          // Shutting down telemetry must never hold up the process.
        }
      }
    },
  };
}

/** Reports an error if Sentry is configured; otherwise a no-op. */
export async function captureError(error: unknown): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  try {
    const Sentry = await import('@sentry/node');
    Sentry.captureException(error);
  } catch {
    // Reporting must never mask the original failure.
  }
}

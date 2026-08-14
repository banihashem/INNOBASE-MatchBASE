export interface TransportRequest {
  url: string;
  method: "POST";
  headers: Readonly<Record<string, string>>;
  body: string;
  signal: AbortSignal;
}

export interface TransportResponse {
  status: number;
  body: unknown;
}

export interface ProviderTransport {
  send(request: TransportRequest): Promise<TransportResponse>;
}

export interface ProviderAttemptOutcome {
  capabilityId: "CAP-STRUCTURED-GENERATION";
  routeId: string;
  providerId: string;
  modelId: string;
  environment: string;
  routeKind: "real_data" | "synthetic_fixture";
  dataHandlingPosture:
    "synthetic_fixture" | "zdr_verified" | "paid_no_training" | "unknown";
  timeoutMs: number;
  configuredMaxAttempts: number;
  configuredBackoffMs: number;
  allowFallbacks: boolean;
  attemptNumber: number;
  outcome: "ok" | "provider_error" | "timeout" | "cancelled";
  status?: number;
  backoffMs: number;
  startedAt: string;
  completedAt: string;
}

export type AttemptObserver = (
  outcome: ProviderAttemptOutcome,
) => void | Promise<void>;
export type Backoff = (milliseconds: number) => Promise<void>;

export async function executeProviderRequest(input: {
  route: ProviderRouteV1;
  transport: ProviderTransport;
  request: (signal: AbortSignal) => TransportRequest;
  signal: AbortSignal;
  onAttempt: AttemptObserver;
  validateResponse?: (response: TransportResponse) => void;
  backoff?: Backoff;
}): Promise<TransportResponse> {
  const pause: Backoff =
    input.backoff ??
    (async (milliseconds) =>
      await new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: Error | undefined;
  for (
    let attemptNumber = 1;
    attemptNumber <= input.route.retry.maxAttempts;
    attemptNumber += 1
  ) {
    if (attemptNumber > 1 && input.route.retry.backoffMs > 0)
      await pause(input.route.retry.backoffMs);
    const startedAt = new Date().toISOString();
    const observe = async (
      outcome: ProviderAttemptOutcome["outcome"],
      status?: number,
    ) => {
      await input.onAttempt({
        capabilityId: "CAP-STRUCTURED-GENERATION",
        routeId: input.route.routeId,
        providerId: input.route.providerId,
        modelId: input.route.modelId,
        environment: input.route.environment,
        routeKind: input.route.realData ? "real_data" : "synthetic_fixture",
        dataHandlingPosture:
          input.route.providerId === "synthetic_fixture"
            ? "synthetic_fixture"
            : input.route.retentionPosture === "zdr"
              ? "zdr_verified"
              : input.route.retentionPosture === "no_training_30d_logs"
                ? "paid_no_training"
                : "unknown",
        timeoutMs: input.route.timeoutMs,
        configuredMaxAttempts: input.route.retry.maxAttempts,
        configuredBackoffMs: input.route.retry.backoffMs,
        allowFallbacks: input.route.allowFallbacks,
        attemptNumber,
        outcome,
        ...(status === undefined ? {} : { status }),
        backoffMs: attemptNumber > 1 ? input.route.retry.backoffMs : 0,
        startedAt,
        completedAt: new Date().toISOString(),
      });
    };
    if (input.signal.aborted) {
      await observe("cancelled");
      throw new Error("Provider request was cancelled.");
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal.addEventListener("abort", abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: TransportResponse;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Provider request timed out."));
        }, input.route.timeoutMs);
      });
      response = await Promise.race([
        input.transport.send(input.request(controller.signal)),
        timeout,
      ]);
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error("Provider failure.");
      const timedOut = controller.signal.aborted && !input.signal.aborted;
      await observe(
        input.signal.aborted
          ? "cancelled"
          : timedOut
            ? "timeout"
            : "provider_error",
      );
      if (input.signal.aborted) throw lastError;
      continue;
    } finally {
      if (timer) clearTimeout(timer);
      input.signal.removeEventListener("abort", abort);
    }
    if (response.status >= 200 && response.status < 300) {
      try {
        input.validateResponse?.(response);
      } catch (error) {
        lastError =
          error instanceof Error
            ? error
            : new Error("Provider response validation failed.");
        await observe("provider_error", response.status);
        continue;
      }
      await observe("ok", response.status);
      return response;
    }
    lastError = new Error(`Provider returned HTTP ${response.status}.`);
    await observe("provider_error", response.status);
  }
  throw lastError ?? new Error("Provider request failed.");
}

export class DisabledNetworkTransport implements ProviderTransport {
  async send(_request: TransportRequest): Promise<TransportResponse> {
    throw new Error(
      "Provider network transport is disabled; inject an explicit test transport.",
    );
  }
}

export class RecordingFakeTransport implements ProviderTransport {
  readonly requests: TransportRequest[] = [];

  private index = 0;

  constructor(
    private readonly response:
      TransportResponse | readonly (TransportResponse | Error)[],
  ) {}

  async send(request: TransportRequest): Promise<TransportResponse> {
    this.requests.push(request);
    const response = Array.isArray(this.response)
      ? this.response[Math.min(this.index++, this.response.length - 1)]
      : this.response;
    if (response instanceof Error) throw response;
    if (!response) throw new Error("Fake transport has no response.");
    return response;
  }
}
import type { ProviderRouteV1 } from "@matchbase/contracts";

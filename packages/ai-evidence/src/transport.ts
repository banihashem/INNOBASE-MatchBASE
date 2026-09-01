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
  servedIdentity?: Readonly<{
    providerId: string;
    modelId: string;
  }>;
  accounting?: ProviderAccounting;
}

export interface ProviderAccounting {
  readonly state: "priced" | "estimated";
  readonly quantity: number;
  readonly unit: string;
  readonly amount: number;
  readonly currency: string;
  readonly pricingVersion: string;
  readonly measurement: "measured" | "estimated";
}

export interface ProviderTransport {
  send(request: TransportRequest): Promise<TransportResponse>;
}

/**
 * A transport can fail after a provider request was dispatched but before a
 * usable response body or served identity was recovered.  In that case the
 * provider's exact charge may be unavailable, while a governed conservative
 * estimate is still sufficient to close the cost ledger truthfully.
 */
export class ProviderTransportFailure extends Error {
  readonly status: number | undefined;
  readonly servedIdentity: TransportResponse["servedIdentity"];
  readonly accounting: ProviderAccounting;

  constructor(
    message: string,
    details: Readonly<{
      status?: number;
      servedIdentity?: TransportResponse["servedIdentity"];
      accounting: ProviderAccounting;
    }>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProviderTransportFailure";
    this.status = details.status;
    this.servedIdentity = details.servedIdentity;
    this.accounting = details.accounting;
  }
}

export interface ProviderAttemptOutcome {
  capabilityId: "CAP-SEARCH" | "CAP-STRUCTURED-GENERATION";
  routeId: string;
  providerId: string;
  modelId: string;
  requestedModelId: string;
  servedProviderId?: string;
  servedModelId?: string;
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
  costState: "priced" | "estimated" | "unknown" | "not_incurred";
  costAmount: number | null;
  costCurrency: string | null;
  costQuantity: number;
  costUnit: string | null;
  pricingVersion: string | null;
  costMeasurement: "measured" | "estimated" | null;
}

export type AttemptObserver = (
  outcome: ProviderAttemptOutcome,
) => void | Promise<void>;
export type Backoff = (milliseconds: number) => Promise<void>;

function validatedAccounting(
  response: TransportResponse | undefined,
  realData: boolean,
): ProviderAccounting | undefined {
  const value = response?.accounting;
  if (!value) {
    if (
      realData &&
      response &&
      response.status >= 200 &&
      response.status < 300
    ) {
      throw new Error(
        "Successful live provider response omitted cost accounting.",
      );
    }
    return undefined;
  }
  if (
    !new Set(["priced", "estimated"]).has(value.state) ||
    !Number.isFinite(value.quantity) ||
    value.quantity <= 0 ||
    !Number.isFinite(value.amount) ||
    (realData ? value.amount <= 0 : value.amount < 0) ||
    !value.unit ||
    !/^[A-Z]{3}$/u.test(value.currency) ||
    !value.pricingVersion ||
    !new Set(["measured", "estimated"]).has(value.measurement)
  ) {
    throw new Error("Provider response cost accounting is invalid.");
  }
  return value;
}

export async function executeProviderRequest(input: {
  capabilityId?: "CAP-SEARCH" | "CAP-STRUCTURED-GENERATION";
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
      servedIdentity?: TransportResponse["servedIdentity"],
      response?: TransportResponse,
      preflightCancelled = false,
    ) => {
      let accounting: ProviderAccounting | undefined;
      try {
        accounting = validatedAccounting(response, input.route.realData);
      } catch {
        accounting = undefined;
      }
      await input.onAttempt({
        capabilityId: input.capabilityId ?? "CAP-STRUCTURED-GENERATION",
        routeId: input.route.routeId,
        providerId: input.route.providerId,
        modelId: input.route.modelId,
        requestedModelId: input.route.modelId,
        ...(servedIdentity
          ? {
              servedProviderId: servedIdentity.providerId,
              servedModelId: servedIdentity.modelId,
            }
          : {}),
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
        costState:
          accounting?.state ??
          (preflightCancelled ? "not_incurred" : "unknown"),
        costAmount: accounting?.amount ?? null,
        costCurrency: accounting?.currency ?? null,
        costQuantity: accounting?.quantity ?? 0,
        costUnit: accounting?.unit ?? null,
        pricingVersion: accounting?.pricingVersion ?? null,
        costMeasurement: accounting?.measurement ?? null,
      });
    };
    if (input.signal.aborted) {
      await observe("cancelled", undefined, undefined, undefined, true);
      throw new Error("Provider request was cancelled.");
    }
    const controller = new AbortController();
    let rejectCancellation!: (error: Error) => void;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const abort = () => {
      controller.abort();
      rejectCancellation(new Error("Provider request was cancelled."));
    };
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
        cancellation,
      ]);
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error("Provider failure.");
      const timedOut = controller.signal.aborted && !input.signal.aborted;
      const closedFailure =
        error instanceof ProviderTransportFailure ? error : undefined;
      const closedFailureResponse = closedFailure
        ? {
            status: closedFailure.status ?? 0,
            body: Object.freeze({ provider_error: true }),
            ...(closedFailure.servedIdentity
              ? { servedIdentity: closedFailure.servedIdentity }
              : {}),
            accounting: closedFailure.accounting,
          }
        : undefined;
      await observe(
        input.signal.aborted
          ? "cancelled"
          : timedOut
            ? "timeout"
            : "provider_error",
        closedFailure?.status,
        closedFailure?.servedIdentity,
        closedFailureResponse,
      );
      if (input.signal.aborted) throw lastError;
      continue;
    } finally {
      if (timer) clearTimeout(timer);
      input.signal.removeEventListener("abort", abort);
    }
    if (response.status >= 200 && response.status < 300) {
      try {
        validatedAccounting(response, input.route.realData);
        input.validateResponse?.(response);
      } catch (error) {
        lastError =
          error instanceof Error
            ? error
            : new Error("Provider response validation failed.");
        await observe(
          "provider_error",
          response.status,
          response.servedIdentity,
          response,
        );
        break;
      }
      await observe("ok", response.status, response.servedIdentity, response);
      return response;
    }
    lastError = new Error(`Provider returned HTTP ${response.status}.`);
    await observe(
      "provider_error",
      response.status,
      response.servedIdentity,
      response,
    );
    if (![408, 429, 500, 502, 503, 504].includes(response.status)) break;
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
      TransportResponse | Error | readonly (TransportResponse | Error)[],
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

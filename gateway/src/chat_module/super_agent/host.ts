/** Optional transport client for explicit model reports. It does not schedule or execute agents. */
import type {TaskRequest} from './types';

export interface HostTransport {
  /** Bound to the authorized Bridge conversation and its current model connection. */
  task(request:TaskRequest):Promise<Record<string,any>>;
}

/**
 * Every call represents a decision or observation supplied by the model. The service owns the
 * task engine, persistence and retry receipts. There is no NativeHost dependency, autonomous
 * pump, subagent-ID requirement or attempt to observe the host's internal lifecycle here.
 * A transport error leaves the outcome unknown: the caller can repeat this exact request,
 * including its original request_key, to retrieve the service's saved receipt.
 */
export class SuperAgentTaskClient {
  constructor(private readonly transport:HostTransport) {}
  call(request:TaskRequest):Promise<Record<string,any>> {
    return this.transport.task(request);
  }
}

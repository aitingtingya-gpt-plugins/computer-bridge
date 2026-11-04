/** OAuth SDK platform hook; plain fetch handlers are used on Node.js. No vendor code is modified. */
export class WorkerEntrypoint {
  constructor(protected ctx: unknown, protected env: unknown) {}
}

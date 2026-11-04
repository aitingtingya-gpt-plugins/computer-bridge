/** Durable approval metadata. Commands and approval details stay on the computer. */
import {hash, opaque, type Data} from './types'
import type {Store} from './runtime'

export function commandDecision(action: 'accept' | 'decline' | 'cancel'): 'allowed-once' | 'rejected' | 'cancelled' {
  return ({accept: 'allowed-once', decline: 'rejected', cancel: 'cancelled'} as const)[action]
}

const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) :
  value && typeof value === 'object' ?
    Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value

export class CommandApprovals {
  private flushing = new Map<string, Promise<void>>()
  constructor(private store: Store,
    private rpc: (device: string, method: string, args: Data) => Promise<Data>,
    private schedule?: (work: Promise<void>) => void) {}

  async register(details: Data, projection: Data): Promise<Data> {
    // Shared hub alarms may be rescheduled by other features; also prune on use.
    await this.expire()
    const record = {id: details.id, device: projection.device, session: details.session,
      operation: details.operation, digest: details.digest, caller: details.caller,
      account: projection.account || 'u1', account_epoch: projection.account_epoch ?? 0,
      revision: details.revision, expires_at: details.expires_at * 1000,
      state: details.state, projection}
    const saved = await this.store.transaction(async tx => {
      const key = 'command-approval:' + record.id
      const old = await tx.get<Data>(key)
      if (old) {
        if (old.digest !== record.digest || old.caller !== record.caller) throw new Error('审批身份冲突')
        return old
      }
      await tx.put(key, record)
      return record
    })
    await this.store.setAlarm(record.expires_at)
    return saved
  }

  async record(id: string, caller?: string): Promise<Data> {
    const record = await this.store.get<Data>('command-approval:' + id)
    if (!record || (caller !== undefined && record.caller !== caller)) throw new Error('审批不属于当前调用方')
    return record
  }

  async details(id: string, caller?: string): Promise<Data> {
    const record = await this.record(id, caller)
    const details = await this.rpc(record.device, 'computer.approval_details',
      {session: record.session, operation: record.operation})
    if (details.id !== id || details.digest !== record.digest) throw new Error('审批详情不匹配')
    return details
  }

  async ticket(id: string, caller: string, method: string, args: Data): Promise<string> {
    const record = await this.record(id, caller)
    const ticket = opaque()
    await this.store.put('command-form:' + ticket, {id, caller, expires_at: record.expires_at,
      fingerprint: await hash(JSON.stringify(canonical({method, args})))})
    return ticket
  }

  async resume(ticket: string, caller: string, method: string, args: Data): Promise<Data> {
    const form = await this.store.get<Data>('command-form:' + ticket)
    if (!form || form.caller !== caller ||
        form.fingerprint !== await hash(JSON.stringify(canonical({method, args})))) throw new Error('审批表单不属于这次调用')
    return this.record(form.id, caller)
  }

  async decide(id: string, decision: string, caller?: string): Promise<{record: Data; result: Data}> {
    if (!['allowed-once', 'rejected', 'cancelled'].includes(decision)) throw new Error('未知审批决定')
    const record = await this.store.transaction(async tx => {
      const key = 'command-approval:' + id
      const value = await tx.get<Data>(key)
      if (!value || (caller !== undefined && value.caller !== caller)) throw new Error('审批不属于当前调用方')
      if (value.decision && value.decision !== decision) throw new Error('该审批已有不同决定')
      if (decision === 'allowed-once') {
        const accountId = value.account || value.projection?.account || 'u1'
        const account = await tx.get<Data>('account:' + accountId)
        const epoch = value.account_epoch ?? value.projection?.account_epoch ?? 0
        if (!account?.enabled || account.epoch !== epoch || account.role !== 'admin' &&
            !await tx.get('account-grant:' + accountId + ':' + value.device)) {
          throw Object.assign(new Error('命令申请账号已失效或已失去这台电脑的授权'), {code: 'approval_forbidden'})
        }
      }
      const device = await tx.get<Data>('device:' + value.device)
      if (!device || device.access?.revision !== value.revision) throw new Error('设备授权已变化，请重新申请')
      if (!value.decision && value.expires_at <= Date.now()) throw new Error('审批已过期')
      if (!value.decision) {
        value.decision = decision
        value.state = 'decided'
        await tx.put(key, value)
      }
      return value
    })
    // Retrying a lost reply sends the same bound decision to the original operation.
    const result = await this.rpc(record.device, 'computer.approval_decide',
      {session: record.session, operation: record.operation, approval_id: id,
        digest: record.digest, decision, _caller: record.caller})
    return {record, result}
  }

  /** Revocation changes only unapproved commands; previously accepted work keeps its lifecycle. */
  async revoke(account: string, device?: string): Promise<void> {
    const devices = await this.store.transaction(async tx => {
      const targets = new Set<string>()
      for (const [key, record] of await tx.list<Data>({prefix: 'command-approval:'})) {
        if ((record.account || record.projection?.account || 'u1') !== account ||
            device !== undefined && record.device !== device || record.decision || record.state !== 'pending') continue
        record.decision = 'cancelled'
        record.state = 'decided'
        record.revoked_at = Date.now()
        record.delivery_pending = true
        await tx.put(key, record)
        targets.add(record.device)
      }
      return [...targets]
    })
    const delivery = Promise.all(devices.map(target => this.flush(target))).then(() => {})
      .catch(error => {console.error('approval-revoke', (error as Error).name)})
    if (this.schedule) this.schedule(delivery)
    else void delivery
  }

  /** Reconnect sends the original cancellation, never starts a replacement command. */
  async flush(device: string): Promise<void> {
    const previous = this.flushing.get(device) || Promise.resolve()
    const work = previous.then(async () => {
      const records = await this.store.list<Data>({prefix: 'command-approval:'})
      await Promise.all([...records.values()].filter(record => record.device === device &&
        record.delivery_pending && record.decision === 'cancelled').map(async record => {
        try {
          await this.rpc(device, 'computer.approval_decide', {session: record.session,
            operation: record.operation, approval_id: record.id, digest: record.digest,
            decision: 'cancelled', _caller: record.caller})
        } catch (error) {
          // These device responses establish that there is no unapproved command left to start.
          if (!['operation_missing', 'approval_finished', 'approval_cancelled',
            'approval_invalidated', 'approval_expired'].includes((error as Data).code)) return
        }
        await this.store.transaction(async tx => {
          const key = 'command-approval:' + record.id
          const current = await tx.get<Data>(key)
          if (current?.decision === 'cancelled') await tx.put(key, {...current, delivery_pending: false})
        })
      }))
    })
    this.flushing.set(device, work)
    try {await work} finally {if (this.flushing.get(device) === work) this.flushing.delete(device)}
  }

  async expire(): Promise<void> {
    for (const prefix of ['command-approval:', 'command-form:']) {
      for (const [key, value] of await this.store.list<Data>({prefix})) {
        if (value.expires_at + 86400_000 < Date.now()) await this.store.delete(key)
      }
    }
  }
}

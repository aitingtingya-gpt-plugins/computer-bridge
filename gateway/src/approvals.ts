/** Durable approval metadata. Explicit chat approvals also save a complete card in that chat. */
import {hash, opaque, type Data} from './types'
import type {KeyStore, Store} from './runtime'

export interface ApprovalNotificationTarget {chat_id: string; principal: Data}

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
    private schedule?: (work: Promise<void>) => void,
    private changed?: (device: string, records: Data[]) => Promise<void>,
    private projectCard?: (tx: KeyStore, record: Data, details?: Data) => Promise<void>) {}

  private async notify(records:Data[]):Promise<void>{
    const devices=new Map<string,Data[]>();
    for(const record of records){const group=devices.get(record.device)??[];group.push(record);devices.set(record.device,group);}
    await Promise.all([...devices].map(([device,values])=>this.changed?.(device,values)));
  }

  async register(details: Data, projection: Data): Promise<Data> {
    // Shared hub alarms may be rescheduled by other features; also prune on use.
    await this.expire()
    const record: Data = {id: details.id, device: projection.device, session: details.session,
      operation: details.operation, digest: details.digest, caller: details.caller,
      account: projection.account || 'u1', account_epoch: projection.account_epoch ?? 0,
      revision: details.revision, expires_at: details.expires_at * 1000,
      state: details.state, channel: projection.approval_channel || 'host', projection,
      ...(projection.approval_channel === 'chat' && projection.approval_chat_id ? {chat_id: projection.approval_chat_id} : {})}
    let updated = false
    const saved = await this.store.transaction(async tx => {
      const key = 'command-approval:' + record.id
      const old = await tx.get<Data>(key)
      if (old) {
        if (old.digest !== record.digest || old.caller !== record.caller) throw new Error('审批身份冲突')
        if (!old.decision && old.state === 'pending' && record.state !== 'pending') {
          old.state = record.state
          await this.projectCard?.(tx, old, details)
          await tx.put(key, old)
          updated = true
        }
        return old
      }
      await this.projectCard?.(tx, record, details)
      await tx.put(key, record)
      updated = true
      return record
    })
    if (saved.state === 'pending') await this.store.setAlarm(saved.expires_at)
    if (updated) await this.notify([saved])
    return saved
  }

  /** Callers authorize the device before returning a sanitized human-facing view. */
  async list(device: string, options: {include_finished?: boolean} = {}): Promise<Data[]> {
    await this.expire()
    return [...(await this.store.list<Data>({prefix: 'command-approval:'})).values()]
      .filter(record => record.device === device &&
        (options.include_finished || record.state === 'pending' && !record.decision))
      .sort((a, b) => a.expires_at - b.expires_at)
  }

  async record(id: string, caller?: string): Promise<Data> {
    const record = await this.store.get<Data>('command-approval:' + id)
    if (!record || (caller !== undefined && record.caller !== caller)) throw new Error('审批不属于当前调用方')
    return record
  }

  async details(id: string, caller?: string): Promise<Data> {
    await this.expire()
    let record = await this.record(id, caller)
    const details = await this.rpc(record.device, 'computer.approval_details',
      {session: record.session, operation: record.operation})
    if (details.id !== id || details.digest !== record.digest) throw new Error('审批详情不匹配')
    record = await this.register(details, record.projection)
    return {...details, state: record.state, decision: record.decision || details.decision,
      channel: record.channel || 'host', delivery_pending: !!record.delivery_pending}
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

  async decide(id: string, decision: string, caller?: string,
    notification?: ApprovalNotificationTarget,
    authorize?: (tx: KeyStore, record: Data) => Promise<void>): Promise<{record: Data; result: Data}> {
    if (!['allowed-once', 'rejected', 'cancelled'].includes(decision)) throw new Error('未知审批决定')
    const record = await this.store.transaction(async tx => {
      const key = 'command-approval:' + id
      const value = await tx.get<Data>(key)
      if (!value || (caller !== undefined && value.caller !== caller)) throw new Error('审批不属于当前调用方')
      await authorize?.(tx, value)
      if(value.chat_id && notification && notification.chat_id!==value.chat_id)throw new Error('审批目标对话不能变更')
      // A late host form must return the decision already made in chat, not replace it.
      if (value.decision) return value
      if (decision === 'allowed-once') await this.authorize(tx, value)
      const device = await tx.get<Data>('device:' + value.device)
      if (!device || device.access?.revision !== value.revision) throw new Error('设备授权已变化，请重新申请')
      if (value.expires_at <= Date.now() || value.state !== 'pending') throw new Error('审批已过期或已结束')
      value.decision = decision
      value.state = 'decided'
      value.decided_at = Date.now()
      value.delivery_pending = true
      if (notification) value.notification = {...notification, decision, created_at: value.decided_at}
      else if (value.chat_id) value.notification = {chat_id: value.chat_id,
        principal: {kind: 'account', actor: {id: value.account, epoch: value.account_epoch}}, decision, created_at: value.decided_at}
      await this.projectCard?.(tx, value)
      await tx.put(key, value)
      return value
    })
    await this.notify([record])
    const result = await this.deliver(record)
    return {record: await this.record(id, caller), result}
  }

  async notification(id: string): Promise<Data | undefined> {
    return (await this.record(id)).notification
  }

  async markNotification(id: string, chatId: string): Promise<void> {
    await this.store.transaction(async tx => {
      const key = 'command-approval:' + id
      const record = await tx.get<Data>(key)
      if (record?.notification?.chat_id === chatId && !record.notification.delivered_at) {
        record.notification.delivered_at = Date.now()
        await tx.put(key, record)
      }
    })
  }

  private async authorize(tx: KeyStore, record: Data): Promise<void> {
    const accountId = record.account || record.projection?.account || 'u1'
    const account = await tx.get<Data>('account:' + accountId)
    const epoch = record.account_epoch ?? record.projection?.account_epoch ?? 0
    if (!account?.enabled || account.epoch !== epoch || account.role !== 'admin' &&
        !await tx.get('account-grant:' + accountId + ':' + record.device)) {
      throw Object.assign(new Error('命令申请账号已失效或已失去这台电脑的授权'), {code: 'approval_forbidden'})
    }
  }

  private async deliver(record: Data): Promise<Data> {
    if (!record.delivery_pending) return this.rpc(record.device, 'computer.wait',
      {session: record.session, operation: record.operation, seconds: 0})
    const details = await this.rpc(record.device, 'computer.approval_details',
      {session: record.session, operation: record.operation})
    if (details.id !== record.id || details.digest !== record.digest) throw new Error('审批详情不匹配')
    let result: Data
    if (details.state !== 'pending') {
      result = await this.rpc(record.device, 'computer.wait',
        {session: record.session, operation: record.operation, seconds: 0})
    } else {
      const decision = record.delivery_decision || record.decision
      if (decision === 'allowed-once') await this.store.transaction(tx => this.authorize(tx, record))
      result = await this.rpc(record.device, 'computer.approval_decide',
        {session: record.session, operation: record.operation, approval_id: record.id,
          digest: record.digest, decision, _caller: record.caller})
    }
    await this.store.transaction(async tx => {
      const key = 'command-approval:' + record.id
      const current = await tx.get<Data>(key)
      if (current?.decision === record.decision) {
        const updated = {...current, delivery_pending: false,
          ...(details.state === 'expired' || details.state === 'invalidated' ? {state: details.state} : {})}
        await this.projectCard?.(tx, updated)
        await tx.put(key, updated)
      }
    })
    await this.notify([record])
    return result
  }

  /** Revocation changes only unapproved commands; previously accepted work keeps its lifecycle. */
  async revoke(account: string, device?: string): Promise<void> {
    const changed = await this.store.transaction(async tx => {
      const targets:Data[] = []
      for (const [key, record] of await tx.list<Data>({prefix: 'command-approval:'})) {
        if ((record.account || record.projection?.account || 'u1') !== account ||
            device !== undefined && record.device !== device ||
            (record.decision ? !record.delivery_pending : record.state !== 'pending')) continue
        if (!record.decision) record.decision = 'cancelled'
        record.delivery_decision = 'cancelled'
        record.state = 'decided'
        record.revoked_at = Date.now()
        record.delivery_pending = true
        await this.projectCard?.(tx, record)
        await tx.put(key, record)
        targets.push(record)
      }
      return [...targets]
    })
    await this.notify(changed)
    const devices=[...new Set(changed.map(record=>record.device))]
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
        record.delivery_pending && record.decision).map(async record => {
        try {
          await this.deliver(record)
          return
        } catch (error) {
          // These device responses establish that there is no unapproved command left to start.
          if (!['operation_missing', 'approval_finished', 'approval_cancelled',
            'approval_invalidated', 'approval_expired'].includes((error as Data).code)) return
        }
        await this.store.transaction(async tx => {
          const key = 'command-approval:' + record.id
          const current = await tx.get<Data>(key)
          if (current?.decision === record.decision) {
            const updated = {...current, delivery_pending: false, state: 'ended'}
            await this.projectCard?.(tx, updated)
            await tx.put(key, updated)
          }
        })
        await this.notify([record])
      }))
    })
    this.flushing.set(device, work)
    try {await work} finally {if (this.flushing.get(device) === work) this.flushing.delete(device)}
  }

  async expire(): Promise<void> {
    const changed = await this.store.transaction(async tx => {
      const records:Data[] = []
      for (const prefix of ['command-approval:', 'command-form:']) {
        for (const [key, value] of await tx.list<Data>({prefix})) {
          const remove=value.expires_at + 86400_000 < Date.now()
          if (prefix === 'command-approval:' && value.state === 'pending' && value.expires_at <= Date.now()) {
            const updated = {...value, state: 'expired'}
            await this.projectCard?.(tx, updated)
            if(!remove)await tx.put(key, updated)
            records.push(updated)
          }
          if(remove)await tx.delete(key)
        }
      }
      return records
    })
    await this.notify(changed)
  }
}

/** Durable approval metadata. Routed chat approvals also save a card in that chat. */
import {hash, opaque, type Data} from './types'
import type {KeyStore, Store} from './runtime'

export interface ApprovalNotificationTarget {chat_id: string; principal: Data}
export type ApprovalRoute = 'host' | 'chat' | 'unassigned'
export interface ApprovalOrigin {chatId:string;writerId:string;account:string;epoch:number;caller:string}
const fail = (code:string,message:string) => Object.assign(new Error(message), {code})

export function commandDecision(action: 'accept' | 'decline' | 'cancel'): 'allowed-once' | 'rejected' | 'cancelled' {
  return ({accept: 'allowed-once', decline: 'rejected', cancel: 'cancelled'} as const)[action]
}

const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) :
  value && typeof value === 'object' ?
    Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value

export class CommandApprovals {
  private flushing = new Map<string, Promise<void>>()
  private deliveringTools = new Map<string, Promise<Data>>()
  constructor(private store: Store,
    private rpc: (device: string, method: string, args: Data, beforeSend?:()=>Promise<void>) => Promise<Data>,
    private schedule?: (work: Promise<void>) => void,
    private changed?: (device: string, records: Data[], availabilityChanged: boolean) => Promise<void>,
    private projectCard?: (tx: KeyStore, record: Data, details?: Data) => Promise<number|undefined>,
    private executeTool?: (record: Data) => Promise<Data>,
    private authorizeAuto?: (tx: KeyStore, record: Data) => Promise<void>) {}

  private async notify(records:Data[],claimed=false):Promise<void>{
    const devices=new Map<string,Data[]>();
    for(const record of records){const group=devices.get(record.device)??[];group.push(record);devices.set(record.device,group);}
    await Promise.all([...devices].map(([device,values])=>this.changed?.(device,values,
      claimed||values.some(record=>record.channel==='unassigned'))));
  }

  private async indexClaimable(tx:KeyStore,record:Data):Promise<void>{
    const key='approval-unassigned:'+record.device+':'+record.id
    if(record.channel==='unassigned'&&record.state==='pending'&&!record.decision)
      await tx.put(key,record.id)
    else await tx.delete(key)
  }

  async register(details: Data, projection: Data): Promise<Data> {
    // Shared hub alarms may be rescheduled by other features; also prune on use.
    await this.expire()
    const channel: ApprovalRoute = projection.approval_channel ?? 'host'
    const record: Data = {id: details.id, device: projection.device, session: details.session,
      operation: details.operation, digest: details.digest, caller: details.caller,
      account: projection.account || 'u1', account_epoch: projection.account_epoch ?? 0,
      revision: details.revision, expires_at: details.expires_at * 1000,
      state: details.state, channel, projection,
      ...(details.tool ? {tool: details.tool} : {}),
      ...(channel === 'unassigned' ? {claim_details: {
        command: details.command, cwd: details.cwd, justification: details.justification,
      }} : {}),
      ...(channel === 'chat' && projection.approval_chat_id ? {chat_id: projection.approval_chat_id} : {})}
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
          if(old.channel==='unassigned')await this.indexClaimable(tx,old)
          updated = true
        }
        return old
      }
      await this.projectCard?.(tx, record, details)
      await tx.put(key, record)
      if(record.channel==='unassigned')await this.indexClaimable(tx,record)
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

  private async claimable(tx:KeyStore, device:string, chat:string, account:string|undefined, record:Data):Promise<boolean> {
    if(record.device!==device || record.state!=='pending' || record.decision ||
      record.expires_at<=Date.now() || record.channel!=='unassigned' ||
      account!==undefined && record.account!==account) return false
    const known=record.projection.approval_origin as ApprovalOrigin|undefined
    if(known && known.chatId!==chat) return false
    const caller=await tx.get<Data>('account:'+record.account)
    return !!caller?.enabled && caller.epoch===record.account_epoch &&
      (caller.role==='admin' || !!await tx.get('account-grant:'+record.account+':'+device))
  }

  private async claimableRecords(tx:KeyStore,device:string,chat:string,account:string|undefined):Promise<Data[]>{
    const ready='approval-unassigned-index:v1'
    if(!await tx.get(ready)){
      for(const record of (await tx.list<Data>({prefix:'command-approval:'})).values()){
        if(record.channel==='unassigned'&&record.state==='pending'&&!record.decision&&record.expires_at>Date.now())
          await this.indexClaimable(tx,record)
      }
      await tx.put(ready,true)
    }
    const revision=(await tx.get<Data>('device:'+device))?.access?.revision??0
    const eligible:Data[]=[]
    for(const id of (await tx.list<string>({prefix:'approval-unassigned:'+device+':'})).values()){
      const record=await tx.get<Data>('command-approval:'+id)
      if(record&&record.revision===revision&&await this.claimable(tx,device,chat,account,record))eligible.push(record)
    }
    return eligible
  }

  async availability(tx:KeyStore,device:string,chat:string,account:string|undefined){
    const records=await this.claimableRecords(tx,device,chat,account)
    const next=records.reduce<number|null>((earliest,{expires_at})=>earliest===null?expires_at:Math.min(earliest,expires_at),null)
    return {claimable_approval_count:records.length,next_claimable_approval_expires_at:next}
  }

  async available(device:string, chat:string, account:string|undefined, authorize:(tx:KeyStore)=>Promise<void>):Promise<Data[]> {
    await this.expire()
    return this.store.transaction(async tx=>{
      await authorize(tx)
      const approvals:Data[]=[]
      for(const record of await this.claimableRecords(tx,device,chat,account)) {
        const summary=record.tool?.summary ?? record.claim_details?.command ?? '单次命令'
        approvals.push({id:record.id,summary:summary.replace(/\s*\n\s*/g,' · ').slice(0,160),expires_at:record.expires_at})
      }
      return approvals.sort((a,b)=>a.expires_at-b.expires_at || a.id.localeCompare(b.id))
    })
  }

  async claim(id:string,device:string,chat:string,account:string|undefined,authorize:(tx:KeyStore)=>Promise<void>):Promise<Data> {
    const {record,sequence,changed}=await this.store.transaction(async tx=>{
      await authorize(tx)
      const key='command-approval:'+id
      const record=await tx.get<Data>(key)
      if(record?.claimed && record.device===device && record.chat_id===chat &&
        (account===undefined || record.account===account))
        return {record,sequence:record.claim_sequence,changed:false}
      if(!record || !await this.claimable(tx,device,chat,account,record))
        throw fail('approval_unavailable','这项审批已领取、已结束或不可领取')
      const current=await tx.get<Data>('device:'+device)
      if(!current || (current.access?.revision??0)!==record.revision)
        throw fail('approval_invalidated','设备授权已变化，请重新申请')
      record.channel='chat'
      record.chat_id=chat
      record.claimed=true
      const sequence=await this.projectCard!(tx,record,record.claim_details??{})
      if(sequence===undefined) throw fail('approval_unavailable','当前对话不能领取此审批')
      delete record.claim_details
      record.claim_sequence=sequence
      await tx.put(key,record)
      await this.indexClaimable(tx,record)
      return {record,sequence,changed:true}
    })
    if(changed) await this.notify([record],true)
    return {id,sequence}
  }

  async record(id: string, caller?: string): Promise<Data> {
    const record = await this.store.get<Data>('command-approval:' + id)
    if (!record || (caller !== undefined && record.caller !== caller)) throw new Error('审批不属于当前调用方')
    return record
  }

  async details(id: string, caller?: string): Promise<Data> {
    await this.expire()
    let record = await this.record(id, caller)
    if (record.tool) return {...record.tool, id, state:record.state, decision:record.decision,
      expires_at:record.expires_at / 1000, channel:record.channel, delivery_pending:!!record.delivery_pending,
      ...(record.projection.module_confirmation ? {module_confirmation:record.projection.module_confirmation} : {}),
      ...(record.projection.permission_confirmation ? {permission_confirmation:true} : {})}
    const details = await this.rpc(record.device, 'computer.approval_details',
      {session: record.session, operation: record.operation})
    if (details.id !== id || details.digest !== record.digest) throw new Error('审批详情不匹配')
    record = await this.register(details, record.projection)
    return {...details, state: record.state, decision: record.decision || details.decision,
      channel: record.channel || 'host', delivery_pending: !!record.delivery_pending,
      ...(record.projection.permission_confirmation ? {permission_confirmation:true} : {})}
  }

  async ticket(id: string, caller: string, method: string, args: Data): Promise<string> {
    const record = await this.record(id, caller)
    if(record.channel!=='host') throw fail('approval_channel','这项审批不在宿主中处理')
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
      if(value.channel==='unassigned')throw fail('approval_unassigned','请先在聊天中领取这项审批')
      if(value.chat_id && notification && notification.chat_id!==value.chat_id)throw new Error('审批目标对话不能变更')
      // A late host form must return the decision already made in chat, not replace it.
      if (value.decision) return value
      if (decision === 'allowed-once') {
        await this.authorize(tx, value)
        if(value.projection.auto_tool_grant)await this.authorizeAuto?.(tx,value)
      }
      const device = await tx.get<Data>('device:' + value.device)
      if (!device || device.access?.revision !== value.revision) throw new Error('设备授权已变化，请重新申请')
      if (value.expires_at <= Date.now() || value.state !== 'pending') throw new Error('审批已过期或已结束')
      value.decision = decision
      value.state = 'decided'
      value.decided_at = Date.now()
      value.delivery_pending = true
      const origin=value.projection.approval_origin as ApprovalOrigin|undefined
      if(value.chat_id && (!value.claimed || origin?.chatId===value.chat_id)) {
        value.notification = {chat_id: value.chat_id,
          principal: notification?.principal??{kind: 'account', actor: {id: value.account, epoch: value.account_epoch}},
          decision, created_at: value.decided_at,...(origin?.chatId===value.chat_id?{origin}:{})}
      }
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

  async result(id:string,caller:string):Promise<Data> {
    const record=await this.record(id,caller)
    if(!record.decision)throw fail('approval_pending','审批尚未处理')
    return this.deliver(record)
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
    if (record.tool) {
      const active=this.deliveringTools.get(record.id)
      if (active) return active
      const work=this.deliverTool(record.id)
      this.deliveringTools.set(record.id, work)
      try {return await work} finally {this.deliveringTools.delete(record.id)}
    }
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
      const beforeSend=decision==='allowed-once'&&record.projection.auto_tool_grant
        ?()=>this.store.transaction(tx=>this.authorizeAuto!(tx,record)):undefined
      result = await this.rpc(record.device, 'computer.approval_decide',
        {session: record.session, operation: record.operation, approval_id: record.id,
          digest: record.digest, decision, _caller: record.caller},beforeSend)
    }
    await this.settle(record, details.state === 'expired' || details.state === 'invalidated' ? details.state : undefined)
    return result
  }

  private async deliverTool(id:string):Promise<Data> {
    const record=await this.store.transaction(async tx=>{
      const current=(await tx.get<Data>('command-approval:'+id))!
      if(current.delivery_pending && (current.delivery_decision || current.decision)==='allowed-once')
        await this.authorize(tx,current)
      return current
    })
    const result=await this.executeTool!(record)
    if(record.delivery_pending)await this.settle(record,['expired','invalidated'].includes(result.approval_state)?result.approval_state:undefined)
    return result
  }

  private async settle(record:Data,state?:string):Promise<void> {
    await this.store.transaction(async tx => {
      const key = 'command-approval:' + record.id
      const current = await tx.get<Data>(key)
      if (current?.decision === record.decision) {
        const updated = {...current, delivery_pending: false, ...(state ? {state} : {})}
        await this.projectCard?.(tx, updated)
        await tx.put(key, updated)
      }
    })
    await this.notify([record])
  }

  async invalidateTools(device:string,revision:number):Promise<void> {
    const changed=await this.store.transaction(async tx=>{
      const result:Data[]=[]
      for(const [key,record] of await tx.list<Data>({prefix:'command-approval:'})){
        if(record.device!==device || record.revision===revision || !record.tool || record.state!=='pending')continue
        const updated={...record,state:'invalidated',decision:'cancelled',delivery_pending:true}
        await this.projectCard?.(tx,updated)
        await tx.put(key,updated)
        if(record.channel==='unassigned')await this.indexClaimable(tx,updated)
        result.push(updated)
      }
      return result
    })
    await this.notify(changed)
    if(changed.length){
      const delivery=this.flush(device)
      if(this.schedule)this.schedule(delivery)
      else void delivery
    }
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
        if(record.channel==='unassigned')await this.indexClaimable(tx,record)
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
            'approval_invalidated', 'approval_expired', 'chat_auto_ended'].includes((error as Data).code)) return
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
            if(value.channel==='unassigned')await this.indexClaimable(tx,updated)
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

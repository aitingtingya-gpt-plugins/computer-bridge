/** Pure prompt assembly from upstream app/prompts.ts; filesystem resources and version storage are separate host boundaries. */
import {z} from 'zod';
import {key} from './vendor/src/core/index.ts';
import {policyVersion,type Settings} from './upstream-policy';
import {promptResources as resources,githubSkill,feishuSkill} from './upstream-prompt-resources';
const sharedPrompt=resources.shared,masterPrompt=resources.orchestrator,workerPrompt=resources.worker;
const guides:Record<string,string>={subscriptions:resources.subscriptions,replies:resources.replies,dispatch:resources.dispatch,work:resources.work};
const mainAdmissionPolicy=resources.admission;
const handoffPolicy=(role:'orchestrator'|'worker')=>resources.handoff+'\n'+(role==='orchestrator'?resources['handoff-orchestrator']:resources['handoff-worker']);
const teamDefaults={communication:resources['team/communication'],scope:resources['team/scope'],delivery:resources['team/delivery']};
const sourceSkills:Record<'github'|'feishu',string>={github:githubSkill,feishu:feishuSkill};
const cliNotes=resources.cli;
type Variable={name:string;value:string};
const environmentLines=(variables:Variable[])=>variables.map(v=>v.name+'='+v.value).join('\n');
/** Prompt sections the team writes; the built-in parts follow dsh-superagent's text until the team overrides them. */
export const TEAM_SECTIONS = ['communication', 'scope', 'delivery'] as const
export type TeamSection = typeof TEAM_SECTIONS[number]
/** Markdown headings for each team section; fixed prompt sections refer to them by these exact names. */
const TEAM_HEADINGS: Record<TeamSection, string> = { communication: 'Communication', scope: 'Ticket scope', delivery: 'Delivery requirements' }
export const SKILL_NAME = /^[a-z][a-z0-9-]*$/
/** Prefix prepended to skill names when registering them in DSH Sessions. */
export const SKILL_PREFIX = 'dsh-superagent-'
const SkillNameSchema = z.string().regex(SKILL_NAME).refine(name => !(Object.keys(sourceSkills) as string[]).includes(name),
  'This name belongs to a built-in skill')
/** The built-in parts a team may override, by key: both roles' parts, the Source skills, and the generated parts' templates. */
const PART_KEYS = ['runtime/shared', 'runtime/orchestrator', 'runtime/worker', 'runtime/subscriptions', 'runtime/replies',
  'runtime/dispatch', 'runtime/work', 'runtime/admission', 'runtime/handoff/orchestrator', 'runtime/handoff/worker', 'runtime/environment',
  'runtime/policy', 'runtime/policy/none', 'skill/feishu', 'skill/github'] as const
export type PartKey = typeof PART_KEYS[number]
/** A team's text for a built-in part, and `base`, the key of the built-in text it was edited from. */
const OverrideSchema = z.object({ text: z.string(),
  base: z.string().optional().describe('Key of the built-in text it was edited from; copy as read, or omit.') }).strict()
/**
 * A configuration, whose overrides may name a part a later version no longer has, which `Prompts.validate` drops when the
 * saved version holds it and refuses otherwise.
 */
export const PromptConfigSchema = z.object({ communication: z.string(), scope: z.string(), delivery: z.string(),
  skills: z.record(SkillNameSchema, z.string()), overrides: z.record(z.string(), OverrideSchema).optional()
    .describe('Text in place of a built-in part, by its key in prompts/defaults; a part not named follows its built-in text.') }).strict()
export type PromptConfig = z.infer<typeof PromptConfigSchema>
export interface PromptVersion { revision: number; previousRevision: number | null; savedAt: string; source: string; config: PromptConfig;
  /** Original unmigrated config preserved when differences cannot be compared across schema versions. */
  legacy?: { config: unknown } }
export const defaultPrompts = (): PromptConfig => ({ ...teamDefaults, skills: {} })

const ENVIRONMENT_HEADING = 'Execution environment (from this installation\'s settings; it takes precedence over any repository or account named elsewhere in these instructions; an empty value means that part is not configured here). The prepare command of a ticket directory reads the same variables:'
const POLICY_HEAD = '## Policy\nPolicy version {version}; accept mode {mode}. The accept mode and the rules decide proactive candidates only: an explicit request is routed as dispatch says, in any mode and whatever the rules.'
type Role = 'orchestrator' | 'worker'
/** A built-in part a team may override: the roles that read it, its text, and the placeholders a template's override keeps. */
interface BuiltInPart { roles: readonly Role[]; text: string; placeholders?: readonly string[] }
const BOTH: readonly Role[] = ['orchestrator', 'worker'], MAIN: readonly Role[] = ['orchestrator'], WORKER: readonly Role[] = ['worker']
let parts: Readonly<Record<PartKey, BuiltInPart>> | undefined
/**
 * The built-in parts of both roles' prompts, the two Source skills, and the templates of the generated parts, whose data the
 * system fills in, by the key an override names them by. Built on first use, as the texts it reads are imported in a cycle.
 */
export const builtInParts = (): Readonly<Record<PartKey, BuiltInPart>> => parts ??= {
  'runtime/shared': { roles: BOTH, text: sharedPrompt }, 'runtime/orchestrator': { roles: MAIN, text: masterPrompt },
  'runtime/worker': { roles: WORKER, text: workerPrompt },
  'runtime/subscriptions': { roles: BOTH, text: `## subscriptions\n${guides.subscriptions}` },
  'runtime/replies': { roles: BOTH, text: `## replies\n${guides.replies}` },
  'runtime/dispatch': { roles: MAIN, text: `## dispatch\n${guides.dispatch}` }, 'runtime/work': { roles: WORKER, text: `## work\n${guides.work}` },
  'runtime/admission': { roles: MAIN, text: mainAdmissionPolicy },
  'runtime/handoff/orchestrator': { roles: MAIN, text: handoffPolicy('orchestrator') },
  'runtime/handoff/worker': { roles: WORKER, text: handoffPolicy('worker') },
  'runtime/environment': { roles: BOTH, text: `${ENVIRONMENT_HEADING}\n{variables}`, placeholders: ['{variables}'] },
  'runtime/policy': { roles: MAIN, text: `${POLICY_HEAD} The enabled rules, by name and id:\n{rules}`, placeholders: ['{version}', '{mode}', '{rules}'] },
  'runtime/policy/none': { roles: MAIN, text: `${POLICY_HEAD} No rule is enabled: a proactive candidate can only be ignored.`,
    placeholders: ['{version}', '{mode}'] },
  'skill/feishu': { roles: BOTH, text: `${sourceSkills.feishu}\n\n## CLI usage\n${cliNotes}` },
  'skill/github': { roles: BOTH, text: `${sourceSkills.github}\n\n## CLI usage\n${cliNotes}` },
}
/** The key of a built-in text, which an override's `base` records. */
export const builtInBase = (text: string): string => key('prompt-built-in', text)
/** The built-in part a key names, if any; a name an object's prototype has names none. */
export const builtInPart = (part: string): BuiltInPart | undefined =>
  Object.hasOwn(builtInParts(), part) ? builtInParts()[part as PartKey] : undefined
/** The text of a built-in part: the team's override, else the built-in one. */
const builtIn = (config: PromptConfig, part: PartKey): string =>
  (config.overrides && Object.hasOwn(config.overrides, part) ? config.overrides[part]!.text : undefined) ?? builtInParts()[part].text
/** Fill a template's placeholders in one pass, so text filled in is not read for placeholders again. */
const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (match, name: string) => Object.hasOwn(values, name) ? values[name]! : match)
/** The execution environment part: its template with the variables, or, while setup waits, that it waits. */
export function environmentSection(config: PromptConfig, variables: Variable[] | undefined): string {
  return variables ? fill(builtIn(config, 'runtime/environment'), { variables: environmentLines(variables) })
    : 'Execution environment: dsh-superagent is waiting for setup; the management panel names what is missing.'
}
/**
 * The main Session's Policy section: the Policy version and accept mode it judges proactive candidates by, and every enabled
 * rule, as the settings hold them, each on one line, so a line of an instruction reads as no rule or heading of its own; the
 * settings bound each instruction (`LIMITS.ruleInstruction`). `key` names the template it was filled from.
 */
export function policySection(settings: Settings, config: PromptConfig = defaultPrompts()): { key: string; text: string } {
  const line = (text: string) => text.replace(/\s*\n\s*/g, ' ')
  const rules = settings.policy.rules.filter(rule => rule.enabled).map(({ id, name, instruction }) => `- ${line(name)} (${id}): ${line(instruction)}`)
  const part = rules.length ? 'runtime/policy' : 'runtime/policy/none'
  return { key: part, text: fill(builtIn(config, part), { version: policyVersion(settings), mode: settings.eval.mode, rules: rules.join('\n') }) }
}
/**
 * Assemble a role's system prompt sections in order from fixed templates, team sections, the generated execution environment
 * and, last, the main Session's generated Policy section, which nothing follows, and whose change leaves the rest unchanged.
 */
export function promptParts(config: PromptConfig, role: Role, environment?: string, policy?: { key: string; text: string }) {
  // A built-in part names the key its text is overridden by, which for the handoff names the role.
  const fixed = (name: string, part = name) => ({ name, kind: 'fixed' as const, key: part, text: builtIn(config, part as PartKey) })
  const team = (name: TeamSection) => ({ name, kind: 'team' as const, heading: `## ${TEAM_HEADINGS[name]}`,
    text: config[name] ? `## ${TEAM_HEADINGS[name]}\n${config[name]}` : '' })
  return [
    fixed('runtime/shared'), fixed(`runtime/${role}`),
    ...TEAM_SECTIONS.map(team),
    ...['subscriptions', 'replies', role === 'orchestrator' ? 'dispatch' : 'work'].map(name => fixed(`runtime/${name}`)),
    ...role === 'orchestrator' ? [fixed('runtime/admission')] : [],
    fixed('runtime/handoff', `runtime/handoff/${role}`),
    ...environment ? [{ name: 'runtime/environment', kind: 'generated' as const, key: 'runtime/environment', text: environment }] : [],
    ...role === 'orchestrator' && policy ? [{ name: 'runtime/policy', kind: 'generated' as const, ...policy }] : [],
  ].filter(part => part.text)
}
export function composePrompt(config: PromptConfig, role: Role, environment?: string, policy?: { key: string; text: string }): string {
  return promptParts(config, role, environment, policy).map(part => part.text).join('\n\n')
}
export function composeSkill(config: PromptConfig, name: string): string {
  return name === 'feishu' || name === 'github' ? builtIn(config, `skill/${name}`) : config.skills[name] ?? ''
}


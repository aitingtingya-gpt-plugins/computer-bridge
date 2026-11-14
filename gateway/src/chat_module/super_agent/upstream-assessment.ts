/** Original assessment and routing argument schemas; dependencies bind to the Bridge host. */
import {z} from 'zod';
import {AdmissionDirectionSchema,RuleAssessmentSchema,directionAllowed} from './upstream-policy';
import {IM_WORDS,wordCount} from './vendor/src/infra/text.ts';
/** Human-facing acknowledgement text, constrained to `IM_WORDS` regardless of which channel it is posted to. */
export const AcknowledgementSchema = z.string().trim().min(1)
  .refine(text => wordCount(text) <= IM_WORDS, `An acknowledgement has at most ${IM_WORDS} words (Chinese uses word segmentation); write one short sentence.`)
/** Schema for a short lowercase kebab-case English ticket worktree name (1–4 words, at most 32 characters). */
export const WorktreeNameSchema = z.string().max(32).regex(/^[a-z]+(?:-[a-z0-9]+){0,3}$/, 'Use 1–4 short English words in lowercase kebab-case, at most 32 characters').describe('Meaningful short English ticket name, e.g. fix-plan-color. Translate Chinese titles into English; no Chinese, pinyin or generic ticket names. 1–4 lowercase words in kebab-case, at most 32 characters.')
/** Schema for the main Session's proactive candidate assessment decision (`orchestrator_eval_decide`). */
export const AssessmentSchema = z.object({
  decision: z.enum(['accept', 'ignore', 'unavailable']),
  rule_assessments: z.array(RuleAssessmentSchema)
    .refine(assessments => new Set(assessments.map(assessment => assessment.rule_id)).size === assessments.length,
      'Duplicate rule assessment IDs').describe('One per enabled rule.'),
  direction: AdmissionDirectionSchema.describe('Required for every decision.'),
  title: z.string().min(1).max(160),
  worktree_name: WorktreeNameSchema.optional(),
  scope: z.string().max(1500),
  intent_evidence: z.string().trim().min(1).max(700).nullish().describe('For acceptance: the quotes that establish the three facts.'),
  acknowledgement: AcknowledgementSchema.nullish().describe('For acceptance: one sentence in the source language, posted as a reply to the trigger; omit only when a matched rule asks for silence.'),
  reason: z.string().min(1).max(500),
}).strict().refine(value => value.decision !== 'accept' || !directionAllowed(value.direction) || !value.rule_assessments.some(rule => rule.matched)
  || !!value.worktree_name, { message: 'Accepted work requires a short English worktree_name', path: ['worktree_name'] })

/** Schema for bounded context or repository read requests during an active evaluation (`orchestrator_eval_read`). */
export const EvalReadSchema = z.object({
  trigger_id: z.string().min(1).describe('Original candidate ID returned by orchestrator_eval; every reference is scoped to this trigger.'),
  resource: z.enum(['message', 'root', 'parent', 'thread', 'file', 'directory', 'image']),
  path: z.string().optional().describe('Repository-relative path, only for file/directory.'),
  message_id: z.string().optional().describe('Only for message: omit for the trigger, or the id of a window message or stub.'),
  cursor: z.string().optional().describe('Only for thread: omit on the first page, then the next_cursor of the window or the cursor of next_read. Never a thread or message ID.'),
  image_id: z.string().optional().describe('Only for image: an image id the window or a read lists.'),
  offset: z.number().int().min(0).default(0).describe('Text pagination: copy next_offset; keep the other arguments unchanged. Images use 0.'),
}).strict().superRefine((read, ctx) => {
  if ((read.resource === 'file' || read.resource === 'directory') !== (read.path !== undefined)) ctx.addIssue({ code: 'custom', message: 'path is required only for file/directory. To read the source/root/parent, use resource=message/root/parent without a path.' })
  if (read.message_id !== undefined && read.resource !== 'message') ctx.addIssue({ code: 'custom', message: 'message_id is only for message; use returned image_id for images.' })
  if (read.cursor !== undefined && read.resource !== 'thread') ctx.addIssue({ code: 'custom', message: 'cursor is only for thread. First page: {resource:"thread"}.' })
  if ((read.resource === 'image') !== (read.image_id !== undefined)) ctx.addIssue({ code: 'custom', message: 'Images require image_id from a returned read reference. Read the thread or root first to discover their images.' })
})
/** Validated arguments for `MasterAssessor.read`. */
export type EvalRead = z.infer<typeof EvalReadSchema>


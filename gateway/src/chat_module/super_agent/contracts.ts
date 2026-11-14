import {z} from 'zod';
import {TASK_ACTIONS} from './types';
import {AssessmentSchema,EvalReadSchema} from './upstream-assessor';
export const superAgentTaskSpec=[
  'chat.task',
  'Run the pinned DeepSeek Super Agent framework in this Bridge Super Agent conversation. Read instructions for the original orchestrator or worker role. pending/list/detail show source messages, decisions, tasks and requested actions. Discuss requests through chat.reply before accept/attach/ignore; discuss keeps referenced messages unassigned without an assessment deadline. Use message_ids to route related original messages together. accept requires title, name (a short English kebab-case label, not a directory-creation request) and acknowledgement; original explicit routing derives mandate scope from title. Follow original role and permission rules; Bridge adds no tool priority or mandatory subagent requirement. This service cannot spawn, inspect or monitor your agents. You or your delegate (or you relaying its report) explicitly report started, inputs_delivered, inputs_read, report, turn_ended or interrupted. claim reserves a task, not a start; report is not turn-ended. No native agent ID is required. Use the supplied task_id and assignment_id. reply applies original purpose-specific rules; do not duplicate saved replies through chat.reply. Retry unknown receipts with the same request_key and parameters, without replaying computer commands. Ordinary Chat does not use this tool.',
  z.object({chat_id:z.string().regex(/^t[1-9]\d*$/),connection:z.string().optional(),
    active_only:z.boolean().optional(),after:z.number().int().nonnegative().optional(),limit:z.number().int().min(1).max(100).optional(),
    action:z.enum(TASK_ACTIONS),
    task_id:z.string().optional(),message_id:z.string().optional(),eval_id:z.string().optional(),title:z.string().max(200).optional(),scope:z.string().max(16000).optional(),
    summary:z.string().max(16000).optional(),reason:z.string().max(2000).optional(),assignment_id:z.string().optional(),
    input_ids:z.array(z.string()).max(500).optional(),state:z.enum(['progress','waiting','ready','blocked','failed','dropped']).optional(),
    resource:z.string().optional(),offset:z.number().int().nonnegative().optional(),read:z.object(EvalReadSchema.shape).omit({trigger_id:true}).optional(),assessment:AssessmentSchema.optional(),
    pr_number:z.number().int().positive().nullable().optional(),pr_own:z.boolean().optional(),
    note:z.string().max(4000).optional(),
    action_id:z.string().optional(),acknowledgement:z.string().max(4000).optional(),name:z.string().max(32).optional(),worktree_name:z.string().max(32).optional(),
    message_ids:z.array(z.string()).min(1).max(500).optional(),role:z.enum(['orchestrator','worker']).optional(),
    purpose:z.enum(['acknowledgement','answer','attention','result']).optional(),text:z.string().max(16000).optional(),
    question_for_message_id:z.string().optional(),reply_to_message_id:z.string().optional(),thread_id:z.string().optional(),context_only:z.boolean().optional(),outcome:z.enum(['closed','merged']).optional(),at:z.string().optional(),
    question:z.string().max(4000).nullable().optional(),request_key:z.string().min(1).max(200).optional(),
  }),
] as const;

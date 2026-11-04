import type {GatewayModule} from '../../../gateway/src/modules';

const workTree:GatewayModule={
  id:'work-tree',version:'0.2.0',api:1,core:'>=0.1.4 <=0.2.0',
  kinds:{bridge_session:'r',bridge_run:'r',step:'t',normtask:'t',run:'e',attempt:'a',changeset:'d',
    memory:'p',proposal:'p',normproposal:'p',question:'q',team:'g'},
  identityFields:['research_session','parent_session','resume','project','step','step_id','work_id','task_id',
    'resource_id','run','run_id','run_ids','active_run','active_runs','leader_run_id','member_ids','team_id',
    'to','attempt_id','lease','changeset_id','proposal_id','question_id','question_ids','conversation_id'],
  ownsFile:path=>/(?:^|[/\\])\.work-tree[/\\]materials[/\\]/.test(path),
  confirmation:action=>action==='start_norms'?{
    message:'从完整原始对话启动 Work Tree 规范整理？',
    schema:{type:'object',properties:{start:{type:'boolean'}},required:['start']},
  }:undefined,
};
export default workTree;

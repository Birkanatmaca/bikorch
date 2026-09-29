import { useState } from 'react'
import { ArrowUp, Check, Loader2, Pencil, Save, ShieldCheck } from 'lucide-react'
import { AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import type { SecretaryPlan, SecretaryRun, SecretaryRunEvidence } from '@shared/contracts/secretary'
import type { CliUsageKind } from '@shared/contracts/usage'
import { SecretaryAvatar } from './SecretaryAvatar'
import { cn } from '@renderer/lib/utils'

export interface ManagerChatItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  plan?: SecretaryPlan | null
  runId?: string
  run?: SecretaryRun
  createdAt?: number
  followUp?: boolean
  planRevision?: number
  planOpenKinds?: CliUsageKind[]
  planStatus?: 'awaiting-approval' | 'dispatching' | 'sent' | 'completed' | 'rejected' | 'cancelled' | 'failed' | 'interrupted'
  awaitingAnswer?: boolean
  awaitingAssignmentId?: string
  report?: SecretaryRunEvidence
  error?: boolean
}

interface ManagerConversationProps {
  items: ManagerChatItem[]
  editingPlanMessageId: string | null
  planDraft: SecretaryPlan | null
  revisingPlan: boolean
  sending: boolean
  cancellingRunId: string | null
  answering: boolean
  onPlanDraftChange: (plan: SecretaryPlan) => void
  onStartPlanRevision: (messageId: string, plan: SecretaryPlan) => void
  onCancelPlanRevision: () => void
  onSavePlanRevision: (messageId: string, revision: number, runId?: string) => void
  onApprovePlan: (messageId: string, plan: SecretaryPlan, openKinds: CliUsageKind[], runId?: string) => void
  onRejectPlan: (messageId: string, runId?: string) => void
  onCancelRun: (messageId: string, runId?: string) => void
  onAnswerRun: (messageId: string, runId: string, assignmentId: string | undefined, answer: string) => Promise<boolean>
  onOpenAgent: (sessionId: string) => void
  onReviewChanges: (sessionIds: string[]) => void
  onOpenAgentWork: () => void
  panelStatuses: Record<string, string>
}

function ManagerPlanCard({ item, props }: { item: ManagerChatItem; props: ManagerConversationProps }): React.JSX.Element | null {
  const plan = item.plan
  if (!plan) return null
  const editing = props.editingPlanMessageId === item.id && props.planDraft
  const rootCount = plan.assignments.filter((assignment) => !assignment.dependsOn?.length).length
  return (
    <div className="secretary-plan" aria-label={item.followUp ? 'Follow-up plan' : 'Manager plan'}>
      {editing ? (
        <div className="secretary-plan-editor">
          <label>
            <span>Plan overview</span>
            <textarea value={props.planDraft!.overview} rows={2} disabled={props.revisingPlan}
              onChange={(event) => props.onPlanDraftChange({ ...props.planDraft!, overview: event.target.value })} />
          </label>
          {props.planDraft!.assignments.map((assignment) => (
            <label key={assignment.id}>
              <span>{AI_ACCOUNT_LABELS[assignment.kind]} assignment</span>
              <input value={assignment.title} disabled={props.revisingPlan}
                onChange={(event) => props.onPlanDraftChange({
                  ...props.planDraft!, assignments: props.planDraft!.assignments.map((entry) =>
                    entry.id === assignment.id ? { ...entry, title: event.target.value } : entry)
                })} />
              <textarea value={assignment.instruction} rows={4} disabled={props.revisingPlan}
                onChange={(event) => props.onPlanDraftChange({
                  ...props.planDraft!, assignments: props.planDraft!.assignments.map((entry) =>
                    entry.id === assignment.id ? { ...entry, instruction: event.target.value } : entry)
                })} />
            </label>
          ))}
          <div className="secretary-plan-actions">
            <span>Changes are safety-checked and saved before approval.</span>
            <button type="button" disabled={props.revisingPlan || props.sending}
              onClick={() => props.onSavePlanRevision(item.id, item.planRevision ?? 1, item.runId)}>
              {props.revisingPlan ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save revision
            </button>
            <button type="button" onClick={props.onCancelPlanRevision} disabled={props.revisingPlan}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="secretary-plan-heading">
            <div>
              <span>{item.followUp ? 'Follow-up plan' : item.planStatus === 'awaiting-approval' ? 'Proposed plan' : 'Approved plan'}{item.planRevision ? ` · revision ${item.planRevision}` : ''}</span>
              <p>{plan.overview}</p>
              <small className="secretary-plan-topology">{plan.assignments.length} task{plan.assignments.length === 1 ? '' : 's'} · {rootCount} parallel root{rootCount === 1 ? '' : 's'}</small>
            </div>
            <SecretaryAvatar mood="working" variant="card" decorative />
          </div>
          <div className="secretary-assignments">
            {plan.assignments.map((assignment) => (
              <article key={assignment.id}>
                <div><span>{AI_ACCOUNT_LABELS[assignment.kind]} · {assignment.mode}</span><small>{assignment.usageNote}</small></div>
                <strong>{assignment.title}</strong>
                <p>{assignment.instruction}</p>
                <small className="secretary-assignment-expected">Expected: {assignment.expectedResult}</small>
                {assignment.dependsOn?.length ? (
                  <small className="secretary-assignment-dependency">After: {assignment.dependsOn.map((id) => plan.assignments.find((entry) => entry.id === id)?.title ?? id).join(', ')}</small>
                ) : null}
              </article>
            ))}
          </div>
          <div className="secretary-plan-actions">
            {item.planStatus === 'awaiting-approval' ? (
              <>
                <span><ShieldCheck className="h-3.5 w-3.5" /> Review this plan before CLI work starts</span>
                {item.runId ? <button type="button" disabled={props.sending || props.revisingPlan} onClick={() => props.onStartPlanRevision(item.id, plan)}><Pencil className="h-3.5 w-3.5" /> Revise</button> : null}
                <button type="button" disabled={props.sending} onClick={() => props.onApprovePlan(item.id, plan, item.planOpenKinds ?? [], item.runId)}><ArrowUp className="h-3.5 w-3.5" /> Approve plan</button>
                <button type="button" disabled={props.sending} onClick={() => props.onRejectPlan(item.id, item.runId)}>Cancel</button>
              </>
            ) : null}
            {item.planStatus === 'rejected' ? <span>Plan cancelled. No CLI work started.</span> : null}
            {item.planStatus === 'failed' ? <span>Run failed. Inspect its terminal before starting new work.</span> : null}
            {item.planStatus === 'cancelled' ? <span>Run cancelled. No further Manager prompts will be sent.</span> : null}
            {item.planStatus === 'interrupted' ? <span>Observation stopped after restart. Inspect the original CLI terminal.</span> : null}
          </div>
        </>
      )}
    </div>
  )
}

function ManagerRunCard({ item, props }: { item: ManagerChatItem; props: ManagerConversationProps }): React.JSX.Element | null {
  if (!item.plan || !item.planStatus || item.planStatus === 'awaiting-approval' || item.planStatus === 'rejected') return null
  const bindings = new Map(item.run?.sessionBindings.map((binding) => [binding.assignmentId, binding.sessionId]) ?? [])
  const live = item.planStatus === 'dispatching' || item.planStatus === 'sent'
  const state = item.planStatus === 'dispatching' ? 'Preparing approved work'
    : item.run?.status === 'needs-user' ? 'Agent needs input'
    : item.planStatus === 'sent' ? 'Agents working'
    : item.planStatus === 'completed' ? 'Agent work ended'
    : item.planStatus === 'interrupted' ? 'Work interrupted'
    : item.planStatus === 'cancelled' ? 'Work cancelled' : 'Work failed'
  return (
    <div className="secretary-run-card secretary-work-card" aria-label="Running Manager work">
      <div className="secretary-run-card-header">
        <strong>{state}</strong>
        <span>{item.createdAt ? new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Now'}</span>
      </div>
      <div className="secretary-run-assignments">
        {item.plan.assignments.map((assignment) => {
          const sessionId = bindings.get(assignment.id) ?? assignment.panelId
          const panelStatus = sessionId ? props.panelStatuses[sessionId] : undefined
          const assignmentState = item.run?.status === 'needs-user' ? 'Needs input'
            : !live ? 'Ended'
            : panelStatus === 'busy' || panelStatus === 'running' ? 'Working'
            : panelStatus === 'waiting' ? 'Waiting'
            : panelStatus === 'starting' || item.planStatus === 'dispatching' ? 'Starting'
            : panelStatus === 'error' ? 'Error' : panelStatus === 'stopped' ? 'Stopped' : 'Working'
          return (
            <div key={assignment.id}>
              <strong>{assignment.title}</strong>
              <small>{AI_ACCOUNT_LABELS[assignment.kind]} · {assignment.mode} · {assignmentState}</small>
              {sessionId ? <button type="button" onClick={() => props.onOpenAgent(sessionId)}>Open agent</button> : null}
            </div>
          )
        })}
      </div>
      {live && item.runId ? <button type="button" className="secretary-review-changes" disabled={Boolean(props.cancellingRunId)} onClick={() => props.onCancelRun(item.id, item.runId)}>{props.cancellingRunId === item.runId ? 'Cancelling…' : 'Cancel run'}</button> : null}
    </div>
  )
}

function ManagerNeedsInputCard({ item, props }: { item: ManagerChatItem; props: ManagerConversationProps }): React.JSX.Element | null {
  const [answer, setAnswer] = useState('')
  if (!item.awaitingAnswer || !item.runId) return null
  return (
    <div className="secretary-run-card secretary-needs-input" aria-label="Agent needs input">
      <div className="secretary-run-card-header"><strong>Agent needs input</strong><span>Waiting</span></div>
      <p>{item.content}</p>
      <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} rows={2} placeholder="Answer this agent…" />
      <button type="button" className="secretary-review-changes" disabled={!answer.trim() || props.answering}
        onClick={() => void props.onAnswerRun(item.id, item.runId!, item.awaitingAssignmentId, answer.trim())}>
        {props.answering ? 'Sending…' : 'Send answer'}
      </button>
    </div>
  )
}

function ManagerResultCard({ report, props }: { report: SecretaryRunEvidence; props: ManagerConversationProps }): React.JSX.Element {
  const sessionIds = report.assignments.map((assignment) => assignment.sessionId).filter(Boolean)
  const patchChecks = report.assignments.map((assignment) => assignment.patchCheckExitCode)
  const preexistingCount = new Set(report.assignments.flatMap((assignment) => assignment.preexistingChangedFiles)).size
  return (
    <div className="secretary-report-facts secretary-run-card" aria-label="Manager result">
      <div className="secretary-run-card-header">
        <strong>Result</strong>
        <span>{report.verificationLevel === 'git-observed' ? 'Git activity observed' : report.verificationLevel === 'cli-reported' ? 'CLI reported' : 'Unverified completion signal'}</span>
      </div>
      <div className="secretary-run-timeline">
        <span>{report.changedFiles.length} Git snapshot file{report.changedFiles.length === 1 ? '' : 's'}</span>
        <span className={patchChecks.length > 0 && patchChecks.every((code) => code === 0) ? 'is-observed' : 'is-pending'}>
          {patchChecks.length > 0 && patchChecks.every((code) => code === 0) ? 'Tracked patch check passed' : patchChecks.some((code) => code !== null && code !== 0) ? 'Tracked patch check failed' : 'Patch check unavailable'}
        </span>
        <span className="is-pending">Tests/builds: no independent result recorded</span>
      </div>
      <div className="secretary-run-assignments">
        {report.assignments.map((assignment) => (
          <div key={assignment.assignmentId}>
            <strong>{assignment.title}</strong>
            <small>{AI_ACCOUNT_LABELS[assignment.kind]} · {assignment.outcome} · {assignment.completionEvidence === 'cli-reported' ? 'CLI signal' : 'Idle inferred'}</small>
            {assignment.sessionId ? <button type="button" onClick={() => props.onOpenAgent(assignment.sessionId)}>Open agent</button> : null}
          </div>
        ))}
      </div>
      {preexistingCount > 0 ? <p className="secretary-report-warning">{preexistingCount} file(s) were already changed before agent work.</p> : null}
      {report.unverifiedReportedFiles.length > 0 ? <p className="secretary-report-warning">CLI mentioned {report.unverifiedReportedFiles.length} file(s) Git could not verify.</p> : null}
      <div className="secretary-result-actions">
        <button type="button" className="secretary-review-changes" onClick={() => props.onReviewChanges(sessionIds)}>Review Changes</button>
        <button type="button" className="secretary-review-changes" onClick={props.onOpenAgentWork}>Open Agent Work &amp; Changes</button>
      </div>
    </div>
  )
}

function ManagerMessage({ item, props }: { item: ManagerChatItem; props: ManagerConversationProps }): React.JSX.Element {
  return (
    <article className={cn('secretary-bubble', item.role === 'user' ? 'is-user' : 'is-assistant', item.error && 'is-error')}>
      {item.content && !(item.awaitingAnswer && item.runId) ? <p>{item.content}</p> : null}
      {item.plan ? <ManagerPlanCard item={item} props={props} /> : null}
      {item.plan ? <ManagerRunCard item={item} props={props} /> : null}
      {item.awaitingAnswer ? <ManagerNeedsInputCard item={item} props={props} /> : null}
      {item.report ? <ManagerResultCard report={item.report} props={props} /> : null}
    </article>
  )
}

export function ManagerConversation(props: ManagerConversationProps): React.JSX.Element {
  return <>{props.items.map((item) => <ManagerMessage key={item.id} item={item} props={props} />)}</>
}

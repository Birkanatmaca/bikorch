import { useState } from 'react'
import { AlertCircle, ArrowUp, Check, CircleHelp, FileCode2, Loader2, Pencil, Save, Square } from 'lucide-react'
import { AI_ACCOUNT_LABELS } from '@shared/contracts/accounts'
import type { SecretaryPlan, SecretaryRun, SecretaryRunEvidence } from '@shared/contracts/secretary'
import type { CliUsageKind } from '@shared/contracts/usage'
import { ManagerMarkdown } from './ManagerMarkdown'
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
  const pending = item.planStatus === 'awaiting-approval' || !item.planStatus
  const rootCount = plan.assignments.filter((assignment) => !assignment.dependsOn?.length).length
  const assignments = (
    <div className="secretary-assignments manager-chat-detail-content">
      {plan.assumptions.length > 0 ? (
        <div className="manager-plan-assumptions">
          <strong>Assumptions</strong>
          <ul>{plan.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul>
        </div>
      ) : null}
      {plan.assignments.map((assignment) => (
        <article key={assignment.id}>
          <div><span>{AI_ACCOUNT_LABELS[assignment.kind]} · {assignment.mode}</span><small>{assignment.usageNote}</small></div>
          <strong>{assignment.title}</strong>
          <ManagerMarkdown content={assignment.instruction} />
          <small className="secretary-assignment-expected">Expected: {assignment.expectedResult}</small>
          {assignment.dependsOn?.length ? (
            <small className="secretary-assignment-dependency">After: {assignment.dependsOn.map((id) => plan.assignments.find((entry) => entry.id === id)?.title ?? id).join(', ')}</small>
          ) : null}
        </article>
      ))}
    </div>
  )
  if (!pending && !editing) {
    return (
      <details className="manager-chat-details manager-plan-archive">
        <summary>{item.planStatus === 'rejected' ? 'Plan cancelled' : 'View plan'} <span>{plan.assignments.length} task{plan.assignments.length === 1 ? '' : 's'}</span></summary>
        <div className="manager-chat-detail-content"><ManagerMarkdown content={plan.overview} /></div>
        {assignments}
      </details>
    )
  }
  return (
    <div className="secretary-plan manager-chat-card" aria-label={item.followUp ? 'Follow-up plan' : 'Manager plan'}>
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
            <button type="button" className="manager-chat-action-primary" disabled={props.revisingPlan || props.sending}
              onClick={() => props.onSavePlanRevision(item.id, item.planRevision ?? 1, item.runId)}>
              {props.revisingPlan ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save revision
            </button>
            <button type="button" onClick={props.onCancelPlanRevision} disabled={props.revisingPlan}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="secretary-plan-heading manager-chat-card-heading">
            <div>
              <strong>{item.followUp ? 'Next step' : 'Ready to start'}</strong>
              <ManagerMarkdown content={plan.overview} />
            </div>
            <span className="manager-chat-status is-pending">Your approval</span>
          </div>
          <details className="manager-chat-details">
            <summary>Plan details <span>{plan.assignments.length} task{plan.assignments.length === 1 ? '' : 's'}{rootCount > 1 ? ` · ${rootCount} in parallel` : ''}</span></summary>
            {assignments}
          </details>
          <div className="secretary-plan-actions">
            {pending ? (
              <>
                <button type="button" className="manager-chat-action-primary" disabled={props.sending || props.revisingPlan} onClick={() => props.onApprovePlan(item.id, plan, item.planOpenKinds ?? [], item.runId)}><ArrowUp className="h-3.5 w-3.5" /> Start work</button>
                {item.runId ? <button type="button" disabled={props.sending || props.revisingPlan} onClick={() => props.onStartPlanRevision(item.id, plan)}><Pencil className="h-3.5 w-3.5" /> Edit plan</button> : null}
                <button type="button" disabled={props.sending} onClick={() => props.onRejectPlan(item.id, item.runId)}>Cancel</button>
              </>
            ) : null}
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
  const needsInput = item.run?.status === 'needs-user'
  const failed = item.planStatus === 'failed'
  const state = item.planStatus === 'dispatching' ? 'Starting CLI'
    : needsInput ? 'Waiting for your input'
    : item.planStatus === 'sent' ? 'Running CLI'
    : item.planStatus === 'completed' ? 'Agent work finished'
    : item.planStatus === 'interrupted' ? 'Work interrupted'
    : item.planStatus === 'cancelled' ? 'Work cancelled' : 'Work failed'
  const terminalId = item.run?.sessionBindings[0]?.sessionId ?? item.plan.assignments.find((assignment) => assignment.panelId)?.panelId
  const failureMessage = item.run?.errorMessage
  return (
    <div className={cn('secretary-run-card secretary-work-card manager-chat-card', failed && 'is-error')} aria-label="Manager work status">
      <div className="secretary-run-card-header">
        <strong className="manager-chat-state">
          {live && !needsInput ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : failed || item.planStatus === 'interrupted' ? <AlertCircle className="h-3.5 w-3.5" /> : needsInput ? <CircleHelp className="h-3.5 w-3.5" /> : item.planStatus === 'completed' ? <Check className="h-3.5 w-3.5" /> : <Square className="h-3 w-3" />}
          {state}
        </strong>
        <span className={cn('manager-chat-status', failed && 'is-error', needsInput && 'is-pending')}>
          {item.plan.assignments.length} task{item.plan.assignments.length === 1 ? '' : 's'}
        </span>
      </div>
      {live && !needsInput ? <p className="manager-chat-inline-note">Running CLI. The output stays visible, and the manager reports back from it.</p> : null}
      {failed && failureMessage && failureMessage !== item.content ? <ManagerMarkdown content={failureMessage} /> : null}
      {item.planStatus === 'interrupted' ? <p className="manager-chat-inline-note">Observation stopped after restart. Open an agent to check its current state.</p> : null}
      <details className="manager-chat-details">
        <summary>Agents &amp; terminals</summary>
        <div className="secretary-run-assignments manager-chat-detail-content">
          {item.plan.assignments.map((assignment) => {
            const sessionId = bindings.get(assignment.id) ?? assignment.panelId
            const panelStatus = sessionId ? props.panelStatuses[sessionId] : undefined
            const outcome = item.report?.assignments.find((entry) => entry.assignmentId === assignment.id)?.outcome
              ?? item.run?.evidence?.assignments.find((entry) => entry.assignmentId === assignment.id)?.outcome
            const assignmentState = panelStatus === 'error' || outcome === 'failed' ? 'Error'
              : outcome === 'needs-user' || needsInput ? 'Needs input'
              : !live ? outcome === 'completed' ? 'Finished' : 'Ended'
              : panelStatus === 'waiting' ? 'Waiting'
              : panelStatus === 'starting' || item.planStatus === 'dispatching' ? 'Starting CLI'
              : panelStatus === 'stopped' ? 'Stopped' : 'Running CLI'
            return (
              <div key={assignment.id}>
                <strong>{assignment.title}</strong>
                <small>{AI_ACCOUNT_LABELS[assignment.kind]} · {assignmentState}</small>
                {sessionId ? <button type="button" onClick={() => props.onOpenAgent(sessionId)}>Open terminal</button> : null}
              </div>
            )
          })}
          {item.run?.errorCode ? <small className="manager-chat-inline-note">Error code: {item.run.errorCode}</small> : null}
        </div>
      </details>
      {(failed || item.planStatus === 'interrupted') && terminalId ? <button type="button" className="secretary-review-changes" onClick={() => props.onOpenAgent(terminalId)}>Inspect terminal</button> : null}
      {live && item.runId ? <button type="button" className="secretary-review-changes" disabled={Boolean(props.cancellingRunId)} onClick={() => props.onCancelRun(item.id, item.runId)}><Square className="h-3 w-3" />{props.cancellingRunId === item.runId ? 'Stopping…' : 'Stop and close CLIs'}</button> : null}
    </div>
  )
}

function ManagerNeedsInputCard({ item, props }: { item: ManagerChatItem; props: ManagerConversationProps }): React.JSX.Element | null {
  const [answer, setAnswer] = useState('')
  if (!item.awaitingAnswer || !item.runId) return null
  return (
    <div className="secretary-run-card secretary-needs-input manager-chat-card" aria-label="Agent needs input">
      <div className="secretary-run-card-header"><strong className="manager-chat-state"><CircleHelp className="h-3.5 w-3.5" />Your input is needed</strong></div>
      <ManagerMarkdown content={item.content} />
      <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} disabled={props.answering} rows={2} placeholder="Write your answer…" aria-label="Answer the waiting agent" />
      <button type="button" className="secretary-review-changes manager-chat-action-primary" disabled={!answer.trim() || props.answering}
        onClick={() => void props.onAnswerRun(item.id, item.runId!, item.awaitingAssignmentId, answer.trim()).then((sent) => { if (sent) setAnswer('') })}>
        {props.answering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}{props.answering ? 'Sending…' : 'Send answer'}
      </button>
    </div>
  )
}

function ManagerResultCard({ report, props }: { report: SecretaryRunEvidence; props: ManagerConversationProps }): React.JSX.Element {
  const sessionIds = [...new Set(report.assignments.map((assignment) => assignment.sessionId).filter(Boolean))]
  const patchChecks = report.assignments.map((assignment) => assignment.patchCheckExitCode)
  const preexistingCount = new Set(report.assignments.flatMap((assignment) => assignment.preexistingChangedFiles)).size
  const patchPassed = patchChecks.length > 0 && patchChecks.every((code) => code === 0)
  const patchFailed = patchChecks.some((code) => code !== null && code !== 0)
  return (
    <div className="secretary-report-facts secretary-run-card manager-chat-card" aria-label="Manager result">
      <div className="secretary-run-card-header">
        <strong className="manager-chat-state"><FileCode2 className="h-3.5 w-3.5" />Work summary</strong>
        <span className="manager-chat-status">{report.changedFiles.length} file{report.changedFiles.length === 1 ? '' : 's'} observed</span>
      </div>
      <p className="manager-chat-inline-note">Tests and builds have no independent verification.{preexistingCount > 0 ? ' The snapshot includes earlier edits.' : ''}</p>
      <div className="secretary-result-actions">
        <button type="button" className="secretary-review-changes manager-chat-action-primary" onClick={() => props.onReviewChanges(sessionIds)}>Review changes</button>
        <button type="button" className="secretary-review-changes" onClick={props.onOpenAgentWork}>Open work</button>
      </div>
      <details className="manager-chat-details">
        <summary>Evidence &amp; files <span>{report.verificationLevel === 'git-observed' ? 'Git observed' : report.verificationLevel === 'cli-reported' ? 'CLI reported' : 'Unverified signal'}</span></summary>
        <div className="manager-chat-detail-content">
          <div className="secretary-run-timeline">
            <span className={patchPassed ? 'is-observed' : 'is-pending'}>
              {patchPassed ? 'Tracked patch check passed' : patchFailed ? 'Tracked patch check failed' : 'Patch check unavailable'}
            </span>
            <span className="is-pending">Completion signals do not verify the result.</span>
          </div>
          {report.changedFiles.length > 0 ? <ul className="manager-evidence-files">{report.changedFiles.map((file) => <li key={file}><code>{file}</code></li>)}</ul> : <p className="secretary-report-empty">No file changes were observed in Git.</p>}
          <div className="secretary-run-assignments">
            {report.assignments.map((assignment) => (
              <div key={assignment.assignmentId}>
                <strong>{assignment.title}</strong>
                <small>{AI_ACCOUNT_LABELS[assignment.kind]} · {assignment.outcome} · {assignment.completionEvidence === 'cli-reported' ? 'CLI signal' : 'Idle inferred'}</small>
                {assignment.sessionId ? <button type="button" onClick={() => props.onOpenAgent(assignment.sessionId)}>Open terminal</button> : null}
              </div>
            ))}
          </div>
          {preexistingCount > 0 ? <p className="secretary-report-warning">{preexistingCount} file{preexistingCount === 1 ? ' was' : 's were'} already changed before this work.</p> : null}
          {report.unverifiedReportedFiles.length > 0 ? <p className="secretary-report-warning">Git could not verify {report.unverifiedReportedFiles.length} file{report.unverifiedReportedFiles.length === 1 ? '' : 's'} mentioned by the agents.</p> : null}
        </div>
      </details>
    </div>
  )
}

function ManagerMessage({ item, props }: { item: ManagerChatItem; props: ManagerConversationProps }): React.JSX.Element {
  const pendingPlan = item.planStatus === 'awaiting-approval' || !item.planStatus
  return (
    <article className={cn('secretary-bubble manager-message', item.role === 'user' ? 'is-user' : 'is-assistant', item.error && 'is-error')}>
      <div className="manager-message-meta">
        <span>{item.error ? <AlertCircle className="h-3 w-3" /> : null}{item.role === 'user' ? 'You' : 'Manager'}{item.error ? ' · Error' : ''}</span>
        {item.createdAt ? <time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time> : null}
      </div>
      {item.content && !(item.awaitingAnswer && item.runId) ? item.role === 'assistant' ? <ManagerMarkdown content={item.content} /> : <p className="manager-user-content">{item.content}</p> : null}
      {item.plan && pendingPlan ? <ManagerPlanCard item={item} props={props} /> : null}
      {item.plan && !(item.report && item.planStatus === 'completed') ? <ManagerRunCard item={item} props={props} /> : null}
      {item.plan && !pendingPlan ? <ManagerPlanCard item={item} props={props} /> : null}
      {item.awaitingAnswer ? <ManagerNeedsInputCard item={item} props={props} /> : null}
      {item.report ? <ManagerResultCard report={item.report} props={props} /> : null}
    </article>
  )
}

export function ManagerConversation(props: ManagerConversationProps): React.JSX.Element {
  return <>{props.items.map((item) => <ManagerMessage key={item.id} item={item} props={props} />)}</>
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StickToBottomContext } from 'use-stick-to-bottom';
import { Bot, Clock, FileText, Loader2, Search, Send, ShieldQuestion, Terminal, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChatContainerContent, ChatContainerRoot, ChatContainerScrollAnchor } from '@/components/prompt-kit/chat-container';
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtItem, ChainOfThoughtStep, ChainOfThoughtTrigger } from '@/components/prompt-kit/chain-of-thought';
import { Message, MessageContent } from '@/components/prompt-kit/message';
import { PromptInput, PromptInputActions, PromptInputAction, PromptInputTextarea } from '@/components/prompt-kit/prompt-input';
import { Tool, type ToolLabels, type ToolPart } from '@/components/prompt-kit/tool';
import { cn } from '@/lib/utils';
import { getAcpRawFrames, getAcpSession, respondAcpPermission, sendAcpPrompt } from '@/api';
import { displayStatus } from '@/i18n';
import type { AcpPermissionRequestVm, AcpRawFramePageVm, AcpRawFrameQueryInput, AcpRawFrameVm, AcpSessionVm, AcpUiEventVm } from '@/types';

interface ACPChatDialogProps {
  session?: AcpSessionVm | null;
  taskId: string;
  runId: string;
  roundId: string;
  nodeId: string;
  attemptId: string;
}

type AcpCanvasMode = 'chat' | 'raw';
type ToolTone = 'muted' | 'pending' | 'running' | 'success' | 'danger';
type AcpProcessingKind = 'sending' | 'launching' | 'processing' | 'thinking' | 'tool' | 'responding';
type AcpTimelineEvent = AcpUiEventVm & {
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  optimistic?: boolean;
};

const hiddenSessionUpdates = new Set([
  'available_commands_update',
  'usage_update',
  'session_info_update',
  'current_mode_update',
  'config_option_update',
]);

const hiddenEventKinds = new Set([
  'availableCommands',
  'usageUpdate',
  'sessionInfo',
  'modeUpdate',
  'configUpdate',
  'permissionRequest',
  'rawDiagnostic',
]);

export function ACPChatDialog({ session, taskId, runId, roundId, nodeId, attemptId }: ACPChatDialogProps) {
  const { t } = useTranslation();
  const [currentSession, setCurrentSession] = useState<AcpSessionVm | null>(session ?? null);
  const [optimisticEvents, setOptimisticEvents] = useState<AcpUiEventVm[]>([]);
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [awaitingResponse, setAwaitingResponse] = useState(false);
  const [activeTurnStartedAt, setActiveTurnStartedAt] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [canvasMode, setCanvasMode] = useState<AcpCanvasMode>('chat');
  const [rawPage, setRawPage] = useState<AcpRawFramePageVm | null>(null);
  const [rawQuery, setRawQuery] = useState<AcpRawFrameQueryInput>({ page: 0, pageSize: 100 });
  const [rawLoading, setRawLoading] = useState(false);
  const [dismissedPermissionIds, setDismissedPermissionIds] = useState<Set<string>>(() => new Set());
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const scrollContextRef = useRef<StickToBottomContext | null>(null);
  const sessionKey = `${taskId}:${runId}:${roundId}:${nodeId}:${attemptId}`;

  useEffect(() => {
    setCurrentSession(session ?? null);
  }, [session]);

  useEffect(() => {
    setOptimisticEvents([]);
    setDismissedPermissionIds(new Set());
    setPermissionError(null);
    setSendError(null);
    setAwaitingResponse(false);
    setActiveTurnStartedAt(null);
    setRawPage(null);
    setRawQuery({ page: 0, pageSize: 100 });
    setCanvasMode('chat');
  }, [sessionKey]);

  useEffect(() => {
    if (!awaitingResponse || sending) return;
    let active = true;
    const timer = window.setInterval(async () => {
      try {
        const updated = await getAcpSession(taskId, runId, roundId, nodeId, attemptId, currentSession ?? session ?? null);
        if (active && updated) {
          setCurrentSession(updated);
        }
      } catch {
        // The send request owns user-visible error handling.
      }
    }, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [attemptId, awaitingResponse, currentSession, nodeId, roundId, runId, sending, session, taskId]);

  const baseSession = currentSession ?? session;
  const effective = useMemo(() => mergeOptimisticSession(baseSession, optimisticEvents), [baseSession, optimisticEvents]);
  const pendingPermission = effective?.pendingPermissions?.find((request) => !dismissedPermissionIds.has(request.requestId)) ?? null;
  const composerTimeline = useMemo(() => buildAcpTimeline(effective?.events ?? []), [effective?.events]);
  const sessionActive = isSessionActive(effective?.status);
  const composerActive = sending || awaitingResponse || sessionActive;
  const composerLatestEvent = composerTimeline.at(-1) ?? null;
  const awaitingFirstResponse = awaitingResponse && !hasResponseAfterTurn(effective?.events ?? [], activeTurnStartedAt);
  const turnTotalSeconds = useTurnTotalSeconds(effective?.events ?? [], composerActive, activeTurnStartedAt);
  const composerProcessingKind: AcpProcessingKind = sending ? 'sending' : awaitingFirstResponse ? 'processing' : composerTimeline.length === 0 ? 'launching' : processingKindFromTimeline(composerLatestEvent, false);
  const showComposerStatus = composerActive || turnTotalSeconds != null;
  const composerStatusStartAt = sending || awaitingFirstResponse ? activeTurnStartedAt : composerLatestEvent?.startedAt ?? composerLatestEvent?.timestamp ?? activeTurnStartedAt;
  const composerInputHint = sending ? t('acp.sending') : composerActive ? t('acp.processing') : t('acp.promptInputHint');
  const lastEvent = effective?.events.at(-1);
  const eventScrollSignature = `${effective?.events.length ?? 0}:${lastEvent?.seq ?? ''}:${lastEvent?.kind ?? ''}:${sending}`;

  useEffect(() => {
    if (!awaitingResponse || sessionActive || sending) return;
    setAwaitingResponse(false);
  }, [awaitingResponse, sending, sessionActive]);

  useEffect(() => {
    const sessionEvents = baseSession?.events ?? [];
    if (!hasResponseAfterTurn(sessionEvents, activeTurnStartedAt)) return;
    setOptimisticEvents((current) => current.filter((event) => !hasMatchingUserPrompt(sessionEvents, event)));
  }, [activeTurnStartedAt, baseSession?.events]);

  useEffect(() => {
    if (canvasMode !== 'chat') return;
    void scrollContextRef.current?.scrollToBottom({ animation: 'instant', ignoreEscapes: true });
  }, [canvasMode, eventScrollSignature]);

  const preserveScrollPosition = () => {
    const context = scrollContextRef.current;
    const scrollElement = context?.scrollRef.current;
    if (!context || !scrollElement) return;
    const scrollTop = scrollElement.scrollTop;
    context.stopScroll();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollElement.scrollTop = scrollTop;
        context.stopScroll();
      });
    });
  };

  const send = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || pendingPermission) return;
    const optimisticEvent = optimisticUserEvent(trimmed);
    setPrompt('');
    setSendError(null);
    setActiveTurnStartedAt(optimisticEvent.timestamp);
    setAwaitingResponse(false);
    setOptimisticEvents((current) => [...current, optimisticEvent]);
    setSending(true);
    try {
      const updated = await sendAcpPrompt(taskId, runId, roundId, nodeId, attemptId, trimmed, effective ?? null);
      setCurrentSession(updated);
      setOptimisticEvents((current) => current.map((event) => event.id === optimisticEvent.id ? { ...event, status: 'processing' } : event));
      setAwaitingResponse(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSendError(message);
      setAwaitingResponse(false);
      setActiveTurnStartedAt(null);
      setOptimisticEvents((current) => current.map((event) => event.id === optimisticEvent.id ? { ...event, status: 'failed' } : event));
    } finally {
      setSending(false);
    }
  };

  const answerPermission = async (request: AcpPermissionRequestVm, optionId: string) => {
    setPermissionError(null);
    setDismissedPermissionIds((current) => new Set(current).add(request.requestId));
    try {
      const updated = await respondAcpPermission(taskId, runId, roundId, nodeId, attemptId, request.requestId, optionId, effective);
      setCurrentSession(updated);
    } catch (error) {
      setDismissedPermissionIds((current) => {
        const next = new Set(current);
        next.delete(request.requestId);
        return next;
      });
      setPermissionError(error instanceof Error ? error.message : String(error));
    }
  };

  const loadRawFrames = async (query: AcpRawFrameQueryInput) => {
    setRawLoading(true);
    try {
      const next = await getAcpRawFrames(taskId, runId, roundId, nodeId, attemptId, query);
      setRawPage(next);
      setRawQuery({
        page: next.page,
        pageSize: next.pageSize,
        search: next.search ?? undefined,
        kind: next.kind ?? undefined,
        direction: next.direction ?? undefined,
      });
    } finally {
      setRawLoading(false);
    }
  };

  const toggleRawFrames = async () => {
    preserveScrollPosition();
    if (canvasMode === 'raw') {
      setCanvasMode('chat');
      return;
    }
    if (rawPage == null) await loadRawFrames(rawQuery);
    setCanvasMode('raw');
  };

  if (!effective) {
    return <AcpErrorState reason={t('acp.missingSessionReason')} />;
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <ACPSessionHeader session={effective} rawActive={canvasMode === 'raw'} rawLoading={rawLoading} onToggleRaw={toggleRawFrames} />
      {effective.diagnostics.lastError ? <AcpErrorBanner reason={effective.diagnostics.lastError} /> : null}
      <ChatContainerRoot resize="instant" initial="instant" contextRef={scrollContextRef} className="min-h-0 min-w-0 max-w-full flex-1 overflow-x-hidden">
        <ChatContainerContent className="w-full min-w-0 max-w-full space-y-4 overflow-hidden p-5">
          {canvasMode === 'raw' ? (
            <RawFrameViewer
              loading={rawLoading}
              page={rawPage}
              query={rawQuery}
              onLayoutChange={preserveScrollPosition}
              onQueryChange={(query) => void loadRawFrames(query)}
            />
          ) : (
            <>
              <ACPMessageList events={effective.events} sessionStatus={effective.status} sending={sending} onLayoutChange={preserveScrollPosition} />
              {sendError ? <AcpErrorBanner reason={`${t('acp.sendFailed')}：${sendError}`} /> : null}
              {permissionError ? <AcpErrorBanner reason={permissionError} /> : null}
              {pendingPermission ? <PermissionRequestCard request={pendingPermission} onSelect={(optionId) => answerPermission(pendingPermission, optionId)} /> : null}
              <ChatContainerScrollAnchor />
            </>
          )}
        </ChatContainerContent>
      </ChatContainerRoot>
      {canvasMode === 'chat' ? (
        <div className="shrink-0 border-t bg-background/95 p-4 backdrop-blur">
          <PromptInput
            value={prompt}
            onValueChange={setPrompt}
            onSubmit={send}
            isLoading={sending}
            disabled={Boolean(pendingPermission)}
            className="rounded-2xl bg-card/80 shadow-sm shadow-background/30 transition-colors focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10"
          >
            {showComposerStatus ? (
              <AcpComposerStatus
                kind={composerProcessingKind}
                active={composerActive}
                startAt={composerStatusStartAt}
                totalSeconds={turnTotalSeconds}
              />
            ) : null}
            <PromptInputTextarea
              className="min-h-16 text-sm leading-6 text-foreground placeholder:text-muted-foreground"
              placeholder={pendingPermission ? t('acp.permissionPending') : t('acp.composerPlaceholder')}
            />
            <div className="mt-2 flex items-center justify-between gap-4 px-2 pb-1">
              <span className="text-xs text-muted-foreground">{composerInputHint}</span>
              <PromptInputActions className="shrink-0 pl-2">
                <PromptInputAction tooltip={t('acp.send')}>
                  <Button className="h-8 gap-1.5 rounded-full px-3" size="sm" disabled={sending || !prompt.trim() || Boolean(pendingPermission)} onClick={send}>
                    {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                    {t('acp.send')}
                  </Button>
                </PromptInputAction>
              </PromptInputActions>
            </div>
            <AcpSessionConfigBar session={effective} />
          </PromptInput>
        </div>
      ) : null}
    </div>
  );
}

function AcpErrorState({ reason }: { reason: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AcpErrorBanner reason={reason} />
      <div className="flex-1" />
    </div>
  );
}

function AcpErrorBanner({ reason }: { reason: string }) {
  const { t } = useTranslation();
  return (
    <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-5 py-3 text-sm">
      <span className="font-semibold text-destructive">{t('acp.sessionFailed')}</span>
      <span className="ml-2 text-muted-foreground">{reason}</span>
    </div>
  );
}

function AcpSessionConfigBar({ session }: { session: AcpSessionVm }) {
  const { t } = useTranslation();
  const model = session.config?.currentModelName ?? session.config?.currentModelId;
  const mode = session.config?.currentModeName ?? session.config?.currentModeId;

  if (!model && !mode) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-2 py-2 text-xs text-muted-foreground">
      {model ? (
        <Badge variant="outline" className="max-w-full gap-1.5 rounded-full bg-background/50 px-2 py-0.5 font-normal">
          <span className="shrink-0 text-muted-foreground">{t('acp.currentModel')}</span>
          <span className="min-w-0 truncate text-foreground">{model}</span>
        </Badge>
      ) : null}
      {mode ? (
        <Badge variant="outline" className="max-w-full gap-1.5 rounded-full bg-background/50 px-2 py-0.5 font-normal">
          <span className="shrink-0 text-muted-foreground">{t('acp.permissionMode')}</span>
          <span className="min-w-0 truncate text-foreground">{mode}</span>
        </Badge>
      ) : null}
    </div>
  );
}

export function ACPSessionHeader({ session, rawActive, rawLoading, onToggleRaw }: { session: AcpSessionVm; rawActive: boolean; rawLoading: boolean; onToggleRaw: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="shrink-0 border-b bg-muted/10 px-5 py-3">
      <div className="min-w-0 space-y-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-base font-semibold">{session.adapterDisplayName ?? session.provider}</span>
          <Button size="sm" variant={rawActive ? 'default' : 'outline'} className="ml-auto h-7 gap-1.5 px-2.5 text-xs" onClick={onToggleRaw} disabled={rawLoading}>
            {rawLoading ? <Loader2 className="size-3 animate-spin" /> : null}
            {t('acp.rawFrames')}
          </Button>
        </div>
        <div className="truncate text-xs text-muted-foreground">{session.sessionId ?? t('acp.noSessionId')}</div>
      </div>
    </div>
  );
}

export function ACPMessageList({ events, sessionStatus, sending, onLayoutChange }: { events: AcpUiEventVm[]; sessionStatus: string; sending: boolean; onLayoutChange?: () => void }) {
  const timeline = useMemo(() => buildAcpTimeline(events), [events]);
  const active = isSessionActive(sessionStatus) || sending;

  if (timeline.length === 0) return active ? null : <EmptyAcpState />;

  return (
    <div className="min-w-0 space-y-4">
      {timeline.map((event) => <ACPEventRenderer key={`${event.kind}-${event.id}-${event.seq}`} event={event} onLayoutChange={onLayoutChange} />)}
    </div>
  );
}

function EmptyAcpState() {
  const { t } = useTranslation();
  return <div className="rounded-2xl border border-dashed bg-muted/10 p-8 text-center text-sm text-muted-foreground">{t('acp.noEvents')}</div>;
}

export function ACPEventRenderer({ event, onLayoutChange }: { event: AcpTimelineEvent; onLayoutChange?: () => void }) {
  if (event.kind === 'textDelta' || event.kind === 'userTextDelta') return <MessageBubble event={event} />;
  if (event.kind === 'thoughtDelta') return <AssistantTimelineRow><ThoughtBlock event={event} /></AssistantTimelineRow>;
  if (event.kind === 'toolCall' || event.kind === 'toolCallUpdate') return <AssistantTimelineRow><ToolCallCard event={event} onLayoutChange={onLayoutChange} /></AssistantTimelineRow>;
  if (event.kind === 'plan') return <AssistantTimelineRow><PlanBlock event={event} /></AssistantTimelineRow>;
  return null;
}

function AssistantTimelineRow({ children }: { children: React.ReactNode }) {
  return (
    <Message className="min-w-0 items-start justify-start gap-2">
      <div className="size-7 shrink-0" aria-hidden="true" />
      <div className="w-full min-w-0 max-w-[82%] flex-1">{children}</div>
    </Message>
  );
}

function AcpComposerStatus({ kind, active, startAt, totalSeconds }: { kind: AcpProcessingKind; active: boolean; startAt?: string | null; totalSeconds?: number | null }) {
  const { t } = useTranslation();
  const [stepStartAt, setStepStartAt] = useState<string | null>(startAt ?? null);
  const previousKind = useRef(kind);

  useEffect(() => {
    if (!active) return;
    if (previousKind.current !== kind || !stepStartAt) {
      previousKind.current = kind;
      setStepStartAt(startAt ?? new Date().toISOString());
    }
  }, [active, kind, startAt, stepStartAt]);

  const stepSeconds = useElapsedSeconds(active && kind !== 'sending', stepStartAt ?? startAt);
  const label = processingLabel(t, kind);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 px-3 pb-1 pt-2 text-xs text-muted-foreground">
      {active ? (
        <>
          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
          <span className="font-medium text-foreground">{label}</span>
          {kind === 'sending' ? <AnimatedEllipsis /> : <span className="rounded-full bg-muted/60 px-2 py-0.5 tabular-nums">{t('acp.stepElapsed', { duration: formatElapsedDuration(stepSeconds) })}</span>}
        </>
      ) : null}
      {totalSeconds != null ? <span className="rounded-full bg-muted/60 px-2 py-0.5 tabular-nums">{t('acp.totalElapsed', { duration: formatElapsedDuration(totalSeconds) })}</span> : null}
    </div>
  );
}

function MessageBubble({ event }: { event: AcpTimelineEvent }) {
  const { t } = useTranslation();
  const isUser = event.kind === 'userTextDelta';
  const failed = event.status === 'failed';
  return (
    <Message className={cn('min-w-0 items-start gap-2', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser ? <MessageAvatar tone="assistant" /> : null}
      <div className={cn('min-w-0 max-w-[82%] space-y-1', isUser && 'items-end')}>
        <MessageContent className={cn(
          'whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm [overflow-wrap:anywhere]',
          isUser ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md border bg-card text-card-foreground',
          failed && 'border border-destructive/40 bg-destructive/10 text-destructive',
        )}>
          {event.content}
        </MessageContent>
        {event.optimistic || failed ? (
          <div className={cn('flex px-1 text-xs text-muted-foreground', isUser && 'justify-end text-right')}>
            {failed ? t('acp.sendFailed') : <span className="inline-flex items-center">{event.status === 'processing' ? t('acp.processing') : t('acp.sending')}<AnimatedEllipsis /></span>}
          </div>
        ) : null}
      </div>
      {isUser ? <MessageAvatar tone="user" /> : null}
    </Message>
  );
}

function AnimatedEllipsis() {
  return (
    <span className="inline-flex w-4 items-center justify-start" aria-hidden="true">
      <span className="animate-pulse">.</span>
      <span className="animate-pulse [animation-delay:150ms]">.</span>
      <span className="animate-pulse [animation-delay:300ms]">.</span>
    </span>
  );
}

function MessageAvatar({ tone }: { tone: 'assistant' | 'user' }) {
  const Icon = tone === 'assistant' ? Bot : User;
  return (
    <div className={cn(
      'mt-1 flex size-7 shrink-0 items-center justify-center rounded-full border',
      tone === 'assistant' ? 'bg-card text-muted-foreground' : 'bg-primary/10 text-primary',
    )}>
      <Icon className="size-3.5" />
    </div>
  );
}

export function ThoughtBlock({ event }: { event: AcpTimelineEvent }) {
  const { t } = useTranslation();
  if (!event.content?.trim()) return null;
  const duration = formatThinkingDuration(t, event.durationMs);
  return (
    <ChainOfThought className="min-w-0 max-w-full overflow-hidden rounded-xl border border-border/60 bg-muted/15 px-3.5 py-2 shadow-sm shadow-background/20">
      <ChainOfThoughtStep>
        <ChainOfThoughtTrigger leftIcon={<Clock className="size-4" />} className="w-full min-w-0 justify-between">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-medium">{t('acp.thought')}</span>
            {duration ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{duration}</span> : null}
          </span>
        </ChainOfThoughtTrigger>
        <ChainOfThoughtContent>
          <ChainOfThoughtItem className="break-words whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{event.content}</ChainOfThoughtItem>
        </ChainOfThoughtContent>
      </ChainOfThoughtStep>
    </ChainOfThought>
  );
}

export function ToolCallCard({ event, onLayoutChange }: { event: AcpTimelineEvent; onLayoutChange?: () => void }) {
  const { t } = useTranslation();
  const details = toolDetails(event);
  const ToolIcon = toolIcon(details.name);
  const input = Object.fromEntries(details.queryBlocks.map((block) => [t(block.labelKey), block.value]));
  const toolPart: ToolPart = {
    type: details.name ?? t('acp.toolCall'),
    state: toolState(event.status),
    input,
    output: details.output ?? undefined,
    summary: toolSummary(details.queryBlocks),
    toolCallId: event.toolCallId ?? undefined,
    errorText: event.status && toolStatusTone(event.status) === 'danger' ? event.content ?? undefined : undefined,
  };
  const labels: ToolLabels = {
    input: t('acp.toolParameters'),
    output: t('acp.toolOutput'),
    error: t('status.error'),
    processing: displayStatus(t, 'running'),
    pending: displayStatus(t, 'pending'),
    ready: t('acp.toolReady'),
    completed: displayStatus(t, 'completed'),
  };
  return <Tool toolPart={toolPart} labels={labels} icon={<ToolIcon className="size-4" />} onOpenChange={onLayoutChange} />;
}

export function PlanBlock({ event }: { event: AcpTimelineEvent }) {
  const { t } = useTranslation();
  const entries = ((event.raw as { entries?: Array<{ content?: string; status?: string; priority?: string }> } | undefined)?.entries ?? []);
  return (
    <Card className="min-w-0 max-w-full overflow-hidden border-primary/20 bg-primary/5 shadow-none">
      <CardContent className="space-y-2 p-4">
        {entries.map((entry, index) => (
          <div className="flex min-w-0 items-start gap-2 text-sm" key={`${entry.content ?? index}-${index}`}>
            <Badge variant="secondary">{entry.status ? displayStatus(t, entry.status) : entry.priority ?? index + 1}</Badge>
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{entry.content}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function PermissionRequestCard({ request, onSelect }: { request: AcpPermissionRequestVm; onSelect: (optionId: string) => void }) {
  const { t } = useTranslation();
  return (
    <AssistantTimelineRow>
      <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-primary/20 bg-card/80 px-3 py-2.5 shadow-sm shadow-background/20">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldQuestion className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">{request.title}</div>
              <div className="truncate text-xs text-muted-foreground">{t('acp.permissionPending')}</div>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2 sm:justify-end">
            {request.options.map((option) => (
              <Button
                key={option.optionId}
                size="sm"
                variant={option.kind.startsWith('allow') ? 'default' : 'outline'}
                className="h-8 max-w-full rounded-full px-3"
                onClick={() => onSelect(option.optionId)}
              >
                <span className="truncate">{option.name || option.optionId}</span>
              </Button>
            ))}
          </div>
        </div>
      </div>
    </AssistantTimelineRow>
  );
}

export function RawFrameViewer({ page, query, loading, onQueryChange, onLayoutChange }: { page: AcpRawFramePageVm | null; query: AcpRawFrameQueryInput; loading: boolean; onQueryChange: (query: AcpRawFrameQueryInput) => void; onLayoutChange?: () => void }) {
  const { t } = useTranslation();
  const [searchInput, setSearchInput] = useState(query.search ?? '');

  useEffect(() => {
    setSearchInput(query.search ?? '');
  }, [query.search]);

  const pageSize = page?.pageSize ?? query.pageSize ?? 100;
  const applyQuery = (next: AcpRawFrameQueryInput) => onQueryChange({ ...query, ...next });
  const applySearch = () => applyQuery({ page: 0, search: searchInput.trim() || undefined });
  const clearSearch = () => {
    setSearchInput('');
    onQueryChange({ page: 0, pageSize, direction: undefined, search: undefined, kind: undefined });
  };

  if (loading && !page) {
    return <div className="flex items-center gap-2 rounded-2xl border bg-card/70 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t('acp.loadingRawFrames')}</div>;
  }

  return (
    <div className="w-full min-w-0 max-w-full space-y-3 overflow-hidden">
      <div className="rounded-2xl border border-border/60 bg-card/50 p-3 shadow-sm shadow-background/20">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-2 lg:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                className="h-9 w-full rounded-md border border-input bg-background/70 pl-8 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/10"
                value={searchInput}
                placeholder={t('acp.rawSearchPlaceholder')}
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applySearch();
                }}
              />
            </div>
            <Select value={query.kind ?? 'all'} onValueChange={(value) => applyQuery({ page: 0, kind: value === 'all' ? undefined : value })}>
              <SelectTrigger className="h-9 lg:w-44"><SelectValue placeholder={t('acp.rawKindPlaceholder')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('acp.rawKindAll')}</SelectItem>
                {rawKindOptions(t).map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={query.direction ?? 'all'} onValueChange={(value) => applyQuery({ page: 0, direction: value === 'all' ? undefined : value })}>
              <SelectTrigger className="h-9 lg:w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('acp.rawDirectionAll')}</SelectItem>
                <SelectItem value="inbound">{t('acp.rawInbound')}</SelectItem>
                <SelectItem value="outbound">{t('acp.rawOutbound')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">{rawFramePageSummary(t, page)}</span>
            <div className="flex flex-wrap items-center gap-2">
              {loading ? <Loader2 className="size-3.5 animate-spin text-primary" /> : null}
              <Select value={String(pageSize)} onValueChange={(value) => applyQuery({ page: 0, pageSize: Number(value) })}>
                <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="200">200</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="h-8 rounded-full px-3" disabled={loading} onClick={applySearch}>{t('acp.rawSearch')}</Button>
              <Button size="sm" variant="ghost" className="h-8 rounded-full px-3" disabled={loading} onClick={clearSearch}>{t('acp.rawClear')}</Button>
              <Button size="sm" variant="outline" className="h-8 rounded-full px-3" disabled={loading || !page || page.page === 0} onClick={() => applyQuery({ page: 0 })}>{t('acp.rawLatest')}</Button>
              <Button size="sm" variant="outline" className="h-8 rounded-full px-3" disabled={loading || !page?.hasPrevious} onClick={() => applyQuery({ page: Math.max(0, (page?.page ?? 0) - 1) })}>{t('acp.rawNewer')}</Button>
              <Button size="sm" variant="outline" className="h-8 rounded-full px-3" disabled={loading || !page?.hasNext} onClick={() => applyQuery({ page: (page?.page ?? 0) + 1 })}>{t('acp.rawOlder')}</Button>
            </div>
          </div>
        </div>
      </div>

      {page && page.items.length > 0 ? page.items.map((frame) => <RawFrameRow key={frame.id} frame={frame} onLayoutChange={onLayoutChange} />) : (
        <div className="rounded-2xl border border-dashed bg-muted/10 p-8 text-center text-sm text-muted-foreground">{t('acp.rawNoFrames')}</div>
      )}
    </div>
  );
}

function RawFrameRow({ frame, onLayoutChange }: { frame: AcpRawFrameVm; onLayoutChange?: () => void }) {
  const { t } = useTranslation();
  const display = rawFrameDisplay(frame.content);
  const scrollable = isLongRawFrame(display.expanded);
  return (
    <details onToggle={onLayoutChange} className="group w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-border/60 bg-card/50 font-mono text-[11px] leading-5 shadow-sm shadow-background/20 open:border-primary/20 open:bg-card/70 open:ring-1 open:ring-primary/10">
      <summary className="flex w-full min-w-0 cursor-pointer list-none items-center gap-2 overflow-hidden px-3 py-2 text-muted-foreground outline-none transition-colors marker:hidden hover:bg-muted/20 focus-visible:bg-muted/20">
        <span className="shrink-0 select-none tabular-nums text-muted-foreground/80">#{frame.lineNumber}</span>
        {frame.timestamp ? <span className="hidden shrink-0 tabular-nums text-muted-foreground/70 sm:inline">{frame.timestamp}</span> : null}
        {frame.direction ? <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{displayRawDirection(t, frame.direction)}</span> : null}
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">{displayRawKind(t, frame.kind)}</span>
        <code className="block min-w-0 flex-1 truncate text-foreground/75">{truncateFrameLine(display.compact)}</code>
        {frame.contentTruncated ? <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-300">truncated</span> : null}
      </summary>
      <pre className={cn('block w-full min-w-0 max-w-full overflow-x-hidden whitespace-pre-wrap break-all border-t border-border/50 bg-background/40 px-4 py-3 text-foreground/75 outline-none [overflow-wrap:anywhere]', scrollable ? 'max-h-[38rem] overflow-y-auto [scrollbar-color:hsl(var(--muted-foreground)/0.35)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:hover:bg-muted-foreground/45 [&::-webkit-scrollbar-track]:bg-transparent' : 'overflow-y-visible')}>{display.expanded}</pre>
    </details>
  );
}

function useElapsedSeconds(active: boolean, startAt?: string | null, endAt?: string | null) {
  const fallbackStart = useRef(Date.now());
  const startMs = parseAcpTimestamp(startAt) ?? fallbackStart.current;
  const endMs = parseAcpTimestamp(endAt) ?? Date.now();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, startMs]);

  return Math.max(0, Math.floor(((active ? now : endMs) - startMs) / 1000));
}

function useTurnTotalSeconds(events: AcpUiEventVm[], active: boolean, activeTurnStartedAt?: string | null) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  return useMemo(() => calculateTurnTotalSeconds(events, active, now), [active, activeTurnStartedAt, events, now]);
}

function calculateTurnTotalSeconds(events: AcpUiEventVm[], active: boolean, now: number) {
  const chronological = [...events].sort((left, right) => left.seq - right.seq);
  const userEvents = chronological.filter((event) => isGoldBandUserPrompt(event) && !event.status?.includes('failed'));
  if (userEvents.length === 0) return null;

  let totalMs = 0;
  for (let index = 0; index < userEvents.length; index += 1) {
    const promptStart = parseAcpTimestamp(userEvents[index].timestamp);
    if (promptStart == null) continue;
    const nextUserStart = parseAcpTimestamp(userEvents[index + 1]?.timestamp);
    const responseStart = firstResponseTimestampAfter(chronological, promptStart, nextUserStart);
    if (responseStart == null) continue;
    const end = nextUserStart != null
      ? latestEventTimestampAfter(chronological, responseStart, nextUserStart)
      : active
        ? now
        : latestEventTimestampAfter(chronological, responseStart);
    if (end != null && end > responseStart) totalMs += end - responseStart;
  }

  return Math.max(0, Math.floor(totalMs / 1000));
}

function firstResponseTimestampAfter(events: AcpUiEventVm[], start: number, before?: number | null) {
  for (const event of events) {
    if (!isResponseTimingEvent(event)) continue;
    const timestamp = parseAcpTimestamp(event.timestamp);
    if (timestamp != null && timestamp >= start && (before == null || timestamp < before)) return timestamp;
  }
  return null;
}

function latestEventTimestampAfter(events: AcpUiEventVm[], start: number, before?: number | null) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const timestamp = parseAcpTimestamp(events[index].timestamp);
    if (timestamp != null && timestamp >= start && (before == null || timestamp < before)) return timestamp;
  }
  return null;
}

function isGoldBandUserPrompt(event: AcpUiEventVm) {
  return event.kind === 'userTextDelta' && rawObject(event.raw)?.source === 'goldBandPrompt';
}

function isResponseTimingEvent(event: AcpUiEventVm) {
  return event.kind !== 'userTextDelta';
}

function hasResponseAfterTurn(events: AcpUiEventVm[], turnStartedAt?: string | null) {
  const start = parseAcpTimestamp(turnStartedAt);
  return start != null && firstResponseTimestampAfter(events, start) != null;
}

function isSessionActive(status?: string | null) {
  return ['pending', 'running', 'in_progress', 'sending'].includes(status?.toLowerCase() ?? '');
}

function processingKindFromTimeline(event: AcpTimelineEvent | null, sending: boolean): AcpProcessingKind {
  if (sending) return 'sending';
  if (!event) return 'launching';
  if (event.kind === 'thoughtDelta') return 'thinking';
  if (event.kind === 'toolCall' || event.kind === 'toolCallUpdate') return 'tool';
  if (event.kind === 'textDelta') return 'responding';
  return 'processing';
}

function processingLabel(t: ReturnType<typeof useTranslation>['t'], kind: AcpProcessingKind) {
  if (kind === 'sending') return t('acp.sending');
  if (kind === 'launching') return t('acp.launchingClaude');
  if (kind === 'thinking') return t('acp.thinkingNow');
  if (kind === 'tool') return t('acp.toolRunning');
  if (kind === 'responding') return t('acp.responding');
  return t('acp.processing');
}

function buildAcpTimeline(events: AcpUiEventVm[]) {
  const timeline: AcpTimelineEvent[] = [];
  const toolIndex = new Map<string, AcpTimelineEvent>();
  for (const event of events) {
    if (!isRenderableEvent(event)) continue;
    const previous = timeline[timeline.length - 1];
    if (event.kind === 'userTextDelta' && previous?.kind === 'userTextDelta' && sameText(previous.content, event.content)) {
      previous.status = event.status ?? previous.status;
      previous.raw = mergeRaw(previous.raw, event.raw);
      previous.optimistic = previous.optimistic || isOptimisticEvent(event);
      continue;
    }
    if (previous && previous.kind === event.kind && isMergeableDelta(event.kind)) {
      previous.content = `${previous.content ?? ''}${event.content ?? ''}`;
      previous.seq = event.seq;
      previous.endedAt = event.timestamp;
      previous.raw = event.raw;
      continue;
    }
    if ((event.kind === 'toolCall' || event.kind === 'toolCallUpdate') && event.toolCallId) {
      const existing = toolIndex.get(event.toolCallId);
      if (existing) {
        existing.kind = 'toolCall';
        existing.seq = event.seq;
        existing.endedAt = event.timestamp;
        existing.title = event.title ?? existing.title;
        existing.status = event.status ?? existing.status;
        existing.content = event.content ?? existing.content;
        existing.raw = mergeRaw(existing.raw, event.raw);
        continue;
      }
      const copy = { ...event, kind: 'toolCall', startedAt: event.timestamp, endedAt: event.timestamp };
      toolIndex.set(event.toolCallId, copy);
      timeline.push(copy);
      continue;
    }
    if (event.kind === 'thoughtDelta' && !event.content?.trim()) continue;
    timeline.push({ ...event, startedAt: event.timestamp, endedAt: event.timestamp, optimistic: isOptimisticEvent(event) });
  }
  return timeline.map((event, index) => {
    if (event.kind !== 'thoughtDelta') return event;
    const start = parseAcpTimestamp(event.startedAt ?? event.timestamp);
    const next = timeline.slice(index + 1).find((item) => parseAcpTimestamp(item.timestamp) != null);
    const end = parseAcpTimestamp(next?.timestamp) ?? parseAcpTimestamp(event.endedAt) ?? start;
    return start != null && end != null && end >= start ? { ...event, durationMs: Math.max(0, end - start) } : event;
  });
}

function isRenderableEvent(event: AcpUiEventVm) {
  if (hiddenEventKinds.has(event.kind)) return false;
  const sessionUpdate = rawObject(event.raw)?.sessionUpdate;
  return typeof sessionUpdate !== 'string' || !hiddenSessionUpdates.has(sessionUpdate);
}

function isMergeableDelta(kind: string) {
  return kind === 'textDelta' || kind === 'userTextDelta' || kind === 'thoughtDelta';
}

function rawObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function arrayValue(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function mergeRaw(previous: unknown, next: unknown) {
  const previousObject = rawObject(previous);
  const nextObject = rawObject(next);
  if (!previousObject || !nextObject) return next ?? previous;
  return { ...previousObject, ...nextObject };
}

function mergeOptimisticSession(session: AcpSessionVm | null | undefined, optimisticEvents: AcpUiEventVm[]) {
  if (!session || optimisticEvents.length === 0) return session ?? null;
  const pending = optimisticEvents.filter((event) => !hasMatchingUserPrompt(session.events, event));
  if (pending.length === 0) return session;
  return { ...session, events: [...session.events, ...pending] };
}

function optimisticUserEvent(content: string): AcpUiEventVm {
  const createdAt = Math.floor(Date.now() / 1000);
  return {
    id: `optimistic-user-${createdAt}-${Math.random().toString(36).slice(2)}`,
    seq: Number.MAX_SAFE_INTEGER - createdAt,
    timestamp: `${createdAt}Z`,
    kind: 'userTextDelta',
    content,
    status: 'sending',
    raw: { source: 'goldBandPrompt', optimistic: true },
  };
}

function isOptimisticEvent(event: AcpUiEventVm) {
  return rawObject(event.raw)?.optimistic === true;
}

function hasMatchingUserPrompt(events: AcpUiEventVm[], candidate: AcpUiEventVm) {
  if (candidate.kind !== 'userTextDelta') return false;
  return events.some((event) => event.kind === 'userTextDelta' && sameText(event.content, candidate.content));
}

function sameText(left?: string | null, right?: string | null) {
  return Boolean(left?.trim()) && left?.trim() === right?.trim();
}

function toolDetails(event: AcpUiEventVm) {
  const raw = rawObject(event.raw);
  const toolCall = rawObject(raw?.toolCall) ?? rawObject(raw?.content) ?? raw;
  const fields = rawObject(toolCall?.fields);
  const rawInput = rawObject(toolCall?.rawInput) ?? rawObject(raw?.rawInput);
  const locations = arrayValue(toolCall?.locations) ?? arrayValue(raw?.locations);
  const meta = rawObject(raw?._meta);
  const claudeCode = rawObject(meta?.claudeCode);
  const title = stringValue(toolCall?.title) ?? event.title;
  const claudeToolName = stringValue(claudeCode?.toolName);
  const name = claudeToolName ?? parseToolTitle(title).name ?? stringValue(toolCall?.name) ?? title;
  const output = cleanToolOutput(toolCall?.output ?? raw?.output ?? fields?.output ?? raw?.content);
  return {
    name,
    output,
    queryBlocks: queryBlocksFromTool(title, rawInput, locations),
  };
}

function queryBlocksFromTool(title: string | null | undefined, rawInput?: Record<string, unknown> | null, locations?: unknown[] | null) {
  const parsedTitle = parseToolTitle(title);
  const blocks: Array<{ labelKey: string; value: string }> = [];
  const push = (labelKey: string, value?: string | null) => {
    const normalized = value?.trim();
    if (!normalized || blocks.some((block) => block.value === normalized)) return;
    blocks.push({ labelKey, value: normalized });
  };

  push('acp.toolPath', parsedTitle.scope);
  push('acp.toolQuery', parsedTitle.query);
  push('acp.toolPath', stringValue(rawInput?.file_path));
  push('acp.toolPath', stringValue(rawInput?.path));
  push('acp.toolPath', stringValue(rawInput?.cwd));
  push('acp.toolQuery', stringValue(rawInput?.pattern));
  push('acp.toolQuery', stringValue(rawInput?.query));
  push('acp.toolQuery', stringValue(rawInput?.glob));
  push('acp.toolQuery', stringValue(rawInput?.command));
  push('acp.toolPath', firstLocationPath(locations));
  return blocks;
}

function toolSummary(blocks: Array<{ value: string }>) {
  const values = blocks.map((block) => block.value.trim()).filter(Boolean);
  return values.length > 0 ? values.join(' · ') : undefined;
}

function firstLocationPath(locations?: unknown[] | null) {
  if (!locations) return null;
  for (const location of locations) {
    const path = stringValue(rawObject(location)?.path);
    if (path) return path;
  }
  return null;
}

function parseToolTitle(title: string | null | undefined) {
  if (!title) return { name: null, scope: null, query: null };
  const [name] = title.split(' ');
  const quoted = [...title.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  const rest = title.slice(name.length).trim();
  const plainScope = rest && rest.toLowerCase() !== 'file' ? rest : null;
  return {
    name: name || title,
    scope: quoted[0] ?? plainScope,
    query: quoted[1] ?? null,
  };
}

function toolIcon(name: string | null | undefined) {
  const normalized = name?.toLowerCase();
  if (normalized === 'read') return FileText;
  if (normalized === 'glob' || normalized === 'grep') return Search;
  if (normalized === 'bash' || normalized === 'powershell') return Terminal;
  return Terminal;
}

function cleanToolOutput(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 1) {
    const item = rawObject(value[0]);
    const content = rawObject(item?.content);
    const text = stringValue(content?.text);
    if (text) return text;
  }
  return value;
}

function displayRawDirection(t: ReturnType<typeof useTranslation>['t'], direction?: string | null) {
  if (direction === 'inbound') return t('acp.rawInboundFrame');
  if (direction === 'outbound') return t('acp.rawOutboundFrame');
  return direction ?? t('common.unknown');
}

function rawKindOptions(t: ReturnType<typeof useTranslation>['t']) {
  return [
    { value: 'agent_message_chunk', label: t('acp.rawKindAgentMessage') },
    { value: 'agent_thought_chunk', label: t('acp.rawKindThought') },
    { value: 'tool_call', label: t('acp.rawKindToolCall') },
    { value: 'tool_call_update', label: t('acp.rawKindToolUpdate') },
    { value: 'usage_update', label: t('acp.rawKindUsage') },
    { value: 'available_commands_update', label: t('acp.rawKindCommands') },
    { value: 'session/prompt', label: t('acp.rawKindSessionPrompt') },
    { value: 'session/new', label: t('acp.rawKindSessionNew') },
    { value: 'session/load', label: t('acp.rawKindSessionLoad') },
    { value: 'result', label: t('acp.rawKindResult') },
    { value: 'error', label: t('acp.rawKindError') },
    { value: 'parse-error', label: t('acp.rawKindParseError') },
  ];
}

function displayRawKind(t: ReturnType<typeof useTranslation>['t'], kind: string) {
  const labels: Record<string, string> = {
    initialize: t('acp.rawKindInitialize'),
    'session/new': t('acp.rawKindSessionNew'),
    'session/load': t('acp.rawKindSessionLoad'),
    'session/prompt': t('acp.rawKindSessionPrompt'),
    agent_message_chunk: t('acp.rawKindAgentMessage'),
    agent_thought_chunk: t('acp.rawKindThought'),
    user_message_chunk: t('acp.rawKindUserMessage'),
    tool_call: t('acp.rawKindToolCall'),
    tool_call_update: t('acp.rawKindToolUpdate'),
    usage_update: t('acp.rawKindUsage'),
    available_commands_update: t('acp.rawKindCommands'),
    result: t('acp.rawKindResult'),
    error: t('acp.rawKindError'),
    'parse-error': t('acp.rawKindParseError'),
  };
  return labels[kind] ?? kind;
}

function rawFrameDisplay(content: string) {
  try {
    const value = JSON.parse(content);
    return {
      compact: JSON.stringify(value),
      expanded: wrapLongSegments(JSON.stringify(value, null, 2)),
    };
  } catch {
    return {
      compact: content,
      expanded: wrapLongSegments(content),
    };
  }
}

function rawFramePageSummary(t: ReturnType<typeof useTranslation>['t'], page: AcpRawFramePageVm | null) {
  if (!page || page.total === 0) return t('acp.rawMatchCount', { total: 0 });
  const firstLine = page.items[0]?.lineNumber ?? 0;
  const lastLine = page.items.at(-1)?.lineNumber ?? firstLine;
  return t('acp.rawPageSummary', { start: firstLine, end: lastLine, total: page.total, page: page.page + 1 });
}

function truncateFrameLine(line: string) {
  return line.length > 300 ? `${line.slice(0, 300)}…` : line;
}

function isLongRawFrame(content: string) {
  return content.split('\n').length > 36 || content.length > 5000;
}

function wrapLongSegments(text: string) {
  return text.replace(/\S{120,}/g, (segment) => segment.match(/.{1,120}/g)?.join('\n') ?? segment);
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function toolState(status?: string | null): ToolPart['state'] {
  const tone = toolStatusTone(status);
  if (tone === 'running') return 'input-streaming';
  if (tone === 'danger') return 'output-error';
  if (tone === 'success') return 'output-available';
  return 'input-available';
}

function toolStatusTone(status?: string | null): ToolTone {
  if (!status) return 'muted';
  if (['pending', 'sending'].includes(status)) return 'pending';
  if (['running', 'in_progress'].includes(status)) return 'running';
  if (['completed', 'success', 'succeeded'].includes(status)) return 'success';
  if (['failed', 'error', 'cancelled'].includes(status)) return 'danger';
  return 'muted';
}

function parseAcpTimestamp(value?: string | null) {
  if (!value) return null;
  const numeric = value.match(/^(\d+(?:\.\d+)?)Z?$/);
  if (numeric) return Number(numeric[1]) * 1000;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatThinkingDuration(t: ReturnType<typeof useTranslation>['t'], durationMs?: number) {
  if (durationMs == null) return null;
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  return t('acp.thinkingDuration', { seconds });
}

function formatElapsedDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return restSeconds ? `${minutes} 分 ${restSeconds} 秒` : `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes ? `${hours} 时 ${restMinutes} 分` : `${hours} 时`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} 天 ${restHours} 时` : `${days} 天`;
}

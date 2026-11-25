import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '@emotion/css';
import { PanelProps, renderMarkdown } from '@grafana/data';
import { Icon, IconName, useStyles2, useTheme2 } from '@grafana/ui';
import { DarkVeil } from './DarkVeil';
import { getChatStyles } from './chatStyles';
import { ChatMessage, QueryContext, streamChat, ToolActivity } from '../services/chat';
import { DEFAULT_CHAT_ENDPOINT, SimpleOptions } from '../types';
import { copyMetricTable, MetricSummaryTable } from './MetricSummaryTable';

interface DisplayMessage extends ChatMessage {
  failed?: boolean;
  pending?: boolean;
  activity?: ToolActivity[];
}

const activityStatus = { running: 'Running', completed: 'Completed', failed: 'Failed' };
const legacyChatEndpoints = new Set(['http://localhost:8787/chat', '/chat', '/llmchat/chat']);
const tableDivider = /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/;

function splitGeneratedTables(content: string) {
  const tables: string[] = [];
  const lines = content
    .replace(/<table\b[\s\S]*?<\/table\s*>/gi, (table) => {
      tables.push(table);
      return '';
    })
    .split(/\r?\n/);
  const prose: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('|') && lines[i + 1]?.includes('|') && tableDivider.test(lines[i + 1])) {
      const start = i;
      i++;
      while (lines[i + 1]?.includes('|')) {
        i++;
      }
      tables.push(lines.slice(start, i + 1).join('\n'));
    } else {
      prose.push(lines[i]);
    }
  }
  return { prose: prose.join('\n').trim(), tables };
}

const OrbitingNode: React.FC<{
  color: string;
  secondaryColor: string;
}> = ({ color, secondaryColor }) => (
  <div
    aria-hidden="true"
    style={{
      position: 'relative',
      width: '22px',
      height: '22px',
      flexShrink: 0,
    }}
  >
    <style>
      {`
        @keyframes manufacturingAiOrbit {
          from {transform: rotate(0deg);}
          to {transform: rotate(360deg);}
        }

        @keyframes manufacturingAiOrbitReverse {
          from {transform: rotate(360deg);}
          to {transform: rotate(0deg);}
        }

        @keyframes manufacturingAiPulse {
          0%,
          100% {
            transform: translate(-50%, -50%) scale(0.85);
            opacity: 0.7;
          }

          50% {
            transform: translate(-50%, -50%) scale(1.15);
            opacity: 1;
          }
        }
      `}
    </style>

    {/* Soft orbital ring */}
    <div
      style={{
        position: 'absolute',
        inset: '2px',
        borderRadius: '50%',
        border: `1px solid ${secondaryColor}`,
        opacity: 0.35,
      }}
    />

    {/* Pulsing center node */}
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 8px ${color}`,
        animation: 'manufacturingAiPulse 1.2s ease-in-out infinite',
      }}
    />

    {/* Outer orbit */}
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: '50%',
        animation: 'manufacturingAiOrbit 1.25s linear infinite',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          width: '4px',
          height: '4px',
          borderRadius: '50%',
          background: color,
          transform: 'translateX(-50%)',
          boxShadow: `0 0 5px ${color}`,
        }}
      />
    </div>

    {/* Inner reverse orbit */}
    <div
      style={{
        position: 'absolute',
        inset: '4px',
        borderRadius: '50%',
        animation: 'manufacturingAiOrbitReverse 0.85s linear infinite',
      }}
    >
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: '50%',
          width: '3px',
          height: '3px',
          borderRadius: '50%',
          background: secondaryColor,
          transform: 'translateX(-50%)',
        }}
      />
    </div>
  </div>
);

// Quick-start prompts shown on the empty state
const QUICK_PROMPTS: Array<{ text: string; icon: IconName }> = [
  { text: 'How is OEE across the fleet?', icon: 'dashboard' },
  { text: 'Which equipment has the lowest OEE?', icon: 'sort-amount-down' },
  { text: 'How is first-pass yield across the fleet?', icon: 'check-circle' },
  { text: 'How is utilization across the fleet?', icon: 'chart-line' },
  { text: 'How many work orders did each machine record?', icon: 'clipboard-alt' },
  { text: 'Which equipment has the lowest utilization rate?', icon: 'chart-line' },
];

// Silver orb used as the assistant avatar / brand mark
const Orb: React.FC<{ size: number; busy?: boolean }> = ({ size, busy }) => {
  const styles = useStyles2(getChatStyles);
  return (
    <div aria-hidden="true" className={cx(styles.orb, busy && styles.orbBusy)} style={{ width: size, height: size }} />
  );
};

// Assistant text rendered as sanitized markdown (Grafana's renderMarkdown sanitizes output)
const MarkdownBody: React.FC<{ content: string; className: string }> = ({ content, className }) => {
  const html = useMemo(() => renderMarkdown(content, { breaks: true }), [content]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
};

export const SimplePanel: React.FC<PanelProps<SimpleOptions>> = ({ width, height, timeRange, options }) => {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const activeRequest = useRef<AbortController | null>(null);
  const queryContext = useRef<QueryContext>();
  const [loading, setLoading] = useState(false);
  const theme = useTheme2();
  const styles = useStyles2(getChatStyles);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    });
  }, [messages, loading]);

  useEffect(() => () => activeRequest.current?.abort(), []);

  // Auto-grow the composer textarea with its content
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) {
      return;
    }
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [message]);

  const clearChat = () => {
    if (loading) {
      return;
    }
    setMessages([]);
    setMessage('');
    setCopiedKey(null);
    queryContext.current = undefined;
  };

  const copyMessage = async (content: string, key: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1600);
    } catch (error) {
      console.warn('Unable to copy message:', error);
    }
  };

  const isEmpty = messages.length === 0;

  const sendMessage = async (directMessage?: string) => {
    const text = (directMessage ?? message).trim();
    if (!text || activeRequest.current) {
      return;
    }

    const controller = new AbortController();
    activeRequest.current = controller;
    setMessages((previous) => [
      ...previous,
      { role: 'user', content: text },
      { role: 'assistant', content: '', pending: true },
    ]);
    setMessage('');
    setLoading(true);

    const updateAnswer = (update: (answer: DisplayMessage) => DisplayMessage) => {
      setMessages((previous) => {
        const answer = previous.at(-1);
        return answer?.pending ? [...previous.slice(0, -1), update(answer)] : previous;
      });
    };
    try {
      const chatEndpoint = options.chatEndpoint?.trim();
      await streamChat(
        chatEndpoint && !legacyChatEndpoints.has(chatEndpoint) ? chatEndpoint : DEFAULT_CHAT_ENDPOINT,
        {
          message: text,
          history: messages
            .filter((item) => !item.failed)
            .slice(-12)
            .map(({ role, content, activity }) => ({
              role,
              content: (activity?.some((step) => step.report?.table)
                ? splitGeneratedTables(content).prose
                : content
              ).slice(0, 4000),
            }))
            .filter(({ content }) => content.trim()),
          range: { from: timeRange.from.toISOString(), to: timeRange.to.toISOString() },
          context: queryContext.current,
        },
        controller.signal,
        (delta) => updateAnswer((answer) => ({ ...answer, content: answer.content + delta })),
        (activity) => {
          if (activity.status === 'completed' && activity.report?.context) {
            queryContext.current = activity.report.context;
          }
          updateAnswer((answer) => {
            const steps = answer.activity ?? [];
            return {
              ...answer,
              activity: steps.some((step) => step.id === activity.id)
                ? steps.map((step) => (step.id === activity.id ? activity : step))
                : [...steps, activity],
            };
          });
        }
      );
      updateAnswer((answer) => ({ ...answer, pending: false }));
    } catch (error) {
      if (!controller.signal.aborted) {
        const content = error instanceof Error ? error.message : 'The chat request failed.';
        updateAnswer((answer) => ({ ...answer, content, pending: false, failed: true }));
      }
    } finally {
      activeRequest.current = null;
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  // Return focus to the composer once an answer arrives
  useEffect(() => {
    if (!loading && messages.length > 0) {
      textareaRef.current?.focus();
    }
  }, [loading, messages.length]);

  // UI
  return (
    <div className={styles.root} style={{ width, height }}>
      {/* Dark Veil background: full strength on the welcome screen, dimmed and paused during a chat */}
      <div className={styles.veil} style={{ opacity: isEmpty ? 1 : 0.22 }}>
        <DarkVeil
          color="#b4b4c4"
          glow={0.2}
          speed={0.5}
          flow={1}
          grain={0.03}
          quality={0.5}
          lightMode={!theme.isDark}
          paused={!isEmpty}
          mouseInteraction={isEmpty}
        />
      </div>
      <div className={styles.scrim} style={{ opacity: isEmpty ? 0.55 : 1 }} />

      <div className={styles.shell}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.brand}>
            <Orb size={26} busy={loading} />
            <div style={{ minWidth: 0 }}>
              <div className={styles.title}>Manufacturing Assistant</div>
              <div className={styles.status}>
                <span className={cx(styles.statusDot, loading && styles.statusDotBusy)} />
                {loading ? 'Responding…' : 'Dashboard chat'}
              </div>
            </div>
          </div>

          <button
            type="button"
            className={styles.ghostButton}
            onClick={clearChat}
            disabled={loading || isEmpty}
            title="Start a new conversation"
          >
            <Icon name="plus" size="sm" />
            New chat
          </button>
        </div>

        {/* Conversation */}
        <div className={styles.scroller}>
          {isEmpty ? (
            <div className={styles.hero}>
              <span className={styles.eyebrow}>
                <Icon name="ai-sparkle" size="xs" />
                Manufacturing intelligence
              </span>

              <h2 className={styles.heroTitle}>Ask about your equipment</h2>

              <p className={styles.heroSub}>
                Answers come from the live OEE, FPY, utilization and work order data on this dashboard. Pick a
                suggestion or ask your own question.
              </p>

              <div className={styles.promptGrid}>
                {QUICK_PROMPTS.map((prompt, index) => (
                  <button
                    key={prompt.text}
                    type="button"
                    className={styles.promptCard}
                    style={{ animationDelay: `${180 + index * 55}ms` }}
                    onClick={() => sendMessage(prompt.text)}
                    disabled={loading}
                  >
                    <span className={styles.promptIcon}>
                      <Icon name={prompt.icon} size="sm" />
                    </span>
                    <span>{prompt.text}</span>
                    <Icon name="arrow-right" size="sm" className="prompt-arrow" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((item, index) => {
              if (item.role === 'user') {
                return (
                  <div key={index} className={cx(styles.row, styles.rowUser)}>
                    <div className={styles.userBubble}>{item.content}</div>
                  </div>
                );
              }

              const isError = item.failed;
              const tables =
                item.activity?.flatMap((step) =>
                  step.report?.table ? [{ id: step.id, table: step.report.table }] : []
                ) ?? [];
              const generated = isError ? undefined : splitGeneratedTables(item.content);
              const visibleContent = tables.length && generated ? generated.prose : item.content;
              const replyKey = `reply-${index}`;
              const generatedTableKey = `generated-table-${index}`;

              return (
                <div key={index} className={styles.row}>
                  <Orb size={22} busy={item.pending} />
                  <div className={styles.assistantColumn}>
                    <div className={styles.author}>Assistant</div>

                    {!!item.activity?.length && (
                      <details className={styles.toolActivity}>
                        <summary>Tool activity ({item.activity.length})</summary>
                        <ol>
                          {item.activity.map((step) => (
                            <li key={step.id}>
                              <div className={styles.toolActivityHeading}>
                                <span>{step.label}</span>
                                <span>
                                  {step.status === 'running' && !item.pending
                                    ? 'Interrupted'
                                    : activityStatus[step.status]}
                                </span>
                              </div>
                              {step.report?.evidence.map((line, lineIndex) => (
                                <div key={lineIndex} className={styles.toolEvidence}>
                                  {line}
                                </div>
                              ))}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}

                    {item.pending && !visibleContent ? (
                      <div className={cx(styles.assistantCard, styles.thinking)}>
                        <OrbitingNode
                          color={theme.isDark ? '#e4e4ee' : '#2a2a36'}
                          secondaryColor={theme.colors.text.secondary}
                        />
                        <span className={styles.shimmerText}>Analyzing dashboard data…</span>
                      </div>
                    ) : isError ? (
                      <div className={cx(styles.assistantCard, styles.errorCard)}>
                        <Icon name="exclamation-triangle" size="sm" style={{ marginTop: 3, flexShrink: 0 }} />
                        <span>{item.content}</span>
                      </div>
                    ) : visibleContent ? (
                      <div className={styles.assistantCard}>
                        <MarkdownBody content={visibleContent} className={styles.markdown} />
                      </div>
                    ) : null}

                    {!item.pending &&
                      !isError &&
                      tables.map(({ id, table }) => {
                        const key = `table-${index}-${id}`;
                        return (
                          <MetricSummaryTable
                            key={id}
                            table={table}
                            copied={copiedKey === key}
                            onCopy={() => copyMessage(copyMetricTable(table, false), key)}
                          />
                        );
                      })}

                    {!item.pending && (
                      <div className={cx(styles.actions, 'msg-actions')}>
                        <button
                          type="button"
                          className={styles.actionButton}
                          onClick={() =>
                            copyMessage(
                              (isError
                                ? [visibleContent]
                                : [visibleContent, ...tables.map(({ table }) => copyMetricTable(table))]
                              )
                                .filter(Boolean)
                                .join('\n\n'),
                              replyKey
                            )
                          }
                        >
                          <Icon name={copiedKey === replyKey ? 'check' : 'copy'} size="xs" />
                          {copiedKey === replyKey ? 'Copied' : 'Copy'}
                        </button>
                        {!tables.length && !!generated?.tables.length && (
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() => copyMessage(generated.tables.join('\n\n'), generatedTableKey)}
                          >
                            <Icon name={copiedKey === generatedTableKey ? 'check' : 'copy'} size="xs" />
                            {copiedKey === generatedTableKey ? 'Table copied' : 'Copy table'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Composer */}
        <div className={styles.composer}>
          <div className={styles.inputShell}>
            <textarea
              ref={textareaRef}
              rows={1}
              className={styles.textarea}
              value={message}
              placeholder="Ask about OEE, FPY, utilization or work orders…"
              disabled={loading}
              maxLength={4000}
              aria-label="Message"
              onChange={(event) => setMessage(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
            />

            <button
              type="button"
              className={styles.sendButton}
              onClick={() => sendMessage()}
              disabled={loading || !message.trim()}
              aria-label="Send message"
              title="Send"
            >
              <Icon name="arrow-up" size="md" />
            </button>
          </div>

          {height >= 260 && (
            <div className={styles.hint}>
              <kbd>Enter</kbd> to send · <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

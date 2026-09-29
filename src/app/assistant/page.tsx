'use client';

import { FileText, Loader2, MessageCircleQuestion, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AiAnswerBox } from '@/components/ai/AiAnswerBox';
import { usePolling } from '@/components/providers/usePolling';
import { Card, PageHeader, Pill } from '@/components/ui/primitives';
import type { AiAnswer } from '@/lib/ai/assistant';

interface AiStatus {
  configured: boolean;
  model: string;
  lastError: string | null;
}

interface QaItem {
  question: string;
  answer: AiAnswer;
}

const SUGGESTIONS = [
  'Which station is most at risk right now and why?',
  'What happened during the last crisis event?',
  'Why did the last shipment fail?',
  'Which depot should we worry about in the next hours?',
];

async function askAssistant(body: object): Promise<AiAnswer> {
  const response = await fetch('/api/assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message ?? 'Assistant request failed');
  return data as AiAnswer;
}

export default function AssistantPage() {
  const status = usePolling<AiStatus>('/api/assistant', 10000);
  const [report, setReport] = useState<AiAnswer | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [question, setQuestion] = useState('');
  const [askBusy, setAskBusy] = useState(false);
  const [history, setHistory] = useState<QaItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const generateReport = async () => {
    setReportBusy(true);
    setError(null);
    try {
      setReport(await askAssistant({ kind: 'summary' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReportBusy(false);
    }
  };

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 3) return;
    setAskBusy(true);
    setError(null);
    try {
      const answer = await askAssistant({ kind: 'ask', question: trimmed });
      setHistory((previous) => [{ question: trimmed, answer }, ...previous].slice(0, 10));
      setQuestion('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAskBusy(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void ask(question);
  };

  return (
    <>
      <PageHeader
        title="AI Assistant"
        description="Plain-language situation reports, incident explanations and answers about the network. It only uses live facts from the platform and never executes actions."
        action={
          status && (
            <Pill tone={!status.configured ? 'neutral' : status.lastError ? 'warn' : 'good'}>
              {!status.configured
                ? 'Built-in mode (no OpenAI key)'
                : status.lastError
                  ? 'OpenAI unavailable · fallback'
                  : `OpenAI ${status.model}`}
            </Pill>
          )
        }
      />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-3 text-[15px] text-red-900">
          {error}
        </div>
      )}

      <Card
        title="Situation report"
        subtitle="Network state and incidents, written for the operator on shift"
        action={
          <button
            type="button"
            onClick={generateReport}
            disabled={reportBusy}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-[15px] font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {reportBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <FileText className="size-4" aria-hidden />
            )}
            {report ? 'Refresh report' : 'Generate report'}
          </button>
        }
      >
        {report ? (
          <AiAnswerBox answer={report} />
        ) : (
          <p className="text-[15px] text-ink-muted">
            Generate a report to get a short summary of the network, any incidents and what the
            platform is doing about them.
          </p>
        )}
      </Card>

      <Card
        title="Ask about the network"
        subtitle="Investigate risks, events, shipments and failures"
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={500}
            placeholder="e.g. Why is Tongi diesel at risk?"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-4 py-2.5 text-[15px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft"
          />
          <button
            type="submit"
            disabled={askBusy || question.trim().length < 3}
            className="flex items-center justify-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {askBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )}
            Ask
          </button>
        </form>

        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={askBusy}
              onClick={() => void ask(suggestion)}
              className="rounded-full border border-line bg-slate-50 px-3 py-1.5 text-sm text-ink-soft hover:border-brand hover:text-brand disabled:opacity-50"
            >
              {suggestion}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-5">
          {history.map((item, index) => (
            <div key={`${item.question}-${index}`} className="space-y-2">
              <div className="flex items-start gap-2 text-[15px] font-medium text-ink">
                <MessageCircleQuestion className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
                {item.question}
              </div>
              <AiAnswerBox answer={item.answer} />
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

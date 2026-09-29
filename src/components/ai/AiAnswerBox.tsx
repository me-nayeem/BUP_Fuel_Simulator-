import { Sparkles } from 'lucide-react';
import { Pill } from '@/components/ui/primitives';
import type { AiAnswer } from '@/lib/ai/assistant';

export function AiAnswerBox({ answer }: { answer: AiAnswer }) {
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-violet-700" aria-hidden />
        {answer.source === 'openai' ? (
          <Pill tone="info">
            OpenAI {answer.model} · {(answer.latencyMs / 1000).toFixed(1)} s
          </Pill>
        ) : (
          <Pill tone="warn">Built-in explanation</Pill>
        )}
      </div>
      <p className="text-[15px] leading-relaxed whitespace-pre-line text-ink">{answer.text}</p>
      {answer.note && <p className="mt-2 text-sm text-ink-muted">{answer.note}</p>}
    </div>
  );
}

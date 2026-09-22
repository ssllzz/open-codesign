import type {
  ChatAssistantTextPayload,
  ChatMessageRow,
  ChatUserPayload,
} from '@open-codesign/shared';

const USER_EXCERPT_BUDGET = 500;
const ASSISTANT_EXCERPT_BUDGET = 300;
const MAX_USER_TURNS = 10;
const MAX_ASSISTANT_TURNS = 6;
const TOTAL_BUDGET = 6000;

function excerpt(text: string, budget: number): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > budget ? `${trimmed.slice(0, budget)}…` : trimmed;
}

/** Build the prompt sent to the existing generate-title flow: the current
 *  name plus recent conversation excerpts (rows arrive oldest-first) so the
 *  model can re-name a session the user already steered. Returns '' when
 *  there is nothing to summarize. */
export function buildRenamePrompt(input: {
  currentName: string;
  rows: ChatMessageRow[];
  thumbnailText: string | null;
}): string {
  const userTurns: string[] = [];
  const assistantTurns: string[] = [];
  for (const row of input.rows) {
    if (row.kind === 'user') {
      const raw = (row.payload as ChatUserPayload | null)?.text;
      if (typeof raw === 'string') {
        const text = excerpt(raw, USER_EXCERPT_BUDGET);
        if (text.length > 0) userTurns.push(text);
      }
    } else if (row.kind === 'assistant_text') {
      const raw = (row.payload as ChatAssistantTextPayload | null)?.text;
      if (typeof raw === 'string') {
        const text = excerpt(raw, ASSISTANT_EXCERPT_BUDGET);
        if (text.length > 0) assistantTurns.push(text);
      }
    }
  }
  // Keep the most recent turns. Roles are sliced independently, so the
  // output approximates rather than preserves the original interleave —
  // excerpt content matters more for a naming prompt.
  const recentUsers = userTurns.slice(-MAX_USER_TURNS);
  const recentAssistants = assistantTurns.slice(-MAX_ASSISTANT_TURNS);
  const conversation: string[] = [];
  for (let i = 0; i < Math.max(recentUsers.length, recentAssistants.length); i++) {
    const user = recentUsers[i];
    if (user !== undefined) conversation.push(`User: ${user}`);
    const assistant = recentAssistants[i];
    if (assistant !== undefined) conversation.push(`Assistant: ${assistant}`);
  }

  const lines: string[] = [`Current name: ${input.currentName}`];
  if (conversation.length > 0) {
    lines.push('Recent conversation:', ...conversation);
  } else if (input.thumbnailText !== null && input.thumbnailText.trim().length > 0) {
    lines.push(`Design content preview: ${excerpt(input.thumbnailText, 1200)}`);
  } else {
    return '';
  }

  const prompt = lines.join('\n');
  return prompt.length > TOTAL_BUDGET ? `${prompt.slice(0, TOTAL_BUDGET)}…` : prompt;
}

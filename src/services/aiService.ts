import Groq from 'groq-sdk';
import { env } from '../config/env';
import logger from '../config/logger';

export interface DraftTask {
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high';
  assignee?: string;
  dueDate?: string;
}

const SYSTEM_PROMPT = `You are a task extraction assistant. Extract all action items, tasks, and to-dos from the provided text (meeting notes, markdown, or plain text).

Return a JSON object with a "tasks" array. Each task must have:
- title (string, required): concise, actionable task title
- description (string, optional): extra context or details if available
- priority (string, required): "high" for urgent/critical, "medium" for normal work, "low" for nice-to-have
- assignee (string, optional): person's name exactly as mentioned
- dueDate (string, optional): ISO 8601 date string YYYY-MM-DD if a deadline is clearly stated

Rules:
- Only extract concrete, actionable items — skip discussion points and informational sentences
- If no deadline year is mentioned, assume the current year
- Do not invent information not present in the text
- Return valid JSON only, no markdown fences`;

export async function extractTasksFromMarkdown(markdown: string): Promise<DraftTask[]> {
  if (!env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not configured. Please add it to your .env file.');
  }

  const client = new Groq({ apiKey: env.GROQ_API_KEY });

  try {
    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: markdown },
      ],
      temperature: 0.1,
    });

    const text = completion.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(text) as { tasks?: DraftTask[] };
    return parsed.tasks ?? [];
  } catch (err) {
    logger.error({ err }, 'Groq extractTasksFromMarkdown failed');
    throw err;
  }
}

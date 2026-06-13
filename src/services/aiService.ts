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

export interface WeeklyDigestData {
  projectName: string;
  completedCount: number;
  overdueCount: number;
  newTasksCount: number;
  topAssignees: string[];
}

const WEEKLY_SUMMARY_PROMPT = `You are a project management assistant. Write a concise 2-3 sentence executive summary of a project's weekly progress.
Be direct and professional. Highlight wins, flag risks. Use plain language a non-technical manager can understand.
Return only the summary text — no headers, no bullet points, no markdown fences.`;

export async function generateWeeklySummary(data: WeeklyDigestData): Promise<string | null> {
  if (!env.GROQ_API_KEY) return null;

  const client = new Groq({ apiKey: env.GROQ_API_KEY });

  const userMessage = `Project: ${data.projectName}
This week: ${data.completedCount} task(s) completed, ${data.newTasksCount} new task(s) created, ${data.overdueCount} task(s) overdue.
${data.topAssignees.length > 0 ? `Top contributors: ${data.topAssignees.join(', ')}.` : ''}
Write a brief executive summary.`;

  try {
    const completion = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: WEEKLY_SUMMARY_PROMPT },
        { role: 'user',   content: userMessage },
      ],
      temperature: 0.4,
      max_tokens: 200,
    });

    return completion.choices[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    logger.warn({ err }, 'generateWeeklySummary failed — skipping AI block');
    return null;
  }
}

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

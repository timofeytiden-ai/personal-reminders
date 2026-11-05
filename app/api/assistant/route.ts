/**
 * AI assistant endpoint: a thin proxy to the Claude Messages API with tool
 * definitions. Tools are executed on the client against the user's data;
 * the client sends tool results back here in the next request.
 *
 * Access control (so nobody else can spend your API key):
 *  - if Supabase is configured: a valid user access token is required, OR
 *  - if ASSISTANT_PASSCODE is set: header `x-assistant-passcode` must match.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ASSISTANT_TOOLS, systemPrompt, type AssistantContext } from '../../../src/core/assistant-tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

async function authorized(req: Request): Promise<boolean> {
  const passcode = process.env.ASSISTANT_PASSCODE;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (passcode && req.headers.get('x-assistant-passcode') === passcode) return true;
  const auth = req.headers.get('authorization') || '';
  if (url && anon && auth.startsWith('Bearer ')) {
    const db = createClient(url, anon, { auth: { persistSession: false } });
    const { data } = await db.auth.getUser(auth.slice(7));
    if (data.user) return true;
  }
  // nothing configured → open (fine for local testing; set one of the above in production)
  return !passcode && !(url && anon);
}

export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'not_configured', message: 'Ассистент не настроен: добавьте ANTHROPIC_API_KEY в переменные окружения Vercel.' }, { status: 503 });
  }
  if (!(await authorized(req))) {
    return NextResponse.json({ error: 'unauthorized', message: 'Войдите в аккаунт в настройках, чтобы пользоваться ассистентом.' }, { status: 401 });
  }

  let body: { messages?: unknown[]; context?: AssistantContext };
  try {
    const text = await req.text();
    if (text.length > 400_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 120 || !body.context) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system: systemPrompt(body.context),
      tools: ASSISTANT_TOOLS,
      messages: body.messages,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: { message?: string } })?.error?.message || `Ошибка модели (${res.status})`;
    return NextResponse.json({ error: 'upstream', message }, { status: 502 });
  }
  const { content, stop_reason } = data as { content: unknown[]; stop_reason: string };
  return NextResponse.json({ content, stop_reason });
}

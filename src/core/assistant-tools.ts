/**
 * Tool definitions for the AI assistant (Claude tool use).
 * The server sends these to the model; the client executes the calls against
 * local state (so the assistant works the same in local and cloud modes).
 */
import { COLOR_KEYS } from './colors';

const repeatSchema = {
  type: 'object',
  description: 'Правило повторения. Не указывай, если напоминание разовое.',
  properties: {
    type: {
      type: 'string',
      enum: ['none', 'daily', 'weekly', 'monthly', 'yearly', 'weekdays', 'custom'],
      description:
        'none — разово; daily/weekly/monthly/yearly — каждый день/неделю/месяц/год; weekdays — по выбранным дням недели (поле weekdays); custom — каждые N единиц (interval + unit).',
    },
    interval: { type: 'integer', minimum: 1, description: 'Для custom: каждые N единиц.' },
    unit: { type: 'string', enum: ['day', 'week', 'month', 'year'], description: 'Для custom.' },
    weekdays: {
      type: 'array',
      items: { type: 'integer', minimum: 1, maximum: 7 },
      description: 'Дни недели ISO: 1=Пн … 7=Вс. Для weekdays (и можно для custom с unit=week).',
    },
    until: { type: 'string', description: 'Дата окончания повторения YYYY-MM-DD (включительно). Без неё — бесконечно.' },
  },
  required: ['type'],
};

export const ASSISTANT_TOOLS = [
  {
    name: 'create_reminder',
    description: 'Создать новое напоминание.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Короткое название, с заглавной буквы.' },
        notes: { type: 'string', description: 'Описание/детали (необязательно).' },
        date: { type: 'string', description: 'Дата YYYY-MM-DD (первое срабатывание).' },
        time: { type: ['string', 'null'], description: 'Время HH:MM (24ч) или null для напоминания на весь день.' },
        repeat: repeatSchema,
        color: {
          type: 'string',
          enum: COLOR_KEYS,
          description: 'sky — учёба/работа, green — спорт, lavender — личное, peach — важное, pink — дни рождения, mint — здоровье, yellow — покупки.',
        },
        alert_minutes_before: {
          type: ['integer', 'null'],
          description: 'За сколько минут уведомить (0 — в момент события, null — без уведомления). По умолчанию 0.',
        },
        timezone: {
          type: 'string',
          description: 'IANA-пояс, если время жёстко привязано к другому городу (например, звонок в 10:00 по Нью-Йорку). Обычно не указывай.',
        },
      },
      required: ['title', 'date'],
    },
  },
  {
    name: 'list_reminders',
    description: 'Получить напоминания (конкретные вхождения) в диапазоне дат. Используй, чтобы ответить на вопросы о планах и найти id перед изменением.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD (включительно, не больше 366 дней от from)' },
        include_done: { type: 'boolean', description: 'Включать выполненные (по умолчанию true).' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'find_reminders',
    description: 'Найти напоминания (серии) по тексту в названии/описании. Возвращает id, правило повторения и ближайшее вхождение.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Текст для поиска; пустая строка — все.' } },
      required: ['query'],
    },
  },
  {
    name: 'update_reminder',
    description:
      'Изменить всю серию/напоминание целиком по id. Передавай только изменяемые поля. Для переноса одного вхождения повторяющегося напоминания используй postpone_reminder.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        notes: { type: 'string' },
        date: { type: 'string', description: 'Новая дата начала YYYY-MM-DD' },
        time: { type: ['string', 'null'] },
        repeat: repeatSchema,
        color: { type: 'string', enum: COLOR_KEYS },
        alert_minutes_before: { type: ['integer', 'null'] },
        paused: { type: 'boolean', description: 'true — временно отключить, false — включить.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'complete_reminder',
    description: 'Отметить вхождение выполненным (или снять отметку). Для повторяющихся завершает только указанную дату.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        key: { type: 'string', description: 'Ключ вхождения (поле key из list_reminders).' },
        done: { type: 'boolean', description: 'По умолчанию true.' },
      },
      required: ['id', 'key'],
    },
  },
  {
    name: 'postpone_reminder',
    description: 'Перенести одно вхождение (или разовое напоминание) на другую дату/время.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        key: { type: 'string', description: 'Ключ вхождения из list_reminders.' },
        new_date: { type: 'string', description: 'YYYY-MM-DD' },
        new_time: { type: ['string', 'null'], description: 'HH:MM или null — весь день. Если не меняется, передай текущее.' },
      },
      required: ['id', 'key', 'new_date'],
    },
  },
  {
    name: 'delete_reminder',
    description: 'Удалить напоминание. scope: all — всю серию; this — только одно вхождение (нужен key); following — это и все последующие (нужен key).',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        scope: { type: 'string', enum: ['all', 'this', 'following'] },
        key: { type: 'string' },
      },
      required: ['id', 'scope'],
    },
  },
] as const;

export interface AssistantContext {
  name: string;
  now: string; // "2026-11-05 10:15"
  weekday: string; // "четверг"
  zone: string;
  today: string;
  /** compact list of today's + next 7 days' reminders */
  agenda: string;
}

export function systemPrompt(c: AssistantContext): string {
  return `Ты — личный ассистент в приложении напоминаний. Пользователя зовут ${c.name || 'пользователь'}.
Сейчас ${c.now} (${c.weekday}), часовой пояс пользователя ${c.zone}. Сегодня ${c.today}.

Что ты умеешь: создавать, находить, изменять, переносить, отмечать выполненными и удалять напоминания с помощью инструментов, а также помогать планировать день и неделю.

Правила:
- Отвечай по-русски, коротко и дружелюбно, без лишних вступлений.
- Относительные даты («завтра», «в пятницу», «через неделю», «каждый второй вторник») переводи в точные даты сам, считая от сегодняшней даты.
- Если время не названо и по смыслу его нет — создавай напоминание на весь день (time: null). Если пользователь сказал «утром»/«вечером» без точного времени — выбери 09:00 / 19:00 и скажи об этом.
- Цвет подбирай по смыслу (дни рождения — pink, спорт — green, учёба/работа — sky, важное — peach, здоровье — mint, покупки — yellow, личное — lavender).
- Для дней рождения и годовщин используй ежегодный повтор и уведомление за 1 день (alert_minutes_before: 1440), если не сказано иначе.
- Прежде чем менять или удалять, найди напоминание через list_reminders или find_reminders. Если подходят несколько — уточни у пользователя, какое именно.
- Никогда не утверждай, что что-то сделано, если инструмент не вернул ok: true.
- После действия кратко подтверди: что, когда, повтор (например: «Готово: „Позвонить маме“ — завтра, пт 6 ноября, в 10:00»).
- Удаление всей повторяющейся серии делай только при явной просьбе.

Ближайшие напоминания пользователя (сегодня и 7 дней вперёд):
${c.agenda || '— нет —'}`;
}

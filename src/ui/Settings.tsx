'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { allZones, deviceZone, nowTimeIn, offsetLabel, zoneCity } from '../core/dates';
import { DEFAULT_SETTINGS, effectiveZone, saveSettings, useStore } from '../state/store';
import { exportJson, importJson, wipeAll } from '../state/actions';
import { cloudConfigured, pull, sendCode, signOut, verifyCode } from '../state/sync';
import {
  isIOS, isStandalone, notificationSupport, pushAvailable, requestPermission, showSystemNotification, playChime,
  subscribePush, unsubscribePush, type NotifSupport,
} from '../notify/notify';
import { usePresence, Switch } from './Sheet';
import { toast } from './Toast';
import { ALERTS } from './Editor';
import {
  Bell, ChevronDown, ChevronLeft, Cloud, Download, Globe, Monitor, Moon, Share, Sparkles, Sun, Trash, Upload, User, Volume, Info,
} from './icons';

export function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { mounted, shown } = usePresence(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!mounted) return null;
  return (
    <div className={`panel ${shown ? 'open' : ''}`} role="dialog" aria-modal="true" aria-label="Настройки">
      <div className="panel-inner">
        <div className="panel-head">
          <button className="icon-btn" onClick={onClose} aria-label="Назад"><ChevronLeft /></button>
        </div>
        <h1 className="panel-title">Настройки</h1>
        <SettingsBody />
      </div>
    </div>
  );
}

function SettingsBody() {
  const s = useStore((x) => x.settings);
  const auth = useStore((x) => x.auth);
  const sync = useStore((x) => x.sync);
  const push = useStore((x) => x.push);
  const zone = effectiveZone(s);
  const [perm, setPerm] = useState<NotifSupport>(() => notificationSupport());
  const [zoneQuery, setZoneQuery] = useState('');
  const [confirmWipe, setConfirmWipe] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const zones = useMemo(() => allZones(), []);
  const filteredZones = useMemo(() => {
    const q = zoneQuery.trim().toLowerCase();
    return zones.filter((z) => !q || z.toLowerCase().replace(/_/g, ' ').includes(q)).slice(0, 80);
  }, [zones, zoneQuery]);

  const setGreeting = (k: keyof typeof s.greetings, v: string) => saveSettings({ greetings: { ...s.greetings, [k]: v } });

  const toggleNotifications = async (on: boolean) => {
    if (!on) {
      saveSettings({ notifications: false });
      if (push.subscribed) await unsubscribePush().catch(() => {});
      return;
    }
    const p = await requestPermission();
    setPerm(p);
    if (p === 'granted') {
      saveSettings({ notifications: true });
      if (auth.userId && pushAvailable()) {
        try {
          await subscribePush();
        } catch (e) {
          toast({ text: 'Фоновые push не подключены', sub: e instanceof Error ? e.message : String(e) });
        }
      }
    } else if (p === 'needs-install') {
      toast({ text: 'Сначала установите приложение', sub: 'Поделиться → «На экран Домой»', icon: <Share size={18} /> });
    } else {
      toast({ text: 'Уведомления запрещены', sub: 'Разрешите их в настройках браузера или iPhone' });
    }
  };

  const doExport = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reminders-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const doImport = async (file: File) => {
    try {
      const n = importJson(await file.text());
      toast({ text: `Импортировано: ${n}` });
    } catch (e) {
      toast({ text: 'Не удалось импортировать', sub: e instanceof Error ? e.message : String(e) });
    }
  };

  const permText: Record<NotifSupport, string> = {
    granted: 'Разрешены',
    denied: 'Запрещены в настройках устройства',
    default: 'Не запрошены',
    unsupported: 'Не поддерживаются этим браузером',
    'needs-install': 'Доступны после установки на экран «Домой»',
  };

  return (
    <>
      {/* ---------- profile ---------- */}
      <div className="group-label">Профиль</div>
      <div className="group">
        <label className="row static">
          <span className="row-icon" style={{ background: '#8467D2' }}><User /></span>
          <span className="row-label">Имя</span>
          <input className="row-input" value={s.name} maxLength={40} placeholder="Ваше имя" onChange={(e) => saveSettings({ name: e.target.value })} />
        </label>
      </div>
      <div className="group-label">Приветствие</div>
      <div className="group">
        {(
          [
            ['morning', 'Утро', '05–12'],
            ['day', 'День', '12–18'],
            ['evening', 'Вечер', '18–05'],
          ] as const
        ).map(([k, label, hours]) => (
          <label key={k} className="row static no-icon">
            <span className="row-label" style={{ flex: '0 0 auto', minWidth: 74 }}>
              {label}
              <small>{hours}</small>
            </span>
            <input className="row-input" value={s.greetings[k]} maxLength={40} onChange={(e) => setGreeting(k, e.target.value)} />
          </label>
        ))}
      </div>
      <div className="group-foot">
        Пример: «{s.greetings.morning}{s.name ? `, ${s.name}` : ''}».{' '}
        <button className="text-btn" style={{ padding: 0, fontSize: 12.5 }} onClick={() => saveSettings({ greetings: DEFAULT_SETTINGS.greetings })}>
          Сбросить
        </button>
      </div>

      {/* ---------- time zone ---------- */}
      <div className="group-label">Часовой пояс</div>
      <div className="group">
        <div className="row static">
          <span className="row-icon" style={{ background: '#2E9C84' }}><Globe /></span>
          <span className="row-label">
            {zoneCity(zone)}
            <small>{offsetLabel(zone)} · сейчас {nowTimeIn(zone)}</small>
          </span>
        </div>
        <div className="row-wrap">
          <div className="seg">
            <button className={s.tzMode === 'auto' ? 'on' : ''} onClick={() => saveSettings({ tzMode: 'auto' })}>Автоматически</button>
            <button className={s.tzMode === 'manual' ? 'on' : ''} onClick={() => saveSettings({ tzMode: 'manual', tzManual: s.tzManual || deviceZone() })}>Вручную</button>
          </div>
        </div>
        {s.tzMode === 'manual' && (
          <>
            <div className="row-wrap" style={{ paddingBottom: 8 }}>
              <label className="search" style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
                <input placeholder="Поиск: Athens, Tokyo, New York…" value={zoneQuery} onChange={(e) => setZoneQuery(e.target.value)} />
              </label>
            </div>
            <div className="zone-list">
              {filteredZones.map((z) => (
                <button key={z} className={`zone-item ${z === s.tzManual ? 'on' : ''}`} onClick={() => saveSettings({ tzManual: z })}>
                  <span>{z.replace(/_/g, ' ')}</span>
                  <small>{offsetLabel(z)} · {nowTimeIn(z)}</small>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="group-foot">
        {s.tzMode === 'auto' ? `Определён по устройству: ${deviceZone()}. ` : ''}
        Обычные напоминания следуют за вашим поясом (09:00 остаётся 09:00 в поездке). Напоминания с закреплённым поясом показываются в пересчёте на ваше время. Переход на летнее/зимнее время учитывается автоматически.
      </div>

      {/* ---------- appearance ---------- */}
      <div className="group-label">Оформление</div>
      <div className="group">
        <div className="row-wrap" style={{ paddingTop: 12 }}>
          <div className="seg">
            <button className={s.theme === 'light' ? 'on' : ''} onClick={() => saveSettings({ theme: 'light' })}><Sun size={17} />Светлая</button>
            <button className={s.theme === 'dark' ? 'on' : ''} onClick={() => saveSettings({ theme: 'dark' })}><Moon size={17} />Тёмная</button>
            <button className={s.theme === 'system' ? 'on' : ''} onClick={() => saveSettings({ theme: 'system' })}><Monitor size={17} />Системная</button>
          </div>
        </div>
      </div>

      {/* ---------- notifications ---------- */}
      <div className="group-label">Уведомления</div>
      <div className="group">
        <div className="row static">
          <span className="row-icon" style={{ background: '#E0605A' }}><Bell /></span>
          <span className="row-label">
            Уведомления
            <small>{permText[perm]}</small>
          </span>
          <Switch label="Уведомления" checked={s.notifications && perm === 'granted'} onChange={(v) => void toggleNotifications(v)} />
        </div>
        <div className="row static">
          <span className="row-icon" style={{ background: '#5B8DEF' }}><Volume /></span>
          <span className="row-label">
            Звук в приложении
            <small>Когда приложение открыто</small>
          </span>
          <Switch label="Звук" checked={s.sound} onChange={(v) => { saveSettings({ sound: v }); if (v) playChime(); }} />
        </div>
        <div className="row static">
          <span className="row-icon" style={{ background: '#E39A3B' }}><Bell /></span>
          <span className="row-label">Уведомлять</span>
          <span className="select-wrap">
            <select value={s.defaultAlert === null ? 'none' : String(s.defaultAlert)} onChange={(e) => saveSettings({ defaultAlert: e.target.value === 'none' ? null : Number(e.target.value) })} aria-label="Уведомление по умолчанию">
              {ALERTS.map((a) => <option key={String(a.v)} value={a.v === null ? 'none' : String(a.v)}>{a.label}</option>)}
            </select>
            <ChevronDown />
          </span>
        </div>
        <div className="row static">
          <span className="row-icon" style={{ background: '#2E9C84' }}><Sun /></span>
          <span className="row-label">
            Дела без времени
            <small>Во сколько напомнить</small>
          </span>
          <input type="time" className="time-input" value={s.allDayAlertTime} aria-label="Время для дел на весь день" onChange={(e) => e.target.value && saveSettings({ allDayAlertTime: e.target.value })} />
        </div>
        <button
          className="row"
          onClick={() => {
            if (s.sound) playChime();
            if (perm === 'granted') void showSystemNotification('Проверка уведомлений', 'Так будут выглядеть ваши напоминания', 'test');
            else toast({ text: 'Проверка уведомлений', sub: 'Системные уведомления пока не разрешены', icon: <Bell size={18} /> });
          }}
        >
          <span className="row-icon" style={{ background: '#8E8E93' }}><Info /></span>
          <span className="row-label">Отправить тестовое</span>
        </button>
      </div>
      <div className="group-foot">
        {cloudConfigured && pushAvailable()
          ? auth.userId
            ? push.subscribed
              ? 'Фоновые push-уведомления подключены: напоминания придут, даже если приложение закрыто (доставку обеспечивает система — она не гарантирована на 100%).'
              : 'Включите уведомления, чтобы подключить фоновые push для этого устройства.'
            : 'Чтобы получать уведомления при закрытом приложении, войдите в аккаунт ниже.'
          : 'Сейчас уведомления приходят, пока приложение открыто. Для фоновых push настройте сервер (см. README).'}
        {isIOS() && ' На iPhone уведомления работают в iOS 16.4+ только у приложения, установленного на экран «Домой».'}
      </div>

      {/* ---------- install ---------- */}
      {!isStandalone() && (
        <>
          <div className="group-label">Установка на iPhone</div>
          <div className="group">
            <ol className="install-steps" style={{ paddingTop: 14 }}>
              <li>Откройте сайт в <b>Safari</b></li>
              <li>Нажмите <b>Поделиться</b> <Share size={15} /></li>
              <li>Выберите <b>«На экран Домой»</b></li>
              <li>Запускайте с иконки — как обычное приложение</li>
            </ol>
          </div>
        </>
      )}

      {/* ---------- account ---------- */}
      <div className="group-label">Аккаунт и синхронизация</div>
      <AccountSection auth={auth} sync={sync} />

      {/* ---------- assistant ---------- */}
      <AssistantSection />

      {/* ---------- data ---------- */}
      <div className="group-label">Данные</div>
      <div className="group">
        <button className="row" onClick={doExport}>
          <span className="row-icon" style={{ background: '#5B8DEF' }}><Download /></span>
          <span className="row-label">Экспорт в файл</span>
        </button>
        <button className="row" onClick={() => fileRef.current?.click()}>
          <span className="row-icon" style={{ background: '#2E9C84' }}><Upload /></span>
          <span className="row-label">Импорт из файла</span>
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && void doImport(e.target.files[0])} />
        <button
          className="row danger"
          onClick={() => {
            if (!confirmWipe) {
              setConfirmWipe(true);
              setTimeout(() => setConfirmWipe(false), 4000);
              return;
            }
            wipeAll();
            setConfirmWipe(false);
            toast({ text: 'Все напоминания удалены' });
          }}
        >
          <span className="row-icon" style={{ background: '#E0574E' }}><Trash /></span>
          <span className="row-label">{confirmWipe ? 'Нажмите ещё раз для подтверждения' : 'Удалить все напоминания'}</span>
        </button>
      </div>
      <div className="version">Напоминания · версия 1.0</div>
    </>
  );
}

function AccountSection({ auth, sync }: { auth: { configured: boolean; userId: string | null; email: string | null }; sync: { status: string; lastSync: string | null; error: string | null } }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);

  if (!cloudConfigured) {
    return (
      <>
        <div className="group">
          <div className="row static">
            <span className="row-icon" style={{ background: '#8E8E93' }}><Cloud /></span>
            <span className="row-label">
              Хранение на устройстве
              <small>Данные сохраняются в этом браузере</small>
            </span>
          </div>
        </div>
        <div className="group-foot">Чтобы синхронизировать напоминания между устройствами, подключите Supabase (инструкция в README).</div>
      </>
    );
  }

  if (auth.userId) {
    const dot = sync.status === 'synced' ? 'ok' : sync.status === 'error' ? 'err' : 'warn';
    const label: Record<string, string> = { synced: 'Синхронизировано', syncing: 'Синхронизация…', offline: 'Нет сети — изменения сохранятся и отправятся позже', error: 'Ошибка синхронизации' };
    return (
      <>
        <div className="group">
          <div className="row static">
            <span className="row-icon" style={{ background: '#5B8DEF' }}><Cloud /></span>
            <span className="row-label">
              {auth.email}
              <small><span className={`status-dot ${dot}`} /> {label[sync.status] || sync.status}{sync.lastSync && sync.status === 'synced' ? ` · ${new Date(sync.lastSync).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''}</small>
            </span>
          </div>
          <button className="row no-icon" onClick={() => void pull()}>
            <span className="row-label" style={{ color: 'var(--brand)' }}>Синхронизировать сейчас</span>
          </button>
          <button className="row no-icon danger" onClick={() => void signOut()}>
            <span className="row-label">Выйти</span>
          </button>
        </div>
        {sync.error && <div className="group-foot" style={{ color: 'var(--danger)' }}>{sync.error}</div>}
      </>
    );
  }

  const submitEmail = async () => {
    setBusy(true);
    try {
      await sendCode(email.trim());
      setStep('code');
      toast({ text: 'Код отправлен', sub: email.trim() });
    } catch (e) {
      toast({ text: 'Не удалось отправить код', sub: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const submitCode = async () => {
    setBusy(true);
    try {
      await verifyCode(email.trim(), code.trim());
      toast({ text: 'Вы вошли', sub: 'Напоминания синхронизируются' });
    } catch (e) {
      toast({ text: 'Неверный код', sub: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="group">
        {step === 'email' ? (
          <label className="row static">
            <span className="row-icon" style={{ background: '#5B8DEF' }}><Cloud /></span>
            <input className="row-input left" type="email" inputMode="email" autoComplete="email" placeholder="Email для входа" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && email.includes('@') && void submitEmail()} />
          </label>
        ) : (
          <label className="row static">
            <span className="row-icon" style={{ background: '#5B8DEF' }}><Cloud /></span>
            <input className="row-input left code-input" inputMode="numeric" autoComplete="one-time-code" placeholder="Код из письма" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && void submitCode()} />
          </label>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        {step === 'code' && <button className="secondary-btn" onClick={() => setStep('email')}>Назад</button>}
        <button
          className="primary-btn"
          style={{ height: 48 }}
          disabled={busy || (step === 'email' ? !email.includes('@') : code.length < 6)}
          onClick={() => void (step === 'email' ? submitEmail() : submitCode())}
        >
          {busy ? 'Подождите…' : step === 'email' ? 'Получить код' : 'Войти'}
        </button>
      </div>
      <div className="group-foot">Вход без пароля: мы пришлём одноразовый код на почту. После входа напоминания с этого устройства загрузятся в облако и появятся на других устройствах.</div>
    </>
  );
}

function AssistantSection() {
  const [pass, setPass] = useState(() => {
    try {
      return localStorage.getItem('rem:assistantPasscode') || '';
    } catch {
      return '';
    }
  });
  return (
    <>
      <div className="group-label">ИИ-ассистент</div>
      <div className="group">
        <label className="row static">
          <span className="row-icon" style={{ background: 'linear-gradient(135deg,#8fa2ff,#b991f5 55%,#f39ab9)' }}><Sparkles /></span>
          <span className="row-label">Код доступа</span>
          <input
            className="row-input"
            type="password"
            placeholder="если задан на сервере"
            value={pass}
            onChange={(e) => {
              setPass(e.target.value);
              try {
                localStorage.setItem('rem:assistantPasscode', e.target.value);
              } catch {
                /* ignore */
              }
            }}
          />
        </label>
      </div>
      <div className="group-foot">Ассистент понимает обычную речь: «напомни в пятницу в 10 позвонить маме», «что у меня завтра?», «перенеси спортзал на вечер». Нужен интернет.</div>
    </>
  );
}

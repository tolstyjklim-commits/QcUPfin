// Бот: на /start отправляет приветственную плашку с кнопкой запуска мини-приложения.
// Работает через long polling (getUpdates), публичный адрес для вебхука не нужен.
// Нужно: TELEGRAM_BOT_TOKEN и WEBAPP_URL (HTTPS-адрес фронтенда).
const API = (t: string, m: string) => `https://api.telegram.org/bot${t}/${m}`

async function call<T = unknown>(token: string, method: string, body?: object): Promise<T> {
  const r = await fetch(API(token, method), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
  })
  const j = (await r.json()) as { ok: boolean; result: T; description?: string }
  if (!j.ok) throw new Error(`${method}: ${j.description || 'error'}`)
  return j.result
}

type Update = { update_id: number; message?: { chat: { id: number; type: string }; text?: string; from?: { first_name?: string } } }

export function startBot() {
  if (process.env.BOT_ENABLED === '0') return console.log('[bot] BOT_ENABLED=0: локальный бот выключен (бот работает через GitHub Actions)')
  const token = process.env.TELEGRAM_BOT_TOKEN
  const url = process.env.WEBAPP_URL
  if (!token || token === 'replace_me') return console.log('[bot] TELEGRAM_BOT_TOKEN не задан: бот выключен')
  if (!url || !url.startsWith('https://')) return console.log('[bot] задай WEBAPP_URL (https://...): бот выключен, Telegram требует HTTPS для мини-приложений')

  const buttonText = process.env.BOT_BUTTON_TEXT || '🎮 Играть'
  const welcome = process.env.BOT_WELCOME_TEXT ||
    '<b>QcUp</b>: мини-игры с подарками.\n\nРакета, апгрейд, кейсы, слоты и задания. Все монеты и подарки виртуальные.\n\nНажми кнопку ниже, чтобы запустить.'
  const image = process.env.BOT_WELCOME_IMAGE // https-ссылка на картинку для плашки (необязательно)

  const markup = { inline_keyboard: [[{ text: buttonText, web_app: { url } }]] }
  const greet = (chatId: number) => image
    ? call(token, 'sendPhoto', { chat_id: chatId, photo: image, caption: welcome, parse_mode: 'HTML', reply_markup: markup })
    : call(token, 'sendMessage', { chat_id: chatId, text: welcome, parse_mode: 'HTML', reply_markup: markup })

  void (async () => {
    try {
      await call(token, 'deleteWebhook') // long polling несовместим с вебхуком
      await call(token, 'setChatMenuButton', { menu_button: { type: 'web_app', text: buttonText, web_app: { url } } })
      await call(token, 'setMyCommands', { commands: [{ command: 'start', description: 'Запустить игру' }] })
      const me = await call<{ username: string }>(token, 'getMe')
      console.log(`[bot] @${me.username} запущен, плашка с кнопкой отправляется на /start`)
    } catch (e) { console.warn('[bot] не удалось настроить бота:', (e as Error).message) }

    let offset = 0
    for (;;) {
      try {
        const ups = await call<Update[]>(token, 'getUpdates', { offset, timeout: 30, allowed_updates: ['message'] })
        for (const u of ups) {
          offset = u.update_id + 1
          const m = u.message
          if (m && m.chat.type === 'private' && /^\/start(\s|@|$)/.test(m.text || '')) {
            greet(m.chat.id).catch(e => console.warn('[bot] отправка не удалась:', (e as Error).message))
          }
        }
      } catch (e) {
        if (/Conflict/i.test((e as Error).message)) { console.warn('[bot] этот же бот уже опрашивается в другом месте (GitHub Actions?). Локальный бот остановлен; чтобы убрать сообщение, поставь BOT_ENABLED=0 в backend/.env'); return }
        console.warn('[bot] ошибка опроса:', (e as Error).message)
        await new Promise(r => setTimeout(r, 5000))
      }
    }
  })()
}

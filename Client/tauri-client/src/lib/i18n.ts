export type Language = "ru" | "en";

export function getLanguage(): Language {
  try {
    const saved = localStorage.getItem("owncord:language");
    if (saved === "ru" || saved === "en") return saved;
  } catch { /* Storage can be disabled by the browser. */ }
  return navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function t(en: string, ru: string): string {
  return getLanguage() === "ru" ? ru : en;
}

export function setLanguage(language: Language): void {
  localStorage.setItem("owncord:language", language);
  location.reload();
}

/** Keep technical details in logs; show a reason and a recovery action to users. */
export function describeError(error: unknown, code?: string, status?: number): string {
  const obj = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
  const message = typeof error === "string" ? error : typeof obj?.message === "string" ? obj.message : "";
  code = code ?? (typeof obj?.code === "string" ? obj.code : undefined);
  status = status ?? (typeof obj?.status === "number" ? obj.status : undefined);
  if (getLanguage() !== "ru") return message || "Something went wrong. Please try again.";
  if (/[а-яё]/i.test(message)) return message;
  const rules: Array<[RegExp, string]> = [
    [/invalid invite or credentials/i, "Не удалось зарегистрироваться. Проверьте код приглашения и имя пользователя; при необходимости запросите новый код у администратора."],
    [/registration is currently closed/i, "Регистрация на сервере закрыта. Обратитесь к администратору."],
    [/account.*suspended|you.*banned/i, "Аккаунт заблокирован на этом сервере. Обратитесь к администратору."],
    [/expired.*(two.factor|challenge)/i, "Время подтверждения входа истекло. Вернитесь к форме входа и введите пароль снова."],
    [/two.factor authentication must be enabled/i, "На сервере обязательна двухфакторная защита. Попросите администратора помочь настроить её для вашего аккаунта."],
    [/invalid credentials|invalid username or password|incorrect password|wrong password/i, "Неверное имя пользователя или пароль. Проверьте раскладку клавиатуры и попробуйте ещё раз."],
    [/already connected|another client/i, "Этот аккаунт уже подключён с другого устройства. Завершите тот сеанс и повторите вход."],
    [/username.*(taken|exists|use)/i, "Это имя пользователя уже занято. Выберите другое имя."],
    [/invite.*(invalid|expired|used)|invalid.*invite/i, "Приглашение недействительно или истекло. Попросите администратора прислать новый код."],
    [/totp|2fa|two.factor|verification code|authenticator/i, "Код двухфакторной проверки не подошёл. Введите новый код из приложения и проверьте время на телефоне."],
    [/voice.*not configured/i, "Голосовая связь не настроена на сервере. Администратору нужно настроить LiveKit."],
    [/livekit.*not running|voice.*unavailable/i, "Голосовой сервер временно недоступен. Попробуйте позже или сообщите администратору."],
    [/channel.*full/i, "В голосовом канале нет свободных мест. Выберите другой канал или подождите."],
    [/NotAllowedError|permission denied|microphone.*permission/i, "Доступ к микрофону или камере запрещён. Разрешите доступ в настройках приложения, браузера и Windows."],
    [/NotFoundError|no.*(microphone|device)|device.*not found/i, "Микрофон или камера не найдены. Подключите устройство и выберите его в настройках звука."],
    [/certificate|cert.*mismatch|TLS/i, "Не удалось проверить сертификат сервера. Проверьте адрес и сертификат у администратора."],
    [/fetch|network|connection|connect.*failed|timeout|timed out|offline/i, "Не удалось связаться с сервером. Проверьте адрес, интернет или VPN и повторите попытку."],
    [/credential.*sav|save.*credential/i, "Не удалось сохранить данные входа. Проверьте доступ к хранилищу Windows или разрешение браузера на хранение данных."],
    [/password.*(short|least|length)/i, "Пароль слишком короткий. Используйте не менее 8 символов."],
    [/too (many|fast)|rate.limit/i, "Слишком много запросов. Подождите немного и повторите попытку."],
  ];
  for (const [pattern, translated] of rules) if (pattern.test(message)) return translated;
  const codes: Record<string, string> = {
    UNAUTHORIZED: "Сеанс истёк. Войдите в аккаунт ещё раз.",
    FORBIDDEN: "У вас нет прав для этого действия. Обратитесь к администратору сервера.",
    BANNED: "Доступ к серверу заблокирован. Обратитесь к администратору.",
    NOT_FOUND: "Объект больше не существует. Обновите список и попробуйте снова.",
    RATE_LIMITED: "Слишком много запросов. Подождите немного и повторите попытку.",
    BAD_REQUEST: "Сервер не принял запрос. Проверьте введённые данные и повторите попытку.",
    CHANNEL_FULL: "В голосовом канале нет свободных мест.",
    ALREADY_JOINED: "Вы уже подключены к этому голосовому каналу.",
    CALL_BUSY: "Собеседник уже разговаривает или получает другой звонок. Попробуйте позже.",
    CALL_OFFLINE: "Собеседник не в сети. Позвоните, когда он подключится.",
    CALL_EXPIRED: "Звонок уже завершён или время ожидания истекло. Позвоните снова.",
    INTERNAL: "На сервере произошла ошибка. Повторите попытку; если ошибка повторяется, сообщите администратору.",
  };
  if (code && codes[code]) return codes[code]!;
  if (status === 401) return codes.UNAUTHORIZED!;
  if (status === 403) return codes.FORBIDDEN!;
  if (status === 404 && code === "UNKNOWN") return "Сервер не поддерживает этот запрос. Обновите приложение; если ошибка останется, сообщите администратору.";
  if (status === 429) return codes.RATE_LIMITED!;
  if (status && status >= 500) return codes.INTERNAL!;
  const reference = code && /^[A-Z0-9_]{1,48}$/.test(code) ? ` Код: ${code}.` : "";
  return `Не удалось выполнить действие. Повторите попытку. Если ошибка повторяется, откройте журнал в настройках и сообщите администратору.${reference}`;
}

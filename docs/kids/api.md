# API یادبین کودک

همه‌چیز زیر `/api/kids/*`. خطاها مثل بقیهٔ API: `{ error, message }` (پیام فارسی).

## والد (JWT)
| متد | مسیر | توضیح |
|---|---|---|
| POST | `/api/kids/parent/register` | `{name, phone, password}` ← `{token, parent, recoveryCode}` (کد بازیابی فقط یک‌بار) |
| POST | `/api/kids/parent/login` | `{phone, password}` (rate-limit + lockout) |
| POST | `/api/kids/parent/reset-password` | `{phone, recoveryCode, newPassword}` ← کد بازیابی تازه |
| GET | `/api/kids/parent` | والد + فهرست کودکان |
| POST | `/api/kids/parent/children` | `{name, age 4–12, avatar?}` ← `{child, childToken, childLink}` (حداکثر ۶ کودک) |
| PUT/DELETE | `/api/kids/parent/children/:id` | ویرایش / حذف کودک و **همهٔ** داده‌اش |
| POST | `/api/kids/parent/children/:id/link` | پیوند تازه؛ قبلی بی‌اثر |
| GET | `/api/kids/parent/children/:id/dashboard` | وضعیت، مهارت‌ها (امتیاز مشاهده‌شده، روند، نمودار)، نقاط قوت/تمرین، فعالیت، منحنی یادگیری، پیشنهادها |
| GET | `/api/kids/parent/children/:id/report?period=week\|month` | گزارش متنی |
| GET | `/api/kids/report?childId=&period=` | همان گزارش (alias) |
| POST | `/api/kids/parent/delete-account` | `{password, confirm:true}` حذف همه‌چیز |

## کودک (`Authorization: Bearer kc_…`، بدون ورود)
| متد | مسیر | توضیح |
|---|---|---|
| GET | `/api/kids/profile` | نام، آواتار، XP، ستاره، دنیاها، مدال‌ها |
| GET | `/api/kids/journey` | سفر امروز (۳ بازی از ۳ مهارت)، `done`، پیشنهاد استراحت |
| POST | `/api/kids/session/start` | (اختیاری، آنلاین) سطح/seed/theme معین |
| POST | `/api/kids/session/result` | نتیجهٔ خام؛ **ایدمپوتنت** با `sessionId`؛ پاسخ: `result` (ستاره/XP/مدال، بدون هیچ عدد سنجشی) + `sync` (وضعیت adaptive برای دستگاه) |
| GET | `/api/kids/progress` | فقط پیشرفت خود کودک: ستاره، دنیاها، مدال‌ها، مرحلهٔ هر بازی |

### بدنهٔ `session/result`
```json
{ "sessionId": "A-Za-z0-9_-  (۸–۶۴)", "gameId": "memory_match|visual_attention|pattern_logic|reaction_control|path_puzzle|rule_switch",
  "level": 1, "seed": "…", "themeId": "animals", "startedAt": "ISO", "durationMs": 90000, "completed": true,
  "trials": [{ "correct": true, "rtMs": 820, "errors": 0, "attempts": 1, "tag": "switch|repeat (اختیاری)" }] }
```
هر فیلد اضافه (مثل `score`/`xp`) نادیده گرفته می‌شود. ۱ تا ۶۴ trial؛ مقادیر غیرمنطقی ← 400.

# 🃏 הסניף הדיגיטלי — מערכת ניהול קופה משותפת

אפליקציית ווב לניהול קופה משותפת של מועדון פוקר אונליין.

---

## ⚙️ הגדרה ראשונית

### 1. יצירת מסד הנתונים ב-Supabase

התחבר ל-[Supabase](https://supabase.com), צור פרויקט חדש, ובצע את כל ה-SQL הבא ב-SQL Editor:

```sql
-- שחקנים
CREATE TABLE players (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name            text NOT NULL,
  rakeback_percent numeric DEFAULT 60,
  created_at      timestamp DEFAULT now()
);

-- תקופה נוכחית (שורה יחידה, id=1)
CREATE TABLE current_period (
  id         int PRIMARY KEY,
  bit_maor   numeric DEFAULT 0,
  bit_ido    numeric DEFAULT 0,
  bit_ravit  numeric DEFAULT 0,
  bit_dorin  numeric DEFAULT 0,
  paybox     numeric DEFAULT 0,
  cashcash   numeric DEFAULT 0,
  debt_ido   numeric DEFAULT 0,
  debt_maor  numeric DEFAULT 0,
  counter    numeric DEFAULT 0,
  updated_at timestamp DEFAULT now()
);

-- הכנס שורה ראשונית
INSERT INTO current_period (id) VALUES (1) ON CONFLICT DO NOTHING;

-- הטבלה הכחולה — החזר גנייה
CREATE TABLE blue_table_rakeback (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id        uuid REFERENCES players(id) ON DELETE SET NULL,
  rake_taken       numeric,
  rakeback_percent numeric,
  rakeback_amount  numeric,
  created_by       text,
  created_at       timestamp DEFAULT now()
);

-- הטבלה הכחולה — טורנירים
CREATE TABLE blue_table_tournaments (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id       uuid REFERENCES players(id) ON DELETE SET NULL,
  tournament_type text,
  prize_chips     numeric,
  created_by      text,
  created_at      timestamp DEFAULT now()
);

-- הטבלה הכחולה — בונוסים
CREATE TABLE blue_table_bonuses (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id    uuid REFERENCES players(id) ON DELETE SET NULL,
  chips_amount numeric,
  created_by   text,
  created_at   timestamp DEFAULT now()
);

-- הטבלה הכחולה — חבר מביא חבר
CREATE TABLE blue_table_referrals (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  referring_player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  referred_player_id  uuid REFERENCES players(id) ON DELETE SET NULL,
  chips_amount        numeric,
  created_by          text,
  created_at          timestamp DEFAULT now()
);

-- משיכות שחקנים
CREATE TABLE withdrawals (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id       uuid REFERENCES players(id) ON DELETE SET NULL,
  withdrawal_date date,
  amount_ils      numeric,
  chips_amount    numeric,
  created_by      text,
  created_at      timestamp DEFAULT now()
);

-- היסטוריה
CREATE TABLE history (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  period_start          date,
  period_end            date,
  total_expenses_chips  numeric DEFAULT 0,
  total_withdrawals_ils numeric DEFAULT 0,
  profit_total          numeric DEFAULT 0,
  profit_ido            numeric DEFAULT 0,
  profit_maor           numeric DEFAULT 0,
  entry_type            text DEFAULT 'regular',
  closed_by             text,
  notes                 text,
  created_at            timestamp DEFAULT now()
);
```

### 2. הגדרת RLS (Row Level Security)

כדי שה-anon key יוכל לקרוא ולכתוב, בצע אחת מהאפשרויות:

**אפשרות א׳ — כיבוי RLS (לשימוש פנימי בלבד):**
```sql
ALTER TABLE players             DISABLE ROW LEVEL SECURITY;
ALTER TABLE current_period      DISABLE ROW LEVEL SECURITY;
ALTER TABLE blue_table_rakeback DISABLE ROW LEVEL SECURITY;
ALTER TABLE blue_table_tournaments DISABLE ROW LEVEL SECURITY;
ALTER TABLE blue_table_bonuses  DISABLE ROW LEVEL SECURITY;
ALTER TABLE blue_table_referrals DISABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals         DISABLE ROW LEVEL SECURITY;
ALTER TABLE history             DISABLE ROW LEVEL SECURITY;
```

**אפשרות ב׳ — מדיניות פתוחה (allow all for anon):**
```sql
-- חזור על זה לכל טבלה:
CREATE POLICY "allow_all" ON players FOR ALL TO anon USING (true) WITH CHECK (true);
-- (ועוד 7 פעמים לכל שאר הטבלאות)
```

### 3. עדכון app.js

פתח את `app.js` ועדכן את שני הקבועים בתחילת הקובץ:

```javascript
const SUPABASE_URL      = 'https://XXXXXXXXXXXX.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...your-anon-key...';
```

הפרטים זמינים ב-Supabase Dashboard ← Settings ← API.

### 4. עדכון סיסמאות

באותו הקובץ `app.js`, עדכן:

```javascript
const USERS = {
  ido:  'הסיסמא_של_עידו',
  maor: 'הסיסמא_של_מאור'
};
```

---

## 🚀 פריסה ל-GitHub Pages

1. צור repository ב-GitHub (ציבורי)
2. העלה את שלושת הקבצים: `index.html`, `style.css`, `app.js`
3. ב-Settings → Pages → Branch: `main`, Folder: `/ (root)` → Save
4. האפליקציה תהיה זמינה בכתובת: `https://USERNAME.github.io/REPO-NAME/`

---

## 📁 מבנה קבצים

```
├── index.html   — מבנה HTML מלא (6 דפים + לוגין)
├── style.css    — עיצוב dark mode, RTL, רספונסיבי
├── app.js       — לוגיקה: Auth, ניווט, Supabase REST, כל הדפים
└── README.md    — הוראות הגדרה
```

---

## 📊 נוסחאות החישוב

| מדד | נוסחה |
|-----|--------|
| כסף נזיל | Bit מאור + Bit עידו + Bit רוית + Bit דורין + PayBox + CashCash |
| סה"כ בקופה | כסף נזיל + חוב עידו + חוב מאור |
| צ'יפים בכסף | Counter ÷ 10 |
| רווח כללי | (Counter ÷ 10) − סה"כ בקופה |
| רווח עידו | רווח כללי ÷ 2 |
| רווח מאור | רווח כללי ÷ 2 |

---

## 🔐 הרשאות

- עידו ומאור בלבד — הסיסמאות מוגדרות ב-`app.js`
- Session נשמר ב-`sessionStorage` (מתנקה עם סגירת הדפדפן)
- אין שימוש ב-Supabase Auth

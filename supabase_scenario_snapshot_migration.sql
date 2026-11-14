-- תרחיש משיכה שנקבע בסגירת תקופה — snapshot אינפורמטיבי בלבד (סימולציה), לא רשומת משיכה בפועל
-- הוספה בלבד: עמודה nullable חדשה; לא משנה עמודות או רשומות קיימות
ALTER TABLE history ADD COLUMN IF NOT EXISTS scenario_snapshot jsonb;

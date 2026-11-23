BEGIN;
ALTER TABLE public.event_expense_interest ADD COLUMN IF NOT EXISTS not_attending boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.event_expense_set_attendance(p_id uuid,p_not_attending boolean,p_expected_updated_at timestamptz)
RETURNS SETOF public.event_expense_interest LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ir public.event_expense_interest;
BEGIN
 PERFORM public.event_expense_authorize();
 IF p_not_attending IS NULL THEN RAISE EXCEPTION 'נדרש מצב הגעה'; END IF;
 SELECT * INTO ir FROM public.event_expense_interest WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'הרישום לא נמצא'; END IF;
 PERFORM 1 FROM public.event_expense_events WHERE id=ir.event_id AND NOT archived FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'האירוע אינו פעיל'; END IF;
 IF ir.updated_at IS DISTINCT FROM p_expected_updated_at THEN
  IF ir.not_attending=p_not_attending THEN RETURN NEXT ir; RETURN; END IF;
  RAISE EXCEPTION 'הרישום השתנה. רענן לפני עריכה';
 END IF;
 UPDATE public.event_expense_interest SET not_attending=p_not_attending,updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO ir;
 RETURN NEXT ir;
END $$;
REVOKE ALL ON FUNCTION public.event_expense_set_attendance(uuid,boolean,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.event_expense_set_attendance(uuid,boolean,timestamptz) TO authenticated;
COMMIT;
